"""Real-PostgreSQL proof for the migration advisory-lock contract."""

from __future__ import annotations

import os
import threading
import time
import uuid

import pytest
import sqlalchemy as sa
from ketos.utils import migration_lock


def _postgres_url() -> str:
    url = os.getenv("KETOS_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("KETOS_TEST_POSTGRES_URL is required for real PostgreSQL lock proof")
    return url


@pytest.fixture
def postgres_url(monkeypatch) -> str:
    url = _postgres_url()
    monkeypatch.setenv("KETOS_MIGRATION_LOCK_NAMESPACE", f"ketos-task10-{uuid.uuid4()}")
    monkeypatch.setattr(migration_lock, "POLL_INTERVAL_S", 0.02)
    return url


def test_connection_a_session_lock_makes_alembic_connection_b_skip(postgres_url: str):
    lock_id = migration_lock.migration_lock_id()
    engine = sa.create_engine(postgres_url)
    try:
        with engine.connect() as connection_a, engine.connect() as connection_b:
            migration_lock.acquire_session_lock(connection_a, lock_id)

            # DatabaseService marks Alembic's distinct connection B as already covered
            # by connection A, so Alembic must not wait on its own transaction lock.
            assert migration_lock.acquire_transaction_lock(connection_b, already_held=True) is None
            blocked = connection_b.execute(
                sa.text("SELECT pg_try_advisory_lock(:lock_id)"), {"lock_id": lock_id}
            ).scalar()
            assert blocked is False

            assert connection_a.execute(sa.text("SELECT pg_advisory_unlock(:lock_id)"), {"lock_id": lock_id}).scalar()
            assert connection_b.execute(sa.text("SELECT pg_try_advisory_lock(:lock_id)"), {"lock_id": lock_id}).scalar()
            assert connection_b.execute(sa.text("SELECT pg_advisory_unlock(:lock_id)"), {"lock_id": lock_id}).scalar()
    finally:
        engine.dispose()


def test_waiter_acquires_after_holder_releases(postgres_url: str, monkeypatch):
    monkeypatch.setenv("KETOS_MIGRATION_LOCK_TIMEOUT_S", "2")
    lock_id = migration_lock.migration_lock_id()
    engine = sa.create_engine(postgres_url)
    acquired = threading.Event()
    errors: list[BaseException] = []

    def wait_for_lock() -> None:
        try:
            with engine.connect() as waiter:
                migration_lock.acquire_session_lock(waiter, lock_id)
                acquired.set()
                waiter.execute(sa.text("SELECT pg_advisory_unlock(:lock_id)"), {"lock_id": lock_id})
        except BaseException as exc:  # pragma: no cover - asserted through errors
            errors.append(exc)

    try:
        with engine.connect() as holder:
            migration_lock.acquire_session_lock(holder, lock_id)
            thread = threading.Thread(target=wait_for_lock, daemon=True)
            thread.start()
            time.sleep(0.08)
            assert not acquired.is_set()
            holder.execute(sa.text("SELECT pg_advisory_unlock(:lock_id)"), {"lock_id": lock_id})
            thread.join(timeout=2)
        assert not thread.is_alive()
        assert errors == []
        assert acquired.is_set()
    finally:
        engine.dispose()


def test_waiter_times_out_while_holder_keeps_lock(postgres_url: str, monkeypatch):
    monkeypatch.setenv("KETOS_MIGRATION_LOCK_TIMEOUT_S", "0.08")
    lock_id = migration_lock.migration_lock_id()
    engine = sa.create_engine(postgres_url)
    try:
        with engine.connect() as holder, engine.connect() as waiter:
            migration_lock.acquire_session_lock(holder, lock_id)
            with pytest.raises(RuntimeError, match="Could not acquire migration advisory lock"):
                migration_lock.acquire_session_lock(waiter, lock_id)
            assert holder.execute(sa.text("SELECT pg_advisory_unlock(:lock_id)"), {"lock_id": lock_id}).scalar()
    finally:
        engine.dispose()
