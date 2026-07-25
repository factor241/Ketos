from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, String, UniqueConstraint, Uuid, func
from sqlmodel import Field, SQLModel


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class BoardCommandReceipt(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "board_command_receipt"
    __table_args__ = (
        UniqueConstraint(
            "principal_id",
            "operation",
            "idempotency_key",
            name="uq_board_command_receipt_principal_operation_key",
        ),
        CheckConstraint(
            "operation IN ('board_bootstrap', 'board_automation', 'create_board_chat')",
            name="ck_board_command_receipt_operation",
        ),
        CheckConstraint(
            "length(request_hash) = 64 AND request_hash = lower(request_hash)",
            name="ck_board_command_receipt_request_hash",
        ),
        CheckConstraint(
            "(automation_id IS NULL) = (placement_id IS NULL)",
            name="ck_board_command_receipt_automation_placement_pair",
        ),
    )

    id: UUID = Field(default_factory=uuid4, sa_column=Column(Uuid, primary_key=True, nullable=False))
    principal_id: UUID = Field(
        sa_column=Column(Uuid, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    operation: str = Field(sa_column=Column(String(64), nullable=False))
    idempotency_key: UUID = Field(sa_column=Column(Uuid, nullable=False))
    request_hash: str = Field(sa_column=Column(String(64), nullable=False))
    board_id: UUID = Field(sa_column=Column(Uuid, nullable=False))
    automation_id: UUID | None = Field(default=None, sa_column=Column(Uuid, nullable=True))
    placement_id: UUID | None = Field(default=None, sa_column=Column(Uuid, nullable=True))
    created_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, default=_utc_now, server_default=func.now()),
    )
