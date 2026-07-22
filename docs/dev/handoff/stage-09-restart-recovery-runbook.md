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

# Keep the package gate sequential, but start a fresh pytest process and a fresh
# private temp/XDG/pycache root for every shard. A single pytest process retains
# enough fixtures to cross the coordinator's 15.5 GiB RSS guard late in the
# suite; reusing XDG state also invalidates brand-state discovery tests. The
# shards below are a complete file-selection partition of src/backend/tests/unit
# excluding the repository's existing template exclusion. Process/session
# lifecycle intentionally resets between shards; monolithic CI remains a
# separate higher-memory signal for cross-test pollution.
bash -eu -o pipefail <<'BACKEND_PACKAGE'
shards=(
  agentic alembic base brand_state components core custom events exceptions
  graph groq helpers initial_setup inputs interface io schema scripts
  serialization services utils
)
cleanup_success_root() {
  case "$1" in
    /private/tmp/ketos-stage09-backend-?*) ;;
    *) printf 'refusing unexpected temp cleanup path: %s\n' "$1" >&2; exit 64 ;;
  esac
  test "$(dirname -- "$1")" = /private/tmp && test -d "$1" && test ! -L "$1" || {
    printf 'refusing unsafe temp cleanup target: %s\n' "$1" >&2
    exit 65
  }
  rm -rf -- "$1"
}
index=0
for shard in "${shards[@]}"; do
  index=$((index + 1))
  shard_root=$(mktemp -d "/private/tmp/ketos-stage09-backend-${shard}.XXXXXX")
  mkdir -p "$shard_root/tmp" "$shard_root/xdg-cache" "$shard_root/xdg-config" \
    "$shard_root/xdg-data" "$shard_root/xdg-state" "$shard_root/pycache"
  TMPDIR="$shard_root/tmp" \
  XDG_CACHE_HOME="$shard_root/xdg-cache" \
  XDG_CONFIG_HOME="$shard_root/xdg-config" \
  XDG_DATA_HOME="$shard_root/xdg-data" \
  XDG_STATE_HOME="$shard_root/xdg-state" \
  PYTHONPYCACHEPREFIX="$shard_root/pycache" \
  PYTHONDONTWRITEBYTECODE=1 \
    uv run pytest "src/backend/tests/unit/$shard" \
      --instafail -ra -m "not api_key_required" -q -p no:cacheprovider \
      --basetemp="$shard_root/pytest" \
      >"$S09_RUN_DIR/logs/backend-package-$(printf '%03d' "$index")-$shard.txt" 2>&1
  cleanup_success_root "$shard_root"
done

shopt -s nullglob
run_file_target() {
  target=$1
  label=$2
  index=$((index + 1))
  target_root=$(mktemp -d "/private/tmp/ketos-stage09-backend-${label}.XXXXXX")
  mkdir -p "$target_root/tmp" "$target_root/xdg-cache" \
    "$target_root/xdg-config" "$target_root/xdg-data" \
    "$target_root/xdg-state" "$target_root/pycache"
  target_log="$S09_RUN_DIR/logs/backend-package-$(printf '%03d' "$index")-$label.txt"
  if TMPDIR="$target_root/tmp" \
    XDG_CACHE_HOME="$target_root/xdg-cache" \
    XDG_CONFIG_HOME="$target_root/xdg-config" \
    XDG_DATA_HOME="$target_root/xdg-data" \
    XDG_STATE_HOME="$target_root/xdg-state" \
    PYTHONPYCACHEPREFIX="$target_root/pycache" \
    PYTHONDONTWRITEBYTECODE=1 \
      uv run pytest "$target" \
        --instafail -ra -m "not api_key_required" -q -p no:cacheprovider \
        --basetemp="$target_root/pytest" \
        >"$target_log" 2>&1; then
    target_status=0
  else
    target_status=$?
  fi
  # A file containing only api_key_required tests is fully deselected by the
  # package gate's marker expression. Pytest reports that valid empty selection
  # as exit 5 when the file is isolated; accept only the explicit deselection
  # summary, never another exit-5 cause or a failing/error result.
  if ((target_status == 5)) && tail -n 1 "$target_log" \
    | grep -Eq '^=+ [0-9]+ deselected(, [0-9]+ warnings?)? in [0-9]+(\.[0-9]+)?s =+$'; then
    target_status=0
  fi
  ((target_status == 0)) || return "$target_status"
  cleanup_success_root "$target_root"
}

# The API directory is the remaining large unit subtree: one process for it can
# still jump above the 15.5 GiB coordinator guard during late fixture teardown.
# Run every API test file independently while preserving the same file selection.
if ! api_listing=$(find src/backend/tests/unit/api -type f -name 'test_*.py' -print | LC_ALL=C sort); then
  printf 'API backend test discovery failed\n' >&2
  exit 66
fi
test -n "$api_listing" || { printf 'API backend test selection is empty\n' >&2; exit 67; }
api_tests=()
while IFS= read -r api_test; do
  api_tests+=("$api_test")
done <<< "$api_listing"
for api_test in "${api_tests[@]}"; do
  api_name=${api_test#src/backend/tests/unit/api/}
  api_name=${api_name%.py}
  api_name=${api_name//\//-}
  run_file_target "$api_test" "api-$api_name"
done

root_tests=(src/backend/tests/unit/test_*.py)
((${#root_tests[@]} > 0)) || { printf 'root backend test glob is empty\n' >&2; exit 68; }
for root_test in "${root_tests[@]}"; do
  root_name=${root_test##*/}
  root_name=${root_name%.py}
  run_file_target "$root_test" "root-$root_name"
done
BACKEND_PACKAGE
# Jest workers are serialized for the same workstation memory bound.
(cd src/frontend && CI=true JEST_JUNIT_OUTPUT_DIR="$S09_RUN_DIR/frontend-junit" \
  npm test -- --runInBand) >"$S09_RUN_DIR/logs/frontend-package.txt" 2>&1

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
