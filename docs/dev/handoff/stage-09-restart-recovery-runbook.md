# Ketos Stage 09 restart/replay recovery runbook

This runbook seals one tested commit as immutable external evidence. It does not create a repository report and it never advances Stage 10. The Stage-08 admission base is `79c2c1ffb2eca0eac7672a092f6df7806f531b37`.

## Preconditions

- Run from the clean isolated Stage-09 worktree.
- Obtain explicit approval for one existing, private (`0700`), persistent evidence root outside the repository and outside temporary storage. The scripts validate a root; they do not grant approval.
- Keep `S09_CODE_SHA` unchanged for the whole attempt. Any source, test, runbook, schema, or finalizer correction invalidates the attempt and requires a new commit, run ID, staging directory, and complete rerun.
- Do not put credentials, raw authorization headers, API keys, cookies, prompts containing secrets, or unrestricted environment dumps in evidence.

## Freeze and external staging

```bash
set -euo pipefail
export S09_BASE_SHA=79c2c1ffb2eca0eac7672a092f6df7806f531b37
export S09_EVIDENCE_ROOT='<explicitly approved external persistent absolute path>'
test -z "$(git status --porcelain=v1 --untracked-files=all)"
export S09_CODE_SHA="$(git rev-parse HEAD)"
export S09_RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"

uv run python scripts/mvp/finalize_stage09_evidence.py validate-root \
  --repo-root "$(git rev-parse --show-toplevel)" \
  --evidence-root "$S09_EVIDENCE_ROOT"
export S09_RUN_DIR="$(uv run python scripts/mvp/finalize_stage09_evidence.py create-staging \
  --evidence-root "$S09_EVIDENCE_ROOT" --code-sha "$S09_CODE_SHA" --run-id "$S09_RUN_ID")"

export TMPDIR="$S09_RUN_DIR/tmp"
export XDG_CACHE_HOME="$S09_RUN_DIR/cache/xdg"
export PYTHONPYCACHEPREFIX="$S09_RUN_DIR/cache/python"
export PYTHONDONTWRITEBYTECODE=1
export PLAYWRIGHT_HTML_OUTPUT_DIR="$S09_RUN_DIR/playwright/html"
mkdir -p "$XDG_CACHE_HOME" "$PYTHONPYCACHEPREFIX" "$PLAYWRIGHT_HTML_OUTPUT_DIR"

uv run python scripts/mvp/check_stage09_scope.py assert-frozen --code-sha "$S09_CODE_SHA"
uv run python scripts/mvp/check_stage09_scope.py snapshot \
  --code-sha "$S09_CODE_SHA" --json-out "$S09_RUN_DIR/repo-before.json"

# Preserve the pre-existing ignored directories intact, then route gate writes
# to separate external live directories. The EXIT trap restores the originals
# even when a gate fails; the post-gate manifest comparison uses the snapshot
# captured above, before any redirect was installed. Restoration is resumable:
# if it fails, preserve staging and rerun restore-artifacts; never delete its
# manifest or repo-artifact-originals recovery payload by hand.
uv run python scripts/mvp/check_stage09_scope.py prepare-artifacts \
  --run-dir "$S09_RUN_DIR"
trap 'uv run python scripts/mvp/check_stage09_scope.py restore-artifacts --run-dir "$S09_RUN_DIR"' EXIT
```

Capture read-only routing and dependency evidence under `$S09_RUN_DIR/logs`: RaytSystem doctor/status/graph status/lint against the repository root, a bounded Graphify query for Stage-09 recovery symbols, and the installed `langgraph` and `langgraph-checkpoint-sqlite` versions. Never rebuild Graphify as part of this stage.

## Serialized gate

Run every command below sequentially. Call `assert-frozen` immediately before and after every command. Record exact argv, UTC start/end, exit code, tested SHA, counts, and relative log path in `$S09_RUN_DIR/commands.json`. A red command ends the attempt; do not patch and continue in the same staging directory.

```bash
export S09_REPO_ROOT="$(git rev-parse --show-toplevel)"
: "${MVP_POSTGRES_URI:?MVP_POSTGRES_URI must identify the verified Stage 09 PostgreSQL service}"
if [[ -n "${KETOS_TEST_DATABASE_URI:-}" && "$KETOS_TEST_DATABASE_URI" != "$MVP_POSTGRES_URI" ]]; then
  printf 'BLOCKED: KETOS_TEST_DATABASE_URI conflicts with MVP_POSTGRES_URI\n' >&2
  exit 2
fi
export MVP_POSTGRES_URI
export KETOS_TEST_DATABASE_URI="$MVP_POSTGRES_URI"
mkdir -p "$S09_RUN_DIR/process/gates" "$S09_RUN_DIR/process/telemetry"

run_s09_gate() {
  gate_id=$1
  gate_cwd=$2
  timeout_seconds=$3
  nonzero_classification=$4
  log_name=$5
  shift 5
  uv run python scripts/mvp/check_stage09_scope.py assert-frozen --code-sha "$S09_CODE_SHA"
  if uv run python scripts/mvp/stage09_gate_controller.py run \
    --cwd "$gate_cwd" \
    --expected-sha "$S09_CODE_SHA" \
    --result "$S09_RUN_DIR/process/gates/$gate_id.json" \
    --telemetry "$S09_RUN_DIR/process/telemetry/$gate_id.jsonl" \
    --log "$S09_RUN_DIR/logs/$log_name" \
    --lock-path "$S09_EVIDENCE_ROOT/.stage09-heavy-gate.lock" \
    --timeout-seconds "$timeout_seconds" \
    --nonzero-classification "$nonzero_classification" \
    -- "$@"; then
    gate_status=0
  else
    gate_status=$?
  fi
  uv run python scripts/mvp/check_stage09_scope.py assert-frozen --code-sha "$S09_CODE_SHA"
  ((gate_status == 0)) || return "$gate_status"
}

run_s09_gate 001-focused-backend "$S09_REPO_ROOT" 1800 TEST_FAILURE focused-backend.txt \
  uv run pytest -p no:cacheprovider --basetemp="$S09_RUN_DIR/tmp/pytest-focused" \
  src/backend/tests/unit/agentic/persistence/test_checkpointer.py \
  src/backend/tests/unit/services/chat_threads/test_recovery.py \
  src/backend/tests/unit/services/chat_threads/test_messages_snapshot.py \
  src/backend/tests/unit/services/commands/test_recovery.py \
  src/backend/tests/unit/services/commands/test_apply_service.py \
  src/backend/tests/unit/services/jobs/test_restart_recovery.py \
  src/backend/tests/unit/services/jobs/test_board_claim.py \
  src/backend/tests/unit/services/jobs/test_board_results.py -q

run_s09_gate 002-restart-integration "$S09_REPO_ROOT" 1800 TEST_FAILURE restart-integration.txt \
  uv run pytest -p no:cacheprovider --basetemp="$S09_RUN_DIR/tmp/pytest-restart" \
  src/backend/tests/integration/test_mvp_restart_recovery.py -q
run_s09_gate 003-restart-smoke "$S09_REPO_ROOT" 1800 SERVICE_FAILURE restart-smoke.txt \
  /usr/bin/env S09_RUN_DIR="$S09_RUN_DIR" S09_CODE_SHA="$S09_CODE_SHA" \
  bash scripts/mvp/restart_restore_smoke.sh

mkdir -p "$S09_RUN_DIR/tmp/logger" "$S09_RUN_DIR/cache/logger/xdg" \
  "$S09_RUN_DIR/cache/logger/config" "$S09_RUN_DIR/cache/logger/data" \
  "$S09_RUN_DIR/cache/logger/state" "$S09_RUN_DIR/cache/logger/pycache"
run_s09_gate 004-logger-regression "$S09_REPO_ROOT" 900 TEST_FAILURE logger-regression.txt \
  /usr/bin/env TMPDIR="$S09_RUN_DIR/tmp/logger" \
  XDG_CACHE_HOME="$S09_RUN_DIR/cache/logger/xdg" \
  XDG_CONFIG_HOME="$S09_RUN_DIR/cache/logger/config" \
  XDG_DATA_HOME="$S09_RUN_DIR/cache/logger/data" \
  XDG_STATE_HOME="$S09_RUN_DIR/cache/logger/state" \
  PYTHONPYCACHEPREFIX="$S09_RUN_DIR/cache/logger/pycache" \
  uv run pytest -p no:cacheprovider --basetemp="$S09_RUN_DIR/tmp/pytest-logger" \
  src/backend/tests/unit/test_logger.py -q

run_s09_gate 005-focused-frontend "$S09_REPO_ROOT/src/frontend" 1800 TEST_FAILURE focused-frontend.txt \
  npm test -- --runInBand --no-cache \
  src/pages/BoardPage/hooks/__tests__/use-board-restore.test.tsx \
  src/components/core/board/placements/ChatPlacement.reconnect.test.tsx \
  src/components/core/chats/__tests__/FlowCommandConfirmation.test.tsx \
  src/components/core/chats/__tests__/FlowCommandConfirmation.reconnect.test.tsx \
  src/components/core/chats/__tests__/use-flow-command-interrupt.reconnect.test.tsx \
  src/components/core/board
run_s09_gate 006-i18n "$S09_REPO_ROOT/src/frontend" 900 TEST_FAILURE i18n-check.txt \
  npm run i18n:check
run_s09_gate 007-typecheck "$S09_REPO_ROOT/src/frontend" 1800 TEST_FAILURE typecheck-production.txt \
  npm run type-check:production

# Keep the package gate sequential, but start a fresh pytest process and a fresh
# private temp/XDG/pycache root for every shard. A single pytest process retains
# enough fixtures to cross the coordinator's 15.5 GiB RSS guard late in the
# suite; reusing XDG state also invalidates brand-state discovery tests. The
# shards below are a complete file-selection partition of src/backend/tests/unit
# excluding the repository's existing template exclusion. Process/session
# lifecycle intentionally resets between shards; monolithic CI remains a
# separate higher-memory signal for cross-test pollution.
run_s09_gate 008-backend-package "$S09_REPO_ROOT" 14400 TEST_FAILURE backend-package.txt \
  /usr/bin/env S09_RUN_DIR="$S09_RUN_DIR" \
  bash scripts/mvp/run_stage09_backend_package.sh

# Jest workers are serialized for the same workstation memory bound.
run_s09_gate 009-frontend-package "$S09_REPO_ROOT/src/frontend" 7200 TEST_FAILURE frontend-package.txt \
  /usr/bin/env CI=true JEST_JUNIT_OUTPUT_DIR="$S09_RUN_DIR/frontend-junit" \
  npm test -- --runInBand

run_s09_gate 010-playwright "$S09_REPO_ROOT/src/frontend" 3600 TEST_FAILURE playwright.txt \
  /usr/bin/env S09_RUN_DIR="$S09_RUN_DIR" S09_CODE_SHA="$S09_CODE_SHA" \
  npx playwright test -c playwright.mvp.config.ts \
  tests/core/features/mvp-restart-restore.spec.ts --project=chromium \
  --output="$S09_RUN_DIR/playwright/results"

run_s09_gate 011-workflow-compat "$S09_REPO_ROOT" 1800 TEST_FAILURE workflow-compat.txt \
  uv run pytest -p no:cacheprovider --basetemp="$S09_RUN_DIR/tmp/pytest-compat" \
  src/backend/tests/unit/api/v2/test_workflow.py -q
run_s09_gate 012-diff-check "$S09_REPO_ROOT" 900 TEST_FAILURE diff-check.txt \
  git diff --check "$S09_BASE_SHA"..."$S09_CODE_SHA"
run_s09_gate 013-scope-check "$S09_REPO_ROOT" 900 TEST_FAILURE scope-check.txt \
  uv run python scripts/mvp/check_stage09_scope.py \
  --base "$S09_BASE_SHA" --code-sha "$S09_CODE_SHA"

uv run python scripts/mvp/stage09_gate_controller.py summarize \
  --results-dir "$S09_RUN_DIR/process/gates" \
  --telemetry-dir "$S09_RUN_DIR/process/telemetry" \
  --output "$S09_RUN_DIR/process/resource-summary.json"
```

The browser gate is authoritative only together with the process and storage proof. It opens the direct Board URL, injects corrupt local cache, checks server IDs and content, restores the committed transcript and unsent stock-composer draft, observes exactly one polite restore announcement, verifies restored confirmation focus, rejects the standard interrupt once, and proves the prior-worker Job is exposed as `failed/backend_restarted` after a real listener PID change. Screenshots are supplemental; the trace, network/DOM assertions, process ledger, DB/checkpoint hashes, row counts, and proposal/Job API state are the proof.

## Zero-write comparison and report data

```bash
uv run python scripts/mvp/check_stage09_scope.py restore-artifacts --run-dir "$S09_RUN_DIR"
trap - EXIT
test "$(git rev-parse HEAD)" = "$S09_CODE_SHA"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
uv run python scripts/mvp/check_stage09_scope.py compare \
  --before "$S09_RUN_DIR/repo-before.json" \
  --code-sha "$S09_CODE_SHA" \
  --json-out "$S09_RUN_DIR/repo-after-full.json"
uv run python scripts/mvp/check_stage09_scope.py assert-frozen --code-sha "$S09_CODE_SHA"
```

Create `$S09_RUN_DIR/evidence.json` matching `docs/dev/handoff/schemas/stage-09-evidence.schema.json` and `$S09_RUN_DIR/report.md`. The report begins with the exact Russian status and internal gate lines, names the bundle ID and `manifest.json` relative path, and covers completed/partial/incomplete work, defects, blockers, tests, subagent reviews, completion criteria, scope/non-goals, A01–A10 commit ledger, PID/listener timestamps, canonical DB/checkpoint paths and hashes, stable IDs, counts, job v1→v2 recovery, browser results, dirty/scope results, final transition, risks, and next permitted action. Do not include a manifest digest in the report because the manifest hashes the report.

## Atomic seal and independent verify

```bash
export S09_BUNDLE_DIR="$S09_EVIDENCE_ROOT/stage-09/$S09_CODE_SHA/$S09_RUN_ID"
uv run python scripts/mvp/check_stage09_scope.py assert-frozen --code-sha "$S09_CODE_SHA"
uv run python scripts/mvp/finalize_stage09_evidence.py finalize \
  --repo-root "$(git rev-parse --show-toplevel)" \
  --evidence-root "$S09_EVIDENCE_ROOT" \
  --staging "$S09_RUN_DIR" \
  --code-sha "$S09_CODE_SHA" \
  --run-id "$S09_RUN_ID" \
  --schema docs/dev/handoff/schemas/stage-09-evidence.schema.json

test "$(git rev-parse HEAD)" = "$S09_CODE_SHA"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
UV_NO_CACHE=1 PYTHONDONTWRITEBYTECODE=1 \
  uv run python scripts/mvp/finalize_stage09_evidence.py verify --bundle "$S09_BUNDLE_DIR"
```

`PASS/GO` is allowed only when every A01–A10 focused result, both serialized gate passes, PID and listener proof, stable ID/effect ledger, browser story, clean frozen tree, equal pre/post manifests, committed schema validation, immutable manifest verification, and independent review are green on the same `S09_CODE_SHA`. Otherwise report `FAIL` or `BLOCKED` with the exact criterion. Never reuse a mixed or partially rerun bundle.
