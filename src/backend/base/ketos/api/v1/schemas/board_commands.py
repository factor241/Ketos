from typing import Annotated, Literal
from uuid import UUID

from pydantic import ConfigDict, Field, field_validator
from sqlmodel import SQLModel

from ketos.api.v1.schemas.board import BoardRead
from ketos.api.v1.schemas.board_entities import PlacementGeometryCreate, PlacementRead
from ketos.services.database.models.flow.model import FlowRead

AUTOMATION_NAME_MAX_LENGTH = 255


class _StrictSchema(SQLModel):
    model_config = ConfigDict(extra="forbid")


class _NamedStarter(_StrictSchema):
    name: str = Field(min_length=1, max_length=AUTOMATION_NAME_MAX_LENGTH)

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class CleanStarter(_StrictSchema):
    kind: Literal["clean"]


class BlankAutomationStarter(_NamedStarter):
    kind: Literal["blank_automation"]


class SimpleAgentStarter(_NamedStarter):
    kind: Literal["simple_agent"]


class VectorStoreRagStarter(_NamedStarter):
    kind: Literal["vector_store_rag"]


class TemplateStarter(_NamedStarter):
    kind: Literal["template"]
    template_id: UUID


NonCleanStarter = Annotated[
    BlankAutomationStarter | SimpleAgentStarter | VectorStoreRagStarter | TemplateStarter,
    Field(discriminator="kind"),
]
BoardStarter = Annotated[CleanStarter | NonCleanStarter, Field(discriminator="kind")]


class BoardBootstrapCreate(_StrictSchema):
    title: str = Field(min_length=1, max_length=255)
    starter: BoardStarter

    @field_validator("title", mode="before")
    @classmethod
    def trim_title(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class BoardAutomationCreate(_StrictSchema):
    starter: NonCleanStarter
    placement: PlacementGeometryCreate = Field(default_factory=lambda: PlacementGeometryCreate(x=0, y=0))


class BoardBootstrapRead(_StrictSchema):
    board: BoardRead
    automation: FlowRead | None
    placement: PlacementRead | None
    idempotency_replayed: bool


class BoardAutomationRead(_StrictSchema):
    automation: FlowRead
    placement: PlacementRead
    idempotency_replayed: bool
