// @vitest-environment jsdom
/**
 * Resource discipline for the board (stage 14.4): 30 create/close cycles over
 * every window kind — with the chats panel and fullscreen entered and left on
 * the session-bearing kinds — leave the store, the DOM, the slot ledger, the
 * bridge maps, the subscriptions, and the timer count where they started.
 * Closing a window frees its bridge record; the session and its list row stay.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createBoardStore } from '../src/client/store.ts'
import type { WindowBodyKind, WindowKind, WindowId } from '../src/client/contract/slots.ts'
import { BoardSessionBridge } from '../src/client/session-bridge.ts'
import { NS, en, zh } from '../src/client/locale.ts'
import { createBoardBench } from './fixtures.client.ts'

type BoardInstance = ReturnType<ReturnType<typeof createBoardStore>['create']>

const runtimes = new Set<SlotTestRuntime>()

afterEach(async () => {
  try {
    for (const runtime of runtimes) await runtime.dispose()
  } finally {
    runtimes.clear()
    cleanup()
  }
})

/** Every window kind the board ships, cycled across the stress run. */
const KINDS: readonly { readonly kind: WindowKind; readonly bodyKind: WindowBodyKind }[] = [
  { kind: 'agent', bodyKind: 'conversation' },
  { kind: 'clone', bodyKind: 'conversation' },
  { kind: 'connectors', bodyKind: 'connectors' },
  { kind: 'settings', bodyKind: 'settings' },
  { kind: 'dashboard', bodyKind: 'dashboard' },
  { kind: 'tasks', bodyKind: 'tasks' },
]

/** Number of create/close cycles the plan asks for. */
const CYCLES = 30

/**
 * Wrap one observable's `subscribe` so the test can read the active listener
 * count; the wrapper preserves the disposer contract, so a leak (a disposer
 * that never runs) stays visible as a count above the baseline.
 */
function countSubscriptions(source: { subscribe: (fn: () => void) => () => void }): () => number {
  let active = 0
  const original = source.subscribe
  source.subscribe = (fn: () => void) => {
    active += 1
    const dispose = original.call(source, fn)
    let live = true
    return () => {
      if (!live) return
      live = false
      active -= 1
      dispose()
    }
  }
  return () => active
}

/** The window literal one cycle opens. */
function windowState(index: number, kind: WindowKind, bodyKind: WindowBodyKind) {
  return { id: `w${index}` as WindowId, kind, bodyKind, ordinal: index + 1, width: 552, height: 648 }
}

describe('board resource discipline', () => {
  it('keeps the store, DOM, slot ledger, sessions, listeners, and timers flat across 30 mixed cycles', async () => {
    const prepared = await createBoardBench({
      session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) },
    })
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    const listListeners = countSubscriptions(runtime.sessions.list)
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const store = runtime.storeOf('board.dock') as BoardInstance

    // Timer accounting starts after mounting, so harness timers are not counted.
    const pending = new Set<ReturnType<typeof setTimeout>>()
    const realSetTimeout = globalThis.setTimeout
    const realClearTimeout = globalThis.clearTimeout
    globalThis.setTimeout = ((handler: TimerHandler, delay?: number) => {
      const timer = { id: undefined as ReturnType<typeof setTimeout> | undefined }
      const run = (): void => {
        if (timer.id !== undefined) pending.delete(timer.id)
        if (typeof handler !== 'function') throw new Error('board timer used a string handler')
        const callback = handler as () => void
        callback()
      }
      timer.id = realSetTimeout(run, delay)
      pending.add(timer.id)
      return timer.id
    }) as unknown as typeof setTimeout
    globalThis.clearTimeout = ((id?: ReturnType<typeof setTimeout>) => {
      if (id !== undefined) pending.delete(id)
      realClearTimeout(id as never)
    }) as unknown as typeof clearTimeout

    try {
      const baselineNodes = panel.container.querySelectorAll('*').length
      const baselineListeners = listListeners()

      for (let index = 0; index < CYCLES; index += 1) {
        const { kind, bodyKind } = KINDS[index % KINDS.length]!
        const id = `w${index}` as WindowId
        act(() => { store.actions.openWindow(windowState(index, kind, bodyKind)) })
        await runtime.flush()
        if (bodyKind === 'conversation') {
          act(() => { store.actions.setWindowFullscreen(id) })
          await runtime.flush()
          act(() => { store.actions.exitFullscreen() })
          await runtime.flush()
          act(() => { store.actions.openWindowPanel(id) })
          await runtime.flush()
          act(() => { store.actions.closeWindowPanel() })
          await runtime.flush()
        }
        act(() => { store.actions.closeWindow(id) })
        await runtime.flush()
      }

      // The board is back to its empty state and the ledger never grew.
      expect(store.store.getSnapshot().windows).toEqual({})
      expect(panel.container.querySelectorAll('[data-board-window]')).toHaveLength(0)
      expect(panel.container.querySelectorAll('[data-board-dock-row]')).toHaveLength(0)
      expect(panel.container.querySelectorAll('*').length).toBe(baselineNodes)
      expect(runtime.slots.entries('board.window')).toHaveLength(6)
      expect(runtime.slots.entries('board.window.body')).toHaveLength(1)
      expect(runtime.slots.entries('board.window.panel')).toHaveLength(2)

      // Closing a window never deletes its session: the same chat is rebuilt
      // each cycle and stays listed.
      expect(runtime.sessions.list.getSnapshot().ids).toContain('session-1' as SessionId)
      expect(runtime.sessions.calls.filter(call => call.method === 'clear')).toHaveLength(0)
      expect(listListeners()).toBe(baselineListeners)

      // No board timer survives its window: the debounced layout write and the
      // component timers all settle within the debounce window.
      await new Promise(resolve => realSetTimeout(resolve, 1_500))
      expect([...pending]).toEqual([])
    } finally {
      globalThis.setTimeout = realSetTimeout
      globalThis.clearTimeout = realClearTimeout
    }
  })

  it('releases every bridge record and session subscription across 30 create/close cycles', async () => {
    const prepared = await createBoardBench({
      session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) },
    })
    runtimes.add(prepared.runtime)
    prepared.runtime.ctx.locale.register(NS, { zh, en })
    const bridge = new BoardSessionBridge(prepared.runtime.ctx)
    const windowId = 'a1' as WindowId
    const channel = bridge.channel(windowId)
    bridge.ensure(windowId)
    await prepared.runtime.flush()
    const sessionId = channel.getSnapshot().sessionId
    if (sessionId === undefined) throw new Error('missing session id')

    // Count listeners on the same sources the bridge attaches to; the fixture
    // faces are identity-stable, so the counts see every attach and release.
    const session = prepared.runtime.ctx.sessions.binding(sessionId)?.session
    if (session === undefined) throw new Error('missing session face')
    const sessionListeners = countSubscriptions(session)
    const permissionListeners = countSubscriptions(session.projections.faceOf('permissions'))
    const listListeners = countSubscriptions(prepared.runtime.ctx.sessions.list)
    const baseline = {
      session: sessionListeners(),
      permissions: permissionListeners(),
      list: listListeners(),
    }

    const deadChannels = [channel]
    for (let cycle = 0; cycle < CYCLES; cycle += 1) {
      bridge.release(windowId)
      bridge.ensure(windowId)
      await prepared.runtime.flush()
      deadChannels.push(bridge.channel(windowId))
    }
    // One live record and one outstanding creation: no growth per cycle.
    expect(bridge.windowIds()).toEqual([windowId])
    expect(bridge.bindings()).toEqual({ [windowId as string]: sessionId })
    expect(prepared.runtime.sessions.calls.filter(call => call.method === 'create')).toHaveLength(CYCLES + 1)

    bridge.release(windowId)
    expect(bridge.windowIds()).toEqual([])
    expect(bridge.bindings()).toEqual({})
    await prepared.runtime.flush()

    // Every released record's subscriptions are gone: the dead channels stay
    // at their frozen snapshots while the session changes underneath them.
    const frozen = deadChannels.map(dead => ({ channel: dead, snapshot: dead.getSnapshot() }))
    await prepared.runtime.sessions.updateSessionSnapshot(sessionId, (draft) => { draft.running = true })
    const projectionWrite = session.projections as unknown as { set(key: string, value: unknown): void }
    projectionWrite.set('permissions', { currentValue: 'read-only', options: [] })
    await prepared.runtime.flush()
    for (const { channel: dead, snapshot } of frozen) expect(dead.getSnapshot()).toBe(snapshot)

    // Only the bridge's own list subscription and the fixture session's
    // snapshot listener outside the bridge remain: attach/release is balanced.
    expect(sessionListeners()).toBe(0)
    expect(permissionListeners()).toBe(0)
    expect(listListeners()).toBe(baseline.list)

    bridge.dispose()
  })
})
