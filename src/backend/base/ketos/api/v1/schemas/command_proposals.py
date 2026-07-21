from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import AliasGenerator, BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class RestoreCommandProposalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    idempotency_key: str = Field(min_length=1, max_length=128)
    expected_flow_revision: int = Field(ge=0)


class CommandProposalRead(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        alias_generator=AliasGenerator(serialization_alias=to_camel),
        serialize_by_alias=True,
    )

    id: UUID
    source_kind: str
    source_proposal_id: UUID | None
    flow_id: UUID
    status: str
    pinned_flow_version_id: UUID | None
    outcome: dict[str, Any] | None
