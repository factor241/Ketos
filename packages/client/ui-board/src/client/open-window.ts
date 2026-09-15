/**
 * Board-owned window opening: the templates the dock and omnibar dispatch, with
 * the store's placement and id minting.
 */
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { BOARD_WINDOW_TEMPLATES, mintWindowId, type BoardStoreHandle, type OpenWindowSpec } from './store.ts'

/** The shared store's baked action face, as every board registration receives it. */
export type BoardActions = PropsStore<BoardStoreHandle>['actions']

/**
 * Open one of the board's own window templates on top of the stack.
 * @param actions - the shared board store's action face.
 * @param template - template to open from {@link BOARD_WINDOW_TEMPLATES}.
 * @param title - localized window title.
 * @param status - optional status caption carried into the new window.
 */
export function openBoardWindow(
  actions: BoardActions,
  template: keyof typeof BOARD_WINDOW_TEMPLATES,
  title: string,
  status?: Pick<OpenWindowSpec, 'status' | 'statusText'>,
): void {
  const spec = BOARD_WINDOW_TEMPLATES[template]
  actions.openWindow({
    id: mintWindowId(spec.kind),
    ...spec,
    title,
    ...status,
  })
}
