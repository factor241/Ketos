# Ketos MVP Stage 10 handoff

## Management transition status

The original transition decision was recorded on `2026-07-25` at planning SHA
`4c98c0beffac69e1864b1e2651df55b1ee1319a3`. On `2026-07-26`, with repository
HEAD `0437da66c6934297ccf464337d2a86921d398c6f` observed before this
documentation update, the user explicitly reaffirmed acceptance of all stages
preceding
`docs/superpowers/plans/2026-07-25-unified-board-workspace-version-convergence.md`
for transition.

- Status: `ACCEPTED FOR TRANSITION`.
- Authority: explicit user management decision.
- Effect: Stage 09/10 technical STOP-gates do not block the unified Board plan.
- Non-effect: this does not alter raw evidence, change any raw `FAIL`, fill a
  missing monitor tail, create a seal/receipt, or claim technical Stage 10
  `PASS`.
- Accepted historical debt: the latest Stage 10 candidate remained unsealed;
  `backend-package` and `frontend-full` lacked strict full-gate acceptance; the
  final receipt was absent.

This runbook reproduces the final Ketos MVP vertical-slice acceptance. It does
not start a Stage 11. Runtime evidence belongs only in the approved external
bundle; it must never be committed to the source tree.

## Frozen identities

- Stage 09 base: `18a2a2a9518d23c589c6700c322ad5844adce932`.
- Tested source: the clean `S10_CODE_SHA` captured before acceptance.
- AI adapter: `OpenAI`.
- AI upstream: `CometAPI`.
- Base URL: `https://api.cometapi.com/v1`.
- Model: `deepseek-v4-flash`.
- PostgreSQL: `postgres:16` pinned by the preflight RepoDigest.
- Evidence root: `/Volumes/Projects/.ketos-stage10-evidence`.
- Immutability control: APFS `uchg`.
- Absolute system-used-memory ceiling: `16_000_000_000` bytes.

Ollama, fallback models, browser-side credentials, mock responses presented as
live proof, provider-specific Ketos routing, and any Stage 11 work are
forbidden.

## Security prerequisites

The retained secret file is
`/Volumes/Projects/.ketos-stage10-secrets/cometapi.env`. Its parent must be
owned by the current user with mode `0700`; the regular file must have mode
`0600`, no ACL and no symlink. It contains exactly one
`COMETAPI_KEY=<value>` line. The loader parses that line without `source` or
`eval`, exposes it only as `OPENAI_API_KEY` to the owned child, and sets
`OPENAI_BASE_URL=https://api.cometapi.com/v1` as a constant. Never place the
value in command arguments, stdout, logs, the database, Docker or evidence.

Before any Docker command, run the repository external-storage guard. The
PostgreSQL container has one loopback-only random port, one bind mount under
`/Volumes/Projects/.ketos-disposable-postgres`, no Docker volumes, SCRAM
authentication, and a digest-pinned `postgres:16` image.

## Freeze and fresh acceptance

From the Stage 10 worktree:

```bash
uv run python scripts/mvp/stage10_acceptance_controller.py \
  --repo-root /Volumes/Projects/ketos_canvas_mod_main \
  --publication-id 20260724T140346Z-48988 \
  --json

test -z "$(git status --porcelain=v1)"
export S10_CODE_SHA="$(git rev-parse HEAD)"
test "$(git merge-base "$S10_CODE_SHA" 18a2a2a9518d23c589c6700c322ad5844adce932)" = \
  18a2a2a9518d23c589c6700c322ad5844adce932
git diff --check 18a2a2a9518d23c589c6700c322ad5844adce932..."$S10_CODE_SHA"

export KETOS_STAGE10_ACCEPTANCE_RUN_DIR="$(mktemp -d /Volumes/Projects/.ketos-stage10-acceptance.XXXXXX)"
export KETOS_DATA_DIR="$KETOS_STAGE10_ACCEPTANCE_RUN_DIR/data"
export KETOS_DATABASE_URL="sqlite:///$KETOS_STAGE10_ACCEPTANCE_RUN_DIR/ketos-mvp.sqlite"
mkdir -p "$KETOS_DATA_DIR"
test ! -e "$KETOS_STAGE10_ACCEPTANCE_RUN_DIR/ketos-mvp.sqlite"
test ! -e "$KETOS_DATA_DIR/mvp/langgraph-checkpoints.sqlite3"

export KETOS_MVP_EVIDENCE_ROOT=/Volumes/Projects/.ketos-stage10-evidence
export KETOS_MVP_EVIDENCE_OWNER=kirillustuzanin
export KETOS_MVP_EVIDENCE_RETENTION_POLICY=forever
export KETOS_MVP_EVIDENCE_SEAL_CONTROL=apfs-uchg
export KETOS_STAGE10_RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
export KETOS_STAGE10_EVIDENCE_BUNDLE="$KETOS_MVP_EVIDENCE_ROOT/.candidate-$KETOS_STAGE10_RUN_ID"
export KETOS_STAGE10_FINAL_BUNDLE="$KETOS_MVP_EVIDENCE_ROOT/stage-10/$S10_CODE_SHA/$KETOS_STAGE10_RUN_ID"
export KETOS_STAGE10_SEAL_RECEIPT="$KETOS_MVP_EVIDENCE_ROOT/receipts/stage-10/$S10_CODE_SHA/$KETOS_STAGE10_RUN_ID"
test ! -e "$KETOS_STAGE10_EVIDENCE_BUNDLE"
test ! -e "$KETOS_STAGE10_FINAL_BUNDLE"
test ! -e "$KETOS_STAGE10_SEAL_RECEIPT"
mkdir -m 0700 -p \
  "$(dirname "$KETOS_STAGE10_FINAL_BUNDLE")" \
  "$(dirname "$KETOS_STAGE10_SEAL_RECEIPT")"
mkdir -m 0700 -p "$KETOS_STAGE10_EVIDENCE_BUNDLE/product-design/1440x900"
```

Do not reuse a development DB, saver, entity, provider run, PID or screenshot.
Any source fix after this point requires a new commit, new SHA, new acceptance
root, new evidence bundle, and a complete restart of this sequence.

## RAM guard

Capture the baseline before gates:

```bash
uv run python scripts/mvp/stage10_ram_guard.py baseline \
  --output "$KETOS_STAGE10_EVIDENCE_BUNDLE/memory-baseline.json"
```

Every gate is sequential and is supervised by
`scripts/mvp/stage10_ram_guard.py run`. The primary metric is system used
memory (`total - available`); aggregate process RSS is attribution evidence,
not physical-memory truth.

- `13_500_000_000` bytes for three one-second samples: warning; do not admit
  another gate and keep concurrency at one.
- `14_750_000_000` bytes for two samples: terminate only the attributed Stage
  10 process group with `TERM`.
- `15_250_000_000` bytes once, or critical memory pressure: emergency
  termination of that group.
- `16_000_000_000` bytes once: acceptance is invalid.
- Two missed samples: fail closed as `MONITOR_LOST`.
- Admission/recovery requires 30 seconds below `13_000_000_000` with no
  pageout/swapout growth.
- Monitoring continues for 30 seconds after the gate.
- `KILL` is allowed only after 15 seconds and a repeated PID/start
  time/owner/PGID/command-hash identity check.

The final bundle contains the combined `memory-monitor.jsonl`,
`pid-ledger.json`, `memory-baseline.json`, and `ram-summary.json`. A PASS
summary has zero monitor losses, zero stop/emergency trips, no measurement at
or above 16 billion bytes, and no surviving attributed child.

## Deterministic acceptance order

Run the following commands exactly once against the fresh acceptance state.
Record command array, cwd, start/end, exit code, skip count, `S10_CODE_SHA`,
redacted artifact path and verdict for each entry in `gate-results.json`.

```bash
uv run python -c '
import os
from alembic import command
from alembic.config import Config

config = Config()
config.set_main_option("script_location", "src/backend/base/ketos/alembic")
config.set_main_option(
    "sqlalchemy.url",
    os.environ["KETOS_DATABASE_URL"].replace(
        "sqlite:///",
        "sqlite+aiosqlite:///",
        1,
    ),
)
command.upgrade(config, "head")
'

uv run python scripts/mvp/seed_vertical_slice.py \
  --database-url "$KETOS_DATABASE_URL" \
  --seed-key stage10-acceptance \
  --output-seed-manifest "$KETOS_STAGE10_ACCEPTANCE_RUN_DIR/seed-first.json" \
  --assert-canonical-saver-path
uv run python scripts/mvp/seed_vertical_slice.py \
  --database-url "$KETOS_DATABASE_URL" \
  --seed-key stage10-acceptance \
  --output-seed-manifest "$KETOS_STAGE10_ACCEPTANCE_RUN_DIR/seed-second.json" \
  --assert-canonical-saver-path

uv run pytest \
  src/backend/tests/integration/test_mvp_vertical_slice.py \
  src/backend/tests/integration/test_mvp_restart_recovery.py -q

MIGRATION_VALIDATION_CI=1 uv run pytest \
  'src/backend/tests/unit/alembic/test_migration_execution.py::test_no_phantom_migrations[sqlite]' \
  'src/backend/tests/unit/alembic/test_migration_execution.py::test_upgrade_from_main_branch[sqlite]' -q

MIGRATION_VALIDATION_CI=1 KETOS_TEST_DATABASE_URI="$MVP_POSTGRES_URI" uv run pytest \
  'src/backend/tests/unit/alembic/test_migration_execution.py::test_no_phantom_migrations[postgres]' \
  'src/backend/tests/unit/alembic/test_migration_execution.py::test_upgrade_from_main_branch[postgres]' -q

(cd src/kfx && uv run --isolated --frozen --package kfx pytest \
  tests/unit/test_flow_builder_tools.py tests/unit/test_flow_builder.py -q)
uv run pytest src/compat/lfx/tests/test_lfx_compatibility.py -q

(cd src/frontend && npm test -- --runInBand \
  src/pages/BoardPage \
  src/components/core/board \
  src/components/core/assistantPanel \
  src/components/core/appHeaderComponent/__tests__/header-visibility.test.ts \
  src/components/core/appHeaderComponent/__tests__/app-header-visibility-contract.test.ts \
  src/pages/SettingsPage/__tests__/SettingsPage.test.tsx)
(cd src/frontend && npm run i18n:check)
(cd src/frontend && npm run type-check:production)
(cd src/frontend && npm run build)

test ! -e "$KETOS_STAGE10_EVIDENCE_BUNDLE/entity-ledger.json"
(
  cd src/frontend
  KETOS_STAGE10_ACCEPTANCE_MODE=1 \
  KETOS_MVP_RUN_DIR="$KETOS_STAGE10_ACCEPTANCE_RUN_DIR/playwright" \
  KETOS_STAGE10_ENTITY_LEDGER="$KETOS_STAGE10_EVIDENCE_BUNDLE/entity-ledger.json" \
  S10_CODE_SHA="$S10_CODE_SHA" \
  ./node_modules/.bin/playwright test \
    -c playwright.mvp.config.ts \
    tests/core/features/ketos-mvp-vertical-slice.spec.ts \
    --project=chromium --workers=1
)

uv run python scripts/mvp/run_live_ai_smoke.py \
  --database-url "$KETOS_DATABASE_URL" \
  --assert-canonical-saver-path \
  --entity-ledger "$KETOS_STAGE10_EVIDENCE_BUNDLE/entity-ledger.json" \
  --evidence "$KETOS_STAGE10_EVIDENCE_BUNDLE/live-ai-smoke.json"
```

The browser story alone owns the four-PID restart proof. It must show both old
listeners dead, two different replacement PIDs, new backend/frontend
readiness, canonical saver persistence, reject with zero Flow effects, and a
fresh approve with exactly one revision/CAS/audit effect.

The live gate separately proves authorized exact-model discovery, a real reply,
a typed tool call and follow-up, Ketos `/check-config` through adapter
`OpenAI`, a durable real reply, reject zero effect, and approve one effect.
The direct SDK preflight proves `thinking.enabled` and
`reasoning_effort=high`; do not claim the Ketos adapter sent those parameters
unless separately observed.

Run the full backend package and full frontend corpus sequentially under the
same guard. No PostgreSQL migration skip is accepted.

## Product Design, Chrome and Computer Use

On the still-running frozen candidate at viewport `1440×900`:

1. Product Design audits the complete happy path, error/blocking states,
   hierarchy and focus affordances.
2. Chrome checks DOM semantics, accessibility, console/network, Settings,
   feature flags, focus and Escape return.
3. Computer Use checks visible layout, desktop window/viewport and keyboard
   focus behavior.

There must be no open P0/P1/P2. Capture exactly:

```text
product-design/1440x900/01-board-note-chat.png
product-design/1440x900/02-automation-result.png
product-design/1440x900/03-ai-preview-confirmation.png
product-design/1440x900/04-settings-entry.png
product-design/1440x900/05-restored-board.png
```

Record hashes and byte sizes in
`product-design-screenshot-manifest.json`, validated by the committed schema.

## Evidence validation and immutable seal

Create `final-journal.json` with all eight required sections,
`final-report.md`, structured `repo-after-full.json` with an empty
`changed_paths` array and `matches_before: true`, exact
`tooling-provenance.json` for the reviewed generic sealer, plus the tracked
immutable probe:

```bash
printf '%s\n' 'stage10 immutable seal probe' > \
  "$KETOS_STAGE10_EVIDENCE_BUNDLE/seal-probe.txt"
chmod 0600 "$KETOS_STAGE10_EVIDENCE_BUNDLE/seal-probe.txt"
```

Confirm the frozen worktree is still clean, then:

```bash
test "$(git rev-parse HEAD)" = "$S10_CODE_SHA"
test -z "$(git status --porcelain=v1)"

uv run python scripts/mvp/validate_evidence_bundle.py \
  --bundle "$KETOS_STAGE10_EVIDENCE_BUNDLE" \
  --schema-dir docs/dev/handoff/evidence/stage-10 \
  --s10-code-sha "$S10_CODE_SHA" \
  --owner "$KETOS_MVP_EVIDENCE_OWNER" \
  --retention-policy "$KETOS_MVP_EVIDENCE_RETENTION_POLICY" \
  --deny-secrets \
  --write-no-secret-report "$KETOS_STAGE10_EVIDENCE_BUNDLE/no-secret-qa.json" \
  --write-manifest "$KETOS_STAGE10_EVIDENCE_BUNDLE/manifest.json" \
  --intended-final-bundle "$KETOS_STAGE10_FINAL_BUNDLE"

(cd "$KETOS_STAGE10_EVIDENCE_BUNDLE" && shasum -a 256 manifest.json > manifest.sha256)

uv run python scripts/mvp/seal_evidence_bundle.py \
  --source-bundle "$KETOS_STAGE10_EVIDENCE_BUNDLE" \
  --final-bundle "$KETOS_STAGE10_FINAL_BUNDLE" \
  --control "$KETOS_MVP_EVIDENCE_SEAL_CONTROL" \
  --manifest-sha-file "$KETOS_STAGE10_EVIDENCE_BUNDLE/manifest.sha256" \
  --owner "$KETOS_MVP_EVIDENCE_OWNER" \
  --retention-policy "$KETOS_MVP_EVIDENCE_RETENTION_POLICY" \
  --verify-final-no-secrets \
  --receipt-directory "$KETOS_STAGE10_SEAL_RECEIPT" \
  --s10-code-sha "$S10_CODE_SHA" \
  --frozen-product-worktree "$PWD" \
  --frozen-schema "$PWD/docs/dev/handoff/evidence/stage-10/evidence-manifest.schema.json"
```

The validator rejects symlinks, non-regular files, schema/SHA/owner/retention
mismatch, screenshot tampering, RAM failure and high-confidence secrets. The
manifest uses only relative artifact paths, binds the intended final path, and
hashes every pre-manifest artifact. The thin Stage 10 adapter reuses the exact
reviewed generic sealer: it creates an inode-distinct copy, publishes it
without replacement, applies files `0400`, directories `0500`, recursive APFS
`uchg`, and requires all eight create/overwrite/truncate/chmod/mtime/rename/
unlink/root-rename probes to fail. Only then does it atomically publish and
recursively protect the separate receipt directory and checksum.

On final PASS, remove the exact PostgreSQL container and its exact disposable
directory after another external-storage guard. On FAIL/BLOCKED, stop the
container and retain PGDATA for diagnosis.

## Closure rule

`PASS` means A01–A10, deterministic/backend/frontend/PostgreSQL, one Chromium
story, Product Design/Chrome/Computer Use, real CometAPI/Ketos live path,
security/secrecy, RAM and APFS seal all passed on one clean `S10_CODE_SHA`.
This closes the MVP. It does not authorize a Stage 11.
