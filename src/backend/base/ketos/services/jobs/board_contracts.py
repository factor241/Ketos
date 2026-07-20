"""Frozen public contracts for Stage 07 Board workflow execution."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, TypeAlias
from uuid import UUID

from pydantic import BaseModel, ConfigDict, JsonValue, StringConstraints, model_validator

BoardExecutionStatus: TypeAlias = Literal["queued", "running", "succeeded", "failed", "cancelled"]
BoardExecutionReason: TypeAlias = (
    Literal[
        "enqueue_failed",
        "execution_failed",
        "timed_out",
        "user_cancelled",
        "system_cancelled",
        "backend_restarted",
    ]
    | None
)


class BoardAutomationRunRequest(BaseModel):
    """The only browser-controlled field accepted by the Board run route.

    The frontend creates a high-entropy ``crypto.randomUUID`` intent token. It
    is an idempotency identifier, not an authorization credential or secret.
    """

    idempotency_key: Annotated[
        str,
        StringConstraints(pattern=r"^[A-Za-z0-9._:-]{1,128}$"),
    ]

    model_config = ConfigDict(extra="forbid")


class BoardExecutionResult(BaseModel):
    """A bounded result shape suitable for the narrow Board renderer."""

    kind: Literal["text", "json"]
    value: str | JsonValue
    truncated: bool = False

    @model_validator(mode="after")
    def validate_kind_value_coherence(self) -> BoardExecutionResult:
        """Keep the narrow text renderer limited to inert string values."""
        if self.kind == "text" and not isinstance(self.value, str):
            msg = "text Board execution results require a string value"
            raise ValueError(msg)
        return self


class BoardExecutionRead(BaseModel):
    """Stable server projection for one Board workflow execution."""

    job_id: UUID
    board_id: UUID
    flow_id: UUID
    status: BoardExecutionStatus
    reason: BoardExecutionReason = None
    created_timestamp: datetime
    finished_timestamp: datetime | None
    result: BoardExecutionResult | None
