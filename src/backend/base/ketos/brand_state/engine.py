"""Crash-resumable transaction journal for brand-state migration."""

# Error text names only metadata and paths; state values are never included.
# The package initializer is owned by the integration controller.
# ruff: noqa: EM101, EM102, PTH100, TRY003, TRY300

from __future__ import annotations

import errno
import json
import os
import stat
from dataclasses import dataclass, replace
from pathlib import Path
from typing import TYPE_CHECKING, Protocol
from uuid import UUID, uuid4

from filelock import FileLock

from ketos.brand_state.filesystem import (
    DestinationClassification,
    DestinationConflictError,
    atomic_write_json,
    atomic_write_text,
    classify_destination,
    copy_with_checksum,
    remove_transaction_created,
    verified_file_identity,
    verify_checksum,
)
from ketos.brand_state.manifest import (
    ManifestEntry,
    MigrationManifest,
    build_manifest,
    manifest_to_json,
    parse_manifest_json,
)
from ketos.brand_state.model import (
    BrandStateDiscovery,
    MigrationPhase,
    StateOperation,
    StateStatus,
)

if TYPE_CHECKING:
    from collections.abc import Callable

_STATE_SCHEMA = "ketos.brand-state.transaction-state.v1"
_RECOVERY_SCHEMA = "ketos.brand-state.recovery-marker.v1"
_STATE_FIELDS = frozenset(
    {
        "schema",
        "transaction_id",
        "phase",
        "resume_phase",
        "manifest_sha256",
        "backup_sha256",
        "staged_sha256",
        "commit_intents",
        "publication_identities",
        "created_paths",
        "created_directories",
        "created_directory_identities",
    }
)
_ACTION_OPERATIONS = frozenset({StateOperation.COPY, StateOperation.SQLITE_BACKUP})
_SHA256_LENGTH = 64


class DatabaseArtifact(Protocol):
    """Structural result returned by an injected database backup adapter."""

    @property
    def sha256(self) -> str: ...

    @property
    def size(self) -> int: ...


class DatabaseMigrationAdapter(Protocol):
    """Database boundary kept independent from the transaction engine module."""

    def backup(self, entry: ManifestEntry, *, destination: Path) -> DatabaseArtifact: ...

    def verify(self, entry: ManifestEntry, *, database: Path, expected_sha256: str) -> None: ...


class TransactionStateError(RuntimeError):
    """Raised when durable transaction state is missing or malformed."""


@dataclass(frozen=True)
class TransactionRecord:
    """Immutable, content-free view of one durable migration transaction."""

    transaction_id: str
    phase: MigrationPhase
    resume_phase: MigrationPhase | None
    manifest_sha256: str
    backup_sha256: tuple[tuple[str, str], ...] = ()
    staged_sha256: tuple[tuple[str, str], ...] = ()
    commit_intents: tuple[str, ...] = ()
    publication_identities: tuple[tuple[str, int, int], ...] = ()
    created_paths: tuple[str, ...] = ()
    created_directories: tuple[str, ...] = ()
    created_directory_identities: tuple[tuple[str, int, int], ...] = ()


def _canonical_transaction_id(value: str | UUID | None) -> str:
    candidate = str(uuid4() if value is None else value)
    try:
        parsed = UUID(candidate)
    except (AttributeError, ValueError) as exc:
        raise TransactionStateError("transaction_id must be a canonical UUID") from exc
    if str(parsed) != candidate:
        raise TransactionStateError("transaction_id must be a canonical UUID")
    return candidate


def _validate_digest(value: object, field: str) -> str:
    if not isinstance(value, str):
        raise TransactionStateError(f"{field} must be a SHA256 string")
    if len(value) != _SHA256_LENGTH or any(character not in "0123456789abcdef" for character in value):
        raise TransactionStateError(f"{field} must be a lowercase SHA256 digest")
    return value


def _absolute(path: os.PathLike[str] | str) -> Path:
    return Path(os.path.abspath(os.fspath(path)))


def _ensure_directory(
    path: Path,
    *,
    on_created: Callable[[Path, int, int], None] | None = None,
) -> tuple[Path, ...]:
    """Create a directory chain with held descriptors and identity callbacks."""
    target = _absolute(path)
    created: list[Path] = []
    current = Path(target.anchor)
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    if not getattr(os, "O_NOFOLLOW", 0) or os.mkdir not in os.supports_dir_fd:
        raise TransactionStateError("safe directory creation requires dir_fd and O_NOFOLLOW support")
    try:
        descriptor = os.open(current, flags)
    except OSError as exc:
        raise TransactionStateError(f"cannot safely open directory anchor: {current}") from exc
    try:
        for part in target.parts[1:]:
            current /= part
            created_here = False
            try:
                os.mkdir(part, 0o700, dir_fd=descriptor)
            except FileExistsError:
                pass
            except OSError as exc:
                raise TransactionStateError(f"cannot safely create directory: {current}") from exc
            else:
                created_here = True
                created.append(current)
            try:
                child = os.open(part, flags, dir_fd=descriptor)
            except OSError as exc:
                raise TransactionStateError(f"directory chain cannot be opened safely: {current}") from exc
            opened = os.fstat(child)
            if not stat.S_ISDIR(opened.st_mode):
                os.close(child)
                raise TransactionStateError(f"directory chain contains a non-directory: {current}")
            os.close(descriptor)
            descriptor = child
            if created_here and on_created is not None:
                on_created(current, opened.st_dev, opened.st_ino)
    finally:
        os.close(descriptor)
    return tuple(created)


def _validate_directory(path: Path) -> Path:
    """Validate an existing directory chain without creating any component."""
    target = _absolute(path)
    current = Path(target.anchor)
    for part in target.parts[1:]:
        current /= part
        try:
            current_stat = os.lstat(current)
        except FileNotFoundError as exc:
            raise TransactionStateError(f"directory does not exist: {current}") from exc
        if stat.S_ISLNK(current_stat.st_mode):
            raise TransactionStateError(f"directory chain contains a symlink: {current}")
        if not stat.S_ISDIR(current_stat.st_mode):
            raise TransactionStateError(f"directory chain contains a non-directory: {current}")
    return target


def _remove_created_directory(path: Path, *, expected_device: int, expected_inode: int) -> bool:
    """Identity-CAS one empty directory through its held parent descriptor."""
    target = _absolute(path)
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    if not getattr(os, "O_NOFOLLOW", 0) or any(
        function not in os.supports_dir_fd for function in (os.open, os.stat, os.rmdir)
    ):
        raise TransactionStateError("safe directory rollback requires dir_fd and O_NOFOLLOW support")
    descriptor = os.open(Path(target.anchor), flags)
    try:
        for part in target.parent.parts[1:]:
            child = os.open(part, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        try:
            inspected = os.stat(target.name, dir_fd=descriptor, follow_symlinks=False)
        except FileNotFoundError:
            return True
        if not stat.S_ISDIR(inspected.st_mode):
            raise TransactionStateError(f"transaction-created directory changed type: {target}")
        if (inspected.st_dev, inspected.st_ino) != (expected_device, expected_inode):
            raise TransactionStateError(f"transaction-created directory identity changed: {target}")
        try:
            os.rmdir(target.name, dir_fd=descriptor)
        except OSError as exc:
            if exc.errno in {errno.ENOTEMPTY, errno.EEXIST}:
                return False
            raise TransactionStateError(f"cannot remove transaction-created directory: {target}") from exc
        return True
    finally:
        os.close(descriptor)


def _require_regular(path: Path) -> None:
    try:
        path_stat = os.lstat(path)
    except FileNotFoundError as exc:
        raise TransactionStateError(f"transaction file does not exist: {path}") from exc
    if stat.S_ISLNK(path_stat.st_mode) or not stat.S_ISREG(path_stat.st_mode):
        raise TransactionStateError(f"transaction file must be a regular file: {path}")


def _remove_regular(path: Path) -> None:
    try:
        path_stat = os.lstat(path)
    except FileNotFoundError:
        return
    if stat.S_ISLNK(path_stat.st_mode) or not stat.S_ISREG(path_stat.st_mode):
        raise TransactionStateError(f"refusing to remove non-regular transaction file: {path}")
    path.unlink()


def _pairs_to_dict(values: tuple[tuple[str, str], ...]) -> dict[str, str]:
    return dict(values)


def _dict_to_pairs(value: object, field: str) -> tuple[tuple[str, str], ...]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise TransactionStateError(f"{field} must be an object")
    pairs = tuple(sorted((key, _validate_digest(digest, f"{field}.{key}")) for key, digest in value.items()))
    if any(not key for key, _ in pairs):
        raise TransactionStateError(f"{field} keys must be non-empty")
    return pairs


def _string_tuple(value: object, field: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(item, str) and item for item in value):
        raise TransactionStateError(f"{field} must be an array of non-empty strings")
    if value != sorted(set(value)):
        raise TransactionStateError(f"{field} must be sorted and unique")
    return tuple(value)


def _identity_tuple(value: object, field: str) -> tuple[tuple[str, int, int], ...]:
    if not isinstance(value, dict) or not all(isinstance(path, str) and path for path in value):
        raise TransactionStateError(f"{field} must be an object keyed by non-empty paths")
    identities: list[tuple[str, int, int]] = []
    for path, raw_identity in value.items():
        if not isinstance(raw_identity, dict) or set(raw_identity) != {"device", "inode"}:
            raise TransactionStateError(f"{field} identity must contain device and inode")
        device = raw_identity["device"]
        inode = raw_identity["inode"]
        if any(not isinstance(item, int) or isinstance(item, bool) or item < 0 for item in (device, inode)):
            raise TransactionStateError(f"{field} identity values must be non-negative integers")
        identities.append((path, device, inode))
    return tuple(sorted(identities))


def _identities_to_dict(values: tuple[tuple[str, int, int], ...]) -> dict[str, dict[str, int]]:
    return {path: {"device": device, "inode": inode} for path, device, inode in values}


def _record_to_dict(record: TransactionRecord) -> dict[str, object]:
    return {
        "schema": _STATE_SCHEMA,
        "transaction_id": record.transaction_id,
        "phase": record.phase.value,
        "resume_phase": None if record.resume_phase is None else record.resume_phase.value,
        "manifest_sha256": record.manifest_sha256,
        "backup_sha256": _pairs_to_dict(record.backup_sha256),
        "staged_sha256": _pairs_to_dict(record.staged_sha256),
        "commit_intents": list(record.commit_intents),
        "publication_identities": _identities_to_dict(record.publication_identities),
        "created_paths": list(record.created_paths),
        "created_directories": list(record.created_directories),
        "created_directory_identities": _identities_to_dict(record.created_directory_identities),
    }


def _parse_record(encoded: str, *, expected_transaction_id: str) -> TransactionRecord:
    try:
        payload = json.loads(encoded)
    except json.JSONDecodeError as exc:
        raise TransactionStateError("transaction state must be valid JSON") from exc
    if not isinstance(payload, dict) or set(payload) != _STATE_FIELDS:
        raise TransactionStateError("transaction state has an invalid schema")
    if payload["schema"] != _STATE_SCHEMA:
        raise TransactionStateError("transaction state schema is unsupported")
    transaction_id = _canonical_transaction_id(
        payload["transaction_id"] if isinstance(payload["transaction_id"], str) else ""
    )
    if transaction_id != expected_transaction_id:
        raise TransactionStateError("transaction state ID does not match its journal directory")
    try:
        phase = MigrationPhase(payload["phase"])
    except (TypeError, ValueError) as exc:
        raise TransactionStateError("transaction phase is unsupported") from exc
    raw_resume = payload["resume_phase"]
    try:
        resume_phase = None if raw_resume is None else MigrationPhase(raw_resume)
    except (TypeError, ValueError) as exc:
        raise TransactionStateError("transaction resume phase is unsupported") from exc
    if (phase is MigrationPhase.RECOVERY_REQUIRED) != (resume_phase is not None):
        raise TransactionStateError("resume_phase is allowed only for recovery-required state")
    return TransactionRecord(
        transaction_id=transaction_id,
        phase=phase,
        resume_phase=resume_phase,
        manifest_sha256=_validate_digest(payload["manifest_sha256"], "manifest_sha256"),
        backup_sha256=_dict_to_pairs(payload["backup_sha256"], "backup_sha256"),
        staged_sha256=_dict_to_pairs(payload["staged_sha256"], "staged_sha256"),
        commit_intents=_string_tuple(payload["commit_intents"], "commit_intents"),
        publication_identities=_identity_tuple(payload["publication_identities"], "publication_identities"),
        created_paths=_string_tuple(payload["created_paths"], "created_paths"),
        created_directories=_string_tuple(payload["created_directories"], "created_directories"),
        created_directory_identities=_identity_tuple(
            payload["created_directory_identities"],
            "created_directory_identities",
        ),
    )


def _artifact_name(relative_id: str) -> str:
    import hashlib

    return hashlib.sha256(relative_id.encode()).hexdigest()


class BrandStateEngine:
    """Advance brand-state migration through atomic, resumable phases."""

    def __init__(
        self,
        *,
        journal_root: Path,
        database_adapter: DatabaseMigrationAdapter | None = None,
        checkpoint: Callable[[MigrationPhase], None] | None = None,
        lock_timeout: float = 30,
    ) -> None:
        self._journal_root = _absolute(journal_root)
        self._database_adapter = database_adapter
        self._checkpoint = checkpoint
        self._lock_timeout = lock_timeout

    @property
    def journal_root(self) -> Path:
        return self._journal_root

    def _transactions_root(self) -> Path:
        return self._journal_root / "transactions"

    def _transaction_root(self, transaction_id: str) -> Path:
        return self._transactions_root() / transaction_id

    def transaction_root(self, transaction_id: str | UUID) -> Path:
        """Return a transaction path for adapter construction without creating it."""
        return self._transaction_root(_canonical_transaction_id(transaction_id))

    def _state_path(self, transaction_id: str) -> Path:
        return self._transaction_root(transaction_id) / "state.json"

    def _manifest_path(self, transaction_id: str) -> Path:
        return self._transaction_root(transaction_id) / "manifest.json"

    def _marker_path(self, transaction_id: str) -> Path:
        return self._transaction_root(transaction_id) / "RECOVERY_REQUIRED"

    def _lock(self) -> FileLock:
        lock_path = self._journal_root / ".brand-state.lock"
        if os.path.lexists(lock_path):
            _require_regular(lock_path)
        return FileLock(lock_path, timeout=self._lock_timeout)

    def _write_record(self, record: TransactionRecord) -> None:
        transaction_root = self._transaction_root(record.transaction_id)
        atomic_write_json(
            self._state_path(record.transaction_id),
            _record_to_dict(record),
            root=transaction_root,
        )

    def _read_record(self, transaction_id: str) -> TransactionRecord:
        _validate_directory(self._transaction_root(transaction_id))
        state_path = self._state_path(transaction_id)
        _require_regular(state_path)
        return _parse_record(state_path.read_text(encoding="utf-8"), expected_transaction_id=transaction_id)

    def _load_manifest(self, record: TransactionRecord) -> MigrationManifest:
        path = self._manifest_path(record.transaction_id)
        _require_regular(path)
        manifest = parse_manifest_json(path.read_text(encoding="utf-8"))
        if manifest.transaction_id != record.transaction_id:
            raise TransactionStateError("manifest ID does not match transaction state")
        if manifest.fingerprint_sha256 != record.manifest_sha256:
            raise TransactionStateError("manifest fingerprint does not match transaction state")
        return manifest

    def _transition(self, record: TransactionRecord, phase: MigrationPhase) -> TransactionRecord:
        updated = replace(record, phase=phase, resume_phase=None)
        self._write_record(updated)
        if self._checkpoint is not None:
            self._checkpoint(phase)
        return updated

    def _initialize(self, discovery: BrandStateDiscovery, transaction_id: str) -> TransactionRecord:
        transaction_root = self._transaction_root(transaction_id)
        if os.path.lexists(transaction_root):
            return self._read_record(transaction_id)
        _ensure_directory(transaction_root)
        _ensure_directory(transaction_root / "backups")
        _ensure_directory(transaction_root / "staged")
        manifest = build_manifest(discovery.entries, transaction_id=transaction_id)
        atomic_write_text(
            self._manifest_path(transaction_id),
            manifest_to_json(manifest),
            root=transaction_root,
        )
        record = TransactionRecord(
            transaction_id=transaction_id,
            phase=MigrationPhase.DISCOVERED,
            resume_phase=None,
            manifest_sha256=manifest.fingerprint_sha256,
        )
        self._write_record(record)
        if self._checkpoint is not None:
            self._checkpoint(MigrationPhase.DISCOVERED)
        return record

    def _mark_recovery(self, transaction_id: str) -> None:
        try:
            record = self._read_record(transaction_id)
        except TransactionStateError:
            return
        resume_phase = record.resume_phase if record.phase is MigrationPhase.RECOVERY_REQUIRED else record.phase
        if resume_phase is None:
            return
        failed = replace(record, phase=MigrationPhase.RECOVERY_REQUIRED, resume_phase=resume_phase)
        self._write_record(failed)
        atomic_write_json(
            self._marker_path(transaction_id),
            {
                "schema": _RECOVERY_SCHEMA,
                "transaction_id": transaction_id,
                "phase": resume_phase.value,
            },
            root=self._transaction_root(transaction_id),
        )

    def _resume_recovery(self, record: TransactionRecord, *, rollback: bool) -> TransactionRecord:
        if record.phase is not MigrationPhase.RECOVERY_REQUIRED:
            return record
        resume_phase = record.resume_phase
        if resume_phase is None:
            raise TransactionStateError("recovery-required transaction has no resume phase")
        if not rollback and resume_phase is MigrationPhase.ROLLING_BACK:
            raise TransactionStateError("transaction recovery requires rollback")
        resumed = replace(record, phase=resume_phase, resume_phase=None)
        self._write_record(resumed)
        _remove_regular(self._marker_path(record.transaction_id))
        return resumed

    def _validate_discovery(self, discovery: BrandStateDiscovery, manifest: MigrationManifest) -> None:
        current = {entry.relative_id: entry for entry in discovery.entries}
        if set(current) != {entry.relative_id for entry in manifest.entries}:
            raise TransactionStateError("discovery entry set changed after transaction planning")
        for frozen in manifest.entries:
            entry = current[frozen.relative_id]
            if (
                entry.kind is not frozen.kind
                or entry.sensitivity is not frozen.sensitivity
                or entry.operation is not frozen.operation
                or (None if entry.source is None else os.fspath(entry.source)) != frozen.source
                or (None if entry.destination is None else os.fspath(entry.destination)) != frozen.destination
                or entry.sha256 != frozen.sha256
            ):
                raise TransactionStateError(f"discovery metadata changed for {frozen.relative_id}")

    @staticmethod
    def _actions(manifest: MigrationManifest) -> tuple[ManifestEntry, ...]:
        return tuple(
            entry
            for entry in manifest.entries
            if entry.status is StateStatus.LEGACY_ONLY and entry.operation in _ACTION_OPERATIONS
        )

    def _validate_plan(self, manifest: MigrationManifest) -> None:
        conflicts = [
            entry.relative_id
            for entry in manifest.entries
            if entry.status in {StateStatus.UNEQUAL, StateStatus.CONFLICT}
        ]
        if conflicts:
            raise ValueError(f"unresolved brand-state conflict: {', '.join(conflicts)}")
        destinations: dict[str, str] = {}
        for entry in manifest.entries:
            if entry.destination is None:
                continue
            key = os.path.normcase(os.path.abspath(entry.destination))
            previous = destinations.setdefault(key, entry.relative_id)
            if previous != entry.relative_id:
                raise ValueError(
                    f"duplicate canonical destination for {previous} and {entry.relative_id}: {entry.destination}"
                )
        for entry in self._actions(manifest):
            if entry.source is None or entry.destination is None or entry.sha256 is None:
                raise TransactionStateError(f"action entry lacks source metadata: {entry.relative_id}")
            if not Path(entry.source).is_absolute() or not Path(entry.destination).is_absolute():
                raise TransactionStateError(f"action entry paths must be absolute: {entry.relative_id}")

    def _validate_record_metadata(self, record: TransactionRecord, manifest: MigrationManifest) -> None:
        actions = self._actions(manifest)
        action_ids = {entry.relative_id for entry in actions}
        backup_ids = set(_pairs_to_dict(record.backup_sha256))
        staged_ids = set(_pairs_to_dict(record.staged_sha256))
        if not backup_ids <= action_ids or not staged_ids <= action_ids:
            raise TransactionStateError("artifact checksum state contains an entry absent from the manifest")

        destinations = {entry.destination for entry in actions if entry.destination is not None}
        publication_identities = {path: (device, inode) for path, device, inode in record.publication_identities}
        if not set(record.commit_intents) <= destinations:
            raise TransactionStateError("commit intent is absent from the manifest")
        if not set(record.created_paths) <= destinations:
            raise TransactionStateError("created path is absent from the manifest")
        if not set(publication_identities) <= set(record.commit_intents):
            raise TransactionStateError("publication identity is absent from commit intents")
        if not set(record.created_paths) <= set(publication_identities):
            raise TransactionStateError("created path has no publication identity")

        allowed_directories: set[str] = set()
        for destination_text in destinations:
            current = Path(destination_text).parent
            anchor = Path(current.anchor)
            while current != anchor:
                allowed_directories.add(os.fspath(current))
                current = current.parent
        unexpected_directories = set(record.created_directories) - allowed_directories
        if unexpected_directories:
            raise TransactionStateError("created directory is not an ancestor of a manifest destination")
        directory_identities = {path for path, _device, _inode in record.created_directory_identities}
        if directory_identities != set(record.created_directories):
            raise TransactionStateError("created directory identity state is incomplete")

    def _verify_sources(self, manifest: MigrationManifest) -> None:
        for entry in self._actions(manifest):
            source = Path(entry.source or "")
            verify_checksum(source, entry.sha256 or "", root=source.parent)

    def _backup(self, record: TransactionRecord, manifest: MigrationManifest) -> TransactionRecord:
        transaction_root = self._transaction_root(record.transaction_id)
        backup_root = transaction_root / "backups"
        checksums = _pairs_to_dict(record.backup_sha256)
        for entry in self._actions(manifest):
            path = backup_root / _artifact_name(entry.relative_id)
            if entry.relative_id in checksums:
                verify_checksum(path, checksums[entry.relative_id], root=backup_root)
                continue
            if entry.operation is StateOperation.SQLITE_BACKUP:
                if self._database_adapter is None:
                    raise RuntimeError("SQLite migration requires an injected database adapter")
                artifact = self._database_adapter.backup(entry, destination=path)
                digest = _validate_digest(artifact.sha256, "database backup checksum")
                if not isinstance(artifact.size, int) or isinstance(artifact.size, bool) or artifact.size < 0:
                    raise TransactionStateError("database backup size must be non-negative")
                if verify_checksum(path, digest, root=backup_root) != artifact.size:
                    raise TransactionStateError("database backup size does not match its artifact record")
            else:
                source = Path(entry.source or "")
                result = copy_with_checksum(
                    source,
                    path,
                    source_root=source.parent,
                    destination_root=backup_root,
                    expected_sha256=entry.sha256 or "",
                )
                digest = result.sha256
            checksums[entry.relative_id] = digest
            record = replace(record, backup_sha256=tuple(sorted(checksums.items())))
            self._write_record(record)
        return record

    def _stage(self, record: TransactionRecord, manifest: MigrationManifest) -> TransactionRecord:
        transaction_root = self._transaction_root(record.transaction_id)
        backup_root = transaction_root / "backups"
        staged_root = transaction_root / "staged"
        backups = _pairs_to_dict(record.backup_sha256)
        staged = _pairs_to_dict(record.staged_sha256)
        for entry in self._actions(manifest):
            path = staged_root / _artifact_name(entry.relative_id)
            expected = backups.get(entry.relative_id)
            if expected is None:
                raise TransactionStateError(f"backup checksum is missing for {entry.relative_id}")
            if entry.relative_id in staged:
                verify_checksum(path, staged[entry.relative_id], root=staged_root)
                continue
            result = copy_with_checksum(
                backup_root / _artifact_name(entry.relative_id),
                path,
                source_root=backup_root,
                destination_root=staged_root,
                expected_sha256=expected,
            )
            staged[entry.relative_id] = result.sha256
            record = replace(record, staged_sha256=tuple(sorted(staged.items())))
            self._write_record(record)
        return record

    def _verify_staged(self, record: TransactionRecord, manifest: MigrationManifest) -> None:
        staged_root = self._transaction_root(record.transaction_id) / "staged"
        staged = _pairs_to_dict(record.staged_sha256)
        for entry in self._actions(manifest):
            expected = staged.get(entry.relative_id)
            if expected is None:
                raise TransactionStateError(f"staged checksum is missing for {entry.relative_id}")
            path = staged_root / _artifact_name(entry.relative_id)
            verify_checksum(path, expected, root=staged_root)
            if entry.operation is StateOperation.SQLITE_BACKUP:
                if self._database_adapter is None:
                    raise RuntimeError("SQLite migration requires an injected database adapter")
                self._database_adapter.verify(entry, database=path, expected_sha256=expected)

    def _commit(self, record: TransactionRecord, manifest: MigrationManifest) -> TransactionRecord:
        staged_root = self._transaction_root(record.transaction_id) / "staged"
        staged = _pairs_to_dict(record.staged_sha256)
        intents = set(record.commit_intents)
        publication_identities = {path: (device, inode) for path, device, inode in record.publication_identities}
        created_paths = set(record.created_paths)
        created_directories = set(record.created_directories)
        created_directory_identities = {
            path: (device, inode) for path, device, inode in record.created_directory_identities
        }
        for entry in self._actions(manifest):
            destination = Path(entry.destination or "")
            expected = staged[entry.relative_id]
            destination_text = os.fspath(destination)

            def record_created_directory(path: Path, device: int, inode: int) -> None:
                nonlocal record
                path_text = os.fspath(path)
                created_directories.add(path_text)
                created_directory_identities[path_text] = (device, inode)
                record = replace(
                    record,
                    created_directories=tuple(sorted(created_directories)),
                    created_directory_identities=tuple(
                        sorted(
                            (directory, identity[0], identity[1])
                            for directory, identity in created_directory_identities.items()
                        )
                    ),
                )
                self._write_record(record)

            _ensure_directory(destination.parent, on_created=record_created_directory)
            if destination_text not in intents:
                classification = classify_destination(destination, expected, root=destination.parent)
                if classification is not DestinationClassification.ABSENT:
                    raise DestinationConflictError(destination, classification)
                intents.add(destination_text)
                record = replace(record, commit_intents=tuple(sorted(intents)))
                self._write_record(record)

            def record_publication_identity(
                device: int,
                inode: int,
                destination_key: str = destination_text,
            ) -> None:
                nonlocal record
                publication_identities[destination_key] = (device, inode)
                record = replace(
                    record,
                    publication_identities=tuple(
                        sorted((path, identity[0], identity[1]) for path, identity in publication_identities.items())
                    ),
                )
                self._write_record(record)

            result = copy_with_checksum(
                staged_root / _artifact_name(entry.relative_id),
                destination,
                source_root=staged_root,
                destination_root=destination.parent,
                expected_sha256=expected,
                before_publish=record_publication_identity,
            )
            if publication_identities.get(destination_text) != (result.device, result.inode):
                if result.classification is DestinationClassification.IDENTICAL:
                    raise DestinationConflictError(destination, result.classification)
                raise TransactionStateError(f"published destination identity changed: {destination}")
            created_paths.add(destination_text)
            record = replace(record, created_paths=tuple(sorted(created_paths)))
            self._write_record(record)
        return record

    def _apply_locked(self, discovery: BrandStateDiscovery, canonical_id: str) -> TransactionRecord:
        try:
            record = self._initialize(discovery, canonical_id)
            if record.phase is MigrationPhase.ROLLED_BACK:
                raise TransactionStateError("rolled-back transaction cannot be applied again")
            record = self._resume_recovery(record, rollback=False)
            manifest = self._load_manifest(record)
            self._validate_record_metadata(record, manifest)
            self._validate_discovery(discovery, manifest)
            self._validate_plan(manifest)
            while True:
                self._verify_sources(manifest)
                if record.phase is MigrationPhase.DISCOVERED:
                    record = self._transition(record, MigrationPhase.PLANNED)
                elif record.phase is MigrationPhase.PLANNED:
                    record = self._backup(record, manifest)
                    record = self._transition(record, MigrationPhase.BACKED_UP)
                elif record.phase is MigrationPhase.BACKED_UP:
                    record = self._stage(record, manifest)
                    record = self._transition(record, MigrationPhase.STAGED)
                elif record.phase is MigrationPhase.STAGED:
                    self._verify_staged(record, manifest)
                    record = self._transition(record, MigrationPhase.VERIFIED)
                elif record.phase is MigrationPhase.VERIFIED:
                    record = self._transition(record, MigrationPhase.COMMITTING)
                elif record.phase is MigrationPhase.COMMITTING:
                    record = self._commit(record, manifest)
                    record = self._transition(record, MigrationPhase.COMMITTED)
                elif record.phase is MigrationPhase.COMMITTED:
                    _remove_regular(self._marker_path(canonical_id))
                    return record
                else:
                    raise TransactionStateError(f"cannot apply transaction in phase {record.phase.value}")
        except Exception:
            self._mark_recovery(canonical_id)
            raise

    def apply(
        self,
        discovery: BrandStateDiscovery,
        *,
        transaction_id: str | UUID | None = None,
    ) -> TransactionRecord:
        """Create or resume one explicitly identified transaction."""
        canonical_id = _canonical_transaction_id(transaction_id)
        _ensure_directory(self._journal_root)
        with self._lock():
            return self._apply_locked(discovery, canonical_id)

    def _select_apply_transaction_id(self, discovery: BrandStateDiscovery) -> str:
        resumable: list[str] = []
        committed_matches: list[str] = []
        rollback_required: list[str] = []
        for record in self.list_transactions():
            if record.phase is MigrationPhase.RECOVERY_REQUIRED:
                if record.resume_phase in {MigrationPhase.ROLLING_BACK, MigrationPhase.ROLLED_BACK}:
                    rollback_required.append(record.transaction_id)
                else:
                    resumable.append(record.transaction_id)
                continue
            if record.phase is MigrationPhase.ROLLED_BACK:
                continue
            if record.phase is MigrationPhase.COMMITTED:
                try:
                    self._validate_discovery(discovery, self._load_manifest(record))
                except TransactionStateError:
                    continue
                committed_matches.append(record.transaction_id)
                continue
            resumable.append(record.transaction_id)
        if rollback_required:
            raise TransactionStateError("incomplete rollback requires --rollback with its transaction UUID")
        if len(resumable) > 1:
            raise TransactionStateError("multiple resumable brand-state transactions require operator recovery")
        if resumable:
            return resumable[0]
        if committed_matches:
            return sorted(committed_matches)[-1]
        return str(uuid4())

    def apply_or_resume(
        self,
        discovery: BrandStateDiscovery,
        *,
        database_adapter_factory: Callable[[str], DatabaseMigrationAdapter | None] | None = None,
    ) -> TransactionRecord:
        """Atomically select and apply the single compatible transaction."""
        _ensure_directory(self._journal_root)
        with self._lock():
            canonical_id = self._select_apply_transaction_id(discovery)
            if database_adapter_factory is not None:
                self._database_adapter = database_adapter_factory(canonical_id)
            return self._apply_locked(discovery, canonical_id)

    def _remove_created_directories(self, record: TransactionRecord) -> TransactionRecord:
        remaining = set(record.created_directories)
        identities = {path: (device, inode) for path, device, inode in record.created_directory_identities}
        for path_text in sorted(remaining, key=lambda value: (len(Path(value).parts), value), reverse=True):
            path = Path(path_text)
            expected = identities.get(path_text)
            if expected is None:
                raise TransactionStateError(f"transaction-created directory identity is missing: {path}")
            if not _remove_created_directory(path, expected_device=expected[0], expected_inode=expected[1]):
                continue
            remaining.remove(path_text)
            identities.pop(path_text)
            record = replace(
                record,
                created_directories=tuple(sorted(remaining)),
                created_directory_identities=tuple(
                    sorted((item, identity[0], identity[1]) for item, identity in identities.items())
                ),
            )
            self._write_record(record)
        return record

    def rollback(
        self,
        discovery: BrandStateDiscovery | None = None,
        *,
        transaction_id: str | UUID,
    ) -> TransactionRecord:
        """Rollback from the verified journal; discovery is optional for fresh CLI processes."""
        canonical_id = _canonical_transaction_id(transaction_id)
        if not self._journal_root.exists():
            raise TransactionStateError(f"transaction does not exist: {canonical_id}")
        with self._lock():
            try:
                record = self._read_record(canonical_id)
                if record.phase is MigrationPhase.ROLLED_BACK:
                    return record
                record = self._resume_recovery(record, rollback=True)
                manifest = self._load_manifest(record)
                self._validate_record_metadata(record, manifest)
                if discovery is not None:
                    self._validate_discovery(discovery, manifest)
                if record.phase is not MigrationPhase.ROLLING_BACK:
                    record = self._transition(record, MigrationPhase.ROLLING_BACK)
                staged = _pairs_to_dict(record.staged_sha256)
                created = set(record.created_paths)
                publication_identities = {
                    path: (device, inode) for path, device, inode in record.publication_identities
                }
                entries_by_destination = {
                    entry.destination: entry for entry in self._actions(manifest) if entry.destination is not None
                }
                # A durable commit intent is written before publication. If the
                # process died after the atomic publish but before created_paths
                # was journaled, an identical destination is still owned by this
                # transaction and must be included in rollback.
                for destination_text in record.commit_intents:
                    if destination_text in created:
                        continue
                    entry = entries_by_destination.get(destination_text)
                    if entry is None:
                        raise TransactionStateError(f"commit intent is absent from manifest: {destination_text}")
                    expected = staged.get(entry.relative_id)
                    if expected is None:
                        raise TransactionStateError(f"staged checksum is missing for {entry.relative_id}")
                    destination = Path(destination_text)
                    classification = classify_destination(destination, expected, root=destination.parent)
                    if classification is DestinationClassification.IDENTICAL:
                        expected_identity = publication_identities.get(destination_text)
                        actual_identity = verified_file_identity(destination, expected, root=destination.parent)
                        if expected_identity is None or actual_identity != expected_identity:
                            raise DestinationConflictError(destination, classification)
                        created.add(destination_text)
                        record = replace(record, created_paths=tuple(sorted(created)))
                        self._write_record(record)
                    elif classification is not DestinationClassification.ABSENT:
                        raise DestinationConflictError(destination, classification)
                for destination_text in sorted(created, reverse=True):
                    entry = entries_by_destination.get(destination_text)
                    if entry is None:
                        raise TransactionStateError(f"created path is absent from manifest: {destination_text}")
                    expected = staged.get(entry.relative_id)
                    if expected is None:
                        raise TransactionStateError(f"staged checksum is missing for {entry.relative_id}")
                    destination = Path(destination_text)
                    classification = classify_destination(destination, expected, root=destination.parent)
                    if classification is DestinationClassification.ABSENT:
                        # A previous rollback attempt completed unlink before its
                        # state update. ROLLING_BACK makes that absence safe to
                        # journal as the completed result of this transaction.
                        created.remove(destination_text)
                        publication_identities.pop(destination_text, None)
                        record = replace(
                            record,
                            created_paths=tuple(sorted(created)),
                            publication_identities=tuple(
                                sorted(
                                    (path, identity[0], identity[1])
                                    for path, identity in publication_identities.items()
                                )
                            ),
                        )
                        self._write_record(record)
                        continue
                    if classification is not DestinationClassification.IDENTICAL:
                        raise DestinationConflictError(destination, classification)
                    expected_identity = publication_identities.get(destination_text)
                    if expected_identity is None:
                        raise TransactionStateError(f"publication identity is missing: {destination}")
                    actual_identity = verified_file_identity(destination, expected, root=destination.parent)
                    if actual_identity != expected_identity:
                        raise TransactionStateError(f"transaction-created file identity changed: {destination}")
                    remove_transaction_created(
                        destination,
                        root=destination.parent,
                        transaction_created=(destination,),
                        expected_sha256=expected,
                        expected_device=expected_identity[0],
                        expected_inode=expected_identity[1],
                    )
                    created.remove(destination_text)
                    publication_identities.pop(destination_text)
                    record = replace(
                        record,
                        created_paths=tuple(sorted(created)),
                        publication_identities=tuple(
                            sorted(
                                (path, identity[0], identity[1]) for path, identity in publication_identities.items()
                            )
                        ),
                    )
                    self._write_record(record)
                record = self._remove_created_directories(record)
                record = self._transition(record, MigrationPhase.ROLLED_BACK)
                _remove_regular(self._marker_path(canonical_id))
                return record
            except Exception:
                self._mark_recovery(canonical_id)
                raise

    def status(self, transaction_id: str | UUID) -> TransactionRecord:
        """Read one transaction without creating state or acquiring the mutation lock."""
        canonical_id = _canonical_transaction_id(transaction_id)
        return self._read_record(canonical_id)

    def list_transactions(self) -> tuple[TransactionRecord, ...]:
        """Return all journaled transactions in ID order without filesystem writes."""
        root = self._transactions_root()
        if not root.exists():
            return ()
        try:
            children = sorted(root.iterdir(), key=lambda path: path.name)
        except OSError as exc:
            raise TransactionStateError("cannot list transaction journal") from exc
        records: list[TransactionRecord] = []
        for child in children:
            try:
                transaction_id = _canonical_transaction_id(child.name)
            except TransactionStateError:
                continue
            if child.is_dir() and not child.is_symlink():
                records.append(self._read_record(transaction_id))
        return tuple(records)


__all__ = [
    "BrandStateEngine",
    "DatabaseArtifact",
    "DatabaseMigrationAdapter",
    "TransactionRecord",
    "TransactionStateError",
]
