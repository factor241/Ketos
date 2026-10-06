/**
 * Geometry of one window's two panels: resizable columns that slide out of the
 * frame's edges. All values are world units, so a panel follows the window
 * while it is dragged, resized, or the canvas pans and zooms.
 */
import type { BoardWindowState } from './contract/slots.ts'
// The panel width bounds are part of the durable layout contract (the settings
// schema validates them), so they live with the layout schema.
import { PANEL_LEFT_DEFAULT_WIDTH, PANEL_RIGHT_DEFAULT_WIDTH } from '../board-settings.ts'

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
