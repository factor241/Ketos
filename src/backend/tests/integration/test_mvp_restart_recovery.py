# ruff: noqa: S607

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]


def test_real_backend_restart_preserves_canonical_files_and_ids(tmp_path: Path) -> None:
    run_root = tmp_path / "stage09-run"
    run_root.mkdir(mode=0o700)
    run_root.chmod(0o700)
    output = run_root / "process" / "recovery.json"
    code_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    completed = subprocess.run(  # noqa: S603 - fixed harness argv
        [
            "uv",
            "run",
            "python",
            "scripts/mvp/restart_harness.py",
            "--code-sha",
            code_sha,
            "--run-root",
            str(run_root),
            "--json-out",
            str(output),
        ],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr

    evidence = json.loads(output.read_text(encoding="utf-8"))
    pids = [entry["pid"] for entry in evidence["processes"]]
    print(f"PID-1={pids[0]} PID-2={pids[1]}")  # noqa: T201 - required process evidence
    assert len(pids) == 2
    assert all(isinstance(pid, int) and pid > 0 for pid in pids)
    assert pids[0] != pids[1]
    assert evidence["pid_changed"] is True
    assert evidence["code_sha"] == code_sha
    assert evidence["files"]["database_path"] == "data/ketos.db"
    assert evidence["files"]["checkpoint_path"] == "data/mvp/langgraph-checkpoints.sqlite3"
    assert evidence["before"]["ledger"] == evidence["after"]["ledger"]
    assert len(evidence["after"]["ledger"]["messages"]) == 2
    assert evidence["before"]["row_counts"] == evidence["after"]["row_counts"]
    assert evidence["outcomes"] == {
        "ag_ui_health_after_restart": True,
        "committed_transcript_replayed": True,
        "concurrent_resume_exact_statuses": True,
        "concurrent_resume_loser_fail_closed": True,
        "concurrent_resume_single_winner": True,
        "job_reason_backend_restarted": True,
        "listener_pid1_closed": True,
        "pending_proposal_recovered": True,
        "pending_proposal_resolved_once": True,
        "prior_process_job_recovered_once": True,
        "replay_rejected_fail_closed": True,
        "same_checkpoint_path": True,
        "same_database_path": True,
        "same_entity_ledger": True,
        "same_row_counts": True,
    }
