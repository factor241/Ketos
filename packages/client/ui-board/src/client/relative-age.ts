/**
 * Relative-age label shared by the clone record editor and the memory body:
 * both date a row with the board's short units, so the bucketing and the
 * dictionary lookup stay in one place.
 * @module ui-board/relative-age
 */
import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BoardTranslate } from './locale.ts'

/**
 * Localized age of one dated row, in the board's short units.
 * @param at - ISO-8601 UTC time of the row's last update.
 * @param t - the board translator.
 * @returns the age text, for example "1d" or "now".
 */
export function relativeAge(at: string, t: BoardTranslate): string {
  const { unit, n } = relativeTime(Date.parse(at), Date.now())
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
}
