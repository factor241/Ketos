# Agent Note: Board windows report real context occupancy, keep their state under ten live sessions, and release every window resource

Status: implemented

English | [中文](2026-09-21-ketos-stage-14-multi-window-perf.zh.md)

## Problem

The board could open many windows at once, but nothing proved it held ten live sessions without interference, and the window composer's context ring showed a bare percent with no state and no figures: a window before its first provider report rendered nothing, and nothing distinguished a comfortable session from one about to overflow the model's window. The stage also had to establish that long board use does not accumulate subscriptions, bridge records, or timers, and to name the MVP's honest limit on simultaneously open chats.

## Decision

**The ring's occupancy conversion is one pure module the bridge and the composer share.** `client/context-ring.ts` owns `contextFigures(pressure)` — `min(100, round(used / window * 100))` with `used = projectedTokens ?? pressureTokens`, identical to ui-conversation's `contextOccupancy` — and the session bridge publishes its result instead of computing inline. The ring's state ladder is `empty` (no provider figures yet), `normal`, `warning` above 80%, and `critical` above 95%; `contextRingState` and `contextReading` are pure, and a test compares `contextFigures` against the conversation package's reference function across ten pressure combinations so the two surfaces cannot drift.

**The ring keeps its place in every state.** A window whose session exists renders the ring even before the first report: the arc is empty, the label is the localized `—`, and the tooltip is the empty-state text. A reading renders `% · used / window` with compact K/M units from the board dictionary, and the arc and the percent carry the warning or critical tint. The empty, warning, and critical states were verified in a live browser against real projection values (0% → `normal`, 85% → `warning`, 96% → `critical`, unprompted windows → `empty`).

**Ten live sessions are measured, not assumed.** A Playwright audit (`.playwright-mcp/stage-14-multi-window-perf/audit.mjs`) drives the real web server against a local OpenAI-compatible stub provider (`stub-model-server.mjs`, addressed through `DEEPSEEK_BASE_URL`): ten agent windows, five concurrent streams with per-window markers, canvas pan and zoom measured with a `requestAnimationFrame` counter, `worstFrameMs`, and a `longtask` observer. The recorded result is 59.8–60.1 FPS pan and zoom, worst frame 30.8–33.7 ms, 30.6–49.0 ms to insert a new window's DOM node, zero long tasks, zero console or host-log errors, and five of five answers with no crosstalk. Numbers live in `docs/ketos/perf-baseline.md`; the jsdom stress spec asserts behavior only, because jsdom has no compositor.

**Window resources are proven to be released, and the session survives.** A 30-cycle spec opens and closes every window kind — entering and leaving fullscreen and opening and closing the chats panel on the session-bearing kinds — and asserts the store, the DOM node count, and the slot ledger return to baseline, that each released bridge record's channel stops publishing while the session and its list row stay alive, that the session's and projections' listener counts return to zero after release, that the list subscription count does not grow, and that no board timer outlives the run. Closing a window drops its record and its persisted binding; it never deletes the session.

**The ring yields on narrow columns, verified in the live browser.** A dedicated probe (`.playwright-mcp/stage-14-multi-window-perf/probe-ring-narrow.mjs`) drives fullscreen with a docked chats panel on small viewports: the ring renders 38px wide on a 488px card, and drops to `display: none` with zero width at 380px and 180px, with no composer overflow and no console errors.

**The MVP's live-session limit is documented where users hit it.** Both package READMEs state that the board is validated for ten simultaneously streaming windows and recommends at most 20 live chats, with the measured baseline as the evidence.

## Alternatives considered

- **Keep the ring's arithmetic inline in the session bridge.** Rejected: the same formula already lives in ui-conversation, and the live value, the tooltip, and the state ladder need one home; a pure module is testable and the consistency test pins it.
- **Hide the ring entirely until a provider reports.** Rejected: the plan asks for an explicit empty state, and a control that appears and disappears as usage is first reported shifts the composer's trailing row.
- **Measure the stress scenario only in jsdom.** Rejected: jsdom has no compositor, so FPS and frame budgets there would be invented numbers; behavior stays in the unit lane and performance stays in the live-browser audit.
- **Add a breakdown panel to the window ring like the main composer's meter.** Deferred: the window composer has no room for the composition panel in this MVP; the tooltip carries the reading and the breakdown stays in the main panel.

## Consequences

Every window's ring now tells the truth about the selected model's window in all four states, with the same value the main panel shows, and the tooltip carries the figures rather than only the percent. Board performance under the stage's stress scenario is recorded with the method the earlier baseline established, and resource discipline has a spec that would catch a leaked subscription, record, or timer. Users and future stages know the supported scale: ten streaming windows measured, twenty live chats recommended.

Verification: `tests/context-ring.client.spec.ts` covers the formula against `contextOccupancy`, the 80/95 ladder, compact units, and the reading; `tests/conversation-body.client.spec.tsx` covers the four rendered states and that a reading update does not move the transcript lane; `tests/leaks.client.spec.tsx` covers the 30 mixed cycles, released subscriptions, and outstanding timers; `tests/stress-sessions.client.spec.tsx` covers ten windows and five parallel streams with failure isolation and no crosstalk; `tests/window-title.client.spec.tsx` covers the chats-panel rename path, the refused rename, the blank-title fallback, and ten distinct dock and header titles. `pnpm run test:gui`, `DSH_SNAPSHOT=replay pnpm run test:web`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run duplication`, `pnpm run hygiene`, and `pnpm run doc-sync` are green; the live audit verdicts are `ok: true`.

## Related

- [Board windows restore their Harness sessions and reconcile them against the session list](2026-09-19-ketos-board-session-restore.md) — the binding map and the missing/restoring states the resource audit builds on.
- [Board gestures, culling, and the window-manager budgets](2026-09-17-ketos-board-gestures-culling.md) — the measurement method and the twenty-window baseline the ten-session run follows.
- [Ketos MVP engineering policy (fork scope, coverage exceptions, process)](../process/2026-09-15-ketos-mvp-engineering-policy.md) — the coverage exceptions the board's test plan uses.
- [`docs/ketos/perf-baseline.md`](../../../../docs/ketos/perf-baseline.md) — the recorded method and measurements.
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.md) — the ring states, the resource guarantees, and the live-session limit.
