/**
 * Card of a foreign agent window: the owner, the age of the last change, and
 * a read-only transcript the receiver expands on request. The frame header
 * above it names the window and its status, so the card does not repeat them.
 *
 * The card has no input, no composer, and no owner control; the transcript is
 * plain text read from the owning Ketos on demand and re-read only when the
 * receiver presses Refresh.
 */
import { useLayoutEffect, useRef } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranscriptMessage } from '@ketos/peer/types'
import type { BoardForeignInjected, BoardTranscriptFailureCode } from '../contract/slots.ts'
import type { BoardTranslate } from '../locale.ts'
import { participantLabel, participantOf } from '../owners.ts'
import { relativeAge } from '../relative-age.ts'
import { useAgeClock } from '../use-age-clock.ts'
import type { BoardStoreHandle } from '../store.ts'
import { ForeignUpdated } from './ForeignUpdated.tsx'
import { useForeignTranscript } from './use-foreign-transcript.ts'
import css from './ForeignChatCard.module.css'

export type ForeignChatCardProps =
  PropsRuntime<'board.foreign.window.body', 'agent'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>
  & InjectFace<BoardForeignInjected>

/** Caption key of each failed transcript read. */
const FAILURE_KEYS = {
  'ketos/transcript-closed': 'foreign.transcript.closed',
  'ketos/peer-offline': 'foreign.transcript.offline',
  'ketos/peer-timeout': 'foreign.transcript.timeout',
  'ketos/window-not-found': 'foreign.transcript.notfound',
  'ketos/unreachable': 'foreign.transcript.error',
} as const satisfies Record<BoardTranscriptFailureCode, Parameters<BoardTranslate>[0]>

/**
 * Messages of one transcript, oldest first, as plain text, scrolled to the
 * newest. The list owns the age clock, so the message times follow wall time
 * while the list is open.
 * @param props - the messages and the translator.
 * @returns the scrolling list.
 */
function TranscriptList({ messages, t }: { readonly messages: readonly TranscriptMessage[]; readonly t: BoardTranslate }) {
  useAgeClock()
  const listRef = useRef<HTMLOListElement>(null)
  // Messages run oldest first, so each new list opens at the newest one.
  useLayoutEffect(() => {
    const list = listRef.current
    /* v8 ignore next -- the ref is attached by layout time. */
    if (list === null) return
    list.scrollTop = list.scrollHeight
  }, [messages])
  return (
    <ol
      ref={listRef}
      role="list"
      tabIndex={0}
      aria-label={t('foreign.transcript.aria')}
      data-board-wheel="native"
      className={css.list}
    >
      {messages.map((message, index) => (
        // The log has no message ids; the list is replaced whole on every read.
        <li key={index} data-board-transcript-message={message.role} className={css.message}>
          <span className={css.meta}>
            <span className={css.role}>
              {t(message.role === 'user' ? 'foreign.transcript.user' : 'foreign.transcript.agent')}
            </span>
            <time dateTime={message.at}>{relativeAge(message.at, t)}</time>
          </span>
          <span data-board-transcript-text="" dir="auto" className={css.text}>{message.text}</span>
        </li>
      ))}
    </ol>
  )
}

/**
 * Render the card of one foreign agent window.
 * @param props - the published record, the store seats, the translator, and the transcript read.
 * @returns the owner and age lines and, for a record with a session, the transcript controls.
 */
export function ForeignChatCard({ record, t, useStore, fetchTranscript }: ForeignChatCardProps) {
  const ownerName = useStore(s => participantLabel(t, participantOf(s, record.ownerId)))
  const sessionId = record.sessionId
  const transcript = useForeignTranscript(
    record.id,
    sessionId === undefined ? undefined : `${record.id}:${sessionId}`,
    fetchTranscript,
  )
  const { messages, failure } = transcript
  // One live region announces both the loading state and a failure; its text
  // changes in place, so assistive technology reads each change.
  let status = ''
  if (transcript.loading) status = t('foreign.transcript.loading')
  else if (failure !== undefined) status = t(FAILURE_KEYS[failure])

  return (
    <section data-board-foreign-card="agent" className={css.card}>
      <div className={css.facts}>
        <span data-board-foreign-owner="" className={css.fact}>{t('foreign.card.owner', { name: ownerName })}</span>
        <ForeignUpdated record={record} t={t} className={css.fact} />
      </div>
      {sessionId !== undefined && (
        <div className={css.actions}>
          <Button
            size="sm"
            variant="outline"
            aria-expanded={transcript.open}
            data-board-action="foreign-transcript-toggle"
            onClick={transcript.open ? transcript.hide : transcript.show}
          >
            {t(transcript.open ? 'foreign.transcript.hide' : 'foreign.transcript.show')}
          </Button>
          {transcript.open && (
            <Button
              size="sm"
              variant="outline"
              aria-disabled={transcript.loading}
              data-board-action="foreign-transcript-refresh"
              onClick={transcript.loading ? undefined : transcript.refresh}
            >
              {t('foreign.transcript.refresh')}
            </Button>
          )}
          <span
            role="status"
            data-board-transcript-failure={transcript.loading ? undefined : failure}
            className={css.status}
          >
            {status}
          </span>
        </div>
      )}
      {sessionId !== undefined && transcript.open && (
        <div className={css.transcript} aria-busy={transcript.loading}>
          {messages !== undefined && messages.length === 0 && failure === undefined && (
            <p className={css.empty}>{t('foreign.transcript.empty')}</p>
          )}
          {messages !== undefined && messages.length > 0 && <TranscriptList messages={messages} t={t} />}
        </div>
      )}
    </section>
  )
}
