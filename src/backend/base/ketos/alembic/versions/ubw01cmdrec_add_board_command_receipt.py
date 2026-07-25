"""Add durable Board command idempotency receipts.

Revision ID: ubw01cmdrec
Revises: s08c0mmand01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ubw01cmdrec"
down_revision: str | None = "s08c0mmand01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "board_command_receipt",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("principal_id", sa.Uuid(), nullable=False),
        sa.Column("operation", sa.String(length=64), nullable=False),
        sa.Column("idempotency_key", sa.Uuid(), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("board_id", sa.Uuid(), nullable=False),
        sa.Column("automation_id", sa.Uuid(), nullable=True),
        sa.Column("placement_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "operation IN ('board_bootstrap', 'board_automation', 'create_board_chat')",
            name="ck_board_command_receipt_operation",
        ),
        sa.CheckConstraint(
            "length(request_hash) = 64 AND request_hash = lower(request_hash)",
            name="ck_board_command_receipt_request_hash",
        ),
        sa.CheckConstraint(
            "(automation_id IS NULL) = (placement_id IS NULL)",
            name="ck_board_command_receipt_automation_placement_pair",
        ),
        sa.ForeignKeyConstraint(["principal_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "principal_id",
            "operation",
            "idempotency_key",
            name="uq_board_command_receipt_principal_operation_key",
        ),
    )
    op.create_index(
        op.f("ix_board_command_receipt_principal_id"),
        "board_command_receipt",
        ["principal_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_board_command_receipt_principal_id"), table_name="board_command_receipt")
    op.drop_table("board_command_receipt")
