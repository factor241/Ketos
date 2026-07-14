"""Tests for the schema-migration advisory lock.

Workers booting concurrently against a fresh Postgres race on
``CREATE TYPE`` / ``CREATE TABLE`` because each calls ``alembic upgrade``
independently. ``_postgres_migration_lock`` holds a session-level
``pg_advisory_lock`` for the duration of the upgrade so only one worker
mutates the schema at a time. The lock is acquired via ``pg_try_advisory_lock``
in a bounded polling loop so a hung holder can't block every other worker
forever; the wait emits a log line and times out with an actionable error.

Mocking ``sa.create_engine`` here so the test runs without a real Postgres
instance. The unit under test is the orchestration: which SQL gets executed,
in what order, on which kinds of URLs.
"""

from __future__ import annotations

from contextlib import nullcontext
from io import StringIO
from typing import TYPE_CHECKING
from unittest.mock import MagicMock, patch

import pytest
from ketos.services.database.service import (
    POSTGRESQL_SCHEMA_MIGRATION_LOCK_ID as _MIGRATION_ADVISORY_LOCK_ID,
)
from ketos.services.database.service import _postgres_migration_lock

if TYPE_CHECKING:
    from pathlib import Path

_PG_URL = "postgresql+psycopg://host/db"
_SQLITE_URL = "sqlite+aiosqlite:///./ketos.db"
_SERVICE = "ketos.services.database.service"
_LOCK = "ketos.utils.migration_lock"
_CREATE_ENGINE_PATH = f"{_LOCK}.sa.create_engine"

_BOOM_MESSAGE = "migration exploded"


class _BoomError(RuntimeError):
    """Sentinel exception used to verify the lock releases on failure."""


def _engine_with_conn(*, scalar_returns: list[bool] | bool) -> tuple[MagicMock, MagicMock]:
    """Build a (engine, conn) mock pair where each execute().scalar() returns the next bool."""
    conn_mock = MagicMock()
    if isinstance(scalar_returns, bool):
        conn_mock.execute.return_value.scalar.return_value = scalar_returns
    else:
        conn_mock.execute.return_value.scalar.side_effect = scalar_returns
    engine_mock = MagicMock()
    engine_mock.connect.return_value.__enter__.return_value = conn_mock
    return engine_mock, conn_mock


def _executed_sql(conn_mock: MagicMock) -> list[str]:
    """Return the raw SQL text of each ``execute`` call on a mocked connection."""
    return [str(call.args[0]) for call in conn_mock.execute.call_args_list]


def test_lock_id_is_fixed_and_shared_with_alembic(monkeypatch):
    from ketos.utils.migration_lock import MIGRATION_ADVISORY_LOCK_ID, acquire_transaction_lock, migration_lock_id

    monkeypatch.setenv("KETOS_MIGRATION_LOCK_NAMESPACE", "ketos-test-namespace")
    conn = MagicMock()
    lock_id = acquire_transaction_lock(conn)
    assert lock_id == _MIGRATION_ADVISORY_LOCK_ID == MIGRATION_ADVISORY_LOCK_ID
    assert migration_lock_id() == migration_lock_id("ignored-legacy-namespace") == _MIGRATION_ADVISORY_LOCK_ID
    assert any(f"pg_advisory_xact_lock({lock_id})" in sql for sql in _executed_sql(conn))


@pytest.mark.parametrize("configured_namespace", ["", "   ", "leading", "legacy:schema-migrations"])
def test_configured_lock_namespace_cannot_change_persisted_lock(monkeypatch, configured_namespace: str):
    from ketos.utils.migration_lock import migration_lock_id

    monkeypatch.setenv("KETOS_MIGRATION_LOCK_NAMESPACE", configured_namespace)
    assert migration_lock_id() == _MIGRATION_ADVISORY_LOCK_ID


@pytest.mark.parametrize("invalid_timeout", ["invalid", "0", "-1"])
def test_invalid_lock_timeout_falls_back_to_positive_default(monkeypatch, invalid_timeout: str):
    from ketos.utils.migration_lock import DEFAULT_TIMEOUT_S, migration_lock_timeout_s

    monkeypatch.setenv("KETOS_MIGRATION_LOCK_TIMEOUT_S", invalid_timeout)
    assert migration_lock_timeout_s() == DEFAULT_TIMEOUT_S


def test_service_owned_lock_marks_nested_alembic_upgrade_and_skips_second_connection_lock(tmp_path: Path):
    """command.upgrade on connection B must not reacquire the lock held by service connection A."""
    from ketos.services.database.service import DatabaseService
    from ketos.utils.migration_lock import acquire_transaction_lock

    service = DatabaseService.__new__(DatabaseService)
    service.database_url = _PG_URL
    service.script_location = tmp_path / "alembic"
    service._open_alembic_log_buffer = lambda: nullcontext(StringIO())

    def nested_upgrade(config, revision):
        assert revision == "head"
        held = config.attributes.get("ketos_migration_lock_held", False)
        assert held is True
        connection_b = MagicMock()
        assert acquire_transaction_lock(connection_b, already_held=held) is None
        connection_b.execute.assert_not_called()

    with (
        patch(f"{_SERVICE}._postgres_migration_lock") as lock_context,
        patch(f"{_SERVICE}.command.ensure_version"),
        patch(f"{_SERVICE}.command.upgrade", side_effect=nested_upgrade),
        patch(f"{_SERVICE}.command.check"),
    ):
        lock_context.return_value.__enter__.return_value = None
        service._run_migrations(should_initialize_alembic=True, fix=False)


def test_sqlite_url_is_a_noop_no_engine_created():
    """SQLite has no advisory locks; entering the lock must not touch SQLAlchemy."""
    with (
        patch(_CREATE_ENGINE_PATH) as create_engine_mock,
        _postgres_migration_lock(_SQLITE_URL),
    ):
        pass

    create_engine_mock.assert_not_called()


def test_postgres_url_acquires_and_releases_advisory_lock():
    """Happy path: pg_try_advisory_lock succeeds first try, unlock runs after."""
    engine_mock, conn_mock = _engine_with_conn(scalar_returns=True)

    with (
        patch(_CREATE_ENGINE_PATH, return_value=engine_mock),
        _postgres_migration_lock(_PG_URL),
    ):
        mid_block_calls = _executed_sql(conn_mock).copy()

    all_calls = _executed_sql(conn_mock)

    assert mid_block_calls == [f"SELECT pg_try_advisory_lock({_MIGRATION_ADVISORY_LOCK_ID})"]
    assert all_calls == [
        f"SELECT pg_try_advisory_lock({_MIGRATION_ADVISORY_LOCK_ID})",
        f"SELECT pg_advisory_unlock({_MIGRATION_ADVISORY_LOCK_ID})",
    ]
    engine_mock.dispose.assert_called_once()


def test_postgres_lock_waits_then_acquires_when_another_worker_holds():
    """First try fails (lock held); after polling, second try succeeds."""
    engine_mock, conn_mock = _engine_with_conn(scalar_returns=[False, True])

    with (
        patch(_CREATE_ENGINE_PATH, return_value=engine_mock),
        patch(f"{_LOCK}.time.sleep") as sleep_mock,
        patch(f"{_LOCK}.time.monotonic", side_effect=[0.0, 0.0, 1.0]),
        _postgres_migration_lock(_PG_URL),
    ):
        pass

    sql = _executed_sql(conn_mock)
    try_lock = f"SELECT pg_try_advisory_lock({_MIGRATION_ADVISORY_LOCK_ID})"
    assert sql.count(try_lock) == 2, sql
    assert sql[-1] == f"SELECT pg_advisory_unlock({_MIGRATION_ADVISORY_LOCK_ID})"
    sleep_mock.assert_called()  # waited at least one poll interval


def test_postgres_lock_times_out_when_holder_never_releases():
    """If pg_try_advisory_lock never succeeds, raise with an actionable message."""
    engine_mock, conn_mock = _engine_with_conn(scalar_returns=False)

    # monotonic: pre-call once, then once per loop iteration. Deadline crossed quickly.
    with (
        patch(_CREATE_ENGINE_PATH, return_value=engine_mock),
        patch(f"{_LOCK}.time.sleep"),
        patch(f"{_LOCK}.time.monotonic", side_effect=[0.0, 0.0, 999.0]),
        pytest.raises(RuntimeError, match="Could not acquire migration advisory lock"),
        _postgres_migration_lock(_PG_URL),
    ):
        pytest.fail("body should not run when lock times out")  # pragma: no cover

    # Engine must still be disposed even after timeout.
    engine_mock.dispose.assert_called_once()
    # And we must not have called pg_advisory_unlock for a lock we never held.
    sql = _executed_sql(conn_mock)
    assert all("pg_advisory_unlock" not in stmt for stmt in sql)


def test_postgres_lock_released_when_block_raises():
    """If the wrapped block raises, the lock must still be released and engine disposed."""
    engine_mock, conn_mock = _engine_with_conn(scalar_returns=True)

    with (
        patch(_CREATE_ENGINE_PATH, return_value=engine_mock),
        pytest.raises(_BoomError),
        _postgres_migration_lock(_PG_URL),
    ):
        raise _BoomError(_BOOM_MESSAGE)

    sql = _executed_sql(conn_mock)
    assert f"SELECT pg_advisory_unlock({_MIGRATION_ADVISORY_LOCK_ID})" in sql
    engine_mock.dispose.assert_called_once()


@pytest.mark.parametrize(
    ("raw_url", "expected_url"),
    [
        ("postgresql+asyncpg://host/db", "postgresql://host/db"),
        ("postgres://host/db", "postgresql://host/db"),
        ("postgresql+psycopg://host/db", "postgresql+psycopg://host/db"),
    ],
)
def test_postgres_url_normalised_to_sync_driver(raw_url: str, expected_url: str):
    """Async driver suffixes must be stripped so create_engine picks a sync driver."""
    engine_mock, _ = _engine_with_conn(scalar_returns=True)

    with (
        patch(_CREATE_ENGINE_PATH, return_value=engine_mock) as create_engine_mock,
        _postgres_migration_lock(raw_url),
    ):
        pass

    create_engine_mock.assert_called_once_with(expected_url)


def test_create_db_and_tables_with_lock_holds_advisory_lock_for_postgres():
    """The locked sync DDL path acquires the lock, runs the DDL, then releases.

    Concurrent workers booting against a fresh PG raced on ``CREATE TYPE``
    inside ``create_db_and_tables`` because the advisory lock previously only
    covered ``run_migrations``. This verifies the new path holds the lock
    around the DDL.
    """
    from ketos.services.database.service import DatabaseService

    lock_engine_mock, lock_conn_mock = _engine_with_conn(scalar_returns=True)
    ddl_engine_mock = MagicMock()
    ddl_conn_mock = MagicMock()
    ddl_engine_mock.begin.return_value.__enter__.return_value = ddl_conn_mock

    service = DatabaseService.__new__(DatabaseService)
    service.database_url = _PG_URL

    create_db_mock = MagicMock()
    with (
        patch(_CREATE_ENGINE_PATH, side_effect=[lock_engine_mock, ddl_engine_mock]) as create_engine_mock,
        patch.object(DatabaseService, "_create_db_and_tables", staticmethod(create_db_mock)),
    ):
        service._create_db_and_tables_with_lock()

    # Two sync engines created: one for the lock, one for the DDL.
    assert create_engine_mock.call_count == 2
    # The DDL ran while the lock was held: unlock is the last call on the lock conn.
    lock_sql = _executed_sql(lock_conn_mock)
    assert lock_sql[0] == f"SELECT pg_try_advisory_lock({_MIGRATION_ADVISORY_LOCK_ID})"
    assert lock_sql[-1] == f"SELECT pg_advisory_unlock({_MIGRATION_ADVISORY_LOCK_ID})"
    # The DDL was passed the DDL engine's connection, not the lock connection.
    create_db_mock.assert_called_once_with(ddl_conn_mock)
    # Both engines disposed even on the happy path.
    lock_engine_mock.dispose.assert_called_once()
    ddl_engine_mock.dispose.assert_called_once()


@pytest.mark.asyncio
async def test_create_db_and_tables_uses_lock_on_postgres():
    """``create_db_and_tables`` dispatches to the locked sync path on Postgres."""
    from ketos.services.database.service import DatabaseService

    service = DatabaseService.__new__(DatabaseService)
    service.database_url = _PG_URL

    with patch.object(DatabaseService, "_create_db_and_tables_with_lock") as locked_mock:
        await service.create_db_and_tables()

    locked_mock.assert_called_once()


@pytest.mark.asyncio
async def test_create_db_and_tables_skips_lock_on_sqlite():
    """SQLite preserves the original async path; the lock helper is never invoked."""
    from ketos.services.database.service import DatabaseService

    service = DatabaseService.__new__(DatabaseService)
    service.database_url = _SQLITE_URL

    async_engine = MagicMock()
    async_conn = MagicMock()

    class _AsyncCM:
        async def __aenter__(self):
            return async_conn

        async def __aexit__(self, *exc):
            return False

    async_engine.begin.return_value = _AsyncCM()
    async_conn.run_sync = MagicMock(return_value=None)

    async def _await_none(*_a, **_kw):
        return None

    async_conn.run_sync = _await_none  # awaited inside create_db_and_tables
    service.engine = async_engine

    with patch.object(DatabaseService, "_create_db_and_tables_with_lock") as locked_mock:
        await service.create_db_and_tables()

    locked_mock.assert_not_called()
    async_engine.begin.assert_called_once()
