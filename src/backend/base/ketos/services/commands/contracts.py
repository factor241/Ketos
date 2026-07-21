from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from ketos.services.database.models.command_proposal.model import (
    CommandProposalCommandType,
    CommandProposalSourceKind,
)


class CommandProposalSpec(BaseModel):
    """Server-owned input for one durable, pre-interrupt proposal."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    actor_id: UUID
    project_id: UUID
    source_kind: CommandProposalSourceKind
    chat_run_id: UUID
    thread_id: str = Field(min_length=1, max_length=36)
    source_proposal_id: UUID | None
    flow_id: UUID
    command_type: CommandProposalCommandType
    canonical_payload: dict[str, Any]
    preview: dict[str, Any]
    base_flow_revision: int | None = Field(default=None, ge=0)
    base_flow_hash: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    result_flow_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    idempotency_key: str = Field(min_length=1, max_length=128)
    request_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    request_id: str = Field(min_length=1, max_length=128)
    redacted_audit: dict[str, Any]
