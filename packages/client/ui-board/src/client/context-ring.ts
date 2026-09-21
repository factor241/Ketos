/**
 * Context-occupancy ring figures and states for the window composer.
 *
 * The bridge converts the `contextPressure` projection into the figures the
 * composer renders ({@link contextFigures}); this module owns that conversion
 * so it stays identical to the conversation meter's
 * `contextOccupancy` (`min(100, round(used / window * 100))`), and owns the
 * state ladder and compact figure text the ring derives from those figures.
 */
import type { BoardWindowSessionState } from './contract/slots.ts'
import type { BoardTranslate } from './locale.ts'

/** Occupancy above this percent renders the warning state. */
export const CONTEXT_WARNING_PERCENT = 80
/** Occupancy above this percent renders the critical state. */
export const CONTEXT_CRITICAL_PERCENT = 95

/** Visual state of the ring; `empty` means the provider reported no figures yet. */
export type ContextRingState = 'empty' | 'normal' | 'warning' | 'critical'

/** The `contextPressure` projection fields the board reads. */
export interface ContextPressureFigures {
  /** Provider-anchored sample, used when no surface projection exists. */
  readonly pressureTokens?: number | undefined
  /** Surface projection preferred over the provider sample. */
  readonly projectedTokens?: number | undefined
  /** Model route capacity; absent while the route reports none. */
  readonly contextWindow?: number | undefined
}

/**
 * Resolve the window's occupancy figures from the pressure projection.
 * @param pressure - latest `contextPressure` projection, or undefined.
 * @returns percent, used tokens, and capacity, or undefined until both the
 *   numerator and the capacity are known.
 */
export function contextFigures(
  pressure: ContextPressureFigures | undefined,
): BoardWindowSessionState['context'] {
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (used === undefined || pressure?.contextWindow === undefined) return undefined
  return {
    percent: Math.min(100, Math.round(used / pressure.contextWindow * 100)),
    usedTokens: used,
    window: pressure.contextWindow,
  }
}

/**
 * Classify the ring's visual state from its figures.
 * @param context - occupancy figures, or undefined before the first report.
 * @returns the state ladder entry: empty, normal, warning (> 80%), or critical (> 95%).
 */
export function contextRingState(
  context: BoardWindowSessionState['context'],
): ContextRingState {
  if (context === undefined) return 'empty'
  if (context.percent > CONTEXT_CRITICAL_PERCENT) return 'critical'
  if (context.percent > CONTEXT_WARNING_PERCENT) return 'warning'
  return 'normal'
}

/**
 * Format a token count for the ring's tooltip with compact units.
 * @param value - token count.
 * @param t - Board locale seat.
 * @returns the count, with `K` or `M` from the dictionary above 1000.
 */
export function compactTokens(value: number, t: BoardTranslate): string {
  const scaled = (candidate: number): string => candidate >= 100
    ? String(Math.round(candidate))
    : String(Math.round(candidate * 10) / 10)
  if (value < 1_000) return String(value)
  // A count whose rounded thousands reach 1000 reads as millions, so 999 999
  // renders as `1M` rather than the misleading `1000K`.
  if (value < 1_000_000 && Math.round(value / 1_000) < 1_000) {
    return t('context.thousand', { value: scaled(value / 1_000) })
  }
  return t('context.million', { value: scaled(value / 1_000_000) })
}

/**
 * Localized tooltip and accessible name of the ring: `% · used / window`, or
 * the empty-state text before the first provider report.
 * @param context - occupancy figures, or undefined.
 * @param t - Board locale seat.
 * @returns the reading string.
 */
export function contextReading(
  context: BoardWindowSessionState['context'],
  t: BoardTranslate,
): string {
  if (context === undefined) return t('context.empty')
  return t('context.tooltip', {
    percent: String(context.percent),
    used: compactTokens(context.usedTokens, t),
    window: compactTokens(context.window, t),
  })
}
