# Agent Note: Stage 21 MVP stabilization: the audit's host and board fixes

Status: implemented

English | [中文](2026-09-24-ketos-stage-21-mvp-stabilization.zh.md)

## Problem

The end-to-end audit of stages 0–20 (2026-09-24) found 25 deviations; stage 21 closes the code points (П1–П4, П7–П19), while stage 22 owns documentation, decisions, repository order, and final integration.

On the host, a second process opening a fresh `clones.db` could fail with `SQLITE_BUSY` on the migration because the open sequence set no lock wait; the clone plugin's root `inject` required the `tools` and `systemPrompt` registries although only the per-agent scope uses them, so a host without them never activated the routes or the lazy database; the 1000-character memory query bound lived only in the route, while the comment claimed the repository enforced it and the model-facing `clone_memory_search` tool bypassed it; the clone route accepted `status: 'ready'` for an empty profile although stage 16.4 defines completion as `ready` with non-empty authored fields; and starting a clone interview or autonomous task called `remote.session.selectModel`, which unconditionally saved the pick as the `agent-default-model` system default, so every clone start silently moved the model new ordinary chats use.

On the board, gestures could lose typed text (the Omnibox cleared its field before the answer, and a refused composer command cleared the draft), `busy` flags could stick after a rejected promise, a refused `writeClipboard`/`pickDirectory` was unhandled, the clone form computed the next revision as `revision + 1` instead of the revision the route minted, and raw `${code}: ${message}` or English developer strings reached the lane and composer; the client path check accepted a `dshHome` no caller could supply, the native-picker fallback passed an always-undefined home, and an empty path rendered the `~/.ketos` message; the tasks window polled the host while any clone had a pending or running task, even invisible ones; the `connectors`, `settings`, and `dashboard` windows opened with empty bodies; `BoardGoalState.activation` was dead; and the clone editor rendered the canonical Russian methodology headings in zh/en interfaces.

## Decision

**The clone model selection carries an explicit `keepDefault` flag.** `SessionSelectModelRequest` gains `readonly keepDefault?: boolean`; `SessionCommandController.selectModel` calls `agentDefaultModel.saveSelection` only when the flag is absent or false; `ModelDirectory.select(selection, options?)` forwards `keepDefault: true` only, never false; the board's interview start and autonomous task start pass `{ keepDefault: true }`, while the composer model chip keeps its two-argument call and still saves the system default. The host path was chosen over a new clone-core route: the single existing path already resolves and validates the route, and the flag is one conditional that reuses all its error handling. The board README, `docs/ketos/mvp-known-limitations.md`, and `docs/ketos/upstream-sync.md` record the fork edits (`packages/api/session-controller/src/types.ts`, `src/commands.ts`, and `packages/client/ui-model-selection/src/client/directory.ts`).

**`ready` means a filled profile, enforced at the route.** `requireReadyProfile` in `packages/ketos/clone-core/src/routes.ts` refuses `create` and `update` requests whose effective `role`, `persona`, or `methodology` is empty — for `update`, the patch value when present, else the stored record — with 400 `ketos/invalid`; the clone editor refuses the same transition before calling the host, with the dictionary text `clone.ready.incomplete`, but the route stays the authority: a client that skips the guard is refused by the wire.

**The memory query bound belongs to the repository.** `MEMORY_LIMITS.query` (1000) is the single constant; `MemoryRepository.search` refuses an over-long query as `MemoryInvalidError`, measured on the trimmed query — the same value the route measures — so the model-facing `clone_memory_search` tool and the route agree without duplicating the number.

**The MVP-external window bodies state their boundary, and methodology labels follow the interface language.** One `MvpUnavailableBody` component occupies `board.window.body` for `connectors`, `settings`, and `dashboard`, rendering `window.unavailable`; the dashboard has no creation path and its Omnibox entry answers with its own notice. `METHODOLOGY_SECTION_IDS` maps each canonical heading (`Принципы`, `Порядок работы`, `Критерии качества`, `Чего не делать`) to a stable id (`principles`, `workflow`, `quality`, `avoid`); the editor's chips, gap hint, and `data-board-clone-methodology-section` attribute use the id and the zh/en/ru dictionary labels, while the stored text, the template, the parser, and the model-visible interview instruction keep the canonical headings.

**The database open sequence waits for another process's lock.** `openDatabase` sets `PRAGMA busy_timeout = 5000` (`LOCK_WAIT_MS`) immediately after `new DatabaseSync` and before `migrate`, so migrations and every later statement wait for another process's lock instead of failing with `SQLITE_BUSY`.

**The clone plugin's root scope injects only what it uses.** The root `inject` of `@ketos/clone-core` is `['connection', 'agents', 'sessionProjections']`, with `tools` and `systemPrompt` injected by the per-agent scope only, so a host that registers neither still activates the routes and the lazy database.

## Alternatives considered

- **A clone-core host route for selecting the clone's model** (П4's other option). Rejected: it would duplicate route resolution and validation, while the flag is one conditional on the existing path.
- **Enforcing `ready` only in the board.** Rejected: direct and alternate wire callers could bypass it; the operation that makes the decision enforces it.
- **Keeping the query bound in the route.** Rejected: the tool path bypassed it, which the audit found as a defect.
- **Building real content for the three tool windows.** Rejected: those surfaces belong to later stages; an honest localized notice is the MVP's answer.
- **Renaming the canonical methodology headings.** Rejected: the stored text, the parser contract, and the model instruction all key on the canonical Russian markers; only the interface labels localize.

## Consequences

Clone starts leave the system default where the user left it, `ready` means a filled profile on the wire, the memory bound lives in one constant that the tool and the route share, a second process opens the database behind a lock wait, the clone plugin activates without the tool and prompt registries, the three MVP-external windows state their boundary, and the clone editor's methodology chips speak the interface language while the stored text keeps its canonical markers. The accepted costs: the system default still moves when the user picks a model in the composer chip, unchanged by design and stated by its tooltip; the clone editor can still be bypassed by a non-board client, which the route refuses; the methodology chips and the stored markers differ in language while the canonical markers remain Russian in every locale; the three tool windows show a notice instead of content; and the tests read ids rather than Russian headings.

Verification: `packages/api/session-controller/tests/session-models.host.spec.ts` (the `keepDefault` branch and 100% per-file coverage of `commands.ts`), `packages/client/ui-model-selection/tests/browser-plugin.client.spec.ts`, `packages/client/ui-board/tests/clone-flow.client.spec.tsx` and `tests/composer.client.spec.tsx` (the flag on the clone flows and none on the chip), `packages/ketos/clone-core/tests/{routes,database,memory,memory-tools,composition,methodology}.spec.ts`, `packages/client/ui-board/tests/{clone-body,path-validation,window-chats-panel,tasks-body,slots,omnibox,composer}.client.spec.*`, the ru pack spec, and the live scripted audit `.playwright-mcp/stage-21-mvp-stabilization/audit/audit-verdict.json` (16/16, `ok: true`, commit `258fb5c`) with the GIF `.playwright-mcp/stage-21-mvp-stabilization/qa/stage21-stabilization.gif`.

## Related

- [Ketos MVP acceptance](../architecture/2026-09-23-ketos-mvp-acceptance.md) — the stage-19/20 acceptance record this stage's fixes build on.
- [Ketos MVP engineering policy](../process/2026-09-15-ketos-mvp-engineering-policy.md) — the fork scope, coverage exceptions, and process these fixes stay inside.
- [`packages/ketos/clone-core/README.md`](../../../../packages/ketos/clone-core/README.md) — the clone host package whose routes, database, and memory store this stage fixes.
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.md) — the board package whose gestures, windows, and clone editor this stage fixes.
