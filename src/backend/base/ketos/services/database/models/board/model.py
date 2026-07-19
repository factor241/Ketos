from datetime import datetime, timezone
from uuid import UUID, uuid4

from pydantic import field_validator
from sqlalchemy import CheckConstraint, Column, DateTime, Double, ForeignKey, Integer, String, Uuid, func, text
from sqlmodel import Field, SQLModel

TITLE_MAX_LENGTH = 255
_TITLE_LENGTH_ERROR = "title length must be between 1 and 255 characters"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Board(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "board"
    __table_args__ = (
        CheckConstraint("length(title) BETWEEN 1 AND 255", name="ck_board_title_length"),
        CheckConstraint("viewport_zoom BETWEEN 0.5 AND 2", name="ck_board_viewport_zoom_range"),
        CheckConstraint("revision >= 0", name="ck_board_revision_nonnegative"),
    )

    id: UUID = Field(default_factory=uuid4, sa_column=Column(Uuid, primary_key=True, nullable=False))
    project_id: UUID = Field(
        sa_column=Column(Uuid, ForeignKey("folder.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    created_by_id: UUID = Field(
        sa_column=Column(Uuid, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    title: str = Field(sa_column=Column(String(255), nullable=False))
    viewport_x: float = Field(
        default=0.0,
        sa_column=Column(Double, nullable=False, default=0.0, server_default=text("0")),
    )
    viewport_y: float = Field(
        default=0.0,
        sa_column=Column(Double, nullable=False, default=0.0, server_default=text("0")),
    )
    viewport_zoom: float = Field(
        default=1.0,
        sa_column=Column(Double, nullable=False, default=1.0, server_default=text("1")),
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

    @field_validator("title", mode="before")
    @classmethod
    def trim_title(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("title")
    @classmethod
    def validate_title_length(cls, value: str) -> str:
        if not 1 <= len(value) <= TITLE_MAX_LENGTH:
            raise ValueError(_TITLE_LENGTH_ERROR)
        return value
