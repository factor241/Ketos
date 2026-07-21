# Stage 08 gate runbook

## Outcome

`scripts/ci/run-stage08-gate.sh` executes the Stage 08 closure against one clean, frozen Git SHA and writes all runtime output outside the repository. Valid statuses are `PASS`, `FAIL`, and `BLOCKED`; no skipped mandatory node can produce PASS.

The external key is `stage-08/<S08_CODE_SHA>/<RUN_ID>`. A run leaf is create-if-absent and is never reused. The final manifest inventory and detached seal make later mutation detectable. The seal is an integrity receipt, not a cryptographic signature.

## Inputs

```bash
export S08_CODE_SHA="$(git rev-parse HEAD)"
export S08_EVIDENCE_ROOT=/absolute/path/outside/the/repository
source /absolute/path/to/postgres/connection.env

scripts/ci/run-stage08-gate.sh init \
  --code-sha "$S08_CODE_SHA" \
  --evidence-root "$S08_EVIDENCE_ROOT"

scripts/ci/run-stage08-gate.sh run-all \
  --code-sha "$S08_CODE_SHA" \
  --evidence-root "$S08_EVIDENCE_ROOT"
```

The runner never prints `MVP_POSTGRES_URI`. PostgreSQL absence or connection preflight failure is `BLOCKED`; an available PostgreSQL with a behavioral failure is `FAIL`.

## Safety rules

Before every node, the runner proves `HEAD == S08_CODE_SHA` and an empty `git status --short`. The evidence root must be absolute and outside the repository. The runner refuses an existing sealed leaf, never writes results under the worktree, preserves the tested command exit through log capture, and creates the seal last.

If a test or build creates repository dirt, the next assertion blocks the run. Fix the product/tool configuration, commit a new code SHA, and start a new evidence run; do not edit or append to a sealed run.

## Node order

1. `provenance`: SHA/clean assertions, one Alembic head, installed dependency versions, read-only Graphify/RaytSystem diagnostics.
2. `dependency-probes`: pinned Stage 01 AG-UI backend and CopilotKit frontend probes.
3. `migration-sqlite`: Stage 08 migration/model/phase execution on a disposable SQLite file outside the repository.
4. `migration-postgres`: migration/model/phase execution on disposable PostgreSQL.
5. `backend-focused`: command services, API, Flow Builder proposal/HITL, AG-UI confirmation, and SQLite integration story.
6. `postgres-behavioral`: independent connections, distinct PIDs, synchronized races, idempotency and pre/post-interrupt phase preservation with zero skips.
7. `flow-version`: existing CRUD/API regressions plus pinned prune/delete protection.
8. `kfx-lfx`: isolated frozen KFX tests, LFX compatibility, and base-to-candidate ABI diff.
9. `frontend`: Chat confirmation/query/legacy regression tests, i18n checks, and production typecheck.
10. `negative-guards`: backend/frontend no-bypass runtime tests and zero-match source scans.
11. `browser`: Chromium acceptance story with screenshots and redacted request trace written outside the repository.
12. `repository`: `make lint`, `git diff --check`, forbidden/unrelated diff scan, final SHA/clean proof.
13. `evidence`: validate committed JSON schemas, write report/manifest, hash inventory, and seal.

Nodes run sequentially after focused development checks. A general package gate does not replace a focused or browser node.

## Node records

Every node record includes safe command text, UTC start/end, raw exit code, classification, log path/hash, and artifact paths. PostgreSQL evidence additionally records redacted connection fingerprint, distinct backend PIDs, barrier identity/timing, before/after counts/revisions/hashes, outcomes, and `0 skipped`. Browser evidence records Chrome/Chromium version, locale, visible state, screenshots, console summary, and a redacted resume body proving it contains the decision but no nodes, edges, parameters, operations, canonical payload, or patch.

## Classification

- `PASS`: command exit 0 and every required artifact validates.
- `FAIL`: assertion, test, typecheck, lint, migration behavior, ABI diff, security guard, browser acceptance, or schema validation fails after its prerequisite is available.
- `BLOCKED`: a mandatory external prerequisite is absent/unreachable, the frozen SHA/clean invariant is lost, or the required runtime cannot be exercised truthfully.

The runner may continue safe diagnostic nodes after a failure, but the aggregate status can never improve to PASS. Mandatory nodes are never silently skipped.

## Sealing and reruns

The report and manifest are written only after nodes finish. File hashes exclude the detached seal and avoid a self-referential manifest digest. The detached `SEAL.json` stores the manifest SHA-256, frozen SHA, run ID, status and seal timestamp. Files are made read-only after the seal where supported.

Any fix changes `S08_CODE_SHA`. Create a new run leaf and execute the whole gate again. Repository pointer commits, if ever created, are metadata-only and explicitly `NOT TESTED`; they do not replace the code SHA or external bundle.
