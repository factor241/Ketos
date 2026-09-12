/**
 * Spatial Multi-Window Board Client Plugin.
 * Registers the 'board' main panel and sidebar.panellist icon into DeepSeek Harness.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { createBoardStore } from './store.ts'
import { BoardRoot, BoardIcon } from './BoardViews.tsx'
import './tokens.css'

export type { WindowId, BoardWindowState } from './contract/slots.ts'
export { createBoardStore } from './store.ts'
export type { BoardState } from './store.ts'

export const inject = ['slots', 'layout']

/**
 * Mounts the Spatial Board plugin into DeepSeek Harness slots.
 */
export function apply(ctx: ClientContext): void {
  const boardStore = createBoardStore()

  // 1. Register main panel body
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: 'board',
    store: boardStore,
  }, BoardRoot))

  // 2. Register icon in sidebar panel list
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: 'board',
    order: 15,
    label: 'Board',
  }, BoardIcon))
}
