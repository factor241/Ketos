/**
 * Body of a dark window: the agent status line and the opening message. The
 * conversation lane mounts here.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ConversationBody.module.css'

export type ConversationBodyProps =
  PropsRuntime<'board.window.body'>
  & PropsLocale<'board'>

export function ConversationBody({ window: cardWindow, t }: ConversationBodyProps) {
  return (
    <>
      <div className={css.status}>
        {cardWindow.statusText ?? t('agent.statusReady')}
      </div>
      <div className={css.greeting}>
        {t('agent.greeting')}
      </div>
    </>
  )
}
