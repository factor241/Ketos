/**
 * Board test bench: the client test runtime plus the services the board
 * injects (locale, sessions, the conversation binding). The board
 * itself is mounted by the caller so deferred-declaration paths stay testable.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { Context } from '@deepseek-ai/cordis'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { ChatSnapshot, ConversationNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
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
}

/** One prepared bench: the runtime, its services, and the board mount. */
export interface BoardBench {
  runtime: SlotTestRuntime
  /** The installed locale service, for locale-switching assertions. */
  locale: LocaleRuntime
  /** The chat target observable the bridge subscribes to for the created session. */
  chat: SnapshotStore<ChatSnapshot | undefined>
  /** Mount the board plugin on the prepared runtime. */
  mountBoard: () => Promise<{ dispose: () => Promise<void> }>
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
  const remote = {
    agentPresets: { list: async () => ({ ok: true as const, value: { presets: [], authorable: false, modeSelectionEnabled: false } }) },
    commands: { list: async () => ({ ok: true as const, value: [] }) },
    fileReferences: { list: async () => ({ ok: true as const, value: [] }) },
    sessionReferenceResolver: { candidates: async () => ({ ok: true as const, value: [] }) },
    goals: {
      pause: async () => ({ ok: true as const, value: undefined }),
      resume: async () => ({ ok: true as const, value: undefined }),
      clear: async () => ({ ok: true as const, value: undefined }),
    },
  }
  runtime.ctx.provide('remote', remote as never)
  for (const name of ['remote.commands', 'remote.agentPresets', 'remote.goals', 'remote.fileReferences', 'remote.sessionReferenceResolver']) {
    runtime.ctx.provide(name, {} as never)
  }

  if (options.session !== undefined) {
    // Pre-add the fixture session: the double's add() stabilizes through act,
    // and calling it from the window's mount effect would nest act scopes.
    // Production create() is a remote round-trip with no act involvement.
    const sessionId = await runtime.sessions.add({ id: 'session-1', session: options.session })
    runtime.sessions.stubCreate(async () => sessionId)
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
    mountBoard: () => runtime.mount({ inject: [...inject], apply }),
  }
}
