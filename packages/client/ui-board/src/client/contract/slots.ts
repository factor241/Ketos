/**
 * Spatial multi-window board slot contract.
 */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export type WindowId = Branded<'BoardWindowId'>

export type WindowKind = 'agent' | 'connectors' | 'settings' | 'dashboard'

export interface BoardWindowState {
  id: WindowId
  kind: WindowKind
  title: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  sessionId?: SessionId
  status?: 'idle' | 'running' | 'done' | 'error'
  statusText?: string
  contextUsed?: {
    usedTokens: number
    maxTokens: number
    percent: number
  }
}

export interface BoardWindowOwnerProps {
  window: BoardWindowState
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Root container of the spatial board canvas. */
    'board.canvas': { kind: 'single'; scope: 'root' }
    /** Left floating rail showing active sessions / windows. */
    'board.dock': { kind: 'single'; scope: 'root' }
    /** Multi-window layer rendering individual cards and dialogs. */
    'board.windows': { kind: 'single'; scope: 'root' }
    /** Window container for a single board card. */
    'board.window': { kind: 'keyed'; scope: 'root'; keyProps: { [key: string]: BoardWindowOwnerProps } }
    /** Bottom-right interactive SVG minimap. */
    'board.minimap': { kind: 'single'; scope: 'root' }
    /** Floating center omnibox. */
    'board.omnibar': { kind: 'single'; scope: 'root' }
  }
}
