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
 * and a hidden tab flush the pending text; the page-lifetime flush posts with
 * `keepalive` so a quickly closed tab does not lose the last letters.
 */
import {
  useCallback, useEffect, useRef, useState,
  type ChangeEvent, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { parseNoteData } from '@ketos/board-doc/data'
import type { BoardElementInjected, BoardElementPatch } from '../contract/slots.ts'
import { boardParticipants, participantLabel } from '../owners.ts'
import type { BoardStoreHandle } from '../store.ts'
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const elementId = element.id

  /** Drop a pending debounce, keeping the draft for the next attempt. */
  const cancelTimer = useCallback((): void => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  /** Write the pending draft as one patch; a clean draft writes nothing. */
  const flush = useCallback((keepalive: boolean): void => {
    cancelTimer()
    if (!dirtyRef.current) return
    dirtyRef.current = false
    const patch: BoardElementPatch = { data: { text: draftRef.current ?? '' } }
    patchElement(elementId, patch, keepalive ? { keepalive: true } : undefined)
  }, [cancelTimer, elementId, patchElement])

  /** Close the editor: the last text goes out, the draft is dropped. */
  const exitEditing = useCallback((): void => {
    flush(false)
    draftRef.current = null
    setDraft(null)
    actions.setEditingBoardElement(null)
  }, [actions, flush])

  // A hidden or unloading page flushes the pending text as a page-lifetime
  // request; the editor stays open for the next visit to the tab.
  useEffect(() => {
    if (!editing) return
    const onPageHide = (): void => { flush(true) }
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') flush(true)
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
      flush(false)
    }, NOTE_TEXT_WRITE_DEBOUNCE_MS)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Escape') return
    // An active IME composition owns Escape: it cancels the composition, not
    // the edit.
    if (event.nativeEvent.isComposing) return
    event.preventDefault()
    event.stopPropagation()
    exitEditing()
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
              onBlur={exitEditing}
            />
          )
          : note.text}
      </div>
    </div>
  )
}
