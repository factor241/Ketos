/**
 * Apply-side bridge from a board window to its Harness session. The bridge
 * owns everything the window's chat needs that no root-scope component can
 * subscribe to itself:
 *
 * - session lifecycle: `create()` → `open()` → `binding()`, one per window,
 *   with the window id → session id map kept here (never in the board store);
 * - lane sources: the assembled `target('chat')` snapshot and the session
 *   face's running flag;
 * - composer state: the session list row (cwd, blank, agent preset), the
 *   permissions/plan/todos/goal/contextPressure projections, the model
 *   directory, the slash-command catalog, and the conversation block reason;
 * - composer commands: prompt, cancel, load-older, queue edits, preset and
 *   permission switches, model selection, plan exit, goal verbs, workspace
 *   picking, and `@` mention discovery.
 *
 * All of it is republished into one identity-stable channel per window; the
 * registrations expose that channel as the keyed `useWindowSession(windowId)`
 * hook plus plain callbacks, and components never touch an observable.
 * Subscriptions live for the plugin fiber's lifetime.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { presetDisplayText } from '@deepseek-ai/dsh-agent-presets/display'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PromptContentPart } from '@deepseek-ai/dsh-api-session-controller/types'
import type {
  BoardCommandRow, BoardDraftImage, BoardEffortOption, BoardGoalState, BoardMentionRow,
  BoardModelState, BoardPermissionOption, BoardPresetOption, BoardPromptMode, BoardQueueRow,
  BoardTodoRow, BoardWindowSessionState, WindowId,
} from './contract/slots.ts'

/** The three permission presets the window chip offers, in switch order. */
const PERMISSION_PRESETS = ['read-only', 'workspace-write', 'danger-full-access'] as const

/** Editor-visible preset that requires the risk confirmation. */
const FULL_ACCESS_PRESET = 'danger-full-access'

/** The built-in command rows the composer menu adds in its own order. */
const ADD_SECTION = ['file', 'goal', 'plan', 'feedback'] as const
const COMMANDS_SECTION = ['compact', 'permission', 'model', 'export'] as const

/** Empty composer state shared as the initial snapshot. */
function emptyState(): BoardWindowSessionState {
  return {
    status: 'pending',
    running: false,
    blank: true,
    presets: [],
    permissions: [],
    plan: false,
    queue: [],
    todos: [],
    model: { efforts: [], groups: [], loading: false },
    commands: [],
  }
}

/** Identity-stable per-window state observable; the keyed hook binds to this. */
export interface WindowSessionChannel extends ObservableSnapshot<BoardWindowSessionState> {
  /**
   * Publish the next state to the channel's listeners.
   * @param next - complete replacement state.
   */
  publish(next: BoardWindowSessionState): void
}

function createChannel(): WindowSessionChannel {
  let snapshot = emptyState()
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    publish: (next) => {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** One window's mutable bridge record. */
interface WindowRecord {
  readonly channel: WindowSessionChannel
  sessionId?: SessionId
  /** Release the subscriptions that belong to the current session. */
  releaseSession: () => void
}

/**
 * Session bridge shared by every board window registration.
 *
 * The window↔session map lives here (apply closure scope), not in the board
 * store: sessions are object-layer data, and the store carries view state only.
 */
export class BoardSessionBridge {
  private readonly ctx: ClientContext
  private readonly windows = new Map<WindowId, WindowRecord>()
  private readonly creating = new Set<WindowId>()
  private readonly disposers = new Set<() => void>()
  private presetRoster: readonly BoardPresetOption[] | undefined
  private disposed = false

  /**
   * @param ctx - client root context; the bridge reads the session,
   * conversation, model-directory, and remote services from it.
   */
  constructor(ctx: ClientContext) {
    this.ctx = ctx
  }

  /**
   * The state channel of one window, created on first touch.
   * @param windowId - window identity.
   * @returns the window's stable channel.
   */
  channel(windowId: WindowId): WindowSessionChannel {
    return this.record(windowId).channel
  }

  /**
   * Create the window's session on first call and bind its sources; a later
   * call for the same window is a no-op. Creation failure lands in the channel
   * as an `error` state.
   * @param windowId - window identity.
   */
  ensure(windowId: WindowId): void {
    if (this.disposed || this.record(windowId).sessionId !== undefined || this.creating.has(windowId)) return
    this.creating.add(windowId)
    void this.create(windowId)
  }

  /**
   * Send one prompt into the window's session.
   * @param windowId - window identity.
   * @param text - prompt text as typed.
   * @param mode - queue a turn or steer the running one.
   * @param images - inline images carried with the prompt.
   */
  send(windowId: WindowId, text: string, mode: BoardPromptMode, images: readonly BoardDraftImage[] = []): void {
    const session = this.sessionFace(windowId)
    if (session === undefined) return
    const content: PromptContentPart[] = [{ type: 'text', text }]
    for (const image of images) {
      content.push({
        type: 'image',
        mediaType: image.mediaType as ImageMediaType,
        data: image.data,
        name: image.name,
      })
    }
    void session.prompt(content, mode).then((result) => {
      if (result.ok) return
      this.patch(windowId, { error: `${result.error.code}: ${result.error.message}` })
    })
  }

  /**
   * Cancel the window's running turn.
   * @param windowId - window identity.
   */
  cancel(windowId: WindowId): void {
    void this.sessionFace(windowId)?.cancel()
  }

  /**
   * Load older turns into the window's lane.
   * @param windowId - window identity.
   */
  loadOlder(windowId: WindowId): void {
    void this.sessionFace(windowId)?.loadOlder()
  }

  /**
   * Select the window's session and show the real conversation panel.
   * @param windowId - window identity.
   */
  openInMainPanel(windowId: WindowId): void {
    const sessionId = this.record(windowId).sessionId
    if (sessionId === undefined) return
    this.ctx.sessions.open(sessionId)
    this.ctx.layout.selectPanel(null)
  }

  /**
   * Switch the agent preset of the window's still-blank session.
   * @param windowId - window identity.
   * @param presetId - roster preset id.
   */
  selectAgentPreset(windowId: WindowId, presetId: string): void {
    const sessionId = this.record(windowId).sessionId
    if (sessionId === undefined) return
    void this.ctx.remote.agentPresets.select(sessionId, presetId).then((result) => {
      if (result.ok) return
      this.patch(windowId, { error: `${result.error.code}: ${result.error.message}` })
    })
  }

  /**
   * Switch the permission preset of the window's session.
   * @param windowId - window identity.
   * @param presetId - preset table key.
   */
  selectPermission(windowId: WindowId, presetId: string): void {
    this.runCommand(windowId, `/permission ${presetId}`)
  }

  /**
   * Switch the model or the reasoning effort of the window's session.
   * @param windowId - window identity.
   * @param selection - complete selection (provider, model, optional effort).
   */
  selectModel(windowId: WindowId, selection: { provider: string; model: string; reasoningEffort?: string }): void {
    const sessionId = this.record(windowId).sessionId
    if (sessionId === undefined) return
    void this.ctx.modelDirectories.directoryFor(sessionId).select(selection).catch((error: unknown) => {
      this.patch(windowId, { error: error instanceof Error ? error.message : String(error) })
    })
  }

  /**
   * Leave plan mode through the host command.
   * @param windowId - window identity.
   */
  exitPlanMode(windowId: WindowId): void {
    this.runCommand(windowId, '/plan off')
  }

  /**
   * Run one slash-command line against the window's session.
   * @param windowId - window identity.
   * @param line - full command line, leading slash included.
   */
  runCommand(windowId: WindowId, line: string): void {
    const sessionId = this.record(windowId).sessionId
    if (sessionId === undefined) return
    const owner = this.ctx.sessions.binding(sessionId)
    if (owner === undefined) return
    void owner.session.command(line)
  }

  /**
   * Remove or steer one queued message.
   * @param windowId - window identity.
   * @param itemId - queued occurrence identity.
   * @param action - requested mutation.
   */
  updateQueueItem(windowId: WindowId, itemId: string, action: 'remove' | 'steer'): void {
    const session = this.sessionFace(windowId)
    if (session === undefined) return
    void session.updateQueue(itemId as never, { kind: action })
  }

  /**
   * Pause, resume, or clear the window session's goal.
   * @param windowId - window identity.
   * @param action - requested goal verb.
   */
  goalAction(windowId: WindowId, action: 'pause' | 'resume' | 'clear'): void {
    const sessionId = this.record(windowId).sessionId
    if (sessionId === undefined) return
    const projection = this.ctx.sessions.binding(sessionId)?.session.projections.faceOf('goal').getSnapshot() as
      | { goal: { id: string; revision: number } }
      | null
      | undefined
    if (projection == null) return
    const ref = { id: projection.goal.id as never, revision: projection.goal.revision }
    const goals = this.ctx.remote.goals
    void (action === 'pause' ? goals.pause(sessionId, ref)
      : action === 'resume' ? goals.resume(sessionId, ref)
        : goals.clear(sessionId, ref))
  }

  /**
   * Adopt a picked directory: a blank session is re-created in it, and the
   * window is rebound to the new session. A started session keeps its cwd.
   * @param windowId - window identity.
   */
  pickWorkspace(windowId: WindowId): void {
    const record = this.record(windowId)
    if (record.sessionId === undefined || this.disposed) return
    const current = record.channel.getSnapshot()
    if (!current.blank) return
    void this.ctx.uiWorkspace.pickDirectory().then((path) => {
      if (path === null || this.disposed) return
      record.releaseSession()
      delete record.sessionId
      void this.create(windowId, path)
    }).catch((error: unknown) => {
      this.patch(windowId, { error: error instanceof Error ? error.message : String(error) })
    })
  }

  /**
   * Resolve `@` mention candidates for the draft's query.
   * @param windowId - window identity.
   * @param query - text after the trigger.
   * @param signal - cancellation for a superseded query.
   * @returns file and session candidates, files first.
   */
  async loadMentions(windowId: WindowId, query: string, signal: AbortSignal): Promise<readonly BoardMentionRow[]> {
    const sessionId = this.record(windowId).sessionId
    if (sessionId === undefined) return []
    const [files, sessions] = await Promise.all([
      this.ctx.remote.fileReferences.list(sessionId, query, signal),
      this.ctx.remote.sessionReferenceResolver.candidates(sessionId, query, signal),
    ])
    const rows: BoardMentionRow[] = []
    if (files.ok) {
      for (const candidate of files.value) {
        rows.push({
          id: `file:${candidate.path}`,
          label: candidate.path,
          insert: `@${candidate.path}`,
          kind: candidate.kind,
        })
      }
    }
    if (sessions.ok) {
      for (const candidate of sessions.value) {
        rows.push({
          id: `session:${candidate.sessionId}`,
          label: candidate.label,
          insert: candidate.mention,
          kind: 'session',
        })
      }
    }
    return rows
  }

  /** Release every subscription; the plugin fiber calls this on disposal. */
  dispose(): void {
    this.disposed = true
    for (const record of this.windows.values()) record.releaseSession()
    for (const dispose of this.disposers) dispose()
    this.disposers.clear()
    this.windows.clear()
    this.creating.clear()
  }

  private record(windowId: WindowId): WindowRecord {
    let record = this.windows.get(windowId)
    if (record === undefined) {
      record = { channel: createChannel(), releaseSession: () => {} }
      this.windows.set(windowId, record)
    }
    return record
  }

  private sessionFace(windowId: WindowId) {
    const sessionId = this.record(windowId).sessionId
    if (sessionId === undefined) return undefined
    return this.ctx.sessions.binding(sessionId)?.session
  }

  private patch(windowId: WindowId, patch: Partial<BoardWindowSessionState>): void {
    const channel = this.record(windowId).channel
    channel.publish({ ...channel.getSnapshot(), ...patch })
  }

  private async create(windowId: WindowId, cwd?: string): Promise<void> {
    const record = this.record(windowId)
    const channel = record.channel
    try {
      const sessionId = await this.ctx.sessions.create(cwd === undefined ? undefined : { cwd })
      if (this.disposed) return
      record.sessionId = sessionId
      // The live event stream exists only for the session opened as current.
      this.ctx.sessions.open(sessionId)
      const owner = this.ctx.sessions.binding(sessionId)
      if (owner === undefined) throw new Error(`board: session "${sessionId}" is not addressable after create`)
      const chat = this.ctx.uiConversation.binding(sessionId).target('chat')
      const { session } = owner
      const { projections } = session

      const republish = (): void => {
        const row = this.ctx.sessions.list.getSnapshot().byId[sessionId]
        const permissions = projections.faceOf('permissions').getSnapshot() as
          | { currentValue: string } | undefined
        const plan = projections.faceOf('plan').getSnapshot() as { active: boolean } | undefined
        const todos = projections.faceOf('todos').getSnapshot() as readonly BoardTodoRow[] | null | undefined
        const goal = projections.faceOf('goal').getSnapshot() as
          | { goal: { objective: string; phase: BoardGoalState['phase'] } } | null | undefined
        const pressure = projections.faceOf('contextPressure').getSnapshot() as
          | { pressureTokens?: number; projectedTokens?: number; contextWindow?: number } | undefined
        const used = pressure?.projectedTokens ?? pressure?.pressureTokens
        const queue: BoardQueueRow[] = session.getSnapshot().queue
          .filter(item => item.placement === 'queued')
          .map(item => ({ id: String(item.id), preview: item.preview }))
        channel.publish({
          ...channel.getSnapshot(),
          status: 'ready',
          running: session.getSnapshot().running,
          error: undefined,
          chat: chat.getSnapshot(),
          cwd: row?.cwd,
          blank: row?.blank ?? true,
          presetId: typeof row?.projectionValues?.agentPreset === 'string' ? row.projectionValues.agentPreset : undefined,
          permission: permissions?.currentValue,
          plan: plan?.active ?? false,
          todos: (todos ?? []).map(item => ({ content: item.content, status: item.status })),
          goal: goal == null ? undefined : {
            objective: goal.goal.objective,
            phase: goal.goal.phase,
            activation: 'armed',
          },
          queue,
          context: used === undefined || pressure?.contextWindow === undefined ? undefined : {
            percent: Math.min(100, Math.round(used / pressure.contextWindow * 100)),
            usedTokens: used,
            window: pressure.contextWindow,
          },
        })
      }

      const disposers: (() => void)[] = []
      const listen = (source: ObservableSnapshot<unknown>): void => {
        disposers.push(source.subscribe(republish))
      }
      listen(chat)
      listen(session)
      listen(projections.faceOf('permissions'))
      listen(projections.faceOf('plan'))
      listen(projections.faceOf('todos'))
      listen(projections.faceOf('goal'))
      listen(projections.faceOf('contextPressure'))
      listen(this.ctx.sessions.list)
      record.releaseSession = () => {
        for (const dispose of disposers) dispose()
        disposers.length = 0
      }

      // Presets, permission rows, the model directory, commands, and the
      // conversation block are session-adjacent state fetched once per window.
      void this.syncPresets(windowId)
      this.patch(windowId, { permissions: this.permissionRows(projections) })
      listen(projections.faceOf('permissions'))
      disposers.push(projections.faceOf('permissions').subscribe(() => {
        this.patch(windowId, { permissions: this.permissionRows(projections) })
      }))
      void this.syncModel(windowId, sessionId)
      void this.syncCommands(windowId, sessionId)
      const conversation = this.ctx.get('conversation') as
        | { blocks?: { storeFor?: (id: SessionId) => ObservableSnapshot<{ reason: string } | undefined> } }
        | undefined
      const blockStore = conversation?.blocks?.storeFor?.(sessionId)
      if (blockStore !== undefined) {
        const syncBlock = (): void => {
          this.patch(windowId, { blocked: blockStore.getSnapshot()?.reason })
        }
        disposers.push(blockStore.subscribe(syncBlock))
        syncBlock()
      }
      republish()
    } catch (error) {
      channel.publish({
        ...channel.getSnapshot(),
        status: 'error',
        running: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private permissionRows(projections: { faceOf(key: string): ObservableSnapshot<unknown> }): readonly BoardPermissionOption[] {
    const value = projections.faceOf('permissions').getSnapshot() as { options?: readonly { value: string }[] } | undefined
    const available = new Set((value?.options ?? []).map(option => option.value))
    return PERMISSION_PRESETS
      .filter(id => available.has(id))
      .map(id => ({ id, dangerous: id === FULL_ACCESS_PRESET }))
  }

  private async syncPresets(windowId: WindowId): Promise<void> {
    try {
      if (this.presetRoster === undefined) {
        const result = await this.ctx.remote.agentPresets.list()
        if (!result.ok) {
          this.patch(windowId, { error: `${result.error.code}: ${result.error.message}` })
          return
        }
        const presetT = this.ctx.locale.bind('settings.agentPreset')
        this.presetRoster = result.value.presets.map((row) => {
          const display = presetDisplayText(row, presetT)
          return {
            id: row.id,
            name: display.name,
            ...(display.description === undefined ? {} : { description: display.description }),
          }
        })
      }
      this.patch(windowId, { presets: this.presetRoster })
    } catch (error) {
      // A deployment without the preset remote keeps the chip empty.
      this.patch(windowId, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  private async syncModel(windowId: WindowId, sessionId: SessionId): Promise<void> {
    this.patch(windowId, { model: { ...this.record(windowId).channel.getSnapshot().model, loading: true } })
    try {
      const directory = this.ctx.modelDirectories.directoryFor(sessionId)
      const publish = (): void => {
        const state = directory.store.getSnapshot()
        const current = state.current
        const group = state.groups.find(item => item.id === current?.provider)
        const model = group?.models.find(item => item.id === current?.model)
        const efforts: BoardEffortOption[] = (model?.reasoning?.efforts ?? []).map(effort => ({
          id: effort.id,
          name: effort.name,
        }))
        const effortName = efforts.find(effort => effort.id === current?.reasoningEffort)?.name
          ?? model?.reasoning?.defaultEffort
        const next: BoardModelState = {
          ...(current?.provider === undefined ? {} : { provider: current.provider }),
          ...(current?.model === undefined ? {} : { model: current.model }),
          ...(model?.name === undefined ? {} : { modelName: model.name }),
          ...(current?.reasoningEffort === undefined ? {} : { effort: current.reasoningEffort }),
          ...(effortName === undefined ? {} : { effortName }),
          efforts,
          groups: state.groups.map(item => ({
            id: item.id,
            name: item.name,
            models: item.models.map(entry => ({ id: entry.id, name: entry.name })),
          })),
          loading: state.status === 'loading' || state.status === 'selecting',
          ...(state.error === null ? {} : { error: state.error }),
        }
        this.patch(windowId, { model: next })
      }
      const record = this.record(windowId)
      record.releaseSession = (() => {
        const previous = record.releaseSession
        const dispose = directory.store.subscribe(publish)
        return () => { dispose(); previous() }
      })()
      await directory.load()
      publish()
    } catch (error) {
      const model = this.record(windowId).channel.getSnapshot().model
      this.patch(windowId, {
        model: {
          ...model,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  private async syncCommands(windowId: WindowId, sessionId: SessionId): Promise<void> {
    let result: Awaited<ReturnType<typeof this.ctx.remote.commands.list>>
    try {
      result = await this.ctx.remote.commands.list(sessionId)
    } catch {
      // A deployment without the command remote keeps the menu to the host rows it knows.
      return
    }
    if (!result.ok) return
    const known = new Map<string, BoardCommandRow>()
    for (const descriptor of result.value) {
      known.set(descriptor.name, {
        name: descriptor.name,
        description: descriptor.description,
        ...(descriptor.input === undefined ? {} : { hint: descriptor.input.hint }),
      })
    }
    const order = [...ADD_SECTION, ...COMMANDS_SECTION]
    const rows = order
      .map(name => known.get(name))
      .filter((row): row is BoardCommandRow => row !== undefined)
    for (const row of known.values()) {
      if (!order.includes(row.name as typeof order[number])) rows.push(row)
    }
    this.patch(windowId, { commands: rows })
  }
}
