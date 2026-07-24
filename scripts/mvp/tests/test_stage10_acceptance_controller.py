from __future__ import annotations

# ruff: noqa: EM101, PT018, S101, TRY003
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[3]
CONTROLLER = ROOT / "scripts/mvp/stage10_acceptance_controller.py"
TESTED_SHA = "1" * 40
TOOLING_SHA = "2" * 40
PUBLICATION_ID = "20260724T140346Z-48988"
PROBES = (
    "create-child",
    "overwrite",
    "truncate",
    "chmod",
    "mtime",
    "rename-file",
    "unlink-file",
    "rename-root",
)


def load_controller(name: str):
    spec = importlib.util.spec_from_file_location(name, CONTROLLER)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, sort_keys=True) + "\n", encoding="utf-8")


def fixture(tmp_path: Path, controller):
    evidence_root = tmp_path / "evidence"
    receipts_root = tmp_path / "receipts"
    bundle = evidence_root / "stage-09" / TESTED_SHA / f"{PUBLICATION_ID}-recursive"
    receipt_dir = receipts_root / "stage-09" / TESTED_SHA / f"{PUBLICATION_ID}-recursive"
    bundle.mkdir(parents=True)
    receipt_dir.mkdir(parents=True)
    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "required": ["code_sha", "scope"],
        "additionalProperties": False,
        "properties": {
            "code_sha": {"const": TESTED_SHA},
            "scope": {
                "type": "object",
                "required": ["pre_post_equal", "worktree_clean", "head_frozen"],
                "additionalProperties": True,
                "properties": {
                    "pre_post_equal": {"const": True},
                    "worktree_clean": {"const": True},
                    "head_frozen": {"const": True},
                },
            },
        },
    }
    schema_bytes = json.dumps(schema, sort_keys=True).encode()
    evidence = {
        "code_sha": TESTED_SHA,
        "scope": {"pre_post_equal": True, "worktree_clean": True, "head_frozen": True},
    }
    repo_after = {"code_sha": TESTED_SHA, "changed_paths": [], "matches_before": True}
    write_json(bundle / "evidence.json", evidence)
    write_json(bundle / "repo-after-full.json", repo_after)
    files = {
        name: {"sha256": sha256(bundle / name), "size": (bundle / name).stat().st_size}
        for name in ("evidence.json", "repo-after-full.json")
    }
    manifest = {
        "schema_version": 1,
        "stage": 9,
        "code_sha": TESTED_SHA,
        "run_id": PUBLICATION_ID,
        "files": files,
    }
    write_json(bundle / "manifest.json", manifest)
    (bundle / "manifest.sha256").write_text(f"{sha256(bundle / 'manifest.json')}  manifest.json\n", encoding="ascii")
    expected = controller.Stage09Expected(
        tested_sha=TESTED_SHA,
        closure_tooling_sha=TOOLING_SHA,
        source_manifest_sha256=sha256(bundle / "manifest.json"),
        frozen_schema_sha256=hashlib.sha256(schema_bytes).hexdigest(),
        byte_inventory_root="3" * 64,
        xattr_inventory_root="4" * 64,
        receipt_sha256="",
        apfs_volume_uuid="A" * 8 + "-BBBB-CCCC-DDDD-" + "E" * 12,
        expected_bundle_objects=5,
    )
    denied = [{"name": name, "denied": True, "errno": 1} for name in PROBES]
    receipt = {
        "schema_version": 1,
        "receipt_kind": "stage-evidence-seal-receipt",
        "stage": 9,
        "status": "PASS",
        "identity": {"tested_code_sha": TESTED_SHA, "closure_tooling_sha": TOOLING_SHA},
        "paths": {
            "final_bundle": str(bundle),
            "source_bundle": str(bundle.parent / PUBLICATION_ID),
            "frozen_schema": str(tmp_path / "frozen-worktree/schema.json"),
            "manifest": "manifest.json",
            "repo_after_full": "repo-after-full.json",
        },
        "digests": {
            "source_manifest_sha256": expected.source_manifest_sha256,
            "frozen_schema_sha256": expected.frozen_schema_sha256,
            "byte_inventory_root_sha256": expected.byte_inventory_root,
            "xattr_inventory_root_sha256": expected.xattr_inventory_root,
        },
        "filesystem": {"type": "apfs", "volume_uuid": expected.apfs_volume_uuid},
        "inventory": {
            "total_objects": 5,
            "manifest_payload_files": 2,
            "source_destination_same_inode_count": 0,
            "hardlink_count": 0,
            "type_counts": {"directory": 1, "regular": 4, "symlink": 0, "special": 0},
        },
        "seal": {
            "recursive_verification_passed": True,
            "immutable_flag_objects": 5,
            "read_only_mode_objects": 5,
            "byte_inventory_equal_after_probes": True,
        },
        "negative_probes": denied,
        "receipt_policy": {"self_protection_required": True},
    }
    write_json(receipt_dir / "receipt.json", receipt)
    receipt_digest = sha256(receipt_dir / "receipt.json")
    (receipt_dir / "receipt.sha256").write_text(receipt_digest + "\n", encoding="ascii")
    expected = controller.Stage09Expected(**{**expected.__dict__, "receipt_sha256": receipt_digest})

    class Seal:
        @staticmethod
        def build_byte_inventory(_root):
            return {
                "root_sha256": expected.byte_inventory_root,
                "xattr_root_sha256": expected.xattr_inventory_root,
                "entries": [{}, {}, {}, {}, {}],
            }

        @staticmethod
        def verify_recursive_seal(_root, **_kwargs):
            return {
                "total_objects": 5,
                "sealed_objects": 5,
                "byte_root_sha256": expected.byte_inventory_root,
                "xattr_root_sha256": expected.xattr_inventory_root,
            }

        @staticmethod
        def run_negative_mutation_probes(_root, **_kwargs):
            return denied

        @staticmethod
        def verify_receipt_self_protection(_root, **_kwargs):
            return {
                "total_objects": 3,
                "sealed_objects": 3,
                "receipt_sha256": sha256(_root / "receipt.json"),
                "negative_probes": denied,
            }

    return SimpleNamespace(
        evidence_root=evidence_root,
        receipts_root=receipts_root,
        bundle=bundle,
        receipt_dir=receipt_dir,
        expected=expected,
        schema_bytes=schema_bytes,
        seal=Seal,
    )


def verify(controller, fx, **overrides):
    options = {
        "repo_root": ROOT,
        "publication_id": PUBLICATION_ID,
        "evidence_root": fx.evidence_root,
        "receipts_root": fx.receipts_root,
        "expected": fx.expected,
        "schema_loader": lambda *_args: fx.schema_bytes,
        "seal_api": fx.seal,
    }
    options.update(overrides)
    return controller.verify_stage09_prerequisite(**options)


def test_valid_new_stage09_bundle_and_receipt_pass(tmp_path: Path) -> None:
    controller = load_controller("stage10_controller_valid")
    fx = fixture(tmp_path, controller)

    result = verify(controller, fx)

    assert result.status == "PASS"
    assert result.error_code is None
    assert result.checks_completed[-1] == "post_probe_unchanged"


def test_original_unsealed_bundle_is_rejected(tmp_path: Path) -> None:
    controller = load_controller("stage10_controller_old")
    fx = fixture(tmp_path, controller)

    result = verify(controller, fx, publication_id="20260722T191808Z-55170")

    assert result.status == "FAIL"
    assert result.error_code == "E_CANONICAL_PATH"


def test_missing_receipt_is_rejected(tmp_path: Path) -> None:
    controller = load_controller("stage10_controller_missing_receipt")
    fx = fixture(tmp_path, controller)
    fx.receipt_dir.rename(fx.receipt_dir.with_name("removed"))

    result = verify(controller, fx)

    assert result.status == "FAIL"
    assert result.error_code == "E_CANONICAL_PATH"


def test_receipt_checksum_mismatch_is_rejected(tmp_path: Path) -> None:
    controller = load_controller("stage10_controller_receipt_hash")
    fx = fixture(tmp_path, controller)
    (fx.receipt_dir / "receipt.sha256").write_text("0" * 64 + "\n", encoding="ascii")

    result = verify(controller, fx)

    assert result.status == "FAIL"
    assert result.error_code == "E_RECEIPT_CHECKSUM"


def test_one_unsealed_descendant_is_rejected(tmp_path: Path) -> None:
    controller = load_controller("stage10_controller_unsealed")
    fx = fixture(tmp_path, controller)

    class Unsealed(fx.seal):
        @staticmethod
        def verify_recursive_seal(_root, **_kwargs):
            raise RuntimeError("one descendant is unsealed")

    result = verify(controller, fx, seal_api=Unsealed)

    assert result.status == "FAIL"
    assert result.error_code == "E_BUNDLE_SEAL"


def test_root_main_schema_fallback_is_rejected(tmp_path: Path) -> None:
    controller = load_controller("stage10_controller_schema")
    fx = fixture(tmp_path, controller)

    def missing_exact_blob(*_args):
        raise RuntimeError("exact commit object unavailable")

    result = verify(controller, fx, schema_loader=missing_exact_blob)

    assert result.status == "FAIL"
    assert result.error_code == "E_FROZEN_SCHEMA"


def test_nonempty_structured_diff_is_rejected(tmp_path: Path) -> None:
    controller = load_controller("stage10_controller_diff")
    fx = fixture(tmp_path, controller)
    write_json(
        fx.bundle / "repo-after-full.json",
        {"code_sha": TESTED_SHA, "changed_paths": ["src/changed.py"], "matches_before": False},
    )
    manifest = json.loads((fx.bundle / "manifest.json").read_text(encoding="utf-8"))
    path = fx.bundle / "repo-after-full.json"
    manifest["files"]["repo-after-full.json"] = {"sha256": sha256(path), "size": path.stat().st_size}
    write_json(fx.bundle / "manifest.json", manifest)
    (fx.bundle / "manifest.sha256").write_text(
        f"{sha256(fx.bundle / 'manifest.json')}  manifest.json\n",
        encoding="ascii",
    )
    fx.expected = controller.Stage09Expected(
        **{**fx.expected.__dict__, "source_manifest_sha256": sha256(fx.bundle / "manifest.json")}
    )
    receipt = json.loads((fx.receipt_dir / "receipt.json").read_text(encoding="utf-8"))
    receipt["digests"]["source_manifest_sha256"] = fx.expected.source_manifest_sha256
    write_json(fx.receipt_dir / "receipt.json", receipt)
    digest = sha256(fx.receipt_dir / "receipt.json")
    (fx.receipt_dir / "receipt.sha256").write_text(digest + "\n", encoding="ascii")
    fx.expected = controller.Stage09Expected(**{**fx.expected.__dict__, "receipt_sha256": digest})

    result = verify(controller, fx)

    assert result.status == "FAIL"
    assert result.error_code == "E_ZERO_WRITE"
