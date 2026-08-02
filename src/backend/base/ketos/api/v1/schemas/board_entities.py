import math
from datetime import datetime
from typing import Self
from uuid import UUID

from pydantic import ConfigDict, field_validator, model_validator
from sqlmodel import Field, SQLModel

from ketos.services.database.models.placement.model import PlacementDisplayState, PlacementTargetKind

_FINITE_GEOMETRY_ERROR = "placement geometry must be finite"
_EMPTY_PLACEMENT_PATCH_ERROR = "placement patch must change at least one field"
_EMPTY_NOTE_PATCH_ERROR = "board note patch must change at least one field"


class _BoardEntitySchema(SQLModel):
    model_config = ConfigDict(extra="forbid")


class PlacementGeometryCreate(_BoardEntitySchema):
    x: float = Field(ge=-1_000_000, le=1_000_000)
    y: float = Field(ge=-1_000_000, le=1_000_000)
    width: float = Field(default=320, ge=240, le=1600)
    height: float = Field(default=240, ge=160, le=1200)
    z_index: int = Field(default=0, ge=0, le=1_000_000)

    @field_validator("x", "y", "width", "height")
    @classmethod
    def validate_finite_geometry(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError(_FINITE_GEOMETRY_ERROR)
        return value


class PlacementCreate(PlacementGeometryCreate):
    target_kind: PlacementTargetKind
    target_id: UUID


class PlacementPatch(_BoardEntitySchema):
    x: float | None = Field(default=None, ge=-1_000_000, le=1_000_000)
    y: float | None = Field(default=None, ge=-1_000_000, le=1_000_000)
    width: float | None = Field(default=None, ge=240, le=1600)
    height: float | None = Field(default=None, ge=160, le=1200)
    z_index: int | None = Field(default=None, ge=0, le=1_000_000)
    display_state: PlacementDisplayState | None = None
    expected_revision: int = Field(ge=0)

    @field_validator("x", "y", "width", "height")
    @classmethod
    def validate_finite_geometry(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError(_FINITE_GEOMETRY_ERROR)
        return value

    @model_validator(mode="after")
    def require_change(self) -> Self:
        patch_fields = ("x", "y", "width", "height", "z_index", "display_state")
        if all(getattr(self, field) is None for field in patch_fields):
            raise ValueError(_EMPTY_PLACEMENT_PATCH_ERROR)
        return self


class PlacementRead(_BoardEntitySchema):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: UUID
    board_id: UUID
    target_kind: PlacementTargetKind
    target_id: UUID
    x: float
    y: float
    width: float
    height: float
    z_index: int
    display_state: PlacementDisplayState
    revision: int
    created_at: datetime
    updated_at: datetime


class BoardNoteCreate(_BoardEntitySchema):
    content: str = Field(default="", max_length=10_000)
    color: str = "neutral"
    placement: PlacementGeometryCreate


class BoardNotePatch(_BoardEntitySchema):
    content: str | None = Field(default=None, max_length=10_000)
    color: str | None = None
    expected_revision: int = Field(ge=0)

    @model_validator(mode="after")
    def require_change(self) -> Self:
        if self.content is None and self.color is None:
            raise ValueError(_EMPTY_NOTE_PATCH_ERROR)
        return self


class BoardNoteRead(_BoardEntitySchema):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: UUID
    project_id: UUID
    created_by_id: UUID
    content: str
    color: str
    revision: int
    created_at: datetime
    updated_at: datetime


class BoardNoteCreateResponse(_BoardEntitySchema):
    note: BoardNoteRead
    placement: PlacementRead
