/**
 * Spatial multi-window board slot contract.
 */
import type { ReactNode } from 'react'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Session-wide identity of one board window. */
export type WindowId = Branded<'BoardWindowId'>

/** Window category, selecting the `board.window` frame that renders it. */
export type WindowKind = 'agent' | 'connectors' | 'settings' | 'dashboard' | 'clone' | 'tasks'

/** Window content category, selecting the `board.window.body` occupant inside the frame. */
export type WindowBodyKind = 'conversation' | 'connectors' | 'settings' | 'dashboard' | 'clone' | 'clone-memory' | 'tasks'

/**
 * Layout and status fields for one window on the board canvas.
 * Position, size, and stack order are board-local view state, not session data.
 */
export interface BoardWindowState {
  id: WindowId
  kind: WindowKind
  /** Body presented inside the frame; switching it swaps the rendered content. */
  bodyKind: WindowBodyKind
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

/**
 * Render the body slot occurrence for one window. The windows layer owns the
 * `board.window.body` declaration, so its frames receive this dispatcher as an
 * owner prop instead of a `renderSlot` seat of their own.
 */
export type RenderWindowBody = (window: BoardWindowState) => ReactNode

/**
 * Owner props of one keyed `board.window` slot instance.
 * @param window - the window state the frame renders.
 * @param renderBody - body dispatcher bound to the declaring windows layer.
 */
export interface BoardWindowOwnerProps {
  window: BoardWindowState
  renderBody: RenderWindowBody
}

/**
 * Owner props of one keyed `board.window.body` slot instance.
 * @param window - the window state whose `bodyKind` selected this occupant.
 */
export interface BoardWindowBodyOwnerProps {
  window: BoardWindowState
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Root container of the spatial board canvas; renders the floating layers. */
    'board.canvas': { kind: 'single'; scope: 'root' }
    /** Left floating rail showing active sessions / windows. */
    'board.dock': { kind: 'single'; scope: 'root' }
    /** Multi-window layer inside the canvas transform; renders the keyed window slots. */
    'board.windows': { kind: 'single'; scope: 'root' }
    /**
     * Window container for a single board card. The owner share is the same for
     * every kind; the keyed table is what closes the dispatch domain to
     * `WindowKind`.
     */
    'board.window': {
      kind: 'keyed'
      scope: 'root'
      owner: BoardWindowOwnerProps
      keyProps: { [Key in WindowKind]: BoardWindowOwnerProps }
    }
    /**
     * Window content inside one board card, declared by the windows layer. The
     * owner share is the same for every body kind; the keyed table is what
     * closes the dispatch domain to `WindowBodyKind`.
     */
    'board.window.body': {
      kind: 'keyed'
      scope: 'root'
      owner: BoardWindowBodyOwnerProps
      keyProps: { [Key in WindowBodyKind]: BoardWindowBodyOwnerProps }
    }
    /** Bottom-right interactive SVG minimap. */
    'board.minimap': { kind: 'single'; scope: 'root' }
    /** Floating center omnibox. */
    'board.omnibar': { kind: 'single'; scope: 'root' }
  }
}
