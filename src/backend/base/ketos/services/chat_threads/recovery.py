"""Bounded, checkpoint-aware restart classification for durable Chat runs."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Protocol
from uuid import UUID

from ketos.services.chat_threads.repository import (
    ChatIdempotencyConflictError,
    ChatNotFoundError,
    get_owned_chat_run,
    list_nonterminal_chat_runs,
    mark_chat_run_failed_recoverable,
)
from ketos.services.database.models.chat_thread.model import ChatRun, ChatRunStatus

if TYPE_CHECKING:
    from sqlmodel.ext.asyncio.session import AsyncSession


class CheckpointProbe(Protocol):
    async def has_resumable_checkpoint(self, thread_id: str) -> bool: ...


ChatRunRecoveryNotFoundError = ChatNotFoundError
ChatRunRecoveryConflictError = ChatIdempotencyConflictError


@dataclass(frozen=True, slots=True)
class ChatRunRecoveryResult:
    run_id: UUID
    status: ChatRunStatus
    checkpoint_resumable: bool
    changed: bool


_RESTART_AUDIT = {
    "checkpoint": "missing_or_unsupported",
    "reason": "backend_restarted",
}
_NONTERMINAL = frozenset((ChatRunStatus.CLAIMED, ChatRunStatus.RUNNING))


async def _classify_run(
    session: AsyncSession,
    *,
    run: ChatRun,
    probe: CheckpointProbe,
) -> ChatRunRecoveryResult:
    resumable = await probe.has_resumable_checkpoint(run.langgraph_thread_id)
    if resumable:
        return ChatRunRecoveryResult(run.id, run.status, True, False)
    changed = await mark_chat_run_failed_recoverable(
        session,
        run_id=run.id,
        observed_status=run.status,
        finished_at=datetime.now(timezone.utc),
        redacted_audit=dict(_RESTART_AUDIT),
    )
    if not changed:
        await session.refresh(run)
    return ChatRunRecoveryResult(
        run.id,
        ChatRunStatus.FAILED_RECOVERABLE if changed else run.status,
        False,
        changed,
    )


async def classify_nonterminal_runs(
    session: AsyncSession,
    *,
    probe: CheckpointProbe,
    limit: int = 100,
) -> tuple[ChatRunRecoveryResult, ...]:
    """Classify startup candidates without invoking or resuming a graph."""
    candidates = await list_nonterminal_chat_runs(session, limit=limit)
    results = tuple([await _classify_run(session, run=run, probe=probe) for run in candidates])
    if any(result.changed for result in results):
        await session.commit()
    return results


async def reconcile_owned_run(
    session: AsyncSession,
    *,
    run_id: UUID,
    actor_id: UUID,
    request_fingerprint: str,
    probe: CheckpointProbe,
) -> ChatRunRecoveryResult:
    """Reconcile one authorized request without creating a run or message."""
    run = await get_owned_chat_run(session, run_id=run_id, actor_id=actor_id)
    if run is None:
        raise ChatRunRecoveryNotFoundError
    if run.request_fingerprint != request_fingerprint:
        raise ChatRunRecoveryConflictError(run.chat_id)
    if run.status not in _NONTERMINAL:
        return ChatRunRecoveryResult(run.id, run.status, False, False)
    result = await _classify_run(session, run=run, probe=probe)
    if result.changed:
        await session.commit()
    return result


__all__ = [
    "ChatRunRecoveryConflictError",
    "ChatRunRecoveryNotFoundError",
    "ChatRunRecoveryResult",
    "CheckpointProbe",
    "classify_nonterminal_runs",
    "reconcile_owned_run",
]
