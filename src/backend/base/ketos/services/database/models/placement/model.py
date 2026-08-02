import math
from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

from pydantic import field_validator
from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Double,
    ForeignKey,
    Integer,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlmodel import Field, SQLModel


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PlacementTargetKind(str, Enum):
    NOTE = "note"
    CHAT = "chat"
    AUTOMATION = "automation"
    JOB_RESULT = "job_result"


class PlacementDisplayState(str, Enum):
    NORMAL = "normal"
    COLLAPSED = "collapsed"
    MAXIMIZED = "maximized"


_TARGET_KIND_TYPE = SAEnum(
    PlacementTargetKind,
    name="placement_target_kind",
    native_enum=False,
    create_constraint=False,
    values_callable=lambda enum: [item.value for item in enum],
)
_DISPLAY_STATE_TYPE = SAEnum(
    PlacementDisplayState,
    name="placement_display_state",
    native_enum=False,
    create_constraint=False,
    values_callable=lambda enum: [item.value for item in enum],
)

MIN_COORDINATE = -1_000_000
MAX_COORDINATE = 1_000_000
MIN_WIDTH = 240
MAX_WIDTH = 1600
MIN_HEIGHT = 160
MAX_HEIGHT = 1200
MAX_Z_INDEX = 1_000_000
_FINITE_NUMBER_ERROR = "value must be a finite number"
_COORDINATE_RANGE_ERROR = "coordinate must be between -1000000 and 1000000"
_WIDTH_RANGE_ERROR = "width must be between 240 and 1600"
_HEIGHT_RANGE_ERROR = "height must be between 160 and 1200"
_INTEGER_RANGE_ERROR = "integer value is outside its allowed range"


class Placement(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "placement"
    __table_args__ = (
        UniqueConstraint("board_id", "target_kind", "target_id", name="uq_placement_board_target"),
        CheckConstraint(
            "target_kind IN ('note', 'chat', 'automation', 'job_result')",
            name="ck_placement_target_kind_values",
        ),
        CheckConstraint(
            "display_state IN ('normal', 'collapsed', 'maximized')",
            name="ck_placement_display_state_values",
        ),
        CheckConstraint("x BETWEEN -1000000 AND 1000000", name="ck_placement_x_range"),
        CheckConstraint("y BETWEEN -1000000 AND 1000000", name="ck_placement_y_range"),
        CheckConstraint("width BETWEEN 240 AND 1600", name="ck_placement_width_range"),
        CheckConstraint("height BETWEEN 160 AND 1200", name="ck_placement_height_range"),
        CheckConstraint("z_index BETWEEN 0 AND 1000000", name="ck_placement_z_index_range"),
        CheckConstraint("revision >= 0", name="ck_placement_revision_nonnegative"),
    )

    id: UUID = Field(default_factory=uuid4, sa_column=Column(Uuid, primary_key=True, nullable=False))
    board_id: UUID = Field(
        sa_column=Column(Uuid, ForeignKey("board.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    target_kind: PlacementTargetKind = Field(sa_column=Column(_TARGET_KIND_TYPE, nullable=False))
    target_id: UUID = Field(sa_column=Column(Uuid, nullable=False, index=True))
    x: float = Field(sa_column=Column(Double, nullable=False))
    y: float = Field(sa_column=Column(Double, nullable=False))
    width: float = Field(
        default=320.0,
        sa_column=Column(Double, nullable=False, default=320.0, server_default=text("320")),
    )
    height: float = Field(
        default=240.0,
        sa_column=Column(Double, nullable=False, default=240.0, server_default=text("240")),
    )
    z_index: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0, server_default=text("0")),
    )
    display_state: PlacementDisplayState = Field(
        default=PlacementDisplayState.NORMAL,
        sa_column=Column(
            _DISPLAY_STATE_TYPE,
            nullable=False,
            default=PlacementDisplayState.NORMAL,
            server_default=text("'normal'"),
        ),
    )
    revision: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0, server_default=text("0")),
    )
    created_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, default=_utc_now, server_default=func.now()),
    )
    updated_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(
            DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now, server_default=func.now()
        ),
    )

    @field_validator("x", "y", mode="before")
    @classmethod
    def validate_coordinates(cls, value: object) -> object:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise TypeError(_FINITE_NUMBER_ERROR)
        number = float(value)
        if not math.isfinite(number) or not MIN_COORDINATE <= number <= MAX_COORDINATE:
            raise ValueError(_COORDINATE_RANGE_ERROR)
        return value

    @field_validator("width", mode="before")
    @classmethod
    def validate_width(cls, value: object) -> object:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise TypeError(_FINITE_NUMBER_ERROR)
        number = float(value)
        if not math.isfinite(number) or not MIN_WIDTH <= number <= MAX_WIDTH:
            raise ValueError(_WIDTH_RANGE_ERROR)
        return value

    @field_validator("height", mode="before")
    @classmethod
    def validate_height(cls, value: object) -> object:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise TypeError(_FINITE_NUMBER_ERROR)
        number = float(value)
        if not math.isfinite(number) or not MIN_HEIGHT <= number <= MAX_HEIGHT:
            raise ValueError(_HEIGHT_RANGE_ERROR)
        return value

    @field_validator("z_index", "revision", mode="before")
    @classmethod
    def validate_integer_ranges(cls, value: object, info) -> object:
        upper = MAX_Z_INDEX if info.field_name == "z_index" else None
        if isinstance(value, bool) or not isinstance(value, int) or value < 0 or (upper is not None and value > upper):
            raise ValueError(_INTEGER_RANGE_ERROR)
        return value
