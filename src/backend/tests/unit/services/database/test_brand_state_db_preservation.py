from __future__ import annotations

from contextlib import asynccontextmanager, nullcontext
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from alembic.util.exc import CommandError
from ketos.services.database import service as database_service_module
from ketos.services.database.service import DatabaseService
from ketos.services.database.utils import initialize_database, is_unrecoverable_alembic_revision_error

EXPECTED_POSTGRESQL_SCHEMA_LOCK_ID = 0x4C616E67666C6F77
SERVICE_MODULE = "ketos.services.database.service"


def _engine_with_connection() -> tuple[MagicMock, MagicMock]:
    connection = MagicMock()
    connection.execute.return_value.scalar.return_value = True
    engine = MagicMock()
    engine.connect.return_value.__enter__.return_value = connection
    return engine, connection


def _executed_sql(connection: MagicMock) -> list[str]:
    return [str(call.args[0]) for call in connection.execute.call_args_list]


def test_postgresql_schema_lock_id_is_the_persisted_legacy_value() -> None:
    assert EXPECTED_POSTGRESQL_SCHEMA_LOCK_ID == 5503801610002526071
    assert (
        getattr(database_service_module, "POSTGRESQL_SCHEMA_MIGRATION_LOCK_ID", None)
        == EXPECTED_POSTGRESQL_SCHEMA_LOCK_ID
    )


def test_postgresql_schema_lock_does_not_hash_configured_namespace(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KETOS_MIGRATION_LOCK_NAMESPACE", "must-not-change-the-persisted-lock")
    engine, connection = _engine_with_connection()

    with (
        patch("ketos.utils.migration_lock.sa.create_engine", return_value=engine),
        database_service_module._postgres_migration_lock("postgresql://host/database"),
    ):
        pass

    assert _executed_sql(connection) == [
        f"SELECT pg_try_advisory_lock({EXPECTED_POSTGRESQL_SCHEMA_LOCK_ID})",
        f"SELECT pg_advisory_unlock({EXPECTED_POSTGRESQL_SCHEMA_LOCK_ID})",
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "message",
    [
        "Can't locate revision identified by 'removed-revision'",
        "Requested revision overlaps with other requested revisions",
    ],
)
async def test_initialize_database_fails_closed_without_dropping_revision_history(message: str) -> None:
    session = SimpleNamespace(exec=AsyncMock())

    @asynccontextmanager
    async def destructive_fallback_detector():
        yield session

    database = SimpleNamespace(
        database_url="sqlite://",
        settings_service=SimpleNamespace(settings=SimpleNamespace(database_connection_retry=False)),
        ensure_postgresql_version=AsyncMock(),
        create_db_and_tables=AsyncMock(),
        check_schema_health=AsyncMock(),
        run_migrations=AsyncMock(side_effect=[CommandError(message), None]),
    )

    with (
        patch("ketos.services.deps.get_db_service", return_value=database),
        patch("ketos.services.deps.session_scope", destructive_fallback_detector),
        pytest.raises(CommandError, match="revision"),
    ):
        await initialize_database()

    database.run_migrations.assert_awaited_once_with(fix=False)
    session.exec.assert_not_awaited()


@pytest.mark.asyncio
async def test_initialize_database_migrates_before_metadata_creation() -> None:
    calls: list[str] = []

    async def record_migrations(*, fix: bool = False) -> None:
        assert not fix
        calls.append("migrate")

    async def record_create() -> None:
        calls.append("create")

    database = SimpleNamespace(
        database_url="sqlite://",
        settings_service=SimpleNamespace(settings=SimpleNamespace(database_connection_retry=False)),
        ensure_postgresql_version=AsyncMock(),
        run_migrations=record_migrations,
        create_db_and_tables=record_create,
        check_schema_health=AsyncMock(),
    )

    with patch("ketos.services.deps.get_db_service", return_value=database):
        await initialize_database()

    assert calls == ["migrate", "create"]


def test_unknown_current_revision_never_attempts_upgrade() -> None:
    database = DatabaseService.__new__(DatabaseService)
    database.database_url = "sqlite://"
    database.script_location = Path("unused")
    database._open_alembic_log_buffer = lambda: nullcontext(StringIO())
    unknown_revision = CommandError("Can't locate revision identified by 'removed-revision'")

    with (
        patch(f"{SERVICE_MODULE}.command.check", side_effect=unknown_revision),
        patch(f"{SERVICE_MODULE}.command.upgrade") as upgrade,
        patch(f"{SERVICE_MODULE}.time.sleep"),
        pytest.raises(CommandError, match="removed-revision"),
    ):
        database._run_migrations(should_initialize_alembic=False, fix=False)

    upgrade.assert_not_called()


@pytest.mark.parametrize(
    "message",
    [
        "Multiple head revisions are present for given argument 'head'",
        "Requested revision overlaps with other requested revisions",
        "Database revision graph is ambiguous",
    ],
)
def test_ambiguous_revision_errors_never_attempt_upgrade(message: str) -> None:
    database = DatabaseService.__new__(DatabaseService)
    database.database_url = "sqlite://"
    database.script_location = Path("unused")
    database._open_alembic_log_buffer = lambda: nullcontext(StringIO())

    with (
        patch(f"{SERVICE_MODULE}.command.check", side_effect=CommandError(message)),
        patch(f"{SERVICE_MODULE}.command.upgrade") as upgrade,
        patch(f"{SERVICE_MODULE}.time.sleep"),
        pytest.raises(CommandError, match=r"revision|ambiguous|head"),
    ):
        database._run_migrations(should_initialize_alembic=False, fix=False)

    upgrade.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("current_revision", [None, "", "   "])
async def test_missing_current_revision_fails_before_migration_thread(current_revision: str | None) -> None:
    result = MagicMock()
    result.all.return_value = [current_revision]
    session = SimpleNamespace(exec=AsyncMock(return_value=result))

    @asynccontextmanager
    async def revision_session():
        yield session

    database = DatabaseService.__new__(DatabaseService)
    with (
        patch(f"{SERVICE_MODULE}.session_scope", revision_session),
        patch(f"{SERVICE_MODULE}.asyncio.to_thread", new=AsyncMock()) as to_thread,
        pytest.raises(CommandError, match="current revision is missing"),
    ):
        await database.run_migrations()

    to_thread.assert_not_awaited()


@pytest.mark.asyncio
async def test_revision_query_error_other_than_missing_table_fails_closed() -> None:
    session = SimpleNamespace(exec=AsyncMock(side_effect=PermissionError("permission denied")))

    @asynccontextmanager
    async def revision_session():
        yield session

    database = DatabaseService.__new__(DatabaseService)
    with (
        patch(f"{SERVICE_MODULE}.session_scope", revision_session),
        patch(f"{SERVICE_MODULE}.asyncio.to_thread", new=AsyncMock()) as to_thread,
        pytest.raises(PermissionError, match="permission denied"),
    ):
        await database.run_migrations()

    to_thread.assert_not_awaited()


@pytest.mark.asyncio
async def test_multiple_current_revisions_fail_closed() -> None:
    result = MagicMock()
    result.all.return_value = [("revision-a",), ("revision-b",)]
    session = SimpleNamespace(exec=AsyncMock(return_value=result))

    @asynccontextmanager
    async def revision_session():
        yield session

    database = DatabaseService.__new__(DatabaseService)
    with patch(f"{SERVICE_MODULE}.session_scope", revision_session), pytest.raises(CommandError, match="exactly one"):
        await database.run_migrations()


def test_destructive_fix_mode_never_downgrades_history() -> None:
    database = DatabaseService.__new__(DatabaseService)
    database.database_url = "sqlite://"
    database.script_location = Path("unused")
    database._open_alembic_log_buffer = lambda: nullcontext(StringIO())

    with (
        patch(
            f"{SERVICE_MODULE}.command.check",
            side_effect=[
                None,
                database_service_module.util.exc.AutogenerateDiffsDetected("drift", MagicMock(), []),
            ],
        ),
        patch(f"{SERVICE_MODULE}.command.downgrade") as downgrade,
        pytest.raises(RuntimeError, match="mismatch"),
    ):
        database._run_migrations(should_initialize_alembic=False, fix=True)

    downgrade.assert_not_called()


def test_complete_alembic_revision_history_remains_vendored() -> None:
    versions = Path(database_service_module.__file__).resolve().parents[2] / "alembic" / "versions"
    revision_files = sorted(path for path in versions.glob("*.py") if path.name != "__init__.py")

    assert len(revision_files) == 84
    assert any(path.name == "9a6e34f1c2d8_restrict_preferred_locale_to_ru_en.py" for path in revision_files)
    assert any(path.name == "505c0a700001_add_durable_chat_tables.py" for path in revision_files)
    assert any(path.name == "505c0a700002_restore_api_key_created_at_default.py" for path in revision_files)


@pytest.mark.parametrize(
    ("message", "unrecoverable"),
    [
        ("Target database is not up to date", False),
        ("  Target   database is not up to date.  ", False),
        ("Target database is not up to date; Multiple head revisions are present", True),
        ("Can't locate revision identified by 'removed-revision'", True),
    ],
)
def test_only_exact_approved_alembic_message_is_recoverable(message: str, unrecoverable: bool) -> None:
    assert is_unrecoverable_alembic_revision_error(CommandError(message)) is unrecoverable
