// @vitest-environment jsdom
/**
 * Chrome contributions and the board safe area (Д3.1/Т1.15): each element's
 * declared edge and depth, the fold into per-edge insets, and the projection
 * into world units.
 */
import { describe, expect, it } from 'vitest'
import { safeArea } from '../src/client/board-coordinates.ts'
import {
  chromeInsetDepth, chromeInsetsOf, type BoardRect, type ChromeInsetContribution,
} from '../src/client/chrome-insets.ts'
import { createBoardStore } from '../src/client/store.ts'

const BOARD: BoardRect = { left: 100, top: 50, right: 1100, bottom: 850 }

/** One screen rectangle relative to the same origin as {@link BOARD}. */
function rect(left: number, top: number, right: number, bottom: number): BoardRect {
  return { left, top, right, bottom }
}

describe('chromeInsetDepth', () => {
  it('measures only the declared edge', () => {
    // A dock stretched to board width minus 48px: bottom-only, however close
    // its ends come to the left and right edges (Т1.6).
    const dock = rect(124, 780, 1076, 834)
    expect(chromeInsetDepth(BOARD, dock, 'bottom')).toBe(70)
    expect(chromeInsetDepth(BOARD, dock, 'left')).toBe(976)
    // The declaration, not the geometry, decides.
    expect(chromeInsetsOf({ dock: { edge: 'bottom', depth: 70 } })).toEqual({ top: 0, bottom: 70, left: 0, right: 0 })
  })

  it('measures each edge from the board box', () => {
    const element = rect(120, 60, 210, 96)
    expect(chromeInsetDepth(BOARD, element, 'top')).toBe(46)
    expect(chromeInsetDepth(BOARD, element, 'left')).toBe(110)
    expect(chromeInsetDepth(BOARD, element, 'right')).toBe(980)
    expect(chromeInsetDepth(BOARD, element, 'bottom')).toBe(790)
  })

  it('never returns a negative depth for an element beyond its edge', () => {
    // An element past the declared edge contributes nothing, not a negative
    // strip that would grow the safe area.
    expect(chromeInsetDepth(BOARD, rect(0, 0, 10, 10), 'top')).toBe(0)
    expect(chromeInsetDepth(BOARD, rect(0, 900, 10, 910), 'bottom')).toBe(0)
    expect(chromeInsetDepth(BOARD, rect(0, 300, 10, 310), 'left')).toBe(0)
    expect(chromeInsetDepth(BOARD, rect(1200, 300, 1210, 310), 'right')).toBe(0)
  })
})

describe('chromeInsetsOf', () => {
  it('folds contributions per declared edge, deepest wins', () => {
    const sources: Record<string, ChromeInsetContribution> = {
      dock: { edge: 'bottom', depth: 70 },
      minimap: { edge: 'bottom', depth: 164 },
      badge: { edge: 'top', depth: 46 },
    }
    expect(chromeInsetsOf(sources)).toEqual({ top: 46, bottom: 164, left: 0, right: 0 })
  })

  it('is zero without contributions', () => {
    expect(chromeInsetsOf({})).toEqual({ top: 0, bottom: 0, left: 0, right: 0 })
  })
})

describe('safeArea', () => {
  it('subtracts the folded insets in screen pixels and projects them into world units', () => {
    const { store, actions } = createBoardStore().create()
    actions.setViewport(1000, 800)
    actions.publishChromeInset('badge', 'top', 20)
    actions.publishChromeInset('dock', 'bottom', 120)
    actions.publishChromeInset('left', 'left', 80)
    actions.publishChromeInset('right', 'right', 40)
    actions.setPan(30, -10)
    actions.setZoom(2)
    const area = safeArea(store.getSnapshot())
    expect(area.screen).toEqual({ left: 80, top: 20, right: 960, bottom: 680 })
    expect(area.world).toEqual({
      left: (80 - 30) / 2,
      top: (20 + 10) / 2,
      right: (960 - 30) / 2,
      bottom: (680 + 10) / 2,
    })
  })

  it('never inverts a board whose insets exceed its box', () => {
    const { store, actions } = createBoardStore().create()
    actions.setViewport(100, 100)
    actions.publishChromeInset('top', 'top', 80)
    actions.publishChromeInset('bottom', 'bottom', 80)
    actions.publishChromeInset('left', 'left', 60)
    actions.publishChromeInset('right', 'right', 60)
    const area = safeArea(store.getSnapshot())
    expect(area.screen).toEqual({ left: 60, top: 80, right: 60, bottom: 80 })
  })
})
