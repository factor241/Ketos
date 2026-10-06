// @vitest-environment jsdom
/**
 * The board's coordinate module: the panel/world round trip at every zoom,
 * the visible world rectangle with its culling margin, and the safe-area
 * placement every new box centers by.
 */
import { describe, expect, it } from 'vitest'
import {
  clientToBoard, placeInSafeArea, safeArea, screenToWorld, visibleWorldRect, worldToScreen,
} from '../src/client/board-coordinates.ts'
import { createBoardStore, type BoardState } from '../src/client/store.ts'

/**
 * One board state with test overrides.
 * @param overrides - fields to replace.
 * @returns the state.
 */
function state(overrides: Partial<BoardState> = {}): BoardState {
  return {
    ...createBoardStore().create().getSnapshot(),
    viewportWidth: 1000,
    viewportHeight: 800,
    ...overrides,
  }
}

describe('board coordinate translation', () => {
  it('translates a client point into board-panel pixels', () => {
    expect(clientToBoard({ left: 40, top: 15 }, { x: 100, y: 60 })).toEqual({ x: 60, y: 45 })
  })

  it('round-trips screen and world points at every zoom with a non-zero pan', () => {
    for (const zoom of [0.5, 1, 2]) {
      const view = { panX: -120, panY: 75, zoom }
      for (const point of [{ x: 0, y: 0 }, { x: 480, y: -260 }, { x: -1000, y: 3000 }]) {
        const world = screenToWorld(view, point)
        expect(worldToScreen(view, world), `zoom ${String(zoom)}`).toEqual(point)
      }
    }
  })

  it('projects the visible world rectangle with a world-unit margin', () => {
    const rect = visibleWorldRect(state({ panX: -200, panY: -100, zoom: 2 }), 50)
    expect(rect).toEqual({ left: 50, top: 0, right: 650, bottom: 500 })
    expect(visibleWorldRect(state())).toEqual({ left: 0, top: 0, right: 1000, bottom: 800 })
  })
})

describe('board safe area', () => {
  it('folds the chrome insets and projects the world rectangle', () => {
    const area = safeArea(state({
      chromeInsetSources: { dock: { edge: 'bottom', depth: 70 }, rail: { edge: 'left', depth: 80 } },
      zoom: 0.5,
      panX: -100,
      panY: -50,
    }))
    expect(area.screen).toEqual({ left: 80, top: 0, right: 1000, bottom: 730 })
    expect(area.world).toEqual({ left: 360, top: 100, right: 2200, bottom: 1560 })
  })

  it('centers a box inside the world safe area', () => {
    expect(placeInSafeArea(state(), 200, 100)).toEqual({ x: 400, y: 350 })
    expect(placeInSafeArea(state({
      chromeInsetSources: { dock: { edge: 'bottom', depth: 30 }, rail: { edge: 'left', depth: 100 }, bar: { edge: 'top', depth: 20 }, right: { edge: 'right', depth: 50 } },
    }), 200, 100)).toEqual({ x: 425, y: 345 })
  })
})
