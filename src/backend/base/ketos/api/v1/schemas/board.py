import math
from datetime import datetime
from uuid import UUID

from pydantic import ConfigDict, field_validator
from sqlmodel import Field, SQLModel

_NONFINITE_VIEWPORT_ERROR = "viewport values must be finite"


class _BoardSchema(SQLModel):
    model_config = ConfigDict(extra="forbid")


class _BoardTitleSchema(_BoardSchema):
    title: str = Field(min_length=1, max_length=255)

    @field_validator("title", mode="before")
    @classmethod
    def trim_title(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class BoardCreate(_BoardTitleSchema):
    pass


class BoardPatch(_BoardTitleSchema):
    expected_revision: int = Field(ge=0)


class BoardViewportUpdate(_BoardSchema):
    x: float
    y: float
    zoom: float = Field(ge=0.5, le=2.0)
    expected_revision: int = Field(ge=0)

    @field_validator("x", "y", "zoom")
    @classmethod
    def validate_finite(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError(_NONFINITE_VIEWPORT_ERROR)
        return value


class BoardRead(_BoardSchema):
    id: UUID
    project_id: UUID
    created_by_id: UUID
    title: str
    viewport_x: float
    viewport_y: float
    viewport_zoom: float
    revision: int
    created_at: datetime
    updated_at: datetime
