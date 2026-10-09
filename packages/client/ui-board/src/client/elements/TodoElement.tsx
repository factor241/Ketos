/**
 * Body of a `todo` element: the host-owned snapshot of one Beads list. The
 * owner sees the add field, the per-item checkbox, and the refresh control;
 * a list synchronized from another Ketos renders read-only. The list is the
 * one scrolling area and keeps the native wheel, like the note body.
 *
 * The toggle is optimistic: the row moves immediately and rolls back with a
 * board notice when the host refuses. Rows are keyed by issue id, so a done
 * item keeps its DOM node while the container moves it below the done
 * heading, and the layout effect animates the user's own toggle with a FLIP
 * transform measured in layout offsets inside the list, unless the user asked
 * for reduced motion.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { parseTodoData } from '@ketos/board-doc/data'
import type { TodoItem } from '@ketos/board-doc/types'
import { boardParticipants, participantLabel } from '../owners.ts'
import type { BoardStoreHandle } from '../store.ts'
import { addTodoItem, refreshTodoList, setTodoItemDone } from '../todo-api.ts'
import { todoNoticeKey } from '../todo-notice.ts'
import { NeutralElementBody } from './NeutralElementBody.tsx'
import { TodoItemRow } from './TodoItemRow.tsx'
import css from './TodoElement.module.css'

/**
 * Read the list's layout width, which makes the browser compute the pending
 * styles of its rows.
 * @param list - the list node, absent before mount.
 * @returns the width in CSS pixels, 0 without a node.
 */
function readListWidth(list: HTMLElement | null): number {
  return list?.offsetWidth ?? 0
}

export type TodoElementProps =
  PropsRuntime<'board.element.body', 'todo'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>

export function TodoElement({ element, editable, useStore, actions, t }: TodoElementProps) {
  const limits = useStore(s => s.boardLimits)
  const participants = useStore(s => boardParticipants(s))
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  /** Optimistic states by item id; dropped once the snapshot agrees. */
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const rowNodes = useRef(new Map<string, HTMLDivElement>())
  /** Row offsets inside the list recorded by the last toggle, until the next layout effect consumes them. */
  const firstOffsets = useRef<Map<string, { readonly left: number; readonly top: number }> | null>(null)
  const frameRef = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const elementId = element.id

  const registerRow = useCallback((id: string) => (node: HTMLDivElement | null): void => {
    if (node === null) rowNodes.current.delete(id)
    else rowNodes.current.set(id, node)
  }, [])

  // Drop an optimistic state as soon as the snapshot carries it, so a later
  // authoritative change of the same item is never masked by a stale override.
  useEffect(() => {
    if (limits === null) return
    const stored = parseTodoData(element.data, limits)
    if (stored === null) return
    setPending((current) => {
      if (current.size === 0) return current
      const next = new Map(current)
      let changed = false
      for (const item of stored.items) {
        if (next.get(item.id) === (item.status === 'closed')) {
          next.delete(item.id)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [element.data, limits])

  const data = limits === null ? null : parseTodoData(element.data, limits)
  const isDone = (item: TodoItem): boolean => pending.get(item.id) ?? item.status === 'closed'
  /** Row order of the open section, then the done section; changes exactly when a row changes section. */
  const partitionKey = data === null
    ? ''
    : `${data.items.filter(item => !isDone(item)).map(item => item.id).join(',')}|${data.items.filter(isDone).map(item => item.id).join(',')}`

  // FLIP: `toggle()` records the rows' layout offsets inside the list (First)
  // and this effect, keyed by the section partition, reads them again (Last)
  // and plays the difference. Layout offsets ignore the canvas transform, so
  // panning, zooming, and moving the element never animate rows; only the
  // user's own toggle does. Reduced motion skips the animation.
  useLayoutEffect(() => {
    const first = firstOffsets.current
    firstOffsets.current = null
    if (first === null) return
    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return
    const moved: HTMLDivElement[] = []
    for (const [id, node] of rowNodes.current) {
      const before = first.get(id)
      if (before === undefined) continue
      const dx = before.left - node.offsetLeft
      const dy = before.top - node.offsetTop
      if (dx === 0 && dy === 0) continue
      node.style.transition = 'none'
      node.style.transform = `translate(${String(dx)}px, ${String(dy)}px)`
      moved.push(node)
    }
    if (moved.length === 0) return
    // The loop's offset reads flushed the style of every row but the last one
    // it inverted; one more layout read commits that row's inverted transform,
    // so its transition starts from it when the next frame releases all rows.
    readListWidth(listRef.current)
    frameRef.current = requestAnimationFrame(() => {
      for (const node of moved) {
        node.style.transition = ''
        node.style.transform = ''
      }
    })
  }, [partitionKey])

  useEffect(() => () => { cancelAnimationFrame(frameRef.current) }, [])

  if (limits === null) return <NeutralElementBody element={element} t={t} />
  if (data === null) return <NeutralElementBody element={element} t={t} />

  const open = data.items.filter(item => !isDone(item))
  const done = data.items.filter(item => isDone(item))
  const fraction = data.items.length === 0 ? 0 : done.length / data.items.length
  const full = data.items.length >= limits.todoItemsMax

  const toggle = (item: TodoItem, next: boolean): void => {
    const offsets = new Map<string, { readonly left: number; readonly top: number }>()
    for (const [id, node] of rowNodes.current) offsets.set(id, { left: node.offsetLeft, top: node.offsetTop })
    firstOffsets.current = offsets
    setPending(current => new Map(current).set(item.id, next))
    void setTodoItemDone(elementId, item.id, next).then((outcome) => {
      if (outcome.ok) return
      setPending((current) => {
        const without = new Map(current)
        without.delete(item.id)
        return without
      })
      actions.setElementNotice(todoNoticeKey(outcome.code, 'list'))
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
        actions.setElementNotice(todoNoticeKey(outcome.code, 'add'))
        return
      }
      setDraft('')
    })
  }

  const refresh = (): void => {
    setBusy(true)
    void refreshTodoList(elementId).then((outcome) => {
      setBusy(false)
      if (!outcome.ok) actions.setElementNotice(todoNoticeKey(outcome.code, 'list'))
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
      aria-label={t('element.todo.aria', { name: participantLabel(t, participants.find(candidate => candidate.id === element.ownerId)) })}
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
      <div ref={listRef} className={css.list} data-board-wheel="native" role="list">
        {[
          ...open.map(renderRow),
          ...(done.length > 0
            ? [<div key="done-heading" className={css.doneHeading} data-board-todo-done="" role="listitem">{t('element.todo.done')}</div>]
            : []),
          ...done.map(renderRow),
        ]}
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
