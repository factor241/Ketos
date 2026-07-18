"""Black-box contract tests for the Stage 01 stdlib evidence runner."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


STAGE_ROOT = Path(__file__).resolve().parents[1]
RUNNER = STAGE_ROOT / "tools" / "evidence_runner.py"


def invoke_runner(tmp_path: Path, artifact_id: str, command: list[str], profile: dict[str, str] | None = None) -> tuple[subprocess.CompletedProcess[str], Path]:
    output = tmp_path / "bundle"
    command_line = [
        "uv",
        "run",
        "python",
        str(RUNNER),
        "--output",
        str(output),
        "--id",
        artifact_id,
        "--task-id",
        "S01-T03",
        "--cwd",
        str(tmp_path),
        "--sha",
        "80878261d07c21ad257de017d98069f211ada2c2",
        "--owner",
        "stage-01",
        "--reviewer",
        "unreviewed",
    ]
    if profile is not None:
        command_line.extend(["--profile-json", json.dumps(profile)])
    command_line.extend(["--", *command])
    result = subprocess.run(command_line, text=True, capture_output=True, check=False)
    assert result.returncode == 0, result.stderr
    return result, output / "records" / f"{artifact_id}.json"


def validate(record_path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["uv", "run", "python", str(RUNNER), "--validate", str(record_path)],
        text=True,
        capture_output=True,
        check=False,
    )


def test_runner_writes_hashes_that_validate(tmp_path: Path) -> None:
    _, record_path = invoke_runner(
        tmp_path,
        "hashes",
        [sys.executable, "-c", "import sys; print('out'); print('err', file=sys.stderr)"],
    )

    record = json.loads(record_path.read_text())
    assert record["verdict"] == "PASS"
    assert validate(record_path).returncode == 0


def test_negative_exit_code_cannot_validate_as_pass(tmp_path: Path) -> None:
    _, record_path = invoke_runner(tmp_path, "negative-exit", [sys.executable, "-c", "print('ok')"])
    invalid = tmp_path / "negative-pass.json"
    record = json.loads(record_path.read_text())
    record["exit_code"] = -1
    record["verdict"] = "PASS"
    invalid.write_text(json.dumps(record))

    result = validate(invalid)
    assert result.returncode != 0
    assert "PASS requires exit_code 0" in result.stderr


def test_runner_redacts_secrets_from_logs_command_and_profile(tmp_path: Path) -> None:
    _, record_path = invoke_runner(
        tmp_path,
        "redaction",
        [
            sys.executable,
            "-c",
            "import sys; print('API_KEY=visible-secret'); print('TOKEN: stderr-secret', file=sys.stderr)",
            "--api-token=command-secret",
        ],
        profile={"PASSWORD": "profile-secret", "safe": "value"},
    )

    record = json.loads(record_path.read_text())
    serialized = json.dumps(record)
    stdout = (record_path.parent.parent / record["artifacts"]["stdout"]["path"]).read_text()
    stderr = (record_path.parent.parent / record["artifacts"]["stderr"]["path"]).read_text()
    for secret in ("visible-secret", "stderr-secret", "command-secret", "profile-secret"):
        assert secret not in serialized + stdout + stderr
    assert "[REDACTED]" in serialized + stdout + stderr


def test_hash_verifier_rejects_tampered_artifact_copy(tmp_path: Path) -> None:
    _, record_path = invoke_runner(tmp_path, "tamper", [sys.executable, "-c", "print('canonical')"])
    copied_bundle = tmp_path / "tampered-bundle"
    shutil.copytree(record_path.parent.parent, copied_bundle)
    copied_record = copied_bundle / "records" / "tamper.json"
    record = json.loads(copied_record.read_text())
    (copied_bundle / record["artifacts"]["stdout"]["path"]).write_text("tampered\n")

    result = validate(copied_record)
    assert result.returncode != 0
    assert "sha256 mismatch" in result.stderr
    assert validate(record_path).returncode == 0


def test_runner_rejects_artifact_path_traversal(tmp_path: Path) -> None:
    output = tmp_path / "bundle"
    result = subprocess.run(
        [
            "uv",
            "run",
            "python",
            str(RUNNER),
            "--output",
            str(output),
            "--id",
            "../escape",
            "--task-id",
            "S01-T03",
            "--cwd",
            str(tmp_path),
            "--sha",
            "80878261d07c21ad257de017d98069f211ada2c2",
            "--owner",
            "stage-01",
            "--reviewer",
            "unreviewed",
            "--",
            sys.executable,
            "-c",
            "print('never runs')",
        ],
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode != 0
    assert "unsafe artifact id" in result.stderr
    assert not (tmp_path / "escape.json").exists()
