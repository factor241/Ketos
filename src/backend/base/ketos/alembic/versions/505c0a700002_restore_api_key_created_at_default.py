"""Restore the API key creation timestamp server default.

Revision ID: 505c0a700002
Revises: 505c0a700001
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "505c0a700002"
down_revision: str | None = "505c0a700001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("apikey", schema=None) as batch_op:
        batch_op.alter_column(
            "created_at",
            existing_type=sa.DateTime(timezone=True),
            existing_nullable=False,
            server_default=sa.func.now(),
        )


def downgrade() -> None:
    with op.batch_alter_table("apikey", schema=None) as batch_op:
        batch_op.alter_column(
            "created_at",
            existing_type=sa.DateTime(timezone=True),
            existing_nullable=False,
            server_default=None,
        )
