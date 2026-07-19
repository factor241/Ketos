from __future__ import annotations

import asyncio
import os
import stat
from pathlib import Path
from typing import TYPE_CHECKING, Self

from kfx.config.paths import ketos_data_dir
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

if TYPE_CHECKING:
    from collections.abc import Mapping
    from contextlib import AbstractAsyncContextManager

CHECKPOINT_DB_ENV = "KETOS_AG_UI_CHECKPOINT_DB"
BINDING_DB_ENV = "KETOS_AG_UI_BINDING_DB"
STRICT_MSGPACK_ENV = "LANGGRAPH_STRICT_MSGPACK"
DEFAULT_CHECKPOINT_SUBDIR = "ag-ui"
DEFAULT_CHECKPOINT_FILENAME = "checkpoints.sqlite3"
CHECKPOINT_DIRECTORY_MODE = 0o700
CHECKPOINT_FILE_MODE = 0o600


def resolve_checkpoint_path(
    environ: Mapping[str, str] | None = None,
    *,
    default_data_dir: Path | None = None,
) -> Path:
    values = os.environ if environ is None else environ
    configured = values.get(CHECKPOINT_DB_ENV, "").strip()
    if configured:
        return Path(configured).expanduser()
    data_dir = ketos_data_dir() if default_data_dir is None else default_data_dir
    return data_dir / DEFAULT_CHECKPOINT_SUBDIR / DEFAULT_CHECKPOINT_FILENAME


def _absolute_path(path: Path) -> Path:
    return path.resolve(strict=False)


class AsyncSqliteCheckpoint:
    """Own one strict SQLite saver for the complete AG-UI app lifecycle."""

    def __init__(self, path: Path | str | None = None) -> None:
        self.path = Path(path).expanduser() if path is not None else resolve_checkpoint_path()
        self._saver: AsyncSqliteSaver | None = None
        self._manager: AbstractAsyncContextManager[AsyncSqliteSaver] | None = None
        self._lifecycle_lock = asyncio.Lock()

    @property
    def saver(self) -> AsyncSqliteSaver:
        if self._saver is None:
            message = "AG-UI checkpoint saver is not open"
            raise RuntimeError(message)
        return self._saver

    async def open(self) -> AsyncSqliteSaver:
        async with self._lifecycle_lock:
            if self._saver is not None:
                return self._saver
            self._validate_contract()
            self._prepare_storage()
            manager = AsyncSqliteSaver.from_conn_string(os.fspath(self.path))
            saver = await manager.__aenter__()
            try:
                serializer = JsonPlusSerializer(
                    pickle_fallback=False,
                    allowed_json_modules=None,
                    allowed_msgpack_modules=None,
                )
                saver.serde = serializer
                saver.jsonplus_serde = serializer
                self._secure_storage_modes()
            except BaseException:
                await manager.__aexit__(None, None, None)
                raise
            else:
                self._manager = manager
                self._saver = saver
                return saver

    async def close(self) -> None:
        async with self._lifecycle_lock:
            manager = self._manager
            self._manager = None
            self._saver = None
            if manager is not None:
                await manager.__aexit__(None, None, None)
            self._secure_storage_modes()

    async def delete_files(self) -> tuple[Path, ...]:
        """Delete only this closed checkpoint DB and its exact SQLite sidecars."""
        async with self._lifecycle_lock:
            if self._saver is not None or self._manager is not None:
                message = "close the AG-UI checkpoint saver before deletion"
                raise RuntimeError(message)
            self._validate_contract()
            candidates = self._storage_files()
            for candidate in candidates:
                if not candidate.exists() and not candidate.is_symlink():
                    continue
                metadata = candidate.lstat()
                if candidate.is_symlink() or not stat.S_ISREG(metadata.st_mode):
                    message = f"refusing to delete non-regular checkpoint file: {candidate}"
                    raise ValueError(message)
            deleted: list[Path] = []
            for candidate in candidates:
                if candidate.exists():
                    candidate.unlink()
                    deleted.append(candidate)
            return tuple(deleted)

    async def __aenter__(self) -> Self:
        await self.open()
        return self

    async def __aexit__(self, *_exc_info: object) -> None:
        await self.close()

    def _validate_contract(self) -> None:
        if os.environ.get(STRICT_MSGPACK_ENV) != "true":
            message = f"{STRICT_MSGPACK_ENV}=true is required for AG-UI checkpoints"
            raise RuntimeError(message)
        if os.fspath(self.path) == ":memory:":
            message = "AG-UI checkpoints require a real file path"
            raise ValueError(message)
        binding_value = os.environ.get(BINDING_DB_ENV, "").strip()
        if binding_value and _absolute_path(Path(binding_value).expanduser()) == _absolute_path(self.path):
            message = "checkpoint and binding databases must use separate files"
            raise ValueError(message)

    def _prepare_storage(self) -> None:
        directory = self.path.parent
        if directory.is_symlink():
            message = f"checkpoint directory must not be a symlink: {directory}"
            raise ValueError(message)
        directory_existed = directory.exists()
        directory.mkdir(mode=CHECKPOINT_DIRECTORY_MODE, parents=True, exist_ok=True)
        if not directory.is_dir() or directory.is_symlink():
            message = f"checkpoint directory must be a real directory: {directory}"
            raise ValueError(message)
        directory_mode = stat.S_IMODE(directory.stat().st_mode)
        if directory_existed and directory_mode != CHECKPOINT_DIRECTORY_MODE:
            message = f"checkpoint directory requires private 0700 permissions: {directory}"
            raise ValueError(message)
        if not directory_existed:
            directory.chmod(CHECKPOINT_DIRECTORY_MODE)

        if self.path.is_symlink():
            message = f"checkpoint file must not be a symlink: {self.path}"
            raise ValueError(message)
        flags = os.O_CREAT | os.O_RDWR
        if hasattr(os, "O_CLOEXEC"):
            flags |= os.O_CLOEXEC
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(self.path, flags, CHECKPOINT_FILE_MODE)
        try:
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode):
                message = f"checkpoint path must be a regular file: {self.path}"
                raise ValueError(message)
            os.fchmod(descriptor, CHECKPOINT_FILE_MODE)
        finally:
            os.close(descriptor)

    def _secure_storage_modes(self) -> None:
        for candidate in self._storage_files():
            if candidate.exists() and not candidate.is_symlink():
                metadata = candidate.stat()
                if stat.S_ISREG(metadata.st_mode):
                    candidate.chmod(CHECKPOINT_FILE_MODE)

    def _storage_files(self) -> tuple[Path, Path, Path]:
        raw_path = os.fspath(self.path)
        return (self.path, Path(f"{raw_path}-wal"), Path(f"{raw_path}-shm"))
