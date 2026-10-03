/**
 * Spatial Multi-Window Board Client Plugin.
 * Registers the 'board' main panel, its layer/frame/body occupants, and the
 * interface switch in the sidebar brand row into DeepSeek Harness.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the ctx.settingsScope merge and the shared describe mirror the
// layout persistence reads through.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionInput, TakenDraft } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import z from '@deepseek-ai/schemastery'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { presetDisplayText } from '@deepseek-ai/dsh-agent-preset-registry/display'
import type {
  CloneDto, CloneId, CloneSessionBinding, CloneUpdatePatch, MemoryId, MemoryStatus, MemoryUpdatePatch, TaskId,
} from '@ketos/clone-core/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { BOARD_ZOOM_MIN } from '../board-settings.ts'
import { createBoardStore, nextWindowOrdinal, type BoardStoreHandle, type BoardWindowDraftFile } from './store.ts'
import { BoardLayoutPersistence } from './board-persistence.ts'
import { BoardSessionBridge } from './session-bridge.ts'
import { openBoardWindow, resolveChatWindow } from './open-window.ts'
import { BOARD_PANEL_ID } from './contract/slots.ts'
import {
  bindSessionToClone, createClone as createCloneRequest, deleteClone as deleteCloneRequest,
  listCloneSessions, listClones, updateClone as updateCloneRequest,
} from './clone-api.ts'
import { parseModelRoute } from './clone-model.ts'
import {
  deleteMemory as deleteMemoryRequest, listMemories, searchMemories, updateMemory as updateMemoryRequest,
} from './memory-api.ts'
import {
  cancelTask as cancelTaskRequest, createTask as createTaskRequest, listTasks,
  startTask as startTaskRequest,
} from './tasks-api.ts'
import { sessionArtifacts } from './window/artifacts-model.ts'
import type {
  BoardCloneRoster, BoardDraftImage, BoardPresetRoster, BoardTaskOutcome, BoardTaskProgress, BoardTaskRoster,
  BoardWindowInjected, CloneModelOption, WindowId,
} from './contract/slots.ts'
import { BoardRoot, BoardToggle, type BoardRootInjected, type BoardToggleInjected } from './BoardViews.tsx'
import { ReturnToWindowAction, type ReturnToWindowActionInjected } from './ReturnToWindowAction.tsx'
import type { BoardWheelMode } from './wheel-zoom.ts'
import { DashboardCanvas } from './canvas/DashboardCanvas.tsx'
import { BoardWindowLayer } from './canvas/BoardWindowLayer.tsx'
import { Minimap } from './canvas/Minimap.tsx'
import { AgentCard } from './window/AgentCard.tsx'
import { WindowFrame } from './window/WindowFrame.tsx'
import { ConversationBody } from './window/ConversationBody.tsx'
import { CloneBody } from './window/CloneBody.tsx'
import { CloneMemoryBody } from './window/CloneMemoryBody.tsx'
import { TasksBody } from './window/TasksBody.tsx'
import { MvpUnavailableBody } from './window/MvpUnavailableBody.tsx'
import { SessionRail } from './dock/SessionRail.tsx'
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
  'slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace', 'uiConversation', 'conversation', 'modelDirectories', 'layout',
  'fileUpload', 'settingsScope', 'documentPreviews',
  'remote', 'remote.settings', 'remote.commands', 'remote.agentPresets', 'remote.goals',
  'remote.fileReferences', 'remote.sessionReferenceResolver', 'remote.workspaceFiles',
  // The per-session model directory resolves the host catalog through the
  // caller's context (ui-model-selection tracks the caller), so the board must
  // declare the namespace it makes the service read.
  'remote.session',
]

/** Board runtime configuration. */
export interface Config {
  /** What an unmodified wheel does over the canvas and the floating chrome (R-4). */
  wheelMode?: BoardWheelMode
  /** Exponential zoom sensitivity `k` (`factor = exp(−Δ·k)`). */
  zoomSensitivity?: number
  /** Zoom below which windows render their simplified card (R-6). */
  detailZoomThreshold?: number
}

/**
 * Validated board runtime configuration. The default `k = 0.0023 ≈ ln 2 / 300`
 * makes a fingertip-to-palm pinch (≈300 CSS px at 96 dpi) change the scale
 * about twofold, while one 100px mouse notch stays a small step. The default
 * detail threshold 0.4 (R-6) sits above the 0.2 minimum zoom, so the
 * simplified view covers the lowest quarter of the range.
 */
export const Config: z<Config> = z.object({
  wheelMode: z.union(['pan', 'zoom']).default('pan'),
  // Number.MIN_VALUE expresses "any positive double": zero would freeze the zoom.
  zoomSensitivity: z.number().min(Number.MIN_VALUE).default(0.0023),
  detailZoomThreshold: z.number().min(BOARD_ZOOM_MIN).max(1).default(0.4),
})

/**
 * Register the board main panel, the interface switch beside the sidebar
 * brand, and the `board.*` layer, frame, and body occupants that compose the
 * canvas.
 * @param ctx - Client root context.
 * @param config - validated runtime configuration.
 */
export function apply(ctx: ClientContext, config: Config = Config({})): void {
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
    defaultPreset: () => instance.getSnapshot().defaultPreset,
    rememberPreset: (presetId) => { instance.actions.setDefaultPreset(presetId) },
    presetPickerEnabled: () => presetPickerPolicy,
  })

  // Deployment preset roster for the board chrome's window-creation entries.
  // Read once at apply through the same display fold the window chip uses; a
  // failed read leaves the roster empty (the plain creation entries remain).
  const presetRoster = createSnapshotStore<BoardPresetRoster>({ presets: [], pickerEnabled: false })
  /** Latest deployment policy, undefined until a roster read answers. */
  let presetPickerPolicy: boolean | undefined
  // The creation roster is read once at apply and again whenever the chrome's
  // menu opens: roots can change between menu visits, and a stale row would
  // store a default the host no longer composes.
  const loadPresetRoster = async (): Promise<void> => {
    try {
      const result = await ctx.remote.agentPresets.list()
      if (!result.ok) return
      presetPickerPolicy = result.value.modeSelectionEnabled
      const presetT = ctx.locale.bind('settings.agentPreset')
      presetRoster.set({
        presets: result.value.presets
          .filter(row => row.broken === undefined)
          .map((row) => {
            const display = presetDisplayText(row, presetT)
            return {
              id: row.id,
              name: display.name,
              ...(display.description === undefined ? {} : { description: display.description }),
              ...(row.isDefault ? { isDefault: true } : {}),
            }
          }),
        pickerEnabled: result.value.modeSelectionEnabled,
      })
    } catch {
      // A deployment without the preset remote keeps the plain creation entries.
    }
  }
  void loadPresetRoster()
  // Preset roots live in the settings document: re-read the roster when it
  // changes, so a policy toggle is known before the next window is created.
  // The returned disposer must survive until the plugin fiber disposes.
  const stopRosterRefresh = ctx.remote.$on('settings/document-updated', () => { void loadPresetRoster() })
  ctx.effect(() => () => { stopRosterRefresh() }, 'ui-board: preset roster refresh')
  ctx.effect(() => () => { bridge.dispose() }, 'ui-board: window session bridge')

  // Т2.13–Т2.16: while a window was expanded into the standard interface, a
  // Session the user opens there moves that window onto it — unless another
  // window already shows the Session (the return control then leads there) or
  // the Session is still blank (a brand-new Session leaves the window alone).
  // The rules run only for an expanded window: switching interfaces with the
  // sidebar control never rebinds anything (Т2.16).
  let currentSession = ctx.sessions.list.getSnapshot().current
  ctx.effect(() => ctx.sessions.list.subscribe(() => {
    const list = ctx.sessions.list.getSnapshot()
    const next = list.current
    if (next === currentSession) return
    currentSession = next
    if (next === undefined) return
    const expanded = instance.getSnapshot().expandedWindowId
    if (expanded === null) return
    if (list.byId[next]?.blank === true) return
    if (bridge.windowFor(next) !== undefined) return
    bridge.bind(expanded, next)
  }), 'ui-board: expanded-window binding rules')

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

  // Clone roster: the /api/ketos.clones list the dock, the Omnibox, and the
  // clone editor read. A failed read keeps the last published list and leaves
  // the roster unloaded, so a transient failure reads as "still loading" with a
  // retry rather than as a deleted clone; every mutation re-reads it.
  const cloneRoster = createSnapshotStore<BoardCloneRoster>({ clones: [], loaded: false })
  /** Newest roster read; an older answer never overwrites a newer one. */
  let cloneReadSeq = 0
  const refreshClones = (): void => {
    const seq = ++cloneReadSeq
    void listClones().then((result) => {
      if (seq !== cloneReadSeq || !result.ok) return
      cloneRoster.set({ clones: result.value, loaded: true })
    })
  }
  refreshClones()

  // Task roster: the /api/ketos.tasks list the tasks windows read. The read
  // covers every clone and the windows filter it client-side, so two windows
  // scoped to different clones cannot overwrite each other's list. Like the
  // clone roster, a failed read keeps the last published list and leaves the
  // roster unloaded, so a transient failure reads as "still loading" with a
  // retry rather than as a deployment without tasks; every task mutation and
  // the windows' poll re-read it.
  const taskRoster = createSnapshotStore<BoardTaskRoster>({ tasks: [], loaded: false })
  /** Newest task read; an older answer never overwrites a newer one. */
  let taskReadSeq = 0
  const refreshTasks = (): void => {
    const seq = ++taskReadSeq
    void listTasks().then((result) => {
      if (seq !== taskReadSeq || !result.ok) return
      taskRoster.set({ tasks: result.value, loaded: true })
    })
  }
  refreshTasks()

  /**
   * Start one stored task on a fresh session and report the outcome. The
   * session is created first, so the route's `start` records the identity the
   * task runs on; the clone's preferred model route is selected on that session
   * exactly as the interview flow selects it. A deployment that refuses the
   * start leaves the row as it was.
   * @param taskId - task identity.
   * @param clone - the clone the task belongs to.
   * @returns what the start did, for the calling surface's notice.
   */
  const startTaskById = async (taskId: TaskId, clone: CloneDto): Promise<BoardTaskOutcome> => {
    let sessionId: SessionId
    try {
      sessionId = await ctx.sessions.create()
    } catch {
      // No session, no task: the row stays pending and the notice reports a
      // failed gesture instead of a start that has nowhere to run.
      return 'failed'
    }
    const route = clone.preferredModel === null ? undefined : parseModelRoute(clone.preferredModel)
    if (route !== undefined) {
      // The clone's preferred model applies to this task's session only: the
      // deployment default new chats use must not move because a clone ran.
      await ctx.modelDirectories.directoryFor(sessionId).select(route, { keepDefault: true }).catch(() => undefined)
    }
    const result = await startTaskRequest(taskId, sessionId)
    refreshTasks()
    if (result.ok) return 'started'
    switch (result.code) {
      case 'ketos/task-not-found': return 'missing'
      case 'ketos/invalid-state': return 'conflict'
      case 'ketos/agent-not-live': return 'agent-not-live'
      default: return 'failed'
    }
  }

  /** The window already editing one clone, in paint order, if any. */
  const cloneWindow = (cloneId: CloneId): WindowId | undefined => {
    const state = instance.getSnapshot()
    for (const id of state.windowOrder) {
      const window = state.windows[id as string]
      // A tasks window carries the clone id too; only a clone window edits it.
      if (window?.kind === 'clone' && window.cloneId === cloneId) return id
    }
    return undefined
  }

  /** Open the editor of one clone, focusing the window that already edits it. */
  const openClone = (cloneId: CloneId): void => {
    // The form follows the roster, so it must be current before the window
    // shows it: a clone whose interview finished in another window opens with
    // the profile the agent saved, not the revision the last read left behind.
    refreshClones()
    const holder = cloneWindow(cloneId)
    if (holder !== undefined) {
      instance.actions.centerOnWindow(holder)
      return
    }
    openBoardWindow(instance.actions, 'clone', nextWindowOrdinal(instance.getSnapshot().windows), { cloneId })
  }

  /**
   * The window a chat gesture binds: the given window only while it renders a
   * conversation. A clone window edits a card, so a panel gesture addressed to
   * it (new chat, branch, row pick) opens a chat window instead of creating a
   * session the clone window could never show.
   */
  const conversationWindow = (windowId: WindowId): WindowId => {
    const state = instance.getSnapshot()
    if (state.windows[windowId as string]?.bodyKind === 'conversation') return windowId
    return openBoardWindow(instance.actions, 'agent', nextWindowOrdinal(state.windows))
  }

  /** Decode one board image's base64 payload back into the bytes a File carries. */
  const imageBytes = (data: string): ArrayBuffer => {
    const binary = atob(data)
    const bytes = new Uint8Array(new ArrayBuffer(binary.length))
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes.buffer
  }

  /**
   * Take the session's standard draft for the window, or undefined when the
   * composer cannot give it up (an admission transaction, a submission, or a
   * file whose upload has not settled).
   */
  const takeStandardDraft = async (sessionId: SessionId): Promise<TakenDraft | undefined> => {
    const actx = ctx.sessions.scope(sessionId)
    if (actx === undefined) return undefined
    let input: SessionInput
    try {
      input = ctx.conversation.input.for(actx)
    } catch {
      return undefined
    }
    return await input.takeDraft()
  }

  /**
   * Append one taken standard draft to the window's own draft (Т2.11): the
   * text as a new paragraph, the attachments after the ones already there. A
   * file arrives as a receipt-only entry — the standard composer hands over
   * receipts, never browser bytes.
   */
  const mergeTakenDraft = (windowId: WindowId, taken: TakenDraft): void => {
    const actions = instance.actions
    const held = instance.getSnapshot().drafts[windowId as string]
    const text = taken.text.trim()
    const current = held?.text ?? ''
    if (text !== '') actions.setDraftText(windowId, current.trim() === '' ? text : `${current}\n\n${text}`)
    const images: BoardDraftImage[] = []
    const files: BoardWindowDraftFile[] = []
    taken.attachments.forEach((attachment, index) => {
      const id = `returned:${index}:${Math.random().toString(36).slice(2, 8)}`
      if (attachment.type === 'image') {
        images.push({
          id,
          name: attachment.name ?? t('attachment.unnamed'),
          mediaType: attachment.mediaType,
          data: attachment.data,
          preview: `data:${attachment.mediaType};base64,${attachment.data}`,
        })
        return
      }
      files.push({
        record: {
          id,
          name: attachment.name ?? t('attachment.unnamed'),
          status: 'ready',
          receiptId: attachment.receiptId,
        },
      })
    })
    if (images.length > 0) actions.addDraftImages(windowId, images)
    if (files.length > 0) actions.addDraftFiles(windowId, files)
  }

  /**
   * Return from the standard interface to the window showing the session
   * (Т2.11): take the standard draft into the window's own draft, select the
   * board panel, centre the window, and highlight it. A composer that cannot
   * give the draft up still returns, and the window says the draft stayed
   * behind.
   */
  const returnToWindow = (sessionId: SessionId, windowId: WindowId): void => {
    instance.actions.expectReturnWindow(windowId)
    instance.actions.setExpandedWindow(null)
    ctx.layout.selectPanel(BOARD_PANEL_ID)
    void takeStandardDraft(sessionId).then((taken) => {
      if (taken === undefined) {
        bridge.notifyAction(windowId, t('return.stayedInStandard'))
        return
      }
      mergeTakenDraft(windowId, taken)
    })
  }

  // Stable uSES pair for the return control: created once, so the seat never
  // resubscribes on a re-render.
  const subscribeBindings = (listener: () => void): (() => void) => bridge.bindingChanges.subscribe(listener)
  const bindingRevision = (): number => bridge.bindingChanges.getSnapshot()

  const windowSession = (key: string) => bridge.channel(key as WindowId)
  const injected = (): BoardWindowInjected => ({
    detailZoomThreshold: config.detailZoomThreshold as number,
    keyedHooks: { windowSession },
    hooks: {
      sessionList: ctx.sessions.list,
      workspaceList: ctx.workspaces.list,
      agentPresetRoster: presetRoster,
      cloneList: cloneRoster,
      taskList: taskRoster,
    },
    ensureWindowSession: (windowId) => { bridge.ensure(windowId) },
    refreshAgentPresets: () => { void loadPresetRoster() },
    releaseWindow: (windowId) => { bridge.release(windowId) },
    bindSession: (windowId, sessionId) => {
      // A session a window already shows is never bound twice, and the holder
      // comes forward; asking the bridge first also keeps a pick of the clone
      // window's own interview from minting an empty agent window on the way.
      const holder = bridge.windowFor(sessionId)
      if (holder !== undefined) {
        instance.actions.centerOnWindow(holder)
        // A clone window holding its interview must present it, or the pick
        // would land on the card editor with nothing to show.
        if (instance.getSnapshot().windows[holder as string]?.kind === 'clone') {
          instance.actions.setWindowBodyKind(holder, 'conversation')
        }
        return { kind: 'duplicate', windowId: holder }
      }
      const outcome = bridge.bind(conversationWindow(windowId), sessionId)
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
    openInMainPanel: (windowId) => {
      const sessionId = bridge.sessionFor(windowId)
      if (sessionId === undefined) return
      // The answering UI (approval, question) lives in the main panel's
      // composer; the board remembers the window so returning to the panel
      // brings it forward and highlights it.
      ctx.uiWorkspace.openSession(sessionId)
      instance.actions.expectReturnWindow(windowId)
    },
    expandToStandard: (windowId) => {
      const sessionId = bridge.sessionFor(windowId)
      if (sessionId === undefined) {
        bridge.notifyAction(windowId, t('expand.failure.session'))
        return
      }
      bridge.clearActionError(windowId)
      const actx = ctx.sessions.scope(sessionId)
      if (actx === undefined) {
        bridge.notifyAction(windowId, t('expand.failure.session'))
        return
      }
      const draft = instance.getSnapshot().drafts[windowId as string]
      // The transferable files are collected outside every try: only the
      // calls that can throw sit in one, one statement each. A receipt-only
      // file has no bytes to re-stage in the standard composer, so it stays
      // in the window.
      const transferable = draft === undefined
        ? []
        : draft.files.filter((entry): entry is BoardWindowDraftFile & { source: File } => entry.source !== undefined)
      const files = draft === undefined ? [] : [
        ...draft.images.map(image => new File([imageBytes(image.data)], image.name, { type: image.mediaType })),
        ...transferable.map(entry => entry.source),
      ]
      let input: SessionInput
      try {
        input = ctx.conversation.input.for(actx)
      } catch {
        bridge.notifyAction(windowId, t('expand.failure.session'))
        return
      }
      if (files.length > 0) {
        let attached = false
        try {
          attached = input.addFiles(files)
        } catch {
          // An unsupported image type or a rejected file: the window keeps
          // its draft and says why the handoff failed.
          bridge.notifyAction(windowId, t('expand.failure.files'))
          return
        }
        if (!attached) {
          // The standard composer is mid-admission: retrying is the only
          // useful advice, and the draft stays where it is.
          bridge.notifyAction(windowId, t('expand.failure.busy'))
          return
        }
      }
      if (draft !== undefined && draft.text !== '') {
        // The standard composer's own text is never overwritten: the window's
        // draft joins it as a new paragraph.
        const current = input.state.getSnapshot().draft
        input.setDraft(current === '' ? draft.text : `${current}\n\n${draft.text}`)
      }
      try {
        ctx.uiWorkspace.openSession(sessionId)
      } catch {
        bridge.notifyAction(windowId, t('expand.failure.session'))
        return
      }
      // The handoff landed: the window is the expanded one (the binding rules
      // Т2.13–Т2.16 run while it is set), and its transferred parts leave the
      // window. A receipt-only file stays behind: the standard composer takes
      // bytes, and it has none.
      instance.actions.setExpandedWindow(windowId)
      if (draft === undefined) return
      instance.actions.setDraftText(windowId, '')
      for (const image of draft.images) instance.actions.removeDraftItem(windowId, 'image', image.id)
      for (const entry of transferable) instance.actions.removeDraftItem(windowId, 'file', entry.record.id)
      if (transferable.length === draft.files.length) instance.actions.clearDraft(windowId)
    },
    createChat: (windowId, target) => { bridge.createChat(conversationWindow(windowId), target) },
    startChat: (windowId, workspaceId) => bridge.startChat(conversationWindow(windowId), workspaceId),
    renameChat: (sessionId, title) => bridge.renameChat(sessionId, title),
    forkChat: (windowId, sessionId) => bridge.forkChat(conversationWindow(windowId), sessionId),
    archiveChat: sessionId => bridge.archiveChat(sessionId),
    reorderChat: (workspaceId, sessionId, beforeSessionId) => bridge.reorderChat(workspaceId, sessionId, beforeSessionId),
    createWorkspace: path => bridge.createWorkspace(path),
    renameWorkspace: (workspaceId, title) => bridge.renameWorkspace(workspaceId, title),
    deleteWorkspace: workspaceId => bridge.deleteWorkspace(workspaceId),
    reorderWorkspace: (workspaceId, beforeWorkspaceId) => bridge.reorderWorkspace(workspaceId, beforeWorkspaceId),
    listDirectory: path => bridge.listDirectory(path),
    createDirectory: (path, name) => bridge.createDirectory(path, name),
    pickDirectory: () => bridge.pickDirectory(),
    canOpenWorkspacePath: () => bridge.canOpenWorkspacePath(),
    openWorkspacePath: (path, action) => bridge.openWorkspacePath(path, action),
    selectAgentPreset: (windowId, presetId) => { bridge.selectAgentPreset(windowId, presetId) },
    selectPermission: (windowId, presetId) => { bridge.selectPermission(windowId, presetId) },
    selectModel: (windowId, selection, options) => { bridge.selectModel(windowId, selection, options) },
    exitPlanMode: (windowId) => { bridge.exitPlanMode(windowId) },
    runCommand: (windowId, line) => { bridge.runCommand(windowId, line) },
    executeCommand: (windowId, line, images, files) => bridge.executeCommand(windowId, line, images, files),
    uploadFile: (windowId, name, bytes) => bridge.uploadFile(windowId, name, bytes),
    updateQueueItem: (windowId, itemId, action) => { bridge.updateQueueItem(windowId, itemId, action) },
    loadQueueImage: (windowId, attachment) => bridge.loadQueueImage(windowId, attachment),
    goalAction: (windowId, action) => { bridge.goalAction(windowId, action) },
    loadMentions: (windowId, query, signal) => bridge.loadMentions(windowId, query, signal),
    refreshClones,
    createClone: async () => {
      const result = await createCloneRequest({ name: t('clone.newName'), role: t('clone.newRole') })
      if (!result.ok) return 'failed'
      // Show the record immediately instead of waiting for the next read; the
      // read generation guard keeps an older in-flight answer from replacing it.
      cloneRoster.set({ clones: [result.value, ...cloneRoster.getSnapshot().clones], loaded: true })
      openClone(result.value.id)
      return 'created'
    },
    openClone,
    saveClone: async (cloneId: CloneId, patch: CloneUpdatePatch, revision: number) => {
      const result = await updateCloneRequest(cloneId, patch, revision)
      if (result.ok) {
        refreshClones()
        // The route mints the revision; the form bases its next save on it.
        return { kind: 'saved', revision: result.value.revision }
      }
      if (result.code === 'ketos/clone-conflict') {
        // The stored record moved; re-read it so the form's next save carries
        // the current revision and the banner can name what happened.
        refreshClones()
        return { kind: 'conflict' }
      }
      if (result.code === 'ketos/clone-not-found') {
        refreshClones()
        return { kind: 'missing' }
      }
      return { kind: 'failed' }
    },
    deleteClone: async (cloneId: CloneId, revision: number) => {
      const result = await deleteCloneRequest(cloneId, revision)
      if (!result.ok) {
        if (result.code === 'ketos/clone-conflict') {
          refreshClones()
          return 'conflict'
        }
        if (result.code === 'ketos/clone-not-found') {
          // Reconcile the roster so the editor stops showing a record the
          // deployment no longer holds.
          refreshClones()
          return 'missing'
        }
        return 'failed'
      }
      refreshClones()
      // The window edits a record that no longer exists; closing it is the
      // honest outcome, and its unsaved draft goes with the clone.
      for (const id of instance.getSnapshot().windowOrder) {
        if (instance.getSnapshot().windows[id as string]?.cloneId === cloneId) instance.actions.closeWindow(id)
      }
      return 'deleted'
    },
    loadCloneModels: async (): Promise<readonly CloneModelOption[]> => {
      try {
        const result = await ctx.remote.session.modelCatalog()
        if (!result.ok) return []
        return result.value.groups.flatMap(group => group.models.map(model => ({
          provider: group.id,
          providerName: group.name,
          model: model.id,
          name: model.name,
        })))
      } catch {
        // A deployment without the model catalog keeps the picker empty: the
        // clone simply carries no preferred model.
        return []
      }
    },
    loadCloneSessions: async (cloneId: CloneId): Promise<readonly CloneSessionBinding[]> => {
      const result = await listCloneSessions(cloneId)
      return result.ok ? result.value : []
    },
    loadMemories: async (cloneId: CloneId, status?: MemoryStatus) => {
      const result = await listMemories(cloneId, status)
      return result.ok ? { ok: true, memories: result.value } : { ok: false, code: result.code }
    },
    searchMemories: async (cloneId: CloneId, query: string, status?: MemoryStatus) => {
      const result = await searchMemories(cloneId, query, status)
      return result.ok ? { ok: true, memories: result.value } : { ok: false, code: result.code }
    },
    saveMemory: async (id: MemoryId, patch: MemoryUpdatePatch) => {
      const result = await updateMemoryRequest(id, patch)
      if (result.ok) return 'saved'
      if (result.code === 'ketos/invalid') return 'invalid'
      return result.code === 'ketos/memory-not-found' ? 'missing' : 'failed'
    },
    removeMemory: async (id: MemoryId) => {
      const result = await deleteMemoryRequest(id)
      if (result.ok) return 'deleted'
      return result.code === 'ketos/memory-not-found' ? 'missing' : 'failed'
    },
    startCloneInterview: async (clone: CloneDto, windowId: WindowId) => {
      /** Give the status back after a start step failed under it. */
      const restoreStatus = async (revision: number): Promise<void> => {
        // The rollback is best effort: a conflict means another writer moved
        // the record, and the roster re-read is what the form acts on.
        await updateCloneRequest(clone.id, { status: clone.status }, revision).catch(() => undefined)
        refreshClones()
      }
      try {
        // The clone must be `interviewing` before anything else happens: the
        // host derives the interview mode from the status and the binding pair,
        // and the status write is the step that fails on a record the user
        // edited meanwhile (the roster revision guards it). Doing it first also
        // means a refusal leaves no half-started interview behind: no session
        // was created and no binding was written yet.
        const marked = await updateCloneRequest(clone.id, { status: 'interviewing' }, clone.revision)
        if (!marked.ok) {
          refreshClones()
          return 'failed'
        }
        let sessionId: SessionId
        try {
          sessionId = await ctx.sessions.create()
        } catch (error: unknown) {
          // Nothing was created and nothing was bound, so the clone must not
          // stay `interviewing` on the strength of this failed gesture.
          await restoreStatus(marked.value.revision)
          throw error
        }
        // Bind with the interview role before the window shows the session: the
        // bridge adopts only a listed, unclaimed session, and the window must
        // never present an interview the clone's record does not own.
        const bound = await bindSessionToClone(clone.id, sessionId, 'interview')
        if (!bound.ok) {
          // A clone that stayed `interviewing` without a session would invite a
          // second start on top of a record nothing owns.
          await restoreStatus(marked.value.revision)
          return 'failed'
        }
        // The window may have closed while the requests were in flight; the
        // bridge would resurrect its record and adopt a session nothing shows.
        if (instance.getSnapshot().windows[windowId as string] === undefined) {
          refreshClones()
          return 'failed'
        }
        const outcome = bridge.adopt(windowId, sessionId)
        if (outcome.kind === 'duplicate') {
          // One session belongs to one window: the clone window keeps editing
          // its card and the window already holding the session comes forward.
          instance.actions.centerOnWindow(outcome.windowId)
          return 'failed'
        }
        if (outcome.kind === 'unknown') {
          refreshClones()
          return 'failed'
        }
        const route = clone.preferredModel === null ? undefined : parseModelRoute(clone.preferredModel)
        // The interview's preferred model applies to its session only; the
        // deployment default new chats use stays where the user left it.
        if (route !== undefined) bridge.selectModel(windowId, route, { keepDefault: true })
        // The status write is the user's own gesture, so the form must not show
        // it as a revision the agent made: re-base the stored status it holds.
        const edit = instance.getSnapshot().cloneEdits[clone.id]
        if (edit !== undefined) {
          instance.actions.setCloneEdit(windowId, clone.id, {
            ...edit,
            draft: { ...edit.draft, status: 'interviewing' },
            base: { ...edit.base, status: 'interviewing' },
            revision: marked.value.revision,
          })
        }
        // The interview runs as a conversation: the clone window shows the
        // session's lane instead of the card while the profile is drafted.
        instance.actions.setWindowBodyKind(windowId, 'conversation')
        instance.actions.centerOnWindow(windowId)
        refreshClones()
        return 'started'
      } catch {
        return 'failed'
      }
    },
    refreshTasks,
    openTasksWindow: (cloneId: CloneId) => {
      const state = instance.getSnapshot()
      const holder = Object.values(state.windows).find(entry => entry.kind === 'tasks' && entry.cloneId === cloneId)
      if (holder !== undefined) {
        instance.actions.centerOnWindow(holder.id)
        return
      }
      openBoardWindow(instance.actions, 'tasks', nextWindowOrdinal(state.windows), { cloneId })
    },
    createTask: async (cloneId: CloneId, objective: string) => {
      const clone = cloneRoster.getSnapshot().clones.find(entry => entry.id === cloneId)
      if (clone === undefined) {
        // A clone the roster does not hold cannot run a task; re-read it so a
        // record deleted meanwhile reaches the windows still showing it.
        refreshClones()
        return 'missing'
      }
      // A task only starts for a profiled clone, and the check runs before the
      // task is stored: a refusal must not leave a pending task behind.
      if (clone.status !== 'ready') return 'not-ready'
      const created = await createTaskRequest(cloneId, objective)
      if (!created.ok) {
        if (created.code === 'ketos/clone-not-found') {
          refreshClones()
          return 'missing'
        }
        return 'failed'
      }
      return await startTaskById(created.value.id, clone)
    },
    startTask: async (taskId: TaskId) => {
      const task = taskRoster.getSnapshot().tasks.find(entry => entry.id === taskId)
      if (task === undefined) {
        refreshTasks()
        return 'missing'
      }
      if (task.status !== 'pending') return 'conflict'
      const clone = cloneRoster.getSnapshot().clones.find(entry => entry.id === task.cloneId)
      if (clone === undefined) return 'missing'
      if (clone.status !== 'ready') return 'not-ready'
      return await startTaskById(taskId, clone)
    },
    cancelTask: async (taskId: TaskId) => {
      const result = await cancelTaskRequest(taskId)
      refreshTasks()
      if (result.ok) return 'cancelled'
      switch (result.code) {
        case 'ketos/task-not-found': return 'missing'
        case 'ketos/invalid-state': return 'conflict'
        default: return 'failed'
      }
    },
    loadTaskProgress: async (sessionId: SessionId): Promise<BoardTaskProgress | undefined> => {
      try {
        const result = await ctx.remote.goals.get(sessionId)
        if (!result.ok || result.value === undefined) return undefined
        return { roundsStarted: result.value.roundsStarted, maxGoalRounds: result.value.maxGoalRounds }
      } catch {
        // A deployment whose goals remote refuses the read leaves the row
        // without a progress line; the status pill still reports the task.
        return undefined
      }
    },
    loadTaskArtifacts: (sessionId: SessionId) => {
      // A task session this client never opened has no chat to fold artifacts
      // from, and the report then shows its artifacts section empty.
      if (ctx.sessions.binding(sessionId) === undefined) return []
      const target = ctx.uiConversation.binding(sessionId).target('chat')
      return sessionArtifacts(target.getSnapshot())
    },
    openFileInPanel: (windowId, path) => {
      const sessionId = bridge.sessionFor(windowId)
      // A lane click implies the window's session; the guard covers the gap
      // while a rebind settles and the previous rows are still painted.
      if (sessionId === undefined) return
      const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
      const absolute = resolveWorkspacePath(cwd, path)
      instance.actions.openRightTab(sessionId, { id: `viewer:${absolute}`, kind: 'viewer', path: absolute })
      instance.actions.setWindowPanel(windowId, 'right', true)
    },
    documentPreviewFor: (path) => {
      const first = ctx.documentPreviews.candidates(path)[0]
      return first === undefined ? undefined : { loading: first.loading }
    },
    listWorkspaceDirectory: async (sessionId, path, signal) => {
      const result = await ctx.remote.workspaceFiles.list(sessionId, path, signal)
      return result.ok
        ? { ok: true, entries: result.value.entries, truncated: result.value.truncated }
        : { ok: false, code: result.error.code, message: result.error.message }
    },
    readWorkspaceFile: async (sessionId, path, mode, signal) => {
      if (mode === 'bytes-complete') {
        const result = await ctx.remote.workspaceFiles.readAll(sessionId, path, signal)
        return result.ok
          ? { ok: true, kind: 'bytes', data: result.value.data }
          : { ok: false, code: result.error.code, message: result.error.message }
      }
      // No explicit line limit: the host's configured page cap applies, and a
      // caller-chosen limit above it would be refused.
      const result = await ctx.remote.workspaceFiles.read(sessionId, path, {}, signal)
      return result.ok
        ? { ok: true, kind: 'text', text: result.value.text }
        : { ok: false, code: result.error.code, message: result.error.message }
    },
  })

  // The board owns the whole frame: its main panel hides the shell's sidebar
  // column while it is selected (Т2.7). The declaration is one effect with the
  // registration — a collapsed declaration clears the flag, and a redeclared
  // slot (an HMR reload of ui-layout) re-applies it.
  ctx.slots.inject('main', function* () {
    const disposeSidebar = ctx.layout.declarePanelSidebar(BOARD_PANEL_ID, false)
    yield ctx.slots.register({
      name: 'main',
      key: 'board',
      store: boardStore,
      locale: NS,
      inject: (): BoardRootInjected => ({
        // Schemastery materializes the field defaults before Cordis calls apply.
        wheelMode: config.wheelMode as BoardWheelMode,
        zoomSensitivity: config.zoomSensitivity as number,
        detailZoomThreshold: config.detailZoomThreshold as number,
        openStandardInterface: () => { ctx.layout.selectPanel(null) },
      }),
      children: {
        'board.canvas': { kind: 'single', scope: 'root' },
        'board.dock': { kind: 'single', scope: 'root' },
        'board.minimap': { kind: 'single', scope: 'root' },
      },
    }, BoardRoot)
    yield disposeSidebar
  })

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

  // The conversation body serves every chat window; the clone body is the
  // clone card editor inside a clone window. The connectors, settings, and
  // dashboard windows are outside the MVP, so they share one unavailable body
  // instead of rendering an empty content region.
  ctx.slots.inject('board.window.body', function* () {
    yield ctx.slots.register({
      name: 'board.window.body',
      key: 'conversation',
      store: boardStore,
      locale: NS,
      inject: injected,
    }, ConversationBody)
    yield ctx.slots.register({
      name: 'board.window.body',
      key: 'clone',
      store: boardStore,
      locale: NS,
      inject: injected,
    }, CloneBody)
    yield ctx.slots.register({
      name: 'board.window.body',
      key: 'clone-memory',
      store: boardStore,
      locale: NS,
      inject: injected,
    }, CloneMemoryBody)
    yield ctx.slots.register({
      name: 'board.window.body',
      key: 'tasks',
      store: boardStore,
      locale: NS,
      inject: injected,
    }, TasksBody)
    yield ctx.slots.register({
      name: 'board.window.body',
      key: 'connectors',
      store: boardStore,
      locale: NS,
      inject: injected,
    }, MvpUnavailableBody)
    yield ctx.slots.register({
      name: 'board.window.body',
      key: 'settings',
      store: boardStore,
      locale: NS,
      inject: injected,
    }, MvpUnavailableBody)
    yield ctx.slots.register({
      name: 'board.window.body',
      key: 'dashboard',
      store: boardStore,
      locale: NS,
      inject: injected,
    }, MvpUnavailableBody)
  })

  ctx.slots.inject('board.dock', () => ctx.slots.register({
    name: 'board.dock',
    store: boardStore,
    locale: NS,
    inject: injected,
  }, SessionRail))

  ctx.slots.inject('board.minimap', () => ctx.slots.register({
    name: 'board.minimap',
    store: boardStore,
    locale: NS,
  }, Minimap))

  // Interface switch beside the sidebar brand (Т2.5): the standard interface's
  // half of the pair whose other half is the board's mode badge (Т2.6).
  ctx.slots.inject('sidebar.brand.actions', () => ctx.slots.register({
    name: 'sidebar.brand.actions',
    id: 'board',
    locale: NS,
    inject: (): BoardToggleInjected => ({
      openBoard: () => { ctx.layout.selectPanel(BOARD_PANEL_ID) },
    }),
  }, BoardToggle))

  // The standard interface's way back (Т2.11): one control, registered in the
  // header's utility row and in the blank seat — a blank Session's header
  // keeps only the blank seat, and the return control must stay reachable
  // there too (Т2.15).
  const returnControlInject = (): ReturnToWindowActionInjected => ({
    subscribeBindings,
    bindingRevision,
    windowForSession: sessionId => bridge.windowFor(sessionId),
    returnToWindow,
  })
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'board-return',
    locale: NS,
    inject: returnControlInject,
  }, ReturnToWindowAction))
  ctx.slots.inject('conversation.session.header.blank', () => ctx.slots.register({
    name: 'conversation.session.header.blank',
    id: 'board-return',
    locale: NS,
    inject: returnControlInject,
  }, ReturnToWindowAction))
}
