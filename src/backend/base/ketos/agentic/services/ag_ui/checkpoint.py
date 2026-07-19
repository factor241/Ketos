from __future__ import annotations

import asyncio
import os
import stat
from contextlib import suppress
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


def _resolved_path(path: Path) -> Path:
    return path.resolve(strict=False)


class AsyncSqliteCheckpoint:
    """Own one strict, identity-pinned SQLite saver for the AG-UI lifecycle."""

    def __init__(self, path: Path | str | None = None) -> None:
        candidate = Path(path).expanduser() if path is not None else resolve_checkpoint_path()
        self.path = candidate if os.fspath(candidate) == ":memory:" else candidate.absolute()
        self._saver: AsyncSqliteSaver | None = None
        self._manager: AbstractAsyncContextManager[AsyncSqliteSaver] | None = None
        self._parent_fd: int | None = None
        self._database_fd: int | None = None
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
            parent_fd, database_fd = self._secure_open()
            manager = AsyncSqliteSaver.from_conn_string(os.fspath(self.path))
            saver: AsyncSqliteSaver | None = None
            try:
                saver = await manager.__aenter__()
                self._verify_database_identity(parent_fd, database_fd)
                serializer = JsonPlusSerializer(
                    pickle_fallback=False,
                    allowed_json_modules=None,
                    allowed_msgpack_modules=None,
                )
                saver.serde = serializer
                saver.jsonplus_serde = serializer
                self._validate_sidecars(parent_fd)
            except BaseException:
                if saver is not None:
                    await manager.__aexit__(None, None, None)
                os.close(database_fd)
                os.close(parent_fd)
                raise
            self._manager = manager
            self._saver = saver
            self._parent_fd = parent_fd
            self._database_fd = database_fd
            return saver

    async def close(self) -> None:
        async with self._lifecycle_lock:
            manager = self._manager
            parent_fd = self._parent_fd
            database_fd = self._database_fd
            self._manager = None
            self._saver = None
            self._parent_fd = None
            self._database_fd = None
            pending_error: BaseException | None = None
            if parent_fd is not None and database_fd is not None:
                try:
                    self._verify_database_identity(parent_fd, database_fd)
                    self._validate_sidecars(parent_fd)
                except BaseException as exc:  # noqa: BLE001 - retain failure while still closing SQLite
                    pending_error = exc
            if manager is not None:
                try:
                    await manager.__aexit__(None, None, None)
                except BaseException as exc:  # noqa: BLE001 - lifecycle cleanup must retain cancellation
                    if pending_error is None:
                        pending_error = exc
            if parent_fd is not None and database_fd is not None:
                try:
                    self._verify_database_identity(parent_fd, database_fd)
                    self._validate_sidecars(parent_fd)
                except BaseException as exc:  # noqa: BLE001 - identity fds must always be closed
                    if pending_error is None:
                        pending_error = exc
                finally:
                    os.close(database_fd)
                    os.close(parent_fd)
            if pending_error is not None:
                raise pending_error

    async def delete_files(self) -> tuple[Path, ...]:
        """Delete only validated checkpoint files from the pinned parent directory."""
        async with self._lifecycle_lock:
            if self._saver is not None or self._manager is not None:
                message = "close the AG-UI checkpoint saver before deletion"
                raise RuntimeError(message)
            self._validate_contract()
            if not self.path.parent.exists() and not self.path.parent.is_symlink():
                return ()
            parent_fd = self._open_parent()
            opened: list[tuple[Path, int]] = []
            try:
                for candidate in self._storage_files():
                    descriptor = self._open_existing_file(parent_fd, candidate.name)
                    if descriptor is None:
                        continue
                    self._verify_file_identity(parent_fd, descriptor, candidate.name)
                    opened.append((candidate, descriptor))
                for candidate, descriptor in opened:
                    self._verify_file_identity(parent_fd, descriptor, candidate.name)
                deleted: list[Path] = []
                for candidate, _descriptor in opened:
                    os.unlink(candidate.name, dir_fd=parent_fd)
                    deleted.append(candidate)
                return tuple(deleted)
            finally:
                for _candidate, descriptor in opened:
                    os.close(descriptor)
                os.close(parent_fd)

    async def __aenter__(self) -> Self:
        await self.open()
        return self

    async def __aexit__(self, *_exc_info: object) -> None:
        await self.close()

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
            message = f"AG-UI checkpoint ancestor does not exist: {path}"
            raise ValueError(message) from exc
        if stat.S_ISLNK(result.st_mode):
            message = f"AG-UI checkpoint path cannot contain a symlink: {path}"
            raise ValueError(message)
        if not stat.S_ISDIR(result.st_mode):
            message = f"AG-UI checkpoint ancestor must be a directory: {path}"
            raise ValueError(message)
        return result

    @staticmethod
    def _validate_controlled_directory(path: Path, result: os.stat_result) -> None:
        if result.st_uid != os.geteuid():
            message = f"AG-UI checkpoint directory must be owned by the effective user: {path}"
            raise ValueError(message)
        if stat.S_IMODE(result.st_mode) != CHECKPOINT_DIRECTORY_MODE:
            message = f"AG-UI checkpoint directory requires private 0700 permissions: {path}"
            raise ValueError(message)

    @staticmethod
    def _validate_storage_file(result: os.stat_result, *, name: str) -> None:
        if not stat.S_ISREG(result.st_mode):
            message = f"AG-UI checkpoint storage must be a regular file: {name}"
            raise ValueError(message)
        if result.st_uid != os.geteuid():
            message = f"AG-UI checkpoint storage must be owned by the effective user: {name}"
            raise ValueError(message)
        if result.st_nlink != 1:
            message = f"AG-UI checkpoint storage must have exactly one hard link: {name}"
            raise ValueError(message)
        if stat.S_IMODE(result.st_mode) != CHECKPOINT_FILE_MODE:
            message = f"AG-UI checkpoint storage must have private mode 0600: {name}"
            raise ValueError(message)

    def _validate_contract(self) -> None:
        if os.environ.get(STRICT_MSGPACK_ENV) != "true":
            message = f"{STRICT_MSGPACK_ENV}=true is required for AG-UI checkpoints"
            raise RuntimeError(message)
        if os.fspath(self.path) == ":memory:":
            message = "AG-UI checkpoints require a real file path"
            raise ValueError(message)
        if ".." in self.path.parts:
            message = "AG-UI checkpoint path cannot contain parent traversal"
            raise ValueError(message)
        binding_value = os.environ.get(BINDING_DB_ENV, "").strip()
        if binding_value and _resolved_path(Path(binding_value).expanduser()) == _resolved_path(self.path):
            message = "checkpoint and binding databases must use separate files"
            raise ValueError(message)

    def _prepare_directories(self) -> None:
        parent = self.path.parent
        for directory in self._path_chain(parent):
            created = False
            with suppress(FileExistsError):
                directory.mkdir(mode=CHECKPOINT_DIRECTORY_MODE)
                created = True
            result = self._lstat_directory(directory)
            if created or directory == parent:
                self._validate_controlled_directory(directory, result)

    def _open_parent(self) -> int:
        no_follow = getattr(os, "O_NOFOLLOW", 0)
        directory_only = getattr(os, "O_DIRECTORY", 0)
        if not no_follow or os.open not in os.supports_dir_fd:
            message = "secure AG-UI checkpoint storage requires dir_fd and O_NOFOLLOW support"
            raise RuntimeError(message)
        try:
            parent_fd = os.open(
                self.path.parent,
                os.O_RDONLY | directory_only | no_follow | getattr(os, "O_CLOEXEC", 0),
            )
        except OSError as exc:
            message = "AG-UI checkpoint parent could not be opened securely"
            raise ValueError(message) from exc
        try:
            descriptor_result = os.fstat(parent_fd)
            self._validate_controlled_directory(self.path.parent, descriptor_result)
            path_result = self._lstat_directory(self.path.parent)
            if (descriptor_result.st_dev, descriptor_result.st_ino) != (path_result.st_dev, path_result.st_ino):
                message = "AG-UI checkpoint parent inode changed during open"
                raise ValueError(message)
        except Exception:
            os.close(parent_fd)
            raise
        return parent_fd

    def _secure_open(self) -> tuple[int, int]:
        self._prepare_directories()
        parent_fd = self._open_parent()
        flags = os.O_RDWR | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
        database_fd: int | None = None
        try:
            try:
                database_fd = os.open(
                    self.path.name,
                    flags | os.O_CREAT | os.O_EXCL,
                    CHECKPOINT_FILE_MODE,
                    dir_fd=parent_fd,
                )
                os.fchmod(database_fd, CHECKPOINT_FILE_MODE)
            except FileExistsError:
                try:
                    database_fd = os.open(self.path.name, flags, dir_fd=parent_fd)
                except OSError as exc:
                    path_result = os.stat(self.path.name, dir_fd=parent_fd, follow_symlinks=False)
                    if stat.S_ISLNK(path_result.st_mode):
                        message = f"refusing to open non-regular checkpoint file (symlink): {self.path}"
                        raise ValueError(message) from exc
                    message = "AG-UI checkpoint database could not be opened securely"
                    raise ValueError(message) from exc
            except OSError as exc:
                message = "AG-UI checkpoint database could not be opened securely"
                raise ValueError(message) from exc
            self._verify_database_identity(parent_fd, database_fd)
            self._validate_sidecars(parent_fd)
        except Exception:
            if database_fd is not None:
                os.close(database_fd)
            os.close(parent_fd)
            raise
        return parent_fd, database_fd

    def _verify_database_identity(self, parent_fd: int, database_fd: int) -> None:
        descriptor_result = os.fstat(database_fd)
        try:
            path_result = os.stat(self.path.name, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError as exc:
            message = "AG-UI checkpoint database inode changed during open"
            raise ValueError(message) from exc
        if (descriptor_result.st_dev, descriptor_result.st_ino) != (path_result.st_dev, path_result.st_ino):
            message = "AG-UI checkpoint database inode changed during open"
            raise ValueError(message)
        binding_value = os.environ.get(BINDING_DB_ENV, "").strip()
        if binding_value:
            with suppress(FileNotFoundError):
                binding_result = Path(binding_value).expanduser().stat()
                if (descriptor_result.st_dev, descriptor_result.st_ino) == (
                    binding_result.st_dev,
                    binding_result.st_ino,
                ):
                    message = "checkpoint and binding databases must not share an inode"
                    raise ValueError(message)
        self._validate_storage_file(descriptor_result, name=self.path.name)
        self._validate_storage_file(path_result, name=self.path.name)

    def _open_existing_file(self, parent_fd: int, name: str) -> int | None:
        try:
            return os.open(
                name,
                os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0),
                dir_fd=parent_fd,
            )
        except FileNotFoundError:
            return None
        except OSError as exc:
            path_result = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
            if stat.S_ISLNK(path_result.st_mode):
                message = f"refusing to open non-regular checkpoint file (symlink): {name}"
                raise ValueError(message) from exc
            message = f"AG-UI checkpoint storage could not be opened securely: {name}"
            raise ValueError(message) from exc

    def _verify_file_identity(self, parent_fd: int, descriptor: int, name: str) -> None:
        descriptor_result = os.fstat(descriptor)
        try:
            path_result = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError as exc:
            message = f"AG-UI checkpoint storage inode changed during open: {name}"
            raise ValueError(message) from exc
        if (descriptor_result.st_dev, descriptor_result.st_ino) != (path_result.st_dev, path_result.st_ino):
            message = f"AG-UI checkpoint storage inode changed during open: {name}"
            raise ValueError(message)
        self._validate_storage_file(descriptor_result, name=name)
        self._validate_storage_file(path_result, name=name)

    def _validate_sidecars(self, parent_fd: int) -> None:
        for candidate in self._storage_files()[1:]:
            descriptor = self._open_existing_file(parent_fd, candidate.name)
            if descriptor is None:
                continue
            try:
                self._verify_file_identity(parent_fd, descriptor, candidate.name)
            finally:
                os.close(descriptor)

    def _storage_files(self) -> tuple[Path, Path, Path]:
        raw_path = os.fspath(self.path)
        return (self.path, Path(f"{raw_path}-wal"), Path(f"{raw_path}-shm"))
