# Unified Board Workspace — Block C Status

| Field | Value |
| --- | --- |
| Date | `2026-07-25` |
| Exact product SHA | `cc685550f00ec6dbeb258da0a43864993182e677` |
| Scope | Block C, Tasks C1–C6 |
| Technical status | `EXACT-SHA PASS` |
| Transition | `BLOCK D ADMITTED` |

## Delivered

- One reusable, accessible Board creation wizard serves the Boards page,
  empty state, and project-scoped plus menu.
- Clean, Simple Agent, Vector Store RAG, and authorized gallery-template
  starters use the atomic Board bootstrap command with a stable
  idempotency-attempt lifecycle.
- Every project row exposes Board and automation creation without changing the
  row-selection contract; automation continuation selects or creates a Board
  and consumes its URL intent once.
- Knowledge Bases and My Files moved into the account menu under their
  existing fail-closed capability rules; the sidebar footer copies are gone.
- Board chat creation is an atomic `ChatThread + Placement + receipt`
  transaction shared by the Board header and chat list.
- The Flow control bar has a real `MessageSquarePlus` action with explicit,
  non-overlapping standalone-Flow and validated Board-return behavior.
- New primary en/ru UI consistently uses Board/Automation terminology while
  retaining compatibility keys for legacy routes.

## Exact-SHA evidence

- Backend starter/chat/API repeat: `31 passed`, exit `0`; the only warning is
  the existing Starlette `TestClient` deprecation.
- Frontend exact-SHA repeat: `13` suites and `93` tests passed, exit `0`.
- The expanded pre-seal C matrix on identical product content passed `14`
  suites and `100` tests.
- i18n gate: `44` Node tests and `72` Jest tests passed.
- Production TypeScript, changed-file Biome, Ruff, and Ruff format check
  passed; Ruff covered all `10` Python files changed from the Block B base.
- Independent C1–C3, frontend chat/canvas, and backend chat-command repeat
  audits returned PASS with no P0/P1/P2 findings.
- Graphify was queried read-only for the Board/Flow/Placement/editor-return
  relationship. The generated graph was deliberately not rebuilt because the
  plan requires generated artifacts to remain untouched.

## Residual evidence assigned to Block D

- Live multi-client/PostgreSQL concurrency remains a non-blocking production
  hardening risk; SQLite correctness is covered with `BEGIN IMMEDIATE` and
  concurrent-request tests.
- Real browser focus after Board-scene hydration, minimum-width sidebar
  layout, focus restoration, 320/768/1440 viewports, and 200% zoom require
  Playwright and Chrome evidence.
- Migration-from-legacy-data compatibility, full package gates, live
  `run-current`/`current-proof`, and operational rollout/rollback evidence are
  owned by Block D.

No Block D item is claimed complete by this status record.

## Dirty-state boundary

At Block D admission, product source matches the exact SHA above. This
documentation record is a docs-only follow-up. The user-owned untracked
`outputs/` remains untouched.
