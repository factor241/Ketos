/**
 * Window culling: which windows the canvas still renders. A window leaving the
 * view is hidden with CSS, never unmounted — its lane, draft, attachments, and
 * chats panel keep their state and return unchanged.
 */
import { visibleWorldRect } from './board-coordinates.ts'
import type { BoardState } from './store.ts'
import type { BoardWindowState } from './contract/slots.ts'
import { windowPanelOpen, windowPanelWidth } from './panel-geometry.ts'

/**
 * How far beyond the visible canvas a window keeps rendering, in world units.
 * The margin absorbs the frame's resize handles and the chats panel that
 * stands beside the frame, so nothing pops in halfway through a pan.
 */
export const CULL_MARGIN = 480

/**
 * One world rectangle for culling.
 */
export interface CullRect {
  /** World x of the box. */
  readonly x: number
  /** World y of the box. */
  readonly y: number
  /** World width of the box. */
  readonly w: number
  /** World height of the box. */
  readonly h: number
}

/**
 * Whether one world rectangle intersects the visible canvas (plus the culling
 * margin). Shared by the local window frames and the foreign-window layer.
 * @param state - board state holding the pan, zoom, and viewport box.
 * @param rect - the world rectangle.
 * @returns true when the rectangle should stay rendered.
 */
export function isRectVisible(state: BoardState, rect: CullRect): boolean {
  const visible = visibleWorldRect(state, CULL_MARGIN)
  return rect.x + rect.w >= visible.left
    && rect.x <= visible.right
    && rect.y + rect.h >= visible.top
    && rect.y <= visible.bottom
}

/**
 * Whether one window intersects the visible canvas (plus the culling margin).
 * @param state - board state holding the pan, zoom, and viewport box.
 * @param window - the window rectangle in world units.
 * @returns true when the window should stay rendered.
 */
export function isWindowVisible(state: BoardState, window: BoardWindowState): boolean {
  const visible = visibleWorldRect(state, CULL_MARGIN)
  // An open panel is part of the window's footprint: a frame whose panel is
  // visible must not be culled away with it (Т3.12).
  const footprintLeft = windowPanelOpen(window, 'left') ? window.x - windowPanelWidth(window, 'left') : window.x
  const footprintRight = windowPanelOpen(window, 'right')
    ? window.x + window.width + windowPanelWidth(window, 'right')
    : window.x + window.width
  return footprintRight >= visible.left
    && footprintLeft <= visible.right
    && window.y + window.height >= visible.top
    && window.y <= visible.bottom
}

/**
 * Whether one window is hidden this render: it left the visible canvas.
 * @param state - board state holding the pan, zoom, and viewport.
 * @param window - the window the frame or panel belongs to.
 * @returns true when the frame and its panel should take the hidden class.
 */
export function isWindowHidden(state: BoardState, window: BoardWindowState): boolean {
  const own = state.windows[window.id as string] ?? window
  return !isWindowVisible(state, own)
}
