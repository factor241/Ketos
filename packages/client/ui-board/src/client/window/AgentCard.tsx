/**
 * Agent and clone window frame: the shared frame plus the chats-panel control,
 * and the expand-to-standard control on chat windows only (Т2.3). The body
 * occupant renders the window's session.
 */
import { WindowFrame, type WindowFrameProps } from './WindowFrame.tsx'

/** Agent/clone chrome: the shared frame with the chats-panel control. */
export type AgentCardProps = Omit<WindowFrameProps, 'features'>

/** Module-level features so the memoized frame keeps a stable props identity. */
const AGENT_FEATURES = { panel: true, fullscreen: true } as const
const CLONE_FEATURES = { panel: true } as const

export function AgentCard(props: AgentCardProps) {
  return <WindowFrame {...props} features={props.window.kind === 'agent' ? AGENT_FEATURES : CLONE_FEATURES} />
}
