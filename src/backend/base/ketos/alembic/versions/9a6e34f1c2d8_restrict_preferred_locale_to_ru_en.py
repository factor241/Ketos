"""Restrict user preferred_locale values to ru/en.

Revision ID: 9a6e34f1c2d8
Revises: bb693ad2fbab
Create Date: 2026-07-15

This is an irreversible data cleanup. English regional tags become ``en``;
Russian regional tags and any other non-NULL values become ``ru``, the new
server default. NULL remains the implicit server-default preference.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9a6e34f1c2d8"  # pragma: allowlist secret
down_revision: str | None = "bb693ad2fbab"  # pragma: allowlist secret
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    user = sa.table("user", sa.column("preferred_locale", sa.String()))
    normalized = sa.func.lower(sa.func.replace(sa.func.trim(user.c.preferred_locale), "_", "-"))

    # Preserve the explicit English choice while canonicalizing its regional
    # and case variants. The separator avoids accepting rubbish like "english".
    conn.execute(
        user.update()
        .where(
            sa.and_(
                user.c.preferred_locale.is_not(None),
                sa.or_(normalized == "en", normalized.like("en-%")),
            )
        )
        .values(preferred_locale="en")
    )

    # Exact ru is already canonical. This also canonicalizes ru-* and maps all
    # removed/unknown non-NULL locales to the new product default.
    conn.execute(
        user.update()
        .where(
            sa.and_(
                user.c.preferred_locale.is_not(None),
                user.c.preferred_locale.not_in(("ru", "en")),
            )
        )
        .values(preferred_locale="ru")
    )


def downgrade() -> None:
    """Leave cleaned values unchanged because their original locales are lost."""
