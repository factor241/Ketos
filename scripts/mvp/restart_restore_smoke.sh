#!/usr/bin/env bash
set -euo pipefail

: "${S09_RUN_DIR:?S09_RUN_DIR must point to the approved external staging directory}"
: "${S09_CODE_SHA:?S09_CODE_SHA must be the frozen tested commit}"

repo_root="$(git rev-parse --show-toplevel)"
run_dir="$(uv run python -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).resolve(strict=True))' "$S09_RUN_DIR")"
case "$run_dir/" in
  "$repo_root"/*) echo "restart smoke run directory must be external to the repository" >&2; exit 1 ;;
esac

json_out="$run_dir/process/recovery.json"

uv run python scripts/mvp/restart_harness.py \
  --code-sha "$S09_CODE_SHA" \
  --run-root "$run_dir" \
  --json-out "$json_out"

uv run python - "$json_out" "$S09_CODE_SHA" <<'PY'
from __future__ import annotations

import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
expected_sha = sys.argv[2]
errors: list[str] = []

if payload.get("status") != "pass":
    errors.append("harness status is not pass")
if payload.get("code_sha") != expected_sha:
    errors.append("recorded code SHA differs from S09_CODE_SHA")
processes = payload.get("processes", [])
if len(processes) != 2 or processes[0].get("pid") == processes[1].get("pid"):
    errors.append("PID-1/PID-2 proof is absent or PIDs are equal")
if not payload.get("pid_changed"):
    errors.append("pid_changed is false")
outcomes = payload.get("outcomes", {})
required_outcomes = {
    "listener_pid1_closed",
    "same_database_path",
    "same_checkpoint_path",
    "same_entity_ledger",
    "same_row_counts",
    "ag_ui_health_after_restart",
    "committed_transcript_replayed",
    "pending_proposal_recovered",
    "pending_proposal_resolved_once",
    "concurrent_resume_single_winner",
    "prior_process_job_recovered_once",
    "job_reason_backend_restarted",
}
failed = sorted(name for name in required_outcomes if outcomes.get(name) is not True)
if failed:
    errors.append("failed outcomes: " + ", ".join(failed))
if payload.get("before", {}).get("row_counts") != payload.get("after", {}).get("row_counts"):
    errors.append("row/effect counts increased across restart")
if payload.get("before", {}).get("ledger") != payload.get("after", {}).get("ledger"):
    errors.append("persistent ID/entity ledger changed across restart")
files = payload.get("files", {})
if files.get("database_path") != "data/ketos.db":
    errors.append("unexpected canonical database path")
if files.get("checkpoint_path") != "data/mvp/langgraph-checkpoints.sqlite3":
    errors.append("unexpected canonical checkpoint path")
if errors:
    raise SystemExit("restart smoke failed: " + "; ".join(errors))
print(json.dumps({"status": "pass", "code_sha": expected_sha, "pids": [p["pid"] for p in processes]}))
PY
