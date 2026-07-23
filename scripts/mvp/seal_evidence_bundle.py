#!/usr/bin/env python3
# ruff: noqa: BLE001, EM101, EM102, PTH101, PTH104, PTH108, S603, TRY003, TRY004
"""Seal a validated Stage 10 evidence bundle with APFS user-immutable flags."""

from __future__ import annotations

import argparse
import contextlib
import errno
import json
import os
import plistlib
import re
import stat
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_evidence_bundle import _inventory, _load_json, _scan_secrets, _sha256

UF_IMMUTABLE = getattr(stat, "UF_IMMUTABLE", 0x00000002)


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _write_json_exclusive(path: Path, payload: object) -> None:
    descriptor = -1
    created = False
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        created = True
        with os.fdopen(descriptor, "w", encoding="utf-8", closefd=False) as stream:
            json.dump(payload, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        parent_descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(parent_descriptor)
        finally:
            os.close(parent_descriptor)
    except Exception:
        if created:
            with contextlib.suppress(OSError):
                path.unlink()
        raise
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def _disk_identity(path: Path, *, require_apfs: bool) -> dict[str, str]:
    try:
        result = subprocess.run(
            ["/usr/sbin/diskutil", "info", "-plist", str(path)],
            check=True,
            capture_output=True,
            timeout=10,
        )
        info = plistlib.loads(result.stdout)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired, plistlib.InvalidFileException) as exc:
        if require_apfs:
            raise ValueError("diskutil APFS identity is unavailable") from exc
        return {"filesystem": "test", "volume_uuid": f"device-{path.stat().st_dev}"}
    filesystem = str(info.get("FilesystemType") or info.get("Type (Bundle)") or "").lower()
    volume_uuid = str(info.get("VolumeUUID") or info.get("APFSVolumeUUID") or "")
    if require_apfs and ("apfs" not in filesystem or not volume_uuid):
        raise ValueError("bundle must be on an APFS volume with a UUID")
    return {"filesystem": filesystem or "unknown", "volume_uuid": volume_uuid or f"device-{path.stat().st_dev}"}


def _read_detached_checksum(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        raise ValueError("manifest checksum must be a regular file")
    value = path.read_text(encoding="ascii").strip()
    match = re.fullmatch(r"([0-9a-f]{64})[ \t]+(?:\*|)manifest\.json", value)
    if not match:
        raise ValueError("manifest checksum file has an invalid format")
    return match.group(1)


def _verify_manifest_inventory(bundle: Path, manifest: dict[str, Any]) -> None:
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
        raise ValueError("manifest inventory differs from final bundle")
    for relative, path in actual.items():
        row = rows[relative]
        if row.get("sha256") != _sha256(path) or row.get("size_bytes") != path.stat().st_size:
            raise ValueError(f"manifest hash/size mismatch: {relative}")


def preflight(
    *,
    bundle: Path,
    control: str,
    manifest_sha_file: Path,
    external_receipt: Path,
    require_apfs: bool = True,
) -> dict[str, Any]:
    if control != "apfs-uchg":
        raise ValueError("control must be exactly apfs-uchg")
    if not bundle.is_absolute() or bundle.is_symlink():
        raise ValueError("bundle must be an absolute real directory")
    bundle = bundle.resolve(strict=True)
    if not bundle.is_dir():
        raise ValueError("bundle is not a directory")
    if external_receipt.parent.resolve(strict=True) != bundle.parent:
        raise ValueError("seal receipt must be a sibling of the bundle")
    if external_receipt.exists() or external_receipt.is_symlink():
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
    return {
        "bundle": bundle,
        "manifest": manifest,
        "manifest_sha256": actual,
        **_disk_identity(bundle, require_apfs=require_apfs),
    }


def _run_chflags(path: Path) -> None:
    subprocess.run(["/usr/bin/chflags", "uchg", str(path)], check=True, capture_output=True)


def _is_immutable(path: Path) -> bool:
    return bool(path.stat().st_flags & UF_IMMUTABLE)


def _seal_paths(bundle: Path) -> None:
    files = _inventory(bundle)
    directories = sorted(
        (path for path in bundle.rglob("*") if path.is_dir()),
        key=lambda path: len(path.parts),
        reverse=True,
    )
    for path in files:
        os.chmod(path, 0o400)
        _run_chflags(path)
    for path in directories:
        os.chmod(path, 0o500)
        _run_chflags(path)
    os.chmod(bundle, 0o500)
    _run_chflags(bundle)
    for path in [*files, *directories, bundle]:
        if not _is_immutable(path):
            raise RuntimeError(f"uchg verification failed: {path}")


def _must_fail(name: str, operation: Any) -> dict[str, Any]:
    try:
        operation()
    except OSError as exc:
        return {
            "name": name,
            "verdict": "PASS",
            "errno": exc.errno,
            "error": errno.errorcode.get(exc.errno or 0, "UNKNOWN"),
        }
    raise RuntimeError(f"sealed mutation unexpectedly succeeded: {name}")


def _negative_probes(bundle: Path) -> list[dict[str, Any]]:
    target = bundle / "seal-probe.txt"
    probe = bundle / ".stage10-seal-create-probe"
    renamed = bundle / ".stage10-seal-rename-probe"
    return [
        _must_fail("create", lambda: os.open(probe, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)),
        _must_fail("write", lambda: os.open(target, os.O_WRONLY | os.O_APPEND)),
        _must_fail("rename", lambda: os.rename(target, renamed)),
        _must_fail("unlink", lambda: os.unlink(target)),
        _must_fail("mtime", lambda: os.utime(target, None)),
    ]


def seal(
    *,
    bundle: Path,
    control: str,
    manifest_sha_file: Path,
    owner: str,
    retention_policy: str,
    verify_final_no_secrets: bool,
    external_receipt: Path,
) -> dict[str, Any]:
    if not owner or not retention_policy:
        raise ValueError("owner and retention policy are required")
    state = preflight(
        bundle=bundle,
        control=control,
        manifest_sha_file=manifest_sha_file,
        external_receipt=external_receipt,
    )
    bundle = state["bundle"]
    if verify_final_no_secrets:
        matches = _scan_secrets(_inventory(bundle))
        if matches:
            raise ValueError("final no-secret verification failed")
    manifest = state["manifest"]
    if manifest.get("owner") != owner or manifest.get("retention_policy") != retention_policy:
        raise ValueError("seal owner/retention differs from manifest")
    if manifest.get("volume_uuid") != state["volume_uuid"]:
        raise ValueError("manifest volume UUID differs from storage identity")

    _seal_paths(bundle)
    probes = _negative_probes(bundle)
    if _sha256(bundle / "manifest.json") != state["manifest_sha256"]:
        raise RuntimeError("manifest changed during seal")
    receipt = {
        "schema": "ketos.stage10.seal-receipt.v1",
        "s10_code_sha": manifest["s10_code_sha"],
        "canonical_bundle": str(bundle),
        "manifest_sha256": state["manifest_sha256"],
        "owner": owner,
        "retention_policy": retention_policy,
        "retention_class": "indefinite",
        "control": "apfs-uchg",
        "filesystem": state["filesystem"],
        "volume_uuid": state["volume_uuid"],
        "final_no_secret_verdict": "PASS",
        "mutation_probes": probes,
        "bundle_unchanged": True,
        "sealed_at": _now(),
        "verdict": "PASS",
    }
    _write_json_exclusive(external_receipt, receipt)
    os.chmod(external_receipt, 0o400)
    _run_chflags(external_receipt)
    if not _is_immutable(external_receipt):
        raise RuntimeError("seal receipt is not immutable")
    return receipt


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--control", required=True)
    parser.add_argument("--manifest-sha-file", type=Path, required=True)
    parser.add_argument("--owner", required=True)
    parser.add_argument("--retention-policy", required=True)
    parser.add_argument("--verify-final-no-secrets", action="store_true")
    parser.add_argument("--external-receipt", type=Path, required=True)
    return parser


def main() -> int:
    args = _parser().parse_args()
    receipt = seal(
        bundle=args.bundle,
        control=args.control,
        manifest_sha_file=args.manifest_sha_file,
        owner=args.owner,
        retention_policy=args.retention_policy,
        verify_final_no_secrets=args.verify_final_no_secrets,
        external_receipt=args.external_receipt,
    )
    print(json.dumps({"verdict": receipt["verdict"], "control": receipt["control"]}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"seal failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise SystemExit(1) from None
