# Agent Note: The Ketos board palette is a scoped brand layer

Status: implemented

English | [中文](2026-09-15-ketos-board-brand-theme.zh.md)

## Problem

`packages/client/ui-board` painted its whole visual language as literals: hex colors inside inline React styles in every component (canvas, both window frames, dock, omnibox, minimap, selection overlay), neutral 1px borders beside bespoke `rgba()` shadows, and a two-color minimap legend. The stage-4 plan also named a global `src/client/tokens.css`; stage 2 had already deleted that file, so what remained were the inline declarations plus the unreachable connector entries. Repository rules ([`docs/web-styling.md`](../../../../docs/web-styling.md)) say global sheets and `--dsw-*` tokens live in `ui-theme/src/styles/`, feature components consume semantic aliases through CSS Modules and `clsx`, and literal colors are forbidden.

The board's composition made the direct token swap insufficient. One subtree mixes a cream canvas with graphite floating chrome and white tool windows, while a semantic alias resolves to a single value per element: `--dsw-alias-label-primary` cannot be near-white for a card and near-black for a window two levels down. Repainting `body` (or shadowing the application palette globally) would have repainted every other panel and both base schemes.

## Decision

`ui-theme` gains a brand layer, `src/styles/ketos-brand.css`, registered with the other global sheets, that declares the Ketos mapping once and only inside `.board-canvas` — the literal class the board root carries beside its CSS Module class. `body` and `body[data-ds-dark-theme]` are untouched, so the surrounding panels and the base palettes are unaffected under either preference.

- Surfaces: canvas `--dsw-alias-bg-base`; graphite card `--dsw-alias-bg-layer-1`; dock `--dsw-alias-bg-layer-2`; raised inner cards and menus `--dsw-alias-bg-layer-3`; pills and tooltips `--dsw-alias-bg-overlay`; composer `--dsw-specific-input-major`; floating circular controls `--dsw-alias-button-floating-fill`.
- Text: `--dsw-alias-label-primary`/`-secondary`/`-tertiary`, and `--dsw-alias-label-primary-inverted` on brand fills.
- Accent and states: `--dsw-alias-brand-primary` (terracotta), `--dsw-alias-state-success-primary`/`-secondary` for the done badge, `--dsw-alias-state-success-tertiary` for the window-zoom dot (the one place a saturated green is needed), `--dsw-alias-state-error-primary`/`-warn-primary` for the close/minimize dots, `--dsw-alias-state-business-primary` for non-agent minimap rects.
- Borders and elevation: `--dsw-alias-border-l1` separates chrome, `--dsw-alias-border-l2` strokes frames, and the layer rebinds `--dsw-elevation-stroke-color` to that frame color so the elevation hairline carries it. Every elevated surface sets `border: 0` and takes `--dsw-elevation-panel`/`-prominent`/`-soft`; internal separators are 0.5px hairlines. The focused window rebinds the stroke color to the brand accent in its own module instead of swapping in a literal border.

The white tool window is the same palette rebound, not a second palette: the frame carries `data-board-surface="light"` and the brand sheet rebinds the same aliases for that subtree (white fill, warm header, light hairlines, dark ink, switch track, input fill).

Every component owns a CSS Module beside it (canvas, both frames, both window bodies, dock, omnibox, minimap, selection overlay, board root). Inline styles are reserved for placement from the store (window `left/top/width/height/z-index`) and for computed metrics passed as component-local custom properties (`--board-zoom`, `--board-pan-x/y`, `--board-canvas-grid*`), which is how the zoom-scaled dot grid stays a pure function of board state. The canvas dot color is the single board-local value with no alias, kept as a canvas-module custom property; it is the only literal color outside the brand sheet.

Localization keeps the stage-0 mechanism: the `board` namespace dictionaries in `src/client/locale.ts` stay the only copy owners (`zh` and `en`), the ru pack supplies `ru` through `packages/ketos/client-locale-ru`, and the `tests/fixtures/ru-keys.json` manifest was re-synced. The two connector entries that named capabilities the product does not have (`temporal`, `mcp`) are deleted from both languages and from the roster, with no replacement stubs.

`inject` stays `['slots', 'locale']`. The board reads no layout service: `ctx.slots.inject('main', …)` waits on the slot *declaration* made by ui-layout, which is why the type-only `@deepseek-ai/dsh-client-ui-layout/client` import is present; ui-conversation, the other `main` occupant, likewise does not inject `layout`.

## Alternatives considered

- **Add `layout` to `inject` (the plan's literal wording).** Rejected: the board uses no layout service, and an unread service edge makes the fiber wait on an unrelated provider; registering into a slot waits on the declaration, not on the declaring plugin's service.
- **Create `@ketos/brand` now.** The plan allows it after the MVP; a new package needs the three registration surfaces and a client-bundle peer for a single stylesheet that ui-theme already owns and already injects in order.
- **Override the application palette globally.** Rejected: the board is one panel among many, and `body[data-ds-dark-theme]` must keep driving the rest of the shell.
- **Add board-specific `--dsw-specific-board-*` tokens for the traffic dots, minimap blue, and switch track.** Rejected in favor of the existing state/business/alias tokens; only the canvas dot needed a board-local value, and it lives in the canvas module.
- **Keep the frames' 1px neutral borders and bespoke shadows.** Rejected by the repository specs: a neutral border wider than 0.5px, or an elevation shadow paired with a neutral border, fails `pnpm run test:gui` in ui-theme.
- **Repaint the sidebar panel icon in terracotta.** The icon lives outside `.board-canvas`; it now rides `currentColor` (plus `--dsw-alias-brand-primary` when active), so a shell-level brand change remains the shell's decision.
- **Adopt the ui-primitives `Switch` for the connectors toggle.** Deferred: the pane is a static roster with no toggle behavior; swapping the control would add a dependency and change markup for no behavior.

## Consequences

The board keeps one palette that does not follow the Harness light/dark preference, which is the brand requirement and is now stated in the package README's limitations. The palette's single source is the brand sheet; a board component can only reference aliases, so `grep` over `packages/client/ui-board/src` finds no hex color and a single `rgba()` (the dot grid). The light-surface marker is a data attribute rather than a class because the rebind must be reachable from the ui-theme sheet without hashed names.

Verification: `pnpm run test:gui` (385 files) covers the ui-theme stylesheet contracts (elevation hairline/neutral-border pairing, full-round `corner-shape` pairing, scrollbar rebinding on elevated surfaces — the two scrolling board bodies rebind the l2 thumb pair) and the board specs, which now assert module classes and the custom-property metrics instead of inline colors. `pnpm run verify-client-ui-i18n` and `pnpm run verify-translation-pairing` are green, and `DSH_SNAPSHOT=replay pnpm run test:web` reports no diff.

## Related

- [`docs/web-styling.md`](../../../../docs/web-styling.md) — token ownership and the component rules this follows.
- [`packages/client/ui-theme/README.md`](../../../../packages/client/ui-theme/README.md) — the sheet order the brand layer joins.
- [Board slot composition](2026-09-15-ketos-board-slot-composition.md) — the composition this styling layer renders through.
