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
// Type-only: the ctx.settingsScope merge and the shared describe mirror the
// layout persistence reads through.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createBoardStore, type BoardStoreHandle } from './store.ts'
import { BoardLayoutPersistence } from './board-persistence.ts'
import { BoardSessionBridge } from './session-bridge.ts'
import { resolveChatWindow } from './open-window.ts'
import type { BoardWindowInjected, WindowId } from './contract/slots.ts'
import { BoardRoot, BoardIcon } from './BoardViews.tsx'
import { DashboardCanvas } from './canvas/DashboardCanvas.tsx'
import { BoardWindowLayer } from './canvas/BoardWindowLayer.tsx'
import { Minimap } from './canvas/Minimap.tsx'
import { AgentCard } from './window/AgentCard.tsx'
import { WindowFrame } from './window/WindowFrame.tsx'
import { ConversationBody } from './window/ConversationBody.tsx'
import { SessionRail } from './dock/SessionRail.tsx'
import { DashboardToolbar } from './omnibox/DashboardToolbar.tsx'
import { WindowChatsPanel } from './window/WindowChatsPanel.tsx'
import { NS, en, zh } from './locale.ts'

export type {
  BoardWindowInjected, BoardWindowSessionState,
  WindowId, WindowKind, WindowBodyKind, BoardWindowState,
} from './contract/slots.ts'
export type { BoardKey } from './locale.ts'
export { createBoardStore } from './store.ts'
export type { BoardState, BoardStoreHandle, BoardStoreInstance, OpenWindowSpec } from './store.ts'

/** Services required by the board plugin: slots, copy, uploads, settings, and the session domain. */
export const inject = [
  'slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace', 'uiConversation', 'modelDirectories',
  'fileUpload', 'settingsScope',
  'remote', 'remote.settings', 'remote.commands', 'remote.agentPresets', 'remote.goals',
  'remote.fileReferences', 'remote.sessionReferenceResolver',
]

/**
 * Register the board main panel, its sidebar panel-list entry, and the
 * `board.*` layer, frame, and body occupants that compose the canvas.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  // One live instance backs every registration: the handle handed to the slot
  // seat answers every create() with the same instance, so the persistence
  // layer and the components observe one store.
  const handle = createBoardStore()
  const instance = handle.create()
  const boardStore: BoardStoreHandle = { ...handle, create: () => instance }
  // The shared describe mirror is the one settings reader in the browser; the
  // board derives from it so startup costs no extra settings/describe call.
  const persistence = new BoardLayoutPersistence(ctx, ctx.settingsScope.describe(), instance)

  // Window sessions: one bridge per plugin fiber, one channel per window. The
  // bridge's bindings map is the second half of the stored settings section.
  const bridge = new BoardSessionBridge(ctx, {
    persistBindings: (bindings) => { persistence.writeBindings(bindings) },
  })
  ctx.effect(() => () => { bridge.dispose() }, 'ui-board: window session bridge')

  // Restore: every adopted section — the first-frame cache before the first
  // render, the server document when the mirror answers — hands its bindings
  // to the bridge, which points the restored windows at their sessions.
  persistence.onAdopt((settings) => {
    bridge.restore(settings.bindings, Object.keys(instance.getSnapshot().windows) as WindowId[])
  })
  persistence.hydrateFromCache()

  // Dictionary registration + bound `t` for the registration-time sidebar label.
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-board: dictionaries')
  const t = ctx.locale.bind(NS)

  // Durable settings: follow the store and the bindings, write them back
  // debounced under the settings revision, and adopt the server section once
  // the mirror answers.
  ctx.effect(() => {
    persistence.start()
    return () => { persistence.dispose() }
  }, 'ui-board: settings persistence')
  const windowSession = (key: string) => bridge.channel(key as WindowId)
  const injected = (): BoardWindowInjected => ({
    keyedHooks: { windowSession },
    hooks: {
      sessionList: ctx.sessions.list,
      workspaceList: ctx.workspaces.list,
    },
    ensureWindowSession: (windowId) => { bridge.ensure(windowId) },
    releaseWindow: (windowId) => { bridge.release(windowId) },
    bindSession: (windowId, sessionId) => {
      const outcome = bridge.bind(windowId, sessionId)
      // One session, one window: a chat another window shows is not rebound
      // here; that window comes forward instead.
      if (outcome.kind === 'duplicate') instance.actions.centerOnWindow(outcome.windowId)
      return outcome
    },
    openChat: (sessionId) => {
      const holder = bridge.windowFor(sessionId)
      if (holder !== undefined) {
        instance.actions.centerOnWindow(holder)
        return { kind: 'duplicate', windowId: holder }
      }
      // A chat the list no longer holds must not open a window of its own.
      if (ctx.sessions.list.getSnapshot().byId[sessionId] === undefined) return { kind: 'unknown' }
      const state = instance.getSnapshot()
      const target = resolveChatWindow(instance.actions, state.windows, state.activeWindowId)
      const outcome = bridge.bind(target, sessionId)
      if (outcome.kind !== 'unknown') instance.actions.centerOnWindow(target)
      return outcome
    },
    sendPrompt: (windowId, text, mode, images, files, signal) =>
      bridge.send(windowId, text, mode, images, files, signal),
    cancelPrompt: (windowId) => { bridge.cancel(windowId) },
    loadOlderTurns: (windowId) => { bridge.loadOlder(windowId) },
    createChat: (windowId, target) => { bridge.createChat(windowId, target) },
    startChat: (windowId, workspaceId) => bridge.startChat(windowId, workspaceId),
    renameChat: (sessionId, title) => bridge.renameChat(sessionId, title),
    forkChat: (windowId, sessionId) => bridge.forkChat(windowId, sessionId),
    archiveChat: sessionId => bridge.archiveChat(sessionId),
    reorderChat: (workspaceId, sessionId, beforeSessionId) => bridge.reorderChat(workspaceId, sessionId, beforeSessionId),
    createWorkspace: path => bridge.createWorkspace(path),
    renameWorkspace: (workspaceId, title) => bridge.renameWorkspace(workspaceId, title),
    deleteWorkspace: workspaceId => bridge.deleteWorkspace(workspaceId),
    reorderWorkspace: (workspaceId, beforeWorkspaceId) => bridge.reorderWorkspace(workspaceId, beforeWorkspaceId),
    listDirectory: path => bridge.listDirectory(path),
    createDirectory: (path, name) => bridge.createDirectory(path, name),
    pickDirectory: () => bridge.pickDirectory(),
    selectAgentPreset: (windowId, presetId) => { bridge.selectAgentPreset(windowId, presetId) },
    selectPermission: (windowId, presetId) => { bridge.selectPermission(windowId, presetId) },
    selectModel: (windowId, selection) => { bridge.selectModel(windowId, selection) },
    exitPlanMode: (windowId) => { bridge.exitPlanMode(windowId) },
    runCommand: (windowId, line) => { bridge.runCommand(windowId, line) },
    executeCommand: (windowId, line, images, files) => { bridge.executeCommand(windowId, line, images, files) },
    uploadFile: (windowId, name, bytes) => bridge.uploadFile(windowId, name, bytes),
    updateQueueItem: (windowId, itemId, action) => { bridge.updateQueueItem(windowId, itemId, action) },
    loadQueueImage: (windowId, attachment) => bridge.loadQueueImage(windowId, attachment),
    goalAction: (windowId, action) => { bridge.goalAction(windowId, action) },
    loadMentions: (windowId, query, signal) => bridge.loadMentions(windowId, query, signal),
  })

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
    inject: injected,
    children: {
      'board.window': { kind: 'keyed', scope: 'root' },
      'board.window.body': { kind: 'keyed', scope: 'root' },
      'board.window.panel': { kind: 'keyed', scope: 'root' },
    },
  }, BoardWindowLayer))

  // Window frames: one registration per window type, not per window. Every frame
  // reads its window's channel for the chat title; the header rename and the
  // body dispatcher ride the same inject face.
  ctx.slots.inject('board.window', function* () {
    yield ctx.slots.register({ name: 'board.window', key: 'agent', store: boardStore, locale: NS, inject: injected }, AgentCard)
    yield ctx.slots.register({ name: 'board.window', key: 'clone', store: boardStore, locale: NS, inject: injected }, AgentCard)
    yield ctx.slots.register({ name: 'board.window', key: 'connectors', store: boardStore, locale: NS, inject: injected }, WindowFrame)
    yield ctx.slots.register({ name: 'board.window', key: 'settings', store: boardStore, locale: NS, inject: injected }, WindowFrame)
    yield ctx.slots.register({ name: 'board.window', key: 'dashboard', store: boardStore, locale: NS, inject: injected }, WindowFrame)
    yield ctx.slots.register({ name: 'board.window', key: 'tasks', store: boardStore, locale: NS, inject: injected }, WindowFrame)
  })

  // Chats panel: one occupant serves every chat window, like the frame table.
  ctx.slots.inject('board.window.panel', function* () {
    yield ctx.slots.register({ name: 'board.window.panel', key: 'agent', store: boardStore, locale: NS, inject: injected }, WindowChatsPanel)
    yield ctx.slots.register({ name: 'board.window.panel', key: 'clone', store: boardStore, locale: NS, inject: injected }, WindowChatsPanel)
  })

  // Only the conversation body ships today: no board window presents mock
  // tool or settings content, and the stages that own those surfaces register
  // their own bodies.
  ctx.slots.inject('board.window.body', function* () {
    yield ctx.slots.register({
      name: 'board.window.body',
      key: 'conversation',
      store: boardStore,
      locale: NS,
      inject: injected,
    }, ConversationBody)
  })

  ctx.slots.inject('board.dock', () => ctx.slots.register({
    name: 'board.dock',
    store: boardStore,
    locale: NS,
    inject: injected,
  }, SessionRail))

  ctx.slots.inject('board.omnibar', () => ctx.slots.register({
    name: 'board.omnibar',
    store: boardStore,
    locale: NS,
    inject: injected,
  }, DashboardToolbar))

  ctx.slots.inject('board.minimap', () => ctx.slots.register({
    name: 'board.minimap',
    store: boardStore,
    locale: NS,
  }, Minimap))

  // Sidebar panel-list icon (thunked label follows the active locale)
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: 'board',
    order: 15,
    label: () => t('sidebar.panel'),
  }, BoardIcon))
}
