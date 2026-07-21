#!/usr/bin/env bash
# shellcheck disable=SC2016
set -u
set -o pipefail
umask 077

BASE_SHA="a96f5916ecafda515024f09c135df16cd55903bb"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

usage() {
  echo "usage: $0 init|run-all --code-sha <40-hex> --evidence-root <absolute-path> [--transition-input <absolute-json-path>]" >&2
  exit 64
}

ACTION="${1:-}"
test -n "$ACTION" || usage
shift
CODE_SHA=""
EVIDENCE_ROOT=""
TRANSITION_INPUT=""
while test "$#" -gt 0; do
  case "$1" in
    --code-sha)
      test "$#" -ge 2 || usage
      CODE_SHA="$2"
      shift 2
      ;;
    --evidence-root)
      test "$#" -ge 2 || usage
      EVIDENCE_ROOT="$2"
      shift 2
      ;;
    --transition-input)
      test "$#" -ge 2 || usage
      TRANSITION_INPUT="$2"
      shift 2
      ;;
    *) usage ;;
  esac
done

case "$CODE_SHA" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *) echo "BLOCKED: --code-sha must be a full lower-case Git SHA" >&2; exit 42 ;;
esac
case "$EVIDENCE_ROOT" in
  /*) ;;
  *) echo "BLOCKED: --evidence-root must be absolute" >&2; exit 42 ;;
esac
command -v python3 >/dev/null 2>&1 || { echo "BLOCKED: python3 is required to canonicalize evidence paths" >&2; exit 42; }
EVIDENCE_ROOT="$(python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$EVIDENCE_ROOT")" || {
  echo "BLOCKED: evidence root could not be canonicalized" >&2
  exit 42
}
case "$EVIDENCE_ROOT/" in
  "$REPO_ROOT/"*) echo "BLOCKED: evidence root must be outside the repository" >&2; exit 42 ;;
esac

if test "$ACTION" = "init"; then
  case "$TRANSITION_INPUT" in
    /*) ;;
    *) echo "BLOCKED: init requires an absolute --transition-input path" >&2; exit 42 ;;
  esac
  test ! -L "$TRANSITION_INPUT" || { echo "BLOCKED: transition input must not be a symlink" >&2; exit 42; }
  TRANSITION_INPUT="$(python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$TRANSITION_INPUT")" || {
    echo "BLOCKED: transition input could not be canonicalized" >&2
    exit 42
  }
  test -f "$TRANSITION_INPUT" || { echo "BLOCKED: transition input is missing" >&2; exit 42; }
  case "$TRANSITION_INPUT" in
    "$REPO_ROOT"/*) echo "BLOCKED: actual transition input must remain outside the tested repository" >&2; exit 42 ;;
  esac
fi

assert_frozen() {
  test "$(git -C "$REPO_ROOT" rev-parse HEAD)" = "$CODE_SHA" || {
    echo "BLOCKED: HEAD no longer equals S08_CODE_SHA" >&2
    return 42
  }
  test -z "$(git -C "$REPO_ROOT" status --short)" || {
    echo "BLOCKED: worktree is not clean" >&2
    return 42
  }
}

validate_transition_file() {
  local transition_file="$1"
  S08_TRANSITION_INPUT="$transition_file" S08_CODE_SHA="$CODE_SHA" S08_BASE_SHA="$BASE_SHA" \
    uv run --directory "$REPO_ROOT" python - <<'PY'
import json
import os
import subprocess
from pathlib import Path

import jsonschema

from scripts.ci.stage08_evidence_report import validate_transition_input

source = Path(os.environ["S08_TRANSITION_INPUT"])
payload = json.loads(source.read_text(encoding="utf-8"))
schema = json.loads(
    Path("docs/evidence/stage-08/schemas/transition-input.schema.json").read_text(
        encoding="utf-8"
    )
)
jsonschema.Draft202012Validator(
    schema, format_checker=jsonschema.FormatChecker()
).validate(payload)
validate_transition_input(
    payload,
    code_sha=os.environ["S08_CODE_SHA"],
    base_sha=os.environ["S08_BASE_SHA"],
)
for label, ancestor, descendant in [
    ("Sync A", payload["syncASha"], os.environ["S08_CODE_SHA"]),
    *[
        (item["taskId"], item["baseSha"], item["commitSha"])
        for item in payload["taskHandoffs"]
    ],
    *[
        (f"{item['taskId']} frozen ancestry", item["commitSha"], os.environ["S08_CODE_SHA"])
        for item in payload["taskHandoffs"]
    ],
]:
    completed = subprocess.run(
        ["git", "merge-base", "--is-ancestor", ancestor, descendant],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if completed.returncode != 0:
        raise ValueError(f"{label} ancestry is invalid: {ancestor} !<= {descendant}")
PY
}

STAGE_ROOT="$EVIDENCE_ROOT/stage-08/$CODE_SHA"
ACTIVE_FILE="$STAGE_ROOT/.active-run"

if test "$ACTION" = "init"; then
  assert_frozen || exit $?
  validate_transition_file "$TRANSITION_INPUT"
  TRANSITION_VALIDATION_EXIT=$?
  if test "$TRANSITION_VALIDATION_EXIT" -ne 0; then
    echo "BLOCKED: transition input failed schema or semantic validation" >&2
    exit 42
  fi
  mkdir -p "$EVIDENCE_ROOT"
  test ! -L "$EVIDENCE_ROOT/stage-08" || { echo "BLOCKED: stage evidence directory is a symlink" >&2; exit 42; }
  mkdir -p "$EVIDENCE_ROOT/stage-08"
  test ! -L "$STAGE_ROOT" || { echo "BLOCKED: frozen-SHA evidence directory is a symlink" >&2; exit 42; }
  mkdir -p "$STAGE_ROOT"
  RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  BUNDLE="$STAGE_ROOT/$RUN_ID"
  if test -e "$BUNDLE"; then
    echo "BLOCKED: evidence leaf already exists: $BUNDLE" >&2
    exit 42
  fi
  test ! -L "$ACTIVE_FILE" || { echo "BLOCKED: active-run marker is a symlink" >&2; exit 42; }
  mkdir "$BUNDLE"
  mkdir "$BUNDLE/logs" "$BUNDLE/nodes" "$BUNDLE/artifacts"
  chmod 700 "$BUNDLE" "$BUNDLE/logs" "$BUNDLE/nodes" "$BUNDLE/artifacts"
  S08_TRANSITION_INPUT="$TRANSITION_INPUT" S08_BUNDLE="$BUNDLE" \
    uv run --directory "$REPO_ROOT" python - <<'PY'
import os
from pathlib import Path

source = Path(os.environ["S08_TRANSITION_INPUT"])
destination = Path(os.environ["S08_BUNDLE"], "transition-input.json")
destination.write_bytes(source.read_bytes())
PY
  S08_TRANSITION_INPUT="$BUNDLE/transition-input.json"
  if ! validate_transition_file "$S08_TRANSITION_INPUT"; then
    S08_BUNDLE="$BUNDLE" uv run --directory "$REPO_ROOT" python - <<'PY'
import json
import os
from datetime import datetime, timezone
from pathlib import Path

Path(os.environ["S08_BUNDLE"], "ABORTED.json").write_text(
    json.dumps(
        {
            "status": "BLOCKED",
            "reason": "Copied transition input failed validation; no active run was created.",
            "at": datetime.now(timezone.utc).isoformat(),
        },
        indent=2,
        sort_keys=True,
    )
    + "\n",
    encoding="utf-8",
)
PY
    echo "BLOCKED: copied transition input failed schema, semantic, or ancestry validation" >&2
    exit 42
  fi
  printf '%s\n' "$RUN_ID" > "$ACTIVE_FILE"
  S08_RUN_ID="$RUN_ID" S08_BUNDLE="$BUNDLE" S08_CODE_SHA="$CODE_SHA" S08_BASE_SHA="$BASE_SHA" \
    uv run --directory "$REPO_ROOT" python - <<'PY'
import json
import os
from datetime import datetime, timezone
from pathlib import Path

payload = {
    "schemaVersion": "1",
    "stage": "08",
    "frozenSha": os.environ["S08_CODE_SHA"],
    "baseSha": os.environ["S08_BASE_SHA"],
    "runId": os.environ["S08_RUN_ID"],
    "createdAt": datetime.now(timezone.utc).isoformat(),
    "status": "BLOCKED",
    "note": "Initialized; no acceptance outcome is claimed.",
}
Path(os.environ["S08_BUNDLE"], "RUN.json").write_text(
    json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8"
)
PY
  echo "$BUNDLE"
  exit 0
fi

test "$ACTION" = "run-all" || usage
test ! -L "$ACTIVE_FILE" || { echo "BLOCKED: active-run marker is a symlink" >&2; exit 42; }
test -f "$ACTIVE_FILE" || { echo "BLOCKED: run init first" >&2; exit 42; }
RUN_ID="$(tr -d '\r\n' < "$ACTIVE_FILE")"
case "$RUN_ID" in
  [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z-[0-9]*) ;;
  *) echo "BLOCKED: invalid active run id" >&2; exit 42 ;;
esac
BUNDLE="$STAGE_ROOT/$RUN_ID"
test ! -L "$BUNDLE" || { echo "BLOCKED: active evidence bundle is a symlink" >&2; exit 42; }
test -d "$BUNDLE" || { echo "BLOCKED: active bundle is missing" >&2; exit 42; }
test ! -e "$BUNDLE/SEAL.json" || { echo "BLOCKED: bundle is already sealed" >&2; exit 42; }
assert_frozen || exit $?

abort_active_run() {
  local reason="$1"
  S08_BUNDLE="$BUNDLE" S08_REASON="$reason" uv run --directory "$REPO_ROOT" python - <<'PY'
import json
import os
from datetime import datetime, timezone
from pathlib import Path

bundle = Path(os.environ["S08_BUNDLE"])
now = datetime.now(timezone.utc).isoformat()
run_path = bundle / "RUN.json"
if run_path.is_file():
    run = json.loads(run_path.read_text(encoding="utf-8"))
    run["status"] = "BLOCKED"
    run["completedAt"] = now
    run["note"] = os.environ["S08_REASON"]
    run_path.write_text(json.dumps(run, indent=2, sort_keys=True) + "\n", encoding="utf-8")
(bundle / "ABORTED.json").write_text(
    json.dumps(
        {"status": "BLOCKED", "reason": os.environ["S08_REASON"], "at": now},
        indent=2,
        sort_keys=True,
    )
    + "\n",
    encoding="utf-8",
)
PY
  if test -f "$ACTIVE_FILE" && test "$(tr -d '\r\n' < "$ACTIVE_FILE")" = "$RUN_ID"; then
    rm -f "$ACTIVE_FILE"
  fi
}

if ! validate_transition_file "$BUNDLE/transition-input.json"; then
  echo "BLOCKED: bundled transition input failed revalidation before run" >&2
  abort_active_run "Bundled transition input failed revalidation before run; bundle intentionally left unsealed."
  exit 42
fi

NODES_NDJSON="$BUNDLE/nodes.ndjson"
: > "$NODES_NDJSON"
OVERALL="PASS"

record_node() {
  local node_id="$1" name="$2" status="$3" started="$4" ended="$5" command_text="$6" exit_code="$7" log_rel="$8" reason="$9"
  S08_NODE_ID="$node_id" S08_NODE_NAME="$name" S08_NODE_STATUS="$status" \
    S08_STARTED="$started" S08_ENDED="$ended" S08_COMMAND="$command_text" \
    S08_EXIT="$exit_code" S08_LOG_REL="$log_rel" S08_REASON="$reason" \
    S08_BUNDLE="$BUNDLE" S08_CODE_SHA="$CODE_SHA" S08_RUN_ID="$RUN_ID" \
    uv run --directory "$REPO_ROOT" python - <<'PY' >> "$NODES_NDJSON"
import hashlib
import json
import os
import re
from pathlib import Path

bundle = Path(os.environ["S08_BUNDLE"])
log = bundle / os.environ["S08_LOG_REL"]
artifact_candidates = {
    "postgres-behavioral": ["artifacts/postgres-race.json"],
    "browser": [
        "artifacts/browser/browser-evidence.json",
        "artifacts/browser/browser-console.json",
        "artifacts/browser/browser-network.json",
        "artifacts/browser/01-create-approve-reject.png",
        "artifacts/browser/02-russian-stale-restore-copy.png",
        "artifacts/browser/stage08-playwright-trace.zip",
    ],
}
artifacts = [
    candidate
    for candidate in artifact_candidates.get(os.environ["S08_NODE_ID"], [])
    if (bundle / candidate).is_file()
]
plain_log = re.sub(r"\x1b\[[0-9;?]*[ -/]*[@-~]", "", log.read_text(encoding="utf-8", errors="replace"))
counts = {"passed": 0, "failed": 0, "errors": 0, "skipped": 0, "deselected": 0}
for raw_line in plain_log.splitlines():
    line = raw_line.strip()
    if line.startswith("Test Suites:"):
        continue
    if line.startswith("Tests:"):
        summary = line.removeprefix("Tests:")
    elif any(word in line for word in (" passed", " failed", " error", " skipped", " deselected")):
        summary = line
    else:
        continue
    for key, value in re.findall(r"(\d+)\s+(passed|failed|errors?|skipped|deselected)", summary):
        normalized = "errors" if value.startswith("error") else value
        counts[normalized] += int(key)
if not any(counts.values()):
    counts["passed" if os.environ["S08_NODE_STATUS"] == "PASS" else "failed"] = 1
payload = {
    "id": os.environ["S08_NODE_ID"],
    "name": os.environ["S08_NODE_NAME"],
    "status": os.environ["S08_NODE_STATUS"],
    "startedAt": os.environ["S08_STARTED"],
    "endedAt": os.environ["S08_ENDED"],
    "command": os.environ["S08_COMMAND"],
    "exitCode": int(os.environ["S08_EXIT"]),
    "logPath": os.environ["S08_LOG_REL"],
    "logSha256": hashlib.sha256(log.read_bytes()).hexdigest(),
    "artifactPaths": artifacts,
    "reason": os.environ["S08_REASON"] or None,
}
(bundle / "nodes" / f"{os.environ['S08_NODE_ID']}.json").write_text(
    json.dumps(
        {
            "schemaVersion": "1",
            "stage": "08",
            "frozenSha": os.environ["S08_CODE_SHA"],
            "runId": os.environ["S08_RUN_ID"],
            "nodeId": os.environ["S08_NODE_ID"],
            "suite": os.environ["S08_NODE_NAME"],
            "command": os.environ["S08_COMMAND"],
            "startedAt": os.environ["S08_STARTED"],
            "endedAt": os.environ["S08_ENDED"],
            "exitCode": int(os.environ["S08_EXIT"]),
            "status": os.environ["S08_NODE_STATUS"],
            "counts": counts,
            "logPath": os.environ["S08_LOG_REL"],
            "logSha256": payload["logSha256"],
            "artifacts": artifacts,
        },
        indent=2,
        sort_keys=True,
    )
    + "\n",
    encoding="utf-8",
)
print(json.dumps(payload, sort_keys=True))
PY
}

finalize_node_artifacts() {
  local node_id="$1" log_rel="$2"
  case "$node_id" in
    postgres-behavioral)
      S08_BUNDLE="$BUNDLE" S08_LOG_REL="$log_rel" uv run --directory "$REPO_ROOT" python - <<'PY'
import hashlib
import json
import os
from pathlib import Path

import jsonschema

bundle = Path(os.environ["S08_BUNDLE"])
artifact = bundle / "artifacts/postgres-race.json"
data = json.loads(artifact.read_text(encoding="utf-8"))
data["logSha256"] = hashlib.sha256((bundle / os.environ["S08_LOG_REL"]).read_bytes()).hexdigest()
artifact.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
schema = json.loads(Path("docs/evidence/stage-08/schemas/postgres-race.schema.json").read_text(encoding="utf-8"))
jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker()).validate(data)
assert data["status"] == "PASS" and data["skipped"] == 0
assert len(data["scenarios"]) >= 5 and len(data["phaseVerdicts"]) >= 2
assert all(len({item["backendPid"] for item in scenario["participants"]}) == 2 for scenario in data["scenarios"])
assert all(item["passed"] for item in data["phaseVerdicts"])
PY
      ;;
    browser)
      S08_BUNDLE="$BUNDLE" uv run --directory "$REPO_ROOT" python - <<'PY'
import json
import os
from pathlib import Path

import jsonschema

bundle = Path(os.environ["S08_BUNDLE"])
artifact = bundle / "artifacts/browser/browser-evidence.json"
data = json.loads(artifact.read_text(encoding="utf-8"))
schema = json.loads(Path("docs/evidence/stage-08/schemas/browser.schema.json").read_text(encoding="utf-8"))
jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker()).validate(data)
assert data["status"] == "PASS"
assert data["console"]["errorCount"] == 0
assert data["network"]["failedRequestCount"] == 0
assert data["network"]["unexpectedMutationCount"] == 0
for story in data["stories"]:
    assert story["status"] == "PASS"
    assert story["tracePath"] and Path(story["tracePath"]).is_file()
    assert story["screenshotPaths"] and all(Path(path).is_file() for path in story["screenshotPaths"])
PY
      ;;
  esac
}

run_node() {
  local node_id="$1" name="$2" command_text="$3"
  local log_rel="logs/$node_id.log"
  local log="$BUNDLE/$log_rel"
  local started ended exit_code status reason
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if ! assert_frozen > "$log" 2>&1; then
    exit_code=42
    status="BLOCKED"
    reason="Frozen SHA or clean-worktree assertion failed."
  else
    (
      cd "$REPO_ROOT" || exit 1
      S08_CODE_SHA="$CODE_SHA" S08_BASE_SHA="$BASE_SHA" S08_RUN_ID="$RUN_ID" S08_BUNDLE="$BUNDLE" \
        bash -lc "$command_text"
    ) >> "$log" 2>&1
    exit_code=$?
    if test "$exit_code" -eq 0 && ! finalize_node_artifacts "$node_id" "$log_rel" >> "$log" 2>&1; then
      exit_code=1
    fi
    if test "$exit_code" -eq 0; then
      status="PASS"
      reason=""
    elif test "$exit_code" -eq 42; then
      status="BLOCKED"
      reason="Mandatory prerequisite or truthful execution path was unavailable."
    else
      status="FAIL"
      reason="Command exited non-zero after prerequisites were available."
    fi
  fi
  ended="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  record_node "$node_id" "$name" "$status" "$started" "$ended" "$command_text" "$exit_code" "$log_rel" "$reason"
  if test "$status" = "BLOCKED"; then OVERALL="BLOCKED"; fi
  if test "$status" = "FAIL" && test "$OVERALL" = "PASS"; then OVERALL="FAIL"; fi
}

run_node "runtime-preflight" "Mandatory runtime and provisioning preflight" \
  'for command_name in git uv npm npx node make rg raytsystem; do command -v "$command_name" >/dev/null 2>&1 || { echo "BLOCKED: required command is unavailable: $command_name"; exit 42; }; done; test -n "${MVP_POSTGRES_URI:-}" || { echo "BLOCKED: MVP_POSTGRES_URI is empty"; exit 42; }; uv run python scripts/ci/stage08_runtime_preflight.py || exit 42; cd src/frontend && node -e '\''const fs=require("fs"); const {chromium}=require("@playwright/test"); if(!fs.existsSync(chromium.executablePath())) process.exit(42)'\'' || { echo "BLOCKED: Chromium runtime is unavailable"; exit 42; }'

run_node "provenance" "Frozen SHA and topology" \
  'test "$(git rev-parse HEAD)" = "$S08_CODE_SHA" && test -z "$(git status --short)" && test "$(git merge-base "$S08_BASE_SHA" "$S08_CODE_SHA")" = "$S08_BASE_SHA" && test "$(uv run --directory src/backend/base/ketos alembic -c alembic.ini heads | wc -l | tr -d " ")" = 1 && uv run python -c "from importlib.metadata import version; print(version('"'"'alembic'"'"'), version('"'"'langgraph'"'"'), version('"'"'sqlalchemy'"'"'))" && (raytsystem doctor --root "$PWD" --json || true) && (raytsystem status --root "$PWD" --json || true) && (raytsystem graph status --root "$PWD" --json || true) && (raytsystem lint --root "$PWD" --json || true)'

run_node "dependency-probes" "Pinned AG-UI and CopilotKit probes" \
  'uv run pytest src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py src/backend/tests/unit/agentic/api/test_ag_ui_probe.py -q && cd src/frontend && npm test -- --runInBand src/components/core/assistantPanel/__tests__/copilotkit-probe.test.tsx'

run_node "migration-sqlite" "SQLite migration and phase gate" \
  'rm -f "$S08_BUNDLE/artifacts/migrations.sqlite" && MIGRATION_VALIDATION_CI=1 KETOS_TEST_DATABASE_URI="sqlite+aiosqlite:///$S08_BUNDLE/artifacts/migrations.sqlite" uv run pytest src/backend/tests/unit/alembic/test_mvp_command_proposal_migration.py "src/backend/tests/unit/alembic/test_migration_execution.py::test_no_phantom_migrations[sqlite]" "src/backend/tests/unit/alembic/test_migration_execution.py::test_upgrade_from_main_branch[sqlite]" -q'

run_node "migration-postgres" "PostgreSQL migration and phase gate" \
  'test -n "${MVP_POSTGRES_URI:-}" || { echo "BLOCKED: MVP_POSTGRES_URI is empty"; exit 42; }; MIGRATION_VALIDATION_CI=1 KETOS_TEST_DATABASE_URI="$MVP_POSTGRES_URI" uv run pytest src/backend/tests/unit/alembic/test_mvp_command_proposal_migration.py "src/backend/tests/unit/alembic/test_migration_execution.py::test_no_phantom_migrations[postgres]" "src/backend/tests/unit/alembic/test_migration_execution.py::test_upgrade_from_main_branch[postgres]" -q'

run_node "backend-focused" "Backend focused and integration gate" \
  'uv run pytest src/backend/tests/unit/services/commands src/backend/tests/unit/api/v1/test_command_proposals.py src/backend/tests/unit/agentic/flows/test_flow_builder_assistant.py src/backend/tests/unit/agentic/flows/test_flow_builder_proposal_surface.py src/backend/tests/unit/agentic/flows/test_flow_builder_proposal_tools.py src/backend/tests/unit/agentic/flows/test_flow_builder_hitl.py src/backend/tests/unit/agentic/api/test_ag_ui_flow_confirmation.py src/backend/tests/integration/test_ai_flow_preview_confirm.py -m "not requires_api_key" -q'

run_node "postgres-behavioral" "PostgreSQL two-connection behavioral gate" \
  'test -n "${MVP_POSTGRES_URI:-}" || { echo "BLOCKED: MVP_POSTGRES_URI is empty"; exit 42; }; MVP_POSTGRES_URI="$MVP_POSTGRES_URI" KETOS_TEST_DATABASE_URI="$MVP_POSTGRES_URI" KETOS_REQUIRE_POSTGRES_BEHAVIORAL=1 S08_POSTGRES_EVIDENCE_PATH="$S08_BUNDLE/artifacts/postgres-race.json" S08_POSTGRES_LOG_REL="logs/postgres-behavioral.log" uv run pytest src/backend/tests/integration/commands/test_postgres_command_concurrency.py -q -ra'

run_node "flow-version" "FlowVersion and pin retention gate" \
  'uv run pytest src/backend/base/ketos/tests/services/database/models/flow_version/test_crud.py src/backend/tests/unit/api/v1/test_flow_version.py src/backend/tests/unit/services/commands/test_restore_service.py -q'

run_node "kfx-lfx" "KFX and LFX compatibility gate" \
  'cd src/kfx && uv run --isolated --frozen --package kfx pytest tests/unit/test_flow_builder_tools.py tests/unit/test_flow_builder.py -q && cd ../.. && uv run pytest src/compat/lfx/tests/test_lfx_compatibility.py -q && git diff --exit-code "$S08_BASE_SHA"..."$S08_CODE_SHA" -- src/kfx/src/kfx/components src/kfx/src/kfx/mcp/flow_builder_tools src/bundles src/compat/lfx/lfx_compat/module-map-v1.json'

run_node "frontend" "Frontend confirmation, i18n and type gate" \
  'cd src/frontend && npm test -- --runInBand src/components/core/chats src/components/core/board/placements/ChatPlacement.test.tsx src/controllers/API/queries/commands src/components/core/assistantPanel && npm run i18n:check && npm run i18n:check-keys && npm run i18n:check:hardcoded && npm run type-check:production'

run_node "negative-guards" "No-bypass runtime and source gate" \
  'uv run pytest src/backend/tests/unit/agentic/flows/test_flow_builder_no_bypass.py -q && cd src/frontend && npm test -- --runInBand src/components/core/chats/__tests__/flow-command-no-browser-apply.test.ts && test -z "$(rg -n "assistantPanel|use-post-assist-stream|apply-flow-update|useFlowStore|use-save-flow|usePatchUpdateFlow|applyFlowToCanvas|auto_apply|skipAll" src/components/core/board src/components/core/chats --glob "!**/__tests__/**" --glob "!**/*.test.*" --glob "!**/*.spec.*")" && cd ../.. && test -z "$(rg -n "forwarded_props\\.command\\.resume|CustomEvent\\(.*on_interrupt|apply_edits_immediately=True|write_file|edit_file|GenerateComponent|RunFlow" src/backend/base/ketos/agentic/flows/flow_builder_hitl.py src/backend/base/ketos/agentic/services/flow_proposal_adapter.py src/backend/base/ketos/agentic/tools/flow_proposal_tools.py)"'

run_node "browser" "Chromium acceptance story" \
  'cd src/frontend && KETOS_MVP_RUN_DIR="$S08_BUNDLE/artifacts/browser-run" STAGE08_EVIDENCE_ROOT="$S08_BUNDLE/artifacts/browser" STAGE08_OPENAI_PORT=18766 STAGE08_TRACE=on OPENAI_API_BASE="http://127.0.0.1:18766/v1" OPENAI_BASE_URL="http://127.0.0.1:18766/v1" OPENAI_API_KEY="stage08-test-key" npx playwright test -c playwright.mvp.config.ts tests/core/integrations/ai-flow-preview-confirm.spec.ts --project=chromium --output="$S08_BUNDLE/artifacts/playwright"'

run_node "repository" "Repository lint and diff gate" \
  'uv run pytest scripts/ci/test_stage08_evidence_report.py -q && make lint && git diff --check "$S08_BASE_SHA"..."$S08_CODE_SHA" && test -z "$(git status --short)"'

S08_OVERALL="$OVERALL" S08_BUNDLE="$BUNDLE" S08_RUN_ID="$RUN_ID" S08_CODE_SHA="$CODE_SHA" S08_BASE_SHA="$BASE_SHA" \
  uv run --directory "$REPO_ROOT" python - <<'PY'
import hashlib
import json
import mimetypes
import os
from datetime import datetime, timezone
from pathlib import Path

from scripts.ci.stage08_evidence_report import (
    render_stage08_report,
    validate_stage08_report,
)

bundle = Path(os.environ["S08_BUNDLE"])
nodes = [json.loads(line) for line in (bundle / "nodes.ndjson").read_text(encoding="utf-8").splitlines()]
status = os.environ["S08_OVERALL"]
now = datetime.now(timezone.utc).isoformat()
failures = [
    {"id": f"failure-{n['id']}", "nodeId": n["id"], "message": n["reason"] or "node failed", "evidencePaths": [n["logPath"]]}
    for n in nodes if n["status"] == "FAIL"
]
blockers = [
    {"id": f"blocker-{n['id']}", "nodeId": n["id"], "message": n["reason"] or "node blocked", "evidencePaths": [n["logPath"]]}
    for n in nodes if n["status"] == "BLOCKED"
]
acceptance = [
    {"id": n["id"], "requirement": n["name"], "status": n["status"], "nodeIds": [n["id"]], "evidencePaths": [n["logPath"], *n["artifactPaths"]], "note": n["reason"] or "command exited 0"}
    for n in nodes
]
report = {
    "schemaVersion": "1", "stage": "08", "frozenSha": os.environ["S08_CODE_SHA"],
    "baseSha": os.environ["S08_BASE_SHA"], "runId": os.environ["S08_RUN_ID"],
    "status": status, "generatedAt": now, "summary": f"Stage 08 gate: {status}",
    "acceptance": acceptance, "failures": failures, "blockers": blockers,
    "manifestPath": "manifest.json",
}
(bundle / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
run = json.loads((bundle / "RUN.json").read_text(encoding="utf-8"))
run["status"] = status
run["completedAt"] = now
run["note"] = f"All mandatory Stage 08 nodes completed with aggregate status {status}."
(bundle / "RUN.json").write_text(json.dumps(run, indent=2, sort_keys=True) + "\n", encoding="utf-8")
transition_input = json.loads(
    (bundle / "transition-input.json").read_text(encoding="utf-8")
)
markdown = render_stage08_report(
    bundle=bundle,
    nodes=nodes,
    status=status,
    code_sha=os.environ["S08_CODE_SHA"],
    base_sha=os.environ["S08_BASE_SHA"],
    run_id=os.environ["S08_RUN_ID"],
    generated_at=now,
    transition_input=transition_input,
)
validate_stage08_report(markdown, status=status)
(bundle / "STAGE_08_REPORT.md").write_text(markdown, encoding="utf-8")

def inventory():
    rows = []
    for path in sorted(bundle.rglob("*")):
        if not path.is_file() or path.name in {"manifest.json", "SEAL.json"}:
            continue
        data = path.read_bytes()
        rows.append({
            "path": path.relative_to(bundle).as_posix(), "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "mediaType": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
        })
    return rows

manifest = {
    "schemaVersion": "1", "stage": "08", "frozenSha": os.environ["S08_CODE_SHA"],
    "baseSha": os.environ["S08_BASE_SHA"], "runId": os.environ["S08_RUN_ID"],
    "createdAt": run["createdAt"],
    "sealedAt": now, "status": status, "nodes": nodes, "files": inventory(),
    "reportPath": "STAGE_08_REPORT.md", "sealPath": "SEAL.json",
}
(bundle / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
REPORT_BUILD_EXIT=$?
if test "$REPORT_BUILD_EXIT" -ne 0; then
  echo "FAIL: Stage 08 report contract validation failed before manifest/seal" >&2
  abort_active_run "Report contract validation failed before manifest/seal; bundle intentionally left unsealed."
  exit 1
fi

validate_bundle() {
  S08_BUNDLE="$BUNDLE" uv run --directory "$REPO_ROOT" python - <<'PY'
import json
import os
from pathlib import Path

import jsonschema

from scripts.ci.stage08_evidence_report import (
    validate_stage08_report,
    validate_transition_input,
)

bundle = Path(os.environ["S08_BUNDLE"])
root = Path.cwd()
for data_name, schema_name in (
    ("report.json", "report.schema.json"),
    ("manifest.json", "manifest.schema.json"),
    ("transition-input.json", "transition-input.schema.json"),
):
    data = json.loads((bundle / data_name).read_text(encoding="utf-8"))
    schema = json.loads((root / "docs/evidence/stage-08/schemas" / schema_name).read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker()).validate(data)
transition_input = json.loads((bundle / "transition-input.json").read_text(encoding="utf-8"))
report = json.loads((bundle / "report.json").read_text(encoding="utf-8"))
validate_transition_input(
    transition_input,
    code_sha=report["frozenSha"],
    base_sha=report["baseSha"],
)
validate_stage08_report(
    (bundle / "STAGE_08_REPORT.md").read_text(encoding="utf-8"),
    status=report["status"],
)
node_schema = json.loads((root / "docs/evidence/stage-08/schemas/test-evidence.schema.json").read_text(encoding="utf-8"))
for node_path in sorted((bundle / "nodes").glob("*.json")):
    jsonschema.Draft202012Validator(node_schema, format_checker=jsonschema.FormatChecker()).validate(
        json.loads(node_path.read_text(encoding="utf-8"))
    )
for data_path, schema_name in (
    (bundle / "artifacts/postgres-race.json", "postgres-race.schema.json"),
    (bundle / "artifacts/browser/browser-evidence.json", "browser.schema.json"),
):
    data = json.loads(data_path.read_text(encoding="utf-8"))
    schema = json.loads((root / "docs/evidence/stage-08/schemas" / schema_name).read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker()).validate(data)
PY
}

validate_bundle
VALIDATION_EXIT=$?
if test "$VALIDATION_EXIT" -ne 0; then
  echo "Evidence schema validation failed; bundle is sealed as FAIL." >> "$BUNDLE/logs/evidence-validation.log"
  OVERALL="FAIL"
  S08_BUNDLE="$BUNDLE" uv run --directory "$REPO_ROOT" python - <<'PY'
import hashlib
import json
import mimetypes
import os
from pathlib import Path

from scripts.ci.stage08_evidence_report import (
    render_stage08_report,
    validate_stage08_report,
)

bundle = Path(os.environ["S08_BUNDLE"])
report = json.loads((bundle / "report.json").read_text(encoding="utf-8"))
report["status"] = "FAIL"
report["summary"] = "Stage 08 gate: FAIL (evidence schema validation)"
report["failures"].append(
    {
        "id": "failure-evidence-validation",
        "nodeId": "evidence-validation",
        "message": "Evidence schema validation failed.",
        "evidencePaths": ["logs/evidence-validation.log"],
    }
)
(bundle / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
run = json.loads((bundle / "RUN.json").read_text(encoding="utf-8"))
run["status"] = "FAIL"
run["note"] = "Mandatory evidence schema validation failed."
(bundle / "RUN.json").write_text(json.dumps(run, indent=2, sort_keys=True) + "\n", encoding="utf-8")
nodes = [
    json.loads(line)
    for line in (bundle / "nodes.ndjson").read_text(encoding="utf-8").splitlines()
]
transition_input = json.loads(
    (bundle / "transition-input.json").read_text(encoding="utf-8")
)
markdown = render_stage08_report(
    bundle=bundle,
    nodes=nodes,
    status="FAIL",
    code_sha=report["frozenSha"],
    base_sha=report["baseSha"],
    run_id=report["runId"],
    generated_at=report["generatedAt"],
    transition_input=transition_input,
)
validate_stage08_report(markdown, status="FAIL")
(bundle / "STAGE_08_REPORT.md").write_text(markdown, encoding="utf-8")
manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
manifest["status"] = "FAIL"
files = []
for path in sorted(bundle.rglob("*")):
    if not path.is_file() or path.name in {"manifest.json", "SEAL.json"}:
        continue
    data = path.read_bytes()
    files.append(
        {
            "path": path.relative_to(bundle).as_posix(),
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "mediaType": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
        }
    )
manifest["files"] = files
(bundle / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
fi

validate_bundle
FINAL_VALIDATION_EXIT=$?
if test "$FINAL_VALIDATION_EXIT" -ne 0; then
  echo "FAIL: finalized Stage 08 evidence failed validation; bundle is not sealed" >&2
  abort_active_run "Final evidence validation failed after failure normalization; bundle intentionally left unsealed."
  exit 1
fi
if ! validate_transition_file "$BUNDLE/transition-input.json"; then
  echo "FAIL: bundled transition ancestry changed before seal" >&2
  abort_active_run "Bundled transition input failed final ancestry validation; bundle intentionally left unsealed."
  exit 1
fi

S08_BUNDLE="$BUNDLE" S08_RUN_ID="$RUN_ID" S08_CODE_SHA="$CODE_SHA" S08_STATUS="$OVERALL" \
  uv run --directory "$REPO_ROOT" python - <<'PY'
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

bundle = Path(os.environ["S08_BUNDLE"])
manifest_path = bundle / "manifest.json"
seal = {
    "schemaVersion": "1", "stage": "08", "frozenSha": os.environ["S08_CODE_SHA"],
    "runId": os.environ["S08_RUN_ID"], "status": os.environ["S08_STATUS"],
    "algorithm": "sha256", "manifestSha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
    "sealedAt": datetime.now(timezone.utc).isoformat(), "sealedBy": "run-stage08-gate.sh",
}
(bundle / "SEAL.json").write_text(json.dumps(seal, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
find "$BUNDLE" -type f -exec chmod 400 {} +
find "$BUNDLE" -type d -exec chmod 500 {} +
echo "$OVERALL $BUNDLE"
test "$OVERALL" = "PASS"
