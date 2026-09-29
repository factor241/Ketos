/**
 * Safe area of the board: the rectangle the floating chrome (dock, mode badge,
 * minimap, and the omnibar until the redesign removes it) leaves free. Every
 * chrome element declares the board edge it is anchored to and publishes its
 * own depth from that edge, so a wide element never takes a strip from the
 * edges it merely spans (Т1.15, Т1.6). Window placement, centring, and «show
 * all windows» read the folded insets and never put a window under the chrome.
 */
import type { BoardState } from './store.ts'

/** The board edge one chrome element is anchored to. */
export type ChromeEdge = 'top' | 'bottom' | 'left' | 'right'

/** Screen-pixel insets the floating chrome occupies on each board edge. */
export interface ChromeInsets {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

/** Zero insets: a board whose chrome is not rendered (fullscreen, open panel). */
export const NO_CHROME_INSETS: ChromeInsets = { top: 0, bottom: 0, left: 0, right: 0 }

/** One chrome element's published contribution: its declared edge and depth. */
export interface ChromeInsetContribution {
  readonly edge: ChromeEdge
  readonly depth: number
}

/** One screen-pixel rectangle, relative to the board root. */
export interface BoardRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/**
 * The depth one chrome element takes from its declared edge: the distance from
 * that board edge to the element's inner side. The other three edges are not
 * affected, however wide the element spans.
 * @param board - the board box in screen pixels.
 * @param element - the chrome element's box in screen pixels.
 * @param edge - the edge the element declares.
 * @returns the non-negative depth.
 */
export function chromeInsetDepth(board: BoardRect, element: BoardRect, edge: ChromeEdge): number {
  switch (edge) {
    case 'top': return Math.max(0, element.bottom - board.top)
    case 'bottom': return Math.max(0, board.bottom - element.top)
    case 'left': return Math.max(0, element.right - board.left)
    case 'right': return Math.max(0, board.right - element.left)
  }
}

/**
 * Fold the published contributions into the board's insets: each edge takes
 * the deepest contribution declared for it.
 * @param sources - contributions keyed by their publishing element.
 * @returns the board insets.
 */
export function chromeInsetsOf(sources: Readonly<Record<string, ChromeInsetContribution>>): ChromeInsets {
  let insets: ChromeInsets = NO_CHROME_INSETS
  for (const { edge, depth } of Object.values(sources)) {
    insets = { ...insets, [edge]: Math.max(insets[edge], depth) }
  }
  return insets
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
 * folded chrome insets, in screen pixels and in world units.
 * @param state - the board store snapshot (viewport, pan, zoom, chrome contributions).
 * @returns the safe area in both coordinate spaces.
 */
export function safeArea(state: BoardState): SafeArea {
  const chromeInsets = chromeInsetsOf(state.chromeInsetSources)
  const { viewportWidth, viewportHeight, panX, panY, zoom } = state
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
