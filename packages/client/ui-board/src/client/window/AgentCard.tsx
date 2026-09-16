/**
 * Agent and clone window frame: the shared frame plus the chats-panel and
 * fullscreen controls. The body occupant renders the window's session.
 */
import { WindowFrame, type WindowFrameProps } from './WindowFrame.tsx'

/** Agent/clone chrome: the shared frame with the chats-panel and fullscreen controls. */
export type AgentCardProps = Omit<WindowFrameProps, 'features'>

/** Module-level features so the memoized frame keeps a stable props identity. */
const AGENT_FEATURES = { panel: true, fullscreen: true } as const

export function AgentCard(props: AgentCardProps) {
  return <WindowFrame {...props} features={AGENT_FEATURES} />
}
