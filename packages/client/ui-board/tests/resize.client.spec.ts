/**
 * Window resize geometry: edge drags move one axis, corner drags move both
 * axes independently, Shift scales them by one factor (the opposite corner
 * stays fixed), Alt releases the grid snap, and every path clamps to the
 * window floor in both axes.
 */
import { describe, expect, it } from 'vitest'
import { isCorner, resizeStep, type ResizeModifiers, type WindowRect } from '../src/client/resize.ts'
import { MIN_WINDOW_SIZE } from '../src/client/store.ts'

const START: WindowRect = { x: 240, y: 120, width: 552, height: 648 }
const FREE: ResizeModifiers = { proportional: false, snap: false }
const PROPORTIONAL: ResizeModifiers = { proportional: true, snap: false }

describe('resizeStep', () => {
  it('moves one axis for edge drags and keeps the opposite edge fixed', () => {
    expect(resizeStep('e', START, 100, 40, FREE)).toEqual({ x: 240, y: 120, width: 652, height: 648 })
    expect(resizeStep('s', START, 40, 100, FREE)).toEqual({ x: 240, y: 120, width: 552, height: 748 })
    // West and north drags move the origin so the opposite edge stays put.
    expect(resizeStep('w', START, -100, 0, FREE)).toEqual({ x: 140, y: 120, width: 652, height: 648 })
    expect(resizeStep('n', START, 0, -100, FREE)).toEqual({ x: 240, y: 20, width: 552, height: 748 })
  })

  it('shrinks an edge drag in both directions', () => {
    expect(resizeStep('e', START, -100, 0, FREE)).toEqual({ x: 240, y: 120, width: 452, height: 648 })
    expect(resizeStep('w', START, 100, 0, FREE)).toEqual({ x: 340, y: 120, width: 452, height: 648 })
    expect(resizeStep('s', START, 0, -100, FREE)).toEqual({ x: 240, y: 120, width: 552, height: 548 })
    expect(resizeStep('n', START, 0, 100, FREE)).toEqual({ x: 240, y: 220, width: 552, height: 548 })
  })

  it('moves both axes independently for corner drags', () => {
    // South-east grows width and shrinks height at once, anchored at the
    // north-west corner.
    expect(resizeStep('se', START, 100, -50, FREE)).toEqual({ x: 240, y: 120, width: 652, height: 598 })
    // North-west moves width, height, and the origin; the opposite corner is
    // the anchor.
    const west = resizeStep('nw', START, -100, -50, FREE)
    expect(west).toEqual({ x: 140, y: 70, width: 652, height: 698 })
    expect(west.x + west.width).toBe(START.x + START.width)
    expect(west.y + west.height).toBe(START.y + START.height)
    // The remaining corners mirror the rule.
    expect(resizeStep('ne', START, -100, 100, FREE)).toEqual({ x: 240, y: 220, width: 452, height: 548 })
    expect(resizeStep('sw', START, 100, -100, FREE)).toEqual({ x: 340, y: 120, width: 452, height: 548 })
  })

  it('clamps every direction and both axes to the window floor', () => {
    for (const direction of ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'] as const) {
      const next = resizeStep(direction, START, -10_000, -10_000, FREE)
      expect(next.width, direction).toBeGreaterThanOrEqual(MIN_WINDOW_SIZE.width)
      expect(next.height, direction).toBeGreaterThanOrEqual(MIN_WINDOW_SIZE.height)
    }
    // A corner drag that only pushes one axis below the floor still floors
    // that axis; the other keeps the drag's own value.
    expect(resizeStep('se', START, -400, 0, FREE)).toEqual({
      x: START.x,
      y: START.y,
      width: MIN_WINDOW_SIZE.width,
      height: START.height,
    })
    expect(resizeStep('se', START, 0, -400, FREE)).toEqual({
      x: START.x,
      y: START.y,
      width: START.width,
      height: MIN_WINDOW_SIZE.height,
    })
  })

  it('scales both axes by the dominant factor for proportional corner drags', () => {
    const grown = resizeStep('se', START, 230, 0, PROPORTIONAL)
    expect(grown.width).toBe(782)
    expect(grown.height).toBe(918)
    expect(grown.width / grown.height).toBeCloseTo(START.width / START.height, 5)
    // The opposite corner is the anchor.
    expect(grown.x).toBe(START.x)
    expect(grown.y).toBe(START.y)

    const anchored = resizeStep('nw', START, -230, 0, PROPORTIONAL)
    expect(anchored.width).toBe(782)
    expect(anchored.height).toBe(918)
    expect(anchored.x + anchored.width).toBe(START.x + START.width)
    expect(anchored.y + anchored.height).toBe(START.y + START.height)
  })

  it('shrinks proportionally and keeps the ratio at the floor', () => {
    const shrunk = resizeStep('se', START, -138, 0, PROPORTIONAL)
    expect(shrunk.width / shrunk.height).toBeCloseTo(START.width / START.height, 5)
    expect(shrunk.height).toBe(486)

    // Dragging far past the floor stops at the floor without breaking the
    // ratio: the tighter axis' minimum fixes the factor.
    const floored = resizeStep('se', START, -10_000, -10_000, PROPORTIONAL)
    expect(floored.width / floored.height).toBeCloseTo(START.width / START.height, 2)
    expect(floored.width).toBeGreaterThanOrEqual(MIN_WINDOW_SIZE.width)
    expect(floored.height).toBeGreaterThanOrEqual(MIN_WINDOW_SIZE.height)

    // The axis the pointer moved further picks the factor, in both directions.
    const dominant = resizeStep('se', START, 10, 400, PROPORTIONAL)
    expect(dominant.height).toBeGreaterThan(floored.height)
    expect(dominant.height).toBeGreaterThan(START.height)
  })

  it('snaps sizes to the grid without breaking the floor', () => {
    const next = resizeStep('se', START, 13, 17, { proportional: false, snap: true })
    expect(next.width % 24).toBe(0)
    expect(next.height % 24).toBe(0)
    expect(next.width).toBeGreaterThanOrEqual(MIN_WINDOW_SIZE.width)
    expect(next.height).toBeGreaterThanOrEqual(MIN_WINDOW_SIZE.height)

    const proportional = resizeStep('se', START, 13, 17, { proportional: true, snap: true })
    expect(proportional.width % 24).toBe(0)
    expect(proportional.height % 24).toBe(0)
    expect(proportional.width).toBeGreaterThanOrEqual(MIN_WINDOW_SIZE.width)
    expect(proportional.height).toBeGreaterThanOrEqual(MIN_WINDOW_SIZE.height)

    // Without the snap the axes keep the pointer's own numbers.
    expect(resizeStep('se', START, 13, 17, FREE)).toMatchObject({ width: 565, height: 665 })
  })

  it('names the two-axis directions', () => {
    for (const direction of ['nw', 'ne', 'sw', 'se'] as const) expect(isCorner(direction), direction).toBe(true)
    for (const direction of ['n', 's', 'e', 'w'] as const) expect(isCorner(direction), direction).toBe(false)
  })
})
