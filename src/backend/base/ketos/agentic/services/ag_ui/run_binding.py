"""Durable actor/thread/run ownership for the admitted AG-UI dispatch hook.

A10 wires :func:`get_current_ag_ui_user` as the route dependency and the hook
returned by :func:`create_ag_ui_before_dispatch` as ``before_dispatch``.  This
ledger is an authorization authority separate from the A08 checkpoint file;
neither file owns the other's lifecycle or deletion.
"""

from __future__ import annotations

import asyncio
import fcntl
import hashlib
import hmac
import json
import os
import stat
import struct
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
_DEFAULT_RELATIVE_PATH = Path("agentic") / "ag_ui" / "run-bindings.ledger"
_DIRECTORY_MODE = 0o700
_LEDGER_MODE = 0o600
_LEDGER_MAGIC = b"KETOS-AG-UI-BINDING-LEDGER\x00v1\n"
_LEDGER_LENGTH = struct.Struct(">I")
_LEDGER_CHECKSUM_BYTES = hashlib.sha256().digest_size
_MAX_LEDGER_RECORD_BYTES = 2_048
_MAX_LEDGER_BYTES = 16 * 1_024 * 1_024
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


class RunBindingDeniedError(Exception):
    """Raised when an existing durable ownership record conflicts."""


def resolve_run_binding_path() -> Path:
    """Resolve the local-only binding authority ledger path without AG-UI input."""
    configured = os.environ.get(BINDING_DB_ENV)
    if configured is not None:
        candidate = Path(configured).expanduser()
        if configured == ":memory:" or "://" in configured or not candidate.is_absolute():
            msg = f"{BINDING_DB_ENV} must be an absolute local filesystem path"
            raise ValueError(msg)
        return candidate

    data_dir = get_settings_service().settings.data_dir
    if not data_dir:
        msg = "Ketos data_dir is required for the AG-UI binding authority ledger"
        raise RuntimeError(msg)
    return Path(data_dir) / _DEFAULT_RELATIVE_PATH


def _validate_identifier(value: object, *, name: str) -> str:
    if not isinstance(value, str) or not value or len(value) > MAX_BINDING_IDENTIFIER_LENGTH:
        msg = f"Invalid AG-UI {name}"
        raise ValueError(msg)
    return value


@dataclass(frozen=True)
class RunBindingStore:
    """Descriptor-bound append-only ownership ledger with atomic claim-or-deny."""

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
            msg = "AG-UI binding authority ledger must be inside its secure root"
            raise ValueError(msg) from exc
        if not relative_path.parts or checked_path == checked_root:
            msg = "AG-UI binding authority ledger must be inside its secure root"
            raise ValueError(msg)
        object.__setattr__(self, "path", checked_path)
        object.__setattr__(self, "secure_root", checked_root)
        object.__setattr__(self, "timeout_seconds", timeout_seconds)

    @staticmethod
    def _absolute_path(path: str | Path) -> Path:
        candidate = Path(path).expanduser()
        if ".." in candidate.parts:
            msg = "AG-UI binding authority ledger path cannot contain parent traversal"
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
            msg = f"AG-UI binding authority ledger ancestor does not exist: {path}"
            raise ValueError(msg) from exc
        if stat.S_ISLNK(result.st_mode):
            msg = f"AG-UI binding authority ledger path cannot contain a symlink: {path}"
            raise ValueError(msg)
        if not stat.S_ISDIR(result.st_mode):
            msg = f"AG-UI binding authority ledger ancestor must be a directory: {path}"
            raise ValueError(msg)
        return result

    @staticmethod
    def _validate_controlled_directory(path: Path, result: os.stat_result) -> None:
        if result.st_uid != os.geteuid():
            msg = f"AG-UI binding authority ledger directory must be owned by the effective user: {path}"
            raise ValueError(msg)
        if stat.S_IMODE(result.st_mode) != _DIRECTORY_MODE:
            msg = f"AG-UI binding authority ledger directory must have private mode 0700: {path}"
            raise ValueError(msg)

    @staticmethod
    def _validate_uncontrolled_ancestor(path: Path, result: os.stat_result) -> None:
        writable_by_other_principals = stat.S_IMODE(result.st_mode) & 0o022
        if writable_by_other_principals:
            if not result.st_mode & stat.S_ISVTX:
                msg = f"AG-UI binding authority ledger ancestor cannot be writable non-sticky: {path}"
                raise ValueError(msg)
            if result.st_uid not in {0, os.geteuid()}:
                msg = f"AG-UI binding authority ledger sticky ancestor must be owned by root or effective user: {path}"
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
    def _validate_ledger_file(result: os.stat_result) -> None:
        if not stat.S_ISREG(result.st_mode):
            msg = "AG-UI binding authority ledger must be a regular local file"
            raise ValueError(msg)
        if result.st_uid != os.geteuid():
            msg = "AG-UI binding authority ledger must be owned by the effective user"
            raise ValueError(msg)
        if result.st_nlink != 1:
            msg = "AG-UI binding authority ledger must have exactly one hard link"
            raise ValueError(msg)
        if stat.S_IMODE(result.st_mode) != _LEDGER_MODE:
            msg = "AG-UI binding authority ledger must have private mode 0600"
            raise ValueError(msg)

    def _verify_ledger_identity(self, parent_fd: int, ledger_fd: int) -> None:
        descriptor_result = os.fstat(ledger_fd)
        try:
            path_result = os.stat(self.path.name, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError as exc:
            msg = "AG-UI binding authority ledger inode changed during open"
            raise ValueError(msg) from exc
        if (descriptor_result.st_dev, descriptor_result.st_ino) != (
            path_result.st_dev,
            path_result.st_ino,
        ):
            msg = "AG-UI binding authority ledger inode changed during open"
            raise ValueError(msg)
        self._validate_ledger_file(descriptor_result)
        self._validate_ledger_file(path_result)

    def _verify_live_path(self, parent_fd: int, ledger_fd: int) -> None:
        self._verify_uncontrolled_ancestors()
        self._verify_controlled_directories()

        descriptor_parent = os.fstat(parent_fd)
        self._validate_controlled_directory(self.path.parent, descriptor_parent)
        live_parent = self._lstat_directory(self.path.parent)
        if (descriptor_parent.st_dev, descriptor_parent.st_ino) != (
            live_parent.st_dev,
            live_parent.st_ino,
        ):
            msg = "AG-UI binding authority ledger parent inode changed during open"
            raise ValueError(msg)

        self._verify_ledger_identity(parent_fd, ledger_fd)
        descriptor_ledger = os.fstat(ledger_fd)
        try:
            live_ledger = os.lstat(self.path)
        except FileNotFoundError as exc:
            msg = "AG-UI binding authority ledger inode changed during open"
            raise ValueError(msg) from exc
        if (descriptor_ledger.st_dev, descriptor_ledger.st_ino) != (
            live_ledger.st_dev,
            live_ledger.st_ino,
        ):
            msg = "AG-UI binding authority ledger inode changed during open"
            raise ValueError(msg)
        self._validate_ledger_file(live_ledger)

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
            msg = "AG-UI binding authority ledger parent could not be opened securely"
            raise ValueError(msg) from exc

        try:
            parent_result = os.fstat(parent_fd)
            self._validate_controlled_directory(self.path.parent, parent_result)
            path_parent_result = self._lstat_directory(self.path.parent)
            if (parent_result.st_dev, parent_result.st_ino) != (
                path_parent_result.st_dev,
                path_parent_result.st_ino,
            ):
                msg = "AG-UI binding authority ledger parent inode changed during open"
                raise ValueError(msg)

            flags = os.O_RDWR | no_follow | close_on_exec
            ledger_fd: int | None = None
            try:
                ledger_fd = os.open(
                    self.path.name,
                    flags | os.O_CREAT | os.O_EXCL,
                    _LEDGER_MODE,
                    dir_fd=parent_fd,
                )
                os.fchmod(ledger_fd, _LEDGER_MODE)
            except FileExistsError:
                try:
                    ledger_fd = os.open(self.path.name, flags, dir_fd=parent_fd)
                except OSError as exc:
                    msg = "AG-UI binding authority ledger could not be opened securely"
                    raise ValueError(msg) from exc
            except OSError as exc:
                if ledger_fd is not None:
                    os.close(ledger_fd)
                msg = "AG-UI binding authority ledger could not be opened securely"
                raise ValueError(msg) from exc
            if ledger_fd is None:  # pragma: no cover - guarded by the open branches above
                msg = "AG-UI binding authority ledger could not be opened securely"
                raise ValueError(msg)
            try:
                self._verify_live_path(parent_fd, ledger_fd)
            except Exception:
                os.close(ledger_fd)
                raise
        except Exception:
            os.close(parent_fd)
            raise
        return parent_fd, ledger_fd

    @staticmethod
    def _encode_record(*, thread_id: str, run_id: str, actor_id: str) -> bytes:
        payload = json.dumps(
            {"actor_id": actor_id, "run_id": run_id, "thread_id": thread_id},
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("ascii")
        if not payload or len(payload) > _MAX_LEDGER_RECORD_BYTES:
            msg = "AG-UI binding ledger record length is invalid"
            raise ValueError(msg)
        return _LEDGER_LENGTH.pack(len(payload)) + payload + hashlib.sha256(payload).digest()

    @staticmethod
    def _read_ledger(ledger_fd: int) -> bytes:
        ledger_size = os.fstat(ledger_fd).st_size
        if ledger_size > _MAX_LEDGER_BYTES:
            msg = "AG-UI binding ledger exceeds its size limit"
            raise ValueError(msg)
        os.lseek(ledger_fd, 0, os.SEEK_SET)
        data = bytearray()
        while len(data) < ledger_size:
            chunk = os.read(ledger_fd, min(65_536, ledger_size - len(data)))
            if not chunk:
                msg = "AG-UI binding ledger changed during bounded read"
                raise ValueError(msg)
            data.extend(chunk)
        if os.fstat(ledger_fd).st_size != ledger_size:
            msg = "AG-UI binding ledger changed during bounded read"
            raise ValueError(msg)
        return bytes(data)

    @classmethod
    def _decode_ledger(cls, data: bytes) -> tuple[dict[str, str], set[str]]:
        if not data:
            return {}, set()
        if not data.startswith(_LEDGER_MAGIC):
            msg = "AG-UI binding ledger header or version is invalid"
            raise ValueError(msg)
        if data == _LEDGER_MAGIC:
            msg = "AG-UI binding ledger has a partial ledger record"
            raise ValueError(msg)

        thread_owners: dict[str, str] = {}
        run_ids: set[str] = set()
        offset = len(_LEDGER_MAGIC)
        while offset < len(data):
            if len(data) - offset < _LEDGER_LENGTH.size:
                msg = "AG-UI binding ledger has a partial ledger record"
                raise ValueError(msg)
            (payload_length,) = _LEDGER_LENGTH.unpack_from(data, offset)
            offset += _LEDGER_LENGTH.size
            if not 0 < payload_length <= _MAX_LEDGER_RECORD_BYTES:
                msg = "AG-UI binding ledger record length is invalid"
                raise ValueError(msg)
            record_end = offset + payload_length + _LEDGER_CHECKSUM_BYTES
            if record_end > len(data):
                msg = "AG-UI binding ledger has a partial ledger record"
                raise ValueError(msg)
            payload = data[offset : offset + payload_length]
            checksum = data[offset + payload_length : record_end]
            if not hmac.compare_digest(checksum, hashlib.sha256(payload).digest()):
                msg = "AG-UI binding ledger checksum is invalid"
                raise ValueError(msg)
            offset = record_end

            try:
                record = json.loads(payload.decode("ascii"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                msg = "AG-UI binding ledger record is malformed"
                raise ValueError(msg) from exc
            if not isinstance(record, dict) or set(record) != {"actor_id", "run_id", "thread_id"}:
                msg = "AG-UI binding ledger record is malformed"
                raise ValueError(msg)
            try:
                actor_id = _validate_identifier(record["actor_id"], name="actor id")
                run_id = _validate_identifier(record["run_id"], name="run id")
                thread_id = _validate_identifier(record["thread_id"], name="thread id")
            except ValueError as exc:
                msg = "AG-UI binding ledger record is malformed"
                raise ValueError(msg) from exc
            canonical_record = cls._encode_record(
                thread_id=thread_id,
                run_id=run_id,
                actor_id=actor_id,
            )
            if canonical_record[_LEDGER_LENGTH.size : -_LEDGER_CHECKSUM_BYTES] != payload:
                msg = "AG-UI binding ledger record is not canonical"
                raise ValueError(msg)

            existing_actor = thread_owners.get(thread_id)
            if existing_actor is not None and existing_actor != actor_id:
                msg = "AG-UI binding ledger contains conflicting thread ownership"
                raise ValueError(msg)
            if run_id in run_ids:
                msg = "AG-UI binding ledger contains a reused run identifier"
                raise ValueError(msg)
            thread_owners[thread_id] = actor_id
            run_ids.add(run_id)
        return thread_owners, run_ids

    @staticmethod
    def _write_all(ledger_fd: int, data: bytes) -> None:
        written = 0
        while written < len(data):
            count = os.write(ledger_fd, data[written:])
            if count <= 0:
                msg = "AG-UI binding ledger append did not make progress"
                raise OSError(msg)
            written += count

    def _claim_locked(self, ledger_fd: int, *, thread_id: str, run_id: str, actor_id: str) -> None:
        data = self._read_ledger(ledger_fd)
        thread_owners, run_ids = self._decode_ledger(data)
        if thread_owners.get(thread_id, actor_id) != actor_id or run_id in run_ids:
            raise RunBindingDeniedError

        framed_record = self._encode_record(thread_id=thread_id, run_id=run_id, actor_id=actor_id)
        append_data = (_LEDGER_MAGIC if not data else b"") + framed_record
        if len(data) + len(append_data) > _MAX_LEDGER_BYTES:
            msg = "AG-UI binding ledger exceeds its size limit"
            raise ValueError(msg)
        original_size = len(data)
        if os.lseek(ledger_fd, 0, os.SEEK_END) != original_size:
            msg = "AG-UI binding ledger changed before append"
            raise ValueError(msg)
        try:
            self._write_all(ledger_fd, append_data)
            os.fsync(ledger_fd)
        except Exception:
            try:
                os.ftruncate(ledger_fd, original_size)
                os.fsync(ledger_fd)
            except OSError:
                pass
            raise

    def _claim_sync(self, *, thread_id: str, run_id: str, actor_id: str) -> None:
        parent_fd, ledger_fd = self._secure_open()
        try:
            self._verify_live_path(parent_fd, ledger_fd)
            fcntl.flock(ledger_fd, fcntl.LOCK_EX)
            try:
                self._verify_live_path(parent_fd, ledger_fd)
                self._claim_locked(
                    ledger_fd,
                    thread_id=thread_id,
                    run_id=run_id,
                    actor_id=actor_id,
                )
                self._verify_live_path(parent_fd, ledger_fd)
            finally:
                fcntl.flock(ledger_fd, fcntl.LOCK_UN)
        finally:
            os.close(ledger_fd)
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
