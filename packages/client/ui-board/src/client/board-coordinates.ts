/**
 * The board's one coordinate module: board-panel pixels, world units, and the
 * viewport projection between them. The canvas surface applies
 * `translate(pan) scale(zoom)` with the world origin at the panel's top-left,
 * and every layer — windows, elements, the minimap, and the screen-space
 * chrome — reads its translation here instead of repeating the formula.
 */
import type { BoardRect, SafeArea } from './chrome-insets.ts'
import { chromeInsetsOf } from './chrome-insets.ts'
import type { BoardState } from './store.ts'

/** Pan and zoom of one board view; every translation reads only these. */
export interface BoardView {
  readonly panX: number
  readonly panY: number
  readonly zoom: number
}

/** A view with the measured viewport box, the input culling reads. */
export interface BoardViewport extends BoardView {
  readonly viewportWidth: number
  readonly viewportHeight: number
}

/** The board state fields the safe-area projection reads. */
export type BoardSafeAreaState = Pick<
  BoardState,
  'panX' | 'panY' | 'zoom' | 'viewportWidth' | 'viewportHeight' | 'chromeInsetSources'
>

/** One point in either coordinate space. */
export interface BoardPoint {
  readonly x: number
  readonly y: number
}

/** The board root's box in client (page) pixels. */
export interface BoardRootRect {
  readonly left: number
  readonly top: number
}

/**
 * Translate one client (page) point into board-panel pixels.
 * @param rootRect - the board root's client box.
 * @param point - the point in client pixels.
 * @returns the point relative to the board root.
 */
export function clientToBoard(rootRect: BoardRootRect, point: BoardPoint): BoardPoint {
  return { x: point.x - rootRect.left, y: point.y - rootRect.top }
}

/**
 * Translate one board-panel point into world units.
 * @param view - the board's pan and zoom.
 * @param point - the point in panel pixels.
 * @returns the world point.
 */
export function screenToWorld(view: BoardView, point: BoardPoint): BoardPoint {
  return { x: (point.x - view.panX) / view.zoom, y: (point.y - view.panY) / view.zoom }
}

/**
 * Translate one world point into board-panel pixels.
 * @param view - the board's pan and zoom.
 * @param point - the world point.
 * @returns the point in panel pixels.
 */
export function worldToScreen(view: BoardView, point: BoardPoint): BoardPoint {
  return { x: view.panX + point.x * view.zoom, y: view.panY + point.y * view.zoom }
}

/**
 * The world rectangle the viewport currently shows, plus an optional margin in
 * world units. Culling and the element layer render against this box.
 * @param state - view holding pan, zoom, and the viewport box.
 * @param margin - world units added to every side.
 * @returns the visible world rectangle.
 */
export function visibleWorldRect(state: BoardViewport, margin = 0): BoardRect {
  return {
    left: (0 - state.panX) / state.zoom - margin,
    top: (0 - state.panY) / state.zoom - margin,
    right: (state.viewportWidth - state.panX) / state.zoom + margin,
    bottom: (state.viewportHeight - state.panY) / state.zoom + margin,
  }
}

/**
 * Project the board's safe area from the store: the viewport box less the
 * folded chrome insets, in screen pixels and in world units.
 * @param state - viewport, pan, zoom, and chrome contributions.
 * @returns the safe area in both coordinate spaces.
 */
export function safeArea(state: BoardSafeAreaState): SafeArea {
  const chromeInsets = chromeInsetsOf(state.chromeInsetSources)
  const { viewportWidth, viewportHeight } = state
  const screen: BoardRect = {
    left: chromeInsets.left,
    top: chromeInsets.top,
    right: Math.max(chromeInsets.left, viewportWidth - chromeInsets.right),
    bottom: Math.max(chromeInsets.top, viewportHeight - chromeInsets.bottom),
  }
  return {
    screen,
    world: {
      left: screenToWorld(state, { x: screen.left, y: screen.top }).x,
      top: screenToWorld(state, { x: screen.left, y: screen.top }).y,
      right: screenToWorld(state, { x: screen.right, y: screen.bottom }).x,
      bottom: screenToWorld(state, { x: screen.right, y: screen.bottom }).y,
    },
  }
}

/**
 * Center a box of the requested size inside the world safe area.
 * @param state - viewport, pan, zoom, and chrome contributions.
 * @param width - box width in world units.
 * @param height - box height in world units.
 * @returns the top-left world point of the centered box.
 */
export function placeInSafeArea(state: BoardSafeAreaState, width: number, height: number): BoardPoint {
  const area = safeArea(state).world
  return {
    x: area.left + (area.right - area.left - width) / 2,
    y: area.top + (area.bottom - area.top - height) / 2,
  }
}
