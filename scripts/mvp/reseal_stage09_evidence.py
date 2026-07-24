#!/usr/bin/env python3
# ruff: noqa: EM101, EM102, S603, TC003, TRY003
"""Validate, copy, recursively seal, and receipt a Stage-09 evidence bundle."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import stat
import subprocess
import sys
import time
import uuid
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
SEAL_MODULE = SCRIPT_DIR / "stage_evidence_seal.py"
_seal_spec = importlib.util.spec_from_file_location("ketos_stage_evidence_seal", SEAL_MODULE)
if _seal_spec is None or _seal_spec.loader is None:  # pragma: no cover - import invariant
    raise RuntimeError("unable to load stage_evidence_seal.py")
seal = importlib.util.module_from_spec(_seal_spec)
sys.modules[_seal_spec.name] = seal
_seal_spec.loader.exec_module(seal)

SealError = seal.SealError
TESTED_CODE_SHA = "18a2a2a9518d23c589c6700c322ad5844adce932"
FROZEN_SCHEMA_SHA256 = "1c8d409e5984a56e1794b9416fc4d1e76d1327dd56f423e647abe349734469a8"
EXPECTED_SCHEMA_RELATIVE = Path("docs/dev/handoff/schemas/stage-09-evidence.schema.json")
RECEIPT_SCHEMA = Path(__file__).resolve().parents[2] / "docs/dev/handoff/schemas/stage-09-seal-receipt.schema.json"
TOOLING_ROOT = Path(__file__).resolve().parents[2]
SECRET_PATTERNS = (
    re.compile(rb"(?i)authorization\s*:\s*bearer\s+\S+"),
    re.compile(rb"(?i)(api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[=:]\s*[^\s\"']+"),
    re.compile(rb"\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b"),
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


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    descriptor = os.open(path, os.O_RDONLY | seal.O_NOFOLLOW)
    try:
        while chunk := os.read(descriptor, 1024 * 1024):
            digest.update(chunk)
    finally:
        os.close(descriptor)
    return digest.hexdigest()


def _strict_json(path: Path) -> Any:
    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise SealError(
                    f"duplicate JSON key in {path}: {key}",
                    exit_code=seal.EXIT_MATERIALIZATION_INVALID,
                )
            result[key] = value
        return result

    try:
        return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicates)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SealError(
            f"invalid JSON: {path}",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
        ) from exc


def _git_output(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["/usr/bin/git", "-C", str(repo), *args],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise SealError(
            f"git verification failed: {' '.join(args)}",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
        )
    return result.stdout.rstrip("\n")


def _canonical_existing_path(
    path: Path,
    *,
    label: str,
    unavailable_exit_code: int = seal.EXIT_PREFLIGHT_INVALID,
) -> Path:
    raw = os.fspath(path)
    if not path.is_absolute() or os.path.normpath(raw) != raw or any(part in {".", ".."} for part in path.parts):
        raise SealError(
            f"{label} must be an absolute normalized canonical path",
            exit_code=seal.EXIT_PREFLIGHT_INVALID,
        )
    try:
        if stat.S_ISLNK(os.lstat(path).st_mode):
            raise SealError(
                f"{label} must not be a symlink",
                exit_code=seal.EXIT_PREFLIGHT_INVALID,
            )
        canonical = path.resolve(strict=True)
    except (OSError, ValueError) as exc:
        raise SealError(
            f"{label} is unavailable",
            exit_code=unavailable_exit_code,
        ) from exc
    if canonical != path:
        raise SealError(
            f"{label} path is not canonical or traverses a symlink",
            exit_code=seal.EXIT_PREFLIGHT_INVALID,
        )
    return canonical


def _canonical_new_path(path: Path, *, label: str) -> Path:
    raw = os.fspath(path)
    if not path.is_absolute() or os.path.normpath(raw) != raw or any(part in {".", ".."} for part in path.parts):
        raise SealError(
            f"{label} must be an absolute normalized canonical path",
            exit_code=seal.EXIT_PREFLIGHT_INVALID,
        )
    parent = _canonical_existing_path(path.parent, label=f"{label} parent")
    canonical = parent / path.name
    if canonical != path:
        raise SealError(
            f"{label} parent path is not canonical",
            exit_code=seal.EXIT_PREFLIGHT_INVALID,
        )
    if os.path.lexists(canonical):
        raise SealError(
            f"{label} already exists: {canonical}",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
        )
    return canonical


def _is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def _verify_tooling_identity(root: Path, closure_tooling_sha: str) -> None:
    if _git_output(root, "rev-parse", "HEAD") != closure_tooling_sha:
        raise SealError(
            "closure tooling SHA does not match the controller HEAD",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
        )
    if _git_output(root, "status", "--porcelain=v1"):
        raise SealError(
            "closure tooling worktree is dirty",
            exit_code=seal.EXIT_ZERO_WRITE_INVALID,
        )


def _validate_relative_path(value: str) -> None:
    path = Path(value)
    if (
        not value
        or "\x00" in value
        or path.is_absolute()
        or value != path.as_posix()
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        raise SealError(
            f"invalid manifest relative path: {value!r}",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
        )


def _scan_secrets(root: Path, regular_paths: Sequence[str]) -> None:
    for relative in regular_paths:
        path = root / relative
        if path.stat().st_size > 16 * 1024 * 1024:
            continue
        payload = path.read_bytes()
        if any(pattern.search(payload) for pattern in SECRET_PATTERNS):
            raise SealError(
                f"secret scan rejected payload path: {relative}",
                exit_code=seal.EXIT_MATERIALIZATION_INVALID,
            )


def snapshot_source(root: Path) -> dict[str, Any]:
    root = Path(root)
    records = seal.inventory_tree_no_links(root)
    byte_inventory = seal.build_byte_inventory(root, inventory=records)
    metadata = [
        {
            "path": item.relative_path,
            "type": item.object_type,
            "device": item.device,
            "inode": item.inode,
            "mode": item.mode,
            "uid": item.uid,
            "gid": item.gid,
            "nlink": item.nlink,
            "size": item.size,
            "flags": item.flags,
            "mtime_ns": item.mtime_ns,
            "ctime_ns": item.ctime_ns,
            "birthtime_ns": item.birthtime_ns,
            "acl": list(item.acl),
            "xattrs": list(item.xattrs),
        }
        for item in records
    ]
    digest = hashlib.sha256(
        json.dumps(
            {"metadata": metadata, "byte_root": byte_inventory["root_sha256"]},
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode()
    ).hexdigest()
    return {
        "canonical_root": str(root.resolve(strict=True)),
        "metadata": metadata,
        "byte_inventory": byte_inventory,
        "snapshot_sha256": digest,
    }


def assert_source_unchanged(before: Mapping[str, Any], after: Mapping[str, Any]) -> None:
    if before != after:
        raise SealError(
            "source changed during Stage-09 reseal",
            exit_code=seal.EXIT_SOURCE_CHANGED,
            details={
                "before_snapshot_sha256": before.get("snapshot_sha256"),
                "after_snapshot_sha256": after.get("snapshot_sha256"),
            },
        )


def validate_stage09_source(
    *,
    source_bundle: Path,
    frozen_product_worktree: Path,
    frozen_schema_path: Path,
    expected_schema_sha256: str = FROZEN_SCHEMA_SHA256,
    tested_code_sha: str = TESTED_CODE_SHA,
    verify_git: bool = True,
    verify_apfs: bool | None = None,
) -> dict[str, Any]:
    canonical_source = _canonical_existing_path(Path(source_bundle), label="source bundle")
    canonical_product = _canonical_existing_path(
        Path(frozen_product_worktree),
        label="frozen product worktree",
    )
    canonical_schema = _canonical_existing_path(
        Path(frozen_schema_path),
        label="frozen schema",
        unavailable_exit_code=seal.EXIT_MATERIALIZATION_INVALID,
    )
    expected_schema = canonical_product / EXPECTED_SCHEMA_RELATIVE
    if canonical_schema != expected_schema:
        raise SealError(
            "frozen schema must come from the exact frozen product worktree",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
        )
    if _sha256(canonical_schema) != expected_schema_sha256:
        raise SealError(
            "frozen schema SHA-256 mismatch",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
        )
    if verify_git:
        if _git_output(canonical_product, "rev-parse", "HEAD") != tested_code_sha:
            raise SealError(
                "frozen product worktree HEAD mismatch",
                exit_code=seal.EXIT_MATERIALIZATION_INVALID,
            )
        if _git_output(canonical_product, "status", "--porcelain=v1"):
            raise SealError(
                "frozen product worktree is dirty",
                exit_code=seal.EXIT_ZERO_WRITE_INVALID,
            )
    if verify_apfs if verify_apfs is not None else verify_git:
        seal.preflight_apfs_root(canonical_source)

    manifest_path = canonical_source / "manifest.json"
    manifest_checksum = canonical_source / "manifest.sha256"
    checksum_line = manifest_checksum.read_text(encoding="ascii")
    checksum_match = re.fullmatch(r"([0-9a-f]{64})  manifest\.json\n", checksum_line)
    if checksum_match is None or checksum_match.group(1) != _sha256(manifest_path):
        raise SealError(
            "manifest.sha256 does not match manifest.json",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
        )
    manifest = _strict_json(manifest_path)
    if not isinstance(manifest, dict) or manifest.get("code_sha") != tested_code_sha:
        raise SealError(
            "manifest tested code SHA mismatch",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
        )
    files = manifest.get("files")
    if not isinstance(files, dict):
        raise SealError("manifest files must be an object", exit_code=seal.EXIT_MATERIALIZATION_INVALID)
    for relative in files:
        _validate_relative_path(relative)
    if "repo-after-full.json" not in files:
        raise SealError(
            "manifest omission of repo-after-full.json",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
        )

    records = seal.inventory_tree_no_links(canonical_source)
    regular_paths = {record.relative_path for record in records if record.object_type == "regular"}
    payload_paths = regular_paths - {"manifest.json", "manifest.sha256"}
    if payload_paths != set(files):
        raise SealError(
            "manifest payload set mismatch",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
            details={
                "missing": sorted(payload_paths - set(files)),
                "extra": sorted(set(files) - payload_paths),
            },
        )
    for relative, entry in files.items():
        if not isinstance(entry, dict):
            raise SealError(
                f"invalid manifest entry: {relative}",
                exit_code=seal.EXIT_MATERIALIZATION_INVALID,
            )
        path = canonical_source / relative
        if entry.get("size") != path.stat().st_size or entry.get("sha256") != _sha256(path):
            raise SealError(
                f"manifest entry mismatch: {relative}",
                exit_code=seal.EXIT_MATERIALIZATION_INVALID,
            )
    _scan_secrets(canonical_source, sorted(payload_paths))

    evidence = _strict_json(canonical_source / "evidence.json")
    scope = evidence.get("scope")
    if not isinstance(scope, dict) or any(
        scope.get(name) is not True for name in ("head_frozen", "worktree_clean", "pre_post_equal")
    ):
        raise SealError(
            "structured evidence scope proof failed",
            exit_code=seal.EXIT_ZERO_WRITE_INVALID,
        )
    schema_payload = _strict_json(canonical_schema)
    try:
        from jsonschema import Draft202012Validator
    except ImportError as exc:  # pragma: no cover - pinned dependency
        raise SealError(
            "jsonschema is required",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
        ) from exc
    errors = sorted(
        Draft202012Validator(schema_payload).iter_errors(evidence),
        key=lambda item: list(item.path),
    )
    if errors:
        raise SealError(
            "evidence.json does not match the frozen schema",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
            details={"errors": [item.message for item in errors[:10]]},
        )
    if evidence.get("code_sha") != tested_code_sha:
        raise SealError(
            "evidence tested code SHA mismatch",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
        )
    repo_after = _strict_json(canonical_source / "repo-after-full.json")
    if repo_after.get("code_sha") != tested_code_sha:
        raise SealError(
            "repo-after-full code SHA mismatch",
            exit_code=seal.EXIT_ZERO_WRITE_INVALID,
        )
    if repo_after.get("changed_paths") != []:
        raise SealError(
            "repo-after-full changed_paths is not empty",
            exit_code=seal.EXIT_ZERO_WRITE_INVALID,
        )
    if repo_after.get("matches_before") is not True:
        raise SealError(
            "repo-after-full matches_before is not true",
            exit_code=seal.EXIT_ZERO_WRITE_INVALID,
        )

    byte_inventory = seal.build_byte_inventory(canonical_source, inventory=records)
    type_counts = {
        "regular": sum(item.object_type == "regular" for item in records),
        "directory": sum(item.object_type == "directory" for item in records),
        "symlink": 0,
        "special": 0,
    }
    return {
        "tested_code_sha": tested_code_sha,
        "source_bundle": str(canonical_source),
        "frozen_product_worktree": str(canonical_product),
        "frozen_schema_path": str(canonical_schema),
        "frozen_schema_sha256": expected_schema_sha256,
        "source_manifest_sha256": _sha256(manifest_path),
        "manifest_payload_files": len(files),
        "total_objects": len(records),
        "type_counts": type_counts,
        "device": records[0].device,
        "byte_inventory": byte_inventory,
        "manifest": manifest,
        "evidence": evidence,
        "repo_after_full": repo_after,
    }


def _copy_regular(source: Path, destination: Path) -> None:
    source_fd = os.open(source, os.O_RDONLY | seal.O_NOFOLLOW)
    try:
        destination_fd = os.open(
            destination,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | seal.O_NOFOLLOW,
            0o600,
        )
        try:
            source_identity = os.fstat(source_fd)
            path_identity = os.lstat(source)
            if (source_identity.st_dev, source_identity.st_ino) != (
                path_identity.st_dev,
                path_identity.st_ino,
            ):
                raise SealError(
                    "source identity changed before materialization",
                    exit_code=seal.EXIT_SOURCE_CHANGED,
                )
            while chunk := os.read(source_fd, 1024 * 1024):
                view = memoryview(chunk)
                while view:
                    view = view[os.write(destination_fd, view) :]
            os.fsync(destination_fd)
        finally:
            os.close(destination_fd)
    finally:
        os.close(source_fd)


def _copy_allowed_xattrs(source: Path, destination: Path) -> None:
    try:
        names_result = subprocess.run(
            ["/usr/bin/xattr", str(source)],
            check=False,
            capture_output=True,
            text=True,
        )
        if names_result.returncode != 0:
            raise OSError("unable to list xattrs")
        names = sorted(line for line in names_result.stdout.splitlines() if line)
        unexpected = set(names) - seal.ALLOWED_XATTRS
        if unexpected:
            raise SealError(
                "materialization encountered an unexpected xattr",
                exit_code=seal.EXIT_MATERIALIZATION_INVALID,
                details={"path": str(source), "xattrs": sorted(unexpected)},
            )
        for name in names:
            value_result = subprocess.run(
                ["/usr/bin/xattr", "-px", name, str(source)],
                check=False,
                capture_output=True,
                text=True,
            )
            if value_result.returncode != 0:
                raise OSError(f"unable to read xattr {name}")
            value = bytes.fromhex("".join(value_result.stdout.split()))
            write_result = subprocess.run(
                ["/usr/bin/xattr", "-wx", name, value.hex(), str(destination)],
                check=False,
                capture_output=True,
            )
            readback_result = subprocess.run(
                ["/usr/bin/xattr", "-px", name, str(destination)],
                check=False,
                capture_output=True,
                text=True,
            )
            readback = bytes.fromhex("".join(readback_result.stdout.split()))
            if write_result.returncode != 0 or readback_result.returncode != 0 or readback != value:
                raise SealError(
                    "materialized xattr read-back mismatch",
                    exit_code=seal.EXIT_MATERIALIZATION_INVALID,
                    details={"path": str(destination), "xattr": name},
                )
    except (OSError, ValueError) as exc:
        raise SealError(
            "materialized xattr copy failed",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
            details={"source": str(source), "destination": str(destination)},
        ) from exc


def verify_distinct_inodes(source: Path, destination: Path) -> dict[str, Any]:
    source = Path(source)
    destination = Path(destination)
    source_records = {item.relative_path: item for item in seal.inventory_tree_no_links(source)}
    destination_records = {item.relative_path: item for item in seal.inventory_tree_no_links(destination)}
    if set(source_records) != set(destination_records):
        raise SealError(
            "source/destination path sets differ",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
        )
    aliases = [
        relative
        for relative in source_records
        if (
            source_records[relative].device,
            source_records[relative].inode,
        )
        == (
            destination_records[relative].device,
            destination_records[relative].inode,
        )
    ]
    if aliases:
        raise SealError(
            "source and destination share the same inode",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
            details={"same_inode_paths": aliases},
        )
    return {"same_inode_count": 0, "checked_objects": len(source_records)}


def compare_byte_inventories(source: Path, destination: Path) -> dict[str, Any]:
    source_inventory = seal.build_byte_inventory(Path(source))
    destination_inventory = seal.build_byte_inventory(Path(destination))
    return {
        "equal": (
            source_inventory["root_sha256"] == destination_inventory["root_sha256"]
            and source_inventory["xattr_root_sha256"] == destination_inventory["xattr_root_sha256"]
        ),
        "source_root_sha256": source_inventory["root_sha256"],
        "destination_root_sha256": destination_inventory["root_sha256"],
        "source_xattr_root_sha256": source_inventory["xattr_root_sha256"],
        "destination_xattr_root_sha256": destination_inventory["xattr_root_sha256"],
    }


def materialize_distinct_copy(source: Path, destination: Path) -> dict[str, Any]:
    source = Path(source).resolve(strict=True)
    destination = Path(destination)
    if os.path.lexists(destination):
        raise SealError(
            f"destination already exists: {destination}",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
        )
    records = seal.inventory_tree_no_links(source)
    destination.mkdir(mode=0o700, parents=False, exist_ok=False)
    try:
        _copy_allowed_xattrs(source, destination)
        directories = [item for item in records if item.object_type == "directory" and item.relative_path != "."]
        for record in sorted(directories, key=lambda item: item.relative_path.count("/")):
            copied_directory = destination / record.relative_path
            copied_directory.mkdir(mode=0o700)
            _copy_allowed_xattrs(source / record.relative_path, copied_directory)
        for record in records:
            if record.object_type != "regular":
                continue
            copied_file = destination / record.relative_path
            _copy_regular(source / record.relative_path, copied_file)
            _copy_allowed_xattrs(source / record.relative_path, copied_file)
        for directory in sorted(
            (path for path in destination.rglob("*") if path.is_dir()),
            reverse=True,
        ):
            descriptor = os.open(directory, os.O_RDONLY | seal.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        descriptor = os.open(destination, os.O_RDONLY | seal.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except OSError as exc:
        raise SealError(
            "materialization failed; candidate must not be reused",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
            details={"destination": str(destination)},
        ) from exc
    identities = verify_distinct_inodes(source, destination)
    comparison = compare_byte_inventories(source, destination)
    if comparison["equal"] is not True:
        raise SealError(
            "materialized byte inventory mismatch",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
            details=comparison,
        )
    return {**identities, **comparison}


def build_stage09_receipt(
    *,
    validation: Mapping[str, Any],
    closure_tooling_sha: str,
    final_bundle: Path,
    seal_verification: Mapping[str, Any],
    negative_probes: Sequence[Mapping[str, Any]],
    source_unchanged: bool,
    started_at_utc: str,
    completed_at_utc: str,
    started_monotonic_ns: int,
    completed_monotonic_ns: int,
) -> dict[str, Any]:
    tested_sha = validation.get("tested_code_sha")
    if re.fullmatch(r"[0-9a-f]{40}", closure_tooling_sha) is None:
        raise SealError("invalid tooling SHA", exit_code=seal.EXIT_RECEIPT_PROTECTION)
    if closure_tooling_sha == tested_sha:
        raise SealError(
            "tooling SHA must be separate from tested product SHA",
            exit_code=seal.EXIT_RECEIPT_PROTECTION,
        )
    if (
        source_unchanged is not True
        or seal_verification.get("sealed_objects") != seal_verification.get("total_objects")
        or seal_verification.get("total_objects", 0) < 1
        or len(negative_probes) != len(PROBE_NAMES)
        or {item.get("name") for item in negative_probes} != PROBE_NAMES
        or not all(item.get("denied") is True for item in negative_probes)
    ):
        raise SealError(
            "receipt PASS preconditions are incomplete",
            exit_code=seal.EXIT_RECEIPT_PROTECTION,
        )
    type_counts = dict(validation["type_counts"])
    total = int(validation["total_objects"])
    return {
        "schema_version": 1,
        "receipt_kind": "stage-evidence-seal-receipt",
        "stage": 9,
        "status": "PASS",
        "identity": {
            "tested_code_sha": tested_sha,
            "closure_tooling_sha": closure_tooling_sha,
        },
        "paths": {
            "source_bundle": validation["source_bundle"],
            "final_bundle": str(Path(final_bundle).absolute()),
            "frozen_product_worktree": validation["frozen_product_worktree"],
            "frozen_schema": validation["frozen_schema_path"],
            "manifest": "manifest.json",
            "repo_after_full": "repo-after-full.json",
        },
        "digests": {
            "source_manifest_sha256": validation["source_manifest_sha256"],
            "frozen_schema_sha256": validation["frozen_schema_sha256"],
            "byte_inventory_root_sha256": validation["byte_inventory"]["root_sha256"],
            "xattr_inventory_root_sha256": validation["byte_inventory"]["xattr_root_sha256"],
        },
        "filesystem": {
            "type": "apfs",
            "volume_uuid": seal.EXPECTED_APFS_UUID,
            "device": int(validation["device"]),
        },
        "inventory": {
            "total_objects": total,
            "manifest_payload_files": int(validation["manifest_payload_files"]),
            "type_counts": type_counts,
            "source_destination_same_inode_count": 0,
            "hardlink_count": 0,
        },
        "seal": {
            "read_only_mode_objects": total,
            "immutable_flag_objects": total,
            "recursive_verification_passed": True,
            "byte_inventory_equal_after_probes": True,
        },
        "negative_probes": [dict(item) for item in negative_probes],
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


def _seal_root_last(root: Path, expected_identity: tuple[int, int]) -> None:
    before = os.lstat(root)
    if (before.st_dev, before.st_ino) != expected_identity:
        raise SealError(
            "published root identity differs from the staging root",
            exit_code=seal.EXIT_PARTIAL_SEAL,
        )
    os.chflags(
        root,
        getattr(before, "st_flags", 0) | stat.UF_IMMUTABLE,
        follow_symlinks=False,
    )
    after = os.lstat(root)
    if (after.st_dev, after.st_ino) != expected_identity or not (getattr(after, "st_flags", 0) & stat.UF_IMMUTABLE):
        raise SealError(
            "final root immutable read-back failed",
            exit_code=seal.EXIT_PARTIAL_SEAL,
        )
    descriptor = os.open(root, os.O_RDONLY | seal.O_DIRECTORY | seal.O_NOFOLLOW)
    try:
        descriptor_info = os.fstat(descriptor)
        if (descriptor_info.st_dev, descriptor_info.st_ino) != expected_identity or not (
            getattr(descriptor_info, "st_flags", 0) & stat.UF_IMMUTABLE
        ):
            raise SealError(
                "final root descriptor read-back failed",
                exit_code=seal.EXIT_PARTIAL_SEAL,
            )
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def reseal_stage09(
    *,
    source_bundle: Path,
    final_bundle: Path,
    receipt_directory: Path,
    frozen_product_worktree: Path,
    frozen_schema_path: Path,
    closure_tooling_sha: str,
    expected_schema_sha256: str = FROZEN_SCHEMA_SHA256,
    receipt_schema_path: Path = RECEIPT_SCHEMA,
) -> dict[str, Any]:
    """Run the monotonic closure state machine; only the last return is PASS."""
    started_monotonic_ns = time.monotonic_ns()
    started_at_utc = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    _verify_tooling_identity(TOOLING_ROOT, closure_tooling_sha)
    validation = validate_stage09_source(
        source_bundle=source_bundle,
        frozen_product_worktree=frozen_product_worktree,
        frozen_schema_path=frozen_schema_path,
        expected_schema_sha256=expected_schema_sha256,
        tested_code_sha=TESTED_CODE_SHA,
        verify_git=True,
    )
    source = Path(validation["source_bundle"])
    source_before = snapshot_source(source)
    final = _canonical_new_path(Path(final_bundle), label="final bundle")
    receipt_dir = _canonical_new_path(Path(receipt_directory), label="receipt directory")
    if (
        _is_within(final, source)
        or _is_within(receipt_dir, source)
        or _is_within(receipt_dir, final)
        or _is_within(final, receipt_dir)
    ):
        raise SealError(
            "source, final bundle, and receipt directory must be disjoint",
            exit_code=seal.EXIT_PREFLIGHT_INVALID,
        )
    seal.preflight_apfs_root(final.parent)
    seal.preflight_apfs_root(receipt_dir.parent)
    staging = final.parent / f".{final.name}.staging-{uuid.uuid4().hex}"
    materialize_distinct_copy(source, staging)
    assert_source_unchanged(source_before, snapshot_source(source))
    baseline = seal.build_byte_inventory(staging)
    modes = seal.apply_read_only_modes(staging)
    flags = seal.apply_immutable_flags_bottom_up(staging, include_root=False)
    if flags["sealed_objects"] != len(baseline["entries"]) - 1:
        raise SealError(
            "descendant recursive seal count mismatch",
            exit_code=seal.EXIT_PARTIAL_SEAL,
        )
    staging_info = os.lstat(staging)
    staging_identity = (staging_info.st_dev, staging_info.st_ino)
    seal.atomic_publish_directory(staging, final)
    _seal_root_last(final, staging_identity)
    verification = seal.verify_recursive_seal(final, expected_bytes=baseline)
    probes = seal.run_negative_mutation_probes(final, baseline=baseline)
    assert_source_unchanged(source_before, snapshot_source(source))
    completed_at_utc = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    completed_monotonic_ns = time.monotonic_ns()
    receipt = build_stage09_receipt(
        validation=validation,
        closure_tooling_sha=closure_tooling_sha,
        final_bundle=final,
        seal_verification=verification,
        negative_probes=probes,
        source_unchanged=True,
        started_at_utc=started_at_utc,
        completed_at_utc=completed_at_utc,
        started_monotonic_ns=started_monotonic_ns,
        completed_monotonic_ns=completed_monotonic_ns,
    )
    receipt_schema = _strict_json(Path(receipt_schema_path).resolve(strict=True))
    published = seal.publish_receipt_atomically(
        receipt_dir,
        receipt,
        schema=receipt_schema,
    )
    receipt_verification = seal.verify_receipt_self_protection(receipt_dir)
    assert_source_unchanged(source_before, snapshot_source(source))
    return {
        "status": "PASS",
        "terminal": "STAGE09_FINALIZATION=PASS",
        "tested_code_sha": TESTED_CODE_SHA,
        "closure_tooling_sha": closure_tooling_sha,
        "final_bundle": str(final.resolve(strict=True)),
        "receipt": published,
        "receipt_verification": receipt_verification,
        "mode_objects": modes["mode_objects"],
        "sealed_objects": verification["sealed_objects"],
        "negative_probes": probes,
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-bundle", type=Path, required=True)
    parser.add_argument("--final-bundle", type=Path, required=True)
    parser.add_argument("--receipt-directory", type=Path, required=True)
    parser.add_argument("--frozen-product-worktree", type=Path, required=True)
    parser.add_argument("--frozen-schema", type=Path, required=True)
    parser.add_argument("--closure-tooling-sha", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    try:
        args = _parser().parse_args(argv)
        result = reseal_stage09(
            source_bundle=args.source_bundle,
            final_bundle=args.final_bundle,
            receipt_directory=args.receipt_directory,
            frozen_product_worktree=args.frozen_product_worktree,
            frozen_schema_path=args.frozen_schema,
            closure_tooling_sha=args.closure_tooling_sha,
        )
    except SealError as exc:
        print(exc.to_json(), file=sys.stderr)
        return exc.exit_code
    except (OSError, ValueError) as exc:
        failure = SealError(
            "uncontrolled Stage-09 reseal failure",
            exit_code=seal.EXIT_MATERIALIZATION_INVALID,
            details={"exception_type": type(exc).__name__},
        )
        print(failure.to_json(), file=sys.stderr)
        return failure.exit_code
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
