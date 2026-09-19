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
 *   permission switches, model selection, plan exit, goal verbs, command
 *   execution, file staging, and `@` mention discovery.
 *
 * All of it is republished into one identity-stable channel per window; the
 * registrations expose that channel as the keyed `useWindowSession(windowId)`
 * hook plus plain callbacks, and components never touch an observable.
 *
 * The window → session map is durable: the bridge hands it to its apply-side
 * sink on discrete events (creation, rebind, close) and adopts the stored map
 * back through `restore`, which reconciles every pair against the layout and
 * the session list. `sessions.list` is the authority for a bound session's
 * life — a window waits in `restoring`, reports `missing` when its chat is
 * gone, and reattaches when the chat returns — and one session belongs to one
 * window, which `bind` reports so the calling surface can bring the holding
 * window forward instead. Subscriptions live for the plugin fiber's lifetime.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-file-upload/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { FileAttachmentRef, ImageAttachmentRef, ImageAttachmentLimits, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { PendingSubmissionAttachment, QueuedMessage } from '@deepseek-ai/dsh-api-session-controller/client'
import { presetDisplayText } from '@deepseek-ai/dsh-agent-presets/display'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PromptContentPart } from '@deepseek-ai/dsh-api-session-controller/types'
import type { BoardSettingsBindings } from '../board-settings.ts'
import { NS } from './locale.ts'
import type { BoardTranslate } from './locale.ts'
import type {
  BoardBindOutcome, BoardChatTarget, BoardCommandRow, BoardDirectoryListing, BoardDraftImage, BoardEffortOption,
  BoardGoalState, BoardMentionRow, BoardModelState, BoardPendingRow, BoardPermissionOption, BoardPresetOption,
  BoardPromptFile, BoardPromptMode, BoardQueueAction, BoardQueueAttachment, BoardQueueRow, BoardTodoRow,
  BoardUploadResult, BoardWindowSessionState, WindowId,
} from './contract/slots.ts'

/** The three permission presets the window chip offers, in switch order. */
const PERMISSION_PRESETS = ['read-only', 'workspace-write', 'danger-full-access'] as const

/** Editor-visible preset that requires the risk confirmation. */
const FULL_ACCESS_PRESET = 'danger-full-access'

/** The two queue placements the window renders; a context occurrence never reaches the strip. */
function queuePlacement(item: QueuedMessage): 'queued' | 'steering' | null {
  return item.placement === 'queued' || item.placement === 'steering' ? item.placement : null
}

/**
 * Durable attachments one queue occurrence carries. Queue frames are wire data
 * despite their typed face, so a block without a reference is skipped rather
 * than trusted.
 * @param content - the occurrence's wire content blocks.
 * @returns the attachments in block order.
 */
function queueAttachments(content: QueuedMessage['content']): readonly BoardQueueAttachment[] {
  const attachments: BoardQueueAttachment[] = []
  for (const block of content) {
    if (block.type === 'image') {
      const { attachment } = block as { attachment?: ImageAttachmentRef }
      if (attachment !== undefined) attachments.push({ kind: 'image', attachment })
    }
    if (block.type === 'file') {
      const { attachment } = block as { attachment?: FileAttachmentRef }
      if (attachment !== undefined) attachments.push({ kind: 'file', name: attachment.name, bytes: attachment.bytes })
    }
  }
  return attachments
}

/** The built-in command rows the composer menu adds in its own order. */
const ADD_SECTION = ['file', 'goal', 'plan', 'feedback'] as const
const COMMANDS_SECTION = ['compact', 'permission', 'model', 'export'] as const

/** Empty composer state shared as the initial snapshot. */
function emptyState(): BoardWindowSessionState {
  return {
    status: 'pending',
    running: false,
    blank: true,
    hasMore: false,
    loadingOlder: false,
    runningCalls: [],
    presets: [],
    permissions: [],
    plan: false,
    queue: [],
    pending: [],
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
  /**
   * The session the window shows, or the one a restore wants it to show: a
   * missing session keeps its id so the window can reattach when it returns.
   */
  sessionId?: SessionId
  /** Whether the session subscriptions of {@link releaseSession} are live. */
  attached: boolean
  /** Whether an attach pass is mid-flight, so a list notification cannot re-enter it. */
  attaching: boolean
  /** Release the subscriptions that belong to the current session. */
  releaseSession: () => void
}

/** Apply-side hooks of one bridge: the durable sink of the bindings map. */
export interface BoardSessionBridgeHooks {
  /**
   * Store the current window → session map. Called on discrete events only —
   * creation, rebind, close — never on a frame.
   */
  persistBindings?: (bindings: BoardSettingsBindings) => void
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
  private readonly pending = new Map<WindowId, Promise<void>>()
  private readonly disposers = new Set<() => void>()
  private readonly hooks: BoardSessionBridgeHooks
  private presetRoster: readonly BoardPresetOption[] | undefined
  private disposed = false

  /**
   * @param ctx - client root context; the bridge reads the session,
   * conversation, model-directory, and remote services from it.
   * @param hooks - apply-side sink for the durable bindings map.
   */
  constructor(ctx: ClientContext, hooks: BoardSessionBridgeHooks = {}) {
    this.ctx = ctx
    this.hooks = hooks
    // The session list is the source of truth: a bound session that leaves it
    // puts its window into the missing state, and one that returns reattaches.
    this.disposers.add(ctx.sessions.list.subscribe(() => { this.reconcile() }))
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
    void this.whenReady(windowId)
  }

  /**
   * Resolve once the window has a session, creating it when it does not. The
   * board chrome opens a window and sends in the same gesture, before the new
   * composer mounts, so delivery waits on this instead of racing the mount.
   * Creation failure settles too (the channel carries the error), so a caller
   * never hangs on an unreachable host.
   * @param windowId - window identity.
   * @returns a promise settling when the window has a session or its creation failed.
   */
  whenReady(windowId: WindowId): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.record(windowId).sessionId !== undefined) return Promise.resolve()
    let pending = this.pending.get(windowId)
    if (pending === undefined) {
      pending = this.create(windowId).finally(() => {
        // A window released and reopened mid-creation has a newer pending
        // entry; only the promise that owns the slot may clear it.
        if (this.pending.get(windowId) === pending) this.pending.delete(windowId)
      })
      this.pending.set(windowId, pending)
    }
    return pending
  }

  /**
   * Send one prompt into the window's session, waiting for the session when the
   * window was just opened and its composer has not created it yet. A local
   * submission echo is registered before the prompt call — the lane renders it
   * while the admission round-trip runs — and a refused prompt retires the echo
   * by its request identity; the promise then settles with the outcome so the
   * caller can return the refused draft.
   * @param windowId - window identity.
   * @param text - prompt text as typed.
   * @param mode - queue a turn or steer the running one.
   * @param images - inline images carried with the prompt.
   * @param files - staged file receipts and their durable references.
   * @param signal - optional caller cancellation for the complete admission round-trip.
   * @returns whether the host accepted the prompt.
   */
  async send(
    windowId: WindowId,
    text: string,
    mode: BoardPromptMode,
    images: readonly BoardDraftImage[] = [],
    files: readonly BoardPromptFile[] = [],
    signal?: AbortSignal,
  ): Promise<boolean> {
    this.patch(windowId, { promptError: undefined, commandError: undefined, queueError: undefined })
    await this.whenReady(windowId)
    const session = this.sessionFace(windowId)
    if (session === undefined) {
      // A missing or still-restoring session must not swallow the prompt.
      this.patch(windowId, { promptError: this.t('conversation.noSession') })
      return false
    }
    const content: PromptContentPart[] = [{ type: 'text', text }]
    for (const image of images) {
      content.push({
        type: 'image',
        mediaType: image.mediaType as ImageMediaType,
        data: image.data,
        name: image.name,
      })
    }
    for (const file of files) {
      content.push({ type: 'file', receiptId: file.receiptId as never })
    }
    const submission = session.beginSubmission({
      mode,
      text,
      attachments: this.pendingAttachments(images, files),
    })
    try {
      const result = await session.prompt(content, mode, signal, submission.requestId)
      return result.ok
    } catch (error) {
      // A carrier rejection reaches no settlement of its own: the echo is
      // abandoned here so a refused prompt never leaves a phantom message.
      submission.abandon()
      this.patch(windowId, { promptError: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  /** Echo attachments of one submission: image previews and durable file references. */
  private pendingAttachments(
    images: readonly BoardDraftImage[],
    files: readonly BoardPromptFile[],
  ): readonly PendingSubmissionAttachment[] {
    const attachments: PendingSubmissionAttachment[] = images.map(image => ({
      type: 'image',
      value: {
        previewUrl: image.preview,
        ...(image.name === '' ? {} : { name: image.name }),
      },
    }))
    for (const file of files) {
      if (file.file !== undefined) attachments.push({ type: 'file', value: file.file })
    }
    return attachments
  }

  /**
   * Execute one slash-command line, arguments included, and publish its outcome
   * on the window channel. An unmatched line reports the unknown command; a
   * handler refusal reports its own text.
   * @param windowId - window identity.
   * @param line - full command line, leading slash included.
   * @param images - inline images carried with the command.
   * @param files - staged file receipts carried with the command.
   */
  executeCommand(
    windowId: WindowId,
    line: string,
    images: readonly BoardDraftImage[] = [],
    files: readonly BoardPromptFile[] = [],
  ): void {
    const sessionId = this.windows.get(windowId)?.sessionId
    if (sessionId === undefined) return
    const attachments = [
      ...images.map(image => ({
        type: 'image' as const,
        mediaType: image.mediaType as ImageMediaType,
        data: image.data,
        name: image.name,
      })),
      ...files.map(file => ({ type: 'file' as const, receiptId: file.receiptId as never })),
    ]
    this.patch(windowId, { commandError: undefined, promptError: undefined })
    void this.ctx.remote.commands.execute(sessionId, line, attachments).then((result) => {
      if (!result.ok) {
        this.patch(windowId, { commandError: this.failureText(result.error) })
        return
      }
      if (result.value === undefined) {
        this.patch(windowId, { commandError: this.t('command.unknown', { name: line.trim().split(/\s/, 1)[0] ?? line }) })
        return
      }
      this.patch(windowId, { commandError: result.value.result.kind === 'error' ? result.value.result.text : undefined })
    }).catch((error: unknown) => {
      this.patch(windowId, { commandError: error instanceof Error ? error.message : String(error) })
    })
  }

  /**
   * Stage one non-image file for the window's session through the background
   * upload service; the prompt later carries its receipt.
   * @param windowId - window identity.
   * @param name - display name of the file.
   * @param bytes - exact file bytes.
   * @returns the staged receipt and durable reference, or the failure text.
   */
  async uploadFile(windowId: WindowId, name: string, bytes: Uint8Array<ArrayBuffer>): Promise<BoardUploadResult> {
    const sessionId = this.windows.get(windowId)?.sessionId
    if (sessionId === undefined) return { error: this.t('attachment.noSession') }
    if (!this.ctx.fileUpload.available) return { error: this.t('attachment.unsupported') }
    try {
      // The blob body takes the host's background upload carrier, like the main
      // composer's file intake.
      const result = await this.ctx.fileUpload.upload(sessionId, new Blob([bytes]), name)
      if (!result.ok) return { error: this.failureText(result.error) }
      return { receiptId: result.value.receiptId, file: result.value.file }
    } catch (error) {
      // The carrier rejects when the upload route is down; the composer keeps
      // the chip and offers a retry.
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Board-namespace copy for failures the bridge produces itself. */
  private t(key: Parameters<BoardTranslate>[0], params?: Record<string, unknown>): string {
    return this.ctx.locale.bind(NS)(key, params)
  }

  /** One-line rendering of a remote failure. */
  private failureText(error: { code: string; message: string }): string {
    return `${error.code}: ${error.message}`
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
   * Switch the agent preset of the window's still-blank session.
   * @param windowId - window identity.
   * @param presetId - roster preset id.
   */
  selectAgentPreset(windowId: WindowId, presetId: string): void {
    const sessionId = this.record(windowId).sessionId
    if (sessionId === undefined) return
    void this.ctx.remote.agentPresets.select(sessionId, presetId).then((result) => {
      if (result.ok) return
      this.patch(windowId, { promptError: this.failureText(result.error) })
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
      this.patch(windowId, { promptError: error instanceof Error ? error.message : String(error) })
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
   * Apply one edit, remove, or steer action to a still-pending queued
   * occurrence. The board's text-shaped edit becomes the wire's content-block
   * replacement here; a refusal lands on the window channel as `queueError` so
   * the strip can explain itself.
   * @param windowId - window identity.
   * @param itemId - queued occurrence identity.
   * @param action - requested queue mutation.
   */
  updateQueueItem(windowId: WindowId, itemId: string, action: BoardQueueAction): void {
    const session = this.sessionFace(windowId)
    if (session === undefined) return
    this.patch(windowId, { queueError: undefined })
    const wire = action.kind === 'edit'
      ? { kind: 'edit' as const, content: [{ type: 'text' as const, text: action.text }] }
      : action
    void session.updateQueue(itemId as never, wire).then((result) => {
      if (result.ok) return
      this.patch(windowId, { queueError: this.failureText(result.error) })
    }).catch((error: unknown) => {
      this.patch(windowId, { queueError: error instanceof Error ? error.message : String(error) })
    })
  }

  /**
   * Resolve one durable queued image into a browser URL through the
   * conversation service's session-scoped cache.
   * @param windowId - window identity.
   * @param attachment - durable image reference carried by the queue row.
   * @returns the URL; rejects when the image cannot be read.
   */
  async loadQueueImage(windowId: WindowId, attachment: ImageAttachmentRef): Promise<string> {
    const sessionId = this.windows.get(windowId)?.sessionId
    if (sessionId === undefined) throw new Error('board: the window has no session')
    return await this.ctx.uiConversation.imageUrl(sessionId, attachment)
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
    this.pending.clear()
  }

  /**
   * Drop one window's bridge record when the window closes: its session
   * subscriptions and channel listeners go with it, while the session itself
   * stays alive and listed. A window that comes back (same id) starts from a
   * fresh record.
   * @param windowId - the closed window's identity.
   */
  release(windowId: WindowId): void {
    const record = this.windows.get(windowId)
    if (record === undefined) return
    record.releaseSession()
    this.windows.delete(windowId)
    this.pending.delete(windowId)
    // Closing a window drops its pair: the session stays alive and listed, the
    // stored map stops naming a window the layout no longer holds.
    this.persistBindings()
  }

  /**
   * The windows the bridge currently holds a record for.
   * @returns the open window ids in insertion order.
   */
  windowIds(): readonly WindowId[] {
    return [...this.windows.keys()]
  }

  private record(windowId: WindowId): WindowRecord {
    let record = this.windows.get(windowId)
    if (record === undefined) {
      record = { channel: createChannel(), attached: false, attaching: false, releaseSession: () => {} }
      this.windows.set(windowId, record)
    }
    return record
  }

  private sessionFace(windowId: WindowId) {
    const record = this.record(windowId)
    if (record.sessionId === undefined || !record.attached) return undefined
    return this.ctx.sessions.binding(record.sessionId)?.session
  }

  private patch(windowId: WindowId, patch: Partial<BoardWindowSessionState>): void {
    // A window that closed mid-flight (an upload settling, a command returning)
    // must not bring its record back: the publish is dropped.
    const record = this.windows.get(windowId)
    if (record === undefined) return
    record.channel.publish({ ...record.channel.getSnapshot(), ...patch })
  }

  /**
   * Adopt the stored window → session map for the windows the layout restored:
   * every pair whose session a window already shows is left alone, a pair whose
   * window lost its session is repointed, and a pair the map holds twice keeps
   * only its first window (one session, one window). Windows without a pair are
   * untouched — their body creates a session as usual. The map is then
   * reconciled against the session list: a listed session attaches now, and a
   * pending or missing one attaches when the list answers.
   * @param bindings - the stored map.
   * @param windowIds - the windows the layout currently holds.
   */
  restore(bindings: BoardSettingsBindings, windowIds: readonly WindowId[]): void {
    if (this.disposed) return
    const claimed = new Map<SessionId, WindowId>()
    const wanted: BoardSettingsBindings = {}
    let changed = false
    for (const windowId of windowIds) {
      const target = bindings[windowId as string]
      if (target === undefined || target === '') {
        changed = true
        continue
      }
      const sessionId = target as SessionId
      if (claimed.has(sessionId)) {
        // The stored map can name one session twice; the first window keeps
        // it, and the later one becomes an ordinary unbound window.
        changed = true
        continue
      }
      claimed.set(sessionId, windowId)
      wanted[windowId as string] = target
      const record = this.record(windowId)
      if (record.sessionId === sessionId) continue
      record.releaseSession()
      record.releaseSession = () => {}
      record.sessionId = sessionId
      this.resetState(windowId, 'restoring')
      changed = true
    }
    // Stale pairs (the window is gone) and duplicates leave the map here; a
    // window missing from the layout never reaches the bridge's records.
    if (changed || Object.keys(bindings).length !== Object.keys(wanted).length) this.persistBindings()
    this.reconcile()
  }

  /**
   * The window currently showing one session, when the bridge holds one.
   * @param sessionId - session identity.
   * @returns the window id, or undefined when no open window shows the session.
   */
  windowFor(sessionId: SessionId): WindowId | undefined {
    for (const [windowId, record] of this.windows) {
      if (record.sessionId === sessionId) return windowId
    }
    return undefined
  }

  /**
   * The current window → session map, the exact value the persistence layer
   * stores. A missing session keeps its pair so the window can reattach.
   * @returns the map of every window with a session.
   */
  bindings(): BoardSettingsBindings {
    const bindings: BoardSettingsBindings = {}
    for (const [windowId, record] of this.windows) {
      if (record.sessionId !== undefined) bindings[windowId] = record.sessionId
    }
    return bindings
  }

  private async create(windowId: WindowId): Promise<void> {
    const record = this.record(windowId)
    const before = record.sessionId
    try {
      const sessionId = await this.ctx.sessions.create()
      if (this.disposed) return
      // A creation that settles late must not clobber a newer gesture: the
      // window may have closed (the record is gone) or its chat may have
      // moved on (a bind, or a recovery the user started meanwhile).
      if (this.windows.get(windowId) !== record || record.sessionId !== before) return
      this.switchTo(windowId, sessionId)
    } catch (error) {
      if (this.windows.get(windowId) !== record) return
      this.fail(windowId, error)
    }
  }

  /**
   * Point the window at an addressable session; a session the list does not
   * know reports `unknown`, and a session another window already shows is not
   * rebound — the caller focuses that window instead.
   * @param windowId - window identity.
   * @param sessionId - listed or addressed session id.
   * @returns what the bind did, for the calling surface to act on.
   */
  bind(windowId: WindowId, sessionId: SessionId): BoardBindOutcome {
    if (this.disposed) return { kind: 'unknown' }
    const record = this.record(windowId)
    if (record.sessionId === sessionId) {
      // The user's own gesture retries an attach that failed earlier.
      if (!record.attached && this.ctx.sessions.list.getSnapshot().byId[sessionId] !== undefined) {
        this.attach(windowId, sessionId)
      }
      return { kind: 'same' }
    }
    if (this.ctx.sessions.list.getSnapshot().byId[sessionId] === undefined) return { kind: 'unknown' }
    const holder = this.windowFor(sessionId)
    if (holder !== undefined) return { kind: 'duplicate', windowId: holder }
    this.switchTo(windowId, sessionId)
    return { kind: 'bound' }
  }

  /**
   * Create a chat and bind the window to it.
   * @param windowId - window identity.
   * @param target - the workspace the chat joins, or the directory it runs in.
   */
  createChat(windowId: WindowId, target: BoardChatTarget): void {
    const record = this.record(windowId)
    const before = record.sessionId
    void this.ctx.sessions.create(target).then((sessionId) => {
      if (this.disposed) return
      // A late creation never resurrects a closed window or replaces a chat
      // the window moved to while the request was in flight.
      if (this.windows.get(windowId) !== record || record.sessionId !== before) return
      this.switchTo(windowId, sessionId)
    }).catch((error: unknown) => {
      if (this.windows.get(windowId) === record) this.fail(windowId, error)
    })
  }

  /** Release the current binding and attach the window to the given session. */
  private switchTo(windowId: WindowId, sessionId: SessionId): void {
    const record = this.record(windowId)
    record.releaseSession()
    record.releaseSession = () => {}
    record.sessionId = sessionId
    this.attach(windowId, sessionId)
    this.persistBindings()
  }

  /** Hand the current map to the apply-side sink; nothing is written when the bridge is closing. */
  private persistBindings(): void {
    if (this.disposed) return
    this.hooks.persistBindings?.(this.bindings())
  }

  /**
   * Put one bound window into a session-less state: the subscriptions are
   * already gone, the last title and directory stay for the frame and the
   * "create" action, and everything derived from the dead session is cleared.
   * @param windowId - window identity.
   * @param status - `restoring` while the list has not answered, `missing` once it has.
   */
  private resetState(windowId: WindowId, status: 'restoring' | 'missing'): void {
    const record = this.record(windowId)
    const previous = record.channel.getSnapshot()
    // Repeated reconciles of an unchanged bound window republish nothing.
    if (previous.status === status && previous.sessionId === record.sessionId) return
    // The last title and directory describe the session the window still
    // wants; a rebind to another session drops them with the old chat.
    const sameTarget = previous.sessionId === record.sessionId
    record.channel.publish({
      ...emptyState(),
      status,
      // The record owns the wanted session: a restored window names its chat
      // even when the list has not confirmed it yet.
      ...(record.sessionId === undefined ? {} : { sessionId: record.sessionId }),
      ...(sameTarget && previous.displayTitle !== undefined ? { displayTitle: previous.displayTitle } : {}),
      ...(sameTarget && previous.cwd !== undefined ? { cwd: previous.cwd } : {}),
    })
  }

  /**
   * Reconcile every bound window against the session list snapshot: a listed
   * session attaches (or stays attached), a pending list defers, and a session
   * the ready list no longer holds moves its window to `missing`. The list is
   * the authority, so a session that returns reattaches on a later pass.
   */
  private reconcile(): void {
    if (this.disposed) return
    const list = this.ctx.sessions.list.getSnapshot()
    for (const [windowId, record] of this.windows) {
      const sessionId = record.sessionId
      if (sessionId === undefined || record.attaching) continue
      if (list.byId[sessionId] !== undefined) {
        if (!record.attached) this.attach(windowId, sessionId)
        continue
      }
      if (list.phase === 'pending') {
        this.resetState(windowId, 'restoring')
        continue
      }
      if (record.attached) record.releaseSession()
      this.resetState(windowId, 'missing')
    }
  }

  /**
   * Subscribe the window to a session: its chat target, session snapshot,
   * projections, and list row, plus the session-adjacent state (presets,
   * permissions, model directory, commands, and the conversation block).
   */
  private attach(windowId: WindowId, sessionId: SessionId): void {
    const record = this.record(windowId)
    const channel = record.channel
    record.attaching = true
    try {
      // The live event stream exists only for the session opened as current.
      this.ctx.sessions.open(sessionId)
      const owner = this.ctx.sessions.binding(sessionId)
      if (owner === undefined) throw new Error(`board: session "${sessionId}" is not addressable when the window attaches`)
      const chat = this.ctx.uiConversation.binding(sessionId).target('chat')
      const { session } = owner
      const { projections } = session

      const republish = (): void => {
        const snapshot = session.getSnapshot()
        const row = this.ctx.sessions.list.getSnapshot().byId[sessionId]
        const permissions = projections.faceOf('permissions').getSnapshot() as
          | { currentValue: string } | undefined
        const plan = projections.faceOf('plan').getSnapshot() as { active: boolean } | undefined
        const todos = projections.faceOf('todos').getSnapshot() as readonly BoardTodoRow[] | null | undefined
        const goal = projections.faceOf('goal').getSnapshot() as
          | { goal: { objective: string; phase: BoardGoalState['phase'] } } | null | undefined
        const pressure = projections.faceOf('contextPressure').getSnapshot() as
          | { pressureTokens?: number; projectedTokens?: number; contextWindow?: number } | undefined
        const limits = projections.faceOf('imageLimits').getSnapshot() as ImageAttachmentLimits | null | undefined
        const used = pressure?.projectedTokens ?? pressure?.pressureTokens
        const queue: BoardQueueRow[] = snapshot.queue.flatMap((item) => {
          const placement = queuePlacement(item)
          return placement === null ? [] : [{
            id: String(item.id),
            preview: item.preview,
            text: item.text,
            placement,
            attachments: queueAttachments(item.content),
          }]
        })
        // An echo whose occurrence already arrived stays with the durable row or
        // the lane's steering bubble; the advertised identity (rpcId) closes the
        // overlap for every placement.
        const admitted = new Set(snapshot.queue.flatMap(item => item.rpcId === undefined ? [] : [item.rpcId]))
        const pending: BoardPendingRow[] = snapshot.pendingSubmissions
          .filter(submission => !admitted.has(submission.requestId))
          .map(submission => ({
            id: submission.requestId,
            placement: submission.placement,
            text: submission.text,
            images: submission.attachments.flatMap((attachment, index) => attachment.type === 'image'
              ? [{
                id: `${submission.requestId}:${index}`,
                preview: attachment.value.previewUrl,
                ...(attachment.value.name === undefined ? {} : { name: attachment.value.name }),
              }]
              : []),
            files: submission.attachments.flatMap(attachment => attachment.type === 'file' ? [attachment.value.name] : []),
          }))
        channel.publish({
          ...channel.getSnapshot(),
          status: 'ready',
          running: snapshot.running,
          error: undefined,
          turnError: snapshot.lastAgentError ?? undefined,
          promptError: snapshot.promptError === null
            ? undefined
            : this.failureText(snapshot.promptError.error),
          chat: chat.getSnapshot(),
          sessionId,
          displayTitle: row?.displayTitle,
          cwd: row?.cwd,
          blank: row?.blank ?? true,
          hasMore: snapshot.hasMore,
          loadingOlder: snapshot.loadingOlder,
          runningCalls: chat.getSnapshot()?.legacy.runningCalls.map(call => ({ id: call.callId, name: call.name })) ?? [],
          imageLimits: limits == null ? undefined : {
            maxImageBytes: limits.maxImageBytes,
            maxImagesPerMessage: limits.maxImagesPerMessage,
            maxMessageImageBytes: limits.maxMessageImageBytes,
            mediaTypes: limits.mediaTypes,
          },
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
          pending,
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
      listen(projections.faceOf('imageLimits'))
      listen(this.ctx.sessions.list)
      record.releaseSession = () => {
        record.attached = false
        for (const dispose of disposers) dispose()
        disposers.length = 0
      }
      record.attached = true

      // Presets, permission rows, the model directory, commands, and the
      // conversation block are session-adjacent state fetched once per window.
      // The permissions projection already rides the republish listeners above;
      // only its row table needs its own fold.
      void this.syncPresets(windowId)
      this.patch(windowId, { permissions: this.permissionRows(projections) })
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
      record.attached = false
      this.fail(windowId, error)
    } finally {
      record.attaching = false
    }
  }

  /**
   * Start a chat in a workspace, reusing its blank session when it has one, and
   * point the window at it.
   * @param windowId - window identity.
   * @param workspaceId - workspace to run the chat in; omitted uses the window's own directory.
   */
  async startChat(windowId: WindowId, workspaceId?: WorkspaceId): Promise<void> {
    if (workspaceId !== undefined) {
      const workspace = this.ctx.workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
      if (workspace === undefined) return
      // The project's reusable empty session is reused only while no other
      // window shows it: one session, one window, even for a blank chat.
      const blank = workspace.sessionIds.find((id) => {
        const row = this.ctx.sessions.list.getSnapshot().byId[id]
        if (row?.blank !== true) return false
        const holder = this.windowFor(id)
        return holder === undefined || holder === windowId
      })
      if (blank !== undefined) {
        this.switchTo(windowId, blank)
        return
      }
      await this.createChatTarget(windowId, { workspaceId })
      return
    }
    const current = this.record(windowId).channel.getSnapshot().cwd
    await this.createChatTarget(windowId, current === undefined ? {} : { cwd: current })
  }

  /**
   * Rename one chat.
   * @param sessionId - chat identity.
   * @param title - new durable title.
   */
  async renameChat(sessionId: SessionId, title: string): Promise<void> {
    await this.ctx.sessions.binding(sessionId)?.session.rename(title)
  }

  /**
   * Branch one chat at its last completed turn and bind the window to the child.
   * @param windowId - window identity.
   * @param sessionId - chat to branch.
   */
  async forkChat(windowId: WindowId, sessionId: SessionId): Promise<void> {
    const record = this.record(windowId)
    const child = await this.ctx.sessions.fork({ sessionId, increaseTitle: true })
    if (this.disposed) return
    if (this.windows.get(windowId) !== record || record.sessionId !== sessionId) return
    this.switchTo(windowId, child)
  }

  /**
   * Archive one chat. The client exposes no unarchive.
   * @param sessionId - chat identity.
   */
  async archiveChat(sessionId: SessionId): Promise<void> {
    await this.ctx.workspaces.archiveSession(sessionId)
  }

  /**
   * Move one chat inside its workspace's manual order.
   * @param workspaceId - workspace the chat belongs to.
   * @param sessionId - chat to move.
   * @param beforeSessionId - chat it moves before; omitted appends.
   */
  async reorderChat(workspaceId: WorkspaceId, sessionId: SessionId, beforeSessionId?: SessionId): Promise<void> {
    await this.ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId)
  }

  /**
   * Register a workspace for one directory; an existing registration is reused.
   * @param path - directory to register.
   */
  async createWorkspace(path: string): Promise<void> {
    await this.ctx.workspaces.create({ path })
  }

  /**
   * Rename one workspace.
   * @param workspaceId - workspace identity.
   * @param title - new display title.
   */
  async renameWorkspace(workspaceId: WorkspaceId, title: string): Promise<void> {
    await this.ctx.workspaces.rename(workspaceId, title)
  }

  /**
   * Delete one workspace registration; its chats and files stay untouched.
   * @param workspaceId - workspace identity.
   */
  async deleteWorkspace(workspaceId: WorkspaceId): Promise<void> {
    await this.ctx.workspaces.delete(workspaceId)
  }

  /**
   * Move one workspace in the registry order.
   * @param workspaceId - workspace to move.
   * @param beforeWorkspaceId - workspace it moves before; omitted appends.
   */
  async reorderWorkspace(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void> {
    await this.ctx.workspaces.insertBefore(workspaceId, beforeWorkspaceId)
  }

  /**
   * List one directory level for the panel's folder browser.
   * @param path - directory to list; omitted lists the home directory.
   * @returns the directory level, with the entries the panel renders.
   */
  async listDirectory(path?: string): Promise<BoardDirectoryListing> {
    const listing = await this.ctx.uiWorkspace.listDirectory(path)
    return {
      path: listing.path,
      home: listing.home,
      crumbs: listing.crumbs.map(crumb => ({ name: crumb.name, path: crumb.path })),
      entries: listing.entries.map(entry => ({ name: entry.name, path: entry.path, hidden: entry.hidden })),
      truncated: listing.truncated,
    }
  }

  /**
   * Create one directory inside a parent.
   * @param path - parent directory.
   * @param name - single new folder name.
   * @returns the created directory's path.
   */
  async createDirectory(path: string, name: string): Promise<string> {
    return await this.ctx.uiWorkspace.createDirectory(path, name)
  }

  /**
   * Pick one directory through the host's chooser.
   * @returns the picked path, or null when the dialog was dismissed.
   */
  async pickDirectory(): Promise<string | null> {
    return await this.ctx.uiWorkspace.pickDirectory()
  }

  /** Create a chat from a target and point the window at it. */
  private async createChatTarget(windowId: WindowId, target: BoardChatTarget): Promise<void> {
    const record = this.record(windowId)
    const before = record.sessionId
    const sessionId = await this.ctx.sessions.create(target)
    if (this.disposed) return
    if (this.windows.get(windowId) !== record || record.sessionId !== before) return
    this.switchTo(windowId, sessionId)
  }

  /** Publish one failure onto the window's channel. */
  private fail(windowId: WindowId, error: unknown): void {
    const channel = this.record(windowId).channel
    channel.publish({
      ...channel.getSnapshot(),
      status: 'error',
      running: false,
      error: error instanceof Error ? error.message : String(error),
    })
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
          this.patch(windowId, { promptError: this.failureText(result.error) })
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
      this.patch(windowId, { promptError: error instanceof Error ? error.message : String(error) })
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
