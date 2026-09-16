/**
 * Geometry of one window's chats panel. The panel is a companion of the frame:
 * windowed it hides under the frame's left edge and shows a compact strip; in
 * fullscreen it docks to the left edge of the board panel and the chat column
 * is centred beside it. All values are world units, so the panel follows the
 * window while it is dragged, resized, or the canvas pans and zooms.
 */
import type { BoardWindowState } from '../contract/slots.ts'

/** Smallest readable panel width, whichever mode is active. */
export const PANEL_MIN_WIDTH = 220

/** Largest panel width, so a wide window keeps its chat dominant. */
export const PANEL_MAX_WIDTH = 320

/** Share of the window width the panel asks for before the clamps apply. */
const WINDOWED_WIDTH_RATIO = 0.26

/** Share of the panel width that hides under the frame, reading as a layer below it. */
const WINDOWED_TUCK_RATIO = 0.3

/** Share of the window height the panel leaves as a margin top and bottom. */
const WINDOWED_HEIGHT_RATIO = 0.92

/** Largest chat column width in the fullscreen presentation. */
export const FULLSCREEN_CHAT_MAX_WIDTH = 768

/** One rectangle in world units. */
export interface PanelRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/**
 * The panel width for one available space, clamped to the readable range.
 * @param available - the space the panel may take, in world units.
 * @returns the panel width.
 */
export function panelWidthFor(available: number): number {
  return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, available * WINDOWED_WIDTH_RATIO))
}

/** How the windowed panel presents beside its window. */
export type PanelPresentation =
  | { readonly kind: 'tucked'; readonly side: 'left' | 'right' }
  | { readonly kind: 'overlay' }

/** The visible board panel in world units. */
export interface PanelView {
  readonly left: number
  readonly right: number
}

/**
 * Which side the panel can tuck under: the side with room for its protruding
 * share, or `overlay` when the window leaves room on neither side (a window
 * covering the visible canvas keeps the panel inside its own left edge).
 * @param window - the window the panel belongs to.
 * @param view - the visible board panel in world units.
 * @returns the presentation to use.
 */
export function panelPresentation(window: BoardWindowState, view: PanelView): PanelPresentation {
  const protruding = panelWidthFor(window.width) * (1 - WINDOWED_TUCK_RATIO)
  if (window.x - view.left >= protruding) return { kind: 'tucked', side: 'left' }
  if (view.right - (window.x + window.width) >= protruding) return { kind: 'tucked', side: 'right' }
  return { kind: 'overlay' }
}

/**
 * The panel rectangle while the window floats on the canvas.
 * @param window - the window the panel belongs to.
 * @param view - the visible board panel in world units.
 * @returns the rectangle of the presentation {@link panelPresentation} picks.
 */
export function windowedPanelRect(window: BoardWindowState, view: PanelView): PanelRect {
  const width = panelWidthFor(window.width)
  const presentation = panelPresentation(window, view)
  if (presentation.kind === 'overlay') {
    return { left: window.x, top: window.y, width, height: window.height }
  }
  const height = window.height * WINDOWED_HEIGHT_RATIO
  const top = window.y + (window.height - height) / 2
  const left = presentation.side === 'left'
    ? window.x - width + width * WINDOWED_TUCK_RATIO
    : window.x + window.width - width + width * WINDOWED_TUCK_RATIO
  return { left, top, width, height }
}

/**
 * The panel rectangle while the window fills the board panel.
 * @param viewportWidth - board panel width in world units.
 * @param viewportHeight - board panel height in world units.
 * @returns the docked rectangle along the panel's left edge.
 */
export function dockedPanelRect(viewportWidth: number, viewportHeight: number): PanelRect {
  return { left: 0, top: 0, width: panelWidthFor(viewportWidth), height: viewportHeight }
}
