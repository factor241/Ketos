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
import os
import platform
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


ALLOWED_VERDICTS = {"PASS", "FAIL", "BLOCKED", "BASELINE_DEFECT", "INCONCLUSIVE"}
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SECRET_ASSIGNMENT = re.compile(
    r"(?i)(\b[A-Za-z0-9_-]*(?:key|token|password|secret)[A-Za-z0-9_-]*\b\s*[:=]\s*)([^\s,;'\"()]+)"
)
SECRET_OPTION = re.compile(r"(?i)(--?[A-Za-z0-9_-]*(?:key|token|password|secret)[A-Za-z0-9_-]*=)([^\s]+)")
SECRET_KEY = re.compile(r"(?i)(key|token|password|secret)")


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


def safe_relative_path(value: str) -> Path:
    candidate = Path(value)
    if candidate.is_absolute() or ".." in candidate.parts or candidate.name != value.split("/")[-1]:
        raise ValueError(f"unsafe artifact path: {value!r}")
    return candidate


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
    stdout_path.write_text(redact_text(stdout), encoding="utf-8")
    stderr_path.write_text(redact_text(stderr), encoding="utf-8")

    sanitized_argv = [redact_text(argument) for argument in args.command]
    record = {
        "record_id": artifact_id,
        "task_id": args.task_id,
        "command": {"argv": sanitized_argv, "display": " ".join(sanitized_argv)},
        "cwd": str(cwd),
        "exact_sha": args.sha,
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


def validate_record(record_path: Path) -> list[str]:
    errors: list[str] = []
    try:
        record = json.loads(record_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return [f"cannot read record: {error}"]
    required = {
        "record_id", "task_id", "command", "cwd", "exact_sha", "profile", "started_at_utc", "ended_at_utc",
        "exit_code", "verdict", "artifacts", "created_at_utc", "owner", "reviewer", "notes", "classification",
    }
    missing = sorted(required - set(record)) if isinstance(record, dict) else sorted(required)
    if missing:
        errors.append(f"missing required fields: {', '.join(missing)}")
        return errors
    if record["verdict"] not in ALLOWED_VERDICTS:
        errors.append(f"invalid verdict: {record['verdict']!r}")
    if not isinstance(record["exit_code"], int) or isinstance(record["exit_code"], bool):
        errors.append("exit_code must be an integer")
    elif record["verdict"] == "PASS" and record["exit_code"] != 0:
        errors.append("PASS requires exit_code 0")

    bundle_root = record_path.resolve().parent.parent
    artifacts = record["artifacts"]
    if not isinstance(artifacts, dict):
        return errors + ["artifacts must be an object"]
    for stream in ("stdout", "stderr"):
        artifact = artifacts.get(stream)
        if not isinstance(artifact, dict) or not isinstance(artifact.get("path"), str) or not isinstance(artifact.get("sha256"), str):
            errors.append(f"invalid {stream} artifact metadata")
            continue
        try:
            relative = safe_relative_path(artifact["path"])
        except ValueError as error:
            errors.append(str(error))
            continue
        path = bundle_root / relative
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
    parser.add_argument("--sha")
    parser.add_argument("--owner")
    parser.add_argument("--reviewer")
    parser.add_argument("--profile-json", default="{}")
    parser.add_argument("--classification", default="COMMAND_RESULT")
    parser.add_argument("--notes", default="")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    if args.validate:
        return args
    missing = [name for name in ("output", "artifact_id", "task_id", "cwd", "sha", "owner", "reviewer") if getattr(args, name) is None]
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
