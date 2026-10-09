/**
 * Re-render clock for relative ages: the board shows "changed 5m" labels that
 * move with wall time while no store field changes.
 */
import { useEffect, useReducer } from 'react'

/** Period between two age recomputations, in milliseconds. */
export const AGE_REFRESH_MS = 30_000

/**
 * Re-render the calling component every {@link AGE_REFRESH_MS}; the interval
 * stops on unmount.
 */
export function useAgeClock(): void {
  const [, tick] = useReducer((count: number) => count + 1, 0)
  useEffect(() => {
    const timer = setInterval(tick, AGE_REFRESH_MS)
    return () => { clearInterval(timer) }
  }, [])
}
