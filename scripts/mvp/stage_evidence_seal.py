#!/usr/bin/env python3
# ruff: noqa: EM101, EM102, PTH101, PTH102, PTH104, PTH108, S603, TRY003
"""Fail-closed APFS evidence sealing primitives.

The module deliberately has no rollback or flag-clearing path.  Once a
candidate has been partially protected it is diagnostic quarantine material,
not something this code may repair or reuse.
"""

from __future__ import annotations

import ctypes
import errno
import hashlib
import json
import os
import plistlib
import re
import stat
import subprocess
import sys
import uuid
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

EXPECTED_APFS_UUID = "8B3B8A79-88A2-4676-8ED0-4C49EB697CDF"
ALLOWED_XATTRS = frozenset({"com.apple.provenance"})
DENIAL_ERRNOS = frozenset({errno.EPERM, errno.EACCES})
O_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
O_DIRECTORY = getattr(os, "O_DIRECTORY", 0)
READ_ONLY_FILE_MODE = 0o400
READ_ONLY_DIRECTORY_MODE = 0o500

EXIT_PREFLIGHT_INVALID = 20
EXIT_ZERO_WRITE_INVALID = 21
EXIT_MATERIALIZATION_INVALID = 22
EXIT_PARTIAL_SEAL = 23
EXIT_RECEIPT_PROTECTION = 24
EXIT_NEGATIVE_PROBE = 25
EXIT_SOURCE_CHANGED = 26


class SealError(RuntimeError):
    """A controlled, machine-readable fail-closed result."""

    def __init__(
        self,
        message: str,
        *,
        exit_code: int = EXIT_PREFLIGHT_INVALID,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.exit_code = exit_code
        self.details = dict(details or {})

    def to_json(self) -> str:
        return json.dumps(
            {
                "status": "fail",
                "exit_code": self.exit_code,
                "error": str(self),
                "details": self.details,
            },
            sort_keys=True,
        )


@dataclass(frozen=True)
class ObjectRecord:
    relative_path: str
    object_type: str
    device: int
    inode: int
    mode: int
    uid: int
    gid: int
    nlink: int
    size: int
    flags: int
    mtime_ns: int
    ctime_ns: int
    birthtime_ns: int
    acl: tuple[str, ...]
    xattrs: tuple[dict[str, Any], ...]


VolumeInfoProvider = Callable[[Path], Mapping[str, Any]]
AclReader = Callable[[Path], Sequence[str]]
XattrReader = Callable[[Path], Mapping[str, bytes]]


def _canonical_json(payload: Any) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode()


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _assert_no_symlink_components(path: Path) -> None:
    absolute = path.absolute()
    current = Path(absolute.anchor)
    for component in absolute.parts[1:]:
        current /= component
        try:
            info = os.lstat(current)
        except FileNotFoundError:
            break
        if stat.S_ISLNK(info.st_mode):
            raise SealError(f"symbolic-link path component is forbidden: {current}")


def _diskutil_volume_info(path: Path) -> Mapping[str, Any]:
    last_returncode = 1
    candidate = path
    while True:
        result = subprocess.run(
            ["/usr/sbin/diskutil", "info", "-plist", str(candidate)],
            check=False,
            capture_output=True,
        )
        last_returncode = result.returncode
        if result.returncode == 0:
            try:
                payload = plistlib.loads(result.stdout)
            except (plistlib.InvalidFileException, ValueError) as exc:
                raise SealError("diskutil returned an invalid plist") from exc
            if not isinstance(payload, dict):
                raise SealError("diskutil returned a non-object plist")
            return payload
        if candidate.parent == candidate:
            break
        candidate = candidate.parent
    raise SealError(
        "diskutil APFS preflight failed",
        details={"returncode": last_returncode, "path": str(path)},
    )


def _filesystem_name(info: Mapping[str, Any]) -> str:
    candidates = (
        info.get("FilesystemName"),
        info.get("FilesystemType"),
        info.get("FileSystemPersonality"),
        info.get("FilesystemPersonality"),
    )
    return " ".join(str(value) for value in candidates if value is not None).lower()


def preflight_apfs_root(
    root: Path,
    *,
    expected_volume_uuid: str = EXPECTED_APFS_UUID,
    expected_uid: int | None = None,
    expected_device: int | None = None,
    volume_info_provider: VolumeInfoProvider | None = None,
) -> dict[str, Any]:
    """Bind a real directory to the expected APFS volume and owner."""
    root = Path(root)
    _assert_no_symlink_components(root)
    try:
        initial = os.lstat(root)
    except OSError as exc:
        raise SealError(f"APFS root is unavailable: {root}") from exc
    if not stat.S_ISDIR(initial.st_mode):
        raise SealError(f"APFS root must be a real directory: {root}")
    canonical = root.resolve(strict=True)
    final = os.lstat(canonical)
    if (initial.st_dev, initial.st_ino) != (final.st_dev, final.st_ino):
        raise SealError("APFS root identity changed during canonicalization")
    uid = os.getuid() if expected_uid is None else expected_uid
    if final.st_uid != uid:
        raise SealError(f"APFS root has wrong owner: expected uid {uid}, got {final.st_uid}")
    if expected_device is not None and final.st_dev != expected_device:
        raise SealError("APFS root device does not match the pinned device")
    provider = volume_info_provider or _diskutil_volume_info
    info = dict(provider(canonical))
    if "apfs" not in _filesystem_name(info):
        raise SealError("destination filesystem is not APFS")
    actual_uuid = str(info.get("VolumeUUID", "")).upper()
    if actual_uuid != expected_volume_uuid.upper():
        raise SealError(
            "APFS volume UUID mismatch",
            details={"expected": expected_volume_uuid, "actual": actual_uuid},
        )
    if info.get("ReadOnly") is True or info.get("Writable") is False:
        raise SealError("APFS volume is not writable")
    mount_point = info.get("MountPoint")
    if not isinstance(mount_point, str) or not mount_point.startswith("/"):
        raise SealError("diskutil did not identify an absolute mount point")
    mount = Path(mount_point).resolve(strict=True)
    if canonical != mount and not canonical.is_relative_to(mount):
        raise SealError("APFS root is outside the diskutil mount point")
    if os.lstat(mount).st_dev != final.st_dev:
        raise SealError("APFS root device does not match the diskutil mount point")
    return {
        "canonical_root": str(canonical),
        "mount_point": str(mount),
        "volume_uuid": actual_uuid,
        "device": final.st_dev,
        "inode": final.st_ino,
        "uid": final.st_uid,
    }


def _read_acl(path: Path) -> Sequence[str]:
    result = subprocess.run(
        ["/bin/ls", "-lde", str(path)],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise SealError(f"unable to read ACL: {path}")
    return tuple(line.strip() for line in result.stdout.splitlines()[1:] if re.match(r"^\s*\d+:", line))


def _read_xattrs(path: Path) -> Mapping[str, bytes]:
    names_result = subprocess.run(
        ["/usr/bin/xattr", str(path)],
        check=False,
        capture_output=True,
        text=True,
    )
    if names_result.returncode != 0:
        raise SealError(f"unable to list xattrs: {path}")
    values: dict[str, bytes] = {}
    for name in sorted(line for line in names_result.stdout.splitlines() if line):
        value_result = subprocess.run(
            ["/usr/bin/xattr", "-p", name, str(path)],
            check=False,
            capture_output=True,
        )
        if value_result.returncode != 0:
            raise SealError(f"unable to read xattr {name}: {path}")
        values[name] = value_result.stdout
    return values


def _object_type(mode: int) -> str:
    if stat.S_ISDIR(mode):
        return "directory"
    if stat.S_ISREG(mode):
        return "regular"
    if stat.S_ISLNK(mode):
        return "symlink"
    if stat.S_ISFIFO(mode):
        return "fifo"
    if stat.S_ISSOCK(mode):
        return "socket"
    if stat.S_ISCHR(mode):
        return "character-device"
    if stat.S_ISBLK(mode):
        return "block-device"
    return "unknown"


def _walk_no_follow(root: Path) -> list[Path]:
    pending = [root]
    paths: list[Path] = []
    while pending:
        directory = pending.pop()
        paths.append(directory)
        with os.scandir(directory) as entries:
            children = sorted(entries, key=lambda item: os.fsencode(item.name), reverse=True)
        for entry in children:
            child = directory / entry.name
            info = os.lstat(child)
            paths.append(child)
            if stat.S_ISDIR(info.st_mode):
                pending.append(child)
    # A directory is added when discovered and again when popped.
    unique = {os.fspath(path): path for path in paths}
    return sorted(
        unique.values(),
        key=lambda path: os.fsencode("." if path == root else path.relative_to(root).as_posix()),
    )


def inventory_tree_no_links(
    root: Path,
    *,
    expected_uid: int | None = None,
    allowed_xattrs: Iterable[str] = ALLOWED_XATTRS,
    acl_reader: AclReader | None = None,
    xattr_reader: XattrReader | None = None,
) -> tuple[ObjectRecord, ...]:
    """Return a complete lstat inventory and reject ambiguous objects."""
    root = Path(root)
    _assert_no_symlink_components(root)
    root_info = os.lstat(root)
    if not stat.S_ISDIR(root_info.st_mode):
        raise SealError("inventory root must be a directory")
    uid = os.getuid() if expected_uid is None else expected_uid
    permitted_xattrs = frozenset(allowed_xattrs)
    read_acl = acl_reader or _read_acl
    read_xattrs = xattr_reader or _read_xattrs
    identities: set[tuple[int, int]] = set()
    records: list[ObjectRecord] = []
    for path in _walk_no_follow(root):
        info = os.lstat(path)
        kind = _object_type(info.st_mode)
        relative = "." if path == root else path.relative_to(root).as_posix()
        if kind not in {"regular", "directory"}:
            raise SealError(
                f"forbidden object type {kind}: {relative}",
                details={"path": relative, "object_type": kind},
            )
        if info.st_dev != root_info.st_dev:
            raise SealError(f"cross-device descendant is forbidden: {relative}")
        identity = (info.st_dev, info.st_ino)
        if identity in identities:
            raise SealError(f"duplicate inode/hardlink is forbidden: {relative}")
        identities.add(identity)
        if kind == "regular" and info.st_nlink != 1:
            raise SealError(f"hardlink is forbidden: {relative}")
        if info.st_uid != uid:
            raise SealError(f"wrong owner for {relative}: expected uid {uid}, got {info.st_uid}")
        mode = stat.S_IMODE(info.st_mode)
        if mode & 0o022:
            raise SealError(f"group/other writable object is forbidden: {relative}")
        acl = tuple(read_acl(path))
        if acl:
            raise SealError(f"unexpected ACL on {relative}", details={"path": relative, "acl": acl})
        raw_xattrs = dict(read_xattrs(path))
        unexpected = sorted(set(raw_xattrs) - permitted_xattrs)
        if unexpected:
            raise SealError(
                f"unexpected xattr on {relative}",
                details={"path": relative, "xattrs": unexpected},
            )
        xattrs = tuple(
            {
                "name": name,
                "size": len(raw_xattrs[name]),
                "sha256": _sha256_bytes(raw_xattrs[name]),
            }
            for name in sorted(raw_xattrs)
        )
        records.append(
            ObjectRecord(
                relative_path=relative,
                object_type=kind,
                device=info.st_dev,
                inode=info.st_ino,
                mode=mode,
                uid=info.st_uid,
                gid=info.st_gid,
                nlink=info.st_nlink,
                size=info.st_size if kind == "regular" else 0,
                flags=getattr(info, "st_flags", 0),
                mtime_ns=info.st_mtime_ns,
                ctime_ns=info.st_ctime_ns,
                birthtime_ns=int(getattr(info, "st_birthtime", 0) * 1_000_000_000),
                acl=acl,
                xattrs=xattrs,
            )
        )
    return tuple(records)


def _hash_regular_no_follow(path: Path) -> tuple[int, str]:
    before = os.lstat(path)
    descriptor = os.open(path, os.O_RDONLY | O_NOFOLLOW)
    digest = hashlib.sha256()
    try:
        opened = os.fstat(descriptor)
        if (before.st_dev, before.st_ino, before.st_mode) != (
            opened.st_dev,
            opened.st_ino,
            opened.st_mode,
        ):
            raise SealError(
                f"file identity changed before read: {path}",
                exit_code=EXIT_SOURCE_CHANGED,
            )
        while chunk := os.read(descriptor, 1024 * 1024):
            digest.update(chunk)
        after_fd = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    after_path = os.lstat(path)
    before_identity = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
    after_identity = (
        after_fd.st_dev,
        after_fd.st_ino,
        after_fd.st_size,
        after_fd.st_mtime_ns,
    )
    path_identity = (
        after_path.st_dev,
        after_path.st_ino,
        after_path.st_size,
        after_path.st_mtime_ns,
    )
    if before_identity != after_identity or after_identity != path_identity:
        raise SealError(
            f"file changed during read: {path}",
            exit_code=EXIT_SOURCE_CHANGED,
        )
    return before.st_size, digest.hexdigest()


def build_byte_inventory(
    root: Path,
    *,
    inventory: Sequence[ObjectRecord] | None = None,
    expected_uid: int | None = None,
    acl_reader: AclReader | None = None,
    xattr_reader: XattrReader | None = None,
) -> dict[str, Any]:
    """Hash path/type/size/content while excluding mutable timestamps."""
    root = Path(root)
    records = tuple(
        inventory
        or inventory_tree_no_links(
            root,
            expected_uid=expected_uid,
            acl_reader=acl_reader,
            xattr_reader=xattr_reader,
        )
    )
    entries: list[dict[str, Any]] = []
    for record in records:
        entry: dict[str, Any] = {
            "path": record.relative_path,
            "type": record.object_type,
            "size": 0,
            "sha256": None,
            "xattrs": list(record.xattrs),
        }
        if record.object_type == "regular":
            path = root if record.relative_path == "." else root / record.relative_path
            size, digest = _hash_regular_no_follow(path)
            entry.update(size=size, sha256=digest)
        entries.append(entry)
    byte_projection = [
        {
            "path": entry["path"],
            "type": entry["type"],
            "size": entry["size"],
            "sha256": entry["sha256"],
        }
        for entry in entries
    ]
    canonical = _canonical_json({"algorithm": "sha256-path-type-size-content-v1", "entries": byte_projection})
    xattr_projection = [
        {
            "path": entry["path"],
            "xattrs": entry["xattrs"],
        }
        for entry in entries
    ]
    xattr_canonical = _canonical_json(
        {
            "algorithm": "sha256-path-xattr-name-size-content-v1",
            "entries": xattr_projection,
        }
    )
    return {
        "algorithm": "sha256-path-type-size-content-v1",
        "entries": entries,
        "root_sha256": _sha256_bytes(canonical),
        "xattr_algorithm": "sha256-path-xattr-name-size-content-v1",
        "xattr_root_sha256": _sha256_bytes(xattr_canonical),
    }


def _preflight_for_mutation(
    root: Path,
    *,
    expected_volume_uuid: str,
    expected_uid: int | None,
    volume_info_provider: VolumeInfoProvider | None,
) -> dict[str, Any]:
    return preflight_apfs_root(
        root,
        expected_volume_uuid=expected_volume_uuid,
        expected_uid=expected_uid,
        volume_info_provider=volume_info_provider,
    )


def _bottom_up_paths(root: Path, records: Sequence[ObjectRecord]) -> list[Path]:
    return [
        root if record.relative_path == "." else root / record.relative_path
        for record in sorted(
            records,
            key=lambda item: (
                item.relative_path == ".",
                -item.relative_path.count("/"),
                os.fsencode(item.relative_path),
            ),
        )
    ]


def apply_read_only_modes(
    root: Path,
    *,
    expected_volume_uuid: str = EXPECTED_APFS_UUID,
    expected_uid: int | None = None,
    volume_info_provider: VolumeInfoProvider | None = None,
) -> dict[str, Any]:
    """Apply files 0400 and directories 0500, children before root."""
    root = Path(root)
    _preflight_for_mutation(
        root,
        expected_volume_uuid=expected_volume_uuid,
        expected_uid=expected_uid,
        volume_info_provider=volume_info_provider,
    )
    records = inventory_tree_no_links(root, expected_uid=expected_uid)
    expected_by_path = {item.relative_path: item for item in records}
    completed: list[str] = []
    try:
        for path in _bottom_up_paths(root, records):
            relative = "." if path == root else path.relative_to(root).as_posix()
            expected = expected_by_path[relative]
            open_flags = os.O_RDONLY | O_NOFOLLOW
            if expected.object_type == "directory":
                open_flags |= O_DIRECTORY
            descriptor = os.open(path, open_flags)
            try:
                before_fd = os.fstat(descriptor)
                before_path = os.lstat(path)
                expected_identity = (expected.device, expected.inode)
                if (
                    (before_fd.st_dev, before_fd.st_ino) != expected_identity
                    or (before_path.st_dev, before_path.st_ino) != expected_identity
                    or stat.S_IFMT(before_fd.st_mode) != stat.S_IFMT(before_path.st_mode)
                ):
                    raise OSError(errno.EIO, "identity changed before chmod")
                mode = READ_ONLY_DIRECTORY_MODE if expected.object_type == "directory" else READ_ONLY_FILE_MODE
                os.fchmod(descriptor, mode)
                os.fsync(descriptor)
                after_fd = os.fstat(descriptor)
                after_path = os.lstat(path)
                if (
                    (after_fd.st_dev, after_fd.st_ino) != expected_identity
                    or (after_path.st_dev, after_path.st_ino) != expected_identity
                    or stat.S_IMODE(after_fd.st_mode) != mode
                    or stat.S_IMODE(after_path.st_mode) != mode
                ):
                    raise OSError(errno.EIO, "identity or mode read-back mismatch")
            finally:
                os.close(descriptor)
            completed.append(relative)
    except OSError as exc:
        raise SealError(
            "partial read-only mode application; candidate is quarantined",
            exit_code=EXIT_PARTIAL_SEAL,
            details={"completed": completed, "failed": str(path), "actions": []},
        ) from exc
    return {"mode_objects": len(completed), "completed": completed}


def apply_immutable_flags_bottom_up(
    root: Path,
    *,
    include_root: bool = True,
    expected_volume_uuid: str = EXPECTED_APFS_UUID,
    expected_uid: int | None = None,
    volume_info_provider: VolumeInfoProvider | None = None,
) -> dict[str, Any]:
    """Add UF_IMMUTABLE bottom-up and never clear flags on failure."""
    root = Path(root)
    _preflight_for_mutation(
        root,
        expected_volume_uuid=expected_volume_uuid,
        expected_uid=expected_uid,
        volume_info_provider=volume_info_provider,
    )
    records = inventory_tree_no_links(root, expected_uid=expected_uid)
    presealed = [item.relative_path for item in records if item.flags & stat.UF_IMMUTABLE]
    if presealed:
        raise SealError(
            "fresh candidate already contains immutable objects; quarantine it",
            exit_code=EXIT_PARTIAL_SEAL,
            details={"presealed": presealed, "actions": []},
        )
    paths = _bottom_up_paths(root, records)
    if not include_root:
        paths = [path for path in paths if path != root]
    sealed: list[str] = []
    try:
        for path in paths:
            before = os.lstat(path)
            os.chflags(
                path,
                getattr(before, "st_flags", 0) | stat.UF_IMMUTABLE,
                follow_symlinks=False,
            )
            after = os.lstat(path)
            if (after.st_dev, after.st_ino) != (before.st_dev, before.st_ino):
                raise OSError(errno.EIO, "identity changed during chflags")
            if not getattr(after, "st_flags", 0) & stat.UF_IMMUTABLE:
                raise OSError(errno.EIO, "immutable flag read-back mismatch")
            sealed.append("." if path == root else path.relative_to(root).as_posix())
    except OSError as exc:
        all_paths = ["." if item == root else item.relative_to(root).as_posix() for item in paths]
        raise SealError(
            "partial recursive seal; candidate is quarantined",
            exit_code=EXIT_PARTIAL_SEAL,
            details={
                "sealed": sealed,
                "unsealed": [item for item in all_paths if item not in sealed],
                "failed": str(path),
                "actions": [],
            },
        ) from exc
    return {"sealed_objects": len(sealed), "sealed": sealed}


def verify_recursive_seal(
    root: Path,
    *,
    expected_bytes: Mapping[str, Any] | None = None,
    expected_volume_uuid: str = EXPECTED_APFS_UUID,
    expected_uid: int | None = None,
    volume_info_provider: VolumeInfoProvider | None = None,
) -> dict[str, Any]:
    root = Path(root)
    preflight = _preflight_for_mutation(
        root,
        expected_volume_uuid=expected_volume_uuid,
        expected_uid=expected_uid,
        volume_info_provider=volume_info_provider,
    )
    records = inventory_tree_no_links(root, expected_uid=expected_uid)
    violations: list[str] = []
    for record in records:
        expected_mode = READ_ONLY_DIRECTORY_MODE if record.object_type == "directory" else READ_ONLY_FILE_MODE
        if record.mode != expected_mode:
            violations.append(f"{record.relative_path}:mode={record.mode:04o}")
        if not record.flags & stat.UF_IMMUTABLE:
            violations.append(f"{record.relative_path}:unsealed")
    current_bytes = build_byte_inventory(root, inventory=records)
    if expected_bytes is not None:
        if current_bytes["root_sha256"] != expected_bytes.get("root_sha256"):
            violations.append("byte-inventory-mismatch")
        if current_bytes["xattr_root_sha256"] != expected_bytes.get("xattr_root_sha256"):
            violations.append("xattr-inventory-mismatch")
    if violations:
        raise SealError(
            "recursive seal verification found unsealed or changed objects",
            exit_code=EXIT_PARTIAL_SEAL,
            details={"violations": violations},
        )
    return {
        **preflight,
        "total_objects": len(records),
        "sealed_objects": len(records),
        "byte_root_sha256": current_bytes["root_sha256"],
        "xattr_root_sha256": current_bytes["xattr_root_sha256"],
    }


def _first_regular(root: Path) -> Path:
    for record in inventory_tree_no_links(root):
        if record.object_type == "regular":
            return root / record.relative_path
    raise SealError("negative probes require at least one regular file", exit_code=EXIT_NEGATIVE_PROBE)


def _negative_probe_operations(root: Path, nonce: str) -> list[tuple[str, Callable[[], None]]]:
    target = _first_regular(root)
    create_target = root / f".seal-negative-create-{nonce}"
    rename_target = target.with_name(f".seal-negative-rename-{nonce}")
    root_rename_target = root.with_name(f".seal-negative-root-{nonce}")

    def write() -> None:
        descriptor = os.open(target, os.O_WRONLY | O_NOFOLLOW)
        os.close(descriptor)

    def create() -> None:
        descriptor = os.open(
            create_target,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | O_NOFOLLOW,
            0o600,
        )
        os.close(descriptor)

    return [
        ("create-child", create),
        ("overwrite", write),
        ("truncate", lambda: os.truncate(target, 0)),
        ("chmod", lambda: os.chmod(target, 0o600, follow_symlinks=False)),
        ("mtime", lambda: os.utime(target, None, follow_symlinks=False)),
        ("rename-file", lambda: os.rename(target, rename_target)),
        ("unlink-file", lambda: os.unlink(target)),
        ("rename-root", lambda: os.rename(root, root_rename_target)),
    ]


def run_negative_mutation_probes(
    root: Path,
    *,
    baseline: Mapping[str, Any] | None = None,
    nonce: str | None = None,
) -> list[dict[str, Any]]:
    """Require EPERM/EACCES for every forbidden mutation and rehash each time."""
    root = Path(root)
    expected = dict(baseline or build_byte_inventory(root))
    results: list[dict[str, Any]] = []
    for name, operation in _negative_probe_operations(root, nonce or uuid.uuid4().hex):
        try:
            operation()
        except OSError as exc:
            if exc.errno not in DENIAL_ERRNOS:
                raise SealError(
                    f"negative probe {name} failed without a permission denial",
                    exit_code=EXIT_NEGATIVE_PROBE,
                    details={"probe": name, "errno": exc.errno},
                ) from exc
            result = {"name": name, "denied": True, "errno": exc.errno}
            results.append(result)
        else:
            raise SealError(
                f"negative probe {name} unexpectedly succeeded; candidate is quarantined",
                exit_code=EXIT_NEGATIVE_PROBE,
                details={"probe": name},
            )
        current = build_byte_inventory(root)
        if current["root_sha256"] != expected.get("root_sha256") or current["xattr_root_sha256"] != expected.get(
            "xattr_root_sha256"
        ):
            raise SealError(
                f"negative probe {name} changed evidence bytes or xattrs",
                exit_code=EXIT_NEGATIVE_PROBE,
                details={"probe": name},
            )
    return results


def _exclusive_rename(source: Path, destination: Path) -> None:
    if sys.platform == "darwin":
        libc = ctypes.CDLL(None, use_errno=True)
        renamex_np = libc.renamex_np
        renamex_np.argtypes = (ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint)
        renamex_np.restype = ctypes.c_int
        if renamex_np(os.fsencode(source), os.fsencode(destination), 0x00000004) == 0:
            return
        error_number = ctypes.get_errno()
        if error_number in {errno.EEXIST, errno.ENOTEMPTY}:
            raise SealError(
                f"destination already exists: {destination}",
                exit_code=EXIT_MATERIALIZATION_INVALID,
            )
        raise OSError(error_number, os.strerror(error_number), str(destination))
    if os.path.lexists(destination):
        raise SealError(
            f"destination already exists: {destination}",
            exit_code=EXIT_MATERIALIZATION_INVALID,
        )
    os.rename(source, destination)


def atomic_publish_directory(source: Path, destination: Path) -> None:
    source = Path(source)
    destination = Path(destination)
    if os.path.lexists(destination):
        raise SealError(
            f"destination already exists: {destination}",
            exit_code=EXIT_MATERIALIZATION_INVALID,
        )
    source_info = os.lstat(source)
    parent_info = os.lstat(destination.parent)
    if source_info.st_dev != parent_info.st_dev:
        raise SealError(
            "atomic publication requires source and destination on the same device",
            exit_code=EXIT_MATERIALIZATION_INVALID,
        )
    _exclusive_rename(source, destination)
    descriptor = os.open(destination.parent, os.O_RDONLY | O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _write_exclusive(path: Path, payload: bytes, mode: int = 0o400) -> None:
    descriptor = os.open(
        path,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | O_NOFOLLOW,
        mode,
    )
    try:
        view = memoryview(payload)
        while view:
            written = os.write(descriptor, view)
            view = view[written:]
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _verify_and_sync_protected_file(path: Path, expected_identity: tuple[int, int]) -> None:
    descriptor = os.open(path, os.O_RDONLY | O_NOFOLLOW)
    try:
        descriptor_info = os.fstat(descriptor)
        path_info = os.lstat(path)
        if (
            (descriptor_info.st_dev, descriptor_info.st_ino) != expected_identity
            or (path_info.st_dev, path_info.st_ino) != expected_identity
            or stat.S_IMODE(descriptor_info.st_mode) != READ_ONLY_FILE_MODE
            or stat.S_IMODE(path_info.st_mode) != READ_ONLY_FILE_MODE
            or not getattr(descriptor_info, "st_flags", 0) & stat.UF_IMMUTABLE
            or not getattr(path_info, "st_flags", 0) & stat.UF_IMMUTABLE
        ):
            raise OSError(errno.EIO, "protected receipt file read-back mismatch")
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def publish_receipt_atomically(
    receipt_directory: Path,
    receipt: Mapping[str, Any],
    *,
    schema: Mapping[str, Any],
    expected_volume_uuid: str = EXPECTED_APFS_UUID,
    volume_info_provider: VolumeInfoProvider | None = None,
) -> dict[str, Any]:
    """Publish receipt+checksum as one no-clobber directory transaction."""
    if receipt.get("status") != "PASS":
        raise SealError(
            "receipt may be published only after all PASS preconditions",
            exit_code=EXIT_RECEIPT_PROTECTION,
        )
    try:
        from jsonschema import Draft202012Validator
    except ImportError as exc:
        raise SealError(
            "jsonschema is required for receipt publication",
            exit_code=EXIT_RECEIPT_PROTECTION,
        ) from exc
    errors = sorted(Draft202012Validator(schema).iter_errors(dict(receipt)), key=lambda item: list(item.path))
    if errors:
        raise SealError(
            "receipt does not match its frozen schema",
            exit_code=EXIT_RECEIPT_PROTECTION,
            details={"errors": [item.message for item in errors[:10]]},
        )
    final = Path(receipt_directory)
    parent = final.parent
    preflight_apfs_root(
        parent,
        expected_volume_uuid=expected_volume_uuid,
        volume_info_provider=volume_info_provider,
    )
    if os.path.lexists(final):
        raise SealError(
            f"receipt destination already exists: {final}",
            exit_code=EXIT_RECEIPT_PROTECTION,
        )
    staging = parent / f".{final.name}.staging-{uuid.uuid4().hex}"
    os.mkdir(staging, 0o700)
    receipt_path = staging / "receipt.json"
    checksum_path = staging / "receipt.sha256"
    receipt_bytes = _canonical_json(dict(receipt))
    digest = _sha256_bytes(receipt_bytes)
    try:
        _write_exclusive(receipt_path, receipt_bytes)
        _write_exclusive(checksum_path, f"{digest}\n".encode())
        for path in (receipt_path, checksum_path):
            os.chmod(path, 0o400, follow_symlinks=False)
            info = os.lstat(path)
            expected_identity = (info.st_dev, info.st_ino)
            os.chflags(
                path,
                getattr(info, "st_flags", 0) | stat.UF_IMMUTABLE,
                follow_symlinks=False,
            )
            _verify_and_sync_protected_file(path, expected_identity)
        descriptor = os.open(staging, os.O_RDONLY | O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        os.chmod(staging, 0o500, follow_symlinks=False)
        atomic_publish_directory(staging, final)
        root_info = os.lstat(final)
        expected_root_identity = (root_info.st_dev, root_info.st_ino)
        os.chflags(
            final,
            getattr(root_info, "st_flags", 0) | stat.UF_IMMUTABLE,
            follow_symlinks=False,
        )
        descriptor = os.open(final, os.O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        try:
            descriptor_info = os.fstat(descriptor)
            path_info = os.lstat(final)
            if (
                (descriptor_info.st_dev, descriptor_info.st_ino) != expected_root_identity
                or (path_info.st_dev, path_info.st_ino) != expected_root_identity
                or stat.S_IMODE(descriptor_info.st_mode) != READ_ONLY_DIRECTORY_MODE
                or not getattr(descriptor_info, "st_flags", 0) & stat.UF_IMMUTABLE
                or not getattr(path_info, "st_flags", 0) & stat.UF_IMMUTABLE
            ):
                raise OSError(errno.EIO, "protected receipt directory read-back mismatch")
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except (OSError, SealError) as exc:
        raise SealError(
            "receipt publication/protection failed; receipt is non-authoritative",
            exit_code=EXIT_RECEIPT_PROTECTION,
            details={"staging": str(staging), "final": str(final)},
        ) from exc
    return {
        "directory": str(final),
        "receipt": str(final / "receipt.json"),
        "checksum": str(final / "receipt.sha256"),
        "receipt_sha256": digest,
    }


def verify_receipt_self_protection(
    receipt_directory: Path,
    *,
    expected_volume_uuid: str = EXPECTED_APFS_UUID,
    volume_info_provider: VolumeInfoProvider | None = None,
) -> dict[str, Any]:
    root = Path(receipt_directory)
    verification = verify_recursive_seal(
        root,
        expected_volume_uuid=expected_volume_uuid,
        volume_info_provider=volume_info_provider,
    )
    receipt = root / "receipt.json"
    checksum = root / "receipt.sha256"
    checksum_text = checksum.read_text(encoding="ascii")
    if re.fullmatch(r"[0-9a-f]{64}\n", checksum_text) is None:
        raise SealError(
            "receipt checksum sidecar has invalid syntax",
            exit_code=EXIT_RECEIPT_PROTECTION,
        )
    digest = _sha256_bytes(receipt.read_bytes())
    if checksum_text.rstrip("\n") != digest:
        raise SealError(
            "receipt checksum mismatch",
            exit_code=EXIT_RECEIPT_PROTECTION,
        )
    try:
        probes = run_negative_mutation_probes(root)
    except SealError as exc:
        raise SealError(
            "receipt self-protection probes failed",
            exit_code=EXIT_RECEIPT_PROTECTION,
            details=exc.details,
        ) from exc
    return {**verification, "receipt_sha256": digest, "negative_probes": probes}


__all__ = [
    "EXPECTED_APFS_UUID",
    "ObjectRecord",
    "SealError",
    "apply_immutable_flags_bottom_up",
    "apply_read_only_modes",
    "atomic_publish_directory",
    "build_byte_inventory",
    "inventory_tree_no_links",
    "preflight_apfs_root",
    "publish_receipt_atomically",
    "run_negative_mutation_probes",
    "verify_receipt_self_protection",
    "verify_recursive_seal",
]
