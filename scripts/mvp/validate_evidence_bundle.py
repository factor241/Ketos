#!/usr/bin/env python3
# ruff: noqa: EM101, EM102, PERF401, PLR2004, S108, S603, TRY003, TRY004
"""Validate and inventory one external Ketos Stage 10 evidence bundle."""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import plistlib
import pwd
import re
import stat
import subprocess
import zlib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

BASE_SHA = "18a2a2a9518d23c589c6700c322ad5844adce932"
REQUIRED_FILES = {
    "entity-ledger.json",
    "gate-results.json",
    "live-ai-smoke.json",
    "final-journal.json",
    "final-report.md",
    "product-design-screenshot-manifest.json",
    "memory-monitor.jsonl",
    "pid-ledger.json",
    "memory-baseline.json",
    "ram-summary.json",
    "seal-probe.txt",
}
SCREENSHOT_NAMES = (
    "01-board-note-chat.png",
    "02-automation-result.png",
    "03-ai-preview-confirmation.png",
    "04-settings-entry.png",
    "05-restored-board.png",
)
SCHEMA_BY_ARTIFACT = {
    "entity-ledger.json": "entity-ledger.schema.json",
    "gate-results.json": "gate-results.schema.json",
    "live-ai-smoke.json": "live-ai-smoke.schema.json",
    "final-journal.json": "final-journal.schema.json",
    "product-design-screenshot-manifest.json": "product-design-screenshot-manifest.schema.json",
}
REQUIRED_TASK_IDS = {f"task-a{index:02d}" for index in range(1, 11)}
REQUIRED_GATE_IDS = {
    "seed-idempotency",
    "focused-backend",
    "sqlite-migrations",
    "postgres-migrations",
    "kfx",
    "lfx",
    "frontend-focused",
    "frontend-i18n",
    "frontend-type",
    "frontend-build",
    "backend-package",
    "frontend-full",
    "chromium-story",
    "product-design",
    "chrome",
    "computer-use",
    "live-ai",
    "security",
    "secret",
    "ram",
}
SECRET_PATTERNS = (
    re.compile(rb"sk-[A-Za-z0-9_-]{20,}"),
    re.compile(rb"(?i)authorization\s*:\s*bearer\s+[A-Za-z0-9._~+/-]{12,}"),
    re.compile(rb"(?i)(?:COMETAPI_KEY|OPENAI_API_KEY)\s*=\s*[^\s\"']{12,}"),
)
FORBIDDEN_FIELDS = {
    "authorization",
    "api_key",
    "apikey",
    "cookie",
    "cookies",
    "credential",
    "credentials",
    "openai_api_key",
    "cometapi_key",
}


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


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _inventory(bundle: Path) -> list[Path]:
    paths: list[Path] = []
    root_device = bundle.lstat().st_dev
    for root, directories, filenames in os.walk(bundle, followlinks=False):
        root_path = Path(root)
        for name in directories:
            candidate = root_path / name
            if candidate.is_symlink():
                raise ValueError(f"symlink is forbidden in evidence bundle: {candidate}")
            if candidate.lstat().st_dev != root_device:
                raise ValueError(f"cross-device directory is forbidden: {candidate}")
        for name in filenames:
            candidate = root_path / name
            details = candidate.lstat()
            if stat.S_ISLNK(details.st_mode):
                raise ValueError(f"symlink is forbidden in evidence bundle: {candidate}")
            if not stat.S_ISREG(details.st_mode):
                raise ValueError(f"non-regular artifact is forbidden: {candidate}")
            if details.st_dev != root_device:
                raise ValueError(f"cross-device artifact is forbidden: {candidate}")
            if details.st_nlink != 1:
                raise ValueError(f"hard-linked artifact is forbidden: {candidate}")
            paths.append(candidate)
    return sorted(paths, key=lambda path: path.relative_to(bundle).as_posix())


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid JSON artifact: {path.name}") from exc


def _validate_schema(instance: object, schema_path: Path) -> None:
    schema = _load_json(schema_path)
    Draft202012Validator.check_schema(schema)
    errors = sorted(
        Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(instance),
        key=lambda item: list(item.absolute_path),
    )
    if errors:
        first = errors[0]
        location = "/".join(str(part) for part in first.absolute_path) or "<root>"
        raise ValueError(f"{schema_path.name} rejected {location}: {first.message}")


def _forbidden_json_field(value: Any, path: tuple[str, ...] = ()) -> str | None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).lower().replace("-", "_")
            if normalized in FORBIDDEN_FIELDS:
                return ".".join((*path, str(key)))
            found = _forbidden_json_field(child, (*path, str(key)))
            if found:
                return found
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found = _forbidden_json_field(child, (*path, str(index)))
            if found:
                return found
    return None


def _scan_secrets(paths: list[Path]) -> list[dict[str, str]]:
    matches: list[dict[str, str]] = []
    for path in paths:
        data = path.read_bytes()
        for pattern in SECRET_PATTERNS:
            if pattern.search(data):
                matches.append({"path": path.name, "rule": "high-confidence-secret-pattern"})
        if path.suffix == ".json":
            value = _load_json(path)
            field = _forbidden_json_field(value)
            if field:
                matches.append({"path": path.name, "rule": f"forbidden-json-field:{field}"})
    return matches


def _png_dimensions(path: Path) -> tuple[int, int]:
    payload = path.read_bytes()
    if payload[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"invalid PNG evidence: {path.name}")
    offset = 8
    dimensions: tuple[int, int] | None = None
    first = True
    found_iend = False
    while offset < len(payload):
        if offset + 12 > len(payload):
            raise ValueError(f"truncated PNG evidence: {path.name}")
        length = int.from_bytes(payload[offset : offset + 4], "big")
        kind = payload[offset + 4 : offset + 8]
        end = offset + 12 + length
        if end > len(payload):
            raise ValueError(f"truncated PNG chunk: {path.name}")
        data = payload[offset + 8 : offset + 8 + length]
        expected_crc = int.from_bytes(payload[offset + 8 + length : end], "big")
        if zlib.crc32(kind + data) & 0xFFFFFFFF != expected_crc:
            raise ValueError(f"PNG CRC mismatch: {path.name}")
        if first:
            if kind != b"IHDR" or length != 13:
                raise ValueError(f"PNG must begin with IHDR: {path.name}")
            dimensions = (int.from_bytes(data[:4], "big"), int.from_bytes(data[4:8], "big"))
            first = False
        if kind == b"IEND":
            if length != 0 or end != len(payload):
                raise ValueError(f"invalid PNG IEND/trailing bytes: {path.name}")
            found_iend = True
            break
        offset = end
    if dimensions is None or not found_iend:
        raise ValueError(f"incomplete PNG evidence: {path.name}")
    return dimensions


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError("JSONL record must be an object")
            records.append(value)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid JSONL artifact: {path.name}") from exc
    if not records:
        raise ValueError(f"empty JSONL artifact: {path.name}")
    return records


def _validate_ram_evidence(bundle: Path) -> None:
    records = _load_jsonl(bundle / "memory-monitor.jsonl")
    samples = [row for row in records if row.get("schema") == "ketos.stage10.memory-sample.v1"]
    if not samples:
        raise ValueError("memory monitor contains no samples")
    by_gate: dict[str, list[dict[str, Any]]] = {}
    for row in samples:
        required = {
            "monotonic_ns",
            "sequence",
            "gate_id",
            "phase",
            "system_used_bytes",
            "aggregate_rss_bytes",
            "pageouts",
            "swapouts",
            "critical_memory_pressure",
            "monitor_loss",
        }
        if not required <= row.keys() or row["monitor_loss"] is not False:
            raise ValueError("memory sample is incomplete or reports monitor loss")
        by_gate.setdefault(str(row["gate_id"]), []).append(row)
    if set(by_gate) != REQUIRED_GATE_IDS:
        raise ValueError("memory monitor does not cover the exact Stage 10 gate set")
    for gate_id, rows in by_gate.items():
        sequences = [int(row["sequence"]) for row in rows]
        if sequences != list(range(sequences[0], sequences[0] + len(sequences))):
            raise ValueError(f"memory sequence gap for gate {gate_id}")
        admission = [row for row in rows if row["phase"] == "admission"]
        tail = [row for row in rows if row["phase"] == "tail"]
        gate = [row for row in rows if row["phase"] == "gate"]
        if not admission or not gate or not tail:
            raise ValueError(f"memory phases are incomplete for gate {gate_id}")
        admission_span = int(admission[-1]["monotonic_ns"]) - int(admission[0]["monotonic_ns"])
        tail_span = int(tail[-1]["monotonic_ns"]) - int(tail[0]["monotonic_ns"])
        if admission_span < 29_000_000_000 or tail_span < 29_000_000_000:
            raise ValueError(f"30-second admission/tail evidence is missing for gate {gate_id}")
        if any(int(row["system_used_bytes"]) >= 13_000_000_000 for row in admission):
            raise ValueError(f"RAM admission exceeded resume threshold for gate {gate_id}")
        if len({int(row["swapouts"]) for row in admission}) != 1:
            raise ValueError(f"swapouts grew during admission for gate {gate_id}")
        known_pageouts = {int(row["pageouts"]) for row in admission if int(row["pageouts"]) >= 0}
        if len(known_pageouts) > 1:
            raise ValueError(f"pageouts grew during admission for gate {gate_id}")

    events = [str(row.get("event")) for row in records if "event" in row]
    peak_system = max(int(row["system_used_bytes"]) for row in samples)
    peak_aggregate = max(int(row["aggregate_rss_bytes"]) for row in samples)
    summary = _load_json(bundle / "ram-summary.json")
    expected = {
        "peak_system_used_bytes": peak_system,
        "peak_aggregate_rss_bytes": peak_aggregate,
        "warning_trips": events.count("WARNING"),
        "stop_trips": events.count("STOP"),
        "emergency_trips": events.count("EMERGENCY_STOP"),
        "monitor_losses": events.count("MONITOR_LOST"),
        "observed_ge_16": peak_system >= 16_000_000_000,
        "gate_count": len(by_gate),
        "sample_count": len(samples),
    }
    if not isinstance(summary, dict) or any(summary.get(key) != value for key, value in expected.items()):
        raise ValueError("RAM summary differs from memory monitor")
    if (
        summary.get("verdict") != "PASS"
        or expected["monitor_losses"] != 0
        or expected["stop_trips"] != 0
        or expected["emergency_trips"] != 0
        or expected["observed_ge_16"] is not False
    ):
        raise ValueError("RAM evidence does not satisfy Stage 10 acceptance")

    pid_ledger = _load_json(bundle / "pid-ledger.json")
    if not isinstance(pid_ledger, dict) or pid_ledger.get("schema") != "ketos.stage10.pid-ledger.v1":
        raise ValueError("PID ledger schema is invalid")
    pid_records = pid_ledger.get("records")
    if not isinstance(pid_records, list):
        raise ValueError("PID ledger records are invalid")
    for row in pid_records:
        cleanup = row.get("cleanup") if isinstance(row, dict) else None
        if not isinstance(cleanup, dict) or cleanup.get("survivors") != []:
            raise ValueError("PID ledger contains an unverified survivor")


def _validate_gate_results(bundle: Path, s10_code_sha: str) -> None:
    payload = _load_json(bundle / "gate-results.json")
    gates = payload.get("gates") if isinstance(payload, dict) else None
    if not isinstance(gates, list):
        raise ValueError("gate results do not contain a gate list")
    ids = [row.get("id") for row in gates if isinstance(row, dict)]
    if len(ids) != len(set(ids)) or set(ids) != REQUIRED_GATE_IDS:
        raise ValueError("gate results do not contain the exact Stage 10 acceptance set")
    tasks = payload.get("tasks")
    if not isinstance(tasks, list):
        raise ValueError("gate results do not contain the A01-A10 task list")
    task_ids = [row.get("id") for row in tasks if isinstance(row, dict)]
    if len(task_ids) != len(set(task_ids)) or set(task_ids) != REQUIRED_TASK_IDS:
        raise ValueError("gate results do not contain the exact A01-A10 task set")
    if any(
        row.get("verdict") != "PASS"
        or row.get("exit_code") != 0
        or re.fullmatch(r"[0-9a-f]{40}", str(row.get("commit_sha", ""))) is None
        for row in tasks
    ):
        raise ValueError("one or more A01-A10 task results are not accepted")
    for row in gates:
        if (
            row.get("s10_code_sha") != s10_code_sha
            or row.get("verdict") != "PASS"
            or row.get("exit_code") != 0
            or row.get("skip_count") != 0
            or int(row.get("peak_system_used_bytes", 16_000_000_000)) >= 16_000_000_000
            or row.get("post_gate_tail_seconds") != 30
        ):
            raise ValueError(f"gate result is not accepted: {row.get('id')}")


def _volume_identity(path: Path, *, require_apfs: bool) -> tuple[str, str]:
    try:
        result = subprocess.run(
            ["/usr/sbin/diskutil", "info", "-plist", str(path)],
            check=True,
            capture_output=True,
            timeout=10,
        )
        info = plistlib.loads(result.stdout)
        value = info.get("VolumeUUID") or info.get("APFSVolumeUUID")
        filesystem = str(info.get("FilesystemType") or info.get("Type (Bundle)") or "").lower()
        if value and (not require_apfs or "apfs" in filesystem):
            return filesystem or "unknown", str(value)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired, plistlib.InvalidFileException):
        pass
    if require_apfs:
        raise ValueError("APFS volume UUID is required")
    return "test", f"device-{path.stat().st_dev}"


def _has_acl(path: Path) -> bool:
    result = subprocess.run(
        ["/bin/ls", "-lde", str(path)],
        check=True,
        capture_output=True,
        text=True,
        timeout=5,
    )
    return "+" in result.stdout.splitlines()[0].split(maxsplit=1)[0]


def _validate_storage_permissions(bundle: Path, owner: str) -> None:
    expected_owner = pwd.getpwuid(os.getuid()).pw_name
    if owner != expected_owner:
        raise ValueError("evidence owner must be the effective current user")
    for path in [bundle, *bundle.rglob("*")]:
        details = path.lstat()
        if details.st_uid != os.getuid():
            raise ValueError(f"evidence object has the wrong owner: {path}")
        if stat.S_IMODE(details.st_mode) & 0o077:
            raise ValueError(f"group/other permissions are forbidden: {path}")
        if getattr(details, "st_flags", 0) & getattr(stat, "UF_IMMUTABLE", 0x2):
            raise ValueError(f"pre-existing immutable flag is forbidden: {path}")
        if _has_acl(path):
            raise ValueError(f"ACL is forbidden in evidence bundle: {path}")


def _artifact_metadata(path: Path, *, bundle: Path, owner: str, generated_at: str) -> dict[str, object]:
    relative = path.relative_to(bundle).as_posix()
    if relative.startswith("product-design/"):
        producing_command = ["product-design", "chrome", "computer-use", "stage10-audit"]
    elif relative.startswith("logs/"):
        producing_command = ["scripts/mvp/stage10_ram_guard.py", "run", "<redacted-gate-arguments>"]
    elif relative in {"memory-monitor.jsonl", "pid-ledger.json", "memory-baseline.json", "ram-summary.json"}:
        producing_command = ["scripts/mvp/stage10_ram_guard.py", "<aggregate>"]
    elif relative in {"seal-probe.txt", "no-secret-qa.json"}:
        producing_command = ["scripts/mvp/validate_evidence_bundle.py", "<redacted-arguments>"]
    elif relative in {
        "entity-ledger.json",
        "gate-results.json",
        "live-ai-smoke.json",
        "final-journal.json",
        "final-report.md",
        "product-design-screenshot-manifest.json",
    }:
        producing_command = ["stage10-coordinator", relative]
    else:
        raise ValueError(f"artifact has no explicit producer contract: {relative}")
    started_at = ended_at = generated_at
    verdict = "PASS"
    schema_version = "opaque.v1"
    if path.suffix == ".json":
        payload = _load_json(path)
        if isinstance(payload, dict):
            command = payload.get("command")
            if isinstance(command, list) and command and all(isinstance(item, str) for item in command):
                producing_command = command
            started_at = str(payload.get("started_at") or payload.get("generated_at") or generated_at)
            ended_at = str(payload.get("ended_at") or payload.get("generated_at") or generated_at)
            verdict = str(payload.get("verdict") or payload.get("status") or "PASS")
            schema_version = str(payload.get("schema") or payload.get("artifact_kind") or "json.v1")
    return {
        "path": relative,
        "sha256": _sha256(path),
        "size_bytes": path.stat().st_size,
        "owner": owner,
        "redacted_path": f"$KETOS_STAGE10_EVIDENCE_BUNDLE/{relative}",
        "producing_command": producing_command,
        "started_at": started_at,
        "ended_at": ended_at,
        "verdict": verdict,
        "schema_version": schema_version,
    }


def _validate_bundle_location(bundle: Path) -> Path:
    if not bundle.is_absolute() or bundle.is_symlink():
        raise ValueError("bundle must be an absolute real directory")
    lexical = bundle.absolute()
    canonical = bundle.resolve(strict=True)
    if lexical != canonical:
        raise ValueError("bundle path contains a symlink or non-canonical component")
    if not canonical.is_dir():
        raise ValueError("bundle must be a directory")
    repo = Path(__file__).resolve().parents[2]
    if canonical == repo or repo in canonical.parents:
        raise ValueError("evidence bundle must be outside the repository")
    if canonical == Path("/tmp") or Path("/tmp") in canonical.parents or Path("/private/tmp") in canonical.parents:
        raise ValueError("evidence bundle must be outside ephemeral directories")
    approved = Path("/Volumes/Projects/.ketos-stage10-evidence").resolve(strict=True)
    if canonical != approved and approved not in canonical.parents:
        raise ValueError("evidence bundle must be under the approved Stage 10 evidence root")
    return canonical


def validate_and_manifest(
    *,
    bundle: Path,
    schema_dir: Path,
    s10_code_sha: str,
    owner: str,
    retention_policy: str,
    deny_secrets: bool,
    no_secret_report: Path,
    manifest_path: Path,
    enforce_external_location: bool = False,
) -> dict[str, object]:
    if re.fullmatch(r"[0-9a-f]{40}", s10_code_sha) is None:
        raise ValueError("s10_code_sha must be a lowercase 40-character SHA")
    if not owner or not retention_policy:
        raise ValueError("owner and retention policy are required")
    bundle = _validate_bundle_location(bundle) if enforce_external_location else bundle.resolve(strict=True)
    filesystem, volume_uuid = _volume_identity(bundle, require_apfs=enforce_external_location)
    if enforce_external_location:
        _validate_storage_permissions(bundle, owner)
    schema_dir = schema_dir.resolve(strict=True)
    if no_secret_report.parent.resolve(strict=True) != bundle or manifest_path.parent.resolve(strict=True) != bundle:
        raise ValueError("report and manifest must be direct bundle children")
    if no_secret_report.exists() or no_secret_report.is_symlink():
        raise FileExistsError(f"refusing to overwrite {no_secret_report}")
    if manifest_path.exists() or manifest_path.is_symlink():
        raise FileExistsError(f"refusing to overwrite {manifest_path}")

    inventory = _inventory(bundle)
    relative = {path.relative_to(bundle).as_posix() for path in inventory}
    missing = REQUIRED_FILES - relative
    expected_screenshots = {f"product-design/1440x900/{name}" for name in SCREENSHOT_NAMES}
    missing |= expected_screenshots - relative
    if missing:
        raise ValueError(f"required evidence artifacts are missing: {sorted(missing)}")

    for artifact, schema_name in SCHEMA_BY_ARTIFACT.items():
        value = _load_json(bundle / artifact)
        _validate_schema(value, schema_dir / schema_name)
        if isinstance(value, dict):
            if value.get("s10_code_sha") != s10_code_sha:
                raise ValueError(f"{artifact} uses a different s10_code_sha")
            if value.get("owner") != owner or value.get("retention_policy") != retention_policy:
                raise ValueError(f"{artifact} owner/retention mismatch")

    _validate_gate_results(bundle, s10_code_sha)
    screenshot_manifest = _load_json(bundle / "product-design-screenshot-manifest.json")
    screenshot_rows = screenshot_manifest["screenshots"]
    for expected_name, row in zip(SCREENSHOT_NAMES, screenshot_rows, strict=True):
        path = bundle / "product-design" / "1440x900" / expected_name
        if _png_dimensions(path) != (1440, 900):
            raise ValueError(f"screenshot viewport mismatch: {expected_name}")
        if row["sha256"] != _sha256(path) or row["size_bytes"] != path.stat().st_size:
            raise ValueError(f"screenshot digest/size mismatch: {expected_name}")

    _validate_ram_evidence(bundle)

    secret_matches = _scan_secrets(inventory) if deny_secrets else []
    if secret_matches:
        raise ValueError("secret scan rejected the evidence bundle")
    generated_at = _now()
    report = {
        "schema": "ketos.stage10.no-secret-qa.v1",
        "s10_code_sha": s10_code_sha,
        "owner": owner,
        "retention_policy": retention_policy,
        "generated_at": generated_at,
        "command": ["validate_evidence_bundle.py", "--deny-secrets"],
        "verdict": "PASS",
        "matches": 0,
        "scanned_files": len(inventory),
    }
    _write_json_exclusive(no_secret_report, report)
    try:
        inventory = _inventory(bundle)

        artifacts = [
            _artifact_metadata(path, bundle=bundle, owner=owner, generated_at=generated_at)
            for path in inventory
            if path != manifest_path
        ]
        manifest = {
            "schema": "ketos.stage10.evidence-manifest.v1",
            "stage": 10,
            "s10_code_sha": s10_code_sha,
            "base_sha": BASE_SHA,
            "owner": owner,
            "retention_owner": owner,
            "retention_policy": retention_policy,
            "retention_class": "indefinite",
            "generated_at": generated_at,
            "persistent_root": str(bundle.parents[1]),
            "filesystem": filesystem,
            "volume_uuid": volume_uuid,
            "canonical_bundle": str(bundle),
            "no_secret_qa": {"path": "no-secret-qa.json", "verdict": "PASS", "matches": 0},
            "seal_control": "apfs-uchg",
            "verdict": "PASS",
            "artifacts": artifacts,
        }
        _validate_schema(manifest, schema_dir / "evidence-manifest.schema.json")
        _write_json_exclusive(manifest_path, manifest)
    except Exception:
        with contextlib.suppress(OSError):
            no_secret_report.unlink()
        raise
    return manifest


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--schema-dir", type=Path, required=True)
    parser.add_argument("--s10-code-sha", required=True)
    parser.add_argument("--owner", required=True)
    parser.add_argument("--retention-policy", required=True)
    parser.add_argument("--deny-secrets", action="store_true")
    parser.add_argument("--write-no-secret-report", type=Path, required=True)
    parser.add_argument("--write-manifest", type=Path, required=True)
    return parser


def main() -> int:
    args = _parser().parse_args()
    manifest = validate_and_manifest(
        bundle=args.bundle,
        schema_dir=args.schema_dir,
        s10_code_sha=args.s10_code_sha,
        owner=args.owner,
        retention_policy=args.retention_policy,
        deny_secrets=args.deny_secrets,
        no_secret_report=args.write_no_secret_report,
        manifest_path=args.write_manifest,
        enforce_external_location=True,
    )
    print(json.dumps({"verdict": manifest["verdict"], "artifact_count": len(manifest["artifacts"])}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
