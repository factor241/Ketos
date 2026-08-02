import re
from datetime import datetime, timezone
from uuid import UUID, uuid4

from pydantic import field_validator
from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, String, Text, Uuid, func, text
from sqlmodel import Field, SQLModel

BOARD_NOTE_COLORS = frozenset({"neutral", "yellow", "green", "blue", "violet", "pink"})
CONTENT_MAX_LENGTH = 10_000
_HEX_COLOR = re.compile(r"#[0-9A-Fa-f]{6}\Z")
_CONTENT_LENGTH_ERROR = "content must contain at most 10000 Unicode code points"
_COLOR_ERROR = "color must be a supported token or six-digit hex color"
_REVISION_ERROR = "revision must be a non-negative integer"
_HEX_DB_CHECK = " AND ".join(
    f"(substr(color, {index}, 1) BETWEEN '0' AND '9' OR "
    f"substr(color, {index}, 1) BETWEEN 'A' AND 'F' OR "
    f"substr(color, {index}, 1) BETWEEN 'a' AND 'f')"
    for index in range(2, 8)
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class BoardNote(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "board_note"
    __table_args__ = (
        CheckConstraint("length(content) <= 10000", name="ck_board_note_content_length"),
        CheckConstraint(
            "color IN ('neutral', 'yellow', 'green', 'blue', 'violet', 'pink') OR "
            f"(length(color) = 7 AND substr(color, 1, 1) = '#' AND {_HEX_DB_CHECK})",
            name="ck_board_note_color_values",
        ),
        CheckConstraint("revision >= 0", name="ck_board_note_revision_nonnegative"),
    )

    id: UUID = Field(default_factory=uuid4, sa_column=Column(Uuid, primary_key=True, nullable=False))
    project_id: UUID = Field(
        sa_column=Column(Uuid, ForeignKey("folder.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    created_by_id: UUID = Field(
        sa_column=Column(Uuid, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    content: str = Field(
        default="",
        sa_column=Column(Text, nullable=False, default="", server_default=text("''")),
    )
    color: str = Field(
        default="neutral",
        sa_column=Column(String(32), nullable=False, default="neutral", server_default=text("'neutral'")),
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

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        if len(value) > CONTENT_MAX_LENGTH:
            raise ValueError(_CONTENT_LENGTH_ERROR)
        return value

    @field_validator("color")
    @classmethod
    def validate_color(cls, value: str) -> str:
        if value not in BOARD_NOTE_COLORS and _HEX_COLOR.fullmatch(value) is None:
            raise ValueError(_COLOR_ERROR)
        return value

    @field_validator("revision", mode="before")
    @classmethod
    def validate_revision(cls, value: object) -> object:
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError(_REVISION_ERROR)
        return value
