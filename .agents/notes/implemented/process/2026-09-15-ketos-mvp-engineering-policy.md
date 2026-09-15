# Agent Note: Ketos MVP engineering policy (fork scope, coverage exceptions, process)

Status: implemented

English | [中文](2026-09-15-ketos-mvp-engineering-policy.zh.md)
## Problem

The upstream engineering gates — per-file 100% coverage on `packages/*/*/src` and an Agent Note for every non-trivial change — stay in force after the Ketos rebranding, while the MVP adds fork-local packages (`@ketos/*`), clone packages that do not exist yet, and raw board GUI that stages 2–4 rewrite. Without a recorded exception policy, every stage would re-decide whether per-file tests are owed to throwaway GUI or to unwritten packages. The stage-1 baseline showed the cost concretely: `packages/client/ui-board/src` fails per-file coverage across its components (0–50% on windows, toolbar, pointer cleanup), and a fork-wide blanket exemption would silently drop `@ketos/client-locale-ru`, which holds per-file 100%.

## Decision

Fork-local code keeps the upstream naming and packaging discipline: new Ketos packages live in `packages/ketos/` as `@ketos/<name>`, stay `private: true`, and internal `@deepseek-ai/*` identifiers are untouched ([rebranding boundaries](../architecture/2026-09-13-ketos-rebranding-boundaries.md)).

Coverage exceptions are narrow, named config entries in `vitest.config.ts`, each carrying the `MVP-fork coverage policy` reason:

- `packages/client/ui-board/src/**` — the raw board GUI is rewritten through stages 2–4; per-file coverage would pin throwaway components.
- `packages/ketos/clone-*/src/**` — the clone packages arrive in stages 15–19; the glob is inert until then.

Every other path keeps per-file 100%, including `@ketos/client-locale-ru` and the imports of the excluded packages (`src/index.ts` of ui-board is excluded by the same glob only while the component tree lives under `src/client/`). Exceptions are removed when the owning stages land their behaviour tests, reviewed at MVP acceptance (stage 20).

The mandatory test set is the MVP list from §II.4: pure math (`zoomTowardPointer`, snap, minimap projection), persistence (CAS settings, `user_version`, `clones.db` CRUD), slot/tool registration and disposal, Fetch-route boundaries (error codes, validation), and memory behaviour (remember → search → injection). Tests for every CSS class, screenshots of every state, and resize stress tests stay out of scope.

Agent Notes remain mandatory for non-trivial changes: they are the project's cheap memory across stage worktrees and the evidence the stage cycle relies on ([stage cycle](2026-09-15-ketos-stage-cycle.md)). Each stage's Definition of Done follows §II.4, and stage status is reported through the stage report template in `docs/ketos/`.

## Alternatives considered

- **Keep the full gate and write per-file tests for the board**: rejected — stages 2–4 replace the components, so the tests would be written twice, and the MVP list explicitly excludes per-class GUI coverage.
- **Exempt all `packages/ketos/*`**: rejected — the ru pack is fully tested and stays gated; a blanket rule would hide regressions in the one Ketos package whose correctness the fork already pays for.
- **Per-branch `/* v8 ignore */` markers instead of config entries**: rejected — the uncovered surface is whole components and future packages, not unreachable arms; ignore markers would lie about the reason.
- **Drop Agent Notes for MVP speed**: rejected — the stage worktree cycle depends on notes to carry decisions between stages, and their cost is one file per non-trivial change.

## Consequences

- The coverage gate can be green while board GUI and unwritten clone packages have no per-file signal; the named behaviour tests are the compensating evidence, and the two config globs are the complete visible list of what the gate skips.
- `pnpm run lint` stays red on 17 pre-existing `packages/client/ui-board` errors until the board rewrite lands; they are recorded in [baseline issues](../../../../docs/ketos/baseline-issues.md) rather than fixed here.
- A future Ketos package defaults to the gate; leaving it must be justified in its own Agent Note and added as a named config entry.

## Related

- [Ketos rebranding boundaries](../architecture/2026-09-13-ketos-rebranding-boundaries.md)
- [Ketos stage cycle](2026-09-15-ketos-stage-cycle.md)
- [Ketos repository and stage worktrees](2026-09-14-ketos-repository-and-stage-worktrees.md)
- [Ketos task tracking in Beads](2026-09-15-ketos-beads-task-tracking.md)
