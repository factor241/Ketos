"""Deterministic, atomic Job claim for Board workflow execution."""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid5

from sqlalchemy.exc import IntegrityError
from sqlmodel import select

if TYPE_CHECKING:
    from collections.abc import Callable

from ketos.services.database.models.jobs.model import Job, JobStatus, JobType
from ketos.services.deps import session_scope
from ketos.services.jobs.board_contracts import BoardAutomationRunRequest
from ketos.services.jobs.worker_identity import get_worker_instance_id

BOARD_JOB_NAMESPACE = UUID("7a2d1c1e-7f9b-5bd6-9fd9-4f80243c3c55")
BOARD_JOB_SCHEMA_VERSION = 1
BOARD_JOB_KIND = "board_automation_run"
BOARD_JOB_METADATA_MAX_BYTES = 32 * 1024
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class BoardJobConflict(RuntimeError):  # noqa: N818 - frozen Stage 07 contract name
    """A deterministic Job ID exists with incompatible claim metadata."""


class BoardJobResourceNotFoundError(RuntimeError):
    """A collision is absent from the exact-owner Board security scope."""


@dataclass(frozen=True)
class BoardJobClaim:
    """Result of an atomic insert attempt."""

    job: Job
    claimed: bool


def derive_board_job_id(
    *,
    actor_id: UUID,
    board_id: UUID,
    flow_id: UUID,
    idempotency_key: str,
) -> UUID:
    """Derive the frozen UUIDv5 identity for one logical browser intent."""
    validated_key = BoardAutomationRunRequest(idempotency_key=idempotency_key).idempotency_key
    canonical = f"ketos.board-job.v1:{actor_id}:{board_id}:{flow_id}:{validated_key}"
    return uuid5(BOARD_JOB_NAMESPACE, canonical)


def canonical_graph_payload(executable_graph_payload: Any) -> tuple[str, str]:
    """Return canonical executable JSON and its SHA-256 hash."""
    payload_json = json.dumps(
        executable_graph_payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )
    return payload_json, hashlib.sha256(payload_json.encode("utf-8")).hexdigest()


def build_board_request_fingerprint(
    *,
    actor_id: UUID,
    board_id: UUID,
    flow_id: UUID,
    flow_hash: str,
) -> str:
    """Hash the frozen, non-secret Board request identity shape."""
    _validate_flow_hash(flow_hash)
    canonical = json.dumps(
        {
            "schema_version": BOARD_JOB_SCHEMA_VERSION,
            "actor_id": str(actor_id),
            "board_id": str(board_id),
            "flow_id": str(flow_id),
            "flow_hash": flow_hash,
            "run_mode": "board_default_inputs",
        },
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _validate_flow_hash(flow_hash: str) -> None:
    if _SHA256_PATTERN.fullmatch(flow_hash) is None:
        msg = "flow_hash must be a lowercase SHA-256 digest"
        raise ValueError(msg)


def _hashed_idempotency_marker(idempotency_key: str) -> str:
    """Return a comparison marker, not a confidentiality primitive.

    The browser contract generates a high-entropy ``crypto.randomUUID`` token.
    This digest prevents raw-token persistence and detects forced UUIDv5
    collisions; the token is not an authorization credential.
    """
    value = f"ketos.board-job-key.v1:{idempotency_key}".encode()
    return hashlib.sha256(value).hexdigest()


def _claim_metadata(
    *,
    job_id: UUID,
    board_id: UUID,
    flow_id: UUID,
    flow_hash: str,
    request_fingerprint: str,
    policy_version: int,
    origin_pid: int,
    worker_instance_id: UUID,
) -> dict[str, Any]:
    mvp = {
        "schema_version": BOARD_JOB_SCHEMA_VERSION,
        "kind": BOARD_JOB_KIND,
        "board_id": str(board_id),
        "flow_id": str(flow_id),
        "flow_hash": flow_hash,
        "request_fingerprint": request_fingerprint,
        "policy_version": policy_version,
        "origin_pid": origin_pid,
        "worker_instance_id": str(worker_instance_id),
        "reason": None,
        "detail": None,
        "result": None,
        "audit": {
            "request_id": str(job_id),
            "sequence": 1,
            "duration_ms": None,
            "outcome": "queued",
        },
    }
    encoded_size = len(json.dumps({"mvp": mvp}, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    if encoded_size > BOARD_JOB_METADATA_MAX_BYTES:
        msg = "Board Job claim metadata exceeds the persisted size limit"
        raise ValueError(msg)
    return {"mvp": mvp}


def _is_compatible_replay(
    job: Job,
    *,
    board_id: UUID,
    flow_id: UUID,
    flow_hash: str,
    request_fingerprint: str,
    policy_version: int,
    idempotency_marker: str,
) -> bool:
    """Validate immutable claim identity without adopting the current worker.

    Persisted process fields are required recovery evidence, but they are not
    request-fingerprint inputs and must never be compared with the replaying
    process or rewritten during transport replay.
    """
    if job.type != JobType.WORKFLOW or job.flow_id != flow_id or job.dedupe_key != idempotency_marker:
        return False
    metadata = job.job_metadata
    if not isinstance(metadata, dict):
        return False
    mvp = metadata.get("mvp")
    if not isinstance(mvp, dict):
        return False
    return (
        mvp.get("schema_version") == BOARD_JOB_SCHEMA_VERSION
        and mvp.get("kind") == BOARD_JOB_KIND
        and mvp.get("board_id") == str(board_id)
        and mvp.get("flow_id") == str(flow_id)
        and mvp.get("flow_hash") == flow_hash
        and mvp.get("request_fingerprint") == request_fingerprint
        and mvp.get("policy_version") == policy_version
        and isinstance(mvp.get("origin_pid"), int)
        and mvp["origin_pid"] > 0
        and _is_uuid_string(mvp.get("worker_instance_id"))
    )


def _is_uuid_string(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        UUID(value)
    except ValueError:
        return False
    return True


async def claim_board_job(
    *,
    actor_id: UUID,
    board_id: UUID,
    flow_id: UUID,
    idempotency_key: str,
    flow_hash: str,
    policy_version: int,
    worker_instance_id_provider: Callable[[], UUID] = get_worker_instance_id,
) -> BoardJobClaim:
    """Atomically claim one deterministic Board workflow Job.

    The first transaction performs a direct insert. A primary-key collision is
    rolled back and resolved through an exact-owner lookup in a fresh session.
    """
    validated_key = BoardAutomationRunRequest(idempotency_key=idempotency_key).idempotency_key
    _validate_flow_hash(flow_hash)
    if isinstance(policy_version, bool) or not isinstance(policy_version, int) or policy_version <= 0:
        msg = "policy_version must be a positive integer"
        raise ValueError(msg)
    origin_pid = os.getpid()
    if origin_pid <= 0:
        msg = "origin_pid must be positive"
        raise RuntimeError(msg)
    worker_instance_id = worker_instance_id_provider()
    if not isinstance(worker_instance_id, UUID):
        msg = "worker_instance_id provider must return UUID"
        raise TypeError(msg)

    job_id = derive_board_job_id(
        actor_id=actor_id,
        board_id=board_id,
        flow_id=flow_id,
        idempotency_key=validated_key,
    )
    request_fingerprint = build_board_request_fingerprint(
        actor_id=actor_id,
        board_id=board_id,
        flow_id=flow_id,
        flow_hash=flow_hash,
    )
    idempotency_marker = _hashed_idempotency_marker(validated_key)
    job = Job(
        job_id=job_id,
        flow_id=flow_id,
        user_id=actor_id,
        type=JobType.WORKFLOW,
        status=JobStatus.QUEUED,
        dedupe_key=idempotency_marker,
        job_metadata=_claim_metadata(
            job_id=job_id,
            board_id=board_id,
            flow_id=flow_id,
            flow_hash=flow_hash,
            request_fingerprint=request_fingerprint,
            policy_version=policy_version,
            origin_pid=origin_pid,
            worker_instance_id=worker_instance_id,
        ),
    )

    insert_error: IntegrityError | None = None
    async with session_scope() as insert_session:
        insert_session.add(job)
        try:
            await insert_session.commit()
        except IntegrityError as exc:
            insert_error = exc
            await insert_session.rollback()
        else:
            await insert_session.refresh(job)
            return BoardJobClaim(job=job, claimed=True)

    async with session_scope() as replay_session:
        result = await replay_session.exec(
            select(Job).where(Job.job_id == job_id, Job.user_id == actor_id).execution_options(populate_existing=True)
        )
        existing = result.first()
        if existing is None:
            collision = (
                await replay_session.exec(
                    select(Job).where(Job.job_id == job_id).execution_options(populate_existing=True)
                )
            ).first()
            if collision is not None:
                raise BoardJobResourceNotFoundError(job_id)
            if insert_error is None:  # pragma: no cover - defensive invariant
                msg = "Board Job replay path requires an insert error"
                raise RuntimeError(msg)
            raise insert_error
        if not _is_compatible_replay(
            existing,
            board_id=board_id,
            flow_id=flow_id,
            flow_hash=flow_hash,
            request_fingerprint=request_fingerprint,
            policy_version=policy_version,
            idempotency_marker=idempotency_marker,
        ):
            raise BoardJobConflict(job_id)
        return BoardJobClaim(job=existing, claimed=False)
