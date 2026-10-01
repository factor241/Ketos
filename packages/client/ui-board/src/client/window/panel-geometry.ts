/**
 * Geometry of one window's chats panel: a resizable column that slides out of
 * the frame's edge. All values are world units, so the panel follows the
 * window while it is dragged, resized, or the canvas pans and zooms.
 */
import type { BoardWindowState } from '../contract/slots.ts'
// The panel width bounds are part of the durable layout contract (the settings
// schema validates them), so they live with the layout schema and are
// re-exported here for the geometry's consumers.
import {
  PANEL_LEFT_DEFAULT_WIDTH, PANEL_LEFT_MAX_WIDTH, PANEL_LEFT_MIN_WIDTH,
  PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, PANEL_RIGHT_DEFAULT_WIDTH, PANEL_RIGHT_MAX_WIDTH,
  PANEL_RIGHT_MIN_WIDTH,
} from '../../board-settings.ts'

export { PANEL_DEFAULT_WIDTH, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from '../../board-settings.ts'
export {
  PANEL_LEFT_DEFAULT_WIDTH, PANEL_LEFT_MAX_WIDTH, PANEL_LEFT_MIN_WIDTH,
  PANEL_RIGHT_DEFAULT_WIDTH, PANEL_RIGHT_MAX_WIDTH, PANEL_RIGHT_MIN_WIDTH,
} from '../../board-settings.ts'

/** Share of the window width the panel never exceeds, before the caps apply. */
const PANEL_WINDOW_SHARE_MAX = 0.45

/** One rectangle in world units. */
export interface PanelRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** Which side of its window one panel opens on. */
export type PanelSide = 'left' | 'right'

/**
 * Whether one of the window's two panels is open (an absent field is closed).
 * @param window - the window the panel belongs to.
 * @param side - the side the panel opens on.
 * @returns whether that panel is open.
 */
export function windowPanelOpen(window: BoardWindowState, side: PanelSide): boolean {
  return (side === 'left' ? window.leftPanelOpen : window.rightPanelOpen) === true
}

/**
 * One panel's stored width, or its side's default when the field is absent.
 * @param window - the window the panel belongs to.
 * @param side - the side the panel opens on.
 * @returns the stored width in world units.
 */
export function windowPanelWidth(window: BoardWindowState, side: PanelSide): number {
  if (side === 'left') return window.leftPanelWidth ?? PANEL_LEFT_DEFAULT_WIDTH
  return window.rightPanelWidth ?? PANEL_RIGHT_DEFAULT_WIDTH
}

/**
 * One panel's width bounds.
 * @param side - the side the panel opens on.
 * @returns the minimum and maximum width in world units.
 */
export function windowPanelBounds(side: PanelSide): { readonly min: number; readonly max: number } {
  return side === 'left'
    ? { min: PANEL_LEFT_MIN_WIDTH, max: PANEL_LEFT_MAX_WIDTH }
    : { min: PANEL_RIGHT_MIN_WIDTH, max: PANEL_RIGHT_MAX_WIDTH }
}

/**
 * One open panel's rectangle in world units: beside the frame, at the frame's
 * height, on its own side (Т3.12).
 * @param window - the window the panel belongs to.
 * @param side - the side the panel opens on.
 * @returns the panel rectangle.
 */
export function windowPanelRect(window: BoardWindowState, side: PanelSide): PanelRect {
  const width = windowPanelWidth(window, side)
  return side === 'left'
    ? { left: window.x - width, top: window.y, width, height: window.height }
    : { left: window.x + window.width, top: window.y, width, height: window.height }
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
  // minimap stands down while a panel is open so its outer edge and resize
  // handle stay reachable (the bottom dock stays visible, Т1.14).
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
