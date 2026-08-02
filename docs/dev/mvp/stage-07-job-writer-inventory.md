# Stage 07 Job writer/read/cancel/result inventory

Baseline: `cefa5ec898eda1f944a4758014d624dfe0c7a91d` (Stage 06 PASS). This inventory is the
authorization boundary for `S07-A01`; it does not introduce the Board execution domain owned by later tasks.

## Protected and internal reads

| Path | Caller/auth context | Stage 07 rule |
| --- | --- | --- |
| `JobService.get_jobs_by_flow_id` | user-scoped service call | Exact `Job.user_id == actor`; newest first by `created_timestamp`. |
| `JobService.get_owned_job` and CRUD `get_owned_job_by_job_id` | protected get/result/cancel preflight | Exact `Job.user_id == actor`; foreign and `NULL` rows are indistinguishable from missing. |
| `JobService.get_job_by_job_id_internal` and CRUD `get_job_by_job_id_internal` | trusted backend workers only | Deliberately unscoped and explicitly named. It is not a browser/API authorization helper. |
| `api/v2/workflow.py` status and stop | API-key user | Calls the exact-owner service path before result reconstruction or cancellation. |
| `api/utils/kb_helpers.py::is_job_cancelled` and ingestion tests | trusted worker/internal polling | Calls the explicitly named internal lookup. |

Protected `get_job_by_job_id` requires an explicit owner and has no unscoped default. Protected asset cancellation
likewise requires an explicit owner. New protected callers use these exact-owner paths; trusted callers must name
`get_job_by_job_id_internal` directly.

## Writers and lifecycle owners

| Writer | Current responsibility | Stage 07 treatment |
| --- | --- | --- |
| `JobService.create_job` | Generic Job insert for existing v1 session runs, v2 workflow sync/background, `/build`, knowledge-base and memory-base ingestion | Preserved for legacy callers. The Board atomic deterministic claim is a separate helper in `S07-A02`; it must not use the existing count-before-insert dedupe path. |
| `api/v1/endpoints.py::_run_flow_internal` | Creates an owned `WORKFLOW` Job and wraps `run_graph_internal` | Adapter migration belongs to `S07-A03`; auth/response semantics remain unchanged. |
| `api/v2/workflow.py` | Creates owned `WORKFLOW` Jobs for sync/background requests | Adapter migration belongs to `S07-A03`; status and stop remain exact-owner. |
| `api/build.py` | Best-effort owned Job for authenticated build/memory tracking | Out of the Board API. It retains its existing behavior. |
| `api/v1/knowledge_bases.py`, `services/memory_base/ingestion.py` | Owned ingestion Job creation and cancellation | Separate Job domains; their top-level metadata stays untouched. |
| `JobService.update_job_status` / CRUD `update_job_status` | Generic status/timestamp update | Existing lifecycle compatibility. Board terminal status/result/detail/audit must use the atomic finalizer owned by `S07-A04`. |
| `JobService.update_job_metadata` | Generic shallow/replace metadata writer | Existing domain writer. Board code may only own the nested versioned `job_metadata.mvp` envelope through the Stage 07 claim/finalizer helpers. |
| `JobService.execute_with_status` | Generic execution wrapper with status transitions | Existing routes currently use it. Board completion must move to the `S07-A04` compare-and-set state machine; no terminal rewrite. |
| `JobService.cancel_in_flight_jobs_by_asset` | KB/memory asset cancellation | Protected calls include exact owner; unscoped use remains internal-only. |

## Result readers

- The existing v2 status route first performs an exact-owner Job lookup and then reconstructs a completed workflow
  response from vertex builds.
- Stage 07 Board result serialization is not allowed to reuse a wide legacy renderer or expose raw `job_metadata`;
  `S07-A04` owns the bounded `BoardExecutionRead` projection from `job_metadata.mvp`.
- A `NULL` owner is never a public-read signal and never authorizes result access.

## Public marker separation

Public build access is a different contract in `services/job_queue/service.py`:

- `register_public_job(job_id)` explicitly registers the public-build marker;
- `is_public_job` / `is_public_job_async` check only that marker (in-memory and Redis implementations);
- `cleanup_job` removes that marker;
- `/api/v1/chat.py` public events/cancel paths call `_assert_public_job` before access.

Stage 07 does not change those files or infer public access from `Job.user_id is None`. The four focused
`JobQueueService` marker tests are the executable characterization gate for this separation.

## Transaction boundary note for follow-up tasks

The Board deterministic claim must perform a direct insert. On `IntegrityError`, it must roll back the failed
transaction and read the conflicting row in a fresh session before deciding replay versus conflict. This follows
SQLAlchemy's documented Session transaction contract:
<https://docs.sqlalchemy.org/en/20/orm/session_basics.html#rolling-back>.
