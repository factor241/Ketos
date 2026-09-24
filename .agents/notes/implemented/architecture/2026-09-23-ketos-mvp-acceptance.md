# Agent Note: Ketos MVP acceptance — what the fork ships, which upstream gates it deviates from, and what is deferred

Status: implemented

English | [中文](2026-09-23-ketos-mvp-acceptance.zh.md)

## Problem

The fork needs one durable record of what the MVP accepted: which upstream engineering gates it deviates from and why, what the acceptance proved, and which subsystems stay deferred, so the post-MVP phases (Temporal worker, Beads and knowledge, perimeters, the organization library) start from a recorded boundary instead of re-deriving it. The [MVP engineering policy](../process/2026-09-15-ketos-mvp-engineering-policy.md) deferred its own review to this acceptance — "reviewed at MVP acceptance (stage 20)" — and no package README carries the deviation set as a whole.

The pressure is concrete. `@ketos/*` packages live beside upstream ones under their own scope and privacy rules; the raw board GUI and the clone packages carry behaviour suites instead of per-file coverage percentages; the model-visible brand string stays an upstream literal under the deferred 0.7 option; and the board's chats panel needed a product correction so a freshly registered folder can create its first chat.

A stage report is scoped to its stage, and a package README is scoped to its package. The accepted boundary — what the fork intentionally does differently from upstream, and what it deliberately does not ship yet — outlives both, and every later phase reads it before it re-opens one of those decisions.

## Decision

**Acceptance evidence: the MVP scenario runs as a machine audit in three phases.** The scenario in [docs/ketos/mvp-e2e.md](../../../../docs/ketos/mvp-e2e.md) covers board steps A1–A6 (panel, window chrome, chats panel, resize, fullscreen, reload) and clone steps B7–B13 (clone card, interview, memory, autopilot task, report, follow-up, restart) on a live `ketos web` host, with the project examples in `docs/ketos/examples/ketos-mvp/`.

**The acceptance runs on a live stand, not a mock.** `stand.sh` boots `ketos web` against a clean `DSH_HOME` (`/tmp/ketos-stage20/home`) with `DEEPSEEK_BASE_URL` pointing at the local SSE stub, so the scenario consumes no external API; `SSH_CONNECTION` is set on purpose so the adaptive picker resolves `browse` and the folder mini-browser is available to the scenario, and the `native` phase covers the host without that marker.

**The audit drives the scenario against a fresh home, then a restarted process, then the picker fallback.** `.playwright-mcp/stage-20-mvp-acceptance/audit.mjs` runs phase `one` on a clean `DSH_HOME` with the local SSE stub as the model, phase `two` after `stand.sh restart` re-checks the restored board, clone, memory, and terminal task state, and phase `native` drives a host without the SSH marker so the native folder-picker fallback is exercised. The three phase verdicts are `ok: true` (53, 9, and 2 checks), and the artifacts are `audit/audit-verdict-<phase>.json`, the frames under `audit/shots/`, and the stub's preserved `audit/requests-summary.jsonl`.

**What reached the model is recorded per request.** Each `requests-summary.jsonl` row carries the roles, the tool catalog, and whether the clone profile, methodology, and memory sections were present, so the acceptance shows — not assumes — that a follow-up turn on a finished task carries no `clone_task_report` tool while the profile, methodology, and memory sections remain.

**The stage report carries the verdicts; the budgets table lives in the perf baseline.** [docs/ketos/reports/stage-20-mvp-acceptance.md](../../../../docs/ketos/reports/stage-20-mvp-acceptance.md) records the acceptance outcome and maps checks to steps, and [docs/ketos/perf-baseline.md](../../../../docs/ketos/perf-baseline.md) holds the §II.4 budgets measured by `.playwright-mcp/stage-20-mvp-acceptance/perf.mjs`: 60 FPS-class canvas pan and zoom at 20 windows, window open within 100 ms, layout writes at most once per second after a gesture, first token within 400 ms on the local stub, memory search within 20 ms at 10 000 entries, task status within 1 s measured from the report tool's card appearing in the open task session to the tasks row reading `done` (the roster poll is 750 ms), zero console and host errors, and a clean WAL shutdown.

**Fork scope and naming: new packages are `@ketos/<name>` under `packages/ketos/`, and internal identifiers stay upstream.** Fork packages are private, carry the `@ketos/` scope, and live in the `packages/ketos/` group, which is excluded from release membership so the mandatory `private: true` branch applies; the current members are `@ketos/client-locale-ru` and `@ketos/clone-core`.

**Only user-facing surfaces carry the brand.** Internal `@deepseek-ai/*` identifiers, `DSH_*` variables, profile names, `dsh.*` configuration fields, and the session format remain upstream ([rebranding boundaries](2026-09-13-ketos-rebranding-boundaries.md)); the `ketos` launcher, the `ketos web:` readiness line, the `~/.ketos` home, and the web brand carry Ketos.

**Coverage exceptions: the four named `vitest.config.ts` entries stay, and the acceptance review confirms them rather than removing them.** Two entries carry the `MVP-fork coverage policy` reason — `packages/client/ui-board/src/**` (the board GUI) and `packages/ketos/clone-*/src/**` (the clone domain) — and two further host-conditional exclusions cover the Linux-only sources `packages/subprocess/subprocess-local/src/linux-execve.ts` and `packages/experimental/code-runtime-python/src/index.ts`, excluded on non-Linux hosts while the Linux lane keeps both gated.

**Every other path keeps per-file 100%, including `@ketos/client-locale-ru` and the host-side packages that import the excluded trees.** The ru locale pack is the one Ketos package whose correctness the fork already pays for, and a fork-wide blanket exemption would have dropped it silently.

**The exempt trees replace percentages with the named behaviour suites.** The MVP test list names them: pure math (`zoomTowardPointer`, snap, minimap projection), persistence (CAS settings, `user_version`, `clones.db` CRUD), slot and tool registration and disposal, Fetch-route boundaries (error codes, validation), and memory behaviour (remember → search → injection), extended by the stage suites for the interview flow and autonomous tasks. The exceptions cover shipped, tested behaviour: the board and the clone domain carry behaviour suites rather than throwaway code, so a post-MVP change widens the behaviour tests rather than deleting an exemption silently.

**The MVP test list deliberately excludes tests for every CSS class, screenshots of every state, and resize stress tests.** The acceptance scenario exercises the resize and fullscreen states, so the exclusion removes per-class coverage rather than those states.

**The acceptance review found no exception the shipped state no longer justifies.** A new package defaults to the per-file gate, and leaving it requires a named config entry and its own Agent Note; the two Linux-only entries are host-conditional rather than policy exemptions.

**Model-visible brand: the upstream identity string stays (option 0.7).** The harness identity line and the web-surface prompts remain upstream literals, so `test:snapshot` fixtures, the session format, and the upstream-compatible prompt surface stay byte-stable.

**A ready patch layer exists and is not applied in the shipped composition.** [docs/ketos/model-identity.md](../../../../docs/ketos/model-identity.md) names `docs/ketos/model-identity.patch.yml`, which sets `includeHarnessIdentity: false` and a Ketos `personaPrefix`; `pnpm dsh --profile web --patch docs/ketos/model-identity.patch.yml --dump-config` proves the overlay composes, and the system-prompt spec covers the identity-off path. A deployment that needs the Ketos persona applies the layer; the shipped composition does not.

**One accepted product correction: the board's chats panel lists every registered workspace, including empty ones.** The panel groups sessions under every entry of the workspace list, so a folder registered through the picker gets its row immediately and its first chat is created from that row; hiding workspaces without a visible chat is not part of the panel's behaviour.

**The correction is what makes the scenario's "register a folder, then create its first chat" step possible.** It is one of the few behaviour changes the fork carries in an upstream package, and it is recorded here so an upstream merge that touches the listing meets the fork's expectation instead of silently reverting it.

**Stage 21 closed the 2026-09-24 audit's code points and stage 22 its documentation, repository, and process points.** The audit of the full branch chain found 25 deviations; stage 21 fixed the host and board code points — the clone model selection no longer moves the `agent-default-model` system default, `ready` means a filled profile on the wire, the memory query bound lives in the repository, the database open waits for another process's lock, and the clone plugin activates without the tool and prompt registries — and stage 22 recorded the decisions the audit found undocumented, brought the package READMEs, the fork-edit registry, the Beads process, and the plan folder in line with the code and revision 18, cleaned the repository of the pre-MVP artifacts, and owns the final integration (the PR stack, `main`, and the `ketos-mvp` tag). [The stage-22 note](2026-09-24-ketos-stage-22-mvp-integration.md) owns the live-clone-session decision and the memory-window boundary.

**Deferred work stays outside the MVP boundary.** Perimeters and Supervisor, the organization library and knowledge quarantine, Temporal processes, the PostgreSQL library and central audit, SSO/OIDC and the MCP gateway, and semantic memory search are deferred, and the MVP remains the local single-user `web` profile over the `~/.ketos` volume.

**The limitation summary is the authority for the deferred list.** [docs/ketos/mvp-known-limitations.md](../../../../docs/ketos/mvp-known-limitations.md) owns the full list, and each package's Known Limitations section owns its domain's detail; this note records the boundary, not the inventory.

## Accepted limitations at MVP

Each line is an accepted limitation the stage checklist records; the MVP ships these boundaries deliberately.

- **Stage 0 — the model-visible brand stays upstream.** The harness identity string remains the upstream literal under option 0.7.
- **Stage 12 — approvals answer only in the main panel.** A window banners a pending request but renders no answering surface of its own.
- **Stage 13 — cwd protection is warning-only.** A session created outside the standard registration path does not pass the guard.
- **Stage 14 — the MVP recommends at most 20 live sessions.** Ten simultaneously streaming windows are measured; past 20 the shared transport and the per-window subscriptions are the cost.
- **Stage 15 — the clone Fetch API is hand-validated without codegen.** The clone domain has no Typert codegen and the route checks every field itself.
- **Stage 17 — memory search is lexical, memory has no revision check, and `candidate` is not a quarantine.** FTS5 with no embeddings or semantic search; edits are last-writer-wins; the candidate flag is a status, not an isolation queue.
- **Stage 18 — a skill edit reaches a live agent only by scope recreation.** A registered set is fixed for the agent's lifetime.
- **Stage 19 — tasks live in the host process with no auto-resume, and the vocabulary is `clone_tasks`.** Interrupted tasks reconcile to `failed`; the plan's `tasks`/`task_*` domain does not exist in the MVP.
- **Stage 22 — the memory window cannot create a record.** The agent's `clone_memory_remember` call is the only writer of a new memory; the window lists, searches, edits, and deletes.
- **Stage 22 — a live clone session follows profile and memory edits and pays the KV prefix cost of a profile edit.** The profile section is republished in place and reaches the running session on its next assembly, which drops the reusable KV-cache prefix from the first changed token; a memory write rides the next runtime-context message and leaves the prefix intact; a registered skill set stays fixed until the scope is reinstalled or the agent is recreated.

[docs/ketos/mvp-known-limitations.md](../../../../docs/ketos/mvp-known-limitations.md) is the full authority for these limitations and links each fact to its owning package README or stage report.

## Alternatives considered

- **Keep per-file 100% coverage for the board and clone packages.** Lost: it would pin components the fork rewrites and clone files that keep growing, while the MVP test list is behavioural — pure math, persistence, route boundaries, memory — so the percentages would be rewritten at each stage instead of describing the behaviour.
- **Rename internal `@deepseek-ai/*` identifiers for brand consistency.** Lost: it conflicts with the upstream-sync policy and the forbid list in the [rebranding boundaries](2026-09-13-ketos-rebranding-boundaries.md); every merge from upstream would land in a rename diff, and the SDK, Python runtime, and release tooling resolve the upstream names.
- **Ship the branded model-visible identity.** Lost: it would break `test:snapshot` fixtures and move the session and prompt surfaces away from upstream, while the ready patch layer already gives a deployment a Ketos persona without touching shipped compositions.
- **Make the chats panel keep hiding empty workspaces.** Lost: a registered folder with no visible chat would have no row, so the panel would offer no way to create that folder's first chat, and the plan requires the full workspace list.
- **Record the MVP boundary only in the stage report.** Lost: a report is stage-scoped, and the boundary outlives the stage cycle — the post-MVP phases read Agent Notes, not the stage-20 report, to learn what was accepted.

## Consequences

The fork ships a user-visible MVP with a recorded, narrow deviation set: four coverage entries, one deferred model-visible brand decision, one upstream-package behaviour correction, and the fork naming scope.

The exempt trees rely on behaviour suites instead of percentages, so a regression outside those suites is caught only by the acceptance runs — the three audit phases and the perf measurements are the compensating signal, not the unit suite.

The upstream-sync surface stays small: the chats-panel listing is one of the few upstream-package behaviour changes, at the cost of a permanent diff to keep merged. The boundary is now recorded in one place, so a post-MVP phase that changes an exempt tree, an internal identifier, or the model-visible identity updates this note and the policy together instead of re-deciding the deviation.

The record buys the post-MVP phases a starting point: a change to the clone domain, the board, or the naming scope reads one note for the accepted deviations instead of reconstructing them from stage reports and package READMEs.

## Related

- [docs/ketos/mvp-e2e.md](../../../../docs/ketos/mvp-e2e.md) — the acceptance scenario and its machine checks.
- [docs/ketos/mvp-known-limitations.md](../../../../docs/ketos/mvp-known-limitations.md) — the MVP limitation summary and the deferred subsystems.
- [docs/ketos/perf-baseline.md](../../../../docs/ketos/perf-baseline.md) — the §II.4 budgets table and the stage-20 measurements.
- [Ketos MVP engineering policy](../process/2026-09-15-ketos-mvp-engineering-policy.md) — the coverage exceptions and fork scope this note closes out.
- [Ketos rebranding boundaries](2026-09-13-ketos-rebranding-boundaries.md) — the brand split and the internal-identifier policy.
- [docs/ketos/reports/stage-20-mvp-acceptance.md](../../../../docs/ketos/reports/stage-20-mvp-acceptance.md) — the stage-20 verdicts and evidence.
- [Ketos stage 22: a live clone session follows stored edits, and the MVP's closing decisions](2026-09-24-ketos-stage-22-mvp-integration.md) — the stage-22 decisions and the final integration.
- [docs/ketos/reports/stage-22-mvp-integration.md](../../../../docs/ketos/reports/stage-22-mvp-integration.md) — the stage-22 verdicts and evidence.
