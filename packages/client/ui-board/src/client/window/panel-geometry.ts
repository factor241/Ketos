/**
 * Geometry of one window's chats panel. The panel is a layer of its own beside
 * the frame: collapsed it is a narrow rail hugging the frame's left edge, open
 * it is a resizable column that slides out of that edge. Fullscreen docks it to
 * the board panel's left edge and the chat keeps a centred column beside it.
 * All values are world units, so the panel follows the window while it is
 * dragged, resized, or the canvas pans and zooms.
 */
import type { BoardWindowState } from '../contract/slots.ts'

/** Smallest readable panel width, whichever mode is active. */
export const PANEL_MIN_WIDTH = 260

/** Largest panel width, so a wide window keeps its chat dominant. */
export const PANEL_MAX_WIDTH = 420

/** Width a window opens its panel with before the user resizes it. */
export const PANEL_DEFAULT_WIDTH = 300

/** Share of the window width the panel never exceeds, before the caps apply. */
const PANEL_WINDOW_SHARE_MAX = 0.45

/** Collapsed rail width: a compact strip holding four controls. */
export const PANEL_RAIL_WIDTH = 44

/** Collapsed rail height: four 36px controls, their gaps, and the rail's padding. */
export const PANEL_RAIL_HEIGHT = 170

/** Largest chat column width in the fullscreen presentation. */
export const FULLSCREEN_CHAT_MAX_WIDTH = 768

/** One rectangle in world units. */
export interface PanelRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** The visible board panel in world units. */
export interface PanelView {
  readonly left: number
  readonly right: number
}

/** How the panel presents beside its window. */
export type PanelPresentation =
  | { readonly kind: 'beside'; readonly side: 'left' | 'right' }
  | { readonly kind: 'overlay' }

/**
 * The panel width for one available space and the width the user asked for.
 * @param available - the space the panel may take, in world units.
 * @param requested - the stored panel width.
 * @returns the width, clamped to the readable range and the window share.
 */
export function panelWidthFor(available: number, requested: number): number {
  const cap = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, available * PANEL_WINDOW_SHARE_MAX))
  return Math.min(cap, Math.max(PANEL_MIN_WIDTH, Math.min(requested, PANEL_MAX_WIDTH)))
}

/**
 * Which side the panel slides out of: the side with room for it, or `overlay`
 * when the window leaves room on neither side (a window covering the visible
 * canvas keeps the panel inside its own left edge, above the frame).
 * @param window - the window the panel belongs to.
 * @param view - the visible board panel in world units.
 * @param width - the panel width that would be shown.
 * @returns the presentation to use.
 */
export function panelPresentation(window: BoardWindowState, view: PanelView, width: number): PanelPresentation {
  // The left side comes first — the side the app's own lists live on — and the
  // board's dock and minimap stand down while a panel is open so its outer edge
  // and resize handle stay reachable.
  if (window.x - view.left >= width) return { kind: 'beside', side: 'left' }
  if (view.right - (window.x + window.width) >= width) return { kind: 'beside', side: 'right' }
  return { kind: 'overlay' }
}

/**
 * The open panel's rectangle while the window floats on the canvas.
 * @param window - the window the panel belongs to.
 * @param view - the visible board panel in world units.
 * @param width - the panel width to place.
 * @returns the rectangle beside the frame, or inside its left edge when
 * the window leaves no room on either side.
 */
export function windowedPanelRect(window: BoardWindowState, view: PanelView, width: number): PanelRect {
  const presentation = panelPresentation(window, view, width)
  if (presentation.kind === 'overlay') {
    return { left: window.x, top: window.y, width, height: window.height }
  }
  if (presentation.side === 'left') return { left: window.x - width, top: window.y, width, height: window.height }
  return { left: window.x + window.width, top: window.y, width, height: window.height }
}

/**
 * The collapsed rail's rectangle: a compact strip centred on the frame's edge.
 * @param window - the window the panel belongs to.
 * @param side - the side the open panel takes.
 * @returns the rail rectangle in world units.
 */
export function railRect(window: BoardWindowState, side: 'left' | 'right'): PanelRect {
  return {
    left: side === 'left' ? window.x - PANEL_RAIL_WIDTH : window.x + window.width,
    top: window.y + (window.height - PANEL_RAIL_HEIGHT) / 2,
    width: PANEL_RAIL_WIDTH,
    height: PANEL_RAIL_HEIGHT,
  }
}

/**
 * The panel rectangle while the window fills the board panel.
 * @param viewportWidth - board panel width in world units.
 * @param viewportHeight - board panel height in world units.
 * @param width - the panel width to place.
 * @returns the docked rectangle along the panel's left edge.
 */
export function dockedPanelRect(viewportWidth: number, viewportHeight: number, width: number): PanelRect {
  return { left: 0, top: 0, width: Math.min(width, viewportWidth), height: viewportHeight }
}
