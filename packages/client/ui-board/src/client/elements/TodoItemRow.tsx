/**
 * One to-do item row: the visually hidden native checkbox that owns focus and
 * the keyboard, the SVG check that draws itself, the title that strikes
 * through, and the done state the parent derives. The row never mutates the
 * list; it reports the next done state, and a foreign list renders the same
 * row without the checkbox.
 */
import clsx from 'clsx'
import type { TodoItem } from '@ketos/board-doc/types'
import css from './TodoItemRow.module.css'

/** Props of one item row. */
export interface TodoItemRowProps {
  /** Stored item. */
  readonly item: TodoItem
  /** Whether the row draws as done. */
  readonly done: boolean
  /** Whether the acting participant owns the list. */
  readonly editable: boolean
  /** Report the next done state of this item. */
  readonly onToggle: (item: TodoItem, done: boolean) => void
  /** Registration of the row element for the parent's move animation. */
  readonly registerRow: (node: HTMLDivElement | null) => void
}

export function TodoItemRow({ item, done, editable, onToggle, registerRow }: TodoItemRowProps) {
  return (
    <div
      ref={registerRow}
      className={clsx(css.row, done && css.done)}
      data-board-todo-item={item.id}
      role="listitem"
    >
      {/* The checkbox keeps its own pointer: the frame's move gesture captures
          the pointer on the body and would swallow the toggle click. */}
      <label className={css.checkArea} onPointerDown={(event) => { event.stopPropagation() }}>
        {editable && (
          <input
            type="checkbox"
            className={css.checkbox}
            checked={done}
            aria-label={item.title}
            onChange={(event) => { onToggle(item, event.target.checked) }}
          />
        )}
        <svg className={css.check} viewBox="0 0 16 16" aria-hidden="true">
          <circle className={css.checkRing} cx="8" cy="8" r="6.5" />
          <path className={css.checkPath} d="M4.8 8.3 7 10.5 11.2 5.9" />
        </svg>
      </label>
      <span className={css.title}>{item.title}</span>
    </div>
  )
}
