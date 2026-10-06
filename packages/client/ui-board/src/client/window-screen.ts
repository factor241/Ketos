/**
 * Projection of one window's world rectangle into board-panel pixels. The
 * canvas surface applies `translate(pan) scale(zoom)` with the world origin at
 * the panel's top-left; the handle ring uses the same transform, so a resize
 * affordance stays over the window's border at any zoom.
 */
import { worldToScreen } from './board-coordinates.ts'
import type { BoardState } from './store.ts'
import type { BoardWindowState } from './contract/slots.ts'

/** One rectangle in board-panel pixels. */
export interface ScreenBox {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/**
 * The panel rectangle one window occupies under the canvas transform.
 * @param state - board state holding pan and zoom.
 * @param window - the window to project.
 * @returns the window's box in panel pixels.
 */
export function windowScreenRect(state: BoardState, window: BoardWindowState): ScreenBox {
  const own = state.windows[window.id as string] ?? window
  const topLeft = worldToScreen(state, { x: own.x, y: own.y })
  return {
    left: topLeft.x,
    top: topLeft.y,
    right: topLeft.x + own.width * state.zoom,
    bottom: topLeft.y + own.height * state.zoom,
  }
}

/**
 * Whether any part of one window lies inside the visible panel. This is the
 * projection without the culling margin, so a caller that only raises a window
 * can tell when the gesture would have no visible effect.
 * @param state - board state holding pan, zoom, and the viewport box.
 * @param window - the window to test.
 * @returns true when the window's panel rectangle overlaps the viewport.
 */
export function isWindowOnScreen(state: BoardState, window: BoardWindowState): boolean {
  const rect = windowScreenRect(state, window)
  return rect.right >= 0 && rect.left <= state.viewportWidth
    && rect.bottom >= 0 && rect.top <= state.viewportHeight
}
