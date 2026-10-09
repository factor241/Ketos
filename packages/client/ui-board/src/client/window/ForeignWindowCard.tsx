/**
 * General card of a foreign window whose kind has no card of its own: it names
 * the computer the window lives on and the window kind, with the age of the
 * last change. The frame header carries the title and status.
 */
import type { BoardWindowRecord } from '@ketos/board-doc/types'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'
import type { BoardTranslate } from '../locale.ts'
import { participantLabel, participantOf } from '../owners.ts'
import { foreignWindowTitle } from '../window-title.ts'
import { ForeignUpdated } from './ForeignUpdated.tsx'
import css from './ForeignWindowCard.module.css'

export interface ForeignWindowCardProps {
  /** The published record the card describes. */
  readonly record: BoardWindowRecord
  /** Board namespace translator. */
  readonly t: BoardTranslate
  /** Board store read seat. */
  readonly useStore: PropsStore<BoardStoreHandle>['useStore']
}

/**
 * Render the general card of one foreign window.
 * @param props - the record, the translator, and the store read seat.
 * @returns the computer sentence, the kind label when it adds to the title, and the age line.
 */
export function ForeignWindowCard({ record, t, useStore }: ForeignWindowCardProps) {
  const ownerName = useStore(s => participantLabel(t, participantOf(s, record.ownerId)))
  const kindLabel = foreignWindowTitle(t, { title: null, kind: record.kind, ordinal: record.ordinal })
  // The header shows the kind label already when the window has no title of its own.
  const showKind = kindLabel !== foreignWindowTitle(t, record)

  return (
    <section data-board-foreign-card="window" className={css.card}>
      <span className={css.lead}>{t('foreign.card.window', { name: ownerName })}</span>
      {showKind && <span data-board-foreign-kind="" className={css.kind}>{kindLabel}</span>}
      <ForeignUpdated record={record} t={t} className={css.updated} />
    </section>
  )
}
