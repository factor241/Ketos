from __future__ import annotations

import tempfile
from pathlib import Path

import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

WORKSPACE = Path(__file__).resolve().parents[5]
ALEMBIC_ROOT = WORKSPACE / "src/backend/base/ketos/alembic"
REVISION = "505c0a700002"
DOWN_REVISION = "505c0a700001"


def test_clean_upgrade_preserves_api_key_created_at_default() -> None:
    with tempfile.NamedTemporaryFile(suffix="-api-key-default.db", delete=False) as handle:
        path = Path(handle.name)
    uri = f"sqlite+aiosqlite:///{path}"
    config = Config()
    config.set_main_option("script_location", str(ALEMBIC_ROOT))
    config.set_main_option("sqlalchemy.url", uri)

    try:
        command.upgrade(config, "head")
        engine = sa.create_engine(uri.replace("sqlite+aiosqlite", "sqlite", 1))
        try:
            created_at = next(
                column for column in sa.inspect(engine).get_columns("apikey") if column["name"] == "created_at"
            )
            assert created_at["nullable"] is False
            assert created_at["default"] is not None
            with engine.begin() as connection:
                connection.execute(
                    sa.text(
                        "INSERT INTO apikey "
                        "(total_uses, is_active, id, api_key, user_id) "
                        "VALUES (0, true, :id, :api_key, :user_id)"
                    ),
                    {
                        "id": "11111111111141118111111111111111",
                        "api_key": "regression-key",
                        "user_id": "22222222222242228222222222222222",
                    },
                )
                assert connection.scalar(sa.text("SELECT created_at FROM apikey")) is not None
        finally:
            engine.dispose()
    finally:
        for suffix in ("", "-wal", "-shm", "-journal"):
            Path(f"{path}{suffix}").unlink(missing_ok=True)


def test_api_key_default_revision_is_the_single_head() -> None:
    config = Config()
    config.set_main_option("script_location", str(ALEMBIC_ROOT))
    script = ScriptDirectory.from_config(config)

    migration = script.get_revision(REVISION)
    assert migration is not None
    assert migration.down_revision == DOWN_REVISION
    assert script.get_heads() == [REVISION]
