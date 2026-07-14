"""Fail-closed SQLite preservation for brand-state migration."""

# The package initializer is owned by the integration controller. Safety errors
# deliberately identify only the failed database contract, never database content.
# ruff: noqa: EM101, TRY003

from __future__ import annotations

import ast
import ctypes
import ctypes.util
import os
import sqlite3
import stat
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import uuid4

from ketos.brand_state.filesystem import (
    DestinationClassification,
    FilesystemSafetyError,
    classify_destination,
    copy_with_checksum,
    remove_transaction_created,
    sha256_file,
    verify_checksum,
)
from ketos.brand_state.model import StateKind, StateOperation
from ketos.utils.migration_lock import MIGRATION_ADVISORY_LOCK_ID as POSTGRESQL_MIGRATION_ADVISORY_LOCK_ID

if TYPE_CHECKING:
    from collections.abc import Collection

    from ketos.brand_state.manifest import ManifestEntry

_SQLITE_SIDECAR_SUFFIXES = ("-journal", "-shm", "-wal")
_INTEGRITY_OK = "ok"
_SQLITE_OK = 0
_SQLITE_DONE = 101
_SQLITE_OPEN_READONLY = 0x00000001
_SQLITE_OPEN_READWRITE = 0x00000002
_SQLITE_OPEN_CREATE = 0x00000004
_SQLITE_OPEN_EXCLUSIVE = 0x00000010
_SQLITE_OPEN_NOFOLLOW = 0x01000000


class DatabasePreservationError(RuntimeError):
    """Raised when a database cannot be preserved without changing its history."""


@dataclass(frozen=True)
class DatabaseSidecarRecord:
    """Content-free evidence for a sidecar that was inventoried, never copied."""

    suffix: str
    sha256: str
    size: int


@dataclass(frozen=True)
class DatabaseArtifactRecord:
    """Non-secret evidence for a transaction-local, consistent SQLite snapshot."""

    sha256: str
    size: int
    alembic_revision: str
    integrity_result: str
    sidecars: tuple[DatabaseSidecarRecord, ...] = ()


@dataclass(frozen=True)
class _FileIdentity:
    device: int
    inode: int


def _file_identity(path: Path) -> _FileIdentity:
    try:
        inspected = os.lstat(path)
    except OSError as exc:
        raise FilesystemSafetyError("database source changed while opening") from exc
    if not stat.S_ISREG(inspected.st_mode):
        raise FilesystemSafetyError("database source changed while opening")
    return _FileIdentity(device=inspected.st_dev, inode=inspected.st_ino)


def _assert_file_identity(path: Path, expected: _FileIdentity) -> None:
    if _file_identity(path) != expected:
        raise FilesystemSafetyError("database source changed while opening")


def _revision_graph_entry(path: Path) -> tuple[str, tuple[str, ...]]:
    try:
        module = ast.parse(path.read_text(encoding="utf-8"), filename=path.name)
    except (OSError, SyntaxError, UnicodeError) as exc:
        raise DatabasePreservationError("vendored Alembic history cannot be inspected") from exc
    assignments: dict[str, ast.expr] = {}
    for node in module.body:
        values: list[tuple[str, ast.expr]] = []
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            values.append((node.target.id, node.value))
        elif isinstance(node, ast.Assign):
            values.extend((target.id, node.value) for target in node.targets if isinstance(target, ast.Name))
        for name, value in values:
            if name not in {"revision", "down_revision"}:
                continue
            if name in assignments:
                try:
                    duplicate_matches = ast.literal_eval(assignments[name]) == ast.literal_eval(value)
                except (ValueError, TypeError) as exc:
                    raise DatabasePreservationError("vendored Alembic revision metadata must be static") from exc
                if not duplicate_matches:
                    raise DatabasePreservationError("vendored Alembic revision metadata overlaps")
            assignments[name] = value

    if "revision" not in assignments or "down_revision" not in assignments:
        raise DatabasePreservationError("vendored Alembic revision metadata is missing")
    try:
        revision = ast.literal_eval(assignments["revision"])
        raw_down_revision = ast.literal_eval(assignments["down_revision"])
    except (ValueError, TypeError) as exc:
        raise DatabasePreservationError("vendored Alembic revision metadata must be static") from exc
    if not isinstance(revision, str) or not revision.strip():
        raise DatabasePreservationError("vendored Alembic revision is blank")
    if raw_down_revision is None:
        down_revisions: tuple[str, ...] = ()
    elif isinstance(raw_down_revision, str):
        down_revisions = (raw_down_revision,)
    elif isinstance(raw_down_revision, (tuple, list)):
        down_revisions = tuple(raw_down_revision)
    else:
        raise DatabasePreservationError("vendored Alembic down_revision has an unsupported type")
    if any(not isinstance(parent, str) or not parent.strip() for parent in down_revisions):
        raise DatabasePreservationError("vendored Alembic down_revision is blank")
    if len(down_revisions) != len(set(down_revisions)):
        raise DatabasePreservationError("vendored Alembic down_revision overlaps")
    return revision, down_revisions


def _load_revision_graph(revision_files: Collection[Path]) -> frozenset[str]:
    entries = tuple(_revision_graph_entry(path) for path in revision_files)
    if not entries:
        raise DatabasePreservationError("vendored Alembic history is missing")
    revisions = tuple(revision for revision, _parents in entries)
    revision_set = frozenset(revisions)
    if len(revisions) != len(revision_set):
        raise DatabasePreservationError("vendored Alembic history has overlapping revisions")

    parents_by_revision = dict(entries)
    referenced_parents = {parent for parents in parents_by_revision.values() for parent in parents}
    missing_parents = referenced_parents - revision_set
    if missing_parents:
        raise DatabasePreservationError("vendored Alembic history has a missing parent")
    roots = {revision for revision, parents in entries if not parents}
    if len(roots) != 1:
        raise DatabasePreservationError("vendored Alembic history must have exactly one root")
    heads = revision_set - referenced_parents
    if len(heads) != 1:
        raise DatabasePreservationError("vendored Alembic history must have exactly one head")

    children: dict[str, set[str]] = {revision: set() for revision in revision_set}
    for revision, parents in entries:
        for parent in parents:
            children[parent].add(revision)
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(revision: str) -> None:
        if revision in visiting:
            raise DatabasePreservationError("vendored Alembic history contains a cycle")
        if revision in visited:
            return
        visiting.add(revision)
        for child in children[revision]:
            visit(child)
        visiting.remove(revision)
        visited.add(revision)

    visit(next(iter(roots)))
    if visited != revision_set:
        raise DatabasePreservationError("vendored Alembic history is not connected")
    return revision_set


@lru_cache(maxsize=1)
def load_vendored_alembic_revisions() -> frozenset[str]:
    """Load revision identifiers without importing executable migration modules."""
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    revision_files = sorted(path for path in versions.glob("*.py") if path.name != "__init__.py")
    return _load_revision_graph(revision_files)


def _validated_known_revisions(known_revisions: Collection[str]) -> frozenset[str]:
    revisions = frozenset(known_revisions)
    if not revisions or any(not isinstance(revision, str) or not revision.strip() for revision in revisions):
        raise DatabasePreservationError("known Alembic history must contain non-blank revisions")
    return revisions


def _open_readonly(path: Path) -> sqlite3.Connection:
    uri = f"{path.absolute().as_uri()}?mode=ro"
    connection: sqlite3.Connection | None = None
    try:
        connection = sqlite3.connect(uri, uri=True)
        connection.execute("PRAGMA query_only = ON")
    except sqlite3.Error as exc:
        if connection is not None:
            connection.close()
        raise DatabasePreservationError("database integrity check could not open the SQLite database") from exc
    return connection


def _validate_database(connection: sqlite3.Connection, known_revisions: frozenset[str]) -> str:
    try:
        integrity_rows = connection.execute("PRAGMA integrity_check").fetchall()
    except sqlite3.Error as exc:
        raise DatabasePreservationError("database integrity check failed") from exc
    if integrity_rows != [(_INTEGRITY_OK,)]:
        raise DatabasePreservationError("database integrity check did not return ok")

    try:
        alembic_table = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'alembic_version'"
        ).fetchone()
        if alembic_table is None:
            raise DatabasePreservationError("alembic_version history is missing")
        rows = connection.execute("SELECT version_num FROM alembic_version").fetchall()
    except sqlite3.Error as exc:
        raise DatabasePreservationError("alembic_version history cannot be read") from exc
    if not rows:
        raise DatabasePreservationError("Alembic current revision is missing")
    if len(rows) != 1:
        raise DatabasePreservationError("Alembic current revisions overlap")
    revision = rows[0][0]
    if not isinstance(revision, str) or not revision.strip():
        raise DatabasePreservationError("Alembic current revision is blank")
    if revision not in known_revisions:
        raise DatabasePreservationError("Alembic current revision is unknown")
    return revision


@lru_cache(maxsize=1)
def _native_sqlite_library() -> ctypes.CDLL:
    candidates: list[str] = []
    if library := ctypes.util.find_library("sqlite3"):
        candidates.append(library)
    try:
        import _sqlite3

        extension = getattr(_sqlite3, "__file__", None)
        if isinstance(extension, str):
            candidates.append(extension)
    except ImportError:
        pass
    for candidate in candidates:
        try:
            library = ctypes.CDLL(candidate)
        except OSError:
            continue
        required = (
            "sqlite3_open_v2",
            "sqlite3_backup_init",
            "sqlite3_backup_step",
            "sqlite3_backup_finish",
            "sqlite3_close_v2",
        )
        if all(hasattr(library, name) for name in required):
            library.sqlite3_open_v2.argtypes = [
                ctypes.c_char_p,
                ctypes.POINTER(ctypes.c_void_p),
                ctypes.c_int,
                ctypes.c_char_p,
            ]
            library.sqlite3_open_v2.restype = ctypes.c_int
            library.sqlite3_backup_init.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_void_p, ctypes.c_char_p]
            library.sqlite3_backup_init.restype = ctypes.c_void_p
            library.sqlite3_backup_step.argtypes = [ctypes.c_void_p, ctypes.c_int]
            library.sqlite3_backup_step.restype = ctypes.c_int
            library.sqlite3_backup_finish.argtypes = [ctypes.c_void_p]
            library.sqlite3_backup_finish.restype = ctypes.c_int
            library.sqlite3_close_v2.argtypes = [ctypes.c_void_p]
            library.sqlite3_close_v2.restype = ctypes.c_int
            return library
    raise DatabasePreservationError("native SQLite no-follow backup support is unavailable")


def _native_backup_database(source: Path, destination: Path) -> None:
    """Back up through SQLite's NOFOLLOW VFS boundary without reopening a staged pathname in Python."""
    library = _native_sqlite_library()
    source_handle = ctypes.c_void_p()
    destination_handle = ctypes.c_void_p()
    backup_handle: ctypes.c_void_p | None = None
    try:
        source_result = library.sqlite3_open_v2(
            os.fsencode(source),
            ctypes.byref(source_handle),
            _SQLITE_OPEN_READONLY | _SQLITE_OPEN_NOFOLLOW,
            None,
        )
        if source_result != _SQLITE_OK:
            raise DatabasePreservationError("native SQLite source open failed closed")
        destination_result = library.sqlite3_open_v2(
            os.fsencode(destination),
            ctypes.byref(destination_handle),
            _SQLITE_OPEN_READWRITE | _SQLITE_OPEN_CREATE | _SQLITE_OPEN_EXCLUSIVE | _SQLITE_OPEN_NOFOLLOW,
            None,
        )
        if destination_result != _SQLITE_OK:
            raise DatabasePreservationError("native SQLite destination open failed closed")
        backup_handle = library.sqlite3_backup_init(destination_handle, b"main", source_handle, b"main")
        if not backup_handle:
            raise DatabasePreservationError("native SQLite backup initialization failed closed")
        step_result = library.sqlite3_backup_step(backup_handle, -1)
        finish_result = library.sqlite3_backup_finish(backup_handle)
        backup_handle = None
        if step_result != _SQLITE_DONE or finish_result != _SQLITE_OK:
            raise DatabasePreservationError("database integrity backup failed closed")
    finally:
        if backup_handle:
            library.sqlite3_backup_finish(backup_handle)
        if destination_handle:
            library.sqlite3_close_v2(destination_handle)
        if source_handle:
            library.sqlite3_close_v2(source_handle)


def _sidecar_records(source: Path, *, source_root: Path) -> tuple[DatabaseSidecarRecord, ...]:
    records: list[DatabaseSidecarRecord] = []
    for suffix in _SQLITE_SIDECAR_SUFFIXES:
        sidecar = source.with_name(f"{source.name}{suffix}")
        if not os.path.lexists(sidecar):
            continue
        digest = sha256_file(sidecar, root=source_root)
        size = verify_checksum(sidecar, digest, root=source_root)
        records.append(DatabaseSidecarRecord(suffix=suffix, sha256=digest, size=size))
    return tuple(records)


def _staging_path(destination: Path) -> Path:
    return destination.with_name(f".{destination.name}.{uuid4()}.sqlite.tmp")


def _cleanup_created(path: Path, *, root: Path) -> None:
    candidates = (path, *(path.with_name(f"{path.name}{suffix}") for suffix in _SQLITE_SIDECAR_SUFFIXES))
    for candidate in candidates:
        if not os.path.lexists(candidate):
            continue
        digest = sha256_file(candidate, root=root)
        remove_transaction_created(
            candidate,
            root=root,
            transaction_created=(candidate,),
            expected_sha256=digest,
        )


def _require_sqlite_entry(entry: ManifestEntry) -> Path:
    if entry.kind is not StateKind.SQLITE_DB or entry.operation is not StateOperation.SQLITE_BACKUP:
        raise DatabasePreservationError("database adapter requires a sqlite_backup manifest entry")
    if not entry.source:
        raise DatabasePreservationError("database manifest source is missing")
    return Path(entry.source)


class SQLiteDatabaseAdapter:
    """Create and verify transaction-local SQLite snapshots without sidecar copying."""

    def __init__(
        self,
        *,
        source_root: Path,
        transaction_root: Path,
        known_revisions: Collection[str] | None = None,
    ) -> None:
        self._source_root = source_root
        self._transaction_root = transaction_root
        selected_revisions = load_vendored_alembic_revisions() if known_revisions is None else known_revisions
        self._known_revisions = _validated_known_revisions(selected_revisions)

    def backup(self, entry: ManifestEntry, *, destination: Path) -> DatabaseArtifactRecord:
        """Preserve one live SQLite database through its online backup API."""
        source = _require_sqlite_entry(entry)
        destination_classification = classify_destination(destination, "0" * 64, root=self._transaction_root)
        if destination_classification is not DestinationClassification.ABSENT:
            raise DatabasePreservationError("database backup destination already exists")
        sidecars = _sidecar_records(source, source_root=self._source_root)
        sha256_file(source, root=self._source_root)
        source_identity = _file_identity(source)
        staging = _staging_path(destination)
        confirmation = _staging_path(destination)
        try:
            _native_backup_database(source, staging)
            _assert_file_identity(source, source_identity)
            with _open_readonly(staging) as staged_connection:
                revision = _validate_database(staged_connection, self._known_revisions)
            _native_backup_database(source, confirmation)
            _assert_file_identity(source, source_identity)
            digest = sha256_file(staging, root=self._transaction_root)
            confirmation_digest = sha256_file(confirmation, root=self._transaction_root)
            if confirmation_digest != digest:
                raise FilesystemSafetyError("database source changed during stable snapshot")
            size = verify_checksum(staging, digest, root=self._transaction_root)
            copy_with_checksum(
                staging,
                destination,
                source_root=self._transaction_root,
                destination_root=self._transaction_root,
                expected_sha256=digest,
            )
            return DatabaseArtifactRecord(
                sha256=digest,
                size=size,
                alembic_revision=revision,
                integrity_result=_INTEGRITY_OK,
                sidecars=sidecars,
            )
        finally:
            _cleanup_created(staging, root=self._transaction_root)
            _cleanup_created(confirmation, root=self._transaction_root)

    def verify(self, entry: ManifestEntry, *, database: Path, expected_sha256: str) -> None:
        """Verify checksum, logical integrity, and persisted Alembic history."""
        _require_sqlite_entry(entry)
        verify_checksum(database, expected_sha256, root=self._transaction_root)
        with _open_readonly(database) as connection:
            _validate_database(connection, self._known_revisions)


__all__ = [
    "POSTGRESQL_MIGRATION_ADVISORY_LOCK_ID",
    "DatabaseArtifactRecord",
    "DatabasePreservationError",
    "DatabaseSidecarRecord",
    "SQLiteDatabaseAdapter",
    "load_vendored_alembic_revisions",
]
