"""Add durable chat thread, run, and message linkage.

Revision ID: 505c0a700001
Revises: c04d5e6f7a8b
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "505c0a700001"
down_revision: str | None = "c04d5e6f7a8b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "chat_thread",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("provider", sa.String(length=128), nullable=False),
        sa.Column("model_name", sa.String(length=256), nullable=False),
        sa.Column(
            "context_policy",
            sa.Enum("chat_only", "board", name="chat_context_policy", native_enum=False),
            nullable=False,
        ),
        sa.Column("archived", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("revision", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("length(trim(title)) BETWEEN 1 AND 120", name=op.f("ck_chat_thread_title_length")),
        sa.CheckConstraint(
            "length(trim(provider)) BETWEEN 1 AND 128",
            name=op.f("ck_chat_thread_provider_length"),
        ),
        sa.CheckConstraint(
            "length(trim(model_name)) BETWEEN 1 AND 256",
            name=op.f("ck_chat_thread_model_name_length"),
        ),
        sa.CheckConstraint(
            "context_policy IN ('chat_only', 'board')",
            name=op.f("ck_chat_thread_context_policy_values"),
        ),
        sa.CheckConstraint("revision >= 0", name=op.f("ck_chat_thread_revision_nonnegative")),
        sa.ForeignKeyConstraint(
            ["project_id"], ["folder.id"], name="fk_chat_thread_project_id_folder", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"], ["user.id"], name="fk_chat_thread_created_by_id_user", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_chat_thread"),
    )
    op.create_index(op.f("ix_chat_thread_project_id"), "chat_thread", ["project_id"], unique=False)
    op.create_index(op.f("ix_chat_thread_created_by_id"), "chat_thread", ["created_by_id"], unique=False)

    op.create_table(
        "chat_run",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("chat_id", sa.Uuid(), nullable=False),
        sa.Column("ag_ui_run_id", sa.String(length=256), nullable=False),
        sa.Column("langgraph_thread_id", sa.String(length=36), nullable=False),
        sa.Column("idempotency_key", sa.String(length=512), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "claimed",
                "running",
                "succeeded",
                "failed",
                "failed_recoverable",
                "cancelled",
                name="chat_run_status",
                native_enum=False,
            ),
            server_default=sa.text("'claimed'"),
            nullable=False,
        ),
        sa.Column("replay_cursor", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("run_sequence", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("outcome", sa.String(length=128), nullable=True),
        sa.Column("redacted_audit", sa.JSON(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('claimed', 'running', 'succeeded', 'failed', 'failed_recoverable', 'cancelled')",
            name=op.f("ck_chat_run_status_values"),
        ),
        sa.CheckConstraint("replay_cursor >= 0", name=op.f("ck_chat_run_replay_cursor_nonnegative")),
        sa.CheckConstraint("run_sequence > 0", name=op.f("ck_chat_run_run_sequence_positive")),
        sa.CheckConstraint(
            "duration_ms IS NULL OR duration_ms >= 0",
            name=op.f("ck_chat_run_duration_nonnegative"),
        ),
        sa.ForeignKeyConstraint(
            ["chat_id"], ["chat_thread.id"], name="fk_chat_run_chat_id_chat_thread", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_chat_run"),
        sa.UniqueConstraint("chat_id", "idempotency_key", name="uq_chat_run_chat_idempotency"),
        sa.UniqueConstraint("chat_id", "run_sequence", name="uq_chat_run_chat_sequence"),
    )
    op.create_index(op.f("ix_chat_run_chat_id"), "chat_run", ["chat_id"], unique=False)
    op.create_index(op.f("ix_chat_run_ag_ui_run_id"), "chat_run", ["ag_ui_run_id"], unique=False)

    with op.batch_alter_table("message") as batch_op:
        batch_op.add_column(sa.Column("chat_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("chat_run_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("chat_sequence", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_message_chat_id_chat_thread", "chat_thread", ["chat_id"], ["id"], ondelete="CASCADE"
        )
        batch_op.create_foreign_key("fk_message_chat_run_id_chat_run", "chat_run", ["chat_run_id"], ["id"])
        batch_op.create_check_constraint(
            op.f("ck_message_chat_fields_consistent"),
            "(chat_id IS NULL AND chat_run_id IS NULL AND chat_sequence IS NULL) OR "
            "(chat_id IS NOT NULL AND chat_run_id IS NOT NULL AND chat_sequence > 0)",
        )
        batch_op.create_index(op.f("ix_message_chat_id"), ["chat_id"], unique=False)
        batch_op.create_index(op.f("ix_message_chat_run_id"), ["chat_run_id"], unique=False)
        batch_op.create_index(
            "uq_message_chat_sequence",
            ["chat_id", "chat_sequence"],
            unique=True,
            postgresql_where=sa.text("chat_id IS NOT NULL"),
            sqlite_where=sa.text("chat_id IS NOT NULL"),
        )


def downgrade() -> None:
    with op.batch_alter_table("message") as batch_op:
        batch_op.drop_index("uq_message_chat_sequence")
        batch_op.drop_index(op.f("ix_message_chat_run_id"))
        batch_op.drop_index(op.f("ix_message_chat_id"))
        batch_op.drop_constraint(op.f("ck_message_chat_fields_consistent"), type_="check")
        batch_op.drop_constraint("fk_message_chat_run_id_chat_run", type_="foreignkey")
        batch_op.drop_constraint("fk_message_chat_id_chat_thread", type_="foreignkey")
        batch_op.drop_column("chat_sequence")
        batch_op.drop_column("chat_run_id")
        batch_op.drop_column("chat_id")

    op.drop_index(op.f("ix_chat_run_ag_ui_run_id"), table_name="chat_run")
    op.drop_index(op.f("ix_chat_run_chat_id"), table_name="chat_run")
    op.drop_table("chat_run")
    op.drop_index(op.f("ix_chat_thread_created_by_id"), table_name="chat_thread")
    op.drop_index(op.f("ix_chat_thread_project_id"), table_name="chat_thread")
    op.drop_table("chat_thread")
