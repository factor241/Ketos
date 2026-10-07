/**
 * Body of a `todo` element: the host-owned snapshot of one Beads list. The
 * owner sees the add field, the per-item checkbox, and the refresh control;
 * a list synchronized from another Ketos renders read-only. The list is the
 * one scrolling area and keeps the native wheel, like the note body.
 *
 * The toggle is optimistic: the row moves immediately and rolls back with a
 * board notice when the host refuses. Rows are keyed by issue id, so a done
 * item keeps its DOM node while the container moves it below the done
 * heading, and the layout effect animates that move with a FLIP transform
 * unless the user asked for reduced motion.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { parseTodoData } from '@ketos/board-doc/data'
import type { TodoItem } from '@ketos/board-doc/types'
import type { BoardKey } from '../locale.ts'
import { participantLabel, participantOf } from '../owners.ts'
import type { BoardStoreHandle } from '../store.ts'
import { addTodoItem, refreshTodoList, setTodoItemDone, type TodoFailureCode } from '../todo-api.ts'
import { NeutralElementBody } from './NeutralElementBody.tsx'
import { TodoItemRow } from './TodoItemRow.tsx'
import css from './TodoElement.module.css'

export type TodoElementProps =
  PropsRuntime<'board.element.body', 'todo'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>

/**
 * Localized notice for one failed to-do operation.
 * @param code - failure code the host answered with.
 * @returns the dictionary key of the notice.
 */
function noticeKey(code: TodoFailureCode): BoardKey {
  if (code === 'ketos/beads-unavailable') return 'element.todo.error.unavailable'
  if (code === 'ketos/limit') return 'element.todo.full'
  return 'element.todo.error.failed'
}

export function TodoElement({ element, editable, useStore, actions, t }: TodoElementProps) {
  const limits = useStore(s => s.boardLimits)
  const selfId = useStore(s => s.selfId)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  /** Optimistic states by item id; dropped once the snapshot agrees. */
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const rowNodes = useRef(new Map<string, HTMLDivElement>())
  const previousRects = useRef(new Map<string, DOMRect>())
  const elementId = element.id

  const registerRow = useCallback((id: string) => (node: HTMLDivElement | null): void => {
    if (node === null) rowNodes.current.delete(id)
    else rowNodes.current.set(id, node)
  }, [])

  // Drop an optimistic state as soon as the snapshot carries it, so a later
  // authoritative change of the same item is never masked by a stale override.
  useEffect(() => {
    if (limits === null) return
    const data = parseTodoData(element.data, limits)
    if (data === null) return
    setPending((current) => {
      if (current.size === 0) return current
      const next = new Map(current)
      let changed = false
      for (const item of data.items) {
        if (next.get(item.id) === (item.status === 'closed')) {
          next.delete(item.id)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [element.data, limits])

  // FLIP: after every commit, rows that moved from their previous screen
  // position animate from the old spot to the new one. Reduced motion skips
  // the animation, and a row seen for the first time never moves.
  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>()
    for (const [id, node] of rowNodes.current) next.set(id, node.getBoundingClientRect())
    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!reduced) {
      for (const [id, rect] of next) {
        const before = previousRects.current.get(id)
        const node = rowNodes.current.get(id)
        if (before === undefined || node === undefined) continue
        const dx = before.left - rect.left
        const dy = before.top - rect.top
        if (dx === 0 && dy === 0) continue
        node.style.transition = 'none'
        node.style.transform = `translate(${dx}px, ${dy}px)`
        requestAnimationFrame(() => {
          node.style.transition = ''
          node.style.transform = ''
        })
      }
    }
    previousRects.current = next
  })

  if (limits === null) return <NeutralElementBody element={element} t={t} />
  const data = parseTodoData(element.data, limits)
  if (data === null) return <NeutralElementBody element={element} t={t} />

  const isDone = (item: TodoItem): boolean => pending.get(item.id) ?? item.status === 'closed'
  const open = data.items.filter(item => !isDone(item))
  const done = data.items.filter(item => isDone(item))
  const fraction = data.items.length === 0 ? 0 : done.length / data.items.length
  const full = data.items.length >= limits.todoItemsMax

  const toggle = (item: TodoItem, next: boolean): void => {
    setPending(current => new Map(current).set(item.id, next))
    void setTodoItemDone(elementId, item.id, next).then((outcome) => {
      if (outcome.ok) return
      setPending((current) => {
        const without = new Map(current)
        without.delete(item.id)
        return without
      })
      actions.setElementNotice(noticeKey(outcome.code))
    })
  }

  const submitItem = (event: FormEvent): void => {
    event.preventDefault()
    const title = draft.trim()
    if (title === '' || busy) return
    setBusy(true)
    void addTodoItem(elementId, title).then((outcome) => {
      setBusy(false)
      if (!outcome.ok) {
        actions.setElementNotice(noticeKey(outcome.code))
        return
      }
      setDraft('')
    })
  }

  const refresh = (): void => {
    setBusy(true)
    void refreshTodoList(elementId).then((outcome) => {
      setBusy(false)
      if (!outcome.ok) actions.setElementNotice(noticeKey(outcome.code))
    })
  }

  /** One keyed row wrapper the FLIP pass measures and transforms. */
  const renderRow = (item: TodoItem): ReturnType<typeof TodoItemRow> => (
    <TodoItemRow
      key={item.id}
      item={item}
      done={isDone(item)}
      editable={editable}
      onToggle={toggle}
      registerRow={registerRow(item.id)}
    />
  )

  return (
    <div
      data-board-todo=""
      role="group"
      aria-label={t('element.todo.aria', { name: participantLabel(t, participantOf({ selfId }, element.ownerId)) })}
      className={css.root}
    >
      <div className={css.header}>
        <span className={css.title}>{data.title}</span>
        {editable && (
          <button
            type="button"
            className={css.refresh}
            data-board-todo-action="refresh"
            disabled={busy}
            onPointerDown={(event) => { event.stopPropagation() }}
            onClick={refresh}
          >
            {t('element.todo.refresh')}
          </button>
        )}
      </div>
      <div className={css.progressRow}>
        <div
          className={css.progress}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
          aria-label={t('element.todo.progress', { done: done.length, total: data.items.length })}
        >
          <span className={css.progressFill} style={{ transform: `scaleX(${String(fraction)})` }} />
        </div>
        <span className={css.progressText}>{t('element.todo.progress', { done: done.length, total: data.items.length })}</span>
      </div>
      {data.missing === true && <div className={css.missing}>{t('element.todo.missing')}</div>}
      <div className={css.list} data-board-wheel="native" role="list">
        {open.map(renderRow)}
        {done.length > 0 && <div className={css.doneHeading} data-board-todo-done="" role="presentation">{t('element.todo.done')}</div>}
        {done.map(renderRow)}
      </div>
      {editable && (
        <form className={css.addRow} onSubmit={submitItem} onPointerDown={(event) => { event.stopPropagation() }}>
          <input
            className={css.addInput}
            value={draft}
            placeholder={t('element.todo.add.placeholder')}
            aria-label={t('element.todo.add.placeholder')}
            disabled={busy || full}
            onChange={(event) => { setDraft(event.target.value) }}
          />
          {full && <span className={css.full}>{t('element.todo.full')}</span>}
        </form>
      )}
    </div>
  )
}
