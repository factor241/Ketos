from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import ConfigDict, model_validator
from sqlmodel import Field, SQLModel

from ketos.api.v1.schemas.board_entities import PlacementGeometryCreate, PlacementRead
from ketos.services.database.models.chat_thread.model import ChatContextPolicy

_EMPTY_PATCH_ERROR = "chat patch must change at least one field"


class ChatCreate(SQLModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=120)
    provider: str = Field(min_length=1, max_length=128)
    model_name: str = Field(min_length=1, max_length=256)
    context_policy: ChatContextPolicy


class BoardChatCreate(SQLModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=120)
    provider: str = Field(min_length=1, max_length=128)
    model_name: str = Field(min_length=1, max_length=256)
    placement: PlacementGeometryCreate


class ChatPatch(SQLModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=0)
    title: str | None = Field(default=None, min_length=1, max_length=120)
    provider: str | None = Field(default=None, min_length=1, max_length=128)
    model_name: str | None = Field(default=None, min_length=1, max_length=256)
    context_policy: ChatContextPolicy | None = None
    archived: bool | None = None

    @model_validator(mode="after")
    def require_change(self) -> ChatPatch:
        if all(
            value is None for value in (self.title, self.provider, self.model_name, self.context_policy, self.archived)
        ):
            raise ValueError(_EMPTY_PATCH_ERROR)
        return self


class ChatRead(SQLModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    created_by_id: UUID
    title: str
    provider: str
    model_name: str
    context_policy: ChatContextPolicy
    archived: bool
    revision: int
    created_at: datetime
    updated_at: datetime


class BoardChatCreateResponse(SQLModel):
    model_config = ConfigDict(extra="forbid")

    chat: ChatRead
    placement: PlacementRead
    idempotency_replayed: bool


class ChatMessageRead(SQLModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    role: Literal["user", "assistant"]
    content: str
    sequence: int
