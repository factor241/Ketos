/**
 * "Changed N ago" line of a foreign window card. It owns the age clock, so the
 * 30-second re-render touches this line and not the card around it.
 */
import type { BoardWindowRecord } from '@ketos/board-doc/types'
import type { BoardTranslate } from '../locale.ts'
import { relativeAge } from '../relative-age.ts'
import { useAgeClock } from '../use-age-clock.ts'

export interface ForeignUpdatedProps {
  /** The published record whose last change is dated. */
  readonly record: Pick<BoardWindowRecord, 'updatedAt'>
  /** Board namespace translator. */
  readonly t: BoardTranslate
  /** Class of the line. */
  readonly className: string | undefined
}

/**
 * Render the age of the record's last change.
 * @param props - the record, the translator, and the line class.
 * @returns the line, recomputed on the shared age period.
 */
export function ForeignUpdated({ record, t, className }: ForeignUpdatedProps) {
  useAgeClock()
  const age = relativeAge(record.updatedAt, t)
  return (
    <span data-board-foreign-updated="" className={className}>
      {t('foreign.card.updated', { age })}
    </span>
  )
}
