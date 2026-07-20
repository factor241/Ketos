"""Bounded result sanitization and public Board execution projection."""

from __future__ import annotations

import json
import math
import re
from heapq import nsmallest
from itertools import chain
from typing import TYPE_CHECKING, Any
from uuid import UUID

from pydantic import BaseModel

from ketos.services.database.models.jobs.model import JobStatus, JobType
from ketos.services.jobs.board_claim import (
    BOARD_JOB_KIND,
    BOARD_JOB_SCHEMA_VERSION,
    build_board_request_fingerprint,
)
from ketos.services.jobs.board_contracts import BoardExecutionRead, BoardExecutionResult

if TYPE_CHECKING:
    from collections.abc import Sequence

    from kfx.graph.schema import RunOutputs

    from ketos.services.database.models.jobs.model import Job

MAX_RESULT_DEPTH = 8
MAX_RESULT_KEYS = 100
MAX_RESULT_ITEMS = 100
MAX_RESULT_STRING_CODEPOINTS = 8192
MAX_RESULT_BYTES = 24 * 1024
MAX_DETAIL_BYTES = 2048
_SECRET_KEYS = {
    "authorization",
    "cookie",
    "password",
    "secret",
    "token",
    "api_key",
    "apikey",
    "credential",
    "private_key",
}
_DETAILS = {
    "enqueue_failed": "Flow execution could not be queued.",
    "execution_failed": "Flow execution failed.",
    "timed_out": "Flow execution timed out.",
    "user_cancelled": "Flow execution was cancelled by the user.",
    "system_cancelled": "Flow execution was cancelled by the system.",
    "backend_restarted": "Backend was restarted.",
}
_FAILURE_REASONS = frozenset({"enqueue_failed", "execution_failed", "backend_restarted"})
_CANCEL_REASONS = frozenset({"user_cancelled", "system_cancelled"})
_ALL_REASONS = frozenset({*_FAILURE_REASONS, *_CANCEL_REASONS, "timed_out"})
_MVP_KEYS = frozenset(
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
_CLAIM_AUDIT_KEYS = frozenset({"request_id", "sequence", "duration_ms", "outcome"})
_TERMINAL_AUDIT_KEYS = frozenset({*_CLAIM_AUDIT_KEYS, "reason", "flow_hash"})
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class BoardResultMetadataError(ValueError):
    """A Job does not contain a readable Stage 07 Board claim envelope."""


def _normalized_key(key: str) -> str:
    separated = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", "_", key)
    separated = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", separated)
    return separated.casefold().replace("-", "_")


def _is_secret_key(key: str) -> bool:
    normalized = _normalized_key(key)
    if normalized in _SECRET_KEYS or "api_key" in normalized:
        return True
    segments = frozenset(normalized.split("_"))
    return bool(segments & {"authorization", "cookie", "password", "secret", "token", "apikey", "credential"})


def _omitted(reason: str) -> dict[str, object]:
    return {"omitted": True, "reason": reason}


def _sanitize_mapping(
    items: object,
    *,
    total_count: int,
    depth: int,
    max_depth: int,
    max_keys: int,
    max_items: int,
    max_string: int,
) -> tuple[dict[str, object], bool]:
    selected = nsmallest(max_keys, items, key=lambda item: item[0])
    truncated = len(selected) != total_count
    result: dict[str, object] = {}
    for key, item in selected:
        if _is_secret_key(key):
            result[key] = "[REDACTED]"
            truncated = truncated or item != "[REDACTED]"
            continue
        sanitized, child_truncated = _sanitize(
            item,
            depth=depth + 1,
            max_depth=max_depth,
            max_keys=max_keys,
            max_items=max_items,
            max_string=max_string,
        )
        result[key] = sanitized
        truncated = truncated or child_truncated
    return result, truncated


def _sanitize(
    value: object,
    *,
    depth: int,
    max_depth: int,
    max_keys: int,
    max_items: int,
    max_string: int,
) -> tuple[object, bool]:
    if depth >= max_depth and isinstance(value, (BaseModel, dict, list, tuple)):
        return _omitted("max_depth"), True
    if isinstance(value, BaseModel):
        field_names = tuple(name for name in type(value).model_fields if name in value.__dict__)
        extras = value.__pydantic_extra__ if isinstance(value.__pydantic_extra__, dict) else {}
        return _sanitize_mapping(
            chain(((name, value.__dict__[name]) for name in field_names), extras.items()),
            total_count=len(field_names) + len(extras),
            depth=depth,
            max_depth=max_depth,
            max_keys=max_keys,
            max_items=max_items,
            max_string=max_string,
        )
    if value is None or isinstance(value, (bool, int)):
        return value, False
    if isinstance(value, float):
        if math.isfinite(value):
            return value, False
        return _omitted("unsupported_type"), True
    if isinstance(value, str):
        if len(value) <= max_string:
            return value, False
        return value[:max_string], True
    if isinstance(value, dict):
        return _sanitize_mapping(
            ((key, item) for key, item in value.items() if isinstance(key, str)),
            total_count=len(value),
            depth=depth,
            max_depth=max_depth,
            max_keys=max_keys,
            max_items=max_items,
            max_string=max_string,
        )
    if isinstance(value, (list, tuple)):
        truncated = len(value) > max_items
        result = []
        for item in value[:max_items]:
            sanitized, child_truncated = _sanitize(
                item,
                depth=depth + 1,
                max_depth=max_depth,
                max_keys=max_keys,
                max_items=max_items,
                max_string=max_string,
            )
            result.append(sanitized)
            truncated = truncated or child_truncated
        return result, truncated
    return _omitted("unsupported_type"), True


def sanitize_board_value(
    value: object,
    *,
    max_depth: int = MAX_RESULT_DEPTH,
    max_keys: int = MAX_RESULT_KEYS,
    max_items: int = MAX_RESULT_ITEMS,
    max_string: int = MAX_RESULT_STRING_CODEPOINTS,
) -> tuple[Any, bool]:
    """Convert an arbitrary known projection into bounded JSON-compatible data."""
    return _sanitize(
        value,
        depth=0,
        max_depth=max_depth,
        max_keys=max_keys,
        max_items=max_items,
        max_string=max_string,
    )


def _result_bytes(result: BoardExecutionResult) -> bytes:
    return json.dumps(
        result.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def _bounded_result(value: object, *, kind: str, max_bytes: int) -> BoardExecutionResult:
    limits = (
        (8192, 100, 100),
        (4096, 50, 50),
        (2048, 25, 25),
        (1024, 12, 12),
        (512, 8, 8),
        (128, 5, 5),
        (32, 3, 3),
    )
    working_value = value
    was_truncated = False
    for index, (max_string, max_keys, max_items) in enumerate(limits):
        sanitized, truncated = sanitize_board_value(
            working_value,
            max_string=max_string,
            max_keys=max_keys,
            max_items=max_items,
        )
        was_truncated = was_truncated or truncated or index > 0
        candidate = BoardExecutionResult(kind=kind, value=sanitized, truncated=was_truncated)
        if len(_result_bytes(candidate)) <= max_bytes:
            return candidate
        working_value = sanitized
    fallback = BoardExecutionResult(
        kind="json",
        value=_omitted("result_too_large"),
        truncated=True,
    )
    if len(_result_bytes(fallback)) > max_bytes:
        msg = "max_bytes is too small for the bounded result contract"
        raise ValueError(msg)
    return fallback


def bound_board_execution_result(
    result: BoardExecutionResult,
    *,
    max_bytes: int = MAX_RESULT_BYTES,
) -> BoardExecutionResult:
    """Re-sanitize a caller-provided result before persistence."""
    return _bounded_result(result.value, kind=result.kind, max_bytes=max_bytes)


def _terminal_value(run_outputs: Sequence[RunOutputs], terminal_node_ids: Sequence[str]) -> object | None:
    for terminal_id in terminal_node_ids:
        for run_output in run_outputs:
            for output in run_output.outputs:
                if output is None or output.component_id != terminal_id:
                    continue
                if output.messages:
                    return output.messages[0].message
                return output.results
    return None


def sanitize_board_result(
    run_outputs: Sequence[RunOutputs],
    *,
    terminal_node_ids: Sequence[str],
    max_bytes: int = MAX_RESULT_BYTES,
) -> BoardExecutionResult | None:
    """Select the first terminal projection and sanitize it deterministically."""
    value = _terminal_value(run_outputs, terminal_node_ids)
    if value is None:
        return None
    return _bounded_result(value, kind="text" if isinstance(value, str) else "json", max_bytes=max_bytes)


def sanitize_board_detail(reason: str | None, _detail: str | None) -> str | None:
    """Map a reason code to a non-secret bounded summary; raw detail is ignored."""
    if reason is None:
        return None
    detail = _DETAILS.get(reason, _DETAILS["execution_failed"])
    while len(detail.encode("utf-8")) > MAX_DETAIL_BYTES:
        detail = detail[:-1]
    return detail


def require_board_mvp(job: Job) -> dict[str, Any]:
    if job.type != JobType.WORKFLOW or job.user_id is None or job.flow_id is None:
        raise BoardResultMetadataError(job.job_id)
    metadata = job.job_metadata
    mvp = metadata.get("mvp") if isinstance(metadata, dict) else None
    if not isinstance(metadata, dict) or set(metadata) != {"mvp"}:
        raise BoardResultMetadataError(job.job_id)
    if not isinstance(mvp, dict) or set(mvp) != _MVP_KEYS:
        raise BoardResultMetadataError(job.job_id)
    if mvp.get("schema_version") != BOARD_JOB_SCHEMA_VERSION or mvp.get("kind") != BOARD_JOB_KIND:
        raise BoardResultMetadataError(job.job_id)
    try:
        board_id = UUID(str(mvp["board_id"]))
        flow_id = UUID(str(mvp["flow_id"]))
        UUID(str(mvp["worker_instance_id"]))
    except (TypeError, ValueError) as exc:
        raise BoardResultMetadataError(job.job_id) from exc
    flow_hash = mvp.get("flow_hash")
    if not isinstance(flow_hash, str) or _SHA256_PATTERN.fullmatch(flow_hash) is None:
        raise BoardResultMetadataError(job.job_id)
    request_fingerprint = mvp.get("request_fingerprint")
    if not isinstance(request_fingerprint, str) or _SHA256_PATTERN.fullmatch(request_fingerprint) is None:
        raise BoardResultMetadataError(job.job_id)
    if flow_id != job.flow_id:
        raise BoardResultMetadataError(job.job_id)
    expected_fingerprint = build_board_request_fingerprint(
        actor_id=job.user_id,
        board_id=board_id,
        flow_id=flow_id,
        flow_hash=flow_hash,
    )
    if request_fingerprint != expected_fingerprint:
        raise BoardResultMetadataError(job.job_id)
    policy_version = mvp.get("policy_version")
    if isinstance(policy_version, bool) or not isinstance(policy_version, int) or policy_version <= 0:
        raise BoardResultMetadataError(job.job_id)
    origin_pid = mvp.get("origin_pid")
    if isinstance(origin_pid, bool) or not isinstance(origin_pid, int) or origin_pid <= 0:
        raise BoardResultMetadataError(job.job_id)
    reason = mvp.get("reason")
    if reason is not None and (not isinstance(reason, str) or reason not in _ALL_REASONS):
        raise BoardResultMetadataError(job.job_id)
    detail = mvp.get("detail")
    if detail is not None:
        if not isinstance(detail, str):
            raise BoardResultMetadataError(job.job_id)
        try:
            detail_size = len(detail.encode("utf-8"))
        except UnicodeEncodeError as exc:
            raise BoardResultMetadataError(job.job_id) from exc
        if detail_size > MAX_DETAIL_BYTES:
            raise BoardResultMetadataError(job.job_id)
    result = mvp.get("result")
    if result is not None:
        if not isinstance(result, dict):
            raise BoardResultMetadataError(job.job_id)
        try:
            validated_result = BoardExecutionResult.model_validate(result)
        except ValueError as exc:
            raise BoardResultMetadataError(job.job_id) from exc
        if len(_result_bytes(validated_result)) > MAX_RESULT_BYTES:
            raise BoardResultMetadataError(job.job_id)
    audit = mvp.get("audit")
    if not isinstance(audit, dict) or frozenset(audit) not in {_CLAIM_AUDIT_KEYS, _TERMINAL_AUDIT_KEYS}:
        raise BoardResultMetadataError(job.job_id)
    try:
        if UUID(str(audit["request_id"])) != job.job_id:
            raise BoardResultMetadataError(job.job_id)
    except (TypeError, ValueError) as exc:
        raise BoardResultMetadataError(job.job_id) from exc
    sequence = audit.get("sequence")
    if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence <= 0:
        raise BoardResultMetadataError(job.job_id)
    duration_ms = audit.get("duration_ms")
    if duration_ms is not None and (
        isinstance(duration_ms, bool) or not isinstance(duration_ms, int) or duration_ms < 0
    ):
        raise BoardResultMetadataError(job.job_id)
    if audit.get("outcome") not in {"queued", "running", "succeeded", "failed", "cancelled"}:
        raise BoardResultMetadataError(job.job_id)
    if frozenset(audit) == _TERMINAL_AUDIT_KEYS and (
        audit.get("reason") != mvp.get("reason") or audit.get("flow_hash") != mvp.get("flow_hash")
    ):
        raise BoardResultMetadataError(job.job_id)
    return mvp


def board_execution_from_job(job: Job) -> BoardExecutionRead:
    """Project one valid Board Job without exposing internal metadata."""
    mvp = require_board_mvp(job)
    status_map = {
        JobStatus.QUEUED: "queued",
        JobStatus.IN_PROGRESS: "running",
        JobStatus.COMPLETED: "succeeded",
        JobStatus.FAILED: "failed",
        JobStatus.TIMED_OUT: "failed",
        JobStatus.CANCELLED: "cancelled",
    }
    public_status = status_map[job.status]
    reason = None
    if job.status is JobStatus.FAILED:
        reason = mvp.get("reason") if mvp.get("reason") in _FAILURE_REASONS else "execution_failed"
    elif job.status is JobStatus.TIMED_OUT:
        reason = "timed_out"
    elif job.status is JobStatus.CANCELLED:
        reason = mvp.get("reason") if mvp.get("reason") in _CANCEL_REASONS else "system_cancelled"
    result = None
    if job.status is JobStatus.COMPLETED and isinstance(mvp.get("result"), dict):
        result = BoardExecutionResult.model_validate(mvp["result"])
    return BoardExecutionRead(
        job_id=job.job_id,
        board_id=UUID(str(mvp["board_id"])),
        flow_id=job.flow_id,
        status=public_status,
        reason=reason,
        created_timestamp=job.created_timestamp,
        finished_timestamp=job.finished_timestamp,
        result=result,
    )
