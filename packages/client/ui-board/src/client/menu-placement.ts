/**
 * Placement of one board popover against its trigger: every board menu (the
 * composer's chips, the dock's and the Omnibox's action lists) reads the same
 * rule, so a list opens on the roomier side of the board boundary and stays
 * inside it.
 */

/** Viewport-relative placement of one popover against its trigger. */
export interface MenuPlacement {
  readonly side: 'top' | 'bottom'
  readonly align: 'start' | 'end'
}

/**
 * Place one popover against its trigger inside the board boundary: the side
 * with more room wins, and a trigger past the middle of the boundary aligns
 * its list to the end.
 * @param trigger - element the list is anchored to, or null before it mounts.
 * @param boundary - screen-pixel rectangle the list must stay inside.
 * @returns the placement the shared `Menu` takes.
 */
export function menuPlacement(trigger: HTMLElement | null, boundary: DOMRect): MenuPlacement {
  const rect = trigger?.getBoundingClientRect()
  if (rect === undefined) return { side: 'top', align: 'start' }
  return {
    side: rect.top - boundary.top >= boundary.bottom - rect.bottom ? 'top' : 'bottom',
    align: rect.left > boundary.left + boundary.width / 2 ? 'end' : 'start',
  }
}
