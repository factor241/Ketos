# Unified Board Workspace — Block D Status

| Field | Value |
| --- | --- |
| Date | `2026-07-27` |
| Candidate SHA | `PENDING FINAL EXACT-SHA SEAL` |
| Scope | Block D, Tasks D1–D6 |
| Technical status | `PARTIAL — FINAL LOCAL SEAL IN PROGRESS` |
| Next stage | `NOT ADMITTED` |

## Prior plan blocks and predecessor boundary

Blocks A, B, and C are technically complete at their recorded implementation
commits:

- A: `ef9bfaf9254d8f19b16336efcdef9e67d7ab720a`;
- B: `69e92b8f03b6601e03270622f5c762d1d2f91956`;
- C: `cc685550f00ec6dbeb258da0a43864993182e677`.

This is distinct from the management-only `ACCEPTED FOR TRANSITION` status of
stages that preceded the current plan. Their raw historical debt remains
recorded and is not relabelled as technical PASS.

## Implemented candidate

- Server-side workspace and Board-chat kill-switch guards execute before
  resource lookup, command service entry, or writes.
- Explicit false preserves legacy Board/Flow reads and legacy project-chat
  behavior while new compound creation fails closed with a non-enumerating
  `404`.
- Additive migration tests cover fresh PostgreSQL, mixed legacy records,
  receipt constraints/indexes, application reads, and clean-database downgrade.
- Component, route, accessibility, and seven-file Playwright matrices cover
  wizard starters, navigation, editor return, Board execution, Board/Flow chat
  separation, responsive layouts, focus restoration, and explicit flag-off
  behavior.
- The operational runbook requires external false before backend startup and
  readiness, migration-first deployment, dark backend/frontend smokes,
  workspace-then-chat canaries, metadata-only telemetry, zero-tolerance
  safety stops, and application/flag rollback without destructive downgrade.

## Candidate evidence collected before the final seal

- D1 focused backend matrix: `102 passed`, no skips/xfails.
- D2 PostgreSQL 16 migration matrix: `29 passed`; Alembic reports sole head
  `ubw01cmdrec`.
- D3 focused frontend matrix: `67 passed`.
- D4 unified Chromium matrix: `15 passed`, `2` intentional controlled
  flag-off skips, no unexpected HTTP or console failure.
- Full backend: `11045 passed`, `464 skipped`, `11 xfailed`, exit `0`.
- Full frontend Jest: `531` suites / `5853` tests, exit `0`.
- Full TypeScript and Biome checks pass; Biome reports only the existing
  `38` warnings.
- Legacy E2E: `14 passed`; post-Radix file-upload E2E: `4 passed`.

These results are working evidence only until repeated and bound to the exact
candidate SHA. The final technical status and exact counts are updated only
after all package gates, current-runtime proof, Chrome audit, and seal
integrity checks complete.

## Rollout boundary

No production rollout is claimed. The repository provides an executable
release runbook and fail-closed command guards. Production acceptance still
requires deployment-system evidence for the target release SHA as specified
in `UNIFIED_BOARD_ROLLOUT_ROLLBACK.md`.

The literal D6 deployment gates therefore remain unchecked. Local
rollout-readiness is not production deployment, and the overall plan status
remains `PARTIAL` even if every local D1–D5 gate passes.

## Dirty-state boundary

The user-owned untracked `outputs/` directory is outside this candidate and
remains untouched. Task-owned temporary databases, browser artifacts, and
runtime directories are removed after final verification.

## Continuation — 2026-07-27

The 2026-07-26 full backend single-worker attempt reached approximately 81%,
but the Codex session restarted before pytest produced a terminal result. Its
temporary log and process state were lost. That attempt is non-terminal and is
not PASS evidence.

After restarting local Redis, a fresh authoritative full backend attempt was
started on 2026-07-27 with:

```bash
env -u LANGGRAPH_STRICT_MSGPACK make unit_tests async=false ff=true
```

That invocation completed with `11045 passed`, `464 skipped`, `11 xfailed`,
and exit `0`.

The user separately authorized a coordinated Radix dependency update and the
corresponding `src/frontend/package-lock.json` change after the canonical
browser path reproduced the upstream React 19 Presence/composed-ref recursion.
The focused file-upload path now passes `4/4`, and the full Jest, full
TypeScript, and full Biome gates are green. The dependency authorization and
these focused results do not replace the still-running canonical full
Playwright gate or the final exact-SHA seal.
