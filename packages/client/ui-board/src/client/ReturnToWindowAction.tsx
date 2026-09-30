/**
 * The standard interface's way back to the board (Т2.11): one control in the
 * Session header's utility row, shown while the current Session is bound to
 * an open board window. It selects the board panel, centres that window, and
 * hands the standard composer's draft back to the window's own draft; a
 * composer that cannot give the draft up still returns, and the window
 * reports that the draft stayed behind.
 */
import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { BoardIcon } from './BoardViews.tsx'
import type { WindowId } from './contract/slots.ts'
import css from './ReturnToWindowAction.module.css'

/** Injected share of the return control: the live binding lookup and the action. */
export interface ReturnToWindowActionInjected {
  /** Subscribe to binding changes (the uSES pair with {@link bindingRevision}). */
  readonly subscribeBindings: (listener: () => void) => () => void
  /** Binding revision snapshot, read by the uSES pair. */
  readonly bindingRevision: () => number
  /** The window currently showing one Session, or undefined when none does. */
  readonly windowForSession: (sessionId: SessionId) => WindowId | undefined
  /** Return to the window: take the draft, select the board, centre and highlight it (Т2.11–Т2.13). */
  readonly returnToWindow: (sessionId: SessionId, windowId: WindowId) => void
}

/** Props of the Session-header return control. */
export type ReturnToWindowActionProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & InjectFace<ReturnToWindowActionInjected>
  & PropsLocale<'board'>

/**
 * The return control: nothing while the current Session is not bound to a
 * board window (Т2.15 — a brand-new Session has no window yet), one button
 * otherwise. The binding map lives in the board's bridge, so the button
 * subscribes to its revision and a Session the binding rules just adopted
 * appears without a re-mount.
 */
export function ReturnToWindowAction({
  sessionId, subscribeBindings, bindingRevision, windowForSession, returnToWindow, t,
}: ReturnToWindowActionProps): ReactNode {
  useSyncExternalStore(subscribeBindings, bindingRevision)
  const windowId = windowForSession(sessionId)
  if (windowId === undefined) return null
  const label = t('return.toWindow')
  return (
    <Tooltip label={label} side="bottom" delayMs={500}>
      <button
        type="button"
        className={css.button}
        aria-label={label}
        data-board-action="return-to-window"
        onClick={() => { returnToWindow(sessionId, windowId) }}
      >
        <BoardIcon size={15} />
      </button>
    </Tooltip>
  )
}
