// The window publisher: a tail debounce of one put per changed window,
// reconciliation of own records the layout no longer holds (only on a visible
// tab and only after the layout was adopted), per-operation outcomes, and the
// retry rules for refused and unreachable posts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CloneId } from '@ketos/clone-core/types'
import type { BoardOp, BoardWindowRecord, OwnerId, WindowId } from '@ketos/board-doc/types'
import { parseBoardWindowInput } from '@ketos/board-doc/windows'
import type { BoardWindowState } from '../src/client/contract/slots.ts'
import type { BoardLayoutSource } from '../src/client/store.ts'
import {
  WindowPublisher, type WindowPostOutcome, type WindowPublisherDeps, type WindowPublisherState,
} from '../src/client/window-publish.ts'
import type { WindowStatus } from '../src/client/window-status.ts'

const SELF = brandString<OwnerId>('owner-self')
const WINDOW = brandString<WindowId>('agent-1')
const SESSION = brandString<SessionId>('session-1')
const OTHER = brandString<OwnerId>('owner-other')

/** One local window state. */
function windowState(overrides: Partial<BoardWindowState> = {}): BoardWindowState {
  return {
    id: WINDOW,
    kind: 'agent',
    bodyKind: 'conversation',
    ordinal: 1,
    ownerId: SELF,
    access: { mode: 'owner', people: [] },
    x: 24,
    y: 24,
    width: 552,
    height: 648,
    zIndex: 10,
    ...overrides,
  }
}

/** One stored window record. */
function storedRecord(overrides: Partial<BoardWindowRecord> = {}): BoardWindowRecord {
  return {
    id: WINDOW,
    hostId: SELF,
    ownerId: SELF,
    kind: 'agent',
    bodyKind: 'conversation',
    title: null,
    ordinal: 1,
    x: 24,
    y: 24,
    w: 552,
    h: 648,
    z: 10,
    access: { mode: 'owner', people: [] },
    status: 'idle',
    updatedAt: 1,
    ...overrides,
  }
}

/** The mutable stand-in for the readonly publisher state. */
interface MutablePublisherState {
  selfId: OwnerId | null
  layoutSource: BoardLayoutSource | null
  windows: Record<string, BoardWindowState>
  windowRecords: Record<string, BoardWindowRecord>
}

/** Controllable publisher inputs. */
interface Fake {
  state: MutablePublisherState
  visible: boolean
  /** Every posted operation, in call order. */
  posts: BoardOp[]
  /** Outcome the next calls answer, consumed one per call; empty answers ok. */
  outcomes: Array<WindowPostOutcome | 'throw'>
  logs: string[]
  readonly listeners: Set<() => void>
  readonly watchers: Map<string, Set<() => void>>
  readonly visibility: Set<() => void>
  readonly statuses: Map<string, WindowStatus>
  readonly sessions: Map<string, SessionId>
  readonly titles: Map<string, string>
  /** Clone names by clone id; the clone roster the deps read. */
  readonly cloneNames: Map<string, string>
  readonly cloneListeners: Set<() => void>
  notify(): void
  fireWatch(windowId: string): void
  fireVisibility(): void
}

/**
 * Build one fake dependency set.
 * @param state - initial publisher state overrides.
 * @returns the fake and the deps bound to it.
 */
function createFake(state: Partial<WindowPublisherState> = {}): { fake: Fake; deps: WindowPublisherDeps } {
  const fake: Fake = {
    state: { selfId: SELF, layoutSource: 'server', windows: { [WINDOW]: windowState() }, windowRecords: {}, ...state },
    visible: true,
    posts: [],
    outcomes: [],
    logs: [],
    listeners: new Set(),
    watchers: new Map(),
    visibility: new Set(),
    statuses: new Map(),
    sessions: new Map(),
    titles: new Map(),
    cloneNames: new Map(),
    cloneListeners: new Set(),
    notify() { for (const listener of [...this.listeners]) listener() },
    fireWatch(windowId) { for (const listener of [...(this.watchers.get(windowId) ?? [])]) listener() },
    fireVisibility() { for (const listener of [...this.visibility]) listener() },
  }
  const deps: WindowPublisherDeps = {
    getState: () => fake.state,
    subscribe: (listener) => {
      fake.listeners.add(listener)
      return () => { fake.listeners.delete(listener) }
    },
    watchWindow: (windowId, listener) => {
      let set = fake.watchers.get(windowId)
      if (set === undefined) {
        set = new Set()
        fake.watchers.set(windowId, set)
      }
      set.add(listener)
      return () => { set.delete(listener) }
    },
    statusFor: windowId => fake.statuses.get(windowId) ?? 'idle',
    sessionFor: windowId => fake.sessions.get(windowId),
    chatTitleFor: windowId => fake.titles.get(windowId),
    clones: {
      nameOf: cloneId => fake.cloneNames.get(cloneId),
      subscribe: (listener) => {
        fake.cloneListeners.add(listener)
        return () => { fake.cloneListeners.delete(listener) }
      },
    },
    isVisible: () => fake.visible,
    onVisibilityChange: (listener) => {
      fake.visibility.add(listener)
      return () => { fake.visibility.delete(listener) }
    },
    post: async (op) => {
      const outcome = fake.outcomes.shift()
      if (outcome === 'throw') throw new Error('post refused')
      if (outcome !== undefined && !outcome.ok) return outcome
      fake.posts.push(op)
      return { ok: true }
    },
    log: (message) => { fake.logs.push(message) },
  }
  return { fake, deps }
}

let publishers: WindowPublisher[] = []

beforeEach(() => {
  vi.useFakeTimers()
  publishers = []
})

afterEach(() => {
  for (const publisher of publishers) publisher.dispose()
  vi.useRealTimers()
})

/**
 * Start one publisher and register it for the after-each disposal.
 * @param deps - the fake dependencies.
 * @returns the started publisher.
 */
function start(deps: WindowPublisherDeps): WindowPublisher {
  const publisher = new WindowPublisher(deps, { debounceMs: 300, retryMs: 5_000 })
  publisher.start()
  publishers.push(publisher)
  return publisher
}

/** The put records posted so far, in order. */
function puts(fake: Fake): Array<Extract<BoardOp, { op: 'window.put' }>['record']> {
  return fake.posts.flatMap(op => op.op === 'window.put' ? [op.record] : [])
}

describe('board window publisher: debounce', () => {
  it('posts the last value once, only after the pause that follows a burst', async () => {
    const { fake, deps } = createFake()
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    expect(fake.posts).toHaveLength(1)

    const window = fake.state.windows[WINDOW] as BoardWindowState
    // A drag: a change every 200 ms, so a throttle would post at 300 and 600.
    for (let step = 1; step <= 5; step += 1) {
      window.x = 24 + step * 24
      fake.notify()
      await vi.advanceTimersByTimeAsync(200)
    }
    expect(fake.posts).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(100)
    expect(fake.posts).toHaveLength(2)
    expect(puts(fake)[1]).toMatchObject({ x: 144 })
  })

  it('does not restart the pause for store changes that leave the windows alone', async () => {
    const { fake, deps } = createFake()
    start(deps)
    const window = fake.state.windows[WINDOW] as BoardWindowState
    window.x = 90
    fake.notify()
    await vi.advanceTimersByTimeAsync(200)
    fake.notify()
    fake.notify()
    await vi.advanceTimersByTimeAsync(100)
    expect(puts(fake)).toMatchObject([{ x: 90 }])
  })

  it('posts one operation per window', async () => {
    const second = brandString<WindowId>('agent-2')
    const { fake, deps } = createFake({
      windows: { [WINDOW]: windowState(), [second]: windowState({ id: second, ordinal: 2, x: 600 }) },
    })
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    expect(fake.posts).toHaveLength(2)
    expect(puts(fake).map(record => record.id).sort()).toEqual([WINDOW, second])
  })

  it('publishes a status change that arrives on the window channel', async () => {
    const { fake, deps } = createFake()
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    expect(fake.watchers.get(WINDOW)?.size).toBe(1)

    fake.statuses.set(WINDOW, 'running')
    fake.fireWatch(WINDOW)
    await vi.advanceTimersByTimeAsync(300)
    expect(puts(fake).at(-1)).toMatchObject({ status: 'running' })
  })

  it('publishes the chat title and session of a conversation window', async () => {
    const { fake, deps } = createFake()
    fake.titles.set(WINDOW, 'Чат')
    fake.sessions.set(WINDOW, SESSION)
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    expect(puts(fake)[0]).toMatchObject({ title: 'Чат', sessionId: SESSION })

    fake.state.windows[WINDOW] = windowState({ customTitle: 'Имя' })
    fake.notify()
    await vi.advanceTimersByTimeAsync(300)
    expect(puts(fake).at(-1)).toMatchObject({ title: 'Имя' })
  })

  it('does not attach a session to a window that carries none', async () => {
    const { fake, deps } = createFake({
      windows: { tasks: windowState({ id: 'tasks-1' as WindowId, kind: 'tasks', bodyKind: 'tasks' }) },
    })
    fake.sessions.set('tasks-1', SESSION)
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    const record = puts(fake)[0]
    expect(record).toMatchObject({ title: null })
    expect(record !== undefined && 'sessionId' in record).toBe(false)
  })

  it('publishes nothing before the first snapshot and everything after', async () => {
    const { fake, deps } = createFake({ selfId: null })
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    expect(fake.posts).toEqual([])

    fake.state.selfId = SELF
    fake.notify()
    await vi.advanceTimersByTimeAsync(300)
    expect(fake.posts).toHaveLength(1)
  })

  it('keeps a window that closed while its put waited out of the posts', async () => {
    const { fake, deps } = createFake()
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    const window = fake.state.windows[WINDOW] as BoardWindowState
    window.x = 500
    fake.notify()
    fake.state.windows = {}
    fake.notify()
    await vi.advanceTimersByTimeAsync(300)
    expect(puts(fake)).toMatchObject([{ x: 24 }])
  })

  it('stops publishing and unsubscribes on dispose', async () => {
    const { fake, deps } = createFake()
    const publisher = new WindowPublisher(deps, { debounceMs: 300, retryMs: 5_000 })
    const stop = publisher.start()
    publishers.push(publisher)
    await vi.advanceTimersByTimeAsync(300)
    expect(fake.posts).toHaveLength(1)

    stop()
    const window = fake.state.windows[WINDOW] as BoardWindowState
    window.x = 5
    fake.notify()
    await vi.advanceTimersByTimeAsync(300)
    expect(fake.posts).toHaveLength(1)
    expect(fake.listeners.size).toBe(0)
    expect(fake.visibility.size).toBe(0)
    expect(fake.watchers.get(WINDOW)?.size ?? 0).toBe(0)
  })
})

describe('board window publisher: titles', () => {
  it('cuts a custom title and a chat title to the longest title a record accepts', async () => {
    const second = brandString<WindowId>('agent-2')
    const { fake, deps } = createFake({
      windows: {
        [WINDOW]: windowState({ customTitle: 'я'.repeat(300) }),
        [second]: windowState({ id: second, ordinal: 2 }),
      },
    })
    fake.titles.set(second, `${'a'.repeat(199)}😀`)
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    const titles = Object.fromEntries(puts(fake).map(record => [record.id, record.title]))
    expect(titles[WINDOW]).toBe('я'.repeat(200))
    expect(titles[second]).toBe('a'.repeat(199))
  })

  it('publishes a title with control characters as spaces, in a form the host accepts', async () => {
    const { fake, deps } = createFake({ windows: { [WINDOW]: windowState({ customTitle: 'a\tb' }) } })
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    const record = puts(fake)[0]
    expect(record).toMatchObject({ title: 'a b' })
    expect(parseBoardWindowInput(record)).not.toBeNull()

    fake.state.windows[WINDOW] = windowState({ customTitle: 'x\ny\u007fz' })
    fake.notify()
    await vi.advanceTimersByTimeAsync(300)
    expect(puts(fake).at(-1)).toMatchObject({ title: 'x y z' })
  })
})

describe('board window publisher: clone windows', () => {
  const CLONE = 'clone-1' as CloneId
  const cloneWindow = (overrides: Partial<BoardWindowState> = {}): BoardWindowState =>
    windowState({ kind: 'clone', bodyKind: 'clone', cloneId: CLONE, ...overrides })

  it('publishes the name of the clone the window edits, as the local title does', async () => {
    const { fake, deps } = createFake({ windows: { [WINDOW]: cloneWindow() } })
    fake.cloneNames.set(CLONE, 'Юрист')
    fake.titles.set(WINDOW, 'Интервью')
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    expect(puts(fake)[0]).toMatchObject({ title: 'Юрист' })

    // The user's own window name outranks the clone, the clone outranks the chat.
    fake.state.windows[WINDOW] = cloneWindow({ customTitle: 'Моё имя' })
    fake.notify()
    await vi.advanceTimersByTimeAsync(300)
    expect(puts(fake).at(-1)).toMatchObject({ title: 'Моё имя' })
  })

  it('publishes a clone rename that arrives through the clone roster', async () => {
    const { fake, deps } = createFake({ windows: { [WINDOW]: cloneWindow() } })
    fake.cloneNames.set(CLONE, 'Юрист')
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    expect(fake.cloneListeners.size).toBe(1)

    fake.cloneNames.set(CLONE, 'Юрист 2')
    for (const listener of [...fake.cloneListeners]) listener()
    await vi.advanceTimersByTimeAsync(300)
    expect(puts(fake).at(-1)).toMatchObject({ title: 'Юрист 2' })
  })

  it('falls back to the chat title while the clone has no name, and without a clone roster', async () => {
    const { fake, deps } = createFake({ windows: { [WINDOW]: cloneWindow() } })
    fake.titles.set(WINDOW, 'Интервью')
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    expect(puts(fake)[0]).toMatchObject({ title: 'Интервью' })

    const bare = createFake({ windows: { [WINDOW]: cloneWindow() } })
    bare.fake.titles.set(WINDOW, 'Интервью')
    const { clones: _omitted, ...withoutClones } = bare.deps
    start(withoutClones)
    await vi.advanceTimersByTimeAsync(300)
    expect(puts(bare.fake)[0]).toMatchObject({ title: 'Интервью' })
  })

  it('stops following the clone roster on dispose', async () => {
    const { fake, deps } = createFake({ windows: { [WINDOW]: cloneWindow() } })
    const publisher = new WindowPublisher(deps, { debounceMs: 300, retryMs: 5_000 })
    const stop = publisher.start()
    expect(fake.cloneListeners.size).toBe(1)
    stop()
    expect(fake.cloneListeners.size).toBe(0)
  })
})

describe('board window publisher: refused and unreachable posts', () => {
  it('does not repeat a refused put until the window changes', async () => {
    const { fake, deps } = createFake()
    fake.outcomes.push({ ok: false, code: 'ketos/invalid' })
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    expect(fake.posts).toEqual([])
    expect(fake.logs.some(line => line.includes('ketos/invalid') && line.includes(WINDOW))).toBe(true)

    for (let pass = 0; pass < 5; pass += 1) {
      fake.notify()
      await vi.advanceTimersByTimeAsync(10_000)
    }
    expect(fake.posts).toEqual([])

    const window = fake.state.windows[WINDOW] as BoardWindowState
    window.x = 10
    fake.notify()
    await vi.advanceTimersByTimeAsync(300)
    expect(puts(fake)).toMatchObject([{ x: 10 }])
  })

  it('lets one refused window leave the others published', async () => {
    const second = brandString<WindowId>('agent-2')
    const { fake, deps } = createFake({
      windows: { [WINDOW]: windowState(), [second]: windowState({ id: second, ordinal: 2 }) },
    })
    fake.outcomes.push({ ok: false, code: 'ketos/limit' })
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    expect(puts(fake).map(record => record.id)).toEqual([second])
  })

  it('puts a window the record budget refused again once the document holds fewer records', async () => {
    const foreign = (index: number): BoardWindowRecord =>
      storedRecord({ id: brandString<WindowId>(`agent-foreign-${String(index)}`), hostId: OTHER })
    const { fake, deps } = createFake({
      windowRecords: Object.fromEntries([0, 1, 2].map(index => [`agent-foreign-${String(index)}`, foreign(index)])),
    })
    fake.outcomes.push({ ok: false, code: 'ketos/limit' })
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    expect(fake.posts).toEqual([])

    // The budget is still spent: no retry, however many passes run.
    for (let pass = 0; pass < 3; pass += 1) {
      fake.notify()
      await vi.advanceTimersByTimeAsync(10_000)
    }
    expect(fake.posts).toEqual([])

    fake.state.windowRecords = { 'agent-foreign-0': foreign(0), 'agent-foreign-1': foreign(1) }
    fake.notify()
    await vi.advanceTimersByTimeAsync(300)
    expect(puts(fake)).toMatchObject([{ id: WINDOW }])
  })

  it('retries an unreachable put after the pause, not on every change', async () => {
    const { fake, deps } = createFake()
    fake.outcomes.push({ ok: false, code: 'ketos/unreachable' })
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    expect(fake.posts).toEqual([])

    fake.notify()
    await vi.advanceTimersByTimeAsync(4_000)
    expect(fake.posts).toEqual([])

    await vi.advanceTimersByTimeAsync(1_000)
    expect(puts(fake)).toMatchObject([{ id: WINDOW, x: 24 }])
  })

  it('retries a put whose post threw', async () => {
    const { fake, deps } = createFake()
    fake.outcomes.push('throw')
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    expect(fake.posts).toEqual([])
    expect(fake.logs.some(line => line.includes('window publish failed: Error: post refused'))).toBe(true)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(puts(fake)).toHaveLength(1)
  })

  it('does not post the same unpublished state twice while a post is in flight', async () => {
    const { fake, deps } = createFake()
    let release: (() => void) | undefined
    const original = (op: Parameters<WindowPublisherDeps['post']>[0]): ReturnType<WindowPublisherDeps['post']> => deps.post(op)
    const slow: WindowPublisherDeps = {
      ...deps,
      post: async (op) => {
        await new Promise<void>((resolve) => { release = resolve })
        return original(op)
      },
    }
    start(slow)
    await vi.advanceTimersByTimeAsync(300)
    fake.notify()
    await vi.advanceTimersByTimeAsync(1_000)
    release?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.posts).toHaveLength(1)
  })
})

describe('board window publisher: reconciliation', () => {
  it('removes a closed window whose record the document holds and drops its watcher', async () => {
    const { fake, deps } = createFake()
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    fake.state.windowRecords = { [WINDOW]: storedRecord() }

    fake.state.windows = {}
    fake.notify()
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.posts.at(-1)).toEqual({ op: 'window.remove', id: WINDOW })
    expect(fake.watchers.get(WINDOW)?.size ?? 0).toBe(0)
  })

  it('removes own records the layout no longer holds and leaves foreign ones', async () => {
    const { fake, deps } = createFake({
      windows: {},
      windowRecords: {
        'agent-gone': storedRecord({ id: 'agent-gone' as WindowId }),
        'agent-foreign': storedRecord({ id: 'agent-foreign' as WindowId, hostId: brandString<OwnerId>('owner-other') }),
      },
    })
    start(deps)
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.posts).toEqual([{ op: 'window.remove', id: 'agent-gone' }])
  })

  it('reconciles nothing until the layout was adopted, then removes the orphans', async () => {
    const { fake, deps } = createFake({
      layoutSource: null,
      windows: {},
      windowRecords: { 'agent-gone': storedRecord({ id: 'agent-gone' as WindowId }) },
    })
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    fake.notify()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fake.posts).toEqual([])

    fake.state.layoutSource = 'server'
    fake.notify()
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.posts).toEqual([{ op: 'window.remove', id: 'agent-gone' }])
  })

  it('removes a record again when it comes back after its removal was confirmed', async () => {
    const { fake, deps } = createFake({
      windows: {},
      windowRecords: { 'agent-gone': storedRecord({ id: 'agent-gone' as WindowId }) },
    })
    start(deps)
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.posts).toHaveLength(1)

    fake.notify()
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.posts).toHaveLength(1)

    fake.state.windowRecords = {}
    fake.notify()
    fake.state.windowRecords = { 'agent-gone': storedRecord({ id: 'agent-gone' as WindowId }) }
    fake.notify()
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.posts).toHaveLength(2)
  })

  it('does not post a second removal while the first is in flight', async () => {
    const { fake, deps } = createFake({
      windows: {},
      windowRecords: { 'agent-gone': storedRecord({ id: 'agent-gone' as WindowId }) },
    })
    let release: (() => void) | undefined
    const original = (op: Parameters<WindowPublisherDeps['post']>[0]): ReturnType<WindowPublisherDeps['post']> => deps.post(op)
    start({
      ...deps,
      post: async (op) => {
        await new Promise<void>((resolve) => { release = resolve })
        return original(op)
      },
    })
    await vi.advanceTimersByTimeAsync(0)
    fake.notify()
    fake.notify()
    release?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.posts).toHaveLength(1)
  })

  it('retries an unreachable removal after the pause and never repeats a refused one', async () => {
    const { fake, deps } = createFake({
      windows: {},
      windowRecords: {
        'agent-a': storedRecord({ id: 'agent-a' as WindowId }),
        'agent-b': storedRecord({ id: 'agent-b' as WindowId }),
      },
    })
    fake.outcomes.push({ ok: false, code: 'ketos/unreachable' }, { ok: false, code: 'ketos/window-foreign' })
    start(deps)
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.posts).toEqual([])
    expect(fake.logs.some(line => line.includes('window removal failed') && line.includes('ketos/unreachable'))).toBe(true)

    fake.notify()
    await vi.advanceTimersByTimeAsync(4_000)
    expect(fake.posts).toEqual([])

    await vi.advanceTimersByTimeAsync(1_000)
    expect(fake.posts).toEqual([{ op: 'window.remove', id: 'agent-a' }])
    for (let pass = 0; pass < 3; pass += 1) {
      fake.notify()
      await vi.advanceTimersByTimeAsync(10_000)
    }
    expect(fake.posts).toEqual([{ op: 'window.remove', id: 'agent-a' }])
  })

  it('does not remove a record while its put is in flight, and removes it once the put settled', async () => {
    const { fake, deps } = createFake({ windowRecords: { [WINDOW]: storedRecord() } })
    let releasePut: (() => void) | undefined
    start({
      ...deps,
      post: async (op) => {
        if (op.op === 'window.put') await new Promise<void>((resolve) => { releasePut = resolve })
        return deps.post(op)
      },
    })
    await vi.advanceTimersByTimeAsync(300)
    expect(releasePut).toBeDefined()

    // The window closes while its put is in flight: a removal posted now could
    // reach the host before the put, which would then recreate the record.
    fake.state.windows = {}
    fake.notify()
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.posts).toEqual([])

    releasePut?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.posts.map(op => op.op)).toEqual(['window.put', 'window.remove'])
  })

  it('treats a thrown removal as unreachable', async () => {
    const { fake, deps } = createFake({
      windows: {},
      windowRecords: { 'agent-gone': storedRecord({ id: 'agent-gone' as WindowId }) },
    })
    fake.outcomes.push('throw')
    start(deps)
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.logs.some(line => line.includes('window removal failed: Error: post refused'))).toBe(true)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fake.posts).toEqual([{ op: 'window.remove', id: 'agent-gone' }])
  })
})

describe('board window publisher: layout held in memory', () => {
  it('leaves own-host records it never published, which another tab of this Ketos publishes', async () => {
    const { fake, deps } = createFake({
      layoutSource: 'memory',
      windows: {},
      windowRecords: { 'agent-main': storedRecord({ id: 'agent-main' as WindowId }) },
    })
    start(deps)
    for (let pass = 0; pass < 3; pass += 1) {
      fake.notify()
      await vi.advanceTimersByTimeAsync(10_000)
    }
    expect(fake.posts).toEqual([])
  })

  it('removes the record of a window it published itself once that window closed', async () => {
    const { fake, deps } = createFake({ layoutSource: 'memory' })
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    expect(puts(fake)).toMatchObject([{ id: WINDOW }])

    fake.state.windowRecords = {
      [WINDOW]: storedRecord(),
      'agent-main': storedRecord({ id: 'agent-main' as WindowId }),
    }
    fake.state.windows = {}
    fake.notify()
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.posts.slice(1)).toEqual([{ op: 'window.remove', id: WINDOW }])

    // The answered removal is not repeated, and the other record stays.
    fake.state.windowRecords = { 'agent-main': storedRecord({ id: 'agent-main' as WindowId }) }
    fake.notify()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fake.posts).toHaveLength(2)
  })
})

describe('board window publisher: hidden tab', () => {
  it('keeps changes while hidden and publishes them on return', async () => {
    const { fake, deps } = createFake()
    fake.visible = false
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    expect(fake.posts).toEqual([])

    const window = fake.state.windows[WINDOW] as BoardWindowState
    window.x = 120
    fake.notify()
    await vi.advanceTimersByTimeAsync(300)
    fake.fireVisibility()
    expect(fake.posts).toEqual([])

    fake.visible = true
    fake.fireVisibility()
    await vi.advanceTimersByTimeAsync(300)
    expect(puts(fake)).toMatchObject([{ x: 120 }])
  })

  it('never removes records from a hidden tab, and reconciles when it returns', async () => {
    const { fake, deps } = createFake({
      windows: {},
      windowRecords: { 'agent-gone': storedRecord({ id: 'agent-gone' as WindowId }) },
    })
    fake.visible = false
    start(deps)
    fake.notify()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fake.posts).toEqual([])

    fake.visible = true
    fake.fireVisibility()
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.posts).toEqual([{ op: 'window.remove', id: 'agent-gone' }])
  })

  it('republishes every window when the tab becomes visible again', async () => {
    const { fake, deps } = createFake()
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    expect(fake.posts).toHaveLength(1)

    fake.visible = false
    fake.fireVisibility()
    fake.visible = true
    fake.fireVisibility()
    await vi.advanceTimersByTimeAsync(300)
    expect(fake.posts).toHaveLength(2)
    expect(puts(fake)[1]).toMatchObject({ id: WINDOW, x: 24 })
  })

  it('leaves the pause alone when a hidden notification arrives with nothing to publish', async () => {
    const { fake, deps } = createFake()
    start(deps)
    await vi.advanceTimersByTimeAsync(300)
    fake.visible = false
    fake.fireVisibility()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fake.posts).toHaveLength(1)
  })
})
