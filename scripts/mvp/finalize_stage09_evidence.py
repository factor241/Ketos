#!/usr/bin/env python3
# ruff: noqa: EM101, EM102, TRY003, S108
"""Create and atomically seal the external Stage-09 evidence bundle."""

from __future__ import annotations

import argparse
import ctypes
import errno
import hashlib
import importlib.util
import json
import os
import re
import shutil
import stat
import sys
import tempfile
from pathlib import Path
from typing import Any

REQUIRED_FILES = {
    "evidence.json",
    "report.md",
    "commands.json",
    "repo-before.json",
    "repo-after-full.json",
    "process/recovery.json",
    "process/resource-summary.json",
    "process/gates/004-logger-regression.json",
    "process/telemetry/004-logger-regression.jsonl",
    "logs/focused-backend.txt",
    "logs/restart-integration.txt",
    "logs/restart-smoke.txt",
    "logs/logger-regression.txt",
    "logs/focused-frontend.txt",
    "logs/i18n-check.txt",
    "logs/typecheck-production.txt",
    "logs/backend-package.txt",
    "logs/frontend-package.txt",
    "logs/playwright.txt",
    "logs/workflow-compat.txt",
}
TRANSIENT_STAGING_DIRS = ("cache", "tmp")
SECRET_PATTERNS = (
    re.compile(r"(?i)authorization\s*:\s*bearer\s+\S+"),
    re.compile(r"(?i)(api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[=:]\s*[^\s\"']+"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b"),
)
REPO_ROOT = Path(__file__).resolve().parents[2]
SEAL_MODULE = Path(__file__).resolve().with_name("stage_evidence_seal.py")
RECEIPT_SCHEMA = REPO_ROOT / "docs/dev/handoff/schemas/stage-09-seal-receipt.schema.json"


class EvidenceError(RuntimeError):
    pass


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _validate_identity(value: str, *, label: str, pattern: str) -> None:
    if re.fullmatch(pattern, value) is None:
        raise EvidenceError(f"invalid {label}: {value!r}")


def _validate_root(repo_root: Path, evidence_root: Path) -> Path:
    repo = repo_root.expanduser().resolve(strict=True)
    expanded_root = evidence_root.expanduser()
    if expanded_root.is_symlink():
        raise EvidenceError("evidence root must not be a symbolic link")
    root = expanded_root.resolve(strict=True)
    if not root.is_dir() or not root.is_absolute():
        raise EvidenceError("evidence root must be an existing absolute directory")
    temporary_roots = {
        Path(tempfile.gettempdir()).resolve(),
        Path("/tmp").resolve(),
        Path("/private/tmp").resolve(),
        Path("/var/tmp").resolve(),
    }
    if (
        root == repo
        or root.is_relative_to(repo)
        or any(root == item or root.is_relative_to(item) for item in temporary_roots)
    ):
        raise EvidenceError("evidence root must be persistent, external to the repository, and outside temp")
    mode = stat.S_IMODE(root.stat().st_mode)
    if mode & 0o077:
        raise EvidenceError(f"evidence root must be private (0700 or stricter), got {mode:04o}")
    probe = root / f".stage09-write-probe-{os.getpid()}"
    try:
        probe.mkdir(mode=0o700)
        probe.rmdir()
    except OSError as exc:
        raise EvidenceError(f"evidence root is not privately writable: {exc}") from exc
    return root


def _create_staging(root: Path, code_sha: str, run_id: str) -> Path:
    _validate_identity(code_sha, label="code SHA", pattern=r"[0-9a-f]{40}")
    _validate_identity(run_id, label="run ID", pattern=r"[0-9]{8}T[0-9]{6}Z-[0-9]+")
    staging = root / f".stage09-{code_sha}-{run_id}"
    staging.mkdir(mode=0o700, parents=False, exist_ok=False)
    for child in ("cache", "logs", "playwright", "process", "tmp"):
        (staging / child).mkdir(mode=0o700)
    return staging


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _validate_schema(evidence: Path, schema_path: Path) -> dict[str, Any]:
    payload = _load_json(evidence)
    schema = _load_json(schema_path)
    try:
        from jsonschema import Draft202012Validator
    except ImportError as exc:
        raise EvidenceError("jsonschema is required to validate Stage-09 evidence") from exc
    errors = sorted(Draft202012Validator(schema).iter_errors(payload), key=lambda error: list(error.path))
    if errors:
        detail = "; ".join(error.message for error in errors[:10])
        raise EvidenceError(f"evidence.json does not match committed schema: {detail}")
    return payload


def _payload_files(root: Path) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*")
        if path.is_file() and path.relative_to(root).as_posix() not in {"manifest.json", "manifest.sha256"}
    )


def _reject_symlinks(root: Path) -> None:
    links = [path for path in root.rglob("*") if path.is_symlink()]
    if links:
        raise EvidenceError("symbolic links are forbidden in evidence: " + ", ".join(map(str, links[:10])))


def _fsync_tree(root: Path) -> None:
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        descriptor = os.open(path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    for directory in sorted((path for path in root.rglob("*") if path.is_dir()), reverse=True):
        descriptor = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    descriptor = os.open(root, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _exclusive_atomic_rename(source: Path, destination: Path) -> None:
    """Atomically rename without replacement on the supported Stage-09 host."""
    if sys.platform != "darwin":
        if destination.exists():
            raise EvidenceError(f"refusing to overwrite existing bundle: {destination}")
        source.rename(destination)
        return
    libc = ctypes.CDLL(None, use_errno=True)
    renamex_np = libc.renamex_np
    renamex_np.argtypes = (ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint)
    renamex_np.restype = ctypes.c_int
    rename_excl = 0x00000004
    if renamex_np(os.fsencode(source), os.fsencode(destination), rename_excl) == 0:
        return
    error_number = ctypes.get_errno()
    if error_number in {errno.EEXIST, errno.ENOTEMPTY}:
        raise EvidenceError(f"refusing to overwrite existing bundle: {destination}")
    raise OSError(error_number, os.strerror(error_number), str(destination))


def _scan_secrets(paths: list[Path]) -> None:
    for path in paths:
        if path.stat().st_size > 16 * 1024 * 1024:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for pattern in SECRET_PATTERNS:
            if pattern.search(text):
                raise EvidenceError(f"possible secret in evidence payload: {path}")


def _require_payload(staging: Path) -> None:
    present = {path.relative_to(staging).as_posix() for path in staging.rglob("*") if path.is_file()}
    missing = sorted(REQUIRED_FILES - present)
    if missing:
        raise EvidenceError("missing mandatory evidence files: " + ", ".join(missing))
    if not any(path.suffix == ".zip" for path in (staging / "playwright").rglob("*")):
        raise EvidenceError("Playwright trace zip is required")
    if not any(path.suffix.lower() in {".png", ".jpg", ".jpeg"} for path in (staging / "playwright").rglob("*")):
        raise EvidenceError("at least one supplemental browser screenshot is required")


def _discard_transient_staging(staging: Path) -> None:
    for name in TRANSIENT_STAGING_DIRS:
        path = staging / name
        if not path.exists():
            continue
        if path.is_symlink() or not path.is_dir():
            raise EvidenceError(f"transient staging path is not a real directory: {path}")
        shutil.rmtree(path)


def _freeze_permissions(root: Path) -> None:
    for path in sorted(root.rglob("*"), reverse=True):
        path.chmod(0o500 if path.is_dir() else 0o400)
    root.chmod(0o500)


def _finalize(*, repo_root: Path, evidence_root: Path, staging: Path, code_sha: str, run_id: str, schema: Path) -> Path:
    root = _validate_root(repo_root, evidence_root)
    staging = staging.expanduser().resolve(strict=True)
    expected_staging = root / f".stage09-{code_sha}-{run_id}"
    if staging != expected_staging or not staging.is_dir():
        raise EvidenceError("staging path does not match the exclusive Stage-09 identity")
    _discard_transient_staging(staging)
    _reject_symlinks(staging)
    _require_payload(staging)
    payload = _validate_schema(staging / "evidence.json", schema.resolve(strict=True))
    recovery = _load_json(staging / "process/recovery.json")
    for label, document in (("evidence", payload), ("recovery", recovery)):
        if document.get("code_sha") != code_sha:
            raise EvidenceError(f"{label} payload contains a mixed code SHA")
    if payload.get("run_id") != run_id:
        raise EvidenceError("evidence payload contains a mixed run ID")
    paths = _payload_files(staging)
    _scan_secrets(paths)
    manifest = {
        "schema_version": 1,
        "stage": 9,
        "code_sha": code_sha,
        "run_id": run_id,
        "files": {
            path.relative_to(staging).as_posix(): {"sha256": _sha256(path), "size": path.stat().st_size}
            for path in paths
        },
    }
    manifest_path = staging / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (staging / "manifest.sha256").write_text(f"{_sha256(manifest_path)}  manifest.json\n", encoding="ascii")
    destination = root / "stage-09" / code_sha / run_id
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if destination.exists():
        raise EvidenceError(f"refusing to overwrite existing bundle: {destination}")
    _fsync_tree(staging)
    _exclusive_atomic_rename(staging, destination)
    parent_descriptor = os.open(destination.parent, os.O_RDONLY)
    try:
        os.fsync(parent_descriptor)
    finally:
        os.close(parent_descriptor)
    _freeze_permissions(destination)
    _fsync_tree(destination)
    return destination


def _verify(bundle: Path) -> Path:
    bundle = bundle.expanduser().resolve(strict=True)
    _reject_symlinks(bundle)
    manifest_path = bundle / "manifest.json"
    digest_line = (bundle / "manifest.sha256").read_text(encoding="ascii").strip()
    expected_digest = digest_line.split()[0] if digest_line else ""
    if expected_digest != _sha256(manifest_path):
        raise EvidenceError("manifest.sha256 does not match manifest.json")
    manifest = _load_json(manifest_path)
    for relative, record in manifest.get("files", {}).items():
        path = (bundle / relative).resolve(strict=True)
        if not path.is_relative_to(bundle) or _sha256(path) != record.get("sha256"):
            raise EvidenceError(f"payload hash mismatch: {relative}")
    actual = {
        path.relative_to(bundle).as_posix()
        for path in bundle.rglob("*")
        if path.is_file() and path.name not in {"manifest.json", "manifest.sha256"}
    }
    if actual != set(manifest.get("files", {})):
        raise EvidenceError("bundle payload set does not match manifest")
    _scan_secrets(_payload_files(bundle))
    return bundle


def _load_sealer():
    spec = importlib.util.spec_from_file_location("stage09_finalizer_sealer", SEAL_MODULE)
    if spec is None or spec.loader is None:
        raise EvidenceError("unable to load the generic APFS sealer")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _verify_final_seal(bundle: Path, receipt_directory: Path) -> dict[str, Any]:
    bundle = _verify(bundle)
    receipt_directory = receipt_directory.expanduser().resolve(strict=True)
    receipt = _load_json(receipt_directory / "receipt.json")
    recorded_bundle = receipt.get("paths", {}).get("final_bundle")
    if (
        not isinstance(recorded_bundle, str)
        or Path(recorded_bundle) != bundle
        or Path(recorded_bundle).resolve(strict=True) != bundle
    ):
        raise EvidenceError("receipt is not bound to the verified bundle")
    if receipt.get("status") != "PASS":
        raise EvidenceError("receipt does not carry the sealed-bundle PASS precondition")
    try:
        from jsonschema import Draft202012Validator
    except ImportError as exc:
        raise EvidenceError("jsonschema is required to validate the seal receipt") from exc
    errors = sorted(
        Draft202012Validator(_load_json(RECEIPT_SCHEMA)).iter_errors(receipt),
        key=lambda error: list(error.path),
    )
    if errors:
        detail = "; ".join(error.message for error in errors[:10])
        raise EvidenceError(f"seal receipt does not match the committed schema: {detail}")
    sealer = _load_sealer()
    try:
        recorded_digests = receipt["digests"]
        expected_bytes = {
            "root_sha256": recorded_digests["byte_inventory_root_sha256"],
            "xattr_root_sha256": recorded_digests["xattr_inventory_root_sha256"],
        }
        if (
            hashlib.sha256((bundle / "manifest.json").read_bytes()).hexdigest()
            != recorded_digests["source_manifest_sha256"]
        ):
            raise EvidenceError("receipt source manifest digest does not match the verified bundle")
        recursive = sealer.verify_recursive_seal(bundle, expected_bytes=expected_bytes)
        probes = sealer.run_negative_mutation_probes(bundle, baseline=expected_bytes)
        receipt_protection = sealer.verify_receipt_self_protection(receipt_directory)
    except sealer.SealError as exc:
        raise EvidenceError(f"recursive seal verification failed: {exc}") from exc
    return {
        "status": "pass",
        "terminal": "STAGE09_FINALIZATION=PASS",
        "bundle": str(bundle),
        "receipt_directory": str(receipt_directory),
        "recursive": recursive,
        "negative_probes": probes,
        "receipt_protection": receipt_protection,
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate-root")
    validate.add_argument("--repo-root", type=Path, required=True)
    validate.add_argument("--evidence-root", type=Path, required=True)
    create = commands.add_parser("create-staging")
    create.add_argument("--evidence-root", type=Path, required=True)
    create.add_argument("--code-sha", required=True)
    create.add_argument("--run-id", required=True)
    finalize = commands.add_parser("finalize")
    finalize.add_argument("--repo-root", type=Path, required=True)
    finalize.add_argument("--evidence-root", type=Path, required=True)
    finalize.add_argument("--staging", type=Path, required=True)
    finalize.add_argument("--code-sha", required=True)
    finalize.add_argument("--run-id", required=True)
    finalize.add_argument("--schema", type=Path, required=True)
    verify = commands.add_parser("verify")
    verify.add_argument("--bundle", type=Path, required=True)
    verify.add_argument("--receipt-directory", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    try:
        args = _parser().parse_args(argv)
        if args.command == "validate-root":
            print(_validate_root(args.repo_root, args.evidence_root))
        elif args.command == "create-staging":
            root = _validate_root(REPO_ROOT, args.evidence_root)
            print(_create_staging(root, args.code_sha, args.run_id))
        elif args.command == "finalize":
            print(
                _finalize(
                    repo_root=args.repo_root,
                    evidence_root=args.evidence_root,
                    staging=args.staging,
                    code_sha=args.code_sha,
                    run_id=args.run_id,
                    schema=args.schema,
                )
            )
        elif args.receipt_directory is None:
            bundle = _verify(args.bundle)
            print(
                json.dumps(
                    {
                        "status": "payload-valid-nonfinal",
                        "transition": "no-go",
                        "bundle": str(bundle),
                        "reason": "recursive APFS seal and protected receipt were not supplied",
                    }
                )
            )
        else:
            print(json.dumps(_verify_final_seal(args.bundle, args.receipt_directory), sort_keys=True))
    except (EvidenceError, OSError, json.JSONDecodeError, shutil.Error) as exc:
        print(f"stage09 evidence finalizer failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
