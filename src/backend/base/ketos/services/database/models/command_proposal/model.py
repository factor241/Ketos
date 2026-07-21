from __future__ import annotations

import re
from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

from pydantic import ConfigDict, field_validator
from sqlalchemy import (
    JSON,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
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


def _lower_hex_sql(column: str, *, nullable: bool) -> str:
    cleaned = column
    for character in "0123456789abcdef":
        cleaned = f"replace({cleaned}, '{character}', '')"
    shape = f"length({column}) = 64 AND {column} = lower({column}) AND length({cleaned}) = 0"
    return f"{column} IS NULL OR ({shape})" if nullable else f"({shape})"


class CommandProposalSourceKind(str, Enum):
    AI_RUN = "ai_run"
    SERVER_RESTORE = "server_restore"


class CommandProposalCommandType(str, Enum):
    CREATE_FLOW = "create_flow"
    ADD_NODE = "add_node"
    REMOVE_NODE = "remove_node"
    SET_PARAMETER = "set_parameter"
    CONNECT_NODES = "connect_nodes"
    DISCONNECT_NODES = "disconnect_nodes"
    REPLACE_FLOW = "replace_flow"


class CommandProposalStatus(str, Enum):
    PROPOSED = "proposed"
    AWAITING_CONFIRMATION = "awaiting_confirmation"
    APPLIED = "applied"
    REJECTED = "rejected"
    STALE = "stale"
    FAILED = "failed"


def _enum_type(enum: type[Enum], name: str) -> SAEnum:
    return SAEnum(
        enum,
        name=name,
        native_enum=False,
        create_constraint=False,
        values_callable=lambda values: [item.value for item in values],
    )


_SOURCE_KIND_TYPE = _enum_type(CommandProposalSourceKind, "command_proposal_source_kind")
_COMMAND_TYPE = _enum_type(CommandProposalCommandType, "command_proposal_command_type")
_STATUS_TYPE = _enum_type(CommandProposalStatus, "command_proposal_status")
_LOWER_HEX_RE = re.compile(r"[0-9a-f]{64}\Z")
_HASH_ERROR = "hash must be a lowercase SHA-256 hex digest"
_SEQUENCE_ERROR = "sequence must be a positive integer"
_DURATION_ERROR = "duration_ms must be null or a non-negative integer"


class CommandProposal(SQLModel, table=True):  # type: ignore[call-arg]
    model_config = ConfigDict(validate_assignment=True)
    __tablename__ = "command_proposal"
    __table_args__ = (
        UniqueConstraint(
            "chat_run_id",
            "idempotency_key",
            name="uq_command_proposal_chat_run_id_idempotency_key",
        ),
        UniqueConstraint(
            "chat_run_id",
            "sequence",
            name="uq_command_proposal_chat_run_id_sequence",
        ),
        UniqueConstraint(
            "chat_run_id",
            "interrupt_id",
            name="uq_command_proposal_chat_run_id_interrupt_id",
        ),
        CheckConstraint(
            "source_kind IN ('ai_run', 'server_restore')",
            name=conv("ck_command_proposal_source_kind"),
        ),
        CheckConstraint(
            "command_type IN ('create_flow', 'add_node', 'remove_node', 'set_parameter', "
            "'connect_nodes', 'disconnect_nodes', 'replace_flow')",
            name=conv("ck_command_proposal_command_type"),
        ),
        CheckConstraint(
            "status IN ('proposed', 'awaiting_confirmation', 'applied', 'rejected', 'stale', 'failed')",
            name=conv("ck_command_proposal_status"),
        ),
        CheckConstraint(
            "length(trim(thread_id)) BETWEEN 1 AND 36 AND "
            "length(trim(idempotency_key)) BETWEEN 1 AND 128 AND "
            "length(trim(request_id)) BETWEEN 1 AND 128 AND "
            "(interrupt_id IS NULL OR length(trim(interrupt_id)) BETWEEN 1 AND 128)",
            name=conv("ck_command_proposal_identifiers"),
        ),
        CheckConstraint(
            "((command_type = 'create_flow' AND base_flow_revision IS NULL AND base_flow_hash IS NULL) OR "
            "(command_type <> 'create_flow' AND base_flow_revision IS NOT NULL AND "
            "base_flow_revision >= 0 AND base_flow_hash IS NOT NULL))",
            name=conv("ck_command_proposal_base_flow"),
        ),
        CheckConstraint(
            "((interrupt_id IS NULL AND interrupt_bound_at IS NULL) OR "
            "(interrupt_id IS NOT NULL AND interrupt_bound_at IS NOT NULL)) AND "
            "((source_kind = 'ai_run' AND source_proposal_id IS NULL AND "
            "((status = 'proposed' AND interrupt_id IS NULL) OR status = 'failed' OR "
            "(status IN ('awaiting_confirmation', 'applied', 'rejected', 'stale') AND "
            "interrupt_id IS NOT NULL))) OR "
            "(source_kind = 'server_restore' AND source_proposal_id IS NOT NULL AND interrupt_id IS NULL))",
            name=conv("ck_command_proposal_interrupt_phase"),
        ),
        CheckConstraint(
            "((status IN ('proposed', 'awaiting_confirmation') AND resolved_at IS NULL) OR "
            "(status IN ('applied', 'rejected', 'stale', 'failed') AND resolved_at IS NOT NULL))",
            name=conv("ck_command_proposal_resolved_at"),
        ),
        CheckConstraint(
            " AND ".join(
                (
                    _lower_hex_sql("proposal_hash", nullable=False),
                    _lower_hex_sql("base_flow_hash", nullable=True),
                    _lower_hex_sql("result_flow_hash", nullable=False),
                    _lower_hex_sql("request_fingerprint", nullable=False),
                )
            ),
            name=conv("ck_command_proposal_hashes"),
        ),
        CheckConstraint("sequence > 0", name=conv("ck_command_proposal_sequence_positive")),
        CheckConstraint(
            "duration_ms IS NULL OR duration_ms >= 0",
            name=conv("ck_command_proposal_duration_nonnegative"),
        ),
        CheckConstraint(
            "pinned_flow_version_id IS NULL OR status = 'applied'",
            name=conv("ck_command_proposal_pin_applied"),
        ),
        Index("ix_command_proposal_chat_run_id_status", "chat_run_id", "status"),
        Index("ix_command_proposal_interrupt_id", "interrupt_id"),
        Index("ix_command_proposal_actor_id", "actor_id"),
        Index("ix_command_proposal_project_id", "project_id"),
        Index("ix_command_proposal_idempotency_key", "idempotency_key"),
    )

    id: UUID = Field(default_factory=uuid4, sa_column=Column(Uuid, primary_key=True, nullable=False))
    actor_id: UUID = Field(sa_column=Column(Uuid, ForeignKey("user.id", ondelete="RESTRICT"), nullable=False))
    project_id: UUID = Field(sa_column=Column(Uuid, ForeignKey("folder.id", ondelete="RESTRICT"), nullable=False))
    source_kind: CommandProposalSourceKind = Field(sa_column=Column(_SOURCE_KIND_TYPE, nullable=False))
    chat_run_id: UUID = Field(sa_column=Column(Uuid, ForeignKey("chat_run.id", ondelete="RESTRICT"), nullable=False))
    thread_id: str = Field(sa_column=Column(String(36), nullable=False))
    interrupt_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    interrupt_bound_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    source_proposal_id: UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid,
            ForeignKey("command_proposal.id", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    flow_id: UUID = Field(sa_column=Column(Uuid, nullable=False))
    command_type: CommandProposalCommandType = Field(sa_column=Column(_COMMAND_TYPE, nullable=False))
    canonical_payload: dict = Field(sa_column=Column(JSON, nullable=False))
    preview: dict = Field(sa_column=Column(JSON, nullable=False))
    proposal_hash: str = Field(sa_column=Column(String(64), nullable=False))
    base_flow_revision: int | None = Field(default=None, sa_column=Column(Integer, nullable=True))
    base_flow_hash: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    result_flow_hash: str = Field(sa_column=Column(String(64), nullable=False))
    idempotency_key: str = Field(sa_column=Column(String(128), nullable=False))
    request_fingerprint: str = Field(sa_column=Column(String(64), nullable=False))
    status: CommandProposalStatus = Field(
        default=CommandProposalStatus.PROPOSED,
        sa_column=Column(
            _STATUS_TYPE,
            nullable=False,
            default=CommandProposalStatus.PROPOSED,
            server_default=text("'proposed'"),
        ),
    )
    pinned_flow_version_id: UUID | None = Field(
        default=None,
        sa_column=Column(Uuid, ForeignKey("flow_version.id", ondelete="RESTRICT"), nullable=True),
    )
    request_id: str = Field(sa_column=Column(String(128), nullable=False))
    sequence: int = Field(sa_column=Column(Integer, nullable=False))
    duration_ms: int | None = Field(default=None, sa_column=Column(Integer, nullable=True))
    outcome: dict | None = Field(default=None, sa_column=Column(JSON, nullable=True))
    redacted_audit: dict = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False, default=dict, server_default=text("'{}'")),
    )
    created_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, default=_utc_now, server_default=func.now()),
    )
    resolved_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))

    @field_validator("proposal_hash", "base_flow_hash", "result_flow_hash", "request_fingerprint")
    @classmethod
    def validate_hash(cls, value: str | None) -> str | None:
        if value is not None and _LOWER_HEX_RE.fullmatch(value) is None:
            raise ValueError(_HASH_ERROR)
        return value

    @field_validator("thread_id", "idempotency_key", "request_id", "interrupt_id")
    @classmethod
    def validate_identifier(cls, value: str | None, info) -> str | None:
        if value is None:
            return value
        limits = {"thread_id": 36, "idempotency_key": 128, "request_id": 128, "interrupt_id": 128}
        value = value.strip()
        if not value or len(value) > limits[info.field_name]:
            message = f"{info.field_name} has an invalid length"
            raise ValueError(message)
        return value

    @field_validator("sequence", mode="before")
    @classmethod
    def validate_sequence(cls, value: object) -> object:
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ValueError(_SEQUENCE_ERROR)
        return value

    @field_validator("duration_ms", mode="before")
    @classmethod
    def validate_duration_ms(cls, value: object) -> object:
        if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value < 0):
            raise ValueError(_DURATION_ERROR)
        return value
