# Unified Board Workspace — Rollout and Rollback Runbook

This runbook controls activation of the Unified Board compound-command
surface. It does not authorize a production deployment by itself. The release
owner must bind every recorded observation to one release SHA and retain the
deployment-system evidence.

## Safety invariants

- The additive Alembic revision `ubw01cmdrec` is deployed before any new
  compound command is enabled.
- The external production values of
  `KETOS_FEATURE_MVP_WORKSPACE` and `KETOS_FEATURE_MVP_CHAT` are both the
  literal string `false` before the first new backend process starts.
- Missing, empty, malformed, or unapproved flag values fail deployment
  admission. They must never fall through to the product's current default-on
  values.
- No new backend instance receives readiness or user traffic until its
  effective public configuration reports both flags as `false`.
- Board chat requires both workspace and chat flags. Workspace commands require
  the workspace flag.
- Operational rollback disables creation and primary entry points, but keeps
  existing Board, Flow, Placement, note, chat, run, result, and receipt data
  readable.
- Once a command receipt has been written, rollback is application/flag-only:
  do not downgrade below `ubw01cmdrec`, drop the receipt table, or delete
  receipt rows.

## Required release record

Before starting, record:

| Field | Required value |
| --- | --- |
| Release SHA | Exact 40-character Git SHA |
| Alembic head before/after | Exact revision; after must be `ubw01cmdrec` |
| Backend image/build | Immutable identifier bound to the release SHA |
| Frontend image/build | Immutable identifier bound to the release SHA |
| Flag source and revision | Immutable deployment/config revision |
| Release owner | Named accountable operator |
| Start time | UTC timestamp |
| Canary scope | Explicit tenant/project cohort |

Do not proceed with a blank, mutable, or inferred value.

## Rollout sequence

### 1. Establish external fail-closed configuration

1. Write both external production flags as literal `false`.
2. Read the values back from the authoritative deployment source.
3. Reject missing, empty, mixed-case, numeric, or otherwise non-literal
   values.
4. Block readiness and traffic until each new instance reports effective
   `workspace=false` and `chat=false`.

The current product defaults are intentionally on for the supported local
experience. Therefore an omitted production override is an admission failure,
not permission to continue.

### 2. Deploy the additive migration

1. Back up the database according to the existing platform procedure.
2. Apply Alembic through `ubw01cmdrec`.
3. Confirm there is exactly one head and that it is `ubw01cmdrec`.
4. Inspect the receipt unique constraint and indexes.
5. Smoke-read representative pre-existing Flow, Board, Placement, chat, note,
   run, and result records.

Any migration error, multiple head, legacy-read failure, or schema mismatch is
an immediate stop.

### 3. Deploy backend dark

1. Start new backend instances with both external flags still `false`.
2. Before readiness, verify the effective configuration on every instance.
3. Verify representative workspace and Board-chat compound endpoints return
   the non-enumerating disabled `404`.
4. Verify the disabled requests create no Board, Flow, Placement, chat, or
   receipt row and do not enter the command service.
5. Verify existing Board/Flow reads, canonical `/flow/:id`, legacy bridges,
   and legacy project-chat reads/writes still work.

### 4. Deploy frontend dark

Deploy the matching frontend while both flags remain `false`. Confirm new
Board-workspace and Board-chat creation entry points are hidden and that
existing readable data has no blank screen or redirect loop.

### 5. Enable workspace canary

1. Set workspace `true` only for the explicit canary cohort; keep chat `false`.
2. Observe at least 30 minutes and either 100 compound workspace commands or
   the release owner's pre-approved lower-volume sample, recorded before the
   canary starts.
3. Verify authorization, atomic rollback, idempotency replay/conflict,
   editor-return, legacy-route bridge, and legacy reads.
4. Expand only after all zero-tolerance conditions remain at zero and the
   rate thresholds below remain within bounds.

### 6. Enable chat canary

1. Keep workspace `true` for the accepted canary and enable chat only for the
   same or a smaller cohort.
2. Repeat the observation window and sample rule.
3. Verify Board and standalone Flow chat paths remain isolated, durable, and
   non-enumerating across ownership boundaries.
4. Expand workspace and chat independently; acceptance of one never waives a
   stop condition for the other.

## Metadata-only telemetry

Allowed event families:

- compound command started, completed, or failed;
- idempotency replay or conflict;
- transaction rollback;
- editor return success or failure;
- legacy route bridge success or failure;
- authorization denial.

Allowed fields are operation kind, outcome, stable error code, replay boolean,
duration bucket, deployment/build identifier, feature-flag state, and canary
cohort identifier. Do not emit Board or chat titles, note text, prompts,
messages, Flow graphs, node values, request/response bodies, secrets, raw user
IDs, or raw resource IDs.

## Stop conditions

The following have zero tolerance: one observation stops expansion and disables
the affected create flag while preserving reads.

- authorization leak, ownership bypass, or resource-existence disclosure;
- orphan or partial Board/Flow/Placement/chat/receipt write;
- divergent same-key replay or accepted same-key/different-payload request;
- migration failure, schema mismatch, or legacy-read failure;
- redirect loop or loss of canonical `/flow/:id`;
- any instance receiving traffic before effective external false is verified;
- Board chat admitted while either workspace or chat is false;
- telemetry containing user content, payloads, raw IDs, or secrets.

Rate stops, measured over a rolling 15-minute window:

- five consecutive compound-command failures; or
- compound-command `5xx` rate above 1% after at least 100 attempts; or
- editor-return or legacy-bridge failure rate above 0.5% after at least 200
  transitions.

Below the minimum sample, any repeated failure pauses expansion and requires
release-owner review; low volume is not evidence of safety.

## Rollback

1. Set chat `false`, then workspace `false`, in the authoritative external
   configuration.
2. Verify each instance's effective configuration before considering rollback
   complete.
3. Hide new frontend entry points and block new compound-command creation.
4. Preserve all existing reads, `/flow/:id`, legacy routes, and created data.
5. Keep `ubw01cmdrec` and all receipt rows in place.
6. Roll back application builds only to a version that can safely read the
   additive schema.
7. Repeat legacy-read and disabled-command smokes.

If starter cloning alone fails, a bounded mitigation may expose only Clean
Board and blank automation while retaining the same authorization,
transaction, idempotency, and receipt infrastructure. This mitigation requires
its own recorded approval and must not weaken any zero-tolerance condition.

## Completion evidence

Rollout is complete only when the release record contains:

- exact release SHA and immutable build identifiers;
- migration output with sole head `ubw01cmdrec`;
- per-instance effective false evidence before readiness;
- disabled-command no-write smoke;
- workspace then chat canary observations and thresholds;
- metadata-field audit;
- rollback rehearsal or an approved current rehearsal reference.

Until then the release is rollout-ready, not production-accepted.
