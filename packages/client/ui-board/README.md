---
description: "Web spatial board for the dsh web client: a main-panel spatial canvas with draggable, resizable windows, pan/zoom navigation, a minimap, and a toolbar."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-board

English | [中文](README.zh.md)

## Summary

The board is a spatial main panel for the dsh web client: an `OpenSwarm`-style infinite canvas where windows (agent cards, tool and connector windows) are placed, moved, resized, stacked, and closed. The user pans the canvas by dragging its background and zooms with the wheel toward the pointer position; a toolbar adds agent and tool windows at the view center and can reset the view; a minimap in the corner mirrors the window layout. The plugin registers the board as the `board` main panel and its icon in the sidebar panel list.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Open the bot panel through the board icon in the sidebar panel list; the canvas fills the main panel and starts empty. Drag the background to pan, wheel to zoom (0.2–2.0, centered on the pointer), and use the toolbar buttons to add an agent card or a tool window at the center of the current view. Window interactions follow one convention: drag the header to move, drag an edge handle to resize, and hold Shift while dragging to disable the 24 px grid snap; clicking a window brings it to the front of the z-order, and its close button removes it. Selecting a window in the rail or minimap focuses it and centers the view on it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

**Runtime invariant:** No companion is published. The panel entry registers the `main` slot with the single engine store; the store's disposer proves removal, independently observable through the board.* slot declarations.

<details>
<summary>Implementation internals — click to expand</summary>

One registration surface: `apply` registers the `main` panel entry (with the shared board store) and the `sidebar.panellist` icon; the contract module additionally declares the `board.*` slot set (`board.canvas`, `board.dock`, `board.windows`, `board.window`, `board.minimap`, `board.omnibar`) so later composition can place these regions as slots instead of the built-in assembly. Board state is one `dsh-client-store` engine store declared at the panel entry — pan, zoom, window map, z-order, and the element-selection flag — with pure draft actions (`setPan`, `setZoom`, `zoomTowardPointer`, `addWindow`, `moveWindow`, `resizeWindow`, `focusWindow`, `closeWindow`, `setSelectingElement`). Everything the canvas reads arrives through the store's framework `useStore` seat; components hold no subscriptions of their own. Visible copy is locale-owned: `apply` registers the `board` namespace dictionaries through `ctx.locale` and the panel entry declares the namespace, which puts the typed `t` seat on `BoardRoot` and threads localized strings down as props.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Slots reference](../../../docs/subsystems/slots.md) — the slot protocol `apply` and the `board.*` contract depend on.
- [client store](../store/README.md) — the `defineStore` engine backing the board state.
- [ui-sidebar](../ui-sidebar/README.md) — the panel list where the board icon registers.

-----

<a id="model-experience"></a>
## Model Experience

None, as the board is a browser-only canvas: it registers no tool, prompt section, or session event, and everything it renders is board-local view state.

#### KV Cache effect

No effect; the board adds nothing to any model request and consumes no session-log content.

## Known Limitations and Deferred Work

These limits are current package constraints.

- **Window cards are static placeholders** — `AgentCard` and `ToolWindow` render their own fixed local content; the contract's `sessionId`, `status`, and `contextUsed` fields are not populated from live Sessions, so agent windows are not yet bound to running agents.
- **Per-window preset selection is pending** — an agent window has no UI to choose its agent preset or model; every window shows the same fixed card content until that selection model lands.
- **The built-in assembly bypasses the declared slot set** — the current assembly renders `DashboardCanvas` directly in the `main` panel; the `board.*` slots exist as contract for follow-up composition and are unused.
- **The layout is session-only** — `apply` creates the board store without a persist key, so pan, zoom, and window arrangement reset on page reload.
- **Board chrome actions are not wired** — the omnibox send and the action-menu attach, dictation, and web-search entries only close the menu; they do not yet reach Sessions, files, or the Web capability.
- **The palette is theme-independent** — components paint literal colors instead of `--dsw-*` semantic tokens, so the board keeps its own light palette under a dark application theme until the token migration.

<a id="dev-note"></a>
### Dev Note

None.
