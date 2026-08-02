from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CanonicalizationError(ValueError):
    """Raised when a value cannot be represented by the Stage-08 contract."""


class ProposalHashMaterial(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = Field(default=1, alias="schemaVersion")
    source_kind: str
    chat_run_id: UUID
    thread_id: str
    interrupt_id: str | None
    interrupt_bound: bool
    source_proposal_id: UUID | None
    sequence: int
    actor_id: UUID
    project_id: UUID
    flow_id: UUID
    command_type: str
    canonical_payload: dict[str, Any]
    base_flow_revision: int | None
    base_flow_hash: str | None
    result_flow_hash: str
    redacted_preview_summary: dict[str, Any]


def _canonical_value(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return _canonical_value(value.model_dump(mode="python", by_alias=True))
    if isinstance(value, Enum):
        return _canonical_value(value.value)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() is None:
            message = "canonical datetime must include a timezone"
            raise CanonicalizationError(message)
        normalized = value.astimezone(timezone.utc).isoformat(timespec="microseconds")
        return normalized.replace("+00:00", "Z")
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            message = "canonical numbers must be finite"
            raise CanonicalizationError(message)
        return value
    if isinstance(value, (list, tuple)):
        return [_canonical_value(item) for item in value]
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            message = "canonical object keys must be strings"
            raise CanonicalizationError(message)
        return {key: _canonical_value(item) for key, item in value.items()}
    message = f"unsupported canonical value type: {type(value).__name__}"
    raise CanonicalizationError(message)


def canonical_json_bytes(value: Any) -> bytes:
    """Return exact Stage-08 UTF-8 JSON bytes without lossy filtering."""
    try:
        encoded = json.dumps(
            _canonical_value(value),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        if isinstance(exc, CanonicalizationError):
            raise
        message = "value is not canonical JSON"
        raise CanonicalizationError(message) from exc
    return encoded.encode("utf-8")


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def _flow_field(flow: Any, field: str, default: Any = None) -> Any:
    if isinstance(flow, dict):
        return flow.get(field, default)
    return getattr(flow, field, default)


def flow_content_projection(flow: Any) -> dict[str, Any]:
    return {
        "name": _flow_field(flow, "name"),
        "description": _flow_field(flow, "description"),
        "data": _flow_field(flow, "data"),
    }


def flow_content_hash(flow: Any) -> str:
    """Hash exact persisted content relevant to pending proposals."""
    return canonical_sha256(flow_content_projection(flow))


def proposal_hash(material: ProposalHashMaterial) -> str:
    """Hash server-owned proposal, correlation, phase, target and preview data."""
    if (material.interrupt_id is None) != (not material.interrupt_bound):
        message = "interrupt_id and interrupt_bound phase are inconsistent"
        raise ValueError(message)
    return canonical_sha256(material)
