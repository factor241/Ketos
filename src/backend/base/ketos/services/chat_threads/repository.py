from __future__ import annotations

import inspect
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import func, update
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from ketos.services.database.models.chat_thread.model import ChatContextPolicy, ChatRun, ChatRunStatus, ChatThread
from ketos.services.database.models.folder.model import Folder

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable
    from uuid import UUID

    from sqlmodel.ext.asyncio.session import AsyncSession

_ALLOWED_PATCH_FIELDS = frozenset({"title", "provider", "model_name", "context_policy", "archived"})
_FINGERPRINT_RE = re.compile(r"[0-9a-f]{64}\Z")
_MAX_ATTEMPTS_ERROR = "max_attempts must be an integer between 1 and 5"
_EXPECTED_REVISION_ERROR = "expected_revision must be a non-negative integer"
_EMPTY_PATCH_ERROR = "chat patch must change at least one field"
_UNKNOWN_PATCH_ERROR = "chat patch contains an unsupported field"
_IDENTIFIER_ERROR = "run identifiers must not be blank"
_RUN_ID_LENGTH_ERROR = "ag_ui_run_id must not exceed 256 characters"
_IDEMPOTENCY_LENGTH_ERROR = "idempotency_key must not exceed 512 characters"
_FINGERPRINT_ERROR = "request_fingerprint must be a lowercase SHA-256 hex digest"
_TITLE_ERROR = "title must contain between 1 and 120 characters"
_PROVIDER_ERROR = "provider must contain between 1 and 128 characters"
_MODEL_ERROR = "model_name must contain between 1 and 256 characters"
_CONTEXT_ERROR = "context_policy must be chat_only or board"
_ARCHIVED_ERROR = "archived must be a boolean"
_MAX_ATTEMPTS = 5
_MAX_AG_UI_RUN_ID_LENGTH = 256
_MAX_IDEMPOTENCY_KEY_LENGTH = 512


class ChatNotFoundError(Exception):
    """Raised when a chat is absent or not visible to the actor."""


class ChatRevisionConflictError(Exception):
    code = "chat_revision_conflict"

    def __init__(self, chat_id: UUID):
        super().__init__(self.code)
        self.chat_id = chat_id


class ChatIdempotencyConflictError(Exception):
    code = "chat_idempotency_conflict"

    def __init__(self, chat_id: UUID):
        super().__init__(self.code)
        self.chat_id = chat_id


class ChatRunAllocationError(Exception):
    code = "chat_run_allocation_conflict"

    def __init__(self, chat_id: UUID):
        super().__init__(self.code)
        self.chat_id = chat_id


@dataclass(frozen=True)
class ChatRunClaim:
    run: ChatRun
    replayed: bool


async def list_nonterminal_chat_runs(
    session: AsyncSession,
    *,
    limit: int,
) -> list[ChatRun]:
    """Return a bounded deterministic set for startup-only classification."""
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 1000:
        raise ValueError("limit must be an integer between 1 and 1000")
    result = await session.exec(
        select(ChatRun)
        .where(ChatRun.status.in_((ChatRunStatus.CLAIMED, ChatRunStatus.RUNNING)))
        .order_by(ChatRun.created_at.asc(), ChatRun.id.asc())
        .limit(limit)
    )
    return list(result.all())


async def get_owned_chat_run(
    session: AsyncSession,
    *,
    run_id: UUID,
    actor_id: UUID,
) -> ChatRun | None:
    """Fetch one run exclusively through its persisted Folder owner chain."""
    result = await session.exec(
        select(ChatRun)
        .join(ChatThread, ChatRun.chat_id == ChatThread.id)
        .join(Folder, ChatThread.project_id == Folder.id)
        .where(ChatRun.id == run_id, Folder.user_id == actor_id)
        .execution_options(populate_existing=True)
    )
    return result.one_or_none()


async def mark_chat_run_failed_recoverable(
    session: AsyncSession,
    *,
    run_id: UUID,
    observed_status: ChatRunStatus,
    finished_at: datetime,
    redacted_audit: dict[str, str],
) -> bool:
    """CAS one exactly observed nonterminal run into the restart outcome."""
    if observed_status not in (ChatRunStatus.CLAIMED, ChatRunStatus.RUNNING):
        return False
    result = await session.exec(
        update(ChatRun)
        .where(ChatRun.id == run_id, ChatRun.status == observed_status)
        .values(
            status=ChatRunStatus.FAILED_RECOVERABLE,
            outcome="backend_restarted",
            finished_at=finished_at,
            redacted_audit=redacted_audit,
        )
    )
    return result.rowcount == 1


async def require_owned_chat(session: AsyncSession, *, chat_id: UUID, actor_id: UUID) -> ChatThread:
    result = await session.exec(
        select(ChatThread)
        .join(Folder, ChatThread.project_id == Folder.id)
        .where(ChatThread.id == chat_id, Folder.user_id == actor_id)
        .execution_options(populate_existing=True)
    )
    chat = result.first()
    if chat is None:
        raise ChatNotFoundError
    return chat


def _validated_patch(values: dict[str, object]) -> dict[str, object]:
    if not values:
        raise ValueError(_EMPTY_PATCH_ERROR)
    if set(values) - _ALLOWED_PATCH_FIELDS:
        raise ValueError(_UNKNOWN_PATCH_ERROR)
    validated = dict(values)
    for field, limit, error in (
        ("title", 120, _TITLE_ERROR),
        ("provider", 128, _PROVIDER_ERROR),
        ("model_name", 256, _MODEL_ERROR),
    ):
        if field not in validated:
            continue
        value = validated[field]
        if not isinstance(value, str) or not (clean := value.strip()) or len(clean) > limit:
            raise ValueError(error)
        validated[field] = clean
    if "context_policy" in validated:
        try:
            validated["context_policy"] = ChatContextPolicy(validated["context_policy"])
        except (TypeError, ValueError) as exc:
            raise ValueError(_CONTEXT_ERROR) from exc
    if "archived" in validated and not isinstance(validated["archived"], bool):
        raise ValueError(_ARCHIVED_ERROR)
    return validated


async def compare_and_swap_chat(
    session: AsyncSession,
    *,
    chat_id: UUID,
    actor_id: UUID,
    expected_revision: int,
    values: dict[str, object],
) -> ChatThread:
    if isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 0:
        raise ValueError(_EXPECTED_REVISION_ERROR)
    validated = _validated_patch(values)
    await require_owned_chat(session, chat_id=chat_id, actor_id=actor_id)
    result = await session.exec(
        update(ChatThread)
        .where(
            ChatThread.id == chat_id,
            ChatThread.project_id.in_(select(Folder.id).where(Folder.user_id == actor_id)),
            ChatThread.revision == expected_revision,
        )
        .values(
            **validated,
            revision=ChatThread.revision + 1,
            updated_at=datetime.now(timezone.utc),
        )
    )
    if result.rowcount != 1:
        await session.rollback()
        await require_owned_chat(session, chat_id=chat_id, actor_id=actor_id)
        raise ChatRevisionConflictError(chat_id)
    await session.commit()
    return await require_owned_chat(session, chat_id=chat_id, actor_id=actor_id)


async def get_owned_run_by_idempotency(
    session: AsyncSession,
    *,
    chat_id: UUID,
    actor_id: UUID,
    idempotency_key: str,
) -> ChatRun | None:
    result = await session.exec(
        select(ChatRun)
        .join(ChatThread, ChatRun.chat_id == ChatThread.id)
        .join(Folder, ChatThread.project_id == Folder.id)
        .where(
            ChatRun.chat_id == chat_id,
            ChatRun.idempotency_key == idempotency_key,
            Folder.user_id == actor_id,
        )
        .execution_options(populate_existing=True)
    )
    return result.first()


def _integrity_kind(error: IntegrityError) -> str | None:
    constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
    if constraint == "uq_chat_run_chat_idempotency":
        return "idempotency"
    if constraint == "uq_chat_run_chat_sequence":
        return "sequence"
    message = str(error.orig).lower()
    if "unique constraint failed" not in message:
        return None
    if "chat_run.chat_id" not in message:
        return None
    if "chat_run.idempotency_key" in message:
        return "idempotency"
    if "chat_run.run_sequence" in message:
        return "sequence"
    return None


def _validate_claim_inputs(
    *, ag_ui_run_id: str, idempotency_key: str, request_fingerprint: str, max_attempts: int
) -> None:
    if isinstance(max_attempts, bool) or not isinstance(max_attempts, int) or not 1 <= max_attempts <= _MAX_ATTEMPTS:
        raise ValueError(_MAX_ATTEMPTS_ERROR)
    if not isinstance(ag_ui_run_id, str) or not ag_ui_run_id.strip():
        raise ValueError(_IDENTIFIER_ERROR)
    if len(ag_ui_run_id) > _MAX_AG_UI_RUN_ID_LENGTH:
        raise ValueError(_RUN_ID_LENGTH_ERROR)
    if not isinstance(idempotency_key, str) or not idempotency_key.strip():
        raise ValueError(_IDENTIFIER_ERROR)
    if len(idempotency_key) > _MAX_IDEMPOTENCY_KEY_LENGTH:
        raise ValueError(_IDEMPOTENCY_LENGTH_ERROR)
    if not isinstance(request_fingerprint, str) or _FINGERPRINT_RE.fullmatch(request_fingerprint) is None:
        raise ValueError(_FINGERPRINT_ERROR)


def _replay_or_conflict(existing: ChatRun, *, request_fingerprint: str, chat_id: UUID) -> ChatRunClaim:
    if existing.request_fingerprint != request_fingerprint:
        raise ChatIdempotencyConflictError(chat_id)
    return ChatRunClaim(run=existing, replayed=True)


async def claim_chat_run(
    session: AsyncSession,
    *,
    chat_id: UUID,
    actor_id: UUID,
    ag_ui_run_id: str,
    idempotency_key: str,
    request_fingerprint: str,
    max_attempts: int = 5,
    before_flush: Callable[[ChatRun], Awaitable[None] | None] | None = None,
) -> ChatRunClaim:
    _validate_claim_inputs(
        ag_ui_run_id=ag_ui_run_id,
        idempotency_key=idempotency_key,
        request_fingerprint=request_fingerprint,
        max_attempts=max_attempts,
    )
    await require_owned_chat(session, chat_id=chat_id, actor_id=actor_id)
    existing = await get_owned_run_by_idempotency(
        session,
        chat_id=chat_id,
        actor_id=actor_id,
        idempotency_key=idempotency_key,
    )
    if existing is not None:
        return _replay_or_conflict(existing, request_fingerprint=request_fingerprint, chat_id=chat_id)

    for _attempt in range(max_attempts):
        next_sequence = (
            await session.exec(
                select(func.coalesce(func.max(ChatRun.run_sequence), 0) + 1).where(ChatRun.chat_id == chat_id)
            )
        ).one()
        run = ChatRun(
            chat_id=chat_id,
            ag_ui_run_id=ag_ui_run_id.strip(),
            langgraph_thread_id=str(chat_id),
            idempotency_key=idempotency_key.strip(),
            request_fingerprint=request_fingerprint,
            run_sequence=int(next_sequence),
        )
        if before_flush is not None:
            try:
                hook_result = before_flush(run)
                if inspect.isawaitable(hook_result):
                    await hook_result
            except BaseException:
                await session.rollback()
                raise
        try:
            async with session.begin_nested():
                session.add(run)
                await session.flush()
        except IntegrityError as exc:
            kind = _integrity_kind(exc)
            if kind is None:
                raise
            existing = await get_owned_run_by_idempotency(
                session,
                chat_id=chat_id,
                actor_id=actor_id,
                idempotency_key=idempotency_key,
            )
            if existing is not None:
                return _replay_or_conflict(existing, request_fingerprint=request_fingerprint, chat_id=chat_id)
            if kind == "sequence":
                continue
            raise
        await session.commit()
        await session.refresh(run)
        return ChatRunClaim(run=run, replayed=False)
    await session.rollback()
    raise ChatRunAllocationError(chat_id)
