/**
 * Transcript state of one foreign chat card: collapsed, loading, listed, or
 * failed. One read is current at a time; starting another, collapsing, or
 * leaving the scope aborts it, and an answer that arrives after its abort
 * changes nothing.
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { TranscriptMessage } from '@ketos/peer/types'
import type { BoardForeignInjected, BoardTranscriptFailureCode } from '../contract/slots.ts'

/** What the card shows of the transcript. */
export interface ForeignTranscriptView {
  /** Whether the transcript region is expanded. */
  readonly open: boolean
  /** Whether a read is in flight. */
  readonly loading: boolean
  /** Messages of the last successful read, oldest first; absent before one or after the owner closed access. */
  readonly messages: readonly TranscriptMessage[] | undefined
  /** Code of the last failed read, until the next read starts. */
  readonly failure: BoardTranscriptFailureCode | undefined
}

/** View held with the scope it belongs to. */
interface HeldView extends ForeignTranscriptView {
  readonly scope: string | undefined
}

/** Collapsed view. */
const COLLAPSED: ForeignTranscriptView = { open: false, loading: false, messages: undefined, failure: undefined }

/** Operations on the transcript state. */
export interface ForeignTranscriptControls extends ForeignTranscriptView {
  /** Expand the region and read the transcript. */
  readonly show: () => void
  /** Read the transcript again, keeping the listed messages meanwhile. */
  readonly refresh: () => void
  /** Collapse the region and abandon the read in flight. */
  readonly hide: () => void
}

/**
 * Hold the transcript state of one foreign window.
 * @param windowId - the foreign window whose transcript is read.
 * @param scope - identity of what the state belongs to (window and session), or absence while
 *   the window has no session; a change collapses the view.
 * @param fetchTranscript - the transcript read seat.
 * @returns the view and its operations.
 */
export function useForeignTranscript(
  windowId: string,
  scope: string | undefined,
  fetchTranscript: BoardForeignInjected['fetchTranscript'],
): ForeignTranscriptControls {
  const [held, setHeld] = useState<HeldView>({ ...COLLAPSED, scope })
  const current = useRef<AbortController | undefined>(undefined)
  // Adjusting state during render replaces the stale view before it paints.
  let view = held
  if (held.scope !== scope) {
    view = { ...COLLAPSED, scope }
    setHeld(view)
  }

  // A scope change or an unmount abandons the read in flight. The layout phase
  // aborts in the commit itself, so no answer can land between the new scope
  // painting and the cleanup running.
  useLayoutEffect(() => () => { current.current?.abort() }, [scope])

  const read = useCallback(() => {
    current.current?.abort()
    const own = new AbortController()
    current.current = own
    setHeld(previous => ({
      scope,
      open: true,
      loading: true,
      messages: previous.messages,
      failure: undefined,
    }))
    void fetchTranscript(windowId, own.signal).then((outcome) => {
      // A newer read, a collapse, or a scope change supersedes this answer.
      if (own.signal.aborted || current.current !== own) return
      setHeld((previous) => {
        if (outcome.ok) return { ...previous, loading: false, messages: outcome.messages, failure: undefined }
        // After the owner closed access the earlier messages are no longer shown.
        const closed = outcome.code === 'ketos/transcript-closed'
        return { ...previous, loading: false, messages: closed ? undefined : previous.messages, failure: outcome.code }
      })
    })
  }, [windowId, scope, fetchTranscript])

  const hide = useCallback(() => {
    current.current?.abort()
    setHeld({ ...COLLAPSED, scope })
  }, [scope])

  return {
    open: view.open,
    loading: view.loading,
    messages: view.messages,
    failure: view.failure,
    show: read,
    refresh: read,
    hide,
  }
}
