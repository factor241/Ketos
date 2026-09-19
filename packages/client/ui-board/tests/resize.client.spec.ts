/**
 * Window resize geometry: edge drags move one axis, corner drags scale both
 * axes by one factor (the opposite corner stays fixed), the grid snap never
 * lands below the window floor, and a diagonal drag never shrinks the window.
 */
import { describe, expect, it } from 'vitest'
import { isProportional, resizeStep, type WindowRect } from '../src/client/resize.ts'
import { MIN_WINDOW_SIZE } from '../src/client/store.ts'

const START: WindowRect = { x: 240, y: 120, width: 552, height: 648 }

describe('resizeStep', () => {
  it('moves one axis for edge drags and keeps the opposite edge fixed', () => {
    expect(resizeStep('e', START, 100, 40, false)).toEqual({ x: 240, y: 120, width: 652, height: 648 })
    expect(resizeStep('s', START, 40, 100, false)).toEqual({ x: 240, y: 120, width: 552, height: 748 })
    // West and north drags move the origin so the opposite edge stays put.
    expect(resizeStep('w', START, -100, 0, false)).toEqual({ x: 140, y: 120, width: 652, height: 648 })
    expect(resizeStep('n', START, 0, -100, false)).toEqual({ x: 240, y: 20, width: 552, height: 748 })
  })

  it('clamps every direction to the default chat size', () => {
    for (const direction of ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'] as const) {
      const next = resizeStep(direction, START, -10_000, -10_000, false)
      expect(next.width, direction).toBeGreaterThanOrEqual(MIN_WINDOW_SIZE.width)
      expect(next.height, direction).toBeGreaterThanOrEqual(MIN_WINDOW_SIZE.height)
    }
  })

  it('scales both axes by the dominant factor for corner drags', () => {
    const grown = resizeStep('se', START, 230, 0, false)
    expect(grown.width).toBe(782)
    expect(grown.height).toBe(918)
    expect(grown.width / grown.height).toBeCloseTo(START.width / START.height, 5)
    // The opposite corner is the anchor.
    expect(grown.x).toBe(START.x)
    expect(grown.y).toBe(START.y)

    const anchored = resizeStep('nw', START, -230, 0, false)
    expect(anchored.width).toBe(782)
    expect(anchored.height).toBe(918)
    expect(anchored.x + anchored.width).toBe(START.x + START.width)
    expect(anchored.y + anchored.height).toBe(START.y + START.height)
  })

  it('never shrinks a window through a diagonal drag', () => {
    const shrunk = resizeStep('se', START, -400, -400, false)
    expect(shrunk).toEqual(START)
    expect(isProportional('se')).toBe(true)
    expect(isProportional('e')).toBe(false)
  })

  it('snaps proportional sizes to the grid without breaking the ratio floor', () => {
    const next = resizeStep('se', START, 13, 17, true)
    expect(next.width % 24).toBe(0)
    expect(next.height % 24).toBe(0)
    expect(next.width).toBeGreaterThanOrEqual(MIN_WINDOW_SIZE.width)
    expect(next.height).toBeGreaterThanOrEqual(MIN_WINDOW_SIZE.height)
    expect(isProportional('nw')).toBe(true)
  })
})
