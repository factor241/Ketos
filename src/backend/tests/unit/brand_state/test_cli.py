from __future__ import annotations

# ruff: noqa: INP001, TC003 -- integration test package and runtime Path fixture annotations.
import json
import os
import subprocess
import sys
from pathlib import Path


def _run_cli(tmp_path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment.update(
        {
            "HOME": str(tmp_path),
            "OBJC_DISABLE_INITIALIZE_FORK_SAFETY": "YES",
            "XDG_STATE_HOME": str(tmp_path / "state"),
        }
    )
    return subprocess.run(  # noqa: S603
        [sys.executable, "-m", "ketos", "migrate-brand-state", *args],
        check=False,
        capture_output=True,
        env=environment,
        text=True,
    )


def test_status_fast_path_is_read_only_and_settings_free(tmp_path: Path) -> None:
    result = _run_cli(tmp_path, "--status")

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {"transactions": []}
    assert not (tmp_path / "state" / "ketos" / "brand-migrations").exists()


def test_cli_requires_exactly_one_operation(tmp_path: Path) -> None:
    missing = _run_cli(tmp_path)
    conflicting = _run_cli(tmp_path, "--status", "--dry-run")

    assert missing.returncode != 0
    assert conflicting.returncode != 0
    assert "choose exactly one" in missing.stderr
    assert "choose exactly one" in conflicting.stderr
