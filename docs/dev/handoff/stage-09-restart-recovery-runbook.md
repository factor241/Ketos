# Ketos Stage 09 restart/replay recovery runbook

This runbook seals one tested commit as immutable external evidence. It does not create a repository report and it never advances Stage 10. The Stage-08 admission base is `79c2c1ffb2eca0eac7672a092f6df7806f531b37`.

## Preconditions

- Run from the clean isolated Stage-09 worktree.
- Obtain explicit approval for one existing, private (`0700`), persistent evidence root outside the repository and outside temporary storage. The scripts validate a root; they do not grant approval.
- Keep `S09_CODE_SHA` unchanged for the whole attempt. Any source, test, runbook, schema, or finalizer correction invalidates the attempt and requires a new commit, run ID, staging directory, and complete rerun.
- Do not put credentials, raw authorization headers, API keys, cookies, prompts containing secrets, or unrestricted environment dumps in evidence.

## Freeze and external staging

```bash
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

# Move known ignored build/cache/report directories behind stable symlinks into
# external staging before the frozen filesystem snapshot. Gate commands may
# write through these links, but no repository path is created or modified.
uv run python scripts/mvp/check_stage09_scope.py prepare-artifacts \
  --run-dir "$S09_RUN_DIR"

uv run python scripts/mvp/check_stage09_scope.py assert-frozen --code-sha "$S09_CODE_SHA"
uv run python scripts/mvp/check_stage09_scope.py snapshot \
  --code-sha "$S09_CODE_SHA" --json-out "$S09_RUN_DIR/repo-before.json"
```

Capture read-only routing and dependency evidence under `$S09_RUN_DIR/logs`: RaytSystem doctor/status/graph status/lint against the repository root, a bounded Graphify query for Stage-09 recovery symbols, and the installed `langgraph` and `langgraph-checkpoint-sqlite` versions. Never rebuild Graphify as part of this stage.

## Serialized gate

Run every command below sequentially. Call `assert-frozen` immediately before and after every command. Record exact argv, UTC start/end, exit code, tested SHA, counts, and relative log path in `$S09_RUN_DIR/commands.json`. A red command ends the attempt; do not patch and continue in the same staging directory.

```bash
uv run pytest -p no:cacheprovider --basetemp="$S09_RUN_DIR/tmp/pytest-focused" \
  src/backend/tests/unit/agentic/persistence/test_checkpointer.py \
  src/backend/tests/unit/services/chat_threads/test_recovery.py \
  src/backend/tests/unit/services/chat_threads/test_messages_snapshot.py \
  src/backend/tests/unit/services/commands/test_recovery.py \
  src/backend/tests/unit/services/commands/test_apply_service.py \
  src/backend/tests/unit/services/jobs/test_restart_recovery.py \
  src/backend/tests/unit/services/jobs/test_board_claim.py \
  src/backend/tests/unit/services/jobs/test_board_results.py -q \
  >"$S09_RUN_DIR/logs/focused-backend.txt" 2>&1

uv run pytest -p no:cacheprovider --basetemp="$S09_RUN_DIR/tmp/pytest-restart" \
  src/backend/tests/integration/test_mvp_restart_recovery.py -q \
  >"$S09_RUN_DIR/logs/restart-integration.txt" 2>&1
S09_RUN_DIR="$S09_RUN_DIR" S09_CODE_SHA="$S09_CODE_SHA" \
  bash scripts/mvp/restart_restore_smoke.sh \
  >"$S09_RUN_DIR/logs/restart-smoke.txt" 2>&1

(cd src/frontend && npm test -- --runInBand --no-cache \
  src/pages/BoardPage/hooks/__tests__/use-board-restore.test.tsx \
  src/components/core/board/placements/ChatPlacement.reconnect.test.tsx \
  src/components/core/chats/__tests__/FlowCommandConfirmation.test.tsx \
  src/components/core/chats/__tests__/FlowCommandConfirmation.reconnect.test.tsx \
  src/components/core/chats/__tests__/use-flow-command-interrupt.reconnect.test.tsx \
  src/components/core/board) >"$S09_RUN_DIR/logs/focused-frontend.txt" 2>&1
(cd src/frontend && npm run i18n:check) >"$S09_RUN_DIR/logs/i18n-check.txt" 2>&1
(cd src/frontend && npm run type-check:production) >"$S09_RUN_DIR/logs/typecheck-production.txt" 2>&1

make unit_tests args="-q -p no:cacheprovider --basetemp=$S09_RUN_DIR/tmp/pytest-package" \
  >"$S09_RUN_DIR/logs/backend-package.txt" 2>&1
CI=true JEST_JUNIT_OUTPUT_DIR="$S09_RUN_DIR/frontend-junit" \
  make test_frontend >"$S09_RUN_DIR/logs/frontend-package.txt" 2>&1

(cd src/frontend && S09_RUN_DIR="$S09_RUN_DIR" S09_CODE_SHA="$S09_CODE_SHA" \
  npx playwright test -c playwright.mvp.config.ts \
  tests/core/features/mvp-restart-restore.spec.ts --project=chromium \
  --output="$S09_RUN_DIR/playwright/results") \
  >"$S09_RUN_DIR/logs/playwright.txt" 2>&1

uv run pytest -p no:cacheprovider --basetemp="$S09_RUN_DIR/tmp/pytest-compat" \
  src/backend/tests/unit/api/v2/test_workflow.py -q \
  >"$S09_RUN_DIR/logs/workflow-compat.txt" 2>&1
git diff --check "$S09_BASE_SHA"..."$S09_CODE_SHA"
uv run python scripts/mvp/check_stage09_scope.py \
  --base "$S09_BASE_SHA" --code-sha "$S09_CODE_SHA"
```

The browser gate is authoritative only together with the process and storage proof. It opens the direct Board URL, injects corrupt local cache, checks server IDs and content, restores the committed transcript and unsent stock-composer draft, observes exactly one polite restore announcement, verifies restored confirmation focus, rejects the standard interrupt once, and proves the prior-worker Job is exposed as `failed/backend_restarted` after a real listener PID change. Screenshots are supplemental; the trace, network/DOM assertions, process ledger, DB/checkpoint hashes, row counts, and proposal/Job API state are the proof.

## Zero-write comparison and report data

```bash
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
