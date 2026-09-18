// @vitest-environment jsdom
/** Layout persistence: first-frame cache, mirror hydration, debounce, and revision CAS. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type {
  RemoteResult, SettingsDescribeValue, SettingsNamespaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { BOARD_SETTINGS_NAMESPACE, BOARD_SETTINGS_VERSION, BOARD_LAYOUT_MAX_WINDOWS } from '../src/board-settings.ts'
import {
  BoardLayoutPersistence, BOARD_LAYOUT_CACHE_KEY, readBoardLayoutCache,
} from '../src/client/board-persistence.ts'
import { createBoardStore, WINDOW_Z_BASE, type BoardStoreHandle, type BoardStoreInstance } from '../src/client/store.ts'
import type { WindowId } from '../src/client/contract/slots.ts'
import { createBoardBench, createSettingsScopeDouble, type SettingsScopeDouble } from './fixtures.client.ts'

/** The wire value type the settings views carry, as the remote assembly types it. */
type Json = SettingsNamespaceView['value']

const runtimes = new Set<SlotTestRuntime>()

beforeEach(() => { localStorage.clear() })

afterEach(async () => {
  vi.useRealTimers()
  try {
    for (const runtime of runtimes) await runtime.dispose()
  } finally {
    runtimes.clear()
    localStorage.clear()
  }
})

/** One successful Remote result. */
function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

/** One valid stored document. */
function layout(overrides: Record<string, Json> = {}): Json {
  const base: Record<string, Json> = {
    version: BOARD_SETTINGS_VERSION,
    panX: 10,
    panY: 20,
    zoom: 1.5,
    windows: [{
      id: 'agent-1',
      kind: 'agent',
      bodyKind: 'conversation',
      ordinal: 1,
      x: 24,
      y: 48,
      width: 552,
      height: 648,
      zIndex: WINDOW_Z_BASE,
    }],
    windowOrder: ['agent-1'],
    activeWindowId: 'agent-1',
    panelWindowId: '',
    panelCollapsed: true,
    panelWidth: 300,
    panelGroupBy: 'workspace',
    panelOrderBy: 'updated',
  }
  return { ...base, ...overrides }
}

/** One namespace view over the stored document. */
function namespaceView(overrides: Partial<SettingsNamespaceView> = {}): SettingsNamespaceView {
  return {
    ns: BOARD_SETTINGS_NAMESPACE,
    schema: {},
    value: layout(),
    applies: 'live',
    secrets: [],
    revision: 1,
    ...overrides,
  }
}

/** One describe answer carrying the supplied namespace views. */
function describeValue(namespaces: SettingsNamespaceView[], writable = true): SettingsDescribeValue {
  return { writable, hasDocument: true, namespaces }
}

/** A writable, ready mirror with no namespaces: writes pass and nothing is adopted. */
const EMPTY_VIEW: SettingsDescribeValue = { writable: true, hasDocument: true, namespaces: [] }

/** Signature of the settings update double. */
type UpdateSignature = (
  ns: string,
  patch: Record<string, unknown>,
  revision: number | undefined,
) => Promise<RemoteResult<SettingsNamespaceView>>

/** One update double over the settings namespace. */
type UpdateDouble = ReturnType<typeof vi.fn<UpdateSignature>>

/** A persistence bench over the real store and the mirror double. */
function bench(view: SettingsDescribeValue = EMPTY_VIEW): {
  instance: BoardStoreInstance
  persistence: BoardLayoutPersistence
  settings: SettingsScopeDouble
  update: UpdateDouble
} {
  const ctx = new Context()
  const instance = createBoardStore().create()
  const settings = createSettingsScopeDouble(view)
  const update: UpdateDouble = vi.fn(async (
    _ns: string,
    _patch: Record<string, unknown>,
    _revision: number | undefined,
  ) => ok(namespaceView()))
  new TestRemote(ctx, { settings: { update } })
  return { instance, persistence: new BoardLayoutPersistence(ctx, settings.face, instance), settings, update }
}

/** Cache the supplied document under the supplied revision. */
function seedCache(revision: number, cached: Json): void {
  localStorage.setItem(BOARD_LAYOUT_CACHE_KEY, JSON.stringify({ revision, layout: cached }))
}

describe('board layout cache', () => {
  it('adopts the cached document synchronously, before any mirror read', () => {
    seedCache(7, layout())
    const { instance, persistence } = bench()

    persistence.hydrateFromCache()

    expect(instance.getSnapshot().zoom).toBe(1.5)
    expect(instance.getSnapshot().panX).toBe(10)
    expect(instance.getSnapshot().windows['agent-1']).toBeDefined()
    expect(instance.getSnapshot().windowOrder).toEqual(['agent-1'])
  })

  it('keeps the initial state for a corrupt, versionless, or unsanitizable cache', () => {
    const { instance, persistence } = bench()
    for (const raw of [
      '{not json',
      JSON.stringify({ revision: 1 }),
      JSON.stringify({ revision: 1, layout: { ...layout() as object, version: 9 } }),
      JSON.stringify({ revision: Number.NaN, layout: layout() }),
      JSON.stringify({ revision: -1, layout: layout() }),
    ]) {
      localStorage.setItem(BOARD_LAYOUT_CACHE_KEY, raw)
      persistence.hydrateFromCache()
      expect(instance.getSnapshot().zoom).toBe(1)
      expect(instance.getSnapshot().windows).toEqual({})
    }
  })

  it('keeps working when the first-frame cache cannot be written', async () => {
    const { instance, persistence, update } = bench()
    vi.useFakeTimers()
    persistence.start()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    try {
      instance.actions.setPan(1, 2)
      await vi.advanceTimersByTimeAsync(600)
      expect(update).toHaveBeenCalledTimes(1)
      expect(readBoardLayoutCache()).toBeUndefined()
    } finally {
      setItem.mockRestore()
    }
  })
})

describe('board layout adoption from the mirror', () => {
  it('adopts a server document ahead of the cache and reuses its revision', async () => {
    seedCache(1, layout({ zoom: 1 }))
    const { instance, persistence, settings, update } = bench(describeValue([
      namespaceView({ revision: 3, user: layout({ zoom: 1.75 }) }),
    ]))
    persistence.hydrateFromCache()

    persistence.start()
    expect(instance.getSnapshot().zoom).toBe(1.75)
    expect(readBoardLayoutCache()).toMatchObject({ revision: 3 })

    vi.useFakeTimers()
    instance.actions.setPan(1, 2)
    await vi.advanceTimersByTimeAsync(1_100)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[2]).toBe(3)
    expect(settings.accepted).toHaveLength(1)
  })

  it('adopts a server document at the same revision when there is no cache', () => {
    const { instance, persistence } = bench(describeValue([
      namespaceView({ revision: 0, user: layout({ zoom: 1.25 }) }),
    ]))

    persistence.start()

    expect(instance.getSnapshot().zoom).toBe(1.25)
    expect(instance.getSnapshot().windows['agent-1']).toBeDefined()
    expect(readBoardLayoutCache()).toMatchObject({ revision: 0 })
  })

  it('adopts the server document when the mirror answers after start', () => {
    const { instance, persistence, settings } = bench()
    persistence.start()
    expect(instance.getSnapshot().windows).toEqual({})

    settings.setView(describeValue([namespaceView({ revision: 3, user: layout({ zoom: 0.75 }) })]))

    expect(instance.getSnapshot().zoom).toBe(0.75)
    expect(instance.getSnapshot().windowOrder).toEqual(['agent-1'])
  })

  it('keeps the cached layout when the server has no user document', () => {
    seedCache(4, layout({ zoom: 1.25 }))
    const { instance, persistence } = bench(describeValue([namespaceView({ revision: 0 })]))

    persistence.hydrateFromCache()
    persistence.start()

    expect(instance.getSnapshot().zoom).toBe(1.25)
  })

  it('pushes the cached layout back when the server lags a lost write', async () => {
    seedCache(5, layout({ zoom: 1.5 }))
    const { instance, persistence, update } = bench(describeValue([
      namespaceView({ revision: 2, user: layout({ zoom: 0.5 }) }),
    ]))
    persistence.hydrateFromCache()
    vi.useFakeTimers()
    persistence.start()

    await vi.advanceTimersByTimeAsync(1_000)

    expect(instance.getSnapshot().zoom).toBe(1.5)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[1]).toMatchObject({ zoom: 1.5 })
    expect(update.mock.calls[0]?.[2]).toBe(2)
  })

  it('ignores a server document the sanitizer cannot adopt', () => {
    const { instance, persistence } = bench(describeValue([
      namespaceView({ revision: 3, user: { ...layout() as object, version: 9 } }),
    ]))

    persistence.start()

    expect(instance.getSnapshot().zoom).toBe(1)
    expect(instance.getSnapshot().windows).toEqual({})
  })

  it('never adopts or writes while the mirror stays unavailable', async () => {
    const { instance, persistence, settings, update } = bench()
    settings.setUnavailable()
    vi.useFakeTimers()
    persistence.start()

    instance.actions.setPan(1, 2)
    await vi.advanceTimersByTimeAsync(2_000)

    expect(instance.getSnapshot().panX).toBe(1)
    expect(update).not.toHaveBeenCalled()
  })

  it('never writes when the provider is read-only', async () => {
    const { instance, persistence, update } = bench(describeValue([], false))
    vi.useFakeTimers()
    persistence.start()

    instance.actions.setPan(1, 2)
    await vi.advanceTimersByTimeAsync(2_000)

    expect(update).not.toHaveBeenCalled()
  })
})

describe('board layout writes', () => {
  it('coalesces two changes within 100ms into one write of the final document', async () => {
    const { instance, persistence, update } = bench()
    vi.useFakeTimers()
    persistence.start()

    instance.actions.setPan(1, 1)
    await vi.advanceTimersByTimeAsync(100)
    instance.actions.setPan(2, 2)
    await vi.advanceTimersByTimeAsync(600)

    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[1]).toMatchObject({ panX: 2, panY: 2 })
  })

  it('never writes twice inside one second', async () => {
    const { instance, persistence, update } = bench()
    vi.useFakeTimers()
    persistence.start()

    instance.actions.setPan(1, 1)
    await vi.advanceTimersByTimeAsync(600)
    expect(update).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(100)
    instance.actions.setPan(2, 2)
    await vi.advanceTimersByTimeAsync(800)
    expect(update).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(200)
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('skips a write when the layout did not move the document', async () => {
    const { instance, persistence, update } = bench()
    vi.useFakeTimers()
    persistence.start()

    instance.actions.setSelectingElement(true)
    instance.actions.setViewport(800, 600)
    await vi.advanceTimersByTimeAsync(1_100)

    expect(update).not.toHaveBeenCalled()
  })

  it('stores the accepted document and its revision in the first-frame cache', async () => {
    const { instance, persistence, settings, update } = bench(describeValue([namespaceView({ revision: 2 })]))
    update.mockResolvedValue(ok(namespaceView({ revision: 4 })))
    vi.useFakeTimers()
    persistence.start()

    instance.actions.setPan(5, 6)
    await vi.advanceTimersByTimeAsync(600)

    expect(readBoardLayoutCache()).toMatchObject({ revision: 4 })
    expect(readBoardLayoutCache()?.layout.panX).toBe(5)
    expect(settings.accepted[0]?.revision).toBe(4)
  })

  it('caps the persisted document at the restore limit', async () => {
    const { instance, persistence, update } = bench()
    for (let index = 0; index < BOARD_LAYOUT_MAX_WINDOWS + 3; index += 1) {
      instance.actions.openWindow({
        id: `agent-${index}` as WindowId,
        kind: 'agent',
        bodyKind: 'conversation',
        ordinal: index + 1,
        width: 552,
        height: 648,
      })
    }
    vi.useFakeTimers()
    persistence.start()

    instance.actions.setPan(1, 1)
    await vi.advanceTimersByTimeAsync(600)

    const patch = update.mock.calls[0]?.[1]
    expect(patch?.['windows']).toHaveLength(BOARD_LAYOUT_MAX_WINDOWS)
  })

  it('retries a conflict once at the revision the conflict reported', async () => {
    const { instance, persistence, settings, update } = bench(describeValue([namespaceView({ revision: 0 })]))
    update
      .mockResolvedValueOnce({
        ok: false,
        error: new RemoteError('settings/conflict', 'stale write', {
          ns: BOARD_SETTINGS_NAMESPACE, expected: 0, actual: 9,
        }),
      })
      .mockResolvedValueOnce(ok(namespaceView({ revision: 10 })))
    vi.useFakeTimers()
    persistence.start()

    instance.actions.setPan(3, 3)
    await vi.advanceTimersByTimeAsync(600)

    expect(update).toHaveBeenCalledTimes(2)
    expect(update.mock.calls[0]?.[2]).toBe(0)
    expect(update.mock.calls[1]?.[2]).toBe(9)
    expect(update.mock.calls[1]?.[1]).toMatchObject({ panX: 3 })
    expect(readBoardLayoutCache()).toMatchObject({ revision: 10 })
    expect(settings.accepted).toHaveLength(1)
  })

  it('keeps the layout local when a write is refused or the transport throws', async () => {
    const { instance, persistence, update } = bench()
    update
      .mockResolvedValueOnce({
        ok: false,
        error: new RemoteError('settings/rejected', 'read-only provider', { ns: BOARD_SETTINGS_NAMESPACE }),
      })
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(ok(namespaceView({ revision: 6 })))
    vi.useFakeTimers()
    persistence.start()

    instance.actions.setPan(1, 1)
    await vi.advanceTimersByTimeAsync(600)
    instance.actions.setPan(2, 2)
    await vi.advanceTimersByTimeAsync(1_100)
    instance.actions.setPan(3, 3)
    await vi.advanceTimersByTimeAsync(1_100)

    expect(update).toHaveBeenCalledTimes(3)
    expect(instance.getSnapshot().panX).toBe(3)
    expect(readBoardLayoutCache()).toMatchObject({ revision: 6 })
  })

  it('drops the pending write on dispose and stops following the store', async () => {
    const { instance, persistence, update } = bench()
    vi.useFakeTimers()
    persistence.start()

    instance.actions.setPan(1, 1)
    persistence.dispose()
    await vi.advanceTimersByTimeAsync(2_000)
    instance.actions.setPan(2, 2)
    await vi.advanceTimersByTimeAsync(2_000)

    expect(update).not.toHaveBeenCalled()
  })
})

describe('board apply persistence', () => {
  it('hydrates the shared instance from the mirror and writes a gesture back', async () => {
    const described = namespaceView({ revision: 5, user: layout({ zoom: 1.25 }) })
    const update = vi.fn(async (
      _ns: string,
      _patch: Record<string, unknown>,
      _revision: number | undefined,
    ) => ok(namespaceView({ revision: 6 })))
    const { runtime, mountBoard } = await createBoardBench({
      settingsView: describeValue([described]),
      remoteSettings: { update },
    })
    runtimes.add(runtime)
    await mountBoard()

    const entry = runtime.slots.entries('main')[0]
    const instance = (entry?.store as BoardStoreHandle | undefined)?.create()
    if (instance === undefined) throw new Error('the board panel registered no store')
    expect(instance.getSnapshot().windows['agent-1']).toBeDefined()
    expect(instance.getSnapshot().zoom).toBe(1.25)
    expect(instance.getSnapshot().windowOrder).toEqual(['agent-1'])

    instance.actions.setPan(30, 40)
    await vi.waitFor(() => { expect(update).toHaveBeenCalledTimes(1) }, { timeout: 2_000 })
    expect(update.mock.calls[0]?.[2]).toBe(5)
    expect(readBoardLayoutCache()?.layout.panX).toBe(30)
  })

  it('derives from the shared mirror instead of reading settings itself', async () => {
    // The bench's remote.settings double exposes no `describe`: a private read
    // would throw at mount. The client's startup describe budget stays with
    // ui-settings, and the board only subscribes to the shared face.
    const { runtime, mountBoard, settings } = await createBoardBench()
    runtimes.add(runtime)
    await mountBoard()
    expect(settings.face.getSnapshot().status).toBe('idle')
  })
})
