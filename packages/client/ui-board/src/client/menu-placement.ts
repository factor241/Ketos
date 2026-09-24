/**
 * Placement of one board popover against its trigger: every board menu (the
 * composer's chips, the Omnibox's action list) reads the same rule, so a list
 * opens on the roomier side and stays inside the viewport.
 */

/** Viewport-relative placement of one popover against its trigger. */
export interface MenuPlacement {
  readonly side: 'top' | 'bottom'
  readonly align: 'start' | 'end'
}

/**
 * Place one popover against its trigger: the side with more room wins, and a
 * trigger past the middle of the viewport aligns its list to the end.
 * @param trigger - element the list is anchored to, or null before it mounts.
 * @returns the placement the shared `Menu` takes.
 */
export function menuPlacement(trigger: HTMLElement | null): MenuPlacement {
  const rect = trigger?.getBoundingClientRect()
  if (rect === undefined) return { side: 'top', align: 'start' }
  return {
    side: rect.top >= window.innerHeight - rect.bottom ? 'top' : 'bottom',
    align: rect.left > window.innerWidth / 2 ? 'end' : 'start',
  }
}
