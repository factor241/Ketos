/**
 * Window resize geometry shared by both frames. An edge drag moves one axis;
 * a corner drag moves both axes independently unless Shift is held, which
 * scales them by one factor so the window keeps its shape. Every path snaps to
 * the board grid unless Alt is held and clamps to the store's minimum size.
 */
import { MIN_WINDOW_SIZE, snapPosition } from './store.ts'

/** The 8 resize directions the frame exposes: edges first, then corners. */
export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

/** Every resize direction, edges first. */
export const RESIZE_DIRECTIONS = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'] as const satisfies readonly ResizeDirection[]

/** Corner directions, which move both axes. */
const CORNERS: ReadonlySet<ResizeDirection> = new Set(['nw', 'ne', 'sw', 'se'])

/**
 * Whether a direction moves both axes.
 * @param direction - resize direction.
 * @returns true for the four corners.
 */
export function isCorner(direction: ResizeDirection): boolean {
  return CORNERS.has(direction)
}

/** One window rectangle: position and size in world units. */
export interface WindowRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Gesture-wide resize rules read from the pointer's modifier keys. */
export interface ResizeModifiers {
  /** Scale both axes by one factor instead of moving each independently. */
  readonly proportional: boolean
  /** Snap the requested size to the 24 px board grid. */
  readonly snap: boolean
}

/**
 * Compute the rectangle a drag step asks for.
 *
 * Edges change one axis. Corners change both axes independently — each axis
 * grows and shrinks on its own — unless `proportional` is set, when one factor
 * follows the axis the pointer moved further and the opposite corner stays
 * anchored. Every path clamps to the store's minimum size in both axes.
 * @param direction - resize direction the gesture started from.
 * @param start - rectangle captured when the gesture began.
 * @param dx - pointer delta along x, already divided by the canvas zoom.
 * @param dy - pointer delta along y, already divided by the canvas zoom.
 * @param modifiers - proportional scaling and grid snapping for this gesture.
 * @param min - smallest size the drag may leave; defaults to the window floor.
 * @returns the requested rectangle (snapped and clamped to the minimum).
 */
export function resizeStep(
  direction: ResizeDirection,
  start: WindowRect,
  dx: number,
  dy: number,
  modifiers: ResizeModifiers,
  min: { readonly width: number; readonly height: number } = MIN_WINDOW_SIZE,
): WindowRect {
  const wantsWest = direction === 'w' || direction === 'nw' || direction === 'sw'
  const wantsEast = direction === 'e' || direction === 'ne' || direction === 'se'
  const wantsNorth = direction === 'n' || direction === 'nw' || direction === 'ne'
  const wantsSouth = direction === 's' || direction === 'sw' || direction === 'se'
  const { snap } = modifiers
  const clamp = (width: number, height: number): { width: number; height: number } => ({
    width: Math.max(min.width, snapPosition(width, snap)),
    height: Math.max(min.height, snapPosition(height, snap)),
  })

  if (!isCorner(direction) || !modifiers.proportional) {
    const width = wantsWest ? start.width - dx : wantsEast ? start.width + dx : start.width
    const height = wantsNorth ? start.height - dy : wantsSouth ? start.height + dy : start.height
    const size = clamp(width, height)
    return {
      x: wantsWest ? start.x + start.width - size.width : start.x,
      y: wantsNorth ? start.y + start.height - size.height : start.y,
      width: size.width,
      height: size.height,
    }
  }

  // The factor follows the axis the pointer moved further, so both growing and
  // shrinking drags stay diagonal, and the minimum-size floor never breaks the
  // ratio: the floor factor is the tighter of the two axes' minimums.
  const factorX = wantsWest ? (start.width - dx) / start.width : (start.width + dx) / start.width
  const factorY = wantsNorth ? (start.height - dy) / start.height : (start.height + dy) / start.height
  const factor = Math.abs(factorX - 1) >= Math.abs(factorY - 1) ? factorX : factorY
  const floor = Math.max(min.width / start.width, min.height / start.height)
  const size = clamp(start.width * Math.max(floor, factor), start.height * Math.max(floor, factor))
  return {
    x: wantsWest ? start.x + start.width - size.width : start.x,
    y: wantsNorth ? start.y + start.height - size.height : start.y,
    width: size.width,
    height: size.height,
  }
}
