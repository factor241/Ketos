/**
 * Spatial Multi-Window Board Client Plugin.
 * Registers the 'board' main panel, its layer/frame/body occupants, and the
 * sidebar.panellist icon into DeepSeek Harness.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { createBoardStore } from './store.ts'
import { BoardRoot, BoardIcon } from './BoardViews.tsx'
import { DashboardCanvas } from './canvas/DashboardCanvas.tsx'
import { BoardWindowLayer } from './canvas/BoardWindowLayer.tsx'
import { Minimap } from './canvas/Minimap.tsx'
import { AgentCard } from './window/AgentCard.tsx'
import { ToolWindow } from './window/ToolWindow.tsx'
import { ConversationBody } from './window/ConversationBody.tsx'
import { SessionRail } from './dock/SessionRail.tsx'
import { DashboardToolbar } from './omnibox/DashboardToolbar.tsx'
import { NS, en, zh } from './locale.ts'

export type { WindowId, WindowKind, WindowBodyKind, BoardWindowState } from './contract/slots.ts'
export type { BoardKey } from './locale.ts'
export { createBoardStore } from './store.ts'
export type { BoardState, BoardStoreHandle, OpenWindowSpec } from './store.ts'

/** Services required by the board plugin: slot registration and copy. */
export const inject = ['slots', 'locale']

/**
 * Register the board main panel, its sidebar panel-list entry, and the
 * `board.*` layer, frame, and body occupants that compose the canvas.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const boardStore = createBoardStore()

  // Dictionary registration + bound `t` for the registration-time sidebar label.
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-board: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: 'board',
    store: boardStore,
    locale: NS,
    children: {
      'board.canvas': { kind: 'single', scope: 'root' },
      'board.dock': { kind: 'single', scope: 'root' },
      'board.omnibar': { kind: 'single', scope: 'root' },
      'board.minimap': { kind: 'single', scope: 'root' },
    },
  }, BoardRoot))

  ctx.slots.inject('board.canvas', () => ctx.slots.register({
    name: 'board.canvas',
    store: boardStore,
    children: { 'board.windows': { kind: 'single', scope: 'root' } },
  }, DashboardCanvas))

  // 3. Window layer: declares the keyed window and window-body seats; its
  //    `renderBody` dispatcher reaches every frame through owner props.
  ctx.slots.inject('board.windows', () => ctx.slots.register({
    name: 'board.windows',
    store: boardStore,
    children: {
      'board.window': { kind: 'keyed', scope: 'root' },
      'board.window.body': { kind: 'keyed', scope: 'root' },
    },
  }, BoardWindowLayer))

  // Window frames: one registration per window type, not per window.
  ctx.slots.inject('board.window', function* () {
    yield ctx.slots.register({ name: 'board.window', key: 'agent', store: boardStore, locale: NS }, AgentCard)
    yield ctx.slots.register({ name: 'board.window', key: 'clone', store: boardStore, locale: NS }, AgentCard)
    yield ctx.slots.register({ name: 'board.window', key: 'connectors', store: boardStore, locale: NS }, ToolWindow)
    yield ctx.slots.register({ name: 'board.window', key: 'settings', store: boardStore, locale: NS }, ToolWindow)
    yield ctx.slots.register({ name: 'board.window', key: 'dashboard', store: boardStore, locale: NS }, ToolWindow)
    yield ctx.slots.register({ name: 'board.window', key: 'tasks', store: boardStore, locale: NS }, ToolWindow)
  })

  // Only the conversation body ships today: no board window presents mock
  // tool or settings content, and the stages that own those surfaces register
  // their own bodies.
  ctx.slots.inject('board.window.body', function* () {
    yield ctx.slots.register({ name: 'board.window.body', key: 'conversation', locale: NS }, ConversationBody)
  })

  ctx.slots.inject('board.dock', () => ctx.slots.register({
    name: 'board.dock',
    store: boardStore,
    locale: NS,
  }, SessionRail))

  ctx.slots.inject('board.omnibar', () => ctx.slots.register({
    name: 'board.omnibar',
    store: boardStore,
    locale: NS,
  }, DashboardToolbar))

  ctx.slots.inject('board.minimap', () => ctx.slots.register({
    name: 'board.minimap',
    store: boardStore,
  }, Minimap))

  // Sidebar panel-list icon (thunked label follows the active locale)
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: 'board',
    order: 15,
    label: () => t('sidebar.panel'),
  }, BoardIcon))
}
