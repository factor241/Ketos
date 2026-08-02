# Stage 07 — Board Automation execution

## Scope and identity

Stage 07 adds a session-authenticated Board facade over the existing workflow
execution domain. It does not add an Execution table or runner:

`Project = Folder`, `Automation = Flow`, `Execution = Job`, and a Result card is
`Placement(target_kind="job_result", target_id=Job.job_id)`.

The browser never supplies an API key, actor, Flow payload, executor settings,
component allowlist, globals, or secrets. `CurrentActiveUser.id` is the actor.
The backend and frontend use the same default-off `agentic_experience` runtime
gate exposed by `/api/v1/config`. Turning the gate off hides execution actions;
it does not delete Jobs, Flows, Boards, or Placements.

## Session v1 routes

All routes are registered once under
`/api/v1/boards/{board_id}/automations/{flow_id}/runs`:

| Method | Suffix | Result |
| --- | --- | --- |
| `POST` | `` | `202 BoardExecutionRead` claim/replay |
| `GET` | `` | newest-first bounded history (`limit=1..50`) |
| `GET` | `/{job_id}` | authoritative status/result |
| `POST` | `/{job_id}/cancel` | server-authoritative cancel |

The create body contains only `idempotency_key`, matching
`^[A-Za-z0-9._:-]{1,128}$`; extra fields are rejected. Resource checks are
feature gate → Board owner → Flow owner and same Project → exact non-null Job
owner/type/Flow/Board metadata. Foreign, null-owner, malformed, and mismatched
resources share the same not-found surface.

`BoardExecutionRead.status` is exactly `queued | running | succeeded | failed |
cancelled`. `unknown` is a client-only presentation state when no authoritative
response is available. Results are either bounded text or JSON plus a
`truncated` flag. The reserved `backend_restarted` reason is parseable and
localized, but Stage 07 never emits it.

## Deterministic claim and metadata

The Job UUID is UUIDv5 over:

```text
namespace = 7a2d1c1e-7f9b-5bd6-9fd9-4f80243c3c55
name = ketos.board-job.v1:{actor_id}:{board_id}:{flow_id}:{idempotency_key}
```

The browser key is never persisted raw. A direct INSERT claims the deterministic
primary key. A matching fingerprint replays the Job without materialization or
enqueue; mismatched or untrusted existing metadata conflicts. The fingerprint
is SHA-256 of canonical JSON containing schema version, actor, Board, Flow,
canonical Flow hash, and `board_default_inputs` mode.

`job_metadata.mvp` contains a versioned `board_automation_run` marker,
Board/Flow IDs, immutable Flow hash, request fingerprint, policy version,
positive origin PID, process-random worker UUID, bounded result/detail, reason,
and redacted audit fields. Terminal status, `finished_timestamp`, result, reason,
detail, and audit are committed together. Same-terminal finalization is a
no-op; incompatible terminal races conflict.

## Prepared execution and one KFX runner

The common workflow service canonicalizes a deep-copied executable payload and
input/context snapshots before execution. Prepared state stores primitive,
immutable data rather than a mutable Graph. Every materialization builds a fresh
`Graph.from_payload` instance, fresh input requests, and a fresh output list.
The authoritative call is exactly one `run_graph_internal(graph, flow_id,
stream, session_id, inputs, outputs, event_manager)`.

| Mode | Auth | Session behavior | Dispatch |
| --- | --- | --- | --- |
| existing v1 session | cookie | preserves explicit/fallback session | existing response/stream contract |
| v2 workflow | API key | preserves v2 sync/background/status contract | existing Job semantics |
| v1 Board | cookie | isolates runtime with `str(job_id)` | existing TaskService and Job |

Runtime mutation cannot change canonical bytes or `flow_hash`. A transport
retry with the same key performs no additional materialization, runner call, or
side effect.

## Board policy

The version-1 allowlist is intentionally narrow: `ChatInput`, `TextInput`,
`Prompt`, `Pass`, `TypeConverterComponent`, `MessagetoData`, `ParseData`,
`CreateData`, `ChatOutput`, and `TextOutput`. Validation recursively checks every
inline node before Job claim, requires a loaded server template registry, and
compares the persisted code against a current trusted server template hash.
Empty, nested-unsafe, custom, unknown, referenced Flow, Python/code, MCP, and
HTTP/egress components fail closed.

The result projector caps depth, mapping/list sizes, strings, and total UTF-8
payload (32 KiB), never splits a code point, rejects unsupported text values,
and redacts compound/camel-case authorization, token, cookie, key, secret, and
password fields. The frontend renders text/JSON only as inert React text or
`pre`; it does not use an HTML renderer.

## UI lifecycle

Each Automation node owns one `useRunAutomation` hook. It restores a bounded
per-Flow history and publishes all known Job DTOs into the Board execution
registry, so old Result cards remain renderable after later runs. Polling occurs
only for queued/running Jobs and stops at terminal state.

```text
idle -> queued -> running -> succeeded
                         -> failed
               -> cancelled
transport ambiguity -> unknown -> authoritative refetch/replay-same-key
```

A terminal authoritative DTO invokes the idempotent Result placement hook.
Existing `(board_id, job_result, job_id)` placement is reused; a unique conflict
refetches and recovers it. Automatic placement never calls focus, selection,
Flow store/undo, or `fitView`. Only explicit keyboard/pointer “Open result”
focuses the Result card. Closing a Result deletes only its Placement and returns
focus to the originating Automation; the Job remains durable.

## Rollback and evolution

Rollback is operational: disable `agentic_experience`. Existing data remains
readable and no schema rollback is required. Stage 07 does not scan or rewrite
legacy active/terminal Jobs and does not claim restart recovery. The
`backend_restarted` DTO/locale value is reserved for a future Stage 09 producer;
its presence here is not restart-readiness evidence.

## Reproduction

```bash
uv run pytest \
  src/backend/tests/unit/services/workflow_execution/test_service.py \
  src/backend/tests/unit/services/jobs/test_board_claim.py \
  src/backend/tests/unit/services/jobs/test_board_finalization.py \
  src/backend/tests/unit/services/jobs/test_board_results.py \
  src/backend/tests/unit/services/jobs/test_board_execution.py \
  src/backend/tests/unit/api/v1/test_board_automation_runs.py \
  src/backend/tests/unit/api/test_board_automation_router_registration.py \
  src/backend/tests/unit/api/v2/test_workflow.py \
  src/backend/tests/unit/services/board/test_job_result_placement.py -q

cd src/frontend
npm test -- --runInBand \
  src/controllers/API/queries/executions \
  src/components/core/board/placements/ResultPlacement.test.tsx
npm run i18n:check
npm run type-check:production
KETOS_AGENTIC_EXPERIENCE=true KETOS_FEATURE_MVP_WORKSPACE=true \
  npx playwright test tests/core/features/board-automation-run.spec.ts \
  --project=chromium --workers=1
```

Browser fixtures obtain trusted component code from the current server
`/api/v1/all` registry. They do not embed a stale template or call Context7.
