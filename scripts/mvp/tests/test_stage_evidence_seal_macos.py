from __future__ import annotations

# ruff: noqa: EM101, PLR2004, PTH101, S101, TRY003
import hashlib
import importlib.util
import json
import os
import pwd
import shutil
import stat
import sys
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
MODULE = ROOT / "scripts/mvp/stage_evidence_seal.py"
STAGE10_SEALER = ROOT / "scripts/mvp/seal_evidence_bundle.py"
FIXTURE_PARENT = Path("/Volumes/Projects/.ketos-seal-test-fixtures")


def load_module():
    spec = importlib.util.spec_from_file_location("stage_evidence_seal_macos", MODULE)
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_stage10_sealer():
    spec = importlib.util.spec_from_file_location("stage10_sealer_macos", STAGE10_SEALER)
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def create_fixture() -> tuple[Path, int, str]:
    run_id = uuid.uuid4().hex
    FIXTURE_PARENT.mkdir(mode=0o700, exist_ok=True)
    root = FIXTURE_PARENT / f"fixture-{run_id}"
    root.mkdir(mode=0o700)
    (root / "nested").mkdir(mode=0o700)
    (root / "canary.txt").write_text("canary\n", encoding="utf-8")
    (root / "nested/payload.bin").write_bytes(b"\x00ketos-seal\xff")
    return root, os.lstat(root).st_ino, run_id


def clear_owned_fixture(root: Path, inode: int, run_id: str) -> None:
    canonical_parent = FIXTURE_PARENT.resolve(strict=True)
    if root.parent.resolve(strict=True) != canonical_parent:
        raise AssertionError("fixture cleanup escaped the owned parent")
    if root.name != f"fixture-{run_id}" or os.lstat(root).st_ino != inode:
        raise AssertionError("fixture identity changed before cleanup")
    paths = [root]
    for current, dirnames, filenames in os.walk(root, followlinks=False):
        paths.extend(Path(current) / name for name in dirnames)
        paths.extend(Path(current) / name for name in filenames)
    for path in paths:
        info = os.lstat(path)
        os.chflags(
            path,
            getattr(info, "st_flags", 0) & ~stat.UF_IMMUTABLE,
            follow_symlinks=False,
        )
    for path in paths:
        info = os.lstat(path)
        os.chmod(path, 0o700 if stat.S_ISDIR(info.st_mode) else 0o600, follow_symlinks=False)
    shutil.rmtree(root)


@pytest.mark.skipif(sys.platform != "darwin", reason="requires macOS BSD flags")
def test_real_apfs_recursive_seal_and_denial_probes() -> None:
    seal = load_module()
    root, inode, run_id = create_fixture()
    try:
        baseline = seal.build_byte_inventory(root)
        modes = seal.apply_read_only_modes(root)
        flags = seal.apply_immutable_flags_bottom_up(root)
        verified = seal.verify_recursive_seal(root, expected_bytes=baseline)
        probes = seal.run_negative_mutation_probes(root, baseline=baseline, nonce=run_id)
        assert modes["mode_objects"] == 4
        assert flags["sealed_objects"] == 4
        assert verified["sealed_objects"] == verified["total_objects"] == 4
        assert len(probes) == 8
        assert all(item["denied"] for item in probes)
        assert seal.build_byte_inventory(root)["root_sha256"] == baseline["root_sha256"]
    finally:
        clear_owned_fixture(root, inode, run_id)


@pytest.mark.skipif(sys.platform != "darwin", reason="requires macOS BSD flags")
def test_real_apfs_fault_injection_is_irreversible_and_complete(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seal = load_module()
    root, inode, run_id = create_fixture()
    real_chflags = os.chflags
    calls = 0

    def fail_after_one(path, flags, *, follow_symlinks):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("injected failure before root seal")
        real_chflags(path, flags, follow_symlinks=follow_symlinks)

    try:
        seal.apply_read_only_modes(root)
        monkeypatch.setattr(seal.os, "chflags", fail_after_one)
        with pytest.raises(seal.SealError) as failure:
            seal.apply_immutable_flags_bottom_up(root)
        assert failure.value.exit_code == 23
        assert failure.value.details["sealed"]
        assert failure.value.details["unsealed"]
        assert set(failure.value.details["sealed"]) | set(failure.value.details["unsealed"]) == {
            ".",
            "canary.txt",
            "nested",
            "nested/payload.bin",
        }
    finally:
        monkeypatch.undo()
        clear_owned_fixture(root, inode, run_id)


@pytest.mark.skipif(sys.platform != "darwin", reason="requires macOS BSD flags")
def test_real_apfs_receipt_atomic_publication_and_self_protection() -> None:
    seal = load_module()
    root, inode, run_id = create_fixture()
    receipt_directory = root / f"receipt-{run_id}"
    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["status"],
        "properties": {"status": {"const": "PASS"}},
    }
    try:
        published = seal.publish_receipt_atomically(
            receipt_directory,
            {"status": "PASS"},
            schema=schema,
        )
        verified = seal.verify_receipt_self_protection(receipt_directory)
        assert Path(published["receipt"]).is_file()
        assert Path(published["checksum"]).is_file()
        assert verified["sealed_objects"] == verified["total_objects"] == 3
        assert len(verified["negative_probes"]) == 8
        assert all(item["denied"] for item in verified["negative_probes"])
    finally:
        clear_owned_fixture(root, inode, run_id)


@pytest.mark.skipif(sys.platform != "darwin", reason="requires macOS BSD flags")
def test_real_stage10_adapter_materializes_seals_and_protects_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = load_stage10_sealer()
    root, inode, run_id = create_fixture()
    source = root / "source"
    source.mkdir(mode=0o700)
    payload = source / "payload.txt"
    payload.write_text("stage10 adapter smoke\n", encoding="utf-8")
    final_parent = root / "published"
    receipt_parent = root / "receipts"
    final_parent.mkdir(mode=0o700)
    receipt_parent.mkdir(mode=0o700)
    final = final_parent / run_id
    receipt = receipt_parent / run_id
    frozen_schema = root / "frozen-schema.json"
    frozen_schema.write_text("{}\n", encoding="utf-8")
    s10_code_sha = "a" * 40
    owner = pwd.getpwuid(os.getuid()).pw_name
    manifest = {
        "schema": "ketos.stage10.evidence-manifest.v1",
        "stage": 10,
        "s10_code_sha": s10_code_sha,
        "owner": owner,
        "retention_policy": "indefinite",
        "canonical_bundle": str(final),
        "seal_control": "apfs-uchg",
        "verdict": "PASS",
        "artifacts": [
            {
                "path": "payload.txt",
                "sha256": hashlib.sha256(payload.read_bytes()).hexdigest(),
                "size_bytes": payload.stat().st_size,
            }
        ],
    }
    manifest_path = source / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    checksum = source / "manifest.sha256"
    checksum.write_text(
        f"{hashlib.sha256(manifest_path.read_bytes()).hexdigest()}  manifest.json\n",
        encoding="ascii",
    )
    monkeypatch.setattr(adapter, "_verify_frozen_worktree", lambda *_args: None)
    try:
        result = adapter.seal_bundle(
            source_bundle=source,
            final_bundle=final,
            receipt_directory=receipt,
            control="apfs-uchg",
            manifest_sha_file=checksum,
            owner=owner,
            retention_policy="indefinite",
            verify_final_no_secrets=True,
            s10_code_sha=s10_code_sha,
            frozen_product_worktree=ROOT,
            frozen_schema=frozen_schema,
        )
        assert result["status"] == "PASS"
        assert result["sealed_objects"] >= 4
        assert len(result["negative_probes"]) == 8
        assert result["receipt_verification"]["sealed_objects"] == 3
        assert len(result["receipt_verification"]["negative_probes"]) == 8
        assert payload.read_text(encoding="utf-8") == "stage10 adapter smoke\n"
    finally:
        clear_owned_fixture(root, inode, run_id)
