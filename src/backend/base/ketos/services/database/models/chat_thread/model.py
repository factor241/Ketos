import re
from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

from pydantic import ConfigDict, field_validator
from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.sql.elements import conv
from sqlmodel import Field, SQLModel


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ChatContextPolicy(str, Enum):
    CHAT_ONLY = "chat_only"
    BOARD = "board"


class ChatRunStatus(str, Enum):
    CLAIMED = "claimed"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    FAILED_RECOVERABLE = "failed_recoverable"
    CANCELLED = "cancelled"


_CONTEXT_POLICY_TYPE = SAEnum(
    ChatContextPolicy,
    name="chat_context_policy",
    native_enum=False,
    create_constraint=False,
    values_callable=lambda enum: [item.value for item in enum],
)
_RUN_STATUS_TYPE = SAEnum(
    ChatRunStatus,
    name="chat_run_status",
    native_enum=False,
    create_constraint=False,
    values_callable=lambda enum: [item.value for item in enum],
)
_FINGERPRINT_RE = re.compile(r"[0-9a-f]{64}\Z")
_LENGTH_ERRORS = {
    "title": "title has an invalid length",
    "provider": "provider has an invalid length",
    "model_name": "model_name has an invalid length",
}
_REVISION_ERROR = "revision must be a non-negative integer"
_IDENTIFIER_ERROR = "identifier must not be blank"
_FINGERPRINT_ERROR = "request_fingerprint must be a lowercase SHA-256 hex digest"
_REPLAY_CURSOR_ERROR = "replay_cursor must be a non-negative integer"
_RUN_SEQUENCE_ERROR = "run_sequence must be a positive integer"
_DURATION_ERROR = "duration_ms must be null or a non-negative integer"


class ChatThread(SQLModel, table=True):  # type: ignore[call-arg]
    model_config = ConfigDict(validate_assignment=True)
    __tablename__ = "chat_thread"
    __table_args__ = (
        CheckConstraint("length(trim(title)) BETWEEN 1 AND 120", name=conv("ck_chat_thread_title_length")),
        CheckConstraint("length(trim(provider)) BETWEEN 1 AND 128", name=conv("ck_chat_thread_provider_length")),
        CheckConstraint(
            "length(trim(model_name)) BETWEEN 1 AND 256",
            name=conv("ck_chat_thread_model_name_length"),
        ),
        CheckConstraint(
            "context_policy IN ('chat_only', 'board')",
            name=conv("ck_chat_thread_context_policy_values"),
        ),
        CheckConstraint("revision >= 0", name=conv("ck_chat_thread_revision_nonnegative")),
    )

    id: UUID = Field(default_factory=uuid4, sa_column=Column(Uuid, primary_key=True, nullable=False))
    project_id: UUID = Field(
        sa_column=Column(Uuid, ForeignKey("folder.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    created_by_id: UUID = Field(
        sa_column=Column(Uuid, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    title: str = Field(sa_column=Column(String(120), nullable=False))
    provider: str = Field(sa_column=Column(String(128), nullable=False))
    model_name: str = Field(sa_column=Column(String(256), nullable=False))
    context_policy: ChatContextPolicy = Field(sa_column=Column(_CONTEXT_POLICY_TYPE, nullable=False))
    archived: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, default=False, server_default=text("false")),
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
            DateTime(timezone=True),
            nullable=False,
            default=_utc_now,
            onupdate=_utc_now,
            server_default=func.now(),
        ),
    )

    @field_validator("title", "provider", "model_name")
    @classmethod
    def validate_bounded_identifier(cls, value: str, info) -> str:
        value = value.strip()
        limits = {"title": 120, "provider": 128, "model_name": 256}
        if not value or len(value) > limits[info.field_name]:
            raise ValueError(_LENGTH_ERRORS[info.field_name])
        return value

    @field_validator("revision", mode="before")
    @classmethod
    def validate_revision(cls, value: object) -> object:
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError(_REVISION_ERROR)
        return value


class ChatRun(SQLModel, table=True):  # type: ignore[call-arg]
    model_config = ConfigDict(validate_assignment=True)
    __tablename__ = "chat_run"
    __table_args__ = (
        UniqueConstraint("chat_id", "idempotency_key", name="uq_chat_run_chat_idempotency"),
        UniqueConstraint("chat_id", "run_sequence", name="uq_chat_run_chat_sequence"),
        CheckConstraint(
            "status IN ('claimed', 'running', 'succeeded', 'failed', 'failed_recoverable', 'cancelled')",
            name=conv("ck_chat_run_status_values"),
        ),
        CheckConstraint("replay_cursor >= 0", name=conv("ck_chat_run_replay_cursor_nonnegative")),
        CheckConstraint("run_sequence > 0", name=conv("ck_chat_run_run_sequence_positive")),
        CheckConstraint(
            "duration_ms IS NULL OR duration_ms >= 0",
            name=conv("ck_chat_run_duration_nonnegative"),
        ),
    )

    id: UUID = Field(default_factory=uuid4, sa_column=Column(Uuid, primary_key=True, nullable=False))
    chat_id: UUID = Field(
        sa_column=Column(Uuid, ForeignKey("chat_thread.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    ag_ui_run_id: str = Field(sa_column=Column(String(256), nullable=False, index=True))
    langgraph_thread_id: str = Field(sa_column=Column(String(36), nullable=False))
    idempotency_key: str = Field(sa_column=Column(String(512), nullable=False))
    request_fingerprint: str = Field(sa_column=Column(String(64), nullable=False))
    status: ChatRunStatus = Field(
        default=ChatRunStatus.CLAIMED,
        sa_column=Column(
            _RUN_STATUS_TYPE,
            nullable=False,
            default=ChatRunStatus.CLAIMED,
            server_default=text("'claimed'"),
        ),
    )
    replay_cursor: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0, server_default=text("0")),
    )
    request_id: UUID = Field(default_factory=uuid4, sa_column=Column(Uuid, nullable=False))
    run_sequence: int = Field(sa_column=Column(Integer, nullable=False))
    duration_ms: int | None = Field(default=None, sa_column=Column(Integer, nullable=True))
    outcome: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    redacted_audit: dict = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False, default=dict, server_default=text("'{}'")),
    )
    created_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, default=_utc_now, server_default=func.now()),
    )
    started_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    finished_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))

    @field_validator("ag_ui_run_id", "langgraph_thread_id", "idempotency_key")
    @classmethod
    def validate_nonempty_identifier(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError(_IDENTIFIER_ERROR)
        return value

    @field_validator("request_fingerprint")
    @classmethod
    def validate_request_fingerprint(cls, value: str) -> str:
        if _FINGERPRINT_RE.fullmatch(value) is None:
            raise ValueError(_FINGERPRINT_ERROR)
        return value

    @field_validator("replay_cursor", mode="before")
    @classmethod
    def validate_replay_cursor(cls, value: object) -> object:
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError(_REPLAY_CURSOR_ERROR)
        return value

    @field_validator("run_sequence", mode="before")
    @classmethod
    def validate_run_sequence(cls, value: object) -> object:
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ValueError(_RUN_SEQUENCE_ERROR)
        return value

    @field_validator("duration_ms", mode="before")
    @classmethod
    def validate_duration_ms(cls, value: object) -> object:
        if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value < 0):
            raise ValueError(_DURATION_ERROR)
        return value
