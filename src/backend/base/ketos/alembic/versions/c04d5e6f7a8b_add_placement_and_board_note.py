"""Add Placement and BoardNote persistence.

Revision ID: c04d5e6f7a8b
Revises: b03dca5a0001
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c04d5e6f7a8b"
down_revision: str | None = "b03dca5a0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_HEX_DB_CHECK = " AND ".join(
    f"(substr(color, {index}, 1) BETWEEN '0' AND '9' OR "
    f"substr(color, {index}, 1) BETWEEN 'A' AND 'F' OR "
    f"substr(color, {index}, 1) BETWEEN 'a' AND 'f')"
    for index in range(2, 8)
)


def upgrade() -> None:
    op.create_table(
        "board_note",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        sa.Column("content", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("color", sa.String(length=32), server_default=sa.text("'neutral'"), nullable=False),
        sa.Column("revision", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("length(content) <= 10000", name="ck_board_note_content_length"),
        sa.CheckConstraint(
            "color IN ('neutral', 'yellow', 'green', 'blue', 'violet', 'pink') OR "
            f"(length(color) = 7 AND substr(color, 1, 1) = '#' AND {_HEX_DB_CHECK})",
            name="ck_board_note_color_values",
        ),
        sa.CheckConstraint("revision >= 0", name="ck_board_note_revision_nonnegative"),
        sa.ForeignKeyConstraint(
            ["project_id"], ["folder.id"], name="fk_board_note_project_id_folder", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"], ["user.id"], name="fk_board_note_created_by_id_user", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_board_note"),
    )
    op.create_index(op.f("ix_board_note_project_id"), "board_note", ["project_id"], unique=False)
    op.create_index(op.f("ix_board_note_created_by_id"), "board_note", ["created_by_id"], unique=False)

    op.create_table(
        "placement",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("board_id", sa.Uuid(), nullable=False),
        sa.Column(
            "target_kind",
            sa.Enum("note", "chat", "automation", "job_result", name="placement_target_kind", native_enum=False),
            nullable=False,
        ),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("x", sa.Double(), nullable=False),
        sa.Column("y", sa.Double(), nullable=False),
        sa.Column("width", sa.Double(), server_default=sa.text("320"), nullable=False),
        sa.Column("height", sa.Double(), server_default=sa.text("240"), nullable=False),
        sa.Column("z_index", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "display_state",
            sa.Enum("normal", "collapsed", "maximized", name="placement_display_state", native_enum=False),
            server_default=sa.text("'normal'"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "target_kind IN ('note', 'chat', 'automation', 'job_result')",
            name="ck_placement_target_kind_values",
        ),
        sa.CheckConstraint(
            "display_state IN ('normal', 'collapsed', 'maximized')",
            name="ck_placement_display_state_values",
        ),
        sa.CheckConstraint("x BETWEEN -1000000 AND 1000000", name="ck_placement_x_range"),
        sa.CheckConstraint("y BETWEEN -1000000 AND 1000000", name="ck_placement_y_range"),
        sa.CheckConstraint("width BETWEEN 240 AND 1600", name="ck_placement_width_range"),
        sa.CheckConstraint("height BETWEEN 160 AND 1200", name="ck_placement_height_range"),
        sa.CheckConstraint("z_index BETWEEN 0 AND 1000000", name="ck_placement_z_index_range"),
        sa.CheckConstraint("revision >= 0", name="ck_placement_revision_nonnegative"),
        sa.ForeignKeyConstraint(["board_id"], ["board.id"], name="fk_placement_board_id_board", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_placement"),
        sa.UniqueConstraint("board_id", "target_kind", "target_id", name="uq_placement_board_target"),
    )
    op.create_index(op.f("ix_placement_board_id"), "placement", ["board_id"], unique=False)
    op.create_index(op.f("ix_placement_target_id"), "placement", ["target_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_placement_target_id"), table_name="placement")
    op.drop_index(op.f("ix_placement_board_id"), table_name="placement")
    op.drop_table("placement")
    op.drop_index(op.f("ix_board_note_created_by_id"), table_name="board_note")
    op.drop_index(op.f("ix_board_note_project_id"), table_name="board_note")
    op.drop_table("board_note")
