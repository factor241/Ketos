/**
 * Spatial Multi-Window Board Client Plugin.
 * Registers the 'board' main panel and sidebar.panellist icon into DeepSeek Harness.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { createBoardStore } from './store.ts'
import { BoardRoot, BoardIcon } from './BoardViews.tsx'
import { NS, en, zh } from './locale.ts'

export type { WindowId, BoardWindowState } from './contract/slots.ts'
export type { BoardKey } from './locale.ts'
export { createBoardStore } from './store.ts'
export type { BoardState } from './store.ts'

/** Services required by the board plugin: slot registration and copy. */
export const inject = ['slots', 'locale']

/**
 * Register the board main panel and its sidebar panel-list entry.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const boardStore = createBoardStore()

  // Dictionary registration + bound `t` for the registration-time sidebar label.
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-board: dictionaries')
  const t = ctx.locale.bind(NS)

  // 1. Register main panel body
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: 'board',
    store: boardStore,
    locale: NS,
  }, BoardRoot))

  // 2. Register icon in sidebar panel list (thunked label follows the active locale)
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: 'board',
    order: 15,
    label: () => t('sidebar.panel'),
  }, BoardIcon))
}
