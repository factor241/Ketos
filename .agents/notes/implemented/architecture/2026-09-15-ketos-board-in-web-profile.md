# Agent Note: The Ketos board joins the web profile

Status: implemented

English | [中文](2026-09-15-ketos-board-in-web-profile.zh.md)

## Problem

`packages/client/ui-board` shipped a complete spatial canvas — pan/zoom store, window cards, minimap, rail, and omnibox — but no profile loaded it: the client TypeScript aggregate referenced the package, while `packages/bundle/web-app/cordis.patch.yml` had no `ui-board` row and the bundle manifest declared no dependency, so the browser never received `lib/client.js`. The client-module path is the only route from source to browser: the host half of `client/modules` scans Loader rows carrying `dsh.client`, serves `/plugins/<id>/client.js`, and the shell executes the delivered factories. Without the two missing surfaces the board was dead code.

A second, independent defect surfaced on the first live render: the canvas root was `position: absolute; inset: 0`, which resolved against the shell frame — the only positioned ancestor — instead of the `main` column, so the board covered the whole window and swallowed sidebar pointer events.

## Decision

The board loads through the ordinary client-plugin path, with the three registration surfaces complete:

- `tsconfig.client.json` references `./packages/client/ui-board` (line 107).
- `packages/bundle/web-app/cordis.patch.yml` carries the browser-roster row `- id: ui-board` / `name: '@deepseek-ai/dsh-client-ui-board'`.
- `packages/bundle/web-app/package.json` declares `"@deepseek-ai/dsh-client-ui-board": "workspace:^"`, which `verify-cordis-config` requires for every roster row.

The canvas root sizes to its `main` panel: `position: relative; width: 100%; height: 100%; overflow: hidden` on the `DashboardCanvas` root, so the absolutely positioned children (the transformed content surface, rail, omnibox, minimap) resolve against the board box and the column's `overflow: hidden` clips the board. The same declaration makes the board the containing block for its own overlays, which is what contains them — the frame's clip never applied while the containing block was the frame. This matches the one existing `main` occupant (`ConversationRoot` is `position: relative; height: 100%`) instead of making `ui-layout`'s center column positioned for a single consumer.

The board declares the Cordis services it reads — `slots` and `locale` — and does not wait on `layout`: `ctx.layout.selectPanel(id)` is the sidebar shell's call, not the board's. The `dsh.client.inject` manifest keeps the informational `ui-layout` edge because the `main` declaration the board registers into belongs to that package.

`tests/apply.client.spec.tsx` pins the registration on the production `SlotTestRuntime`: both occupants with their metadata (`order` 15, declared `locale`, a store handle, no `children`), the panel-sized canvas box and the icon at the owner-supplied size, the row label resolving `Board`/`看板` through the package dictionary, disposal removing the entries and their DOM while the frame-owned declarations survive, and the deferred path — the board applies before the slots are declared and registers when they arrive. `tests/roster.client.spec.ts` adds the real-composition tier: the web-app bundle roster must declare the row (`webApp.closure`), and booting that roster through `createClientTest` must produce both occupants — the check that fails on a missing `cordis.patch.yml` row.

Two dead surfaces the wiring made live are removed rather than carried: `src/client/tokens.css` — a global `:root` sheet whose 33 `--board-*` properties have no reader and which the build tooling injects into `document.head` at boot — is deleted, and the four `alert()` stubs in the omnibox and action menu became no-ops, because a blocking dialog that reports "Message sent" for a send that does not happen is worse than an inert control. Both limits are recorded in the package README.

The package keeps its MVP coverage exemption (`packages/client/ui-board/src/**` in `vitest.config.ts`) under the [Ketos MVP engineering policy](../process/2026-09-15-ketos-mvp-engineering-policy.md): the registration test does not lift per-file coverage of the components the following board stages replace.

## Alternatives considered

- **Keep the canvas positioned against the shell frame.** Rejected: the frame spans the sidebar, so the canvas intercepted every sidebar pointer event — the session tree was unreachable while the board was open. The board is a `main` panel, not a chrome-less full-window surface.
- **Make the center column a positioning context in `ui-layout`.** Rejected: it changes a shared upstream package to serve one consumer's assumption, while the shell contract already gives each occupant its own positioned, full-height root.
- **Keep the `layout` service edge because the panel is selected through the layout service.** Rejected: the selection is the sidebar's call, not the board's; a required-service edge the contribution never reads delays activation and bypasses the deferred-registration path `slots.inject` exists to serve.
- **Keep `tokens.css` until the palette migration.** Rejected: its properties have no consumers, so deletion is behavior-preserving, and the sheet's global `:root` writes and build-injected `<style>` have no lifetime owner.
- **Give the board a host package (`@ketos/board`, `board.db`) now.** Rejected: the MVP persists layout through the settings namespace `ui-board`; a second store would duplicate the settings revision-CAS story before the layout document exists.

## Consequences

The board reaches the browser through the same path as every upstream UI plugin: the `ui-board` row rides `window.__DSH_BOOT__`, no new mechanism is involved, and the package makes no `dsh.client.external` request. The panel renders as `Доска` in the ru interface through the `@ketos/client-locale-ru` corpus, and the canvas fills the `main` column while the sidebar keeps its pointer events.

The visible change is pinned by the replay goldens: `snapshots/web/lifecycle-chrome/{hero,plan-active}.expected.md` carry the `Global panels / Board` row.

Known limits carried forward, not fixed here: window cards stay static placeholders, the layout is not persisted, wheel zoom logs `Unable to preventDefault inside passive event listener invocation` because `onWheel` is a React passive listener (tracked as `ketos-3kf` under the viewport-gesture work), and the `board.*` slots stay declared-only until the composition work registers into them.

## Related

- [`docs/ketos/dev-loop.md`](../../../../docs/ketos/dev-loop.md) — the three registration surfaces and the plugin-load diagnostics this change exercised.
- [`packages/client/AGENTS.md`](../../../../packages/client/AGENTS.md) — the new-plugin checklist the surfaces come from.
- [Ketos MVP engineering policy](../process/2026-09-15-ketos-mvp-engineering-policy.md) — the board's coverage exemption and the MVP test list.
