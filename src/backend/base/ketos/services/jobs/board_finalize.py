"""Atomic compare-and-set finalization for Stage 07 Board Jobs."""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from sqlalchemy import update
from sqlmodel import col, select

from ketos.services.database.models.jobs.model import Job, JobStatus
from ketos.services.deps import session_scope
from ketos.services.jobs.board_claim import BOARD_JOB_METADATA_MAX_BYTES
from ketos.services.jobs.board_results import (
    BoardResultMetadataError,
    bound_board_execution_result,
    require_board_mvp,
    sanitize_board_detail,
)

if TYPE_CHECKING:
    from uuid import UUID

    from ketos.services.jobs.board_contracts import BoardExecutionReason, BoardExecutionResult

_TERMINAL_STATUSES = frozenset({JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.TIMED_OUT, JobStatus.CANCELLED})
_LEGAL_SOURCES = {
    JobStatus.COMPLETED: (JobStatus.IN_PROGRESS,),
    JobStatus.FAILED: (JobStatus.QUEUED, JobStatus.IN_PROGRESS),
    JobStatus.TIMED_OUT: (JobStatus.IN_PROGRESS,),
    JobStatus.CANCELLED: (JobStatus.QUEUED, JobStatus.IN_PROGRESS),
}
_OUTCOMES = {
    JobStatus.COMPLETED: "succeeded",
    JobStatus.FAILED: "failed",
    JobStatus.TIMED_OUT: "failed",
    JobStatus.CANCELLED: "cancelled",
}
_MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000


class TerminalJobConflict(RuntimeError):  # noqa: N818 - frozen public domain name
    """A finalization would violate the immutable terminal state machine."""


def _validate_terminal_contract(
    *,
    terminal_status: JobStatus,
    result: BoardExecutionResult | None,
    reason: BoardExecutionReason,
    duration_ms: int,
) -> None:
    if terminal_status not in _TERMINAL_STATUSES:
        msg = "terminal_status must be a terminal JobStatus"
        raise ValueError(msg)
    if isinstance(duration_ms, bool) or not isinstance(duration_ms, int) or not 0 <= duration_ms <= _MAX_DURATION_MS:
        msg = "duration_ms must be a bounded non-negative integer"
        raise ValueError(msg)
    if reason == "backend_restarted":
        msg = "backend_restarted is reserved for Stage 09"
        raise ValueError(msg)
    if terminal_status is JobStatus.COMPLETED:
        if reason is not None:
            msg = "completed Board Jobs cannot have a failure reason"
            raise ValueError(msg)
    elif result is not None:
        msg = "non-success terminal Board Jobs cannot persist a result"
        raise ValueError(msg)
    if terminal_status is JobStatus.FAILED and reason not in {"enqueue_failed", "execution_failed"}:
        msg = "failed Board Jobs require a bounded failure reason"
        raise ValueError(msg)
    if terminal_status is JobStatus.TIMED_OUT and reason != "timed_out":
        msg = "timed out Board Jobs require timed_out"
        raise ValueError(msg)
    if terminal_status is JobStatus.CANCELLED and reason not in {"user_cancelled", "system_cancelled"}:
        msg = "cancelled Board Jobs require a bounded cancellation reason"
        raise ValueError(msg)


def _terminal_metadata(
    job: Job,
    *,
    terminal_status: JobStatus,
    result: BoardExecutionResult | None,
    reason: BoardExecutionReason,
    detail: str | None,
    duration_ms: int,
) -> dict[str, Any]:
    try:
        current_mvp = require_board_mvp(job)
    except BoardResultMetadataError as exc:
        raise TerminalJobConflict(job.job_id) from exc
    mvp = deepcopy(current_mvp)
    persisted_result = bound_board_execution_result(result).model_dump(mode="json") if result is not None else None
    audit = mvp.get("audit") if isinstance(mvp.get("audit"), dict) else {}
    sequence = audit.get("sequence") if isinstance(audit.get("sequence"), int) else 1
    if job.status != terminal_status or job.status not in _TERMINAL_STATUSES:
        sequence += 1
    mvp.update(
        {
            "reason": reason,
            "detail": sanitize_board_detail(reason, detail),
            "result": persisted_result,
            "audit": {
                "request_id": str(job.job_id),
                "sequence": sequence,
                "duration_ms": duration_ms,
                "outcome": _OUTCOMES[terminal_status],
                "reason": reason,
                "flow_hash": mvp["flow_hash"],
            },
        }
    )
    metadata = {"mvp": mvp}
    encoded = json.dumps(metadata, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode(
        "utf-8"
    )
    if len(encoded) > BOARD_JOB_METADATA_MAX_BYTES:
        msg = "Final Board Job metadata exceeds 32768 UTF-8 bytes"
        raise ValueError(msg)
    return metadata


async def finalize_board_job(
    *,
    job_id: UUID,
    terminal_status: JobStatus,
    result: BoardExecutionResult | None,
    reason: BoardExecutionReason,
    detail: str | None,
    duration_ms: int,
) -> Job:
    """Finalize status, timestamp, bounded result and audit in one transaction."""
    _validate_terminal_contract(
        terminal_status=terminal_status,
        result=result,
        reason=reason,
        duration_ms=duration_ms,
    )
    async with session_scope() as session:
        initial = (
            await session.exec(select(Job).where(Job.job_id == job_id).execution_options(populate_existing=True))
        ).first()
        if initial is None:
            raise TerminalJobConflict(job_id)
        metadata = _terminal_metadata(
            initial,
            terminal_status=terminal_status,
            result=result,
            reason=reason,
            detail=detail,
            duration_ms=duration_ms,
        )
        finished = datetime.now(timezone.utc)
        update_result = await session.exec(
            update(Job)
            .where(Job.job_id == job_id, col(Job.status).in_(_LEGAL_SOURCES[terminal_status]))
            .values(
                status=terminal_status,
                finished_timestamp=finished,
                job_metadata=metadata,
            )
            .execution_options(synchronize_session=False)
        )
        if update_result.rowcount == 1:
            updated = (
                await session.exec(select(Job).where(Job.job_id == job_id).execution_options(populate_existing=True))
            ).first()
            if updated is None:  # pragma: no cover - defensive invariant
                raise TerminalJobConflict(job_id)
            return updated

        await session.rollback()
        existing = (
            await session.exec(select(Job).where(Job.job_id == job_id).execution_options(populate_existing=True))
        ).first()
        if (
            existing is not None
            and existing.status == terminal_status
            and existing.finished_timestamp is not None
            and existing.job_metadata == metadata
        ):
            return existing
        raise TerminalJobConflict(job_id)
