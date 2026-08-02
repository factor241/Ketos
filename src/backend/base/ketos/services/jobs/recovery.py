"""One-time restart reconciliation for Stage 07/09 Board Jobs."""

from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import update
from sqlmodel import select

from ketos.services.database.models.jobs.model import Job, JobStatus, JobType
from ketos.services.jobs.board_claim import (
    BOARD_JOB_KIND,
    BOARD_JOB_METADATA_MAX_BYTES,
    BOARD_JOB_SCHEMA_VERSION,
    build_board_request_fingerprint,
)
from ketos.services.jobs.board_results import BoardResultMetadataError, require_board_mvp, sanitize_board_detail

if TYPE_CHECKING:
    from sqlmodel.ext.asyncio.session import AsyncSession

_ACTIVE = frozenset((JobStatus.QUEUED, JobStatus.IN_PROGRESS))
_FULL_KEYS = frozenset(
    {
        "schema_version",
        "kind",
        "board_id",
        "flow_id",
        "flow_hash",
        "request_fingerprint",
        "policy_version",
        "origin_pid",
        "worker_instance_id",
        "reason",
        "detail",
        "result",
        "audit",
    }
)
_LEGACY_KEYS = _FULL_KEYS - {"origin_pid", "worker_instance_id"}


@dataclass(frozen=True, slots=True)
class JobRecoverySummary:
    scanned: int
    recovered_ids: tuple[UUID, ...]
    untouched: int
    reason: str = "backend_restarted"


def _strict_legacy_mvp(job: Job) -> dict[str, Any] | None:
    metadata = job.job_metadata
    mvp = metadata.get("mvp") if isinstance(metadata, dict) and set(metadata) == {"mvp"} else None
    if not isinstance(mvp, dict) or frozenset(mvp) != _LEGACY_KEYS:
        return None
    if mvp.get("schema_version") != 1 or mvp.get("kind") != BOARD_JOB_KIND:
        return None
    try:
        board_id = UUID(str(mvp["board_id"]))
        flow_id = UUID(str(mvp["flow_id"]))
        if (
            job.type != JobType.WORKFLOW
            or job.user_id is None
            or flow_id != job.flow_id
            or mvp.get("flow_hash") is None
            or mvp.get("request_fingerprint")
            != build_board_request_fingerprint(
                actor_id=job.user_id,
                board_id=board_id,
                flow_id=flow_id,
                flow_hash=mvp["flow_hash"],
                schema_version=1,
            )
            or isinstance(mvp.get("policy_version"), bool)
            or not isinstance(mvp.get("policy_version"), int)
            or mvp["policy_version"] <= 0
            or mvp.get("reason") is not None
            or mvp.get("detail") is not None
            or mvp.get("result") is not None
        ):
            return None
        audit = mvp.get("audit")
        if (
            not isinstance(audit, dict)
            or set(audit) != {"request_id", "sequence", "duration_ms", "outcome"}
            or UUID(str(audit.get("request_id"))) != job.job_id
            or isinstance(audit.get("sequence"), bool)
            or not isinstance(audit.get("sequence"), int)
            or audit["sequence"] <= 0
            or (
                audit.get("duration_ms") is not None
                and (
                    isinstance(audit.get("duration_ms"), bool)
                    or not isinstance(audit.get("duration_ms"), int)
                    or audit["duration_ms"] < 0
                )
            )
            or audit.get("outcome") not in {"queued", "running"}
        ):
            return None
    except (KeyError, TypeError, ValueError):
        return None
    return mvp


def _valid_full_mvp(job: Job) -> dict[str, Any] | None:
    try:
        return require_board_mvp(job)
    except BoardResultMetadataError:
        return None


def _is_current_worker(mvp: dict[str, Any], *, worker_id: UUID, pid: int) -> bool:
    return mvp.get("origin_pid") == pid and mvp.get("worker_instance_id") == str(worker_id)


def _terminal_metadata(
    job: Job,
    *,
    mvp: dict[str, Any],
    legacy: bool,
) -> dict[str, Any]:
    result = deepcopy(mvp)
    result["schema_version"] = BOARD_JOB_SCHEMA_VERSION
    if legacy:
        result.pop("origin_pid", None)
        result.pop("worker_instance_id", None)
    board_id = UUID(str(result["board_id"]))
    result["request_fingerprint"] = build_board_request_fingerprint(
        actor_id=job.user_id,
        board_id=board_id,
        flow_id=job.flow_id,
        flow_hash=result["flow_hash"],
        schema_version=BOARD_JOB_SCHEMA_VERSION,
    )
    audit = result["audit"]
    sequence = audit["sequence"] if isinstance(audit.get("sequence"), int) else 1
    result.update(
        {
            "reason": "backend_restarted",
            "detail": sanitize_board_detail("backend_restarted", None),
            "result": None,
            "audit": {
                "request_id": str(job.job_id),
                "sequence": sequence + 1,
                "duration_ms": 0,
                "outcome": "failed",
                "reason": "backend_restarted",
                "flow_hash": result["flow_hash"],
            },
        }
    )
    metadata = {"mvp": result}
    encoded = json.dumps(metadata, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode(
        "utf-8"
    )
    if len(encoded) > BOARD_JOB_METADATA_MAX_BYTES:
        msg = "Board Job recovery metadata exceeds the persisted size limit"
        raise ValueError(msg)
    return metadata


async def reconcile_board_jobs_after_restart(
    *,
    session: AsyncSession,
    current_worker_instance_id: UUID,
    current_pid: int,
) -> JobRecoverySummary:
    """Conditionally terminalize only proven prior-worker or strict legacy Jobs."""
    if not isinstance(current_worker_instance_id, UUID):
        msg = "current_worker_instance_id must be a UUID"
        raise TypeError(msg)
    if isinstance(current_pid, bool) or not isinstance(current_pid, int) or current_pid <= 0:
        msg = "current_pid must be a positive integer"
        raise ValueError(msg)
    candidates = list(
        (
            await session.exec(
                select(Job)
                .where(Job.type == JobType.WORKFLOW, Job.status.in_(_ACTIVE))
                .order_by(Job.created_timestamp.asc(), Job.job_id.asc())
                .limit(100)
            )
        ).all()
    )
    recovered: list[UUID] = []
    for job in candidates:
        observed_status = job.status
        observed_metadata = deepcopy(job.job_metadata)
        mvp = _valid_full_mvp(job)
        legacy = False
        if mvp is None:
            mvp = _strict_legacy_mvp(job)
            legacy = mvp is not None
        if mvp is None or (
            not legacy and _is_current_worker(mvp, worker_id=current_worker_instance_id, pid=current_pid)
        ):
            continue
        replacement = _terminal_metadata(
            job,
            mvp=mvp,
            legacy=legacy,
        )
        changed = await session.exec(
            update(Job)
            .where(
                Job.job_id == job.job_id,
                Job.type == JobType.WORKFLOW,
                Job.status == observed_status,
                Job.job_metadata == observed_metadata,
            )
            .values(
                status=JobStatus.FAILED,
                finished_timestamp=datetime.now(timezone.utc),
                job_metadata=replacement,
            )
            .execution_options(synchronize_session=False)
        )
        if changed.rowcount == 1:
            recovered.append(job.job_id)
    if recovered:
        await session.commit()
    return JobRecoverySummary(
        scanned=len(candidates),
        recovered_ids=tuple(recovered),
        untouched=len(candidates) - len(recovered),
    )


__all__ = ["JobRecoverySummary", "reconcile_board_jobs_after_restart"]
