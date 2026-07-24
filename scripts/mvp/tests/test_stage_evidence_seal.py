from __future__ import annotations

# ruff: noqa: PLR2004, S101 - security contract fixtures use fixed values.
import errno
import importlib.util
import json
import os
import shutil
import stat
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
MODULE = ROOT / "scripts/mvp/stage_evidence_seal.py"
EXPECTED_UUID = "8B3B8A79-88A2-4676-8ED0-4C49EB697CDF"


def load_module():
    spec = importlib.util.spec_from_file_location("stage_evidence_seal", MODULE)
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def seal():
    return load_module()


@pytest.fixture
def payload_tree(tmp_path: Path) -> Path:
    root = tmp_path / "bundle"
    (root / "nested").mkdir(parents=True, mode=0o700)
    (root / "a.txt").write_bytes(b"alpha\n")
    (root / "nested/b.bin").write_bytes(b"\x00\x01beta")
    return root


def volume_info(
    *,
    uuid: str = EXPECTED_UUID,
    personality: str = "APFS",
    mount_point: str = "/",
) -> dict[str, object]:
    return {
        "VolumeUUID": uuid,
        "FilesystemType": "apfs" if personality == "APFS" else "exfat",
        "FilesystemName": personality,
        "MountPoint": mount_point,
    }


def test_preflight_rejects_non_apfs_and_wrong_uuid(seal, payload_tree: Path) -> None:
    with pytest.raises(seal.SealError, match="APFS") as non_apfs:
        seal.preflight_apfs_root(
            payload_tree,
            volume_info_provider=lambda path: volume_info(personality="ExFAT", mount_point=str(path)),
        )
    assert non_apfs.value.exit_code == 20

    with pytest.raises(seal.SealError, match="UUID") as wrong_uuid:
        seal.preflight_apfs_root(
            payload_tree,
            volume_info_provider=lambda path: volume_info(
                uuid="00000000-0000-0000-0000-000000000000",
                mount_point=str(path),
            ),
        )
    assert wrong_uuid.value.exit_code == 20


@pytest.mark.parametrize("kind", ["symlink", "fifo", "socket"])
def test_inventory_rejects_links_and_special_files(seal, payload_tree: Path, kind: str) -> None:
    short_root: Path | None = None
    if kind == "socket":
        short_root = Path(tempfile.mkdtemp(prefix="s9seal-", dir="/private/tmp"))
        payload_tree = short_root / "bundle"
        payload_tree.mkdir()
        (payload_tree / "a.txt").write_text("alpha\n", encoding="utf-8")
    target = payload_tree / "forbidden"
    if kind == "symlink":
        target.symlink_to(payload_tree / "a.txt")
    elif kind == "fifo":
        os.mkfifo(target)
    else:
        import socket

        listener = socket.socket(socket.AF_UNIX)
        listener.bind(str(target))
    try:
        with pytest.raises(seal.SealError, match="forbidden object type") as failure:
            seal.inventory_tree_no_links(payload_tree)
        assert failure.value.exit_code == 20
    finally:
        if kind == "socket":
            listener.close()
        if short_root is not None:
            shutil.rmtree(short_root)


def test_inventory_rejects_hardlinks_wrong_owner_acl_and_xattr(
    seal, payload_tree: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    os.link(payload_tree / "a.txt", payload_tree / "hardlink")
    with pytest.raises(seal.SealError, match="hardlink"):
        seal.inventory_tree_no_links(payload_tree)
    (payload_tree / "hardlink").unlink()

    actual_uid = os.getuid()
    monkeypatch.setattr(seal.os, "getuid", lambda: actual_uid + 1)
    with pytest.raises(seal.SealError, match="owner"):
        seal.inventory_tree_no_links(payload_tree)
    monkeypatch.undo()

    with pytest.raises(seal.SealError, match="ACL"):
        seal.inventory_tree_no_links(
            payload_tree,
            acl_reader=lambda path: ["0: user:someone allow write"] if path.name == "a.txt" else [],
        )
    with pytest.raises(seal.SealError, match="xattr"):
        seal.inventory_tree_no_links(
            payload_tree,
            xattr_reader=lambda path: {"com.example.bad": b"value"} if path.name == "a.txt" else {},
        )


def test_inventory_allows_and_hashes_provenance_xattr(seal, payload_tree: Path) -> None:
    records = seal.inventory_tree_no_links(
        payload_tree,
        xattr_reader=lambda path: {"com.apple.provenance": b"opaque"} if path.name == "a.txt" else {},
    )
    record = next(item for item in records if item.relative_path == "a.txt")
    assert record.xattrs == (
        {
            "name": "com.apple.provenance",
            "sha256": "6d229884c1268bb0ab32d8da315d0fe52f9147228bd830a37bc9fb28a954940d",
            "size": 6,
        },
    )
    first = seal.build_byte_inventory(payload_tree, inventory=records)
    changed_records = seal.inventory_tree_no_links(
        payload_tree,
        xattr_reader=lambda path: {"com.apple.provenance": b"changed"} if path.name == "a.txt" else {},
    )
    changed = seal.build_byte_inventory(payload_tree, inventory=changed_records)
    assert changed["root_sha256"] == first["root_sha256"]
    assert changed["xattr_root_sha256"] != first["xattr_root_sha256"]


def test_inventory_rejects_writable_group_or_other_bits(seal, payload_tree: Path) -> None:
    (payload_tree / "a.txt").chmod(0o620)
    with pytest.raises(seal.SealError, match="group/other writable"):
        seal.inventory_tree_no_links(payload_tree)


def test_byte_inventory_ignores_mtime_but_detects_payload_change(seal, payload_tree: Path) -> None:
    first = seal.build_byte_inventory(payload_tree)
    info = (payload_tree / "a.txt").stat()
    os.utime(payload_tree / "a.txt", ns=(info.st_atime_ns, info.st_mtime_ns + 1_000_000_000))
    second = seal.build_byte_inventory(payload_tree)
    assert second["root_sha256"] == first["root_sha256"]

    (payload_tree / "a.txt").write_bytes(b"changed")
    third = seal.build_byte_inventory(payload_tree)
    assert third["root_sha256"] != first["root_sha256"]


def test_read_only_modes_and_bottom_up_root_last(seal, payload_tree: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    seal.apply_read_only_modes(
        payload_tree,
        volume_info_provider=lambda path: volume_info(mount_point=str(path)),
    )
    assert stat.S_IMODE(payload_tree.stat().st_mode) == 0o500
    assert stat.S_IMODE((payload_tree / "nested").stat().st_mode) == 0o500
    assert stat.S_IMODE((payload_tree / "a.txt").stat().st_mode) == 0o400

    order: list[str] = []
    flagged: set[Path] = set()
    real_lstat = seal.os.lstat

    def fake_chflags(path: os.PathLike[str] | str, flags: int, *, follow_symlinks: bool) -> None:
        assert flags & stat.UF_IMMUTABLE
        assert follow_symlinks is False
        order.append(Path(path).relative_to(payload_tree).as_posix())
        flagged.add(Path(path))

    def lstat_with_flags(path: os.PathLike[str] | str):
        result = real_lstat(path)
        fake = type("FakeStat", (), {})()
        for name in dir(result):
            if name.startswith("st_"):
                setattr(fake, name, getattr(result, name))
        fake.st_flags = stat.UF_IMMUTABLE if Path(path) in flagged else 0
        return fake

    monkeypatch.setattr(seal.os, "chflags", fake_chflags)
    monkeypatch.setattr(seal.os, "lstat", lstat_with_flags)
    result = seal.apply_immutable_flags_bottom_up(
        payload_tree,
        volume_info_provider=lambda path: volume_info(mount_point=str(path)),
    )
    assert order[-1] == "."
    assert set(order[:-1]) == {"a.txt", "nested", "nested/b.bin"}
    assert result["sealed_objects"] == 4


def test_read_only_modes_bind_chmod_to_opened_inode(
    seal,
    payload_tree: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = payload_tree / "a.txt"
    target_identity = (target.stat().st_dev, target.stat().st_ino)
    external = tmp_path / "external.txt"
    external.write_text("external", encoding="utf-8")
    external.chmod(0o600)
    displaced = payload_tree / "a.displaced"
    real_fchmod = seal.os.fchmod
    swapped = False

    def swap_path_before_chmod(descriptor: int, mode: int) -> None:
        nonlocal swapped
        opened = seal.os.fstat(descriptor)
        if not swapped and (opened.st_dev, opened.st_ino) == target_identity:
            target.rename(displaced)
            target.symlink_to(external)
            swapped = True
        real_fchmod(descriptor, mode)

    monkeypatch.setattr(seal.os, "fchmod", swap_path_before_chmod)
    with pytest.raises(seal.SealError, match="quarantined") as failure:
        seal.apply_read_only_modes(
            payload_tree,
            volume_info_provider=lambda path: volume_info(mount_point=str(path)),
        )
    assert failure.value.exit_code == 23
    assert swapped is True
    assert stat.S_IMODE(external.stat().st_mode) == 0o600


def test_partial_seal_never_clears_flags_and_names_all_objects(
    seal, payload_tree: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[Path] = []
    flagged: set[Path] = set()
    real_lstat = seal.os.lstat

    def fail_second(path: os.PathLike[str] | str, flags: int, *, follow_symlinks: bool) -> None:
        del flags, follow_symlinks
        calls.append(Path(path))
        if len(calls) == 2:
            raise OSError(errno.EIO, "fault injection")
        flagged.add(Path(path))

    def lstat_with_flags(path: os.PathLike[str] | str):
        result = real_lstat(path)
        fake = type("FakeStat", (), {})()
        for name in dir(result):
            if name.startswith("st_"):
                setattr(fake, name, getattr(result, name))
        fake.st_flags = stat.UF_IMMUTABLE if Path(path) in flagged else 0
        return fake

    monkeypatch.setattr(seal.os, "chflags", fail_second)
    monkeypatch.setattr(seal.os, "lstat", lstat_with_flags)
    with pytest.raises(seal.SealError) as failure:
        seal.apply_immutable_flags_bottom_up(
            payload_tree,
            volume_info_provider=lambda path: volume_info(mount_point=str(path)),
        )
    assert failure.value.exit_code == 23
    assert failure.value.details["sealed"]
    assert failure.value.details["unsealed"]
    assert not any("clear" in item.lower() for item in failure.value.details.get("actions", []))
    assert len(calls) == 2


def test_verify_recursive_seal_rejects_one_unsealed_descendant(
    seal, payload_tree: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    real_lstat = seal.os.lstat

    def lstat_with_flags(path: os.PathLike[str] | str):
        result = real_lstat(path)
        fake = type("FakeStat", (), {})()
        for name in dir(result):
            if name.startswith("st_"):
                setattr(fake, name, getattr(result, name))
        fake.st_flags = 0 if Path(path).name == "a.txt" else stat.UF_IMMUTABLE
        return fake

    monkeypatch.setattr(seal.os, "lstat", lstat_with_flags)
    with pytest.raises(seal.SealError, match="unsealed") as failure:
        seal.verify_recursive_seal(
            payload_tree,
            volume_info_provider=lambda path: volume_info(mount_point=str(path)),
        )
    assert failure.value.exit_code == 23


def test_exclusive_atomic_publish_rejects_existing_and_cross_device(
    seal, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source"
    source.mkdir()
    destination = tmp_path / "destination"
    destination.mkdir()
    with pytest.raises(seal.SealError, match="exists"):
        seal.atomic_publish_directory(source, destination)

    destination.rmdir()
    real_lstat = seal.os.lstat

    def cross_device(path: os.PathLike[str] | str):
        result = real_lstat(path)
        fake = type("FakeStat", (), {})()
        for name in dir(result):
            if name.startswith("st_"):
                setattr(fake, name, getattr(result, name))
        if Path(path) == destination.parent:
            fake.st_dev = result.st_dev + 1
        return fake

    monkeypatch.setattr(seal.os, "lstat", cross_device)
    with pytest.raises(seal.SealError, match="same device"):
        seal.atomic_publish_directory(source, destination)


def test_negative_probe_success_is_fail_closed(seal, payload_tree: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    baseline = seal.build_byte_inventory(payload_tree)
    monkeypatch.setattr(seal, "_negative_probe_operations", lambda *_args: [("noop", lambda: None)])
    with pytest.raises(seal.SealError, match="unexpectedly succeeded") as failure:
        seal.run_negative_mutation_probes(payload_tree, baseline=baseline)
    assert failure.value.exit_code == 25


def test_receipt_is_not_published_when_precondition_is_not_pass(seal, tmp_path: Path) -> None:
    with pytest.raises(seal.SealError, match="PASS"):
        seal.publish_receipt_atomically(
            tmp_path / "receipt",
            {"status": "fail"},
            schema={"type": "object"},
            volume_info_provider=lambda path: volume_info(mount_point=str(path)),
        )
    assert not (tmp_path / "receipt").exists()


def test_failure_result_has_stable_machine_readable_exit_code(seal) -> None:
    error = seal.SealError("broken", exit_code=22, details={"phase": "schema"})
    assert json.loads(error.to_json()) == {
        "details": {"phase": "schema"},
        "error": "broken",
        "exit_code": 22,
        "status": "fail",
    }
