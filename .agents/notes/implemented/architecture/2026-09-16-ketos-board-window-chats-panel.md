# Agent Note: Board windows navigate projects and chats from a chats panel

Status: implemented

English | [中文](2026-09-16-ketos-board-window-chats-panel.zh.md)

## Problem

A board window could only ever show the chat it created: the window's working directory was fixed at creation, no surface listed the other sessions, and the only way to reach one was the app's own sidebar, which leaves the board. The user asked for the button the app sidebar carries — the panel-left glyph — in the window's header, sliding a compact list out from under the window: projects (workspaces) first, then the chats of the chosen project, with picking a chat pointing the window at it. The panel has to stay small (roughly a fifth of the window), follow the window while it is dragged or resized, read as a layer below the frame rather than a second window, and in fullscreen become the plain sidebar of a normal chat layout with the chat centred beside it.

## Decision

**The panel is a companion layer of the frame, not a second window.** `board.window.panel` is a keyed slot beside `board.window`, keyed by the same `WindowKind`; the windows layer renders it inside the window's own fragment, before the frame, so equal stacking plus DOM order puts every frame above its panel and the panel above the canvas. The panel carries no `z-index` of its own, its own `data-board-panel` attribute, and stays mounted while closed so the open and closed states are one transform transition (`--ds-transition-duration-slow`, `--ds-ease-in-out`, disabled under `prefers-reduced-motion`).

**Geometry is a function of the window rectangle.** `window/panel-geometry.ts` derives the rectangles in world units from `BoardWindowState`: the open panel takes the stored width (default 300px, clamped to 260–420px, never more than the room the frame leaves), stands at the frame's own height beside its left edge — the right edge when the left has no room, and inside the window's left edge when neither side does, above the frame — and the collapsed rail is a 44×170px strip centred on that same edge. Fullscreen docks the panel to the board panel's left edge at full height. Because the panel lives inside the transformed canvas surface, dragging, resizing, panning, and zooming need no panel code at all, and the outer-edge resize drag reads world units like every other frame gesture.

**The panel is resizable and always one click away.** Its width lives in the board store (`panelWidth`, clamped by `setPanelWidth`) and the outer edge carries an 8px drag strip; `panelCollapsed` collapses it back to the rail, whose own buttons open the panel again, and the panel's header carries the control that collapses it. None of that hides the frame's chats button, which stays the second way in.

**Fullscreen turns it into the normal chat layout.** With the panel open, the fullscreen frame's inset becomes `0 0 0 <panelWidth>` so the chat loses exactly the panel's width, and `ConversationBody` puts the lane and composer on a 768px column centred in what is left. The mode is one store field either way (`panelWindowId`), so Escape closes the panel first and leaves fullscreen second from one handler in the frame, and closing the window clears it.

**Picking a chat rebinds the window.** `BoardSessionBridge` splits its creation path into `create` (create, then switch) and a shared `switchTo`/`attach` pair, and exposes `bind(windowId, sessionId)` — validated against the session list, released and re-subscribed like a fresh attach — plus `createChat(windowId, target)` for `sessions.create({ workspaceId })` or a directory. The window's `useWindowSession` channel now carries `sessionId`, so the panel marks the chat the window shows. The panel reads the session and workspace lists through the inject face's `hooks` compartment (`useSessionList`, `useWorkspaceList`) rather than a global standard prop, keeping the board's dependency on `ctx.workspaces` explicit in its inject list.

**The panel is the window's management surface.** Projects rename, reorder (a row drag or the row menu's move commands) and delete through `ctx.workspaces.rename/insertBefore/delete`, and the header's folder browser lists one level at a time through `uiWorkspace.listDirectory`, creates nested folders through `createDirectory`, and registers the picked directory through `workspaces.create`. Chats reuse or create a chat in a project (`startChat`), rename (`session.rename`), branch (`sessions.fork` with `increaseTitle`, the child bound to the window), archive (`workspaces.archiveSession`), reorder (`workspaces.insertSessionBefore`), and search by title or directory, with the grouping (by project or one list) and ordering (manual or last updated) kept in the board store beside the panel's width. The dock and minimap stand down while a panel is open: they are board chrome, and their strips would otherwise cover the panel's outer edge and its resize handle.

**The list model is board-local.** `window/chat-list-model.ts` derives the groups the panel needs: membership from the workspace's own `sessionIds`, subagent and archived rows out, the blank session only for the window that shows it, newest first, the ungrouped bucket last. The sidebar's own tree derivation stays where it is — a feature plugin cannot import another's values, and the rules the board needs are a dozen lines.

## Alternatives considered

- **Reuse `ui-workspace`'s tree, rows, and menus.** Rejected: `tree.ts` and the row components are package internals, the grouping and sorting menus assume a full-width sidebar, and the compact strip cannot carry them (see the README's limitation).
- **Render the panel in its own board layer beside the canvas.** Rejected: the panel would leave the canvas transform, so every rectangle would need pan/zoom arithmetic and the frame could no longer cover it while closed.
- **Open one panel per window instead of one at a time.** Rejected: the store field keeps the mode exclusive, matches the fullscreen field beside it, and the panel is an overlay-ish surface a user opens deliberately.
- **Give the panel a z-index under the frames.** Rejected: a constant value would put it under the canvas chrome (dock, omnibar, minimap at z-index 100) and above lower windows inconsistently; DOM order inside the window fragment is exact and needs no number.
- **Keep the fullscreen frame at `inset: 0` and overlay the panel.** Rejected by the user's reference: fullscreen should read as the ordinary chat layout — sidebar plus a centred chat column — so the frame gives up the panel's width.
- **Port the app sidebar's session actions (rename, archive, fork) into the panel.** Deferred: the user asked for navigation first, the strip has room for rows only, and the client exposes no session delete at all.

## Consequences

A window can reach every chat of every project without leaving the board, and the window it rebinds keeps its own rectangle, title, and panel state. What it gives up: a rebound window's header still shows the name it was opened with, picking a chat makes that session current for the whole client (the only selection axis the session controller offers), the panel holds two shared-snapshot subscriptions per chat window, and management actions stay in the app sidebar.

Verification: `tests/panel-geometry.client.spec.ts` pins the clamps, the tucked rectangle, and the docked one; `tests/chat-list.client.spec.ts` pins grouping, the subagent/archived/blank filters, ordering, and the ungrouped bucket; `tests/store.client.spec.ts` pins one panel at a time and the close-with-window reset; `tests/slots.client.spec.tsx` pins the mounted-closed panel, the header toggle, the geometry it writes, the panel-before-frame order, the absence of a z-index, Escape closing the panel before fullscreen, the docked inset with the panel open, and a chat picked in the panel rebinding the window's directory chip.

## Related

- [Board windows own Harness sessions and rebuild the chat composer](2026-09-16-ketos-board-window-sessions.md) — the bridge this panel rebinds, and the composer whose directory chip follows it.
- [Board windows fill the panel in fullscreen instead of handing off to the main panel](2026-09-16-ketos-board-window-fullscreen.md) — the mode the panel docks into.
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.md) — the interactions and limits this panel adds.
