/**
 * Board-owned window opening: the templates the dock and omnibar dispatch, with
 * the store's placement and id minting, plus the shared rule both the Omnibox
 * and the inspector use to address the window a user-facing command acts on.
 */
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardWindowState, WindowId } from './contract/slots.ts'
import { BOARD_WINDOW_TEMPLATES, mintWindowId, nextWindowOrdinal, type BoardStoreHandle } from './store.ts'

/** The shared store's baked action face, as every board registration receives it. */
export type BoardActions = PropsStore<BoardStoreHandle>['actions']

/**
 * Open one of the board's own window templates on top of the stack.
 * @param actions - the shared board store's action face.
 * @param template - template to open from {@link BOARD_WINDOW_TEMPLATES}.
 * @param ordinal - launch ordinal the localized template name is built from.
 * @returns the minted identity of the opened window.
 */
export function openBoardWindow(
  actions: BoardActions,
  template: keyof typeof BOARD_WINDOW_TEMPLATES,
  ordinal: number,
): WindowId {
  const spec = BOARD_WINDOW_TEMPLATES[template]
  const id = mintWindowId(spec.kind)
  actions.openWindow({
    id,
    ...spec,
    ordinal,
  })
  return id
}

/**
 * The chat window a board-chrome command acts on: the active window while it is
 * a chat window, otherwise a fresh agent window. Both the Omnibox's send and
 * the inspector's chip use this rule, so neither surface invents its own
 * fallback.
 * @param actions - the shared board store's action face.
 * @param windows - the board's window map, for the ordinal and the active state.
 * @param activeWindowId - the window the board currently focuses.
 * @returns the identity of the window the command addresses.
 */
export function resolveChatWindow(
  actions: BoardActions,
  windows: Record<string, BoardWindowState>,
  activeWindowId: WindowId | null,
): WindowId {
  const active = activeWindowId === null ? undefined : windows[activeWindowId as string]
  if (active !== undefined && (active.kind === 'agent' || active.kind === 'clone')) return active.id
  return openBoardWindow(actions, 'agent', nextWindowOrdinal(windows))
}
