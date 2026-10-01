# Agent Note: Ketos stage 24: the board's bottom dock, interface modes, and per-window panels

Status: implemented

English | [中文](2026-09-29-ketos-stage-24-board-redesign.zh.md)

## Problem

The spatial board carried chrome that no longer matched its role: a vertical rail on every window, an omnibar over the canvas, one global chats panel shared by all windows, a board-only fullscreen mode, a fullscreen board framed inside the shell, and a sidebar entry that competed with the interface switch the product needs. The three requirements agreed with the user on 2026-09-29 asked for a macOS-like bottom dock, one interface switch between the board and the standard interface, and two panels per window that mirror the standard interface's working folders and right panel. The standard interface's own surfaces cannot be mounted a second time: `WorkspaceBrowser`'s owner share, global navigation, single view store, and directory-flow hole block a second instance, and `ui-sidebar-right` is a single-instance column whose tab slots are declared once and whose session scope is always the application's current session.

## Decision

**А1 — the left panel is built in `ui-board` as a working-folder tree.** `WindowChatsPanel` renders every registered workspace in registry order plus an ungrouped bucket, with the search field, grouping and ordering menu, folder registration and its browser, per-row menus, drag reordering, and New session on the bridge actions already bound to the window. The tree follows the sidebar's elements, order, and behavior at one density step below it. The window session's own folder opens automatically, and the expanded set lives in the board store, so the tree returns as it was left when the board remounts. The rejected second `WorkspaceBrowser` entry is recorded under Alternatives.

**А2 — the right panel is built in `ui-board` as a tabbed file surface.** The panel owns a tab strip with `+` and one collapse control; `+` opens a Home tab whose Workspace files row opens the Files tab. The Files tab lists the session workspace root through `remote.workspaceFiles.list` with the absolute path and Reload; a viewer tab reads its file through `remote.workspaceFiles.read` (text) or `readAll` (bytes) in the mode `ctx.documentPreviews.candidates(path)[0]` declares, and draws the extension's renderer (image, PDF, Markdown, text). Tabs live in the board store keyed by session id, so they follow the window's session; a viewer tab for an absolute path is activated instead of duplicated. File links in the lane — artifact chips, tool-card file chips, and path-like inline code resolved through `MarkdownText`'s file-mention vocabulary — open a viewer tab and reveal the panel.

**А3 — the interface mode is the active main panel.** `ui-layout`'s `ILayout.declarePanelSidebar(panelId, false)` lets the board's main-panel registration declare itself sidebar-less; while it is selected, the sidebar column has zero width and its rail and resize handle do not render, so the board fills the frame. Startup is always the standard interface because `activePanelId` is not persisted. The switch is one control: `sidebar.brand.actions` in the sidebar's brand row and the board's badge at the same screen position, and the board's panel-list entry is gone.

**А4 — the window draft lives in the board store.** The unsent text, images, and staged files (with their `File` sources) sit in `drafts` keyed by window id, so switching the main panel away from the board — which unmounts the board's React tree — keeps them. Expanding a window hands the draft to the session's own composer (`SessionInput.addFiles` and `setDraft`); returning takes the standard draft back (`SessionInput.takeDraft`). A receipt-only file stays in the window because it carries no browser bytes.

**А5 — the session bridge never moves the application's current session.** `BoardSessionBridge.attach` opens a session's live stream through `ISessions.openStream` instead of selecting it, so restoring a layout cannot replace the session the standard interface shows. Only explicit transitions (expanding a window, returning to it) select a session, and the binding rules Т2.13–Т2.16 run only for an expanded window.

**А6 — the dock order is its own durable field.** `dockOrder` and `cloneOrder` are additive version-1 fields with empty defaults; focusing a window writes only the paint order, and dragging a dock icon writes its group's order, so icons stop moving on every focus and a restored document without the fields fills them by window ordinal.

**А7 — the shared-panel replacement is deferred.** Replacing the board's own panels with the standard components requires a session-scoped slot area for an arbitrary session in `ui-renderer` and a multi-instance right panel. The debt is tracked as a Beads task; nothing in this stage depends on it.

**Д3.2 — show all windows and centring fit the safe area.** The dock's show-all control and `Ctrl/Cmd+0` fit the bounding box of every window, its open panels included, into the chrome-free rectangle at no more than zoom 1; a board without windows returns to pan (0, 0) and zoom 1. `centerOnWindow` — the return from «Вернуть в окно» included — and revealing an off-screen window reduce the zoom when the window and its open panels are larger than the free rectangle, so a tall window lands fully inside the board. An unmeasured board (no free rectangle yet) falls back to the initial view for show-all and keeps the current zoom while centring.

**Layout fields.** Each window durably carries `leftPanelOpen`/`leftPanelWidth` (default 260, range 260–360) and `rightPanelOpen`/`rightPanelWidth` (default 360, range 280–600), all additive with defaults inside version 1. The removed global panel's `panelWindowId`, `panelCollapsed`, and `panelWidth` remain in the version-1 schema as accepted-and-ignored fields: a stored document still parses, the repair normalizes them to their schema defaults, and the running board never reads them. `panelGroupBy` and `panelOrderBy` remain active view state. The expanded working-folder groups (`panelExpandedGroups`) and the right-panel tabs (`rightPanels`) are in-memory only; the layout never carries them.

**Upstream packages.** `ui-layout` gains `ILayout.declarePanelSidebar`; `ui-sidebar` declares the `sidebar.brand.actions` list slot; `ui-conversation` gains `SessionInput.addFiles` and `takeDraft` plus the `conversation.session.header.blank` list slot; `session-controller` gains `ISessions.openStream`; `ui-primitives` carries the stage-23 tooltip and menu portal work this stage depends on. Each change is recorded in [`docs/ketos/upstream-sync.md`](../../../../docs/ketos/upstream-sync.md) with its verification.

## Alternatives considered

- **A second `WorkspaceBrowser` instance in a board slot.** Seven blockers (owner share, global navigation on `selectPanel(null)`, one shared view store, the hard-wired directory-flow hole, and a slot-type reference cycle) plus edits to `ui-workspace`, `ui-sidebar`, and both directory pickers. The board's own tree reuses the already window-bound bridge actions instead.
- **One `ui-sidebar-right` instance per window.** Requires a session-scoped slot area for an arbitrary session, lifting the one-declaration-per-tab-kind rule, and a controller with multiple bindings. Deferred as А7; the board's own tab strip reads the same file and preview services.
- **A separate interface-mode flag in `ui-layout`.** Two sources of truth that can diverge from the active panel; the active panel is the mode.
- **Persisting the window draft with the layout.** A `File` does not serialize, and a reload starting from an empty composer is honest.
- **Keeping `sessions.open` in `attach`.** Restoring the layout would replace the user's current session, making the startup requirement and the binding rules impossible.
- **Raising the layout schema version for the new fields.** It would reset every stored layout; additive defaults inside version 1 keep existing boards.
- **Keeping the global panel fields as live state beside the per-window panels.** Two contradictory owners of the same surface; the fields are ignored instead, and the README states it.

## Consequences

The board owns its full chrome and both panels, and the standard interface keeps only the switch, the return control, and the draft handoff. The board's panels duplicate the standard surfaces' presentation rather than sharing components — the accepted cost until А7. A stored document from an earlier build keeps its windows, geometry, and view; its removed global panel state is normalized to defaults and nothing else changes. Dock icons keep their order across focus and reload. The board's window header now carries exactly the close, left-panel, title, right-panel, and expand controls, and the right panel's only chrome control is collapse.

Verification: `packages/client/ui-board/tests` (store actions and layout round trips, panel geometry, the working-folder tree, right-panel tabs and viewers, dock order, the session bridge, the draft handoff), `packages/client/ui-layout/tests` and `packages/client/ui-sidebar/tests` (the sidebar-less panel and the brand action), `packages/client/ui-conversation/tests` (the input matrix and the blank header seat), `packages/ketos/client-locale-ru/tests` (dictionary parity), and `apps/web/tests/board-geometry.e2e.ts` (dock geometry and screen size, the mode switch, the header controls, both panels open, panel stacking, panel scale at zoom 0.5/1/2); the full browser suite runs under `DSH_SNAPSHOT=replay pnpm run test:web`.

## Related

- [`docs/ketos/board-redesign-plan.md`](../../../../docs/ketos/board-redesign-plan.md) — the stage plan whose А1–А7, requirements Т1–Т3, and acceptance gates this note records the outcome of.
- [`docs/ketos/upstream-sync.md`](../../../../docs/ketos/upstream-sync.md) — the upstream-package changes and their verification.
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.md) — the board's user-facing behavior, layout fields, and limitations.
