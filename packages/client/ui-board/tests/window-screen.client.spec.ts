// @vitest-environment jsdom
/**
 * Screen projection of a window rectangle: the transform the canvas surface
 * applies, which the handle ring reuses to stay on the window's border above
 * the floating chrome.
 */
import { describe, expect, it } from 'vitest'
import { windowScreenRect } from '../src/client/canvas/window-screen.ts'
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
    panelWidth: 300,
    panelGroupBy: 'workspace',
    panelOrderBy: 'updated',
    isSelectingElement: false,
    composerIntents: [],
    composerIntentSeq: 0,
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
