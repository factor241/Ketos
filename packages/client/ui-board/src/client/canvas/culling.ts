/**
 * Window culling: which windows the canvas still renders. A window leaving the
 * view is hidden with CSS, never unmounted — its lane, draft, attachments, and
 * chats panel keep their state and return unchanged.
 */
import type { BoardState } from '../store.ts'
import type { BoardWindowState } from '../contract/slots.ts'

/**
 * How far beyond the visible canvas a window keeps rendering, in world units.
 * The margin absorbs the frame's resize handles and the chats panel that
 * stands beside the frame, so nothing pops in halfway through a pan.
 */
export const CULL_MARGIN = 480

/**
 * Whether one window intersects the visible canvas (plus the culling margin).
 * @param state - board state holding the pan, zoom, and viewport box.
 * @param window - the window rectangle in world units.
 * @returns true when the window should stay rendered.
 */
export function isWindowVisible(state: BoardState, window: BoardWindowState): boolean {
  const left = -state.panX / state.zoom - CULL_MARGIN
  const top = -state.panY / state.zoom - CULL_MARGIN
  const right = (-state.panX + state.viewportWidth) / state.zoom + CULL_MARGIN
  const bottom = (-state.panY + state.viewportHeight) / state.zoom + CULL_MARGIN
  return window.x + window.width >= left
    && window.x <= right
    && window.y + window.height >= top
    && window.y <= bottom
}

/**
 * Whether one window is hidden this render: it left the visible canvas, or the
 * board is fullscreen on another window.
 * @param state - board state holding the pan, zoom, viewport, and fullscreen id.
 * @param window - the window the frame or panel belongs to.
 * @returns true when the frame and its panel should take the hidden class.
 */
export function isWindowHidden(state: BoardState, window: BoardWindowState): boolean {
  if (state.fullscreenWindowId !== null && state.fullscreenWindowId !== window.id) return true
  const own = state.windows[window.id as string] ?? window
  return !isWindowVisible(state, own)
}
