# Agent Note: The board draws with the shared Harness theme and controls

Status: implemented

English | [中文](2026-09-15-ketos-board-harness-theme.zh.md)

## Problem

The board shipped its own visual language. Stage 4 had moved the palette into a `ui-theme` brand sheet (`ketos-brand.css`) that rebound the semantic aliases inside `.board-canvas` to the Ketos cream/graphite/terracotta values, and the components were rebuilt as CSS Modules on those rebound aliases. That satisfied the styling rules mechanically — no literals, one declaration site — while making the board the only panel that ignores the application palette: its canvas stayed cream and its "dark" cards stayed dark under a light shell, and the header's status chips, dock glyphs, and minimap legend were board-owned inventions (traffic-light dots, emoji glyphs, a two-color window legend).

The product decision changed: every user-facing surface, settings and chrome included, must read as the DeepSeek Harness — the shared palette, the shared controls, and the theme's light/dark behavior. The stage plan's §4.8 mandate ("палитра Кетос … только на селекторе `.board-canvas`") is therefore retired by user decision, and this note records what replaced it.

## Decision

The brand layer is deleted. `ui-theme` is back to its six base sheets, the board root no longer carries a `board-canvas` hook, and the tool window no longer marks itself as a light sub-surface. Every board rule now names the theme's own aliases and follows the shell's scheme:

- Window and dock chrome uses the floating-panel recipe the rest of the shell uses: `--dsw-alias-bg-layer-2`, `border: 0`, `box-shadow: var(--dsw-elevation-prominent)`, and `--dsw-elevation-stroke-color: var(--dsw-alias-border-l2)`; the focused window rebinds only that stroke to `--dsw-alias-state-business-primary`.
- Surfaces and text use the base scale: `bg-base` for the canvas, `bg-layer-1`/`bg-layer-3` for inset cards and capsules, `--dsw-specific-input-major` for the composer and Omnibox, `--dsw-specific-selector` for the composer action, `--dsw-alias-label-primary`/`-secondary`/`-tertiary` for ink, `0.5px` `--dsw-alias-border-l1/l2` hairlines, and the l2 scrollbar pair on the two scrolling bodies.
- The canvas dot grid rides `--dsw-alias-border-l3` instead of a board-local literal, so the mesh stays visible in both palettes and the package has no literal color at all.
- The minimap legend is theme-owned: agent windows take `--dsw-alias-state-business-primary`, every other window `--dsw-alias-label-caption`, and the frustum a business-accent tint.

Chrome controls come from the shared catalog (`ui-primitives`, a baseline module) instead of board inventions: `IconCloseOutline16` for window close, `IconPlusOutline16`/`IconFullscreenOutline16` for dock actions, `IconAgentPresetOutline16`/`IconBrowseOutline16` for window rows, `IconPaperclipOutline16`/`IconGlobeOutline14`/`IconInspectOutline12`/`IconSparkle16`/`IconSendOutline16` for the Omnibox, `Tooltip` for every icon-only control and dock row, `Menu` for the Omnibox action menu, and `Tag` for the window status capsules. The traffic-light dots are gone; the `•••` window menu with close/duplicate is stage 6's task, so each frame ships one close button.

The mock content is deleted rather than restyled: the connectors pane's three fake toggles, the settings pane's fake model list and system-prompt textarea, their tab strip, the dock's connectors button, the Omnibox's connectors entry, and every dictionary key that carried that copy. `board.window.body` now ships only `conversation`; the wide window kinds stay registered so the stages that own their content register bodies without touching the frame.

## Alternatives considered

- **Keep the brand layer and re-hue it to Harness values.** Rejected: a scoped override layer exists only to install values the theme does not have; keeping it preserves the drift the change removes, and every future theme edit would have to be mirrored there.
- **Adopt `ui-dockkit`'s `FloatLayer` for board windows.** Rejected: the dock kit's floats live in viewport coordinates with a single-corner resize, while board windows are world-coordinate objects scaled by the canvas transform with 8-direction handles. The kit's *recipe* (fill, radius, elevation hairline) is copied; the component is not.
- **Replace the mock panes with real data now.** `ctx.modelDirectories`, `remote.session.modelCatalog/selectModel`, and `remote.agentPresets.*` are the real sources, but wiring them is stages 11 and 13, and no Harness settings section can be mounted outside the settings panel that declares it. Shipping empty frames without entry points is the honest intermediate.
- **Use `--dsw-alias-brand-primary` as the accent.** Rejected by the platform rule recorded in `ui-dockkit/README.md`: this platform binds `brand-primary` to its near-black (light) or near-white (dark) foreground, so the accent is `--dsw-alias-state-business-primary` (as the conversation tabs already do).
- **Use the `Button` and `Switch` primitives for the round icon controls.** Rejected: the catalog has no icon-only round variant (`Button` sizes are capsules), and the remaining boolean controls were mock content that this change deletes. A second consumer of a round icon button would be the trigger to promote one into the primitive package.
- **Keep the emoji glyphs as "icons".** Rejected: the catalog ships a 78-glyph set that rides `currentColor` and the theme's sizing, which is what makes the chrome read as Harness.

## Consequences

The board follows the application's light/dark preference like any other panel; a cream canvas or a permanently dark card is no longer possible, which is the point of the reversal. The window/tool/settings frame kinds remain registered with no entry point that opens them, and `board.window.body` reports one occupied key (`conversation`).

The palette's single source is `ui-theme`, so a future brand change reaches the board for free. The board keeps only its own geometry (world placement, 8-direction handles, the zoom-scaled grid metrics) and its two duplicates (the resize algorithm and handle CSS in both frames) stay tracked by `ketos-4k3`.

Verification: `packages/client/ui-board` has no hex/rgba literal and no emoji glyph; `grep` finds no `ketos-brand`, `board-canvas`, or `data-board-surface`; `pnpm run test:gui` covers the ui-theme stylesheet contracts and the board specs (frame dispatch by kind, body swap, close through the frame, dock/Omnibox actions); `DSH_SNAPSHOT=replay pnpm run test:web` reports no diff; the live board was checked under both shell schemes.

## Related

- [The board palette was a scoped brand layer](../../archived/architecture/2026-09-15-ketos-board-brand-theme.md) — the superseded decision and its rejected alternatives.
- [Board slot composition](2026-09-15-ketos-board-slot-composition.md) — the composition this styling renders through.
- [`packages/client/ui-primitives/README.md`](../../../../packages/client/ui-primitives/README.md) — the catalog the chrome now composes from.
- [`packages/client/ui-dockkit/README.md`](../../../../packages/client/ui-dockkit/README.md) — the platform rule that `brand-primary` is ink, not accent.
