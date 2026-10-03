/**
 * Board test bench: the client test runtime plus the services the board
 * injects (locale, sessions, the conversation binding). The board
 * itself is mounted by the caller so deferred-declaration paths stay testable.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { Context } from '@deepseek-ai/cordis'
import type {
  RemoteResult, SettingsDescribeValue, SettingsNamespaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SettingsDescribeFace, SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ChatSnapshot, ConversationNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { BoardWindowSessionState } from '../src/client/contract/slots.ts'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'
import { en, type BoardTranslate } from '../src/client/locale.ts'

/** English-bound locale seat for direct component renders; interpolates `{name}` params. */
export const t: BoardTranslate = (key, params) => {
  const dictionary: Record<string, string> = en
  const template = dictionary[key] ?? key
  const values: Record<string, unknown> = params ?? {}
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = values[name]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  })
}

/** Options of one board bench. */
export interface BoardBenchOptions {
  /** Directory verbs the panel's folder browser calls; omitted keeps them inert. */
  readonly uiWorkspace?: {
    readonly openSession?: (sessionId: SessionId) => void
    readonly pickDirectory?: () => Promise<string | null>
    readonly listDirectory?: (path?: string) => Promise<{
      path: string
      home: string
      crumbs: readonly { name: string; path: string }[]
      entries: readonly { name: string; path: string; hidden: boolean }[]
      truncated: boolean
    }>
    readonly createDirectory?: (path: string, name: string) => Promise<string>
  }
  /** Declare the occupied slots before the caller mounts the board (default true). */
  declareSlots?: boolean
  /** Session verb overrides grafted onto the fixture session the bridge creates. */
  session?: Record<string, unknown>
  /** List-row overrides of the fixture session, e.g. its display title. */
  sessionSummary?: Partial<Omit<SessionSummary, 'id'>>
  /** Additional listed chats a test can rebind a window to. */
  extraSessions?: readonly {
    readonly id: string
    readonly displayTitle: string
    readonly session?: Record<string, unknown>
    /** Extra list-row fields, e.g. the working directory a folder chip reads. */
    readonly summary?: Partial<Omit<SessionSummary, 'id'>>
  }[]
  /** Background upload service overrides; the default stages every file as `receipt-1`. */
  fileUpload?: {
    readonly available?: boolean
    readonly upload?: (sessionId: SessionId, ...args: unknown[]) => Promise<unknown>
  }
  /** Preset roster double; the default answers an empty roster with selection enabled. */
  readonly agentPresets?: {
    readonly list?: () => Promise<unknown>
    readonly select?: (sessionId: SessionId, presetId: string) => Promise<unknown>
  }
  /** Settings namespace doubles; the default replace accepts any section. */
  remoteSettings?: {
    readonly replace?: (
      ns: string,
      section: Record<string, unknown>,
      expectedRevision: number | undefined,
    ) => Promise<RemoteResult<SettingsNamespaceView>>
  }
  /** Remote session verb overrides. */
  readonly remoteSession?: {
    readonly canOpenWorkspacePath?: () => Promise<RemoteResult<boolean>>
    readonly openWorkspacePath?: (req: { path: string; action?: 'reveal' }) => Promise<RemoteResult<{ opened: boolean }>>
  }
  /** View the shared describe mirror holds before the board mounts; omitted starts idle. */
  readonly settingsView?: SettingsDescribeValue
  /** Per-session chat target resolver; if omitted, defaults to the bench's shared chat store. */
  readonly chatTargetFor?: (sessionId: string) => ObservableSnapshot<ChatSnapshot | undefined>
  /** Custom session creation behavior overriding the default stub. */
  readonly createSession?: (opts?: unknown) => Promise<SessionId>
  /** Model directory behavior overrides; the default store never fails. */
  readonly modelDirectory?: {
    /** Catalog load behavior; a rejecting load exercises late failures. */
    readonly load?: () => Promise<unknown>
    /** Selection spy; the default accepts every selection. */
    readonly select?: (selection: { provider: string; model: string; reasoningEffort?: string }) => Promise<void>
  }
  /** Workspace file reads the right panel's files tab and viewer perform. */
  readonly workspaceFiles?: {
    readonly list?: (sessionId: SessionId, path: string, signal?: AbortSignal) => Promise<unknown>
    readonly read?: (sessionId: SessionId, path: string, range: unknown, signal?: AbortSignal) => Promise<unknown>
    readonly readAll?: (sessionId: SessionId, path: string, signal?: AbortSignal) => Promise<unknown>
  }
  /** Document-preview registry double overrides; the default matches by extension. */
  readonly documentPreviews?: {
    readonly candidates?: (path: string) => readonly unknown[]
  }
}

/** One document-preview definition as the board's projected face reads it. */
interface DocumentPreviewDouble {
  readonly id: string
  readonly extensions: readonly string[]
  readonly priority: 'builtin'
  readonly title: () => string
  readonly loading: 'bytes-complete' | 'text-pages'
}

/** Suffixes the bench's default preview double reads as complete bytes. */
const BENCH_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'] as const

/**
 * Default preview registry double: images and PDFs read complete bytes, every
 * other path reads a page of text.
 * @param path - file path the panel is about to view.
 * @returns the matching definitions in automatic-selection order.
 */
function defaultPreviewCandidates(path: string): readonly DocumentPreviewDouble[] {
  const name = path.replaceAll('\\', '/').toLowerCase()
  const base = name.slice(name.lastIndexOf('/') + 1)
  const extension = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : ''
  if ((BENCH_IMAGE_EXTENSIONS as readonly string[]).includes(extension)) {
    return [{ id: 'image', extensions: BENCH_IMAGE_EXTENSIONS, priority: 'builtin', title: () => 'Image', loading: 'bytes-complete' }]
  }
  if (extension === 'pdf') {
    return [{ id: 'pdf', extensions: ['pdf'], priority: 'builtin', title: () => 'PDF', loading: 'bytes-complete' }]
  }
  return [{ id: 'text', extensions: [], priority: 'builtin', title: () => 'Text', loading: 'text-pages' }]
}

/** One prepared bench: the runtime, its services, and the board mount. */
export interface BoardBench {
  runtime: SlotTestRuntime
  /** The installed locale service, for locale-switching assertions. */
  locale: LocaleRuntime
  /** The chat target observable the bridge subscribes to for the created session. */
  chat: SnapshotStore<ChatSnapshot | undefined>
  /** The describe mirror double backing `ctx.configForms`. */
  settings: ConfigFormsDouble
  /** Mount the board plugin on the prepared runtime. */
  mountBoard: () => Promise<{ dispose: () => Promise<void> }>
}

/** Settings describe mirror double the bench installs as the `configForms` service. */
export interface ConfigFormsDouble {
  /** The mirror read/fold face the board derives from. */
  readonly face: SettingsDescribeFace
  /**
   * Replace the held view; undefined clears it back to no answer.
   * @param view - the describe answer the mirror should serve next.
   */
  setView(view: SettingsDescribeValue | undefined): void
  /** Publish the terminal non-loopback state: no read, no write, no adoption. */
  setUnavailable(): void
  /** Namespace views folded through `acceptView`, in order. */
  readonly accepted: readonly SettingsNamespaceView[]
}

/**
 * Build a settings describe mirror double: a snapshot store with the same
 * read/fold surface as the shared mirror, plus direct scripting for tests.
 * @param view - view held before any ensure; omitted starts the mirror idle.
 * @returns the double, its face, and the accepted-view log.
 */
export function createConfigFormsDouble(view?: SettingsDescribeValue): ConfigFormsDouble {
  const store = createSnapshotStore<SettingsMirrorSnapshot>({
    status: view === undefined ? 'idle' : 'ready',
    view,
    error: null,
  })
  const accepted: SettingsNamespaceView[] = []
  return {
    face: {
      getSnapshot: () => store.getSnapshot(),
      subscribe: fn => store.subscribe(fn),
      ensure: async () => {},
      acceptView: (next) => {
        accepted.push(next)
        const before = store.getSnapshot()
        if (before.view === undefined) return
        const namespaces = before.view.namespaces.some(row => row.ns === next.ns)
          ? before.view.namespaces.map(row => row.ns === next.ns ? next : row)
          : [...before.view.namespaces, next]
        store.set({ ...before, view: { ...before.view, namespaces } })
      },
    },
    setView: (next) => {
      store.set({ status: next === undefined ? 'idle' : 'ready', view: next, error: null })
    },
    setUnavailable: () => {
      store.set({ status: 'unavailable', view: undefined, error: null })
    },
    accepted,
  }
}

/** An empty assembled chat snapshot with the lane fields the body reads. */
export function chatSnapshot(
  nodes: readonly ConversationNode[] = [],
  partial: ChatSnapshot['legacy']['partial'] = null,
  runningCalls: ChatSnapshot['legacy']['runningCalls'] = [],
): ChatSnapshot {
  return {
    order: [],
    nodes: {
      get: () => undefined,
      source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
      processSource: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
      values: () => [],
    },
    locations: { getTurn: () => [], getStep: () => [] },
    navigation: { items: () => [] },
    timeline: { turnOrder: [], turns: new Map() },
    legacy: { nodes, turnTimings: new Map(), turnEnds: new Map(), partial, runningCalls },
  }
}

/** One ready-session channel state over the supplied chat snapshot. */
export function sessionState(
  chat: ChatSnapshot | undefined,
  overrides: Partial<BoardWindowSessionState> = {},
): BoardWindowSessionState {
  return {
    status: 'ready',
    running: false,
    blank: true,
    hasMore: false,
    loadingOlder: false,
    presets: [],
    presetPickerEnabled: true,
    permissions: [],
    plan: false,
    queue: [],
    pending: [],
    todos: [],
    model: { efforts: [], groups: [], loading: false },
    commands: [],
    chat,
    ...overrides,
  }
}

/**
 * Prepare a runtime carrying every service the board injects.
 * @param options - slot-declaration ordering and session verb overrides.
 * @returns the bench; the caller mounts the board through {@link BoardBench.mountBoard}.
 */
export async function createBoardBench(options: BoardBenchOptions = {}): Promise<BoardBench> {
  const runtime = await SlotTestRuntime.create()
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  await runtime.mount({
    inject: ['slots'],
    apply(ctx: Context) {
      ctx.provide('locale', locale)
      ctx.slots.installLocale(locale)
    },
  })

  // One chat target per session id, mirroring ui-conversation's binding face.
  const chat = createSnapshotStore<ChatSnapshot | undefined>(undefined)
  const chats = new Map<string, ObservableSnapshot<ChatSnapshot | undefined>>()
  const targetFor = (sessionId: string): ObservableSnapshot<ChatSnapshot | undefined> => {
    if (options.chatTargetFor !== undefined) {
      return options.chatTargetFor(sessionId)
    }
    let target = chats.get(sessionId)
    if (target === undefined) {
      target = chat
      chats.set(sessionId, target)
    }
    return target
  }
  // The board declares its panel as sidebar-less through ctx.layout (Т2.7);
  // the double mirrors the controller: the declaration is visible until its
  // disposer clears it, and selection stays inert unless a test overrides it.
  const sidebarDeclarations: Record<string, boolean> = {}
  const selectPanelCalls: string[] = []
  runtime.ctx.provide('layout', {
    selectPanel: (panelId: string | null) => { selectPanelCalls.push(panelId ?? 'null') },
    sidebarDeclarations,
    selectPanelCalls,
    declarePanelSidebar: (panelId: string, sidebar: boolean) => {
      sidebarDeclarations[panelId] = sidebar
      return () => { Reflect.deleteProperty(sidebarDeclarations, panelId) }
    },
  } as never)
  // The board declares the uiWorkspace service for its panel actions; the
  // directory verbs stay inert until a test stubs them. `openSession` records
  // the standard-interface handoff of `expandToStandard` (Т2.1).
  const openedSessions: string[] = []
  runtime.ctx.provide('uiWorkspace', {
    pickDirectory: async () => null,
    listDirectory: async () => ({ path: '', home: '', crumbs: [], entries: [], truncated: false }),
    createDirectory: async () => '',
    openSession: (sessionId: string) => { openedSessions.push(sessionId) },
    openedSessions,
    ...options.uiWorkspace,
  } as never)
  // The standard composer the board hands a window's draft to (Т2.1/Т2.4):
  // one recording input facade per session scope. `addFilesMode` lets a test
  // stage the refusals the expand control must report.
  interface StandardInputDouble {
    drafts: string[]
    files: (readonly File[])[]
    current: string
    state: { getSnapshot: () => { draft: string } }
    setDraft: (text: string) => void
    addFiles: (files: readonly File[]) => boolean
    takeDraft: () => Promise<{ text: string; attachments: readonly StandardAttachment[] } | undefined>
  }
  type StandardAttachment =
    | { readonly type: 'image'; readonly mediaType: string; readonly data: string; readonly name: string }
    | { readonly type: 'file'; readonly receiptId: string; readonly name: string }
  /** Base64 payload of one browser file, the shape the standard composer serializes. */
  const base64Of = async (file: File): Promise<string> => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }
  const standardInputs = new Map<string, StandardInputDouble>()
  let addFilesMode: 'ok' | 'busy' | 'throw' = 'ok'
  let takeDraftMode: 'ok' | 'refuse' = 'ok'
  const ensureStandardInput = (sessionId: string): StandardInputDouble => {
    let input = standardInputs.get(sessionId)
    if (input === undefined) {
      input = {
        drafts: [],
        files: [],
        current: '',
        state: { getSnapshot: () => ({ draft: input!.current }) },
        setDraft(text: string) { input!.drafts.push(text); input!.current = text },
        addFiles(files: readonly File[]) {
          if (addFilesMode === 'throw') throw new Error('probe failure')
          if (addFilesMode === 'busy') return false
          input!.files.push(files)
          return true
        },
        async takeDraft() {
          if (takeDraftMode === 'refuse') return undefined
          const text = input!.current
          const attachments: StandardAttachment[] = []
          for (const batch of input!.files) {
            for (const file of batch) {
              attachments.push(file.type.startsWith('image/')
                ? { type: 'image', mediaType: file.type, data: await base64Of(file), name: file.name }
                : { type: 'file', receiptId: `receipt:${file.name}`, name: file.name })
            }
          }
          input!.current = ''
          input!.files = []
          return { text, attachments }
        },
      }
      standardInputs.set(sessionId, input)
    }
    return input
  }
  runtime.ctx.provide('conversation', {
    setAddFilesMode: (mode: 'ok' | 'busy' | 'throw') => { addFilesMode = mode },
    setTakeDraftMode: (mode: 'ok' | 'refuse') => { takeDraftMode = mode },
    seedStandardDraft: (sessionId: string, text: string) => {
      const input = ensureStandardInput(sessionId)
      input.current = text
      return input
    },
    input: {
      for: (actx: { }) => ensureStandardInput(String(runtime.ctx.get('sessions')?.scopeOf(actx as never) ?? 'unknown')),
    },
    standardInputs,
  } as never)
  runtime.ctx.provide('uiConversation', {
    binding: (source: string) => ({
      target: (name: string) => name === 'chat' ? targetFor(source) : undefined,
    }),
    imageUrl: async () => 'blob:board-image-1',
  } as never)
  // Remote and model-directory doubles: the bridge reads presets, commands,
  // mentions, and the model catalog through them when a window gets a session.
  const modelStore = createSnapshotStore<{
    current: { provider: string; model: string } | null
    routable: boolean | null
    groups: unknown[]
    failures: unknown[]
    status: 'idle'
    error: string | null
  }>({ current: null, routable: true, groups: [], failures: [], status: 'idle', error: null })
  const modelDirectories = {
    directoryFor: () => ({
      store: modelStore,
      load: options.modelDirectory?.load ?? (async () => modelStore.getSnapshot()),
      select: options.modelDirectory?.select ?? (async () => {}),
    }),
  }
  runtime.ctx.provide('modelDirectories', modelDirectories as never)
  const emptyView = (): SettingsNamespaceView => ({
    ns: 'ui-board',
    schema: {},
    value: {},
    applies: 'live',
    secrets: [],
    revision: 0,
  })
  const settings = {
    replace: options.remoteSettings?.replace
      ?? (async () => ({ ok: true as const, value: emptyView() })),
  }
  const configForms = createConfigFormsDouble(options.settingsView)
  runtime.ctx.provide('configForms', { describe: () => configForms.face } as never)
  // Workspace file reads the right panel performs: a listing, a page of text,
  // and complete bytes. Every verb accepts the producer's signal.
  const workspaceFiles = {
    list: options.workspaceFiles?.list
      ?? (async () => ({ ok: true as const, value: { path: '', entries: [], truncated: false } })),
    read: options.workspaceFiles?.read
      ?? (async () => ({ ok: true as const, value: { absolutePath: '', version: 'v1', offset: 1, text: '', lines: 0, eof: true } })),
    readAll: options.workspaceFiles?.readAll
      ?? (async () => ({ ok: true as const, value: { absolutePath: '', version: 'v1', offset: 0, data: '', eof: true } })),
  }
  // The document-preview registry the board's `documentPreviewFor` reads.
  runtime.ctx.provide('documentPreviews', {
    candidates: options.documentPreviews?.candidates ?? defaultPreviewCandidates,
  } as never)
  // Remote change events ride the runtime's TestRemote (`runtime.remote.$on`
  // and `emit`); the namespaces below become `ctx.remote.<name>` services.
  runtime.remote.provideNamespaces({
    settings,
    workspaceFiles,
    agentPresets: {
      list: options.agentPresets?.list
        ?? (async () => ({ ok: true as const, value: { presets: [], authorable: false, modeSelectionEnabled: true } })),
      select: options.agentPresets?.select ?? (async () => ({ ok: true as const, value: undefined })),
    },
    commands: {
      list: async () => ({ ok: true as const, value: [] }),
      execute: async () => ({ ok: true as const, value: undefined }),
    },
    fileReferences: { list: async () => ({ ok: true as const, value: [] }) },
    sessionReferenceResolver: { candidates: async () => ({ ok: true as const, value: [] }) },
    goals: {
      pause: async () => ({ ok: true as const, value: undefined }),
      resume: async () => ({ ok: true as const, value: undefined }),
      clear: async () => ({ ok: true as const, value: undefined }),
    },
    session: {
      canOpenWorkspacePath: options.remoteSession?.canOpenWorkspacePath
        ?? (async () => ({ ok: true as const, value: true })),
      openWorkspacePath: options.remoteSession?.openWorkspacePath
        ?? (async () => ({ ok: true as const, value: { opened: true } })),
    },
  })
  // Background uploads: the runtime's stub is replaced with one that stages a
  // receipt the prompt can carry, so file intake works unless a test opts out.
  runtime.fileUpload.available = options.fileUpload?.available ?? true
  runtime.fileUpload.upload = options.fileUpload?.upload ?? (async () => ({
    ok: true as const,
    value: { receiptId: 'receipt-1', file: { id: 'file-1', name: 'file' } },
  }))

  if (options.session !== undefined) {
    // Pre-add the fixture session: the double's add() stabilizes through act,
    // and calling it from the window's mount effect would nest act scopes.
    // Production create() is a remote round-trip with no act involvement.
    const sessionId = await runtime.sessions.add({
      id: 'session-1',
      session: options.session,
      ...(options.sessionSummary === undefined ? {} : { summary: options.sessionSummary }),
    })
    runtime.sessions.stubCreate(async () => sessionId)
  }
  for (const extra of options.extraSessions ?? []) {
    await runtime.sessions.add({
      id: extra.id,
      session: extra.session ?? options.session ?? {},
      summary: { displayTitle: extra.displayTitle, ...extra.summary },
    }, { current: false })
  }
  if (options.createSession !== undefined) {
    runtime.sessions.stubCreate(options.createSession)
  }
  if (options.declareSlots !== false) {
    await runtime.declare({
      main: { kind: 'keyed', scope: 'root' },
      'sidebar.brand.actions': { kind: 'list', scope: 'root' },
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
      'conversation.session.header.blank': { kind: 'list', scope: 'session' },
    })
  }
  return {
    runtime,
    locale,
    chat,
    settings: configForms,
    mountBoard: () => runtime.mount({ inject: [...inject], apply }),
  }
}
