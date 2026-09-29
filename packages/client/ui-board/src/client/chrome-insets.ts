/**
 * Safe area of the board: the rectangle the floating chrome (dock, mode badge,
 * minimap, and the omnibar until the redesign removes it) leaves free. The
 * chrome is measured in screen pixels and published to the store, so window
 * placement, centring, and «show all windows» never put a window under it
 * (Т1.15, decision R5 of the audit plan).
 */
import type { BoardState } from './store.ts'

/** Screen-pixel insets the floating chrome occupies on each board edge. */
export interface ChromeInsets {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

/** Zero insets: a board whose chrome is not rendered (fullscreen, open panel). */
export const NO_CHROME_INSETS: ChromeInsets = { top: 0, bottom: 0, left: 0, right: 0 }

/** One screen-pixel rectangle, relative to the board root. */
export interface BoardRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/**
 * How close to a board edge an element must sit to count as anchored there.
 * The chrome insets are 16–24px today; the margin leaves room for a chrome
 * element's own shadow and for narrow boards where a centred element nears
 * both horizontal edges.
 */
const EDGE_MARGIN = 64

/**
 * Insets one chrome element contributes: an element flush with an edge pushes
 * that edge inward by the element's own size plus its gap. A corner element
 * (the minimap) contributes to both of its edges.
 * @param board - the board box in screen pixels.
 * @param element - one chrome element's box in screen pixels.
 * @returns the per-edge contribution.
 */
function elementInsets(board: BoardRect, element: BoardRect): ChromeInsets {
  return {
    top: element.top - board.top <= EDGE_MARGIN ? Math.max(0, element.bottom - board.top) : 0,
    bottom: board.bottom - element.bottom <= EDGE_MARGIN ? Math.max(0, board.bottom - element.top) : 0,
    left: element.left - board.left <= EDGE_MARGIN ? Math.max(0, element.right - board.left) : 0,
    right: board.right - element.right <= EDGE_MARGIN ? Math.max(0, board.right - element.left) : 0,
  }
}

/**
 * Combine the chrome boxes into the board's insets: each edge takes the
 * deepest contribution of any element anchored there.
 * @param board - the board box in screen pixels.
 * @param elements - every rendered chrome element's box.
 * @returns the board insets.
 */
export function chromeInsetsFor(board: BoardRect, elements: readonly BoardRect[]): ChromeInsets {
  let insets: ChromeInsets = NO_CHROME_INSETS
  for (const element of elements) {
    const contribution = elementInsets(board, element)
    insets = {
      top: Math.max(insets.top, contribution.top),
      bottom: Math.max(insets.bottom, contribution.bottom),
      left: Math.max(insets.left, contribution.left),
      right: Math.max(insets.right, contribution.right),
    }
  }
  return insets
}

/**
 * Measure the board root and its `[data-board-chrome]` elements.
 * @param root - the board root whose box anchors the measurement.
 * @returns the insets every rendered chrome element contributes.
 */
export function measureChromeInsets(root: HTMLElement): ChromeInsets {
  const box = root.getBoundingClientRect()
  const board: BoardRect = { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
  const elements = [...root.querySelectorAll('[data-board-chrome]')].map((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
  })
  return chromeInsetsFor(board, elements)
}

/** The board's safe area: screen pixels and world units. */
export interface SafeArea {
  /** The free rectangle in board-root screen pixels. */
  readonly screen: BoardRect
  /** The same rectangle in world units. */
  readonly world: BoardRect
}

/**
 * Project the board's safe area from the store: the viewport box less the
 * chrome insets, in screen pixels and in world units.
 * @param state - the board store snapshot (viewport, pan, zoom, insets).
 * @returns the safe area in both coordinate spaces.
 */
export function safeArea(state: BoardState): SafeArea {
  const { chromeInsets, viewportWidth, viewportHeight, panX, panY, zoom } = state
  const screen: BoardRect = {
    left: chromeInsets.left,
    top: chromeInsets.top,
    right: Math.max(chromeInsets.left, viewportWidth - chromeInsets.right),
    bottom: Math.max(chromeInsets.top, viewportHeight - chromeInsets.bottom),
  }
  const toWorld = (value: number, pan: number): number => (value - pan) / zoom
  return {
    screen,
    world: {
      left: toWorld(screen.left, panX),
      top: toWorld(screen.top, panY),
      right: toWorld(screen.right, panX),
      bottom: toWorld(screen.bottom, panY),
    },
  }
}
