# Stage 02 — W0 implementation input

Stage 02 implementation status: NOT STARTED

This document is planning evidence only. It does not authorize a source edit, a
migration, a backfill, or a release. Stage 02 remains gated by the Stage 01
`NO-GO` verdict until every Stage 01 transition criterion is accepted.

## Ordering and registrar contract

The mandatory order is W0-A → W0-B → W0-C → W0-D. Cross-domain changes must be
registered in the route/capability inventory, the requirement matrix, the risk
register, and the release/rollback checklist before implementation. The
Security owner is the final registrar for actor, capability, egress, secret,
and rollback-floor changes. The Data owner is the registrar for schema,
census, quarantine, and backfill changes. The API owner is the registrar for
routes and anti-enumeration behavior. The Release owner records feature flags,
observation windows, and rollback commands.

## W0-A — Job ownership and safe rollback floor

- Owner: Backend/Data owner; independent approval by Security owner.
- Dependencies: accepted NULL census; explicit attribution policy; accepted
  minimum safe application version; write freeze or repeatable transaction for
  backfill; no unclassified NULL rows.
- Implementation tasks: make `create_job(user_id)` non-null; prove every
  production writer passes the server-derived actor; remove ordinary
  fail-open `Job.user_id IS NULL` reads; correct the dead `created_at` query;
  introduce quarantine state only if the data decision requires it; perform
  dry-run, attributable backfill, ambiguous/orphan quarantine, validation, and
  only then the compatible constraint strategy.
- Focused tests: service type/runtime rejection of null owner; writer call-site
  tests; wrong-owner and NULL-owner 404/403 tests; census conservation equation;
  migration upgrade/downgrade on a copied database; rollback-floor replay.
- Rollback: stop writes, retain the forward-compatible additive schema and
  ownership classification, disable new features, and roll back only to the
  independently accepted security floor. Never restore fail-open reads.
- Registrar: Data registers migration/backfill; Security signs safe floor;
  Release registers flag and observation state.

## W0-B — registered run and mutation surfaces

- Owner: API/Auth owner; independent approval by Security owner.
- Dependencies: W0-A owner-safe Jobs; complete registered-route inventory;
  approved anti-enumeration contract; direct-name fixture below.
- Implementation tasks: enforce current user, Flow EXECUTE, and
  `mcp_enabled=true` for list and direct MCP calls; scope OpenAI Responses;
  contain agentic apply; close webhook owner impersonation outside the explicit
  legacy profile; align workflow-v2 owner rules; cover build/public-build risk.
- Focused tests: the MCP direct-name matrix; response size/stream and trace
  ownership tests; multi-user `auto_apply`/`skipAll` denial; webhook profile
  tests; workflow-v2 POST/GET/stop parity; build secret/custom-code/rate tests.
- Rollback: disable the affected surface with a server-side flag while keeping
  all authn/authz fixes and data changes. No rollback may re-enable AUTO_LOGIN
  bypass, credential-free webhook impersonation, or NULL-owner reads.
- Registrar: API registers every route/method; Security registers actor source,
  capability, and risk; Release registers flags and emergency commands.

## W0-C — custom code and filesystem capabilities

- Owner: Runtime/Platform owner; independent approval by Security owner.
- Dependencies: W0-B actor/capability kernel; inventory of user components,
  Python REPL, uploads, agentic files, and flow filesystem save paths.
- Implementation tasks: fail closed on custom components in network profiles;
  keep Python REPL disabled pending isolated-runner ADR; add exploit corpus;
  prohibit domain mutation through filesystem; enforce scoped roots, quotas,
  types, audit, and traversal protection for user files.
- Focused tests: profile/paths-override denial; `os`, `subprocess`, `open`, env,
  socket, fork/resource, and object-graph escape corpus; symlink/traversal tests;
  quota/type/audit tests; negative domain-mutation tests.
- Rollback: disable custom code and file capabilities; preserve restrictive
  defaults, audit records, and any additive schema. Never roll back to an
  unrestricted interpreter or filesystem root.
- Registrar: Platform registers runner/filesystem boundaries; Security accepts
  exploit corpus and default profile; Release owns capability kill switches.

## W0-D — egress, secrets, and task backend

- Owner: Platform/Security owner; Task owner for worker configuration.
- Dependencies: W0-B actor/capability kernel; W0-C execution boundary; complete
  raw-client, secret-export, and task-backend inventories.
- Implementation tasks: classify every raw HTTP client; route user-controlled
  URLs through validation plus redirect revalidation and DNS-pinned transport;
  add raw-client policy; enforce secret canary non-disclosure; fail startup for
  unsupported task backends and require JSON-only serialization.
- Focused tests: raw-client allowlist; redirect/DNS-rebinding/private-address
  cases; canary scans of public/shared Flow, export, FlowVersion, MCP, errors,
  logs, traces, and execution results; task startup/credentials/dispatch/revoke
  and serialization tests.
- Rollback: disable egress and async dispatch independently; preserve secret
  redaction, pinned transport, and fail-closed startup. Never restore an unsafe
  raw client or permissive serializer.
- Registrar: Platform registers clients/transports; Security registers egress
  and secret policy; Task owner registers backend contract; Release registers
  kill switches and observation evidence.

## Stage 02 entry gate

No W0 implementation task may start until Stage 01 is `GO`, the independent
security and compliance reviewers sign the baseline, the route matrix has zero
unreviewed rows, a safe rollback floor is named, and reproducible package
coverage plus the required telemetry observation window exist.
