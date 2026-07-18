# S01-A05 — Job safe floor report

Status: DONE_WITH_CONCERNS

## Scope and files

Changed only the assigned implementation and test paths:

- `src/backend/base/ketos/services/jobs/service.py`
- `src/backend/tests/unit/services/jobs/test_mvp_job_ownership.py` (new)
- `src/backend/tests/unit/api/v2/test_workflow.py`

No Job model, developer API response, registrar, manifest, lock, generated, or deployment path changed.

## Delivered behavior

- User-authorized list, get, and asset-cancel filters use exact `Job.user_id == user_id` only.
- List ordering uses canonical `Job.created_timestamp`.
- `_validate_ownership` rejects both foreign and `NULL` owners; exact owner succeeds.
- `get_job_by_job_id(..., user_id=None)` remains an explicitly documented system-internal lookup path.
- Existing V2 integration tests now prove NULL-owned GET/stop requests return `404 / JOB_NOT_FOUND`; stop leaves the persisted row `IN_PROGRESS` before cleanup. Existing owner and foreign V2 tests preserve the developer API contract.

## TDD evidence

### RED

Before implementation, `uv run pytest src/backend/tests/unit/services/jobs/test_mvp_job_ownership.py -q -rA` exited `1` with four intended failures:

1. `get_jobs_by_flow_id` raised `AttributeError: created_at`.
2. User-authorized get SQL contained `OR job.user_id IS NULL`.
3. `_validate_ownership` accepted a NULL-owned job.
4. User-authorized in-flight cancellation SQL contained `OR job.user_id IS NULL`.

Three control cases already passed: internal no-user lookup, foreign-owner deny, and exact-owner allow. A first assertion against selected columns was corrected to inspect the SQL `WHERE` clause; the rerun retained only the four expected product failures above.

### GREEN

- `uv run pytest src/backend/tests/unit/services/jobs/test_mvp_job_ownership.py -q -o log_cli=false --disable-warnings` → exit `0`, `7 passed, 1 warning in 0.39s`.
- Required focused command:

  ```bash
  uv run pytest \
    src/backend/tests/unit/services/jobs/test_mvp_job_ownership.py \
    src/backend/tests/unit/api/v2/test_workflow.py -q -o log_cli=false --disable-warnings
  ```

  → exit `0`, `58 passed, 1 warning in 126.66s (0:02:06)`.

- `git diff --check` → exit `0`.
- Focused source scan for `Job.user_id ... is_(None)`, `user_id IS NULL`, and `created_at` in `services/jobs/service.py` → no matches.

## Tool ledger

- Direct source and git: available; used for branch/status, contract tracing, diff review, and scan.
- RaytSystem read-only: available. `raytsystem doctor --root /Volumes/Projects/ketos_canvas_mod_main --json` reported a stale code graph (`checkout_changed`); `status --json` succeeded. It was navigation-only and did not block source work.
- Graphify read-only: unavailable in this lane because `graphify-out/graph.json` is absent. Exact attempted query was `graphify query "How do Job service ownership checks and workflow API stop cancel list get operations connect?" --budget 1000`; no rebuild was performed. Impact: none; direct-source tracing covered the owned paths.
- Context7/web/Chrome: not relevant to this backend-only, dependency-neutral ownership floor; not invoked.
- Ruff: import-order check was fixed. Full focused Ruff check still exits non-zero solely with `INP001`, because the assigned new test path is an existing implicit namespace package and adding `__init__.py` is outside the owned paths. This is the reason for `DONE_WITH_CONCERNS`; it does not affect the executable focused gate.

## Self-review

- Confirmed user-context paths are fail-closed and no longer include NULL ownership.
- Confirmed no-user lookup is not treated as a user-authorized query.
- Confirmed V2 NULL stop is denied before a persisted-row status mutation.
- Confirmed existing owner-success/foreign-deny coverage remains in `TestWorkflowIDORProtection`.

## Commit

Current `HEAD` (`fix: fail closed job ownership lookups`) on `codex/mvp-s01-a05-job-floor`; the immutable SHA is included in the task handoff.
