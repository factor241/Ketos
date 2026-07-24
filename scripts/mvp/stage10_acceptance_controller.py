#!/usr/bin/env python3
# ruff: noqa: BLE001, EM101, N818, PLR2004, RUF059, S603, S607, TRY003, TRY004, UP035
"""Fail-closed Stage 10 admission against the canonical sealed Stage 09 prerequisite."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Callable

from jsonschema import Draft202012Validator, FormatChecker

TESTED_STAGE09_SHA = "18a2a2a9518d23c589c6700c322ad5844adce932"
CLOSURE_TOOLING_SHA = "638f2b2d35e353fe0ad9f39ee800315ebe6d1338"
SOURCE_MANIFEST_SHA256 = "d5ee8f24eec4899be7f0b585c9ddd265b6490a8b8c6face0537e55e2f2a68441"
FROZEN_SCHEMA_SHA256 = "1c8d409e5984a56e1794b9416fc4d1e76d1327dd56f423e647abe349734469a8"
BYTE_INVENTORY_ROOT = "9ccd089b4b6207f29dcd193304713cf988b8b1b64123769251c78d39a8708e95"
XATTR_INVENTORY_ROOT = "086a778bb5b8b251499b4160879aa5ca77badb981dd61b410a6e55b11f10507a"
RECEIPT_SHA256 = "34a870717090c98590fd6bc88057e6c6649d4ebb00e3429ca10cf19bdbbf00ed"
APFS_VOLUME_UUID = "8B3B8A79-88A2-4676-8ED0-4C49EB697CDF"
CANONICAL_PUBLICATION_ID = "20260724T140346Z-48988"
SCHEMA_REPO_PATH = PurePosixPath("docs/dev/handoff/schemas/stage-09-evidence.schema.json")
EVIDENCE_ROOT = Path("/Volumes/Projects/.ketos-stage09-evidence")
RECEIPTS_ROOT = Path("/Volumes/Projects/.ketos-stage09-evidence/receipts")
PROBE_NAMES = (
    "create-child",
    "overwrite",
    "truncate",
    "chmod",
    "mtime",
    "rename-file",
    "unlink-file",
    "rename-root",
)
PUBLICATION_ID_RE = re.compile(r"20[0-9]{6}T[0-9]{6}Z-[1-9][0-9]*")


@dataclass(frozen=True)
class Stage09Expected:
    tested_sha: str
    closure_tooling_sha: str
    source_manifest_sha256: str
    frozen_schema_sha256: str
    byte_inventory_root: str
    xattr_inventory_root: str
    receipt_sha256: str
    apfs_volume_uuid: str
    expected_bundle_objects: int = 81
    schema_repo_relative_path: PurePosixPath = SCHEMA_REPO_PATH


EXPECTED_STAGE09 = Stage09Expected(
    tested_sha=TESTED_STAGE09_SHA,
    closure_tooling_sha=CLOSURE_TOOLING_SHA,
    source_manifest_sha256=SOURCE_MANIFEST_SHA256,
    frozen_schema_sha256=FROZEN_SCHEMA_SHA256,
    byte_inventory_root=BYTE_INVENTORY_ROOT,
    xattr_inventory_root=XATTR_INVENTORY_ROOT,
    receipt_sha256=RECEIPT_SHA256,
    apfs_volume_uuid=APFS_VOLUME_UUID,
)


@dataclass(frozen=True)
class PrerequisiteResult:
    result_schema_version: int
    stage: str
    status: str
    tested_sha: str
    publication_id: str
    bundle: str
    receipt_directory: str
    checks_completed: tuple[str, ...]
    error_code: str | None


class VerificationFailure(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _strict_json_bytes(payload: bytes) -> Any:
    def pairs(values: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in values:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result

    def constant(_value: str) -> Any:
        raise ValueError("non-finite JSON number")

    return json.loads(payload.decode("utf-8"), object_pairs_hook=pairs, parse_constant=constant)


def _strict_json(path: Path) -> Any:
    return _strict_json_bytes(path.read_bytes())


def _canonical_directory(path: Path) -> Path:
    lexical = path.absolute()
    try:
        canonical = path.resolve(strict=True)
    except OSError as exc:
        raise VerificationFailure("E_CANONICAL_PATH") from exc
    if lexical != canonical or not canonical.is_dir() or path.is_symlink():
        raise VerificationFailure("E_CANONICAL_PATH")
    return canonical


def _load_schema_blob_at_commit(repo_root: Path, sha: str, relative: PurePosixPath) -> bytes:
    environment = {
        "PATH": os.environ.get("PATH", ""),
        "GIT_NO_REPLACE_OBJECTS": "1",
        "LC_ALL": "C",
    }
    resolved = subprocess.run(
        ["git", "rev-parse", "--verify", f"{sha}^{{commit}}"],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
        env=environment,
        timeout=30,
    ).stdout.strip()
    if resolved != sha:
        raise RuntimeError("commit identity mismatch")
    return subprocess.run(
        ["git", "show", f"{sha}:{relative.as_posix()}"],
        cwd=repo_root,
        check=True,
        capture_output=True,
        env=environment,
        timeout=30,
    ).stdout


def _load_seal_api() -> Any:
    module_path = Path(__file__).with_name("stage_evidence_seal.py")
    spec = importlib.util.spec_from_file_location("ketos_stage10_stage_evidence_seal", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("generic seal module unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _validate_probe_set(probes: Any) -> None:
    if not isinstance(probes, list) or len(probes) != len(PROBE_NAMES):
        raise ValueError("probe count mismatch")
    names = [row.get("name") for row in probes if isinstance(row, dict)]
    if len(names) != len(probes) or set(names) != set(PROBE_NAMES) or len(names) != len(set(names)):
        raise ValueError("probe names mismatch")
    if any(row.get("denied") is not True or row.get("errno") not in {1, 13} for row in probes):
        raise ValueError("probe denial mismatch")


def _validate_manifest(bundle: Path, expected: Stage09Expected) -> tuple[dict[str, Any], set[str]]:
    manifest_path = bundle / "manifest.json"
    checksum_path = bundle / "manifest.sha256"
    digest = _sha256_file(manifest_path)
    expected_line = f"{digest}  manifest.json\n"
    if checksum_path.read_text(encoding="ascii") != expected_line:
        raise VerificationFailure("E_MANIFEST_CHECKSUM")
    if digest != expected.source_manifest_sha256:
        raise VerificationFailure("E_MANIFEST_CHECKSUM")
    manifest = _strict_json(manifest_path)
    if (
        not isinstance(manifest, dict)
        or manifest.get("stage") != 9
        or manifest.get("code_sha") != expected.tested_sha
        or not isinstance(manifest.get("files"), dict)
    ):
        raise VerificationFailure("E_MANIFEST")
    files = manifest["files"]
    covered: set[str] = set()
    for raw_relative, metadata in files.items():
        if not isinstance(raw_relative, str) or not isinstance(metadata, dict):
            raise VerificationFailure("E_MANIFEST")
        relative = PurePosixPath(raw_relative)
        if relative.is_absolute() or ".." in relative.parts or relative.as_posix() != raw_relative:
            raise VerificationFailure("E_MANIFEST")
        candidate = bundle.joinpath(*relative.parts)
        try:
            info = candidate.lstat()
        except OSError as exc:
            raise VerificationFailure("E_MANIFEST") from exc
        if not candidate.is_file() or candidate.is_symlink() or info.st_nlink != 1:
            raise VerificationFailure("E_MANIFEST")
        if metadata.get("size") != info.st_size or metadata.get("sha256") != _sha256_file(candidate):
            raise VerificationFailure("E_MANIFEST")
        covered.add(raw_relative)
    if {"evidence.json", "repo-after-full.json"} - covered:
        raise VerificationFailure("E_MANIFEST")
    actual_regular = {
        path.relative_to(bundle).as_posix() for path in bundle.rglob("*") if path.is_file() and not path.is_symlink()
    }
    if actual_regular != covered | {"manifest.json", "manifest.sha256"}:
        raise VerificationFailure("E_MANIFEST")
    return manifest, covered


def _validate_receipt_contract(
    *,
    receipt: Any,
    bundle: Path,
    publication_id: str,
    expected: Stage09Expected,
    manifest_payload_count: int,
) -> None:
    if not isinstance(receipt, dict):
        raise ValueError("receipt is not an object")
    identity = receipt.get("identity")
    paths = receipt.get("paths")
    digests = receipt.get("digests")
    inventory = receipt.get("inventory")
    seal = receipt.get("seal")
    filesystem = receipt.get("filesystem")
    policy = receipt.get("receipt_policy")
    if (
        receipt.get("schema_version") != 1
        or receipt.get("receipt_kind") != "stage-evidence-seal-receipt"
        or receipt.get("stage") != 9
        or receipt.get("status") != "PASS"
        or not all(isinstance(value, dict) for value in (identity, paths, digests, inventory, seal, filesystem, policy))
    ):
        raise ValueError("receipt header mismatch")
    if identity != {
        "tested_code_sha": expected.tested_sha,
        "closure_tooling_sha": expected.closure_tooling_sha,
    }:
        raise ValueError("receipt identity mismatch")
    if (
        paths.get("final_bundle") != str(bundle)
        or paths.get("source_bundle") != str(bundle.parent / publication_id)
        or paths.get("manifest") != "manifest.json"
        or paths.get("repo_after_full") != "repo-after-full.json"
        or not isinstance(paths.get("frozen_schema"), str)
    ):
        raise ValueError("receipt paths mismatch")
    if digests != {
        "byte_inventory_root_sha256": expected.byte_inventory_root,
        "frozen_schema_sha256": expected.frozen_schema_sha256,
        "source_manifest_sha256": expected.source_manifest_sha256,
        "xattr_inventory_root_sha256": expected.xattr_inventory_root,
    }:
        raise ValueError("receipt digests mismatch")
    expected_regular = manifest_payload_count + 2
    expected_directories = expected.expected_bundle_objects - expected_regular
    if (
        inventory.get("total_objects") != expected.expected_bundle_objects
        or inventory.get("manifest_payload_files") != manifest_payload_count
        or inventory.get("source_destination_same_inode_count") != 0
        or inventory.get("hardlink_count") != 0
        or inventory.get("type_counts")
        != {
            "directory": expected_directories,
            "regular": expected_regular,
            "special": 0,
            "symlink": 0,
        }
    ):
        raise ValueError("receipt inventory mismatch")
    if (
        seal.get("recursive_verification_passed") is not True
        or seal.get("immutable_flag_objects") != expected.expected_bundle_objects
        or seal.get("read_only_mode_objects") != expected.expected_bundle_objects
        or seal.get("byte_inventory_equal_after_probes") is not True
    ):
        raise ValueError("receipt seal mismatch")
    if filesystem.get("type") != "apfs" or filesystem.get("volume_uuid") != expected.apfs_volume_uuid:
        raise ValueError("receipt filesystem mismatch")
    if policy.get("self_protection_required") is not True:
        raise ValueError("receipt protection policy mismatch")
    _validate_probe_set(receipt.get("negative_probes"))


def _result(
    *,
    status: str,
    expected: Stage09Expected,
    publication_id: str,
    bundle: Path,
    receipt_directory: Path,
    checks: list[str],
    error_code: str | None,
) -> PrerequisiteResult:
    return PrerequisiteResult(
        result_schema_version=1,
        stage="stage10-prerequisite",
        status=status,
        tested_sha=expected.tested_sha,
        publication_id=publication_id,
        bundle=str(bundle),
        receipt_directory=str(receipt_directory),
        checks_completed=tuple(checks),
        error_code=error_code,
    )


def verify_stage09_prerequisite(
    *,
    repo_root: Path,
    publication_id: str = CANONICAL_PUBLICATION_ID,
    evidence_root: Path = EVIDENCE_ROOT,
    receipts_root: Path = RECEIPTS_ROOT,
    expected: Stage09Expected = EXPECTED_STAGE09,
    schema_loader: Callable[[Path, str, PurePosixPath], bytes] = _load_schema_blob_at_commit,
    seal_api: Any | None = None,
) -> PrerequisiteResult:
    checks: list[str] = []
    bundle = evidence_root / "stage-09" / expected.tested_sha / f"{publication_id}-recursive"
    receipt_directory = receipts_root / "stage-09" / expected.tested_sha / f"{publication_id}-recursive"
    try:
        if PUBLICATION_ID_RE.fullmatch(publication_id) is None:
            raise VerificationFailure("E_CANONICAL_PATH")
        bundle = _canonical_directory(bundle)
        receipt_directory = _canonical_directory(receipt_directory)
        checks.append("canonical_paths")

        receipt_path = receipt_directory / "receipt.json"
        receipt_checksum = receipt_directory / "receipt.sha256"
        receipt_digest = _sha256_file(receipt_path)
        if (
            receipt_checksum.read_text(encoding="ascii") != receipt_digest + "\n"
            or receipt_digest != expected.receipt_sha256
        ):
            raise VerificationFailure("E_RECEIPT_CHECKSUM")
        checks.append("receipt_checksum")
        receipt = _strict_json(receipt_path)

        api = seal_api or _load_seal_api()
        try:
            receipt_seal = api.verify_receipt_self_protection(
                receipt_directory,
                expected_volume_uuid=expected.apfs_volume_uuid,
            )
            if (
                receipt_seal.get("total_objects") != 3
                or receipt_seal.get("sealed_objects") != 3
                or receipt_seal.get("receipt_sha256") != expected.receipt_sha256
            ):
                raise ValueError("receipt self-protection mismatch")
            receipt_probes = receipt_seal.get("negative_probes")
            if receipt_probes is not None:
                _validate_probe_set(receipt_probes)
        except Exception as exc:
            raise VerificationFailure("E_RECEIPT_SEAL") from exc
        checks.append("receipt_self_protection")

        try:
            schema_bytes = schema_loader(repo_root, expected.tested_sha, expected.schema_repo_relative_path)
            schema = _strict_json_bytes(schema_bytes)
            if _sha256_bytes(schema_bytes) != expected.frozen_schema_sha256:
                raise ValueError("frozen schema digest mismatch")
            Draft202012Validator.check_schema(schema)
        except Exception as exc:
            raise VerificationFailure("E_FROZEN_SCHEMA") from exc
        checks.append("frozen_schema_exact_commit")

        manifest, covered = _validate_manifest(bundle, expected)
        checks.append("manifest")
        try:
            _validate_receipt_contract(
                receipt=receipt,
                bundle=bundle,
                publication_id=publication_id,
                expected=expected,
                manifest_payload_count=len(covered),
            )
        except Exception as exc:
            raise VerificationFailure("E_RECEIPT_CONTRACT") from exc
        checks.append("receipt_contract")

        evidence = _strict_json(bundle / "evidence.json")
        schema_errors = sorted(
            Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(evidence),
            key=lambda error: list(error.absolute_path),
        )
        if schema_errors or not isinstance(evidence, dict) or "changed_paths" in evidence:
            raise VerificationFailure("E_FROZEN_SCHEMA")
        checks.append("evidence_schema")

        repo_after = _strict_json(bundle / "repo-after-full.json")
        scope = evidence.get("scope") if isinstance(evidence, dict) else None
        if (
            not isinstance(repo_after, dict)
            or repo_after.get("code_sha") != expected.tested_sha
            or repo_after.get("changed_paths") != []
            or repo_after.get("matches_before") is not True
            or not isinstance(scope, dict)
            or any(scope.get(key) is not True for key in ("pre_post_equal", "worktree_clean", "head_frozen"))
        ):
            raise VerificationFailure("E_ZERO_WRITE")
        checks.append("structured_zero_write")

        baseline = api.build_byte_inventory(bundle)
        if (
            baseline.get("root_sha256") != expected.byte_inventory_root
            or baseline.get("xattr_root_sha256") != expected.xattr_inventory_root
            or len(baseline.get("entries", [])) != expected.expected_bundle_objects
        ):
            raise VerificationFailure("E_BUNDLE_INVENTORY")
        try:
            verification = api.verify_recursive_seal(
                bundle,
                expected_bytes=baseline,
                expected_volume_uuid=expected.apfs_volume_uuid,
            )
            if (
                verification.get("total_objects") != expected.expected_bundle_objects
                or verification.get("sealed_objects") != expected.expected_bundle_objects
                or verification.get("byte_root_sha256") != expected.byte_inventory_root
                or verification.get("xattr_root_sha256") != expected.xattr_inventory_root
            ):
                raise ValueError("bundle recursive seal mismatch")
        except Exception as exc:
            raise VerificationFailure("E_BUNDLE_SEAL") from exc
        checks.append("bundle_recursive_seal")

        try:
            live_probes = api.run_negative_mutation_probes(bundle, baseline=baseline)
            _validate_probe_set(live_probes)
        except Exception as exc:
            raise VerificationFailure("E_BUNDLE_PROBES") from exc
        checks.append("bundle_live_negative_probes")

        after = api.build_byte_inventory(bundle)
        if (
            after.get("root_sha256") != baseline.get("root_sha256")
            or after.get("xattr_root_sha256") != baseline.get("xattr_root_sha256")
            or _sha256_file(bundle / "manifest.json") != expected.source_manifest_sha256
        ):
            raise VerificationFailure("E_PROBE_MUTATED_EVIDENCE")
        checks.append("post_probe_unchanged")
        return _result(
            status="PASS",
            expected=expected,
            publication_id=publication_id,
            bundle=bundle,
            receipt_directory=receipt_directory,
            checks=checks,
            error_code=None,
        )
    except VerificationFailure as exc:
        return _result(
            status="FAIL",
            expected=expected,
            publication_id=publication_id,
            bundle=bundle,
            receipt_directory=receipt_directory,
            checks=checks,
            error_code=exc.code,
        )
    except Exception:
        return _result(
            status="FAIL",
            expected=expected,
            publication_id=publication_id,
            bundle=bundle,
            receipt_directory=receipt_directory,
            checks=checks,
            error_code="E_INTERNAL",
        )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--publication-id", default=CANONICAL_PUBLICATION_ID)
    parser.add_argument("--json", action="store_true")
    return parser


def main() -> int:
    args = _parser().parse_args()
    result = verify_stage09_prerequisite(repo_root=args.repo_root, publication_id=args.publication_id)
    payload = asdict(result)
    if args.json:
        print(json.dumps(payload, sort_keys=True))
    else:
        print(f"{result.status}: Stage 09 prerequisite ({result.error_code or 'verified'})")
    return 0 if result.status == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
