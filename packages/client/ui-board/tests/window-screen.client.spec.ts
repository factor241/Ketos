// @vitest-environment jsdom
/**
 * Screen projection of a window rectangle: the transform the canvas surface
 * applies, which the handle ring reuses to stay on the window's border above
 * the floating chrome.
 */
import { describe, expect, it } from 'vitest'
import { isWindowOnScreen, windowScreenRect } from '../src/client/window-screen.ts'
import type { BoardState } from '../src/client/store.ts'
import type { BoardWindowState, WindowId } from '../src/client/contract/slots.ts'

const WINDOW: BoardWindowState = {
  id: 'w1' as WindowId,
  kind: 'agent',
  bodyKind: 'conversation',
  ordinal: 1,
  x: 100,
  y: 100,
  width: 552,
  height: 648,
  zIndex: 10,
}

function state(overrides: Partial<BoardState> = {}): BoardState {
  return {
    panX: 0,
    panY: 0,
    zoom: 1,
    viewportWidth: 1000,
    viewportHeight: 800,
    windows: { w1: WINDOW },
    windowOrder: ['w1' as WindowId],
    activeWindowId: 'w1' as WindowId,
    fullscreenWindowId: null,
    panelWindowId: null,
    panelCollapsed: true,
    panelTab: 'chats',
    panelWidth: 300,
    panelGroupBy: 'workspace',
    panelOrderBy: 'updated',
    defaultPreset: '',
    isSelectingElement: false,
    composerIntents: [],
    composerIntentSeq: 0,
    returnWindowId: null,
    highlightWindowId: null,
    cloneEdits: {},
    ...overrides,
  }
}

describe('windowScreenRect', () => {
  it('projects the world rectangle through pan and zoom', () => {
    expect(windowScreenRect(state(), WINDOW)).toEqual({ left: 100, top: 100, right: 652, bottom: 748 })
    expect(windowScreenRect(state({ panX: 30, panY: -20, zoom: 2 }), WINDOW))
      .toEqual({ left: 230, top: 180, right: 1334, bottom: 1476 })
  })

  it('reads the live rectangle from the store, not the passed snapshot', () => {
    const moved = state({ windows: { w1: { ...WINDOW, x: 400 } } })
    expect(windowScreenRect(moved, WINDOW).left).toBe(400)
  })

  it('falls back to the passed snapshot when the store no longer holds the window', () => {
    expect(windowScreenRect(state({ windows: {} }), WINDOW).left).toBe(100)
  })
})

describe('isWindowOnScreen', () => {
  it('accepts a window that overlaps the viewport and rejects one beyond it', () => {
    expect(isWindowOnScreen(state(), WINDOW)).toBe(true)
    // Panned far enough that the window's right edge is left of the viewport.
    expect(isWindowOnScreen(state({ panX: -2000 }), WINDOW)).toBe(false)
    // Panned up past the window's bottom edge.
    expect(isWindowOnScreen(state({ panY: -2000 }), WINDOW)).toBe(false)
  })

  it('ignores the culling margin: a window in the slack is off screen', () => {
    // The window's left edge sits 100px beyond the viewport's right edge, well
    // inside the 480-unit culling margin, so it still renders but is not on
    // screen for a gesture that only raises it.
    const slack = state({ panX: -(WINDOW.x + WINDOW.width + 100) })
    expect(isWindowOnScreen(slack, WINDOW)).toBe(false)
  })

  it('treats a partially visible window as on screen', () => {
    const half = state({ panX: -(WINDOW.x + WINDOW.width - 10) })
    expect(isWindowOnScreen(half, WINDOW)).toBe(true)
  })
})
