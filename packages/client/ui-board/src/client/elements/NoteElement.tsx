/**
 * Body of a `note` element: the owner's plain text at the chosen font, size,
 * and scale, and the in-place editor of the owner's own note.
 *
 * The scroll area fills the element's world rectangle and keeps the native
 * wheel (its own scrolling), while the content block inside is the scaled
 * coordinate system: `w/scale × h/scale` under `transform: scale(scale)`, so
 * the text grows with the element's zoom step while `w`/`h` stay the real
 * world rectangle. Data that fails the kind's decoder falls back to the
 * neutral body instead of rendering a half-valid note.
 *
 * While editing, the text lives in a local draft: stream patches and fresh
 * snapshots never overwrite the textarea or move its caret, and the draft
 * reaches the document through one debounced `patch { data: { text } }` (the
 * owner's display choices merge back by key). Leaving the editor, `pagehide`,
 * a hidden tab, and unmounting flush the pending text; the page-lifetime flush
 * posts with `keepalive` so a quickly closed tab does not lose the last
 * letters. The editor closes only after the host accepted the text, including a
 * debounced patch still in flight when the editor is left: a refused patch
 * keeps the editor open with the draft, and the next flush sends it again.
 */
import {
  useCallback, useContext, useEffect, useRef, useState,
  type ChangeEvent, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { parseNoteData } from '@ketos/board-doc/data'
import type { BoardElementInjected } from '../contract/slots.ts'
import { boardParticipants, participantLabel } from '../owners.ts'
import type { BoardStoreHandle } from '../store.ts'
import { CommittedEditingContext } from './BoardElementLayer.tsx'
import { NeutralElementBody } from './NeutralElementBody.tsx'
import css from './NoteElement.module.css'

/** Delay after the last keystroke before the draft reaches the document. */
export const NOTE_TEXT_WRITE_DEBOUNCE_MS = 400

export type NoteElementProps =
  PropsRuntime<'board.element.body', 'note'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>
  & BoardElementInjected

export function NoteElement({ element, useStore, actions, t, patchElement }: NoteElementProps) {
  const limits = useStore(s => s.boardLimits)
  const editing = useStore(s => s.editingBoardElementId === element.id)
  const participants = useStore(s => boardParticipants(s))
  const [draft, setDraft] = useState<string | null>(null)
  const draftRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)
  /** The latest patch request still awaiting the host's answer. */
  const inFlightRef = useRef<Promise<boolean> | null>(null)
  const exitingRef = useRef(false)
  const mountedRef = useRef(true)
  const committedEditing = useContext(CommittedEditingContext)
  const editingRef = useRef(editing)
  editingRef.current = editing
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const elementId = element.id

  /** Drop a pending debounce, keeping the draft for the next attempt. */
  const cancelTimer = useCallback((): void => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  /**
   * Write the pending draft as one patch; a clean draft writes nothing. A
   * patch the host refuses marks the draft pending again, so the next flush
   * sends the latest text; a refusal never turns an absent draft into empty
   * text.
   * @param keepalive - post as a page-lifetime request.
   * @returns true when nothing was left to write or the host accepted the text.
   */
  const flush = useCallback(async (keepalive: boolean): Promise<boolean> => {
    cancelTimer()
    const text = draftRef.current
    if (!dirtyRef.current || text === null) return true
    dirtyRef.current = false
    const request = patchElement(elementId, { data: { text } }, keepalive ? { keepalive: true } : undefined)
    inFlightRef.current = request
    const saved = await request
    if (inFlightRef.current === request) inFlightRef.current = null
    if (!saved && draftRef.current !== null) dirtyRef.current = true
    return saved
  }, [cancelTimer, elementId, patchElement])
  const flushRef = useRef(flush)
  flushRef.current = flush

  /**
   * Close the editor once the last text is saved. A save already in flight
   * (the debounced write) is answered first; its refusal, a refused exit
   * flush, or typing while either was in flight keeps the editor open with
   * the draft.
   */
  const exitEditing = useCallback(async (): Promise<void> => {
    if (exitingRef.current) return
    exitingRef.current = true
    const inFlight = inFlightRef.current
    const saved = (inFlight === null || await inFlight) && await flush(false)
    exitingRef.current = false
    if (!saved || dirtyRef.current || !mountedRef.current) return
    draftRef.current = null
    setDraft(null)
    actions.setEditingBoardElement(null)
  }, [actions, flush])

  // Unmounting while editing (the element left the layer) saves the pending
  // draft and ends the editing mode, so a remount never reopens the editor and
  // takes the focus. The editing target is the layer's committed one: when
  // another element opened in the commit that unmounts this body, its edit
  // stays open.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      void flushRef.current(false)
      const stillEditing = committedEditing === null
        ? editingRef.current
        : committedEditing.current === elementId
      if (stillEditing) actions.setEditingBoardElement(null)
    }
  }, [actions, committedEditing, elementId])

  // A hidden or unloading page flushes the pending text as a page-lifetime
  // request; the editor stays open for the next visit to the tab.
  useEffect(() => {
    if (!editing) return
    const onPageHide = (): void => { void flush(true) }
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') void flush(true)
    }
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      cancelTimer()
    }
  }, [cancelTimer, editing, flush])

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = event.target.value
    draftRef.current = value
    dirtyRef.current = true
    setDraft(value)
    cancelTimer()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void flush(false)
    }, NOTE_TEXT_WRITE_DEBOUNCE_MS)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Escape') return
    // An active IME composition owns Escape: it cancels the composition, not
    // the edit.
    if (event.nativeEvent.isComposing) return
    event.preventDefault()
    event.stopPropagation()
    void exitEditing()
  }

  if (limits === null) return <NeutralElementBody element={element} t={t} />
  const note = parseNoteData(element.data, limits)
  if (note === null) return <NeutralElementBody element={element} t={t} />
  const content: CSSProperties = {
    width: element.w / note.scale,
    height: element.h / note.scale,
    transform: `scale(${String(note.scale)})`,
  }
  return (
    <div
      data-board-note=""
      data-board-wheel="native"
      role="group"
      aria-label={t('note.aria', { name: participantLabel(t, participants.find(candidate => candidate.id === element.ownerId)) })}
      className={css.scroll}
    >
      <div
        data-board-note-content=""
        data-board-note-font={note.font}
        data-board-note-size={note.size}
        className={clsx(css.content, editing && css.editing)}
        style={content}
      >
        {editing
          ? (
            <textarea
              data-board-note-editor=""
              aria-label={t('note.edit.aria')}
              className={css.editor}
              value={draft ?? note.text}
              maxLength={limits.noteTextMax}
              autoFocus
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onBlur={() => { void exitEditing() }}
            />
          )
          : note.text}
      </div>
    </div>
  )
}
