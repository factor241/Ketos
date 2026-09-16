# Agent Note: Board windows fill the panel in fullscreen instead of handing off to the main panel

Status: implemented

English | [中文](2026-09-16-ketos-board-window-fullscreen.zh.md)

## Problem

A board window is 552×648 by design, and the only way to see more of its chat was to leave the board: the expand badge in the lane ran `sessions.open(id)` plus `layout.selectPanel(null)`, which hid the board panel, dropped the window's own composer, and made the session current for the rest of the app. The user asked for the window itself to have a fullscreen mode — the frame's top-right button, no navigation — and for the dock, omnibar, and minimap to make room for it.

## Decision

**The board store owns the mode.** `BoardState.fullscreenWindowId` holds the window filling the panel or null; `setWindowFullscreen(id)` records it and raises the window, `exitFullscreen()` clears it, and `closeWindow` clears it when the fullscreen window itself closes. The window's stored `x/y/width/height` stay authoritative while the mode is on, so leaving it restores the exact rectangle the user arranged.

**The canvas drops its transform under a fullscreen window.** An `inset: 0` frame inside the canvas surface would otherwise scale with `--board-zoom` and sit in world coordinates. While the mode is on, `DashboardCanvas` publishes identity pan and zoom, and the frame renders `inset: 0` with a top `zIndex`; the other frames stay mounted and hidden (`isWindowHidden` in `canvas/culling.ts`, applied as `content-visibility: hidden`) so their lane, draft, and chats-panel state survives the mode, `BoardRoot` stops rendering `board.dock`, `board.omnibar`, and `board.minimap`, and the active window's handle ring stands down with them, the frame's `.fullscreen` class squares the corners and drops the floating elevation, its resize handles disappear, and header drag does nothing. Wheel zoom stands down so the lane and its popups scroll normally. Escape and the header button both leave the mode.

**The mode is a store transition, not an injected callback.** The `openInMainPanel` member left `BoardWindowInjected`, the bridge, and the plugin's `inject` list, together with the `layout` service; the header carries the toggle, labelled `window.fullscreen` and `window.exitFullscreen`. The shared icon set ships the outline-expand glyph only, so the restore glyph is board-local (`window/fullscreen-glyph.tsx`); tool windows keep the close control alone, since their bodies ship with the stages that own their content.

## Alternatives considered

- **Keep the main-panel handoff beside fullscreen.** Rejected: the user asked for one action, and the session already stays reachable through the sidebar list.
- **Fill the whole browser viewport instead of the board panel.** Rejected: the board is a main panel inside the app frame; filling it keeps the shell's sidebar and session list usable, and `position: fixed` from inside the transformed surface needs a portal or a containing-block escape the slot composition does not offer.
- **Portal the frame to `document.body`.** Rejected: the same containment problem, plus the frame's DOM would leave the canvas its own tests and the element-selection overlay address.
- **Grow the stored rectangle while fullscreen and restore on exit.** Rejected: geometry is the user's arrangement; a mode that rewrites it loses the original on any interruption and makes the minimap projection and `centerOnWindow` lie.
- **Add a keyboard shortcut beyond Escape.** Deferred: stage 5.3 owns `Escape` closing the active window, and the shortcut set belongs with it.

## Consequences

A window has an in-place fullscreen mode with an exact restore, the other windows keep their drafts while the mode is on (the same hide-not-unmount rule [the canvas engine](2026-09-17-ketos-board-gestures-culling.md) later applied to culling), and the earlier chrome-over-handles gap (`ketos-d3a`) does not exist inside it because the chrome leaves. What it gives up: tool windows cannot go fullscreen, the mode is board-local (the main panel keeps showing whatever session it showed), and leaving the board is now only through the sidebar session list.

Verification: `tests/store.client.spec.ts` pins enter, exit, close-clears, unknown-id, and the untouched rectangle; `tests/slots.client.spec.tsx` pins the frame's `inset: 0`, the mounted-but-hidden neighbour and the absent chrome layers, the identity pan/zoom on the canvas, Escape restoring the stored geometry, and the header toggle closing the mode.

## Related

- [Board windows own Harness sessions and rebuild the chat composer](2026-09-16-ketos-board-window-sessions.md) — the composer and bridge this action used to leave through.
- [Board gestures, culling, and the window-manager budgets](2026-09-17-ketos-board-gestures-culling.md) — the hide-not-unmount rule this mode now shares with culling.
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.md) — the window interactions this mode extends.
- [`ketos-d3a`](../../../../docs/ketos/reports/stage-04-theme-i18n.md) — the chrome-over-handles limitation the mode sidesteps rather than fixes.
