/**
 * Popover that asks for the title of a new to-do list. It mounts in the
 * dock's screen-space popover host (no windowId, scale 1), opens above the
 * `+` control, submits on Enter, closes on Escape, and keeps its action
 * inactive while the title is empty or a creation is in flight.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react'
import { MenuSurface } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BoardTranslate } from '../locale.ts'
import css from './TodoCreatePopover.module.css'

/** Fixed width of the popover in screen pixels. */
const POPOVER_WIDTH = 240

/** Props of the list-title popover. */
export interface TodoCreatePopoverProps {
  /** Screen rectangle of the `+` control at open time. */
  readonly anchor: DOMRect
  /** Screen rectangle the popover stays inside. */
  readonly boundary: DOMRect
  /** Whether one creation request is already in flight. */
  readonly busy: boolean
  /** Bound board dictionary. */
  readonly t: BoardTranslate
  /** Create the list with the trimmed title. */
  readonly onCreate: (title: string) => void
  /** Close without creating. */
  readonly onClose: () => void
}

export function TodoCreatePopover({ anchor, boundary, busy, t, onCreate, onClose }: TodoCreatePopoverProps) {
  const [title, setTitle] = useState('')
  const inputId = useId()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const trimmed = title.trim()

  // A click anywhere outside the popover closes it; Escape is handled on the
  // surface itself, and Enter submits the form.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const node = surfaceRef.current
      if (node === null || event.target instanceof Node && node.contains(event.target)) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [onClose])
  const left = Math.min(
    Math.max(anchor.left, boundary.left),
    Math.max(boundary.left, boundary.right - POPOVER_WIDTH),
  )
  const style: CSSProperties = {
    left,
    bottom: window.innerHeight - anchor.top + 8,
    width: POPOVER_WIDTH,
  }
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (trimmed === '' || busy) return
    onCreate(trimmed)
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }
  return (
    <MenuSurface
      ref={surfaceRef}
      className={css.popover}
      style={style}
      role="dialog"
      aria-label={t('element.todo.create.title')}
      onKeyDown={onKeyDown}
    >
      <form className={css.form} onSubmit={submit}>
        <label className={css.label} htmlFor={inputId}>{t('element.todo.create.title')}</label>
        <input
          id={inputId}
          className={css.input}
          value={title}
          autoFocus
          placeholder={t('element.todo.create.placeholder')}
          onChange={(event) => { setTitle(event.target.value) }}
        />
        <button
          type="submit"
          className={css.action}
          data-board-action="todo-create-confirm"
          disabled={busy || trimmed === ''}
        >
          {t('element.todo.create.action')}
        </button>
      </form>
    </MenuSurface>
  )
}
