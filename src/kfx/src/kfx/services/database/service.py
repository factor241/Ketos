"""Database service implementations for kfx package."""

from __future__ import annotations

from contextlib import asynccontextmanager


class NoopDatabaseService:
    """No-operation database service for standalone kfx usage.

    This provides a database service interface that always returns NoopSession,
    allowing kfx to work without a real database connection.
    """

    @asynccontextmanager
    async def _with_session(self):
        """Internal method to create a session. DO NOT USE DIRECTLY.

        Use session_scope() for write operations or session_scope_readonly() for read operations.
        This method does not handle commits - it only provides a raw session.
        """
        from kfx.services.session import NoopSession

        async with NoopSession() as session:
            yield session
