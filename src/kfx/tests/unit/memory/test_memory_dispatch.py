"""Regression tests for kfx.memory runtime dispatch.

Original bug: when ketos was installed alongside kfx but `kfx run` had
only a NoopDatabaseService registered, `kfx.memory` bound at import time to
`ketos.memory` (because the `ketos` package was importable). The
ketos-backed `aupdate_messages` then called `session.get(...)` on a
NoopSession, which always returns `None`, raising spurious
"Message with id X not found" errors mid-stream.
"""

from __future__ import annotations

import uuid

import pytest
from kfx.services.database.service import NoopDatabaseService
from kfx.utils.ketos_utils import has_ketos_db_backend


class _FakeRealDbService:
    """Stand-in for any non-noop DatabaseService implementation."""


class TestHasKetosDbBackend:
    def test_returns_false_when_ketos_not_importable(self, monkeypatch):
        monkeypatch.setattr("kfx.utils.ketos_utils.has_ketos_memory", lambda: False)
        assert has_ketos_db_backend() is False

    def test_returns_false_with_noop_db_service(self, monkeypatch):
        monkeypatch.setattr("kfx.utils.ketos_utils.has_ketos_memory", lambda: True)
        monkeypatch.setattr("kfx.services.deps.get_db_service", lambda: NoopDatabaseService())
        assert has_ketos_db_backend() is False

    def test_returns_true_with_real_db_service(self, monkeypatch):
        monkeypatch.setattr("kfx.utils.ketos_utils.has_ketos_memory", lambda: True)
        monkeypatch.setattr("kfx.services.deps.get_db_service", lambda: _FakeRealDbService())
        assert has_ketos_db_backend() is True

    def test_returns_false_when_get_db_service_raises(self, monkeypatch):
        monkeypatch.setattr("kfx.utils.ketos_utils.has_ketos_memory", lambda: True)

        def boom():
            msg = "service manager exploded"
            raise RuntimeError(msg)

        monkeypatch.setattr("kfx.services.deps.get_db_service", boom)
        assert has_ketos_db_backend() is False


class TestMemoryDispatch:
    def test_dispatches_to_stubs_when_no_real_db(self, monkeypatch):
        import kfx.memory as memory_mod
        from kfx.memory import stubs

        monkeypatch.setattr("kfx.memory.has_ketos_db_backend", lambda: False)
        assert memory_mod._impl() is stubs

    def test_dispatches_to_ketos_when_real_db(self, monkeypatch):
        pytest.importorskip("ketos.memory")
        import ketos.memory as ketos_memory
        import kfx.memory as memory_mod

        monkeypatch.setattr("kfx.memory.has_ketos_db_backend", lambda: True)
        assert memory_mod._impl() is ketos_memory

    def test_dispatch_is_evaluated_per_call(self, monkeypatch):
        """Dispatch must read the backend state each call, not cache at import.

        The database service is often registered *after* kfx.memory is imported
        (components load first, services register during graph setup), so
        memoizing the dispatcher would bind to whatever state existed at
        component-module load time.
        """
        import kfx.memory as memory_mod
        from kfx.memory import stubs

        state = {"real": False}
        monkeypatch.setattr("kfx.memory.has_ketos_db_backend", lambda: state["real"])

        assert memory_mod._impl() is stubs
        state["real"] = True
        pytest.importorskip("ketos.memory")
        import ketos.memory as ketos_memory

        assert memory_mod._impl() is ketos_memory


class TestAupdateMessagesRegression:
    """Direct regression for the original 'Message with id X not found' crash."""

    @pytest.mark.asyncio
    async def test_aupdate_messages_does_not_raise_against_noop_session(self, monkeypatch):
        """Regression: route to stubs (no-op) instead of raising via ketos.memory.

        With ketos importable but only a NoopDatabaseService registered,
        aupdate_messages must route to stubs and succeed silently rather than
        trigger ketos.memory's strict existence check against NoopSession.
        """
        try:
            from ketos.schema.message import Message
        except ImportError:
            from kfx.schema.message import Message

        # Force the noop-DB branch even if a real DB happens to be registered in
        # this test environment.
        monkeypatch.setattr("kfx.services.deps.get_db_service", lambda: NoopDatabaseService())

        from kfx.memory import aupdate_messages

        msg = Message(
            id=str(uuid.uuid4()),
            text="hello",
            sender="AI",
            sender_name="Test",
            session_id="test-session",
        )
        result = await aupdate_messages(msg)
        assert isinstance(result, list)
