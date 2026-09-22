/**
 * Clone memory window body: the memory of one clone as a filterable list the
 * person can search, edit, and delete.
 *
 * The body lives on the same clone window as the profile editor, selected by
 * the window's Memory tab; it reads the window's `cloneId` and never owns a
 * session of its own. Every mutation re-reads the list, so the rows always
 * show what the store holds, and the agent's next turn sees the same change
 * through its memory snapshot.
 */
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Button, Input, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MemoryDto, MemoryId, MemoryStatus } from '@ketos/clone-core/types'
import {
  MEMORY_CONTENT_LIMIT, MEMORY_QUERY_LIMIT, MEMORY_STATUS_ROWS, MEMORY_TAG_COUNT_LIMIT, MEMORY_TAG_LIMIT,
  type BoardWindowInjected, type MemoryFailureCode,
} from '../contract/slots.ts'
import type { BoardTranslate } from '../locale.ts'
import { relativeAge } from '../relative-age.ts'
import css from './CloneMemoryBody.module.css'

export type CloneMemoryBodyProps =
  PropsRuntime<'board.window.body'>
  & PropsLocale<'board'>
  & InjectFace<BoardWindowInjected>

/** Locale key of one memory status row. */
const STATUS_KEYS = {
  active: 'clone.memory.status.active',
  candidate: 'clone.memory.status.candidate',
  archived: 'clone.memory.status.archived',
} as const satisfies Record<MemoryStatus, Parameters<BoardTranslate>[0]>

/** The row being edited: the content, tags, and status draft of one memory. */
interface MemoryEdit {
  readonly id: MemoryId
  readonly content: string
  readonly tags: string
  readonly status: MemoryStatus
}

/** Localized age of one memory's last update, in the board's short units. */
function updatedLabel(updatedAt: string, t: BoardTranslate): string {
  return t('clone.memory.updated', { time: relativeAge(updatedAt, t) })
}

/** Split the comma-separated tag draft into the tag list the host stores. */
function parseTags(value: string): string[] {
  return value.split(',').map(tag => tag.trim()).filter(tag => tag !== '')
}

/**
 * Render the memory list of the window's clone.
 * @param props - window owner props, the locale seat, and the memory actions.
 * @returns the list, its filter and search row, and the row editor.
 */
export function CloneMemoryBody({
  window: cardWindow, t, loadMemories, searchMemories, saveMemory, removeMemory,
}: CloneMemoryBodyProps) {
  const cloneId = cardWindow.cloneId
  const [filter, setFilter] = useState<MemoryStatus>('active')
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [rows, setRows] = useState<readonly MemoryDto[]>([])
  const [loading, setLoading] = useState(false)
  const [epoch, setEpoch] = useState(0)
  const [editing, setEditing] = useState<MemoryEdit | undefined>(undefined)
  const [confirming, setConfirming] = useState<MemoryId | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  /** A refused mutation, shown until the next attempt. */
  const [notice, setNotice] = useState<'invalid' | 'failed' | undefined>(undefined)
  /** A read the route refused; the list must not read as an empty memory. */
  const [readFailure, setReadFailure] = useState<MemoryFailureCode | undefined>(undefined)

  // Re-read the list whenever the clone, the filter, the submitted query, or a
  // completed mutation changes it. The `live` guard keeps an older answer from
  // landing after the window moved on.
  useEffect(() => {
    if (cloneId === undefined) return undefined
    let live = true
    setLoading(true)
    const search = submitted.trim()
    // A query with no letter or digit can never match; refusing it here keeps
    // the person from retrying a request the route would answer 400.
    if (search !== '' && !/[\p{L}\p{N}]/u.test(search)) {
      setLoading(false)
      setRows([])
      setReadFailure('ketos/invalid')
      return undefined
    }
    const answered = search === ''
      ? loadMemories(cloneId, filter)
      : searchMemories(cloneId, search, filter)
    void answered.then((outcome) => {
      if (!live) return
      setLoading(false)
      setReadFailure(outcome.ok ? undefined : outcome.code)
      // A refused read must not leave the previous filter's rows on screen.
      setRows(outcome.ok ? outcome.memories : [])
    })
    return () => { live = false }
  }, [cloneId, filter, submitted, epoch, loadMemories, searchMemories])

  if (cloneId === undefined) {
    return (
      <div className={css.missing} data-board-memory-missing="">
        <span>{t('clone.missing')}</span>
      </div>
    )
  }

  const reload = (): void => { setEpoch(value => value + 1) }

  const onSave = async (edit: MemoryEdit): Promise<void> => {
    const tags = parseTags(edit.tags)
    // The host refuses these bounds; checking them here keeps the person from
    // retrying a value that can never be accepted.
    if (tags.length > MEMORY_TAG_COUNT_LIMIT || tags.some(tag => tag.length > MEMORY_TAG_LIMIT)) {
      setNotice('invalid')
      return
    }
    setBusy(true)
    setNotice(undefined)
    const outcome = await saveMemory(edit.id, {
      content: edit.content.trim(),
      tags,
      status: edit.status,
    })
    setBusy(false)
    if (outcome === 'saved') {
      setEditing(undefined)
      reload()
      return
    }
    // A row that left the store needs no editor and no notice: the re-read is
    // what removes it from the list.
    if (outcome === 'missing') {
      setEditing(undefined)
      reload()
      return
    }
    setNotice(outcome)
  }

  const onDelete = async (id: MemoryId): Promise<void> => {
    setBusy(true)
    setNotice(undefined)
    const outcome = await removeMemory(id)
    setBusy(false)
    setConfirming(undefined)
    if (outcome === 'deleted') {
      reload()
      return
    }
    if (outcome === 'missing') {
      reload()
      return
    }
    setNotice('failed')
  }

  return (
    <div className={css.body}>
      <div className={css.list} data-board-memory-list="">
        <div className={css.filters}>
          {MEMORY_STATUS_ROWS.map((status) => {
            // The count belongs to the answered list of the active filter; while
            // a read is in flight the previous filter's count would be a lie.
            const count = !loading && readFailure === undefined && status === filter && submitted.trim() === ''
              ? rows.length
              : undefined
            return (
              <Pill
                key={status}
                active={filter === status}
                data-board-memory-filter={status}
                onClick={() => {
                  setFilter(status)
                  setEditing(undefined)
                  setConfirming(undefined)
                  reload()
                }}
              >
                {t(STATUS_KEYS[status])}{count === undefined ? '' : ` (${String(count)})`}
              </Pill>
            )
          })}
          <form
            className={css.search}
            onSubmit={(event) => {
              event.preventDefault()
              setEditing(undefined)
              setConfirming(undefined)
              setSubmitted(query)
              reload()
            }}
          >
            <Input
              value={query}
              maxLength={MEMORY_QUERY_LIMIT}
              aria-label={t('clone.memory.search')}
              placeholder={t('clone.memory.search.placeholder')}
              data-board-memory="search"
              onChange={(event) => { setQuery(event.target.value) }}
            />
            <Button size="sm" variant="outline" type="submit" data-board-memory="search-submit">
              {t('clone.memory.search.submit')}
            </Button>
            {submitted !== '' && (
              <Button
                size="sm"
                variant="ghost"
                data-board-memory="search-clear"
                onClick={() => { setQuery(''); setSubmitted('') }}
              >
                {t('clone.memory.search.clear')}
              </Button>
            )}
          </form>
        </div>

        {notice === 'invalid' && (
          <div className={clsx(css.notice, css.noticeError)} data-board-memory-notice="invalid">
            {t('clone.memory.invalid.tags', {
              count: String(MEMORY_TAG_COUNT_LIMIT),
              length: String(MEMORY_TAG_LIMIT),
            })}
          </div>
        )}
        {notice === 'failed' && (
          <div className={clsx(css.notice, css.noticeError)} data-board-memory-notice="failed">
            {t('clone.memory.failed')}
          </div>
        )}
        {readFailure === 'ketos/invalid' && (
          <div className={clsx(css.notice, css.noticeError)} data-board-memory-notice="refused">
            {t('clone.memory.search.invalid')}
          </div>
        )}
        {readFailure !== undefined && readFailure !== 'ketos/invalid' && (
          <div className={clsx(css.notice, css.noticeError)} data-board-memory-notice="read">
            <span>{t('clone.memory.load.failed')}</span>
            <Button size="sm" variant="outline" data-board-memory="retry" onClick={reload}>
              {t('clone.retry')}
            </Button>
          </div>
        )}
        {loading && <span className={css.hint} data-board-memory-loading="">{t('clone.memory.loading')}</span>}
        {!loading && readFailure === undefined && rows.length === 0 && (
          <span className={css.hint} data-board-memory-empty="">
            {submitted.trim() === '' ? t('clone.memory.empty.filtered') : t('clone.memory.empty.search')}
          </span>
        )}

        {rows.map((memory) => {
          const edit = editing?.id === memory.id ? editing : undefined
          return (
            <div key={memory.id} className={css.row} data-board-memory={memory.id}>
              <div className={css.rowHead}>
                <span className={css.status} data-board-memory-status={memory.status}>
                  {t(STATUS_KEYS[memory.status])}
                </span>
                <span className={css.meta}>
                  {t('clone.memory.source', {
                    source: memory.sourceSessionId ?? t('clone.memory.source.person'),
                  })}
                </span>
                <span className={css.meta}>{updatedLabel(memory.updatedAt, t)}</span>
              </div>

              {edit === undefined
                ? <p className={css.content}>{memory.content}</p>
                : (
                  <div className={css.edit}>
                    <label className={css.field}>
                      <span className={css.label}>{t('clone.memory.content')}</span>
                      <textarea
                        className={css.textarea}
                        value={edit.content}
                        maxLength={MEMORY_CONTENT_LIMIT}
                        disabled={busy}
                        aria-label={t('clone.memory.content')}
                        data-board-memory="content"
                        onChange={(event) => { setEditing({ ...edit, content: event.target.value }) }}
                      />
                    </label>
                    <label className={css.field}>
                      <span className={css.label}>{t('clone.memory.tags')}</span>
                      <Input
                        value={edit.tags}
                        disabled={busy}
                        aria-label={t('clone.memory.tags')}
                        placeholder={t('clone.memory.tags.placeholder')}
                        data-board-memory="tags"
                        onChange={(event) => { setEditing({ ...edit, tags: event.target.value }) }}
                      />
                    </label>
                    <div className={css.statusRow}>
                      <span className={css.label}>{t('clone.memory.status')}</span>
                      {MEMORY_STATUS_ROWS.map(status => (
                        <Pill
                          key={status}
                          active={edit.status === status}
                          disabled={busy}
                          data-board-memory-edit-status={status}
                          onClick={() => { setEditing({ ...edit, status }) }}
                        >
                          {t(STATUS_KEYS[status])}
                        </Pill>
                      ))}
                    </div>
                  </div>
                )}

              {memory.tags.length > 0 && (
                <div className={css.tags} data-board-memory-tags={memory.tags.join(',')}>
                  {memory.tags.map((tag, index) => (
                    <span key={`${tag}-${String(index)}`} className={css.tag}>{tag}</span>
                  ))}
                </div>
              )}

              <div className={css.actions}>
                {edit === undefined
                  ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      data-board-memory="edit"
                      onClick={() => {
                        setConfirming(undefined)
                        setEditing({ id: memory.id, content: memory.content, tags: memory.tags.join(', '), status: memory.status })
                      }}
                    >
                      {t('clone.memory.edit')}
                    </Button>
                  )
                  : (
                    <>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busy || edit.content.trim() === ''}
                        data-board-memory="save"
                        onClick={() => { void onSave(edit) }}
                      >
                        {t('clone.save')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        data-board-memory="cancel"
                        onClick={() => { setEditing(undefined) }}
                      >
                        {t('clone.cancel')}
                      </Button>
                    </>
                  )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  data-board-memory={confirming === memory.id ? 'delete.confirm' : 'delete'}
                  onClick={() => {
                    if (confirming !== memory.id) {
                      setConfirming(memory.id)
                      return
                    }
                    void onDelete(memory.id)
                  }}
                >
                  {confirming === memory.id ? t('clone.delete.confirm') : t('clone.delete')}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
