/**
 * Clone window bar: the Profile/Interview tab pair and the interview status the
 * clone window shows between its header and its body.
 *
 * The bar is the frame's only clone-specific chrome, and it alone subscribes to
 * the window channel and the clone roster: a streamed chunk republishes that
 * channel per frame, so keeping the subscription here leaves the memoized frame
 * chrome and its handles untouched.
 *
 * The interview tab presents the window's bound session; the profile tab keeps
 * editing the card. A clone that turns `ready` under a live interview has a
 * profile to review, and the review notice stays until the user opens it or
 * switches tabs.
 */
import { useEffect, useRef, useState } from 'react'
import { Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardWindowInjected, BoardWindowSessionState, BoardWindowState } from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'
import type { BoardTranslate } from '../locale.ts'
import css from './CloneWindowBar.module.css'

export interface CloneWindowBarProps {
  /** The clone window the bar decorates. */
  readonly window: BoardWindowState
  readonly actions: PropsStore<BoardStoreHandle>['actions']
  readonly t: BoardTranslate
  /** Per-window session channel; the bar is its only subscriber in the frame. */
  readonly useWindowSession: InjectFace<BoardWindowInjected>['useWindowSession']
  /** Clone roster the interview status and the review notice derive from. */
  readonly useCloneList: InjectFace<BoardWindowInjected>['useCloneList']
  /** Re-read the roster after an interview turn settles. */
  readonly refreshClones: InjectFace<BoardWindowInjected>['refreshClones']
}

/**
 * Count the human turns one interview transcript holds: every user message,
 * whether it opened a turn or steered a running one, is one exchange.
 * @param chat - the lane snapshot the window channel carries.
 * @returns the number of `user` and `steering` nodes.
 */
function exchangeCount(chat: BoardWindowSessionState['chat']): number {
  let count = 0
  for (const node of chat?.legacy.nodes ?? []) {
    if (node.kind === 'user' || node.kind === 'steering') count += 1
  }
  return count
}

/**
 * Render the clone window's tab bar and interview status.
 * @param props - the window, the board actions, the locale seat, and the injected clone hooks.
 * @returns the bar between the frame header and the body.
 */
export function CloneWindowBar({
  window: cardWindow, actions, t, useWindowSession, useCloneList, refreshClones,
}: CloneWindowBarProps) {
  const session = useWindowSession(cardWindow.id)
  const clone = useCloneList(roster => cardWindow.cloneId === undefined
    ? undefined
    : roster.clones.find(entry => entry.id === cardWindow.cloneId))
  const sessionId = session?.sessionId
  const [review, setReview] = useState(false)
  const running = session?.running ?? false
  const wasRunning = useRef(running)
  const previousStatus = useRef(clone?.status)

  // The interviewer saves the profile through clone_draft_save at the end of a
  // turn: the roster must be re-read when a turn settles, or the card would
  // keep showing the revision the interview started from.
  useEffect(() => {
    if (wasRunning.current && !running) refreshClones()
    wasRunning.current = running
  }, [running, refreshClones])

  // A clone that turned ready under a live interview has a profile to review;
  // leaving `ready` (a new interview, a hand edit) retires the notice.
  useEffect(() => {
    const status = clone?.status
    if (status !== 'ready') setReview(false)
    else if (previousStatus.current === 'interviewing' && sessionId !== undefined) setReview(true)
    previousStatus.current = status
  }, [clone?.status, sessionId])

  // The notice belongs to the view it was raised on, whoever switches it: the
  // bar's own tabs and the form's bound-session row both change the body.
  useEffect(() => { setReview(false) }, [cardWindow.bodyKind])

  const interviewing = clone?.status === 'interviewing' && sessionId !== undefined
  const bodyKind = cardWindow.bodyKind

  /** Point the window at one body; the notice belongs to the tab it was raised on. */
  const selectBody = (next: 'clone' | 'conversation'): void => {
    setReview(false)
    actions.setWindowBodyKind(cardWindow.id, next)
  }

  return (
    <div className={css.bar}>
      <div className={css.tabs} role="tablist">
        <Pill
          active={bodyKind !== 'conversation'}
          role="tab"
          aria-selected={bodyKind !== 'conversation'}
          data-board-clone-tab="profile"
          onClick={() => { selectBody('clone') }}
        >
          {t('clone.interview.profile')}
        </Pill>
        <Pill
          active={bodyKind === 'conversation'}
          role="tab"
          aria-selected={bodyKind === 'conversation'}
          disabled={sessionId === undefined}
          data-board-clone-tab="interview"
          className={css.interviewTab}
          onClick={() => { selectBody('conversation') }}
        >
          {t('clone.interview.tab')}
        </Pill>
      </div>

      {review && (
        <div className={css.interview} data-board-clone-interview="done">
          <span className={css.interviewText}>{t('clone.interview.done')}</span>
          <Pill
            data-board-clone-interview="review"
            onClick={() => { selectBody('clone') }}
          >
            {t('clone.interview.review')}
          </Pill>
        </div>
      )}

      {interviewing && (
        <div className={css.interview} data-board-clone-interview="active">
          <span className={css.interviewText}>{t('clone.interview.hint')}</span>
          <span className={css.hint}>
            {t('clone.interview.exchanges', { n: String(exchangeCount(session?.chat)) })}
          </span>
        </div>
      )}
    </div>
  )
}
