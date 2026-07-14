# ruff: noqa: INP001 -- package initializer is owned by the integration controller.

from __future__ import annotations

import hashlib
import importlib
import json
import os
import stat
from pathlib import Path

import pytest


def _filesystem_module():
    try:
        return importlib.import_module("ketos.brand_state.filesystem")
    except ModuleNotFoundError as exc:
        pytest.fail(f"filesystem implementation is missing: {exc}")


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def test_atomic_text_and_json_writes_publish_from_held_parent_and_fsync(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    filesystem = _filesystem_module()
    root = tmp_path / "root"
    root.mkdir()
    text_path = root / "state.txt"
    json_path = root / "manifest.json"
    publishes: list[tuple[str, str, int | None, int | None]] = []
    fsync_calls: list[int] = []
    real_link = os.link
    real_fsync = os.fsync

    def recording_link(source, destination, *, src_dir_fd=None, dst_dir_fd=None, follow_symlinks=True) -> None:
        publishes.append((os.fspath(source), os.fspath(destination), src_dir_fd, dst_dir_fd))
        real_link(
            source,
            destination,
            src_dir_fd=src_dir_fd,
            dst_dir_fd=dst_dir_fd,
            follow_symlinks=follow_symlinks,
        )

    def recording_fsync(fd: int) -> None:
        fsync_calls.append(fd)
        real_fsync(fd)

    monkeypatch.setattr(filesystem.os, "link", recording_link)
    monkeypatch.setattr(filesystem.os, "fsync", recording_fsync)

    filesystem.atomic_write_text(text_path, "hello\n", root=root, mode=0o640)
    filesystem.atomic_write_json(json_path, {"z": 1, "a": 2}, root=root)

    assert text_path.read_text(encoding="utf-8") == "hello\n"
    assert stat.S_IMODE(text_path.stat().st_mode) == 0o640
    assert json_path.read_text(encoding="utf-8") == '{"a":2,"z":1}\n'
    assert json.loads(json_path.read_text(encoding="utf-8")) == {"a": 2, "z": 1}
    assert len(publishes) == 2
    assert {destination for _, destination, _, _ in publishes} == {text_path.name, json_path.name}
    assert all(source.startswith(f".{destination}.") for source, destination, _, _ in publishes)
    assert all(source_fd == destination_fd and source_fd is not None for _, _, source_fd, destination_fd in publishes)
    assert len(fsync_calls) >= 4


def test_checksum_verification_detects_tampering(tmp_path: Path) -> None:
    filesystem = _filesystem_module()
    root = tmp_path / "root"
    root.mkdir()
    path = root / "state.bin"
    original = b"trusted-state"
    path.write_bytes(original)

    assert filesystem.verify_checksum(path, _sha256(original), root=root) == len(original)

    path.write_bytes(b"tampered-state")
    with pytest.raises(filesystem.ChecksumMismatchError, match="checksum"):
        filesystem.verify_checksum(path, _sha256(original), root=root)


def test_reads_reject_symlinks_special_files_and_path_escape(tmp_path: Path) -> None:
    filesystem = _filesystem_module()
    root = tmp_path / "root"
    root.mkdir()
    regular = root / "regular"
    regular.write_bytes(b"content")
    symlink = root / "link"
    symlink.symlink_to(regular)

    with pytest.raises(filesystem.FilesystemSafetyError, match="symlink"):
        filesystem.sha256_file(symlink, root=root)

    outside = tmp_path / "outside"
    outside.write_bytes(b"outside")
    with pytest.raises(filesystem.FilesystemSafetyError, match="escape"):
        filesystem.sha256_file(root / ".." / "outside", root=root)

    if hasattr(os, "mkfifo"):
        fifo = root / "fifo"
        os.mkfifo(fifo)
        with pytest.raises(filesystem.FilesystemSafetyError, match="regular"):
            filesystem.sha256_file(fifo, root=root)


def test_copy_is_checksummed_preserves_mode_and_classifies_conflicts(
    tmp_path: Path,
) -> None:
    filesystem = _filesystem_module()
    source_root = tmp_path / "source"
    destination_root = tmp_path / "destination"
    source_root.mkdir()
    destination_root.mkdir()
    source = source_root / "state.bin"
    destination = destination_root / "state.bin"
    content = b"state-payload"
    source.write_bytes(content)
    source.chmod(0o640)
    expected = _sha256(content)

    assert (
        filesystem.classify_destination(destination, expected, root=destination_root)
        is filesystem.DestinationClassification.ABSENT
    )
    result = filesystem.copy_with_checksum(
        source,
        destination,
        source_root=source_root,
        destination_root=destination_root,
        expected_sha256=expected,
    )
    assert result.classification is filesystem.DestinationClassification.ABSENT
    assert result.sha256 == expected
    assert result.size == len(content)
    assert destination.read_bytes() == content
    assert stat.S_IMODE(destination.stat().st_mode) == 0o640
    assert (
        filesystem.classify_destination(destination, expected, root=destination_root)
        is filesystem.DestinationClassification.IDENTICAL
    )

    identical = filesystem.copy_with_checksum(
        source,
        destination,
        source_root=source_root,
        destination_root=destination_root,
        expected_sha256=expected,
    )
    assert identical.classification is filesystem.DestinationClassification.IDENTICAL

    destination.write_bytes(b"different")
    with pytest.raises(filesystem.DestinationConflictError) as different:
        filesystem.copy_with_checksum(
            source,
            destination,
            source_root=source_root,
            destination_root=destination_root,
            expected_sha256=expected,
        )
    assert different.value.classification is filesystem.DestinationClassification.DIFFERENT

    destination.unlink()
    destination.symlink_to(source)
    assert (
        filesystem.classify_destination(destination, expected, root=destination_root)
        is filesystem.DestinationClassification.SYMLINK
    )

    destination.unlink()
    destination.mkdir()
    assert (
        filesystem.classify_destination(destination, expected, root=destination_root)
        is filesystem.DestinationClassification.SPECIAL
    )


def test_copy_rejects_source_symlink_and_bad_expected_checksum(tmp_path: Path) -> None:
    filesystem = _filesystem_module()
    source_root = tmp_path / "source"
    destination_root = tmp_path / "destination"
    source_root.mkdir()
    destination_root.mkdir()
    source = source_root / "state.bin"
    source.write_bytes(b"state")
    link = source_root / "link.bin"
    link.symlink_to(source)

    with pytest.raises(filesystem.FilesystemSafetyError, match="symlink"):
        filesystem.copy_with_checksum(
            link,
            destination_root / "state.bin",
            source_root=source_root,
            destination_root=destination_root,
            expected_sha256=_sha256(b"state"),
        )

    with pytest.raises(filesystem.ChecksumMismatchError, match="checksum"):
        filesystem.copy_with_checksum(
            source,
            destination_root / "state.bin",
            source_root=source_root,
            destination_root=destination_root,
            expected_sha256="0" * 64,
        )


def test_remove_only_transaction_created_file_with_checksum_guard(tmp_path: Path) -> None:
    filesystem = _filesystem_module()
    root = tmp_path / "root"
    root.mkdir()
    path = root / "created.bin"
    content = b"created"
    path.write_bytes(content)
    expected = _sha256(content)

    with pytest.raises(filesystem.FilesystemSafetyError, match="transaction-created"):
        filesystem.remove_transaction_created(path, root=root, transaction_created=(), expected_sha256=expected)
    assert path.exists()

    with pytest.raises(filesystem.ChecksumMismatchError, match="checksum"):
        filesystem.remove_transaction_created(
            path,
            root=root,
            transaction_created=(path,),
            expected_sha256="0" * 64,
        )
    assert path.exists()

    filesystem.remove_transaction_created(
        path,
        root=root,
        transaction_created=(path,),
        expected_sha256=expected,
    )
    assert not path.exists()


def test_restore_backup_is_checksum_guarded_and_replaces_only_created_destination(
    tmp_path: Path,
) -> None:
    filesystem = _filesystem_module()
    backup_root = tmp_path / "backups"
    destination_root = tmp_path / "destination"
    backup_root.mkdir()
    destination_root.mkdir()
    backup = backup_root / "state.bin"
    destination = destination_root / "state.bin"
    backup_content = b"original-state"
    created_content = b"transaction-state"
    backup.write_bytes(backup_content)
    backup.chmod(0o600)
    backup_sha = _sha256(backup_content)

    filesystem.restore_backup(
        backup,
        destination,
        backup_root=backup_root,
        destination_root=destination_root,
        expected_backup_sha256=backup_sha,
        transaction_created=(),
    )
    assert destination.read_bytes() == backup_content
    assert stat.S_IMODE(destination.stat().st_mode) == 0o600

    destination.write_bytes(created_content)
    with pytest.raises(filesystem.FilesystemSafetyError, match="transaction-created"):
        filesystem.restore_backup(
            backup,
            destination,
            backup_root=backup_root,
            destination_root=destination_root,
            expected_backup_sha256=backup_sha,
            transaction_created=(),
        )

    with pytest.raises(filesystem.ChecksumMismatchError, match="checksum"):
        filesystem.restore_backup(
            backup,
            destination,
            backup_root=backup_root,
            destination_root=destination_root,
            expected_backup_sha256=backup_sha,
            transaction_created=(destination,),
            expected_destination_sha256="0" * 64,
        )

    filesystem.restore_backup(
        backup,
        destination,
        backup_root=backup_root,
        destination_root=destination_root,
        expected_backup_sha256=backup_sha,
        transaction_created=(destination,),
        expected_destination_sha256=_sha256(created_content),
    )
    assert destination.read_bytes() == backup_content

    backup.write_bytes(b"tampered-backup")
    destination.unlink()
    with pytest.raises(filesystem.ChecksumMismatchError, match="checksum"):
        filesystem.restore_backup(
            backup,
            destination,
            backup_root=backup_root,
            destination_root=destination_root,
            expected_backup_sha256=backup_sha,
            transaction_created=(),
        )


def test_atomic_write_anchors_parent_when_ancestor_is_swapped_after_open(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    filesystem = _filesystem_module()
    root = tmp_path / "root"
    ancestor = root / "safe"
    parent = ancestor / "inner"
    detached = root / "safe-detached"
    outside = tmp_path / "outside"
    parent.mkdir(parents=True)
    (outside / "inner").mkdir(parents=True)
    target = parent / "state.txt"
    real_open = os.open
    swapped = False

    def racing_open(path, flags, mode=0o777, *, dir_fd=None):
        nonlocal swapped
        descriptor = real_open(path, flags, mode, dir_fd=dir_fd)
        opened_final_parent = (dir_fd is None and Path(path) == parent) or (
            dir_fd is not None and os.fspath(path) == parent.name
        )
        if opened_final_parent and not swapped:
            swapped = True
            ancestor.rename(detached)
            ancestor.symlink_to(outside, target_is_directory=True)
        return descriptor

    monkeypatch.setattr(filesystem.os, "open", racing_open)

    filesystem.atomic_write_text(target, "trusted\n", root=root)

    assert swapped
    assert not (outside / "inner" / "state.txt").exists()
    assert (detached / "inner" / "state.txt").read_text(encoding="utf-8") == "trusted\n"


def test_identical_copy_rejects_destination_with_different_mode(tmp_path: Path) -> None:
    filesystem = _filesystem_module()
    source_root = tmp_path / "source"
    destination_root = tmp_path / "destination"
    source_root.mkdir()
    destination_root.mkdir()
    source = source_root / "secret"
    destination = destination_root / "secret"
    content = b"secret-state"
    source.write_bytes(content)
    source.chmod(0o600)
    destination.write_bytes(content)
    destination.chmod(0o644)

    with pytest.raises(filesystem.DestinationConflictError) as conflict:
        filesystem.copy_with_checksum(
            source,
            destination,
            source_root=source_root,
            destination_root=destination_root,
            expected_sha256=_sha256(content),
        )

    assert conflict.value.classification is filesystem.DestinationClassification.MODE_MISMATCH
    assert stat.S_IMODE(destination.stat().st_mode) == 0o644


def test_remove_quarantines_name_before_unlink_and_restores_racing_replacement(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    filesystem = _filesystem_module()
    root = tmp_path / "root"
    root.mkdir()
    target = root / "created.bin"
    replacement = root / "replacement.bin"
    trusted = b"transaction-created"
    attacker = b"concurrent-replacement"
    target.write_bytes(trusted)
    replacement.write_bytes(attacker)
    real_unlink = os.unlink
    real_rename = os.rename
    armed = True

    def swap_target() -> None:
        nonlocal armed
        armed = False
        real_unlink(target)
        real_rename(replacement, target)

    def racing_unlink(path, *, dir_fd=None):
        target_unlink = (dir_fd is None and Path(path) == target) or (
            dir_fd is not None and os.fspath(path) == target.name
        )
        if armed and target_unlink:
            swap_target()
        return real_unlink(path, dir_fd=dir_fd)

    def racing_rename(source, destination, *, src_dir_fd=None, dst_dir_fd=None):
        target_rename = (src_dir_fd is None and Path(source) == target) or (
            src_dir_fd is not None and os.fspath(source) == target.name
        )
        if armed and target_rename:
            swap_target()
        return real_rename(source, destination, src_dir_fd=src_dir_fd, dst_dir_fd=dst_dir_fd)

    monkeypatch.setattr(filesystem.os, "unlink", racing_unlink)
    monkeypatch.setattr(filesystem.os, "rename", racing_rename)

    with pytest.raises(filesystem.FilesystemSafetyError, match="changed before removal"):
        filesystem.remove_transaction_created(
            target,
            root=root,
            transaction_created=(target,),
            expected_sha256=_sha256(trusted),
        )

    assert target.read_bytes() == attacker


def test_restore_does_not_overwrite_racing_replacement(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    filesystem = _filesystem_module()
    backup_root = tmp_path / "backups"
    destination_root = tmp_path / "destination"
    backup_root.mkdir()
    destination_root.mkdir()
    backup = backup_root / "state.bin"
    destination = destination_root / "state.bin"
    replacement = destination_root / "replacement.bin"
    backup_content = b"original-state"
    transaction_content = b"transaction-state"
    attacker = b"concurrent-replacement"
    backup.write_bytes(backup_content)
    destination.write_bytes(transaction_content)
    replacement.write_bytes(attacker)
    real_replace = os.replace
    real_rename = os.rename
    real_unlink = os.unlink
    armed = True

    def swap_destination() -> None:
        nonlocal armed
        armed = False
        real_unlink(destination)
        real_rename(replacement, destination)

    def racing_replace(source, target, *, src_dir_fd=None, dst_dir_fd=None):
        target_replace = (dst_dir_fd is None and Path(target) == destination) or (
            dst_dir_fd is not None and os.fspath(target) == destination.name
        )
        if armed and target_replace:
            swap_destination()
        return real_replace(source, target, src_dir_fd=src_dir_fd, dst_dir_fd=dst_dir_fd)

    def racing_rename(source, target, *, src_dir_fd=None, dst_dir_fd=None):
        target_rename = (src_dir_fd is None and Path(source) == destination) or (
            src_dir_fd is not None and os.fspath(source) == destination.name
        )
        if armed and target_rename:
            swap_destination()
        return real_rename(source, target, src_dir_fd=src_dir_fd, dst_dir_fd=dst_dir_fd)

    monkeypatch.setattr(filesystem.os, "replace", racing_replace)
    monkeypatch.setattr(filesystem.os, "rename", racing_rename)

    with pytest.raises(filesystem.FilesystemSafetyError, match="changed before removal"):
        filesystem.restore_backup(
            backup,
            destination,
            backup_root=backup_root,
            destination_root=destination_root,
            expected_backup_sha256=_sha256(backup_content),
            transaction_created=(destination,),
            expected_destination_sha256=_sha256(transaction_content),
        )

    assert destination.read_bytes() == attacker
    assert backup.read_bytes() == backup_content
