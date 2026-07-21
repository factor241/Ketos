"""Add Flow revision and durable AI flow command proposals.

Revision ID: s08c0mmand01
Revises: 505c0a700002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "s08c0mmand01"
down_revision: str | None = "505c0a700002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _lower_hex_sql(column: str, *, nullable: bool) -> str:
    cleaned = column
    for character in "0123456789abcdef":
        cleaned = f"replace({cleaned}, '{character}', '')"
    shape = f"length({column}) = 64 AND {column} = lower({column}) AND length({cleaned}) = 0"
    return f"{column} IS NULL OR ({shape})" if nullable else f"({shape})"


def _create_interrupt_immutability_trigger() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            """
            CREATE FUNCTION fn_command_proposal_interrupt_immutable()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
              IF OLD.interrupt_bound_at IS NOT NULL
                 AND (
                   NEW.interrupt_id IS DISTINCT FROM OLD.interrupt_id
                   OR NEW.interrupt_bound_at IS DISTINCT FROM OLD.interrupt_bound_at
                 )
              THEN
                RAISE EXCEPTION USING
                  ERRCODE = '23514',
                  MESSAGE = 'command_proposal interrupt binding is immutable';
              END IF;
              RETURN NEW;
            END;
            $$
            """
        )
        op.execute(
            """
            CREATE TRIGGER trg_command_proposal_interrupt_immutable
            BEFORE UPDATE ON command_proposal
            FOR EACH ROW
            EXECUTE FUNCTION fn_command_proposal_interrupt_immutable()
            """
        )
        return

    if op.get_bind().dialect.name == "sqlite":
        op.execute(
            """
            CREATE TRIGGER trg_command_proposal_interrupt_immutable
            BEFORE UPDATE OF interrupt_id, interrupt_bound_at ON command_proposal
            FOR EACH ROW
            WHEN OLD.interrupt_bound_at IS NOT NULL
             AND (
               NEW.interrupt_id IS NOT OLD.interrupt_id
               OR NEW.interrupt_bound_at IS NOT OLD.interrupt_bound_at
             )
            BEGIN
              SELECT RAISE(ABORT, 'command_proposal interrupt binding is immutable');
            END
            """
        )


def upgrade() -> None:
    dialect = op.get_bind().dialect.name
    with op.batch_alter_table("flow", schema=None) as batch_op:
        batch_op.add_column(sa.Column("revision", sa.Integer(), server_default=sa.text("0"), nullable=False))

    with op.batch_alter_table(
        "flow_version",
        schema=None,
        recreate="always" if dialect == "sqlite" else "auto",
    ) as batch_op:
        batch_op.add_column(sa.Column("source_flow_revision", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("source_flow_hash", sa.String(length=64), nullable=True))
        batch_op.create_check_constraint(
            "ck_flow_version_source_revision_nonnegative",
            "source_flow_revision IS NULL OR source_flow_revision >= 0",
        )
        batch_op.create_check_constraint(
            "ck_flow_version_source_hash_shape",
            _lower_hex_sql("source_flow_hash", nullable=True),
        )
        batch_op.create_check_constraint(
            "ck_flow_version_source_pair",
            "(source_flow_revision IS NULL) = (source_flow_hash IS NULL)",
        )

    op.create_table(
        "command_proposal",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("source_kind", sa.String(length=14), nullable=False),
        sa.Column("chat_run_id", sa.Uuid(), nullable=False),
        sa.Column("thread_id", sa.String(length=36), nullable=False),
        sa.Column("interrupt_id", sa.String(length=128), nullable=True),
        sa.Column("interrupt_bound_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_proposal_id", sa.Uuid(), nullable=True),
        sa.Column("flow_id", sa.Uuid(), nullable=False),
        sa.Column("command_type", sa.String(length=20), nullable=False),
        sa.Column("canonical_payload", sa.JSON(), nullable=False),
        sa.Column("preview", sa.JSON(), nullable=False),
        sa.Column("proposal_hash", sa.String(length=64), nullable=False),
        sa.Column("base_flow_revision", sa.Integer(), nullable=True),
        sa.Column("base_flow_hash", sa.String(length=64), nullable=True),
        sa.Column("result_flow_hash", sa.String(length=64), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=21), server_default=sa.text("'proposed'"), nullable=False),
        sa.Column("pinned_flow_version_id", sa.Uuid(), nullable=True),
        sa.Column("request_id", sa.String(length=128), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("outcome", sa.JSON(), nullable=True),
        sa.Column("redacted_audit", sa.JSON(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "source_kind IN ('ai_run', 'server_restore')",
            name="ck_command_proposal_source_kind",
        ),
        sa.CheckConstraint(
            "command_type IN ('create_flow', 'add_node', 'remove_node', 'set_parameter', "
            "'connect_nodes', 'disconnect_nodes', 'replace_flow')",
            name="ck_command_proposal_command_type",
        ),
        sa.CheckConstraint(
            "status IN ('proposed', 'awaiting_confirmation', 'applied', 'rejected', 'stale', 'failed')",
            name="ck_command_proposal_status",
        ),
        sa.CheckConstraint(
            "length(trim(thread_id)) BETWEEN 1 AND 36 AND "
            "length(trim(idempotency_key)) BETWEEN 1 AND 128 AND "
            "length(trim(request_id)) BETWEEN 1 AND 128 AND "
            "(interrupt_id IS NULL OR length(trim(interrupt_id)) BETWEEN 1 AND 128)",
            name="ck_command_proposal_identifiers",
        ),
        sa.CheckConstraint(
            "((command_type = 'create_flow' AND base_flow_revision IS NULL AND base_flow_hash IS NULL) OR "
            "(command_type <> 'create_flow' AND base_flow_revision IS NOT NULL AND "
            "base_flow_revision >= 0 AND base_flow_hash IS NOT NULL))",
            name="ck_command_proposal_base_flow",
        ),
        sa.CheckConstraint(
            "((interrupt_id IS NULL AND interrupt_bound_at IS NULL) OR "
            "(interrupt_id IS NOT NULL AND interrupt_bound_at IS NOT NULL)) AND "
            "((source_kind = 'ai_run' AND source_proposal_id IS NULL AND "
            "((status = 'proposed' AND interrupt_id IS NULL) OR status = 'failed' OR "
            "(status IN ('awaiting_confirmation', 'applied', 'rejected', 'stale') AND "
            "interrupt_id IS NOT NULL))) OR "
            "(source_kind = 'server_restore' AND source_proposal_id IS NOT NULL AND interrupt_id IS NULL))",
            name="ck_command_proposal_interrupt_phase",
        ),
        sa.CheckConstraint(
            "((status IN ('proposed', 'awaiting_confirmation') AND resolved_at IS NULL) OR "
            "(status IN ('applied', 'rejected', 'stale', 'failed') AND resolved_at IS NOT NULL))",
            name="ck_command_proposal_resolved_at",
        ),
        sa.CheckConstraint(
            " AND ".join(
                (
                    _lower_hex_sql("proposal_hash", nullable=False),
                    _lower_hex_sql("base_flow_hash", nullable=True),
                    _lower_hex_sql("result_flow_hash", nullable=False),
                    _lower_hex_sql("request_fingerprint", nullable=False),
                )
            ),
            name="ck_command_proposal_hashes",
        ),
        sa.CheckConstraint("sequence > 0", name="ck_command_proposal_sequence_positive"),
        sa.CheckConstraint(
            "duration_ms IS NULL OR duration_ms >= 0",
            name="ck_command_proposal_duration_nonnegative",
        ),
        sa.CheckConstraint(
            "pinned_flow_version_id IS NULL OR status = 'applied'",
            name="ck_command_proposal_pin_applied",
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["user.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["project_id"], ["folder.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["chat_run_id"], ["chat_run.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["source_proposal_id"],
            ["command_proposal.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["pinned_flow_version_id"],
            ["flow_version.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "chat_run_id",
            "idempotency_key",
            name="uq_command_proposal_chat_run_id_idempotency_key",
        ),
        sa.UniqueConstraint(
            "chat_run_id",
            "sequence",
            name="uq_command_proposal_chat_run_id_sequence",
        ),
        sa.UniqueConstraint(
            "chat_run_id",
            "interrupt_id",
            name="uq_command_proposal_chat_run_id_interrupt_id",
        ),
    )
    op.create_index(
        "ix_command_proposal_chat_run_id_status",
        "command_proposal",
        ["chat_run_id", "status"],
    )
    op.create_index("ix_command_proposal_interrupt_id", "command_proposal", ["interrupt_id"])
    op.create_index("ix_command_proposal_actor_id", "command_proposal", ["actor_id"])
    op.create_index("ix_command_proposal_project_id", "command_proposal", ["project_id"])
    op.create_index("ix_command_proposal_idempotency_key", "command_proposal", ["idempotency_key"])
    _create_interrupt_immutability_trigger()


def downgrade() -> None:
    dialect = op.get_bind().dialect.name
    if dialect == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS trg_command_proposal_interrupt_immutable ON command_proposal")
        op.execute("DROP FUNCTION IF EXISTS fn_command_proposal_interrupt_immutable()")
    else:
        op.execute("DROP TRIGGER IF EXISTS trg_command_proposal_interrupt_immutable")
    op.drop_table("command_proposal")

    with op.batch_alter_table(
        "flow_version",
        schema=None,
        recreate="always" if dialect == "sqlite" else "auto",
    ) as batch_op:
        batch_op.drop_constraint("ck_flow_version_source_pair", type_="check")
        batch_op.drop_constraint("ck_flow_version_source_hash_shape", type_="check")
        batch_op.drop_constraint("ck_flow_version_source_revision_nonnegative", type_="check")
        batch_op.drop_column("source_flow_hash")
        batch_op.drop_column("source_flow_revision")

    with op.batch_alter_table("flow", schema=None) as batch_op:
        batch_op.drop_column("revision")
