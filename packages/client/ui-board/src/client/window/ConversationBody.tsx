/**
 * Body of a dark window: the agent status line and the opening message. This
 * is the stage-6 seam where the real conversation lane mounts.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

export type ConversationBodyProps =
  PropsRuntime<'board.window.body'>
  & PropsLocale<'board'>

export function ConversationBody({ window: cardWindow, t }: ConversationBodyProps) {
  return (
    <>
      <div style={{ color: '#8F8E94', marginBottom: 8, fontSize: 12 }}>
        {cardWindow.statusText ?? t('agent.statusReady')}
      </div>
      <div style={{ background: '#222126', borderRadius: 10, padding: '12px', border: '1px solid #323037' }}>
        {t('agent.greeting')}
      </div>
    </>
  )
}
