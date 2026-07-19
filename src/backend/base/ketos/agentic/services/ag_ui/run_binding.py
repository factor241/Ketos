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
import stat
from collections.abc import Awaitable, Callable, Mapping
from contextlib import suppress
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
_DIRECTORY_MODE = 0o700
_DATABASE_MODE = 0o600
_RESERVED_INPUT_KEYS = frozenset(
    {
        "actor",
        "actor_id",
        "actorId",
        "user_id",
        "userId",
        "role",
        "model",
    }
)
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
    secure_root: Path
    timeout_seconds: float = 5.0

    def __init__(
        self,
        path: str | Path,
        *,
        secure_root: str | Path | None = None,
        timeout_seconds: float = 5.0,
    ) -> None:
        checked_path = self._absolute_path(path)
        checked_root = self._absolute_path(secure_root or checked_path.parent)
        try:
            relative_path = checked_path.relative_to(checked_root)
        except ValueError as exc:
            msg = "AG-UI binding database must be inside its secure root"
            raise ValueError(msg) from exc
        if not relative_path.parts or checked_path == checked_root:
            msg = "AG-UI binding database must be inside its secure root"
            raise ValueError(msg)
        object.__setattr__(self, "path", checked_path)
        object.__setattr__(self, "secure_root", checked_root)
        object.__setattr__(self, "timeout_seconds", timeout_seconds)

    @staticmethod
    def _absolute_path(path: str | Path) -> Path:
        candidate = Path(path).expanduser()
        if ".." in candidate.parts:
            msg = "AG-UI binding database path cannot contain parent traversal"
            raise ValueError(msg)
        return candidate.absolute()

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

    @staticmethod
    def _path_chain(path: Path) -> list[Path]:
        chain = [path]
        while chain[-1] != chain[-1].parent:
            chain.append(chain[-1].parent)
        chain.reverse()
        return chain

    @staticmethod
    def _lstat_directory(path: Path) -> os.stat_result:
        try:
            result = os.lstat(path)
        except FileNotFoundError as exc:
            msg = f"AG-UI binding database ancestor does not exist: {path}"
            raise ValueError(msg) from exc
        if stat.S_ISLNK(result.st_mode):
            msg = f"AG-UI binding database path cannot contain a symlink: {path}"
            raise ValueError(msg)
        if not stat.S_ISDIR(result.st_mode):
            msg = f"AG-UI binding database ancestor must be a directory: {path}"
            raise ValueError(msg)
        return result

    @staticmethod
    def _validate_controlled_directory(path: Path, result: os.stat_result) -> None:
        if result.st_uid != os.geteuid():
            msg = f"AG-UI binding database directory must be owned by the effective user: {path}"
            raise ValueError(msg)
        if stat.S_IMODE(result.st_mode) != _DIRECTORY_MODE:
            msg = f"AG-UI binding database directory must have private mode 0700: {path}"
            raise ValueError(msg)

    @staticmethod
    def _validate_uncontrolled_ancestor(path: Path, result: os.stat_result) -> None:
        writable_by_other_principals = stat.S_IMODE(result.st_mode) & 0o022
        if writable_by_other_principals and not result.st_mode & stat.S_ISVTX:
            msg = f"AG-UI binding database ancestor cannot be writable non-sticky: {path}"
            raise ValueError(msg)

    def _controlled_directories(self) -> list[Path]:
        controlled = [self.secure_root]
        relative_parent = self.path.parent.relative_to(self.secure_root)
        current = self.secure_root
        for part in relative_parent.parts:
            current /= part
            controlled.append(current)
        return controlled

    def _verify_uncontrolled_ancestors(self) -> None:
        for ancestor in self._path_chain(self.secure_root.parent):
            result = self._lstat_directory(ancestor)
            self._validate_uncontrolled_ancestor(ancestor, result)

    def _verify_controlled_directories(self) -> None:
        for directory in self._controlled_directories():
            result = self._lstat_directory(directory)
            self._validate_controlled_directory(directory, result)

    def _prepare_directories(self) -> None:
        self._verify_uncontrolled_ancestors()
        for directory in self._controlled_directories():
            with suppress(FileExistsError):
                directory.mkdir(mode=_DIRECTORY_MODE)
            result = self._lstat_directory(directory)
            self._validate_controlled_directory(directory, result)

    @staticmethod
    def _validate_database_file(result: os.stat_result) -> None:
        if not stat.S_ISREG(result.st_mode):
            msg = "AG-UI binding database must be a regular local file"
            raise ValueError(msg)
        if result.st_uid != os.geteuid():
            msg = "AG-UI binding database must be owned by the effective user"
            raise ValueError(msg)
        if result.st_nlink != 1:
            msg = "AG-UI binding database must have exactly one hard link"
            raise ValueError(msg)
        if stat.S_IMODE(result.st_mode) != _DATABASE_MODE:
            msg = "AG-UI binding database must have private mode 0600"
            raise ValueError(msg)

    def _verify_database_identity(self, parent_fd: int, database_fd: int) -> None:
        descriptor_result = os.fstat(database_fd)
        try:
            path_result = os.stat(self.path.name, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError as exc:
            msg = "AG-UI binding database inode changed during open"
            raise ValueError(msg) from exc
        if (descriptor_result.st_dev, descriptor_result.st_ino) != (
            path_result.st_dev,
            path_result.st_ino,
        ):
            msg = "AG-UI binding database inode changed during open"
            raise ValueError(msg)
        self._validate_database_file(descriptor_result)
        self._validate_database_file(path_result)

    def _verify_live_path(self, parent_fd: int, database_fd: int) -> None:
        self._verify_uncontrolled_ancestors()
        self._verify_controlled_directories()

        descriptor_parent = os.fstat(parent_fd)
        self._validate_controlled_directory(self.path.parent, descriptor_parent)
        live_parent = self._lstat_directory(self.path.parent)
        if (descriptor_parent.st_dev, descriptor_parent.st_ino) != (
            live_parent.st_dev,
            live_parent.st_ino,
        ):
            msg = "AG-UI binding database parent inode changed during open"
            raise ValueError(msg)

        self._verify_database_identity(parent_fd, database_fd)
        descriptor_database = os.fstat(database_fd)
        try:
            live_database = os.lstat(self.path)
        except FileNotFoundError as exc:
            msg = "AG-UI binding database inode changed during open"
            raise ValueError(msg) from exc
        if (descriptor_database.st_dev, descriptor_database.st_ino) != (
            live_database.st_dev,
            live_database.st_ino,
        ):
            msg = "AG-UI binding database inode changed during open"
            raise ValueError(msg)
        self._validate_database_file(live_database)

    def _secure_open(self) -> tuple[int, int]:
        self._prepare_directories()
        no_follow = getattr(os, "O_NOFOLLOW", 0)
        close_on_exec = getattr(os, "O_CLOEXEC", 0)
        directory_only = getattr(os, "O_DIRECTORY", 0)
        try:
            parent_fd = os.open(
                self.path.parent,
                os.O_RDONLY | directory_only | no_follow | close_on_exec,
            )
        except OSError as exc:
            msg = "AG-UI binding database parent could not be opened securely"
            raise ValueError(msg) from exc

        try:
            parent_result = os.fstat(parent_fd)
            self._validate_controlled_directory(self.path.parent, parent_result)
            path_parent_result = self._lstat_directory(self.path.parent)
            if (parent_result.st_dev, parent_result.st_ino) != (
                path_parent_result.st_dev,
                path_parent_result.st_ino,
            ):
                msg = "AG-UI binding database parent inode changed during open"
                raise ValueError(msg)

            flags = os.O_RDWR | no_follow | close_on_exec
            database_fd: int | None = None
            try:
                database_fd = os.open(
                    self.path.name,
                    flags | os.O_CREAT | os.O_EXCL,
                    _DATABASE_MODE,
                    dir_fd=parent_fd,
                )
                os.fchmod(database_fd, _DATABASE_MODE)
            except FileExistsError:
                try:
                    database_fd = os.open(self.path.name, flags, dir_fd=parent_fd)
                except OSError as exc:
                    msg = "AG-UI binding database could not be opened securely"
                    raise ValueError(msg) from exc
            except OSError as exc:
                if database_fd is not None:
                    os.close(database_fd)
                msg = "AG-UI binding database could not be opened securely"
                raise ValueError(msg) from exc
            if database_fd is None:  # pragma: no cover - guarded by the open branches above
                msg = "AG-UI binding database could not be opened securely"
                raise ValueError(msg)
            try:
                self._verify_live_path(parent_fd, database_fd)
            except Exception:
                os.close(database_fd)
                raise
        except Exception:
            os.close(parent_fd)
            raise
        return parent_fd, database_fd

    def _claim_sync(self, *, thread_id: str, run_id: str, actor_id: str) -> None:
        parent_fd, database_fd = self._secure_open()
        connection: sqlite3.Connection | None = None
        try:
            self._verify_live_path(parent_fd, database_fd)
            connection = sqlite3.connect(
                self.path,
                isolation_level=None,
                timeout=self.timeout_seconds,
            )
            self._verify_live_path(parent_fd, database_fd)
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute(f"PRAGMA busy_timeout={int(self.timeout_seconds * 1000)}")
            connection.executescript(_SCHEMA)
            connection.execute("BEGIN IMMEDIATE")
            transaction_active = True
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
                self._verify_live_path(parent_fd, database_fd)
                connection.execute("COMMIT")
                transaction_active = False
                self._verify_live_path(parent_fd, database_fd)
            except Exception:
                if transaction_active:
                    connection.execute("ROLLBACK")
                raise
        except sqlite3.IntegrityError as exc:
            raise RunBindingDeniedError from exc
        finally:
            if connection is not None:
                connection.close()
            os.close(database_fd)
            os.close(parent_fd)


BeforeDispatchHook = Callable[[RunAgentInput, Request, LangGraphAgent], Awaitable[None]]


def create_ag_ui_before_dispatch(store: RunBindingStore | None = None) -> BeforeDispatchHook:
    """Create the admitted post-clone, pre-run ownership hook for A10 wiring."""
    if store is not None:
        binding_store = store
    else:
        binding_path = resolve_run_binding_path()
        secure_root = binding_path.parent if os.environ.get(BINDING_DB_ENV) else binding_path.parent.parent
        binding_store = RunBindingStore(binding_path, secure_root=secure_root)

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

        for untrusted_container in (
            getattr(input_data, "state", None),
            getattr(input_data, "forwarded_props", None),
        ):
            if isinstance(untrusted_container, Mapping) and _RESERVED_INPUT_KEYS.intersection(untrusted_container):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="AG-UI authority or model input is not permitted",
                )

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
