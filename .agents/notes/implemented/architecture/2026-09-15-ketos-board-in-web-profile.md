# Agent Note: The Ketos board joins the web profile

Status: implemented

English | [中文](2026-09-15-ketos-board-in-web-profile.zh.md)
## Problem

`packages/client/ui-board` shipped a complete spatial canvas — pan/zoom store, window cards, minimap, rail, and omnibox — but no profile loaded it: the client TypeScript aggregate referenced the package, while `packages/bundle/web-app/cordis.patch.yml` had no `ui-board` row and the bundle manifest declared no dependency, so the browser never received `lib/client.js`. The client-module path is the only route from source to browser: the host half of `client/modules` scans Loader rows carrying `dsh.client`, serves `/plugins/<id>/client.js`, and the shell executes the delivered factories. Without the two missing surfaces the board was dead code.

A second, independent defect surfaced on the first live render: the canvas root was `position: absolute; inset: 0`, which resolved against the shell frame — the only positioned ancestor — instead of the `main` column, so the board covered the whole window and swallowed sidebar pointer events.

## Decision

The board loads through the ordinary client-plugin path, with the three registration surfaces complete:

- `tsconfig.client.json` references `./packages/client/ui-board` (present since the stage-0 typecheck aggregate).
- `packages/bundle/web-app/cordis.patch.yml` carries the browser-roster row `- id: ui-board` / `name: '@deepseek-ai/dsh-client-ui-board'`.
- `packages/bundle/web-app/package.json` declares `"@deepseek-ai/dsh-client-ui-board": "workspace:^"`, which `verify-cordis-config` requires for every roster row.

The canvas root sizes to its `main` panel: `position: relative; width: 100%; height: 100%; overflow: hidden` on the `DashboardCanvas` root, so the `inset: 0` children (the transformed content surface, rail, omnibox, minimap) resolve against the board box and the column's `overflow: hidden` clips it. This follows the shell convention every `main` occupant uses (`ConversationRoot` is `position: relative; height: 100%`) instead of making `ui-layout`'s center column positioned for one consumer.

`tests/apply.client.spec.tsx` pins registration on the production `SlotTestRuntime`: `main` gains the `board` occupant, `sidebar.panellist` gains `id: 'board'`, the panel renders the canvas, the icon renders at the owner-supplied size, the row label resolves `Board`/`看板` through the package dictionary, and disposing the plugin fiber removes both entries.

The package keeps its MVP coverage exemption (`packages/client/ui-board/src/**` in `vitest.config.ts`): stages 3–4 rewrite the components, and the exemption is reviewed at MVP acceptance.

## Alternatives considered

- **Keep the canvas positioned against the shell frame.** Rejected: the frame spans the sidebar, so the canvas intercepted every sidebar pointer event — the live check found `document.elementFromPoint` over the session tree returning the canvas surface. The board is a `main` panel, not a chrome-less full-window surface.
- **Make the center column a positioning context in `ui-layout`.** Rejected: it changes a shared upstream package to serve one consumer's assumption, while the shell contract already gives each occupant its own positioned, full-height root.
- **Give the board a host package (`@ketos/board`, `board.db`) now.** Rejected: the MVP persists layout through the settings namespace `ui-board` (stage 8); a second store would duplicate the settings revision-CAS story before the layout document exists.
- **Lift the whole `ui-board` coverage exemption now that a registration test exists.** Rejected: the test covers registration, not the canvas and window components stages 3–4 replace; lifting it would gate throwaway GUI, and the policy note sets MVP acceptance as the review point.

## Consequences

The board reaches the browser through the same path as every upstream UI plugin: `window.__DSH_BOOT__` gains one row (55 rows with the board), no new mechanism, and no `dsh.client.external` request. The panel renders as `Доска` in the ru interface through the `@ketos/client-locale-ru` corpus. The canvas fills the `main` column (280–1200 px) and leaves the sidebar clickable, verified live through `pnpm ketos web`.

The visible change is pinned by the replay goldens: `snapshots/web/lifecycle-chrome/{hero,plan-active}.expected.md` gain the `Global panels / Board` row, refreshed through `DSH_SNAPSHOT=refresh` on that scenario and re-verified under `DSH_SNAPSHOT=replay`.

Known limits carried forward, not fixed here: window cards stay static placeholders, the layout is not persisted, and wheel zoom logs `Unable to preventDefault inside passive event listener invocation` because `onWheel` is a React passive listener — the gesture layer belongs to stage 5. The `board.*` slots stay declared-only until stage 3 registers into them.

## Related

- [`docs/ketos/dev-loop.md`](../../../../docs/ketos/dev-loop.md) — the three registration surfaces and the plugin-load diagnostics this stage exercised.
- [`packages/client/AGENTS.md`](../../../../packages/client/AGENTS.md) — the new-plugin checklist the surfaces come from.
- [Ketos MVP engineering policy](../process/2026-09-15-ketos-mvp-engineering-policy.md) — the board's coverage exemption and the MVP test list.
