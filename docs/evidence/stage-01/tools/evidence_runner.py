#!/usr/bin/env python3
"""Run and verify redacted, content-addressed Stage 01 evidence records.

This module deliberately depends only on the Python standard library.  It is a
small audit boundary: commands are invoked as argv (never a shell), while the
stored record and logs are redacted before they are hashed and written.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import platform
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

ALLOWED_VERDICTS = {"PASS", "FAIL", "BLOCKED", "BASELINE_DEFECT", "INCONCLUSIVE"}
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
UTC_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
SECRET_NAME = r"(?:[A-Za-z0-9]+_)*(?:key|token|password|secret)(?:_[A-Za-z0-9]+)*"
SECRET_ASSIGNMENT = re.compile(rf"(?i)(\b{SECRET_NAME}\b\s*[:=]\s*)([^\s,;'\"()]+)")
SECRET_OPTION = re.compile(rf"(?i)(--?{SECRET_NAME.replace('_', '[-_]')}=)([^\s]+)")
SECRET_KEY = re.compile(rf"(?i)^{SECRET_NAME}$")
RECORD_KEYS = {
    "record_id",
    "task_id",
    "command",
    "cwd",
    "source_baseline_sha",
    "execution_revision",
    "profile",
    "started_at_utc",
    "ended_at_utc",
    "exit_code",
    "verdict",
    "artifacts",
    "created_at_utc",
    "owner",
    "reviewer",
    "notes",
    "classification",
}


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def redact_text(value: str) -> str:
    """Redact conventional secret assignments and command options."""
    value = SECRET_ASSIGNMENT.sub(r"\1[REDACTED]", value)
    return SECRET_OPTION.sub(r"\1[REDACTED]", value)


def canonicalize_log(value: str) -> str:
    """Remove only terminal spaces/tabs from each persisted log line."""
    return re.sub(r"[ \t]+(?=\n|$)", "", value)


def redact_metadata(value: Any, key: str | None = None) -> Any:
    if key and SECRET_KEY.search(key):
        return "[REDACTED]"
    if isinstance(value, dict):
        return {str(item_key): redact_metadata(item_value, str(item_key)) for item_key, item_value in value.items()}
    if isinstance(value, list):
        return [redact_metadata(item) for item in value]
    if isinstance(value, str):
        return redact_text(value)
    return value


def safe_artifact_id(value: str) -> str:
    if not SAFE_ID.fullmatch(value) or ".." in value:
        raise ValueError(f"unsafe artifact id: {value!r}")
    return value


def derive_verdict(exit_code: int, classification: str) -> str:
    if classification == "BLOCKED":
        return "BLOCKED"
    if classification == "BASELINE_DEFECT":
        return "BASELINE_DEFECT"
    if classification.startswith("INCONCLUSIVE"):
        return "INCONCLUSIVE"
    return "PASS" if exit_code == 0 else "FAIL"


def write_record(args: argparse.Namespace) -> Path:
    artifact_id = safe_artifact_id(args.artifact_id)
    if not args.command:
        raise ValueError("a command argv is required after --")
    for field in ("source_baseline_sha", "execution_revision"):
        if not SHA40.fullmatch(getattr(args, field)):
            raise ValueError(f"{field} must be a lowercase 40-hex Git SHA")
    output = Path(args.output).resolve()
    cwd = Path(args.cwd).resolve()
    if not cwd.is_dir():
        raise ValueError(f"cwd is not a directory: {cwd}")
    profile = json.loads(args.profile_json)
    if not isinstance(profile, dict):
        raise ValueError("profile JSON must be an object")

    started = utc_now()
    try:
        completed = subprocess.run(
            args.command,
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
            shell=False,
        )
        exit_code = completed.returncode
        stdout, stderr = completed.stdout, completed.stderr
    except OSError as error:
        exit_code = -127
        stdout, stderr = "", f"runner execution error: {error}\n"
    ended = utc_now()

    artifacts_dir = output / "artifacts"
    records_dir = output / "records"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    records_dir.mkdir(parents=True, exist_ok=True)
    stdout_relative = f"artifacts/{artifact_id}.stdout.log"
    stderr_relative = f"artifacts/{artifact_id}.stderr.log"
    stdout_path, stderr_path = output / stdout_relative, output / stderr_relative
    stdout_path.write_text(canonicalize_log(redact_text(stdout)), encoding="utf-8")
    stderr_path.write_text(canonicalize_log(redact_text(stderr)), encoding="utf-8")

    sanitized_argv = [redact_text(argument) for argument in args.command]
    record = {
        "record_id": artifact_id,
        "task_id": args.task_id,
        "command": {"argv": sanitized_argv, "display": " ".join(sanitized_argv)},
        "cwd": str(cwd),
        "source_baseline_sha": args.source_baseline_sha,
        "execution_revision": args.execution_revision,
        "profile": {
            "environment": {"platform": platform.platform(), "python": platform.python_version()},
            "provided": redact_metadata(profile),
        },
        "started_at_utc": started,
        "ended_at_utc": ended,
        "exit_code": exit_code,
        "verdict": derive_verdict(exit_code, args.classification),
        "artifacts": {
            "stdout": {"path": stdout_relative, "sha256": sha256_file(stdout_path)},
            "stderr": {"path": stderr_relative, "sha256": sha256_file(stderr_path)},
        },
        "created_at_utc": utc_now(),
        "owner": args.owner,
        "reviewer": args.reviewer,
        "notes": redact_text(args.notes),
        "classification": args.classification,
    }
    record_path = records_dir / f"{artifact_id}.json"
    record_path.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return record_path


def is_nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value)


def is_utc_timestamp(value: Any) -> bool:
    if not isinstance(value, str) or not UTC_TIMESTAMP.fullmatch(value):
        return False
    try:
        dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def expected_artifact_path(record_id: str, stream: str) -> str:
    return f"artifacts/{record_id}.{stream}.log"


def validate_record(record_path: Path) -> list[str]:
    errors: list[str] = []
    try:
        record = json.loads(record_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return [f"cannot read record: {error}"]
    if not isinstance(record, dict):
        return ["record must be an object"]
    missing = sorted(RECORD_KEYS - set(record))
    unexpected = sorted(set(record) - RECORD_KEYS)
    if missing or unexpected:
        if missing:
            errors.append(f"missing required fields: {', '.join(missing)}")
        if unexpected:
            errors.append(f"unexpected top-level fields: {', '.join(unexpected)}")
        return errors

    if not isinstance(record["record_id"], str) or not SAFE_ID.fullmatch(record["record_id"]):
        errors.append("invalid record_id")
    for field in ("task_id", "cwd", "owner", "reviewer", "classification"):
        if not is_nonempty_string(record[field]):
            errors.append(f"invalid {field}")
    if not isinstance(record["notes"], str):
        errors.append("invalid notes")
    for field in ("source_baseline_sha", "execution_revision"):
        if not isinstance(record[field], str) or not SHA40.fullmatch(record[field]):
            errors.append(f"invalid {field}")
    for field in ("started_at_utc", "ended_at_utc", "created_at_utc"):
        if not is_utc_timestamp(record[field]):
            errors.append(f"invalid {field}")

    command = record["command"]
    if not isinstance(command, dict) or set(command) != {"argv", "display"} or (
        not isinstance(command["argv"], list)
        or not command["argv"]
        or not all(is_nonempty_string(argument) for argument in command["argv"])
        or not isinstance(command["display"], str)
        or command["display"] != " ".join(command["argv"])
    ):
        errors.append("invalid command")

    profile = record["profile"]
    if not isinstance(profile, dict) or set(profile) != {"environment", "provided"} or not all(isinstance(profile[field], dict) for field in ("environment", "provided")):
        errors.append("invalid profile")
    if record["verdict"] not in ALLOWED_VERDICTS:
        errors.append(f"invalid verdict: {record['verdict']!r}")
    if not isinstance(record["exit_code"], int) or isinstance(record["exit_code"], bool):
        errors.append("exit_code must be an integer")
    elif record["verdict"] == "PASS" and record["exit_code"] != 0:
        errors.append("PASS requires exit_code 0")

    bundle_root = record_path.resolve().parent.parent
    artifacts = record["artifacts"]
    if not isinstance(artifacts, dict) or set(artifacts) != {"stdout", "stderr"}:
        return errors + ["invalid artifacts"]
    for stream in ("stdout", "stderr"):
        artifact = artifacts.get(stream)
        if not isinstance(artifact, dict) or set(artifact) != {"path", "sha256"}:
            errors.append(f"invalid {stream} artifact metadata")
            continue
        expected_path = expected_artifact_path(record["record_id"], stream)
        if artifact["path"] != expected_path:
            errors.append(f"invalid {stream} artifact path")
            continue
        if not isinstance(artifact["sha256"], str) or not SHA256.fullmatch(artifact["sha256"]):
            errors.append(f"invalid {stream} artifact sha256")
            continue
        path = bundle_root / expected_path
        if not path.is_file():
            errors.append(f"missing artifact: {artifact['path']}")
        elif sha256_file(path) != artifact["sha256"]:
            errors.append(f"sha256 mismatch: {artifact['path']}")
    return errors


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--validate", type=Path, metavar="RECORD")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--id", dest="artifact_id")
    parser.add_argument("--task-id")
    parser.add_argument("--cwd")
    parser.add_argument("--source-baseline-sha")
    parser.add_argument("--execution-revision")
    parser.add_argument("--sha", dest="legacy_sha")
    parser.add_argument("--owner")
    parser.add_argument("--reviewer")
    parser.add_argument("--profile-json", default="{}")
    parser.add_argument("--classification", default="COMMAND_RESULT")
    parser.add_argument("--notes", default="")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    if args.validate:
        return args
    if args.source_baseline_sha is None:
        args.source_baseline_sha = args.legacy_sha
    if args.execution_revision is None:
        args.execution_revision = args.source_baseline_sha
    missing = [
        name
        for name in (
            "output",
            "artifact_id",
            "task_id",
            "cwd",
            "source_baseline_sha",
            "execution_revision",
            "owner",
            "reviewer",
        )
        if getattr(args, name) is None
    ]
    if missing:
        parser.error(f"missing required arguments: {', '.join(missing)}")
    if args.command[:1] == ["--"]:
        args.command = args.command[1:]
    return args


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_args(argv)
        if args.validate:
            errors = validate_record(args.validate)
            if errors:
                print("\n".join(errors), file=sys.stderr)
                return 1
            print(f"valid: {args.validate}")
            return 0
        print(write_record(args))
        return 0
    except (ValueError, json.JSONDecodeError) as error:
        print(error, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
