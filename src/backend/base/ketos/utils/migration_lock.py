"""Single Ketos migration-lock contract shared by startup and Alembic."""

from __future__ import annotations

import hashlib
import os
import time
from contextlib import contextmanager

import sqlalchemy as sa
from kfx.log.logger import logger

DEFAULT_NAMESPACE = "ketos:schema-migrations"
DEFAULT_TIMEOUT_S = 300.0
POLL_INTERVAL_S = 2.0


def migration_lock_id(namespace: str | None = None) -> int:
    configured = namespace if namespace is not None else os.getenv("KETOS_MIGRATION_LOCK_NAMESPACE")
    if configured is None:
        value = DEFAULT_NAMESPACE
    elif not configured or configured != configured.strip():
        logger.warning("Invalid migration lock namespace; using canonical default")
        value = DEFAULT_NAMESPACE
    else:
        value = configured
    return int.from_bytes(hashlib.sha256(value.encode()).digest()[:8], "big") % (2**63 - 1)


MIGRATION_ADVISORY_LOCK_ID = migration_lock_id(DEFAULT_NAMESPACE)


def migration_lock_timeout_s() -> float:
    raw = os.getenv("KETOS_MIGRATION_LOCK_TIMEOUT_S")
    if raw is None:
        return DEFAULT_TIMEOUT_S
    try:
        timeout = float(raw)
        if timeout <= 0:
            raise ValueError
    except ValueError:
        logger.warning("Invalid KETOS_MIGRATION_LOCK_TIMEOUT_S=%r; using %.0fs", raw, DEFAULT_TIMEOUT_S)
        return DEFAULT_TIMEOUT_S
    return timeout


def acquire_session_lock(conn, lock_id: int) -> None:
    if conn.execute(sa.text(f"SELECT pg_try_advisory_lock({lock_id})")).scalar():
        return
    timeout = migration_lock_timeout_s()
    deadline = time.monotonic() + timeout
    logger.info("Ketos migration lock %s is held; waiting up to %.0fs", lock_id, timeout)
    while time.monotonic() < deadline:
        time.sleep(POLL_INTERVAL_S)
        if conn.execute(sa.text(f"SELECT pg_try_advisory_lock({lock_id})")).scalar():
            return
    msg = (
        f"Could not acquire migration advisory lock {lock_id} within {timeout:.0f}s. "
        "Stop other Ketos processes or investigate the migration holder."
    )
    raise RuntimeError(msg)


def acquire_transaction_lock(
    conn,
    namespace: str | None = None,
    *,
    already_held: bool = False,
) -> int | None:
    """Acquire Alembic's transaction-scoped form of the canonical lock."""
    if already_held:
        return None
    lock_id = migration_lock_id(namespace)
    timeout_ms = max(1, int(migration_lock_timeout_s() * 1000))
    conn.execute(sa.text(f"SET LOCAL lock_timeout = '{timeout_ms}ms';"))
    conn.execute(sa.text(f"SELECT pg_advisory_xact_lock({lock_id});"))
    return lock_id


def normalize_sync_postgres_url(database_url: str) -> str:
    sync_url = database_url
    if sync_url.startswith("postgres://"):
        sync_url = "postgresql://" + sync_url.split("://", 1)[1]
    for async_driver in ("+asyncpg", "+aiosqlite"):
        sync_url = sync_url.replace(async_driver, "")
    return sync_url


@contextmanager
def postgres_migration_lock(database_url: str):
    if not database_url.startswith(("postgresql", "postgres")):
        yield
        return
    lock_id = migration_lock_id()
    engine = sa.create_engine(normalize_sync_postgres_url(database_url))
    try:
        with engine.connect() as conn:
            acquire_session_lock(conn, lock_id)
            try:
                yield
            finally:
                conn.execute(sa.text(f"SELECT pg_advisory_unlock({lock_id})"))
    finally:
        engine.dispose()
