#!/usr/bin/env python3
# ruff: noqa: EM101, EM102, PLR2004, S607, SLF001, TC003, TRY003, TRY004
"""Publish and recursively seal one validated Stage 10 evidence bundle."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import uuid
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import reseal_stage09_evidence as materialize
import stage_evidence_seal as seal
from validate_evidence_bundle import _inventory, _load_json, _scan_secrets, _sha256

CLOSURE_TOOLING_SHA = "638f2b2d35e353fe0ad9f39ee800315ebe6d1338"
RECEIPT_SCHEMA = (
    Path(__file__).resolve().parents[2] / "docs/dev/handoff/schemas/stage-evidence-seal-receipt.schema.json"
)
PROBE_NAMES = {
    "create-child",
    "overwrite",
    "truncate",
    "chmod",
    "mtime",
    "rename-file",
    "unlink-file",
    "rename-root",
}


def _read_detached_checksum(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        raise ValueError("manifest checksum must be a regular file")
    value = path.read_text(encoding="ascii").strip()
    match = re.fullmatch(r"([0-9a-f]{64})[ \t]+(?:\*|)manifest\.json", value)
    if not match:
        raise ValueError("manifest checksum file has an invalid format")
    return match.group(1)


def _verify_manifest_inventory(bundle: Path, manifest: Mapping[str, Any]) -> None:
    expected = manifest.get("artifacts")
    if not isinstance(expected, list):
        raise ValueError("manifest artifacts are missing")
    rows = {row.get("path"): row for row in expected if isinstance(row, dict)}
    actual = {
        path.relative_to(bundle).as_posix(): path
        for path in _inventory(bundle)
        if path.name not in {"manifest.json", "manifest.sha256"}
    }
    if set(rows) != set(actual):
        raise ValueError("manifest inventory differs from source bundle")
    for relative, path in actual.items():
        row = rows[relative]
        if row.get("sha256") != _sha256(path) or row.get("size_bytes") != path.stat().st_size:
            raise ValueError(f"manifest hash/size mismatch: {relative}")


def _absolute_new_path(path: Path, *, label: str) -> Path:
    if not path.is_absolute() or path.is_symlink():
        raise ValueError(f"{label} must be an absolute non-symlink path")
    absolute = path.absolute()
    seal._assert_no_symlink_components(absolute)
    if os.path.lexists(absolute):
        raise FileExistsError(f"{label} already exists: {absolute}")
    if not absolute.parent.is_dir():
        raise ValueError(f"{label} parent does not exist: {absolute.parent}")
    return absolute


def _is_within(path: Path, parent: Path) -> bool:
    return path == parent or parent in path.parents


def _verify_frozen_worktree(path: Path, expected_sha: str) -> None:
    if not path.is_absolute() or not path.is_dir() or path.is_symlink():
        raise ValueError("frozen product worktree must be an absolute real directory")
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=path,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    dirty = subprocess.run(
        ["git", "status", "--porcelain=v1"],
        cwd=path,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    if head != expected_sha or dirty:
        raise ValueError("frozen product worktree SHA/cleanliness mismatch")


def preflight(
    *,
    bundle: Path,
    control: str,
    manifest_sha_file: Path,
    external_receipt: Path,
    require_apfs: bool = True,
) -> dict[str, Any]:
    """Compatibility preflight used by tests and the full publication state machine."""
    if control != "apfs-uchg":
        raise ValueError("control must be exactly apfs-uchg")
    if not bundle.is_absolute() or bundle.is_symlink():
        raise ValueError("bundle must be an absolute real directory")
    bundle = bundle.resolve(strict=True)
    if not bundle.is_dir():
        raise ValueError("bundle is not a directory")
    if os.path.lexists(external_receipt):
        raise FileExistsError("seal receipt already exists")
    if manifest_sha_file.resolve(strict=True).parent != bundle:
        raise ValueError("manifest checksum must be inside the bundle")
    manifest_path = bundle / "manifest.json"
    expected = _read_detached_checksum(manifest_sha_file)
    actual = _sha256(manifest_path)
    if expected != actual:
        raise ValueError("manifest checksum mismatch")
    manifest = _load_json(manifest_path)
    if not isinstance(manifest, dict) or manifest.get("verdict") != "PASS":
        raise ValueError("manifest is not a PASS record")
    _verify_manifest_inventory(bundle, manifest)
    if require_apfs:
        storage = seal.preflight_apfs_root(bundle)
    else:
        details = os.lstat(bundle)
        storage = {
            "canonical_root": str(bundle),
            "volume_uuid": f"TEST-{details.st_dev}",
            "device": details.st_dev,
            "inode": details.st_ino,
            "uid": details.st_uid,
        }
    return {
        "bundle": bundle,
        "manifest": manifest,
        "manifest_sha256": actual,
        **storage,
    }


def _source_unchanged(before: Mapping[str, Any], source: Path) -> bool:
    after = seal.build_byte_inventory(source)
    return before.get("root_sha256") == after.get("root_sha256") and before.get("xattr_root_sha256") == after.get(
        "xattr_root_sha256"
    )


def _assert_inventory_equal(
    expected: Mapping[str, Any],
    actual: Mapping[str, Any],
    *,
    label: str,
) -> None:
    if expected.get("root_sha256") != actual.get("root_sha256") or expected.get("xattr_root_sha256") != actual.get(
        "xattr_root_sha256"
    ):
        raise ValueError(f"{label} differs from the manifest-validated source inventory")


def _directory_identity(path: Path) -> tuple[int, int, str]:
    seal._assert_no_symlink_components(path)
    details = os.lstat(path)
    if not path.is_dir() or path.is_symlink():
        raise ValueError(f"publication parent must be a real directory: {path}")
    return details.st_dev, details.st_ino, str(path.resolve(strict=True))


def _verify_directory_identity(path: Path, expected: tuple[int, int, str]) -> None:
    if _directory_identity(path) != expected:
        raise ValueError(f"publication parent identity changed: {path}")


def _build_receipt(
    *,
    source: Path,
    final: Path,
    frozen_product_worktree: Path,
    frozen_schema: Path,
    s10_code_sha: str,
    manifest_sha256: str,
    baseline: Mapping[str, Any],
    verification: Mapping[str, Any],
    probes: Sequence[Mapping[str, Any]],
    modes: Mapping[str, Any],
    started_at_utc: str,
    started_monotonic_ns: int,
) -> dict[str, Any]:
    records = seal.inventory_tree_no_links(final)
    type_counts = {
        "regular": sum(item.object_type == "regular" for item in records),
        "directory": sum(item.object_type == "directory" for item in records),
        "symlink": 0,
        "special": 0,
    }
    completed_at_utc = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    completed_monotonic_ns = time.monotonic_ns()
    if (
        verification.get("sealed_objects") != verification.get("total_objects")
        or modes.get("mode_objects") != verification.get("total_objects")
        or len(probes) != 8
        or {item.get("name") for item in probes} != PROBE_NAMES
        or not all(item.get("denied") is True for item in probes)
    ):
        raise seal.SealError(
            "Stage 10 receipt PASS preconditions are incomplete",
            exit_code=seal.EXIT_RECEIPT_PROTECTION,
        )
    manifest = _load_json(source / "manifest.json")
    return {
        "schema_version": 1,
        "receipt_kind": "stage-evidence-seal-receipt",
        "stage": 10,
        "status": "PASS",
        "identity": {
            "tested_code_sha": s10_code_sha,
            "closure_tooling_sha": CLOSURE_TOOLING_SHA,
        },
        "paths": {
            "source_bundle": str(source),
            "final_bundle": str(final),
            "frozen_product_worktree": str(frozen_product_worktree),
            "frozen_schema": str(frozen_schema),
            "manifest": "manifest.json",
            "repo_after_full": "repo-after-full.json",
        },
        "digests": {
            "source_manifest_sha256": manifest_sha256,
            "frozen_schema_sha256": _sha256(frozen_schema),
            "byte_inventory_root_sha256": baseline["root_sha256"],
            "xattr_inventory_root_sha256": baseline["xattr_root_sha256"],
        },
        "filesystem": {
            "type": "apfs",
            "volume_uuid": seal.EXPECTED_APFS_UUID,
            "device": int(os.lstat(final).st_dev),
        },
        "inventory": {
            "total_objects": len(records),
            "manifest_payload_files": len(manifest["artifacts"]),
            "type_counts": type_counts,
            "source_destination_same_inode_count": 0,
            "hardlink_count": 0,
        },
        "seal": {
            "read_only_mode_objects": int(modes["mode_objects"]),
            "immutable_flag_objects": int(verification["sealed_objects"]),
            "recursive_verification_passed": True,
            "byte_inventory_equal_after_probes": True,
        },
        "negative_probes": [dict(item) for item in probes],
        "creation": {
            "started_at_utc": started_at_utc,
            "completed_at_utc": completed_at_utc,
            "started_monotonic_ns": started_monotonic_ns,
            "completed_monotonic_ns": completed_monotonic_ns,
        },
        "receipt_policy": {
            "publication": "atomic-no-replace-directory",
            "mode": "0400",
            "immutable_flag": "uchg",
            "checksum_algorithm": "sha256",
            "self_protection_required": True,
        },
    }


def seal_bundle(
    *,
    source_bundle: Path,
    final_bundle: Path,
    receipt_directory: Path,
    control: str,
    manifest_sha_file: Path,
    owner: str,
    retention_policy: str,
    verify_final_no_secrets: bool,
    s10_code_sha: str,
    frozen_product_worktree: Path,
    frozen_schema: Path,
    receipt_schema: Path = RECEIPT_SCHEMA,
) -> dict[str, Any]:
    """Materialize, publish, recursively seal, probe and receipt Stage 10 evidence."""
    started_at_utc = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    started_monotonic_ns = time.monotonic_ns()
    if re.fullmatch(r"[0-9a-f]{40}", s10_code_sha) is None:
        raise ValueError("s10_code_sha must be a lowercase 40-character SHA")
    if not owner or not retention_policy:
        raise ValueError("owner and retention policy are required")
    state = preflight(
        bundle=source_bundle,
        control=control,
        manifest_sha_file=manifest_sha_file,
        external_receipt=receipt_directory,
    )
    source = Path(state["bundle"])
    manifest = state["manifest"]
    final = _absolute_new_path(final_bundle, label="final bundle")
    receipt_dir = _absolute_new_path(receipt_directory, label="receipt directory")
    frozen_schema = frozen_schema.resolve(strict=True)
    frozen_product_worktree = frozen_product_worktree.resolve(strict=True)
    receipt_schema = receipt_schema.resolve(strict=True)
    if (
        _is_within(final, source)
        or _is_within(receipt_dir, source)
        or _is_within(receipt_dir, final)
        or _is_within(final, receipt_dir)
    ):
        raise ValueError("source, final bundle and receipt directory must be disjoint")
    if (
        manifest.get("s10_code_sha") != s10_code_sha
        or manifest.get("owner") != owner
        or manifest.get("retention_policy") != retention_policy
        or manifest.get("canonical_bundle") != str(final)
        or manifest.get("seal_control") != "apfs-uchg"
    ):
        raise ValueError("manifest identity/publication contract mismatch")
    _verify_frozen_worktree(frozen_product_worktree, s10_code_sha)
    seal.preflight_apfs_root(final.parent)
    seal.preflight_apfs_root(receipt_dir.parent)
    final_parent_identity = _directory_identity(final.parent)
    receipt_parent_identity = _directory_identity(receipt_dir.parent)
    source_before = seal.build_byte_inventory(source)
    if verify_final_no_secrets and _scan_secrets(_inventory(source)):
        raise ValueError("source no-secret verification failed")

    staging = final.parent / f".{final.name}.staging-{uuid.uuid4().hex}"
    materialize.materialize_distinct_copy(source, staging)
    if not _source_unchanged(source_before, source):
        raise seal.SealError("source changed during materialization", exit_code=seal.EXIT_SOURCE_CHANGED)
    baseline = seal.build_byte_inventory(staging)
    _assert_inventory_equal(source_before, baseline, label="staging")
    if verify_final_no_secrets and _scan_secrets(_inventory(staging)):
        raise ValueError("staging no-secret verification failed")
    modes = seal.apply_read_only_modes(staging)
    flags = seal.apply_immutable_flags_bottom_up(staging, include_root=False)
    if flags["sealed_objects"] != len(baseline["entries"]) - 1:
        raise seal.SealError("descendant seal count mismatch", exit_code=seal.EXIT_PARTIAL_SEAL)
    staging_info = os.lstat(staging)
    staging_identity = (staging_info.st_dev, staging_info.st_ino)
    _verify_frozen_worktree(frozen_product_worktree, s10_code_sha)
    _verify_directory_identity(final.parent, final_parent_identity)
    seal.atomic_publish_directory(staging, final)
    materialize._seal_root_last(final, staging_identity)
    verification = seal.verify_recursive_seal(final, expected_bytes=baseline)
    probes = seal.run_negative_mutation_probes(final, baseline=baseline)
    if verify_final_no_secrets and _scan_secrets(_inventory(final)):
        raise ValueError("final no-secret verification failed")
    if not _source_unchanged(source_before, source):
        raise seal.SealError("source changed during sealing", exit_code=seal.EXIT_SOURCE_CHANGED)
    _verify_frozen_worktree(frozen_product_worktree, s10_code_sha)
    _verify_directory_identity(receipt_dir.parent, receipt_parent_identity)
    receipt = _build_receipt(
        source=source,
        final=final,
        frozen_product_worktree=frozen_product_worktree,
        frozen_schema=frozen_schema,
        s10_code_sha=s10_code_sha,
        manifest_sha256=state["manifest_sha256"],
        baseline=baseline,
        verification=verification,
        probes=probes,
        modes=modes,
        started_at_utc=started_at_utc,
        started_monotonic_ns=started_monotonic_ns,
    )
    schema = _load_json(receipt_schema)
    published = seal.publish_receipt_atomically(receipt_dir, receipt, schema=schema)
    receipt_verification = seal.verify_receipt_self_protection(receipt_dir)
    _verify_frozen_worktree(frozen_product_worktree, s10_code_sha)
    if not _source_unchanged(source_before, source):
        raise seal.SealError("source changed during receipt publication", exit_code=seal.EXIT_SOURCE_CHANGED)
    return {
        "status": "PASS",
        "tested_code_sha": s10_code_sha,
        "closure_tooling_sha": CLOSURE_TOOLING_SHA,
        "final_bundle": str(final),
        "receipt": published,
        "receipt_verification": receipt_verification,
        "mode_objects": modes["mode_objects"],
        "sealed_objects": verification["sealed_objects"],
        "negative_probes": probes,
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-bundle", "--bundle", dest="source_bundle", type=Path, required=True)
    parser.add_argument("--final-bundle", type=Path, required=True)
    parser.add_argument("--receipt-directory", "--external-receipt", dest="receipt_directory", type=Path, required=True)
    parser.add_argument("--control", required=True)
    parser.add_argument("--manifest-sha-file", type=Path, required=True)
    parser.add_argument("--owner", required=True)
    parser.add_argument("--retention-policy", required=True)
    parser.add_argument("--verify-final-no-secrets", action="store_true")
    parser.add_argument("--s10-code-sha", required=True)
    parser.add_argument("--frozen-product-worktree", type=Path, required=True)
    parser.add_argument("--frozen-schema", type=Path, required=True)
    parser.add_argument("--receipt-schema", type=Path, default=RECEIPT_SCHEMA)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    try:
        args = _parser().parse_args(argv)
        result = seal_bundle(
            source_bundle=args.source_bundle,
            final_bundle=args.final_bundle,
            receipt_directory=args.receipt_directory,
            control=args.control,
            manifest_sha_file=args.manifest_sha_file,
            owner=args.owner,
            retention_policy=args.retention_policy,
            verify_final_no_secrets=args.verify_final_no_secrets,
            s10_code_sha=args.s10_code_sha,
            frozen_product_worktree=args.frozen_product_worktree,
            frozen_schema=args.frozen_schema,
            receipt_schema=args.receipt_schema,
        )
    except seal.SealError as exc:
        print(exc.to_json(), file=sys.stderr)
        return exc.exit_code
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        failure = seal.SealError(
            "uncontrolled Stage 10 seal failure",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
            details={"exception_type": type(exc).__name__},
        )
        print(failure.to_json(), file=sys.stderr)
        return failure.exit_code
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
