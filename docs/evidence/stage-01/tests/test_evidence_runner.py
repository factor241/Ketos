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


def invoke_runner(
    tmp_path: Path,
    artifact_id: str,
    command: list[str],
    profile: dict[str, str] | None = None,
) -> tuple[subprocess.CompletedProcess[str], Path]:
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
    assert "source_baseline_sha" in record
    assert "execution_revision" in record
    assert validate(record_path).returncode == 0


def test_runner_canonicalizes_only_end_of_line_whitespace(tmp_path: Path) -> None:
    _, record_path = invoke_runner(
        tmp_path,
        "canonical-log",
        [
            sys.executable,
            "-c",
            "import sys; sys.stdout.write('alpha  \\t\\n\\nbeta\\t \\n'); "
            "sys.stderr.write('gamma \\t\\n')",
        ],
    )

    bundle_root = record_path.parent.parent
    record = json.loads(record_path.read_text())
    stdout = (bundle_root / record["artifacts"]["stdout"]["path"]).read_text()
    stderr = (bundle_root / record["artifacts"]["stderr"]["path"]).read_text()
    assert stdout == "alpha\n\nbeta\n"
    assert stderr == "gamma\n"
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
            "import sys; print('API_KEY=visible-secret'); "
            "print('TOKEN: stderr-secret', file=sys.stderr)",
            "--api-token=command-secret",
        ],
        profile={"PASSWORD": "profile-secret", "safe": "value"},
    )

    record = json.loads(record_path.read_text())
    serialized = json.dumps(record)
    stdout = (
        record_path.parent.parent / record["artifacts"]["stdout"]["path"]
    ).read_text()
    stderr = (
        record_path.parent.parent / record["artifacts"]["stderr"]["path"]
    ).read_text()
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


def test_redaction_preserves_sort_keys_and_redacts_credentials(tmp_path: Path) -> None:
    _, record_path = invoke_runner(
        tmp_path,
        "redaction-precision",
        [
            sys.executable,
            "-c",
            "print('sort_keys=True API_KEY=visible-secret TOKEN=other-secret')",
        ],
    )

    record = json.loads(record_path.read_text())
    stdout = (
        record_path.parent.parent / record["artifacts"]["stdout"]["path"]
    ).read_text()
    serialized = json.dumps(record) + stdout
    assert "sort_keys=True" in serialized
    assert "visible-secret" not in serialized
    assert "other-secret" not in serialized


@pytest.mark.parametrize(
    ("mutate", "expected"),
    [
        (lambda record: record.update({"unexpected": "value"}), "unexpected top-level fields"),
        (lambda record: record["command"].update({"extra": "value"}), "invalid command"),
        (lambda record: record.update({"source_baseline_sha": "not-a-sha"}), "source_baseline_sha"),
        (lambda record: record.update({"started_at_utc": "not-utc"}), "started_at_utc"),
        (lambda record: record.update({"owner": ""}), "owner"),
        (lambda record: record["artifacts"]["stdout"].update({"extra": "value"}), "artifact"),
    ],
)
def test_validator_enforces_complete_schema_shape(
    tmp_path: Path,
    mutate: object,
    expected: str,
) -> None:
    _, record_path = invoke_runner(
        tmp_path,
        "schema-shape",
        [sys.executable, "-c", "print('ok')"],
    )
    record = json.loads(record_path.read_text())
    mutate(record)  # type: ignore[operator]
    record_path.write_text(json.dumps(record))

    result = validate(record_path)
    assert result.returncode != 0
    assert expected in result.stderr


@pytest.mark.parametrize("artifact_path", ["../escape", "records/other.json"])
def test_validator_rejects_noncanonical_artifact_paths(
    tmp_path: Path,
    artifact_path: str,
) -> None:
    _, record_path = invoke_runner(tmp_path, "artifact-path", [sys.executable, "-c", "print('ok')"])
    copied_bundle = tmp_path / "copied-bundle"
    shutil.copytree(record_path.parent.parent, copied_bundle)
    copied_record = copied_bundle / "records" / "artifact-path.json"
    record = json.loads(copied_record.read_text())
    stdout = copied_bundle / record["artifacts"]["stdout"]["path"]
    if artifact_path == "records/other.json":
        (copied_bundle / artifact_path).write_bytes(stdout.read_bytes())
    record["artifacts"]["stdout"]["path"] = artifact_path
    copied_record.write_text(json.dumps(record))

    result = validate(copied_record)
    assert result.returncode != 0
    assert "artifact path" in result.stderr


def test_preflight_manifest_uses_a_real_rss_measurement() -> None:
    manifest = json.loads((STAGE_ROOT / "preflight-manifest.json").read_text())

    assert "rss_measurement" in manifest
    assert "current_rss_record" not in manifest["resource_measurements"]
    assert manifest["rss_measurement"]["command"] == (
        "ps -axo rss= | awk '{sum += $1} END {printf \"%.0f KiB\\n\", sum}'"
    )
