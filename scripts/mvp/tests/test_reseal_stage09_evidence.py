from __future__ import annotations

# ruff: noqa: PLR2004, S101, S603, S607, SLF001 - fixed evidence contract fixtures.
import hashlib
import importlib.util
import json
import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[3]
MODULE = ROOT / "scripts/mvp/reseal_stage09_evidence.py"
FINALIZER = ROOT / "scripts/mvp/finalize_stage09_evidence.py"
GENERIC_SCHEMA = ROOT / "docs/dev/handoff/schemas/stage-evidence-seal-receipt.schema.json"
STAGE09_SCHEMA = ROOT / "docs/dev/handoff/schemas/stage-09-seal-receipt.schema.json"
TESTED_SHA = "18a2a2a9518d23c589c6700c322ad5844adce932"
TOOLING_SHA = "b" * 40


def load_module():
    spec = importlib.util.spec_from_file_location("reseal_stage09_evidence", MODULE)
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_finalizer():
    spec = importlib.util.spec_from_file_location("finalize_stage09_evidence_contract", FINALIZER)
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def reseal():
    return load_module()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def create_source(tmp_path: Path) -> dict[str, Path | str]:
    product = tmp_path / "product"
    schema = product / "docs/dev/handoff/schemas/stage-09-evidence.schema.json"
    schema.parent.mkdir(parents=True)
    schema_payload = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": False,
        "required": ["code_sha", "scope"],
        "properties": {
            "code_sha": {"const": TESTED_SHA},
            "scope": {
                "type": "object",
                "additionalProperties": False,
                "required": ["head_frozen", "worktree_clean", "pre_post_equal"],
                "properties": {
                    "head_frozen": {"const": True},
                    "worktree_clean": {"const": True},
                    "pre_post_equal": {"const": True},
                },
            },
        },
    }
    schema.write_text(json.dumps(schema_payload), encoding="utf-8")

    source = tmp_path / "source"
    source.mkdir()
    (source / "evidence.json").write_text(
        json.dumps(
            {
                "code_sha": TESTED_SHA,
                "scope": {
                    "head_frozen": True,
                    "worktree_clean": True,
                    "pre_post_equal": True,
                },
            }
        ),
        encoding="utf-8",
    )
    (source / "repo-after-full.json").write_text(
        json.dumps(
            {
                "code_sha": TESTED_SHA,
                "changed_paths": [],
                "matches_before": True,
            }
        ),
        encoding="utf-8",
    )
    (source / "report.md").write_text("этап выполнен\n", encoding="utf-8")
    files = {}
    for path in sorted(source.iterdir()):
        files[path.name] = {"sha256": sha256(path), "size": path.stat().st_size}
    manifest = {
        "schema_version": 1,
        "stage": 9,
        "code_sha": TESTED_SHA,
        "run_id": "20260724T000000Z-1",
        "files": files,
    }
    manifest_path = source / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")
    (source / "manifest.sha256").write_text(
        f"{sha256(manifest_path)}  manifest.json\n",
        encoding="ascii",
    )
    return {
        "product": product,
        "schema": schema,
        "schema_sha": sha256(schema),
        "source": source,
    }


def validate(reseal, fixture: dict[str, Path | str]):
    return reseal.validate_stage09_source(
        source_bundle=fixture["source"],
        frozen_product_worktree=fixture["product"],
        frozen_schema_path=fixture["schema"],
        expected_schema_sha256=fixture["schema_sha"],
        tested_code_sha=TESTED_SHA,
        verify_git=False,
    )


def test_receipt_schemas_are_valid_draft_2020_12() -> None:
    Draft202012Validator.check_schema(json.loads(GENERIC_SCHEMA.read_text()))
    Draft202012Validator.check_schema(json.loads(STAGE09_SCHEMA.read_text()))


def test_valid_frozen_schema_and_structured_zero_write_pass(reseal, tmp_path: Path) -> None:
    fixture = create_source(tmp_path)
    result = validate(reseal, fixture)
    assert result["tested_code_sha"] == TESTED_SHA
    assert result["repo_after_full"]["changed_paths"] == []
    assert result["manifest_payload_files"] == 3


def test_root_main_schema_fallback_is_never_used(reseal, tmp_path: Path) -> None:
    fixture = create_source(tmp_path)
    missing = Path(fixture["schema"]).with_name("missing.json")
    decoy = ROOT / "docs/dev/handoff/schemas/stage-09-evidence.schema.json"
    assert decoy.exists()
    with pytest.raises(reseal.SealError, match="frozen schema") as failure:
        reseal.validate_stage09_source(
            source_bundle=fixture["source"],
            frozen_product_worktree=fixture["product"],
            frozen_schema_path=missing,
            expected_schema_sha256=fixture["schema_sha"],
            tested_code_sha=TESTED_SHA,
            verify_git=False,
        )
    assert failure.value.exit_code == 22


def test_existing_paths_must_be_canonical_and_not_symlinked(reseal, tmp_path: Path) -> None:
    fixture = create_source(tmp_path)
    source_alias = tmp_path / "source-alias"
    source_alias.symlink_to(fixture["source"], target_is_directory=True)
    with pytest.raises(reseal.SealError, match=r"symlink|canonical") as failure:
        reseal.validate_stage09_source(
            source_bundle=source_alias,
            frozen_product_worktree=fixture["product"],
            frozen_schema_path=fixture["schema"],
            expected_schema_sha256=fixture["schema_sha"],
            tested_code_sha=TESTED_SHA,
            verify_git=False,
        )
    assert failure.value.exit_code == 20

    noncanonical_product = Path(fixture["product"]) / ".." / Path(fixture["product"]).name
    with pytest.raises(reseal.SealError, match="canonical") as failure:
        reseal.validate_stage09_source(
            source_bundle=fixture["source"],
            frozen_product_worktree=noncanonical_product,
            frozen_schema_path=fixture["schema"],
            expected_schema_sha256=fixture["schema_sha"],
            tested_code_sha=TESTED_SHA,
            verify_git=False,
        )
    assert failure.value.exit_code == 20


def test_new_path_rejects_symlinked_parent_and_existing_target(reseal, tmp_path: Path) -> None:
    real_parent = tmp_path / "real"
    real_parent.mkdir()
    alias_parent = tmp_path / "alias"
    alias_parent.symlink_to(real_parent, target_is_directory=True)
    with pytest.raises(reseal.SealError, match=r"symlink|canonical"):
        reseal._canonical_new_path(alias_parent / "final", label="final")

    existing = real_parent / "existing"
    existing.mkdir()
    with pytest.raises(reseal.SealError, match="already exists"):
        reseal._canonical_new_path(existing, label="final")


def test_tooling_identity_requires_exact_clean_git_checkout(reseal, tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.email", "test@example.invalid"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", "Test"], check=True)
    (repo / "tracked.txt").write_text("tracked\n", encoding="utf-8")
    subprocess.run(["git", "-C", str(repo), "add", "tracked.txt"], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "fixture"], check=True)
    sha = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    reseal._verify_tooling_identity(repo, sha)
    (repo / "untracked.txt").write_text("dirty\n", encoding="utf-8")
    with pytest.raises(reseal.SealError, match="dirty") as failure:
        reseal._verify_tooling_identity(repo, sha)
    assert failure.value.exit_code == 21


def test_final_root_seal_requires_published_staging_identity(reseal, tmp_path: Path) -> None:
    root = tmp_path / "root"
    root.mkdir()
    info = root.stat()
    with pytest.raises(reseal.SealError, match="staging root") as failure:
        reseal._seal_root_last(root, (info.st_dev, info.st_ino + 1))
    assert failure.value.exit_code == 23


@pytest.mark.parametrize(
    ("mutation", "message", "exit_code"),
    [
        ("changed_paths", "changed_paths", 21),
        ("matches_before", "matches_before", 21),
        ("scope", "scope", 21),
        ("manifest_omission", "repo-after-full", 22),
    ],
)
def test_zero_write_and_manifest_fail_closed(
    reseal,
    tmp_path: Path,
    mutation: str,
    message: str,
    exit_code: int,
) -> None:
    fixture = create_source(tmp_path)
    source = Path(fixture["source"])
    if mutation in {"changed_paths", "matches_before"}:
        payload = json.loads((source / "repo-after-full.json").read_text())
        payload[mutation] = ["changed.py"] if mutation == "changed_paths" else False
        (source / "repo-after-full.json").write_text(json.dumps(payload), encoding="utf-8")
    elif mutation == "scope":
        payload = json.loads((source / "evidence.json").read_text())
        payload["scope"]["pre_post_equal"] = False
        (source / "evidence.json").write_text(json.dumps(payload), encoding="utf-8")
    else:
        manifest = json.loads((source / "manifest.json").read_text())
        del manifest["files"]["repo-after-full.json"]
        (source / "manifest.json").write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")
        (source / "manifest.sha256").write_text(
            f"{sha256(source / 'manifest.json')}  manifest.json\n",
            encoding="ascii",
        )
    if mutation != "manifest_omission":
        manifest = json.loads((source / "manifest.json").read_text())
        changed_name = "evidence.json" if mutation == "scope" else "repo-after-full.json"
        manifest["files"][changed_name] = {
            "sha256": sha256(source / changed_name),
            "size": (source / changed_name).stat().st_size,
        }
        (source / "manifest.json").write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")
        (source / "manifest.sha256").write_text(
            f"{sha256(source / 'manifest.json')}  manifest.json\n",
            encoding="ascii",
        )
    with pytest.raises(reseal.SealError, match=message) as failure:
        validate(reseal, fixture)
    assert failure.value.exit_code == exit_code


@pytest.mark.parametrize("mutation", ["bytes", "mode", "flags", "mtime"])
def test_source_snapshot_detects_byte_mode_flag_and_mtime_changes(
    reseal,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    mutation: str,
) -> None:
    fixture = create_source(tmp_path)
    source = Path(fixture["source"])
    before = reseal.snapshot_source(source)
    target = source / "report.md"
    if mutation == "bytes":
        target.write_text("changed\n", encoding="utf-8")
    elif mutation == "mode":
        target.chmod(0o400)
    elif mutation == "mtime":
        info = target.stat()
        os.utime(target, ns=(info.st_atime_ns, info.st_mtime_ns + 1))
    else:
        real_lstat = reseal.os.lstat

        def flags(path):
            result = real_lstat(path)
            fake = type("FakeStat", (), {})()
            for name in dir(result):
                if name.startswith("st_"):
                    setattr(fake, name, getattr(result, name))
            fake.st_flags = stat.UF_IMMUTABLE if Path(path) == target else 0
            return fake

        monkeypatch.setattr(reseal.os, "lstat", flags)
    after = reseal.snapshot_source(source)
    with pytest.raises(reseal.SealError, match="source changed") as failure:
        reseal.assert_source_unchanged(before, after)
    assert failure.value.exit_code == 26


def test_materialization_is_exclusive_and_inode_distinct(reseal, tmp_path: Path) -> None:
    fixture = create_source(tmp_path)
    source = Path(fixture["source"])
    destination = tmp_path / "destination"
    result = reseal.materialize_distinct_copy(source, destination)
    assert result["same_inode_count"] == 0
    assert reseal.compare_byte_inventories(source, destination)["equal"] is True
    with pytest.raises(reseal.SealError, match="exists"):
        reseal.materialize_distinct_copy(source, destination)

    aliased = tmp_path / "aliased"
    aliased.mkdir()
    for path in source.iterdir():
        os.link(path, aliased / path.name)
    with pytest.raises(reseal.SealError, match=r"same inode|hardlink"):
        reseal.verify_distinct_inodes(source, aliased)


def test_receipt_cannot_be_built_before_all_bundle_probes_pass(reseal, tmp_path: Path) -> None:
    fixture = create_source(tmp_path)
    validation = validate(reseal, fixture)
    with pytest.raises(reseal.SealError, match="preconditions") as failure:
        reseal.build_stage09_receipt(
            validation=validation,
            closure_tooling_sha=TOOLING_SHA,
            final_bundle=tmp_path / "final",
            seal_verification={"sealed_objects": 5, "total_objects": 5},
            negative_probes=[],
            source_unchanged=True,
            started_at_utc="2026-07-24T00:00:00Z",
            completed_at_utc="2026-07-24T00:00:01Z",
            started_monotonic_ns=1,
            completed_monotonic_ns=2,
        )
    assert failure.value.exit_code == 24


def test_product_and_tooling_sha_are_separate_required_identities(reseal, tmp_path: Path) -> None:
    fixture = create_source(tmp_path)
    validation = validate(reseal, fixture)
    probes = [
        {"name": name, "denied": True, "errno": 1}
        for name in (
            "create-child",
            "overwrite",
            "truncate",
            "chmod",
            "mtime",
            "rename-file",
            "unlink-file",
            "rename-root",
        )
    ]
    with pytest.raises(reseal.SealError, match="tooling SHA"):
        reseal.build_stage09_receipt(
            validation=validation,
            closure_tooling_sha=TESTED_SHA,
            final_bundle=tmp_path / "final",
            seal_verification={"sealed_objects": 5, "total_objects": 5},
            negative_probes=probes,
            source_unchanged=True,
            started_at_utc="2026-07-24T00:00:00Z",
            completed_at_utc="2026-07-24T00:00:01Z",
            started_monotonic_ns=1,
            completed_monotonic_ns=2,
        )


def test_manifest_only_finalizer_is_explicitly_nonfinal(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    fixture = create_source(tmp_path)
    finalizer = load_finalizer()
    assert finalizer.main(["verify", "--bundle", str(fixture["source"])]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["status"] == "payload-valid-nonfinal"
    assert payload["transition"] == "no-go"
    assert "terminal" not in payload


def test_combined_finalizer_binds_receipt_to_manifest_bytes_and_xattrs(
    reseal,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture = create_source(tmp_path)
    validation = validate(reseal, fixture)
    probes = [
        {"name": name, "denied": True, "errno": 1}
        for name in (
            "create-child",
            "overwrite",
            "truncate",
            "chmod",
            "mtime",
            "rename-file",
            "unlink-file",
            "rename-root",
        )
    ]
    source = Path(fixture["source"]).resolve(strict=True)
    receipt = reseal.build_stage09_receipt(
        validation=validation,
        closure_tooling_sha=TOOLING_SHA,
        final_bundle=source,
        seal_verification={"sealed_objects": 6, "total_objects": 6},
        negative_probes=probes,
        source_unchanged=True,
        started_at_utc="2026-07-24T00:00:00Z",
        completed_at_utc="2026-07-24T00:00:01Z",
        started_monotonic_ns=1,
        completed_monotonic_ns=2,
    )
    receipt["digests"]["frozen_schema_sha256"] = reseal.FROZEN_SCHEMA_SHA256
    receipt_dir = tmp_path / "receipt"
    receipt_dir.mkdir()
    (receipt_dir / "receipt.json").write_text(json.dumps(receipt), encoding="utf-8")

    calls: dict[str, object] = {}

    class FakeSealError(RuntimeError):
        pass

    class FakeSealer:
        SealError = FakeSealError

        @staticmethod
        def verify_recursive_seal(bundle, *, expected_bytes):
            calls["recursive"] = (bundle, expected_bytes)
            return {"status": "pass"}

        @staticmethod
        def run_negative_mutation_probes(bundle, *, baseline):
            calls["probes"] = (bundle, baseline)
            return probes

        @staticmethod
        def verify_receipt_self_protection(directory):
            calls["receipt"] = directory
            return {"status": "pass"}

    finalizer = load_finalizer()
    monkeypatch.setattr(finalizer, "_load_sealer", lambda: FakeSealer)
    result = finalizer._verify_final_seal(source, receipt_dir)
    expected = {
        "root_sha256": receipt["digests"]["byte_inventory_root_sha256"],
        "xattr_root_sha256": receipt["digests"]["xattr_inventory_root_sha256"],
    }
    assert calls["recursive"] == (source, expected)
    assert calls["probes"] == (source, expected)
    assert result["terminal"] == "STAGE09_FINALIZATION=PASS"

    receipt["digests"]["source_manifest_sha256"] = "0" * 64
    (receipt_dir / "receipt.json").write_text(json.dumps(receipt), encoding="utf-8")
    with pytest.raises(finalizer.EvidenceError, match="manifest digest"):
        finalizer._verify_final_seal(source, receipt_dir)
