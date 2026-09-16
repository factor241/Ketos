/**
 * Window resize geometry shared by both frames. An edge drag moves one axis;
 * a corner drag scales the window proportionally — both axes by the same
 * factor — so the window keeps its shape. Every path snaps to the board grid
 * (unless Shift is held) and clamps to the store's minimum size, which is the
 * size the window is created with.
 */
import { clampWindowSize } from '../store.ts'

/** The 8 resize directions the frame exposes: edges first, then corners. */
export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

/** Every resize direction, edges first. */
export const RESIZE_DIRECTIONS = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'] as const satisfies readonly ResizeDirection[]

/** Corner directions, which scale both axes by one factor. */
const CORNERS: ReadonlySet<ResizeDirection> = new Set(['nw', 'ne', 'sw', 'se'])

/**
 * Whether a direction scales the window proportionally.
 * @param direction - resize direction.
 * @returns true for the four corners.
 */
export function isProportional(direction: ResizeDirection): boolean {
  return CORNERS.has(direction)
}

/** One window rectangle: position and size in world units. */
export interface WindowRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Compute the rectangle a drag step asks for.
 *
 * Edges change one axis. Corners scale both axes by the dominant factor, so a
 * diagonal drag grows the window in percent while the opposite corner stays
 * fixed; a corner drag never shrinks the window below its current size (the
 * store's minimum floor still applies).
 * @param direction - resize direction the gesture started from.
 * @param start - rectangle captured when the gesture began.
 * @param dx - pointer delta along x, already divided by the canvas zoom.
 * @param dy - pointer delta along y, already divided by the canvas zoom.
 * @param snap - whether grid snapping is on for this gesture.
 * @returns the requested rectangle (snapped and clamped to the minimum).
 */
export function resizeStep(
  direction: ResizeDirection,
  start: WindowRect,
  dx: number,
  dy: number,
  snap: boolean,
): WindowRect {
  if (!isProportional(direction)) {
    const wantsWest = direction === 'w'
    const wantsEast = direction === 'e'
    const wantsNorth = direction === 'n'
    const wantsSouth = direction === 's'
    // An edge drag moves exactly the axis it names; the other stays put.
    const width = wantsWest ? start.width - dx : wantsEast ? start.width + dx : start.width
    const height = wantsNorth ? start.height - dy : wantsSouth ? start.height + dy : start.height
    const size = clampWindowSize(width, height, snap)
    return {
      x: wantsWest ? start.x + start.width - size.width : start.x,
      y: wantsNorth ? start.y + start.height - size.height : start.y,
      width: size.width,
      height: size.height,
    }
  }

  // The factor follows the axis the pointer pushed further, so both growing
  // and shrinking drags stay diagonal.
  const factorX = direction.includes('w')
    ? (start.width - dx) / start.width
    : (start.width + dx) / start.width
  const factorY = direction.includes('n')
    ? (start.height - dy) / start.height
    : (start.height + dy) / start.height
  const factor = Math.max(1, factorX, factorY)
  const size = clampWindowSize(start.width * factor, start.height * factor, snap)
  return {
    x: direction.includes('w') ? start.x + start.width - size.width : start.x,
    y: direction.includes('n') ? start.y + start.height - size.height : start.y,
    width: size.width,
    height: size.height,
  }
}
