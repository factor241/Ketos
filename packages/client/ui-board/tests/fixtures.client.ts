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
  extraSessions?: readonly { readonly id: string; readonly displayTitle: string }[]
  /** Background upload service overrides; the default stages every file as `receipt-1`. */
  fileUpload?: {
    readonly available?: boolean
    readonly upload?: (sessionId: SessionId, ...args: unknown[]) => Promise<unknown>
  }
  /** Settings namespace doubles; the default replace accepts any section. */
  remoteSettings?: {
    readonly replace?: (
      ns: string,
      section: Record<string, unknown>,
      expectedRevision: number | undefined,
    ) => Promise<RemoteResult<SettingsNamespaceView>>
  }
  /** View the shared describe mirror holds before the board mounts; omitted starts idle. */
  readonly settingsView?: SettingsDescribeValue
}

/** One prepared bench: the runtime, its services, and the board mount. */
export interface BoardBench {
  runtime: SlotTestRuntime
  /** The installed locale service, for locale-switching assertions. */
  locale: LocaleRuntime
  /** The chat target observable the bridge subscribes to for the created session. */
  chat: SnapshotStore<ChatSnapshot | undefined>
  /** The describe mirror double backing `ctx.settingsScope`. */
  settings: SettingsScopeDouble
  /** Mount the board plugin on the prepared runtime. */
  mountBoard: () => Promise<{ dispose: () => Promise<void> }>
}

/** Settings describe mirror double the bench installs as the `settingsScope` service. */
export interface SettingsScopeDouble {
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
export function createSettingsScopeDouble(view?: SettingsDescribeValue): SettingsScopeDouble {
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
    legacy: { nodes, turnTimings: new Map(), turnEnds: new Map(), partial, runningCalls: [] },
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
    runningCalls: [],
    presets: [],
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
    let target = chats.get(sessionId)
    if (target === undefined) {
      target = chat
      chats.set(sessionId, target)
    }
    return target
  }
  // The board declares the uiWorkspace service for its panel actions; the
  // directory verbs stay inert until a test stubs them.
  runtime.ctx.provide('uiWorkspace', {
    pickDirectory: async () => null,
    listDirectory: async () => ({ path: '', home: '', crumbs: [], entries: [], truncated: false }),
    createDirectory: async () => '',
    ...options.uiWorkspace,
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
      load: async () => modelStore.getSnapshot(),
      select: async () => {},
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
  const settingsScope = createSettingsScopeDouble(options.settingsView)
  runtime.ctx.provide('settingsScope', { describe: () => settingsScope.face } as never)
  const remote = {
    settings,
    agentPresets: { list: async () => ({ ok: true as const, value: { presets: [], authorable: false, modeSelectionEnabled: false } }) },
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
  }
  runtime.ctx.provide('remote', remote as never)
  // Background uploads: the runtime's stub is replaced with one that stages a
  // receipt the prompt can carry, so file intake works unless a test opts out.
  runtime.fileUpload.available = options.fileUpload?.available ?? true
  runtime.fileUpload.upload = options.fileUpload?.upload ?? (async () => ({
    ok: true as const,
    value: { receiptId: 'receipt-1', file: { id: 'file-1', name: 'file' } },
  }))
  runtime.ctx.provide('remote.settings', settings as never)
  for (const name of ['remote.commands', 'remote.agentPresets', 'remote.goals', 'remote.fileReferences', 'remote.sessionReferenceResolver']) {
    runtime.ctx.provide(name, {} as never)
  }

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
      ...(options.session === undefined ? {} : { session: options.session }),
      summary: { displayTitle: extra.displayTitle },
    }, { current: false })
  }
  if (options.declareSlots !== false) {
    await runtime.declare({
      main: { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
    })
  }
  return {
    runtime,
    locale,
    chat,
    settings: settingsScope,
    mountBoard: () => runtime.mount({ inject: [...inject], apply }),
  }
}
