/**
 * Body of an element whose kind has no registered `board.element.body`
 * occupant: a plain labeled box that never crashes the board. Every element
 * stage replaces its own kind with a real body; this one stays the fallback.
 */
import type { BoardElement } from '@ketos/board-doc/types'
import type { BoardTranslate } from '../locale.ts'
import css from './NeutralElementBody.module.css'

/** Props of the neutral body. */
export interface NeutralElementBodyProps {
  /** The element the body stands for. */
  readonly element: BoardElement
  /** Bound board dictionary. */
  readonly t: BoardTranslate
}

export function NeutralElementBody({ element, t }: NeutralElementBodyProps) {
  return (
    <div data-board-element-neutral={element.kind} className={css.body}>
      {t('element.neutral.title')}
    </div>
  )
}
