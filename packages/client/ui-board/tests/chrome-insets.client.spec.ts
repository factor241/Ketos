// @vitest-environment jsdom
/**
 * Chrome insets and the board safe area (Д3.1/Т1.15): the floating chrome's
 * screen-pixel insets, their projection into world units, and the DOM
 * measurement that feeds them.
 */
import { describe, expect, it } from 'vitest'
import { chromeInsetsFor, measureChromeInsets, safeArea, type BoardRect } from '../src/client/chrome-insets.ts'
import { createBoardStore } from '../src/client/store.ts'

const BOARD: BoardRect = { left: 100, top: 50, right: 1100, bottom: 850 }

/** One screen rectangle relative to the same origin as {@link BOARD}. */
function rect(left: number, top: number, right: number, bottom: number): BoardRect {
  return { left, top, right, bottom }
}

/** Attach one measured stub element to a fake board root. */
function stubRoot(board: BoardRect, elements: readonly BoardRect[]): HTMLElement {
  const root = document.createElement('div')
  root.getBoundingClientRect = () => ({
    left: board.left, top: board.top, right: board.right, bottom: board.bottom,
    width: board.right - board.left, height: board.bottom - board.top,
    x: board.left, y: board.top, toJSON: () => ({}),
  })
  for (const element of elements) {
    const node = document.createElement('div')
    node.setAttribute('data-board-chrome', '')
    node.getBoundingClientRect = () => ({
      left: element.left, top: element.top, right: element.right, bottom: element.bottom,
      width: element.right - element.left, height: element.bottom - element.top,
      x: element.left, y: element.top, toJSON: () => ({}),
    })
    root.append(node)
  }
  return root
}

describe('chromeInsetsFor', () => {
  it('is zero without chrome', () => {
    expect(chromeInsetsFor(BOARD, [])).toEqual({ top: 0, bottom: 0, left: 0, right: 0 })
  })

  it('reads a left-anchored dock as a left inset', () => {
    // The dock hugs the left edge, centred vertically: only the left inset.
    expect(chromeInsetsFor(BOARD, [rect(120, 400, 164, 500)])).toEqual({ top: 0, bottom: 0, left: 64, right: 0 })
  })

  it('reads a bottom-anchored dock as a bottom inset', () => {
    expect(chromeInsetsFor(BOARD, [rect(520, 780, 680, 834)])).toEqual({ top: 0, bottom: 70, left: 0, right: 0 })
  })

  it('reads corner chrome on both of its edges', () => {
    // The mode badge top-left and the minimap top-right.
    expect(chromeInsetsFor(BOARD, [rect(110, 60, 210, 96), rect(940, 60, 1080, 190)]))
      .toEqual({ top: 140, bottom: 0, left: 110, right: 160 })
  })

  it('takes the deepest contribution per edge', () => {
    expect(chromeInsetsFor(BOARD, [rect(520, 780, 680, 810), rect(300, 760, 900, 840)]))
      .toEqual({ top: 0, bottom: 90, left: 0, right: 0 })
  })
})

describe('measureChromeInsets', () => {
  it('queries the chrome markers and measures them against the root', () => {
    const root = stubRoot(BOARD, [rect(120, 400, 164, 500)])
    expect(measureChromeInsets(root)).toEqual({ top: 0, bottom: 0, left: 64, right: 0 })
  })
})

describe('safeArea', () => {
  it('subtracts the insets in screen pixels and projects them into world units', () => {
    const { store, actions } = createBoardStore().create()
    actions.setViewport(1000, 800)
    actions.setChromeInsets({ top: 20, bottom: 120, left: 80, right: 40 })
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
    actions.setChromeInsets({ top: 80, bottom: 80, left: 60, right: 60 })
    const area = safeArea(store.getSnapshot())
    expect(area.screen).toEqual({ left: 60, top: 80, right: 60, bottom: 80 })
  })
})
