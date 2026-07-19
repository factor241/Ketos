"""Durable actor/thread/run ownership for the admitted AG-UI dispatch hook.

A10 wires :func:`get_current_ag_ui_user` as the route dependency and the hook
returned by :func:`create_ag_ui_before_dispatch` as ``before_dispatch``.  This
database is an authorization authority separate from the A08 checkpoint file;
neither file owns the other's lifecycle or deletion.
"""

from __future__ import annotations

import asyncio
import os
import sqlite3
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ag_ui.core.types import RunAgentInput
from ag_ui_langgraph import LangGraphAgent
from fastapi import HTTPException, Request, status

from ketos.agentic.services.ag_ui.auth import AG_UI_ACTOR_STATE_KEY
from ketos.services.deps import get_settings_service

BINDING_DB_ENV = "KETOS_AG_UI_BINDING_DB"
MAX_BINDING_IDENTIFIER_LENGTH = 256
_DEFAULT_RELATIVE_PATH = Path("agentic") / "ag_ui" / "run-bindings.sqlite3"
_SCHEMA = """
CREATE TABLE IF NOT EXISTS thread_binding (
    thread_id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_binding (
    run_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    FOREIGN KEY (thread_id) REFERENCES thread_binding(thread_id)
);
"""


class RunBindingDeniedError(Exception):
    """Raised when an existing durable ownership record conflicts."""


def resolve_run_binding_path() -> Path:
    """Resolve the local-only binding DB path without reading AG-UI input."""
    configured = os.environ.get(BINDING_DB_ENV)
    if configured is not None:
        candidate = Path(configured).expanduser()
        if configured == ":memory:" or "://" in configured or not candidate.is_absolute():
            msg = f"{BINDING_DB_ENV} must be an absolute local filesystem path"
            raise ValueError(msg)
        return candidate

    data_dir = get_settings_service().settings.data_dir
    if not data_dir:
        msg = "Ketos data_dir is required for the AG-UI binding database"
        raise RuntimeError(msg)
    return Path(data_dir) / _DEFAULT_RELATIVE_PATH


def _validate_identifier(value: object, *, name: str) -> str:
    if not isinstance(value, str) or not value or len(value) > MAX_BINDING_IDENTIFIER_LENGTH:
        msg = f"Invalid AG-UI {name}"
        raise ValueError(msg)
    return value


@dataclass(frozen=True)
class RunBindingStore:
    """One-file SQLite ownership authority with atomic claim-or-deny."""

    path: Path
    timeout_seconds: float = 5.0

    def __init__(self, path: str | Path, *, timeout_seconds: float = 5.0) -> None:
        object.__setattr__(self, "path", Path(path))
        object.__setattr__(self, "timeout_seconds", timeout_seconds)

    async def claim(self, *, thread_id: str, run_id: str, actor_id: str) -> None:
        """Atomically claim a thread and a never-before-used run identifier."""
        checked_thread_id = _validate_identifier(thread_id, name="thread id")
        checked_run_id = _validate_identifier(run_id, name="run id")
        checked_actor_id = _validate_identifier(actor_id, name="actor id")
        await asyncio.to_thread(
            self._claim_sync,
            thread_id=checked_thread_id,
            run_id=checked_run_id,
            actor_id=checked_actor_id,
        )

    def _prepare_path(self) -> None:
        parent_existed = self.path.parent.exists()
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.path.parent.is_symlink() or not self.path.parent.is_dir():
            msg = "AG-UI binding database parent must be a real directory"
            raise ValueError(msg)
        if not parent_existed:
            self.path.parent.chmod(0o700)
        if self.path.is_symlink() or (self.path.exists() and not self.path.is_file()):
            msg = "AG-UI binding database must be a regular local file"
            raise ValueError(msg)

    def _claim_sync(self, *, thread_id: str, run_id: str, actor_id: str) -> None:
        self._prepare_path()
        connection = sqlite3.connect(
            self.path,
            isolation_level=None,
            timeout=self.timeout_seconds,
        )
        try:
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute(f"PRAGMA busy_timeout={int(self.timeout_seconds * 1000)}")
            connection.executescript(_SCHEMA)
            connection.execute("BEGIN IMMEDIATE")
            try:
                thread_owner = connection.execute(
                    "SELECT actor_id FROM thread_binding WHERE thread_id = ?",
                    (thread_id,),
                ).fetchone()
                if thread_owner is None:
                    connection.execute(
                        "INSERT INTO thread_binding (thread_id, actor_id) VALUES (?, ?)",
                        (thread_id, actor_id),
                    )
                elif thread_owner[0] != actor_id:
                    raise RunBindingDeniedError

                if (
                    connection.execute(
                        "SELECT 1 FROM run_binding WHERE run_id = ?",
                        (run_id,),
                    ).fetchone()
                    is not None
                ):
                    raise RunBindingDeniedError

                connection.execute(
                    "INSERT INTO run_binding (run_id, thread_id, actor_id) VALUES (?, ?, ?)",
                    (run_id, thread_id, actor_id),
                )
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        except sqlite3.IntegrityError as exc:
            raise RunBindingDeniedError from exc
        finally:
            connection.close()

        if self.path.is_symlink() or not self.path.is_file():
            msg = "AG-UI binding database was not created as a regular file"
            raise ValueError(msg)
        self.path.chmod(0o600)


BeforeDispatchHook = Callable[[RunAgentInput, Request, LangGraphAgent], Awaitable[None]]


def create_ag_ui_before_dispatch(store: RunBindingStore | None = None) -> BeforeDispatchHook:
    """Create the admitted post-clone, pre-run ownership hook for A10 wiring."""
    binding_store = store or RunBindingStore(resolve_run_binding_path())

    async def before_dispatch(
        input_data: RunAgentInput,
        request: Request,
        request_agent: LangGraphAgent,
    ) -> None:
        actor_id = getattr(request.state, AG_UI_ACTOR_STATE_KEY, None)
        try:
            checked_actor_id = _validate_identifier(actor_id, name="actor id")
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="AG-UI authentication context is missing",
            ) from exc

        try:
            thread_id = _validate_identifier(input_data.thread_id, name="thread id")
            run_id = _validate_identifier(input_data.run_id, name="run id")
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid AG-UI binding identifier",
            ) from exc

        try:
            await binding_store.claim(thread_id=thread_id, run_id=run_id, actor_id=checked_actor_id)
        except RunBindingDeniedError as exc:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="AG-UI thread or run ownership denied",
            ) from exc

        config: dict[str, Any] = dict(request_agent.config or {})
        configurable = dict(config.get("configurable") or {})
        metadata = dict(config.get("metadata") or {})
        configurable.update({"ketos_actor_id": checked_actor_id, "thread_id": thread_id})
        metadata.update({"actor_id": checked_actor_id, "thread_id": thread_id, "run_id": run_id})
        config["configurable"] = configurable
        config["metadata"] = metadata
        request_agent.config = config

    return before_dispatch


__all__ = [
    "BINDING_DB_ENV",
    "BeforeDispatchHook",
    "RunBindingDeniedError",
    "RunBindingStore",
    "create_ag_ui_before_dispatch",
    "resolve_run_binding_path",
]
