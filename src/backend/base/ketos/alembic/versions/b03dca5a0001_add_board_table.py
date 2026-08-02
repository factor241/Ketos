"""Add Board persistence.

Revision ID: b03dca5a0001
Revises: 9a6e34f1c2d8
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b03dca5a0001"
down_revision: str | None = "9a6e34f1c2d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "board",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("viewport_x", sa.Double(), server_default=sa.text("0"), nullable=False),
        sa.Column("viewport_y", sa.Double(), server_default=sa.text("0"), nullable=False),
        sa.Column("viewport_zoom", sa.Double(), server_default=sa.text("1"), nullable=False),
        sa.Column("revision", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("length(title) BETWEEN 1 AND 255", name="ck_board_title_length"),
        sa.CheckConstraint("viewport_zoom BETWEEN 0.5 AND 2", name="ck_board_viewport_zoom_range"),
        sa.CheckConstraint("revision >= 0", name="ck_board_revision_nonnegative"),
        sa.ForeignKeyConstraint(
            ["created_by_id"], ["user.id"], name="fk_board_created_by_id_user", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["folder.id"], name="fk_board_project_id_folder", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_board"),
    )
    op.create_index(op.f("ix_board_project_id"), "board", ["project_id"], unique=False)
    op.create_index(op.f("ix_board_created_by_id"), "board", ["created_by_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_board_created_by_id"), table_name="board")
    op.drop_index(op.f("ix_board_project_id"), table_name="board")
    op.drop_table("board")
