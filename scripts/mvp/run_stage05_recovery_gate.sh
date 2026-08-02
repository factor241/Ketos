#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 /Volumes/Projects/.ketos-stage05-gate.RUN_ID" >&2
  exit 64
fi

repository_root="/Volumes/Projects/ketos-mvp-stage05-integration"
run_root="$1"
stage_base_sha="1ea57de7aa88dc8cff2cc2818af8e69d3420542c"

case "$run_root" in
  /Volumes/Projects/.ketos-stage05-*) ;;
  *)
    echo "run root must be a Stage-05 directory below /Volumes/Projects" >&2
    exit 64
    ;;
esac

if [[ -z "${MVP_POSTGRES_URI:-}" ]]; then
  echo "BLOCKED: MVP_POSTGRES_URI is required for Stage-05 PostgreSQL parity" >&2
  exit 2
fi

mkdir -p "$run_root/screenshots"
cd "$repository_root"
test -z "$(git status --porcelain)"
git merge-base --is-ancestor "$stage_base_sha" HEAD

uv run pytest \
  src/backend/tests/unit/services/chat_threads \
  src/backend/tests/unit/services/board/test_placement_service.py \
  src/backend/tests/unit/agentic/api/test_ag_ui_router.py \
  src/backend/tests/unit/api/v1/test_chat_threads.py -q

MIGRATION_VALIDATION_CI=1 uv run pytest \
  src/backend/tests/unit/alembic/test_mvp_chat_migration.py::test_s05_chat_migration_sqlite \
  src/backend/tests/unit/alembic/test_mvp_chat_migration.py::test_s05_chat_model_parity_sqlite \
  src/backend/tests/unit/alembic/test_migration_execution.py -q

MIGRATION_VALIDATION_CI=1 \
KETOS_TEST_DATABASE_URI="$MVP_POSTGRES_URI" \
uv run pytest \
  src/backend/tests/unit/alembic/test_mvp_chat_migration.py::test_s05_chat_migration_postgres \
  src/backend/tests/unit/alembic/test_mvp_chat_migration.py::test_s05_chat_model_parity_postgres \
  src/backend/tests/unit/alembic/test_migration_execution.py -q

uv run pytest \
  src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py \
  scripts/mvp/test_chat_stack_boundaries.py -q

(cd src/copilot-runtime && npm test -- src/__tests__/ketos-chat.test.ts)
(cd src/copilot-runtime && npm run typecheck)
(cd src/copilot-runtime && npm run build)

(cd src/frontend && npm test -- --runInBand \
  src/components/core/board/placements/ChatPlacement.test.tsx \
  src/components/core/chats \
  src/controllers/API/queries/agentic/__tests__/use-post-assist-stream.test.ts \
  src/pages/FlowPage/components/flowBuildingComponent/__tests__/index.test.tsx \
  src/pages/FlowPage/components/PageComponent/__tests__/read-only-contract.test.ts \
  src/CustomNodes/NoteNode/__tests__/note-node-utils.test.ts)
(cd src/frontend && npm run i18n:check)
(cd src/frontend && npm run type-check:production)
(cd src/frontend && npm run build)

run_browser_gate() {
  local feature_flag="$1"
  local restore_only="$2"
  local title_pattern="$3"

  (
    cd src/frontend
    OPENAI_API_KEY=stage05-local \
    OPENAI_API_BASE=http://127.0.0.1:18765/v1 \
    OPENAI_BASE_URL=http://127.0.0.1:18765/v1 \
    STAGE05_OPENAI_PORT=18765 \
    KETOS_MVP_RUN_DIR="$run_root" \
    STAGE05_EVIDENCE_ROOT="$run_root/screenshots" \
    KETOS_FEATURE_MVP_CHAT="$feature_flag" \
    STAGE05_RESTORE_ONLY="$restore_only" \
    npx playwright test tests/core/integrations/board-copilot-chat.spec.ts \
      --config=playwright.mvp.config.ts \
      --project=chromium \
      --grep "$title_pattern"
  )
}

run_browser_gate true false "real API and DB preserve two chats"
run_browser_gate false false "mvp_chat off hides UI"
run_browser_gate true true "mvp_chat re-enable restores"

git diff --check "$stage_base_sha"...HEAD
git diff --name-only "$stage_base_sha"...HEAD > "$run_root/changed-paths.txt"
if git diff --name-only "$stage_base_sha"...HEAD | rg \
  '(^|/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|LICENSE|NOTICE)$|(^|/)(vendor|deploy|deployment|graphify-out)/'; then
  exit 1
fi
test -z "$(git status --porcelain)"
