---
description: "Web spatial board for the dsh web client: a main-panel spatial canvas with draggable, resizable windows, pan/zoom navigation, a minimap, and a toolbar."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-board

English | [中文](README.zh.md)

## Summary

The board is a spatial main panel for the dsh web client: an infinite canvas where agent windows are placed, moved, resized, stacked, and closed. The user pans the canvas by dragging its background and zooms with the wheel toward the pointer position; a dock and an Omnibox add windows at the view center; a minimap in the corner mirrors the window layout. The plugin registers the board as the `board` main panel and its icon in the sidebar panel list, and it draws with the shared Harness theme and controls rather than a board-owned palette.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Open the board panel through the board icon in the sidebar panel list; the canvas fills the main panel and starts empty. Drag the background to pan, wheel to zoom (0.2–2.0, centered on the pointer), and use the dock's plus button to add an agent card at the center of the current view. Window interactions follow one convention: drag the header to move, drag an edge handle to resize, and hold Shift while dragging to disable the 24 px grid snap; clicking a window brings it to the front of the z-order, and its close button removes it. Selecting a window in the dock or minimap focuses it and centers the view on it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

**Runtime invariant:** No companion is published. The panel entry registers the `main` slot with the single engine store and declares the layers it renders; the entry's disposal proves removal, independently observable through the `board.*` slot declarations.

<details>
<summary>Implementation internals — click to expand</summary>

One registration surface: `apply` composes the board as slots. The `main` panel entry declares `board.canvas`, `board.dock`, `board.omnibar`, and `board.minimap` and renders them through `renderSlot`; the canvas occupant declares `board.windows`; the window layer declares the keyed `board.window` (one registration per window type — the instance travels in owner props, so one occupant serves every window of its type) and the keyed `board.window.body` (one registration per body kind) and hands each frame the body dispatcher; the same `apply` registers the `sidebar.panellist` icon. The keyed keys are the `WindowKind` and `WindowBodyKind` unions, so a registration for an unknown key is a compile error. Board state is one `dsh-client-store` engine store declared at the panel entry — pan, zoom, viewport box, window map, z-order, and the element-selection flag — with pure draft actions (`setPan`, `setZoom`, `zoomTowardPointer`, `setViewport`, `addWindow`, `openWindow`, `moveWindow`, `resizeWindow`, `setWindowBodyKind`, `focusWindow`, `centerOnWindow`, `closeWindow`, `setSelectingElement`). Every layer and frame reads that same handle through the framework `useStore` seat; components hold no subscriptions of their own. Visible copy is locale-owned: `apply` registers the `board` namespace dictionaries through `ctx.locale` and each copy-bearing entry declares the namespace, which puts the typed `t` seat on its component. Styling reads the shared theme directly: each component owns a CSS Module beside it, inline styles carry only placement and the computed pan/zoom metrics, and the rules name `--dsw-*` semantic aliases — floating panels use the theme's layer-2 fill with an elevation hairline (rebound to the business accent on the focused window), internal separators are 0.5px hairlines, and the canvas dot grid rides the border scale. Interactive chrome comes from `ui-primitives`: header close buttons and the composer actions are Harness icons, the dock rows and the composer action are wrapped in `Tooltip`, the Omnibox action menu is the shared `Menu`, and the window status capsules are `Tag`. The board therefore follows the shell's light/dark preference like any other panel.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Slots reference](../../../docs/subsystems/slots.md) — the slot protocol `apply` and the `board.*` contract depend on.
- [client store](../store/README.md) — the `defineStore` engine backing the board state.
- [ui-sidebar](../ui-sidebar/README.md) — the panel list where the board icon registers.
- [ui-primitives](../ui-primitives/README.md) — the icons, `Tooltip`, `Menu`, and `Tag` the board chrome composes.

-----

<a id="model-experience"></a>
## Model Experience

None, as the board is a browser-only canvas: it registers no tool, prompt section, or session event, and everything it renders is board-local view state.

#### KV Cache effect

No effect; the board adds nothing to any model request and consumes no session-log content.

## Known Limitations and Deferred Work

These limits are current package constraints.

- **The conversation body is a static placeholder** — the `conversation` body renders the window's status line and the fixed opening message; the contract's `sessionId`, `status`, and `contextUsed` fields are not populated from live Sessions, so agent windows are not yet bound to running agents.
- **Per-window preset selection is pending** — an agent window has no UI to choose its agent preset or model; every window shows the same fixed card content until that selection model lands.
- **Window types without a body occupant render an empty body** — `apply` registers all six `WindowKind` frames, while `board.window.body` ships only `conversation`; nothing creates clone, dashboard, task, tool, or settings windows yet, and the stages that do register their bodies.
- **The frame body dispatcher is an owner prop** — the windows layer is the single declarer of `board.window.body` (the slot core allows one declarer per key), so it passes each frame a `renderBody` callback instead of a `renderSlot` seat of its own.
- **The layout is session-only** — `apply` creates the board store without a persist key, so pan, zoom, and window arrangement reset on page reload.
- **Board chrome actions are not wired** — the omnibox send and the action-menu attach, dictation, and web-search entries only close the menu; they do not yet reach Sessions, files, or the Web capability. Selecting the element-inspector entry already works.
- **Tool and settings windows ship frames without content** — no board surface presents mock tool, connector, or settings content; the real per-window preset, model, and working-directory fields arrive with the stages that own them (11 and 13), and a client system-prompt editor does not exist in Harness at all.

<a id="dev-note"></a>
### Dev Note

None.
