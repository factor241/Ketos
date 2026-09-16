---
description: "Web spatial board for the dsh web client: a main-panel spatial canvas with draggable, resizable windows, pan/zoom navigation, a minimap, and a toolbar."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-board

English | [中文](README.zh.md)

## Summary

The board is a spatial main panel for the dsh web client: an infinite canvas where agent windows are placed, moved, resized, stacked, and closed. Each window owns a Harness session and carries the full chat composer — the agent-preset chip, the action and slash menus, `@` mentions, permission and model chips, the context ring, image attachments, and the goal, to-do, and queue strips. A dock and an Omnibox open windows at the view center, and a minimap mirrors the layout. It registers the `board` main panel and its sidebar icon, drawing with the shared Harness theme.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Open the board panel through the board icon in the sidebar panel list; the canvas fills the main panel and starts empty. Drag the background to pan, wheel to zoom (0.2–2.0, centered on the pointer), and use the dock's plus button to add an agent card at the center of the current view. Window interactions follow one convention: drag the header to move, drag an edge handle to resize one axis, drag a corner handle to scale the window proportionally (both axes by the same factor, the opposite corner anchored), and hold Shift while dragging to disable the 24 px grid snap; clicking a window brings it to the front of the z-order, and its close button removes it. A window never shrinks below the size it is created with (the default chat size, 552×648 for an agent window) — the composer's rows cannot lay out in less — while growing in width, height, or diagonally is unbounded. The window renders one scale above the app: its titles, lane text, chips, controls, and composer read one metric set (`--board-font-*` and the control, padding, and gap values) declared on the board root, so the frame and its contents grow together while the dock, omnibar, minimap, and portalled menus keep the app's sizes. The header's chats button opens a panel that slides out of the window's left edge (the right one when the left has no room): the window's control surface for projects and chats. The projects level lists every workspace that holds a visible chat plus an ungrouped bucket, and its header registers a folder (the browser lists one directory level with clickable crumbs and creates nested folders before registering the picked directory), opens a search field, and opens the grouping and ordering menu (group by project or one list; manual order or last updated). Every row has a trailing menu — projects rename, move up or down, and delete (a registration only; chats and files stay), chats rename, branch at their last completed turn (the window then shows the child), move, and archive — and a drag on a row commits the same move. The chats level lists one project's chats with their relative age and a running marker; picking one points the window at it, and its header creates a chat in that project (reusing the project's blank chat when it has one). The panel is a layer of its own above the canvas: 300px wide by default, resizable by dragging its outer edge between 260 and 420px (never more than the room the frame leaves), at the frame's own height, following the window while it moves, resizes, pans, or zooms. Collapsed — and for every chat window that never opened it — a compact 44px rail at the same edge keeps the panel one click away, and the panel's own header carries the control that collapses it again. The board's dock and minimap stand down while a panel is open, so nothing covers its outer edge and resize handle. Escape closes the panel first and leaves fullscreen second. In fullscreen the panel docks along the board panel's left edge as the plain sidebar of a normal chat layout, with the chat centred on a 768px column beside it. Selecting a window in the dock or minimap focuses it and centers the view on it. The first time a window renders it creates its own session (the session appears in the sidebar list, and focusing the window makes it current). The composer mirrors the main chat: `+` opens the action menu (image attachments, goal, plan, feedback, compact, permission, model, export), `/` filters the slash commands with their hints and descriptions, `@` suggests files, directories, and sessions, the chip row switches the permission preset (full access behind the risk confirmation) and the model with its reasoning effort, and the ring shows context occupancy, and the microphone button dictates into the draft through the browser's speech recognition where the engine exposes it; the agent-preset chip is the only setup chip in the composer (the working folder lives in the window's chats panel), and the panel's folder action adopts a picked directory by re-creating the window's still-blank chat in it. Enter sends, Cmd/Ctrl+Enter steers the running turn, Shift+Enter inserts a newline, and the round button stops; the card measures itself and drops chip labels or wraps the tool row as the window narrows, so the send control stays reachable at every size; `Load earlier turns` pulls the previous turns into the lane, and the header's fullscreen button fills the board panel with the window until Escape or the same button brings it back; the other windows and the dock, omnibar, and minimap stand down while the window is fullscreen, and its stored rectangle is what returning restores.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

**Runtime invariant:** No companion is published. The panel entry registers the `main` slot with the single engine store and declares the layers it renders; the entry's disposal proves removal, independently observable through the `board.*` slot declarations.

<details>
<summary>Implementation internals — click to expand</summary>

One registration surface: `apply` composes the board as slots. The `main` panel entry declares `board.canvas`, `board.dock`, `board.omnibar`, and `board.minimap` and renders them through `renderSlot`; the canvas occupant declares `board.windows`; the window layer declares the keyed `board.window` (one registration per window type — the instance travels in owner props, so one occupant serves every window of its type) and the keyed `board.window.body` (one registration per body kind) and hands each frame the body dispatcher; the same `apply` registers the `sidebar.panellist` icon. The keyed keys are the `WindowKind` and `WindowBodyKind` unions, so a registration for an unknown key is a compile error. Board state is one `dsh-client-store` engine store declared at the panel entry — pan, zoom, viewport box, window map, z-order, and the element-selection flag — with pure draft actions (`setPan`, `setZoom`, `zoomTowardPointer`, `setViewport`, `addWindow`, `openWindow`, `moveWindow`, `resizeWindow`, `setWindowBodyKind`, `focusWindow`, `centerOnWindow`, `setWindowFullscreen`, `exitFullscreen`, `closeWindow`, `setSelectingElement`). Every layer and frame reads that same handle through the framework `useStore` seat; components hold no subscriptions of their own. Visible copy is locale-owned: `apply` registers the `board` namespace dictionaries through `ctx.locale` and each copy-bearing entry declares the namespace, which puts the typed `t` seat on its component. Styling reads the shared theme directly: each component owns a CSS Module beside it, inline styles carry only placement and the computed pan/zoom metrics, and the rules name `--dsw-*` semantic aliases — floating panels use the theme's layer-2 fill with an elevation hairline (rebound to the business accent on the focused window), internal separators are 0.5px hairlines, and the canvas dot grid rides the border scale. Interactive chrome comes from `ui-primitives`: header close buttons and the composer actions are Harness icons, the dock rows and the composer action are wrapped in `Tooltip`, the Omnibox action menu is the shared `Menu`, and the dock controls sit on the floating-fill token. The board therefore follows the shell's light/dark preference like any other panel. Window sessions live in an apply-side bridge (`session-bridge.ts`): the window id → session map, the `sessions.create()`/`open()`/`binding()` sequence, and the chat/session subscriptions all stay in the plugin closure, never in the store, and each window's lane state is republished through one identity-stable channel per window. The body registration exposes that channel as the keyed hook `useWindowSession(windowId)` plus the composer callbacks (`ensureWindowSession`, `sendPrompt`, `cancelPrompt`, `loadOlderTurns`), so one registration serves every window and components receive plain data.

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

- **The window lane renders prose and tool names only** — assistant text arrives as Markdown and streaming text is visible, while tool results collapse to a one-line row; the full tool cards (terminal, diff, read, search, web) and approval or question surfaces arrive with the stages that own them, and an approval currently navigates to the main panel instead of rendering in the window.
- **Window attachments are images only** — the action menu's file entry picks images and sends them inline with the prompt; other file kinds need the upload seam the conversation package owns, and `@` mentions insert plain text rather than editor chips.
- **The window composer keeps its own submission policy** — plain Enter queues, Cmd/Ctrl+Enter steers, and the bar reads no submission-preference setting.
- **Assistant markdown keeps the app's content font size** — the shared Markdown surface reads the app's font-size setting, so only the window's own chrome, transcript text, and composer take the window scale; raise the app's font size for larger assistant prose.
- **The chats panel has no unarchive and no session delete** — archiving a chat is one-way and the client exposes no delete for sessions at all; deleting a project removes its registration, never its chats or files.
- **The panel's folder browser needs the browse directory picker** — a deployment composed with the platform-native chooser cannot list directories, so the folder browser reports the failure and the app's own add-folder flow (the OS chooser) remains the way to register a directory there.
- **The dock and minimap stand down while a chats panel is open** — the panel is a management surface, and their strips would otherwise cover its outer edge and resize handle; the frame's chats button and the panel's own rail bring it back.
- **A rebound window keeps its own title** — the header shows the name the window was opened with, not the chat's title, which the panel carries.
- **Floating chrome can cover a window's resize handles** — the dock, omnibar, and minimap sit above the canvas, so a handle whose window edge lies beneath them cannot be grabbed by pointer; pan or center the window to reach it (`ketos-d3a`).
- **Per-window preset selection is pending** — an agent window has no UI to choose its agent preset or model, and a session's working directory is fixed at creation.
- **The frame body dispatcher is an owner prop** — the windows layer is the single declarer of `board.window.body` (the slot core allows one declarer per key), so it passes each frame a `renderBody` callback instead of a `renderSlot` seat of its own.
- **The layout is session-only** — `apply` creates the board store without a persist key, so pan, zoom, and window arrangement reset on page reload.
- **The Omnibox is not wired to a session** — its send and the action-menu attach, dictation, and web-search entries only close the menu; they do not yet reach Sessions, files, or the Web capability. The element-inspector entry and the window composer work.
- **Tool and settings windows ship frames without content** — no board surface presents mock tool, connector, or settings content, and nothing opens those windows yet; the real per-window fields arrive with the stages that own them, and a client system-prompt editor does not exist in Harness at all.

<a id="dev-note"></a>
### Dev Note

None.
