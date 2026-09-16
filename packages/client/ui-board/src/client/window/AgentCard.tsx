/**
 * Agent and clone window frame: the shared frame plus the chats-panel and
 * fullscreen controls. The body occupant renders the window's session.
 */
import { WindowFrame, type WindowFrameProps } from './WindowFrame.tsx'

/** Agent/clone chrome: the shared frame with the chats-panel and fullscreen controls. */
export type AgentCardProps = Omit<WindowFrameProps, 'features'>

export function AgentCard(props: AgentCardProps) {
  return <WindowFrame {...props} features={{ panel: true, fullscreen: true }} />
}
