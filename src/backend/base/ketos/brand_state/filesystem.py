"""Root-confined filesystem primitives for brand-state migration."""

# Dynamic safety errors identify the refused path. Lexical abspath is deliberate:
# resolving follows symlinks, while held directory descriptors provide confinement.
# ruff: noqa: EM101, EM102, PTH100, TRY003

from __future__ import annotations

import hashlib
import json
import os
import stat
from contextlib import suppress
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import uuid4

if TYPE_CHECKING:
    from collections.abc import Callable, Collection, Mapping

_COPY_BUFFER_SIZE = 1024 * 1024
_DEFAULT_MODE = 0o600
_SHA256_LENGTH = 64
_DIR_FD_SUPPORTED = bool(getattr(os, "O_NOFOLLOW", 0)) and all(
    function in os.supports_dir_fd for function in (os.open, os.stat, os.link, os.rename, os.unlink)
)


class FilesystemSafetyError(RuntimeError):
    """Raised when a path cannot be used without crossing a safety boundary."""


class ChecksumMismatchError(FilesystemSafetyError):
    """Raised when bytes do not match their declared SHA256 digest."""


class DestinationClassification(str, Enum):
    ABSENT = "absent"
    IDENTICAL = "identical"
    DIFFERENT = "different"
    MODE_MISMATCH = "mode_mismatch"
    SYMLINK = "symlink"
    SPECIAL = "special"


class DestinationConflictError(FilesystemSafetyError):
    """Raised when a destination exists but is not safe to reuse."""

    def __init__(self, path: Path, classification: DestinationClassification) -> None:
        self.path = path
        self.classification = classification
        super().__init__(f"destination conflict at {path}: {classification.value}")


@dataclass(frozen=True)
class CopyResult:
    classification: DestinationClassification
    sha256: str
    size: int
    mode: int
    device: int
    inode: int


@dataclass(frozen=True)
class _FileInspection:
    sha256: str
    size: int
    mode: int
    device: int
    inode: int


def _validate_digest(value: str, field: str = "expected checksum") -> str:
    if len(value) != _SHA256_LENGTH or any(character not in "0123456789abcdef" for character in value):
        raise ChecksumMismatchError(f"{field} must be a lowercase SHA256 checksum")
    return value


def _absolute(path: os.PathLike[str] | str) -> Path:
    return Path(os.path.abspath(os.fspath(path)))


def _root(root: os.PathLike[str] | str) -> Path:
    root_path = _absolute(root)
    try:
        root_stat = os.lstat(root_path)
    except FileNotFoundError as exc:
        raise FilesystemSafetyError(f"root does not exist: {root_path}") from exc
    if stat.S_ISLNK(root_stat.st_mode):
        raise FilesystemSafetyError(f"root must not be a symlink: {root_path}")
    if not stat.S_ISDIR(root_stat.st_mode):
        raise FilesystemSafetyError(f"root must be a directory: {root_path}")
    return root_path


def _confined(path: os.PathLike[str] | str, root: os.PathLike[str] | str) -> tuple[Path, Path]:
    root_path = _root(root)
    candidate = _absolute(path)
    try:
        common = Path(os.path.commonpath((root_path, candidate)))
    except ValueError as exc:
        raise FilesystemSafetyError(f"path escape outside root: {candidate}") from exc
    if common != root_path or candidate == root_path:
        raise FilesystemSafetyError(f"path escape outside root: {candidate}")
    return candidate, root_path


def _require_dir_fd_support() -> None:
    if not _DIR_FD_SUPPORTED:
        raise FilesystemSafetyError(
            "safe filesystem mutation requires dir_fd, O_NOFOLLOW, and fd-relative rename/link/unlink support"
        )


def _open_parent(path: Path, root: Path) -> int:
    _require_dir_fd_support()
    relative_parent = path.parent.relative_to(root)
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(root, flags)
    except OSError as exc:
        raise FilesystemSafetyError(f"cannot safely open root directory: {root}") from exc
    try:
        for part in relative_parent.parts:
            try:
                child = os.open(part, flags, dir_fd=descriptor)
            except OSError as exc:
                component = _stat_at(part, descriptor)
                if component is not None and stat.S_ISLNK(component.st_mode):
                    raise FilesystemSafetyError(f"symlink parent is not allowed: {part}") from exc
                if component is not None and not stat.S_ISDIR(component.st_mode):
                    raise FilesystemSafetyError(f"parent is not a directory: {part}") from exc
                raise FilesystemSafetyError(f"cannot safely open parent directory component: {part}") from exc
            os.close(descriptor)
            descriptor = child
        if not stat.S_ISDIR(os.fstat(descriptor).st_mode):
            raise FilesystemSafetyError(f"parent is not a directory: {path.parent}")
    except BaseException:
        os.close(descriptor)
        raise
    return descriptor


def _stat_at(name: str, parent_descriptor: int) -> os.stat_result | None:
    try:
        return os.stat(name, dir_fd=parent_descriptor, follow_symlinks=False)
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise FilesystemSafetyError(f"cannot safely inspect filesystem entry: {name}") from exc


def _open_regular_at(name: str, parent_descriptor: int) -> tuple[int, os.stat_result]:
    before = _stat_at(name, parent_descriptor)
    if before is None:
        raise FilesystemSafetyError(f"regular file does not exist: {name}")
    if stat.S_ISLNK(before.st_mode):
        raise FilesystemSafetyError(f"symlink source is not allowed: {name}")
    if not stat.S_ISREG(before.st_mode):
        raise FilesystemSafetyError(f"path must be a regular file: {name}")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(name, flags, dir_fd=parent_descriptor)
    except OSError as exc:
        raise FilesystemSafetyError(f"cannot safely open regular file: {name}") from exc
    opened = os.fstat(descriptor)
    if not stat.S_ISREG(opened.st_mode) or opened.st_dev != before.st_dev or opened.st_ino != before.st_ino:
        os.close(descriptor)
        raise FilesystemSafetyError(f"file changed while opening safely: {name}")
    return descriptor, opened


def _open_regular(path: Path, root: Path) -> tuple[int, os.stat_result]:
    parent_descriptor = _open_parent(path, root)
    try:
        return _open_regular_at(path.name, parent_descriptor)
    finally:
        os.close(parent_descriptor)


def _inspect_regular(path: Path, root: Path) -> _FileInspection:
    descriptor, opened = _open_regular(path, root)
    digest = hashlib.sha256()
    size = 0
    try:
        while chunk := os.read(descriptor, _COPY_BUFFER_SIZE):
            digest.update(chunk)
            size += len(chunk)
    finally:
        os.close(descriptor)
    return _FileInspection(
        sha256=digest.hexdigest(),
        size=size,
        mode=stat.S_IMODE(opened.st_mode),
        device=opened.st_dev,
        inode=opened.st_ino,
    )


def _inspect_regular_at(name: str, parent_descriptor: int) -> _FileInspection:
    descriptor, opened = _open_regular_at(name, parent_descriptor)
    digest = hashlib.sha256()
    size = 0
    try:
        while chunk := os.read(descriptor, _COPY_BUFFER_SIZE):
            digest.update(chunk)
            size += len(chunk)
    finally:
        os.close(descriptor)
    return _FileInspection(
        sha256=digest.hexdigest(),
        size=size,
        mode=stat.S_IMODE(opened.st_mode),
        device=opened.st_dev,
        inode=opened.st_ino,
    )


def _assert_checksum(inspection: _FileInspection, expected_sha256: str, path: Path) -> None:
    expected = _validate_digest(expected_sha256)
    if inspection.sha256 != expected:
        raise ChecksumMismatchError(f"checksum mismatch for {path}: expected {expected}, got {inspection.sha256}")


def _classification_at(name: str, parent_descriptor: int) -> DestinationClassification | None:
    destination_stat = _stat_at(name, parent_descriptor)
    if destination_stat is None:
        return DestinationClassification.ABSENT
    if stat.S_ISLNK(destination_stat.st_mode):
        return DestinationClassification.SYMLINK
    if not stat.S_ISREG(destination_stat.st_mode):
        return DestinationClassification.SPECIAL
    return None


def _classify_at(
    name: str,
    parent_descriptor: int,
    expected_sha256: str,
    *,
    expected_mode: int | None = None,
) -> tuple[DestinationClassification, _FileInspection | None]:
    initial = _classification_at(name, parent_descriptor)
    if initial is not None:
        return initial, None
    inspection = _inspect_regular_at(name, parent_descriptor)
    if inspection.sha256 != expected_sha256:
        return DestinationClassification.DIFFERENT, inspection
    if expected_mode is not None and inspection.mode != expected_mode:
        return DestinationClassification.MODE_MISMATCH, inspection
    return DestinationClassification.IDENTICAL, inspection


def sha256_file(path: os.PathLike[str] | str, *, root: os.PathLike[str] | str) -> str:
    """Hash a root-confined regular file without following symlinks."""
    confined, root_path = _confined(path, root)
    return _inspect_regular(confined, root_path).sha256


def verify_checksum(
    path: os.PathLike[str] | str,
    expected_sha256: str,
    *,
    root: os.PathLike[str] | str,
) -> int:
    """Verify a root-confined file and return its byte size."""
    confined, root_path = _confined(path, root)
    inspection = _inspect_regular(confined, root_path)
    _assert_checksum(inspection, expected_sha256, confined)
    return inspection.size


def verified_file_identity(
    path: os.PathLike[str] | str,
    expected_sha256: str,
    *,
    root: os.PathLike[str] | str,
) -> tuple[int, int]:
    """Return identity only after a no-follow checksum verification."""
    confined, root_path = _confined(path, root)
    inspection = _inspect_regular(confined, root_path)
    _assert_checksum(inspection, _validate_digest(expected_sha256), confined)
    return inspection.device, inspection.inode


def classify_destination(
    path: os.PathLike[str] | str,
    expected_sha256: str,
    *,
    root: os.PathLike[str] | str,
) -> DestinationClassification:
    """Classify a destination without following it or any ancestor symlink."""
    expected = _validate_digest(expected_sha256)
    confined, root_path = _confined(path, root)
    parent_descriptor = _open_parent(confined, root_path)
    try:
        classification, _inspection = _classify_at(confined.name, parent_descriptor, expected)
        return classification
    finally:
        os.close(parent_descriptor)


def _check_write_target_at(name: str, parent_descriptor: int) -> _FileInspection | None:
    classification = _classification_at(name, parent_descriptor)
    if classification in {
        DestinationClassification.SYMLINK,
        DestinationClassification.SPECIAL,
    }:
        raise FilesystemSafetyError(f"destination must be absent or a regular file, not {classification.value}: {name}")
    if classification is DestinationClassification.ABSENT:
        return None
    return _inspect_regular_at(name, parent_descriptor)


def _temporary_file(name: str, parent_descriptor: int) -> tuple[int, str]:
    flags = os.O_RDWR | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    for _attempt in range(100):
        temporary_name = f".{name}.{uuid4().hex}.tmp"
        try:
            return os.open(temporary_name, flags, _DEFAULT_MODE, dir_fd=parent_descriptor), temporary_name
        except FileExistsError:
            continue
        except OSError as exc:
            raise FilesystemSafetyError(f"cannot safely create temporary file for: {name}") from exc
    raise FilesystemSafetyError(f"cannot allocate a unique temporary file for: {name}")


def _publish_absent_at(temporary_name: str, destination_name: str, parent_descriptor: int) -> None:
    try:
        os.link(
            temporary_name,
            destination_name,
            src_dir_fd=parent_descriptor,
            dst_dir_fd=parent_descriptor,
            follow_symlinks=False,
        )
    except FileExistsError as exc:
        raise FilesystemSafetyError(f"destination appeared while publishing: {destination_name}") from exc
    os.unlink(temporary_name, dir_fd=parent_descriptor)


def _quarantine_name(name: str) -> str:
    return f".{name}.ketos-quarantine-{uuid4().hex}.tmp"


def _restore_quarantine(quarantine: str, destination: str, parent_descriptor: int) -> None:
    if _stat_at(destination, parent_descriptor) is not None:
        raise FilesystemSafetyError(f"destination changed while restoring quarantined entry; preserved as {quarantine}")
    os.rename(quarantine, destination, src_dir_fd=parent_descriptor, dst_dir_fd=parent_descriptor)


def _detach_verified(
    name: str,
    parent_descriptor: int,
    expected: _FileInspection,
    *,
    error_context: str,
) -> str:
    quarantine = _quarantine_name(name)
    try:
        os.rename(name, quarantine, src_dir_fd=parent_descriptor, dst_dir_fd=parent_descriptor)
    except OSError as exc:
        raise FilesystemSafetyError(f"cannot safely quarantine {error_context}: {name}") from exc
    try:
        detached = _inspect_regular_at(quarantine, parent_descriptor)
        if (detached.device, detached.inode) != (expected.device, expected.inode) or (
            detached.sha256,
            detached.mode,
        ) != (expected.sha256, expected.mode):
            _restore_quarantine(quarantine, name, parent_descriptor)
            raise FilesystemSafetyError(f"file changed before {error_context}: {name}")
    except BaseException:
        if _stat_at(quarantine, parent_descriptor) is not None and _stat_at(name, parent_descriptor) is None:
            _restore_quarantine(quarantine, name, parent_descriptor)
        raise
    return quarantine


def _fsync_parent(parent_descriptor: int) -> None:
    os.fsync(parent_descriptor)


def atomic_write_text(
    path: os.PathLike[str] | str,
    text: str,
    *,
    root: os.PathLike[str] | str,
    mode: int = _DEFAULT_MODE,
) -> None:
    """Atomically write UTF-8 text using a same-directory durable replacement."""
    confined, root_path = _confined(path, root)
    parent_descriptor = _open_parent(confined, root_path)
    temporary_name: str | None = None
    try:
        initial = _check_write_target_at(confined.name, parent_descriptor)
        descriptor, temporary_name = _temporary_file(confined.name, parent_descriptor)
        try:
            os.fchmod(descriptor, mode)
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as handle:
                handle.write(text)
                handle.flush()
                os.fsync(handle.fileno())
        except BaseException:
            with suppress(OSError):
                os.close(descriptor)
            raise
        if initial is None:
            _publish_absent_at(temporary_name, confined.name, parent_descriptor)
        else:
            refreshed = _inspect_regular_at(confined.name, parent_descriptor)
            if (refreshed.device, refreshed.inode, refreshed.sha256, refreshed.mode) != (
                initial.device,
                initial.inode,
                initial.sha256,
                initial.mode,
            ):
                raise FilesystemSafetyError(f"file changed before atomic replacement: {confined.name}")
            os.rename(
                temporary_name,
                confined.name,
                src_dir_fd=parent_descriptor,
                dst_dir_fd=parent_descriptor,
            )
        temporary_name = None
        _fsync_parent(parent_descriptor)
    finally:
        if temporary_name is not None:
            with suppress(OSError):
                os.unlink(temporary_name, dir_fd=parent_descriptor)
        os.close(parent_descriptor)


def atomic_write_json(
    path: os.PathLike[str] | str,
    value: Mapping[str, object],
    *,
    root: os.PathLike[str] | str,
    mode: int = _DEFAULT_MODE,
) -> None:
    """Atomically write deterministic JSON using the text primitive."""
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    atomic_write_text(path, f"{encoded}\n", root=root, mode=mode)


def _copy_source_to_temp(
    source: Path,
    source_root: Path,
    destination_name: str,
    destination_parent_descriptor: int,
) -> tuple[str, _FileInspection]:
    source_descriptor, source_stat = _open_regular(source, source_root)
    temporary_name: str | None = None
    try:
        temporary_descriptor, temporary_name = _temporary_file(destination_name, destination_parent_descriptor)
        digest = hashlib.sha256()
        size = 0
        try:
            os.fchmod(temporary_descriptor, stat.S_IMODE(source_stat.st_mode))
            while chunk := os.read(source_descriptor, _COPY_BUFFER_SIZE):
                digest.update(chunk)
                size += len(chunk)
                view = memoryview(chunk)
                while view:
                    written = os.write(temporary_descriptor, view)
                    view = view[written:]
            os.fsync(temporary_descriptor)
            temporary_stat = os.fstat(temporary_descriptor)
        finally:
            os.close(temporary_descriptor)
        inspection = _FileInspection(
            sha256=digest.hexdigest(),
            size=size,
            mode=stat.S_IMODE(source_stat.st_mode),
            device=temporary_stat.st_dev,
            inode=temporary_stat.st_ino,
        )
        return temporary_name, inspection  # noqa: TRY300 -- cleanup belongs to except.
    except BaseException:
        if temporary_name is not None:
            with suppress(OSError):
                os.unlink(temporary_name, dir_fd=destination_parent_descriptor)
        raise
    finally:
        os.close(source_descriptor)


def copy_with_checksum(
    source: os.PathLike[str] | str,
    destination: os.PathLike[str] | str,
    *,
    source_root: os.PathLike[str] | str,
    destination_root: os.PathLike[str] | str,
    expected_sha256: str,
    before_publish: Callable[[int, int], None] | None = None,
) -> CopyResult:
    """Copy one regular file through durable staging without following it."""
    expected = _validate_digest(expected_sha256)
    source_path, source_root_path = _confined(source, source_root)
    destination_path, destination_root_path = _confined(destination, destination_root)
    source_inspection = _inspect_regular(source_path, source_root_path)
    _assert_checksum(source_inspection, expected, source_path)
    parent_descriptor = _open_parent(destination_path, destination_root_path)
    temporary_name: str | None = None
    try:
        classification, destination_inspection = _classify_at(
            destination_path.name,
            parent_descriptor,
            expected,
            expected_mode=source_inspection.mode,
        )
        if classification is DestinationClassification.IDENTICAL:
            if destination_inspection is None:
                raise FilesystemSafetyError(f"identical destination identity is unavailable: {destination_path}")
            return CopyResult(
                classification=classification,
                sha256=expected,
                size=source_inspection.size,
                mode=source_inspection.mode,
                device=destination_inspection.device,
                inode=destination_inspection.inode,
            )
        if classification is not DestinationClassification.ABSENT:
            raise DestinationConflictError(destination_path, classification)

        temporary_name, copied = _copy_source_to_temp(
            source_path,
            source_root_path,
            destination_path.name,
            parent_descriptor,
        )
        _assert_checksum(copied, expected, source_path)
        if before_publish is not None:
            before_publish(copied.device, copied.inode)
        refreshed, _refreshed_inspection = _classify_at(
            destination_path.name,
            parent_descriptor,
            expected,
            expected_mode=source_inspection.mode,
        )
        if refreshed is not DestinationClassification.ABSENT:
            raise DestinationConflictError(destination_path, refreshed)
        _publish_absent_at(temporary_name, destination_path.name, parent_descriptor)
        temporary_name = None
        _fsync_parent(parent_descriptor)
        return CopyResult(
            classification=classification,
            sha256=copied.sha256,
            size=copied.size,
            mode=copied.mode,
            device=copied.device,
            inode=copied.inode,
        )
    finally:
        if temporary_name is not None:
            with suppress(OSError):
                os.unlink(temporary_name, dir_fd=parent_descriptor)
        os.close(parent_descriptor)


def _created_paths(transaction_created: Collection[os.PathLike[str] | str], root: Path) -> frozenset[Path]:
    return frozenset(_confined(path, root)[0] for path in transaction_created)


def _require_transaction_created(
    path: Path,
    *,
    root: Path,
    transaction_created: Collection[os.PathLike[str] | str],
) -> None:
    if path not in _created_paths(transaction_created, root):
        raise FilesystemSafetyError(f"refusing to modify path not marked transaction-created: {path}")


def remove_transaction_created(
    path: os.PathLike[str] | str,
    *,
    root: os.PathLike[str] | str,
    transaction_created: Collection[os.PathLike[str] | str],
    expected_sha256: str,
    expected_device: int | None = None,
    expected_inode: int | None = None,
) -> None:
    """Remove only an explicitly recorded transaction-created regular file."""
    confined, root_path = _confined(path, root)
    _require_transaction_created(confined, root=root_path, transaction_created=transaction_created)
    parent_descriptor = _open_parent(confined, root_path)
    quarantine: str | None = None
    try:
        inspection = _inspect_regular_at(confined.name, parent_descriptor)
        _assert_checksum(inspection, expected_sha256, confined)
        if (
            expected_device is not None
            and expected_inode is not None
            and (
                inspection.device,
                inspection.inode,
            )
            != (expected_device, expected_inode)
        ):
            raise FilesystemSafetyError(f"transaction-created file identity changed: {confined}")
        quarantine = _detach_verified(
            confined.name,
            parent_descriptor,
            inspection,
            error_context="removal",
        )
        os.unlink(quarantine, dir_fd=parent_descriptor)
        quarantine = None
        _fsync_parent(parent_descriptor)
    finally:
        os.close(parent_descriptor)


def restore_backup(
    backup: os.PathLike[str] | str,
    destination: os.PathLike[str] | str,
    *,
    backup_root: os.PathLike[str] | str,
    destination_root: os.PathLike[str] | str,
    expected_backup_sha256: str,
    transaction_created: Collection[os.PathLike[str] | str],
    expected_destination_sha256: str | None = None,
) -> CopyResult:
    """Restore a verified backup, guarding any destination replacement."""
    expected_backup = _validate_digest(expected_backup_sha256, "backup checksum")
    backup_path, backup_root_path = _confined(backup, backup_root)
    destination_path, destination_root_path = _confined(destination, destination_root)
    backup_inspection = _inspect_regular(backup_path, backup_root_path)
    _assert_checksum(backup_inspection, expected_backup, backup_path)
    parent_descriptor = _open_parent(destination_path, destination_root_path)
    temporary_name: str | None = None
    quarantine: str | None = None
    try:
        initial = _classification_at(destination_path.name, parent_descriptor)
        destination_inspection: _FileInspection | None = None
        if initial is not DestinationClassification.ABSENT:
            if initial is not None:
                raise FilesystemSafetyError(f"cannot restore over {initial.value} destination: {destination_path}")
            _require_transaction_created(
                destination_path,
                root=destination_root_path,
                transaction_created=transaction_created,
            )
            if expected_destination_sha256 is None:
                raise ChecksumMismatchError("expected destination checksum is required before replacement")
            destination_inspection = _inspect_regular_at(destination_path.name, parent_descriptor)
            _assert_checksum(destination_inspection, expected_destination_sha256, destination_path)

        temporary_name, copied = _copy_source_to_temp(
            backup_path,
            backup_root_path,
            destination_path.name,
            parent_descriptor,
        )
        _assert_checksum(copied, expected_backup, backup_path)
        if destination_inspection is None:
            if _classification_at(destination_path.name, parent_descriptor) is not DestinationClassification.ABSENT:
                raise FilesystemSafetyError(f"destination appeared while restoring: {destination_path}")
            _publish_absent_at(temporary_name, destination_path.name, parent_descriptor)
        else:
            quarantine = _detach_verified(
                destination_path.name,
                parent_descriptor,
                destination_inspection,
                error_context="removal for restore",
            )
            try:
                _publish_absent_at(temporary_name, destination_path.name, parent_descriptor)
            except BaseException:
                if _stat_at(destination_path.name, parent_descriptor) is None:
                    _restore_quarantine(quarantine, destination_path.name, parent_descriptor)
                    quarantine = None
                raise
            os.unlink(quarantine, dir_fd=parent_descriptor)
            quarantine = None
        temporary_name = None
        _fsync_parent(parent_descriptor)
        return CopyResult(
            classification=initial or DestinationClassification.DIFFERENT,
            sha256=copied.sha256,
            size=copied.size,
            mode=copied.mode,
            device=copied.device,
            inode=copied.inode,
        )
    finally:
        if temporary_name is not None:
            with suppress(OSError):
                os.unlink(temporary_name, dir_fd=parent_descriptor)
        os.close(parent_descriptor)


__all__ = [
    "ChecksumMismatchError",
    "CopyResult",
    "DestinationClassification",
    "DestinationConflictError",
    "FilesystemSafetyError",
    "atomic_write_json",
    "atomic_write_text",
    "classify_destination",
    "copy_with_checksum",
    "remove_transaction_created",
    "restore_backup",
    "sha256_file",
    "verified_file_identity",
    "verify_checksum",
]
