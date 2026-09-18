// @vitest-environment jsdom
/**
 * Window session bridge: one record per open window. Closing a window drops
 * its record, channel, and session subscriptions while the session itself
 * stays alive and listed; a stored bindings map restores each window's chat;
 * a session that leaves the list puts its window into the missing state and a
 * returning session reattaches; disposing the plugin releases everything.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { ConversationNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { BoardSessionBridge, type BoardSessionBridgeHooks } from '../src/client/session-bridge.ts'
import type { WindowId } from '../src/client/contract/slots.ts'
import { chatSnapshot, createBoardBench } from './fixtures.client.ts'
import { NS, en, zh } from '../src/client/locale.ts'

const USER_NODE: ConversationNode = {
  kind: 'user',
  seq: 1,
  time: 0,
  content: [{ type: 'text', text: 'привет' }],
  source: undefined,
}

const runtimes = new Set<SlotTestRuntime>()

afterEach(async () => {
  try {
    for (const runtime of runtimes) await runtime.dispose()
  } finally {
    runtimes.clear()
    cleanup()
  }
})

async function bench(hooks: BoardSessionBridgeHooks = {}) {
  const prepared = await createBoardBench({
    session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) },
  })
  runtimes.add(prepared.runtime)
  // The bridge produces a few of its own failure lines from the board
  // dictionary; production `apply` registers it before constructing the bridge.
  prepared.runtime.ctx.locale.register(NS, { zh, en })
  const bridge = new BoardSessionBridge(prepared.runtime.ctx, hooks)
  return { prepared, bridge }
}

/** Bench with two listed chats, for restore and duplicate-rule cases. */
async function twoChatBench(hooks: BoardSessionBridgeHooks = {}) {
  const prepared = await createBoardBench({
    session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) },
    extraSessions: [{ id: 'session-2', displayTitle: 'Second chat' }],
  })
  runtimes.add(prepared.runtime)
  prepared.runtime.ctx.locale.register(NS, { zh, en })
  const bridge = new BoardSessionBridge(prepared.runtime.ctx, hooks)
  return { prepared, bridge }
}

/** Session ids the service double was asked to open, in call order. */
function openedSessions(prepared: { runtime: SlotTestRuntime }): readonly unknown[] {
  return prepared.runtime.sessions.calls.filter(call => call.method === 'open').map(call => call.args[0])
}

/** Session ids the service double was asked to create, in call order. */
function createdSessions(prepared: { runtime: SlotTestRuntime }): readonly unknown[] {
  return prepared.runtime.sessions.calls.filter(call => call.method === 'create').map(call => call.args[0])
}

describe('BoardSessionBridge', () => {
  it('creates one record per window and releases it without touching the session', async () => {
    const { prepared, bridge } = await bench()
    const windowId = 'a1' as WindowId
    const channel = bridge.channel(windowId)
    bridge.ensure(windowId)
    await prepared.runtime.flush()

    expect(bridge.windowIds()).toEqual([windowId])
    const sessionId = channel.getSnapshot().sessionId
    expect(sessionId).toBeDefined()

    bridge.release(windowId)
    expect(bridge.windowIds()).toEqual([])
    // A window that comes back starts from a fresh record and channel.
    expect(bridge.channel(windowId)).not.toBe(channel)
    // The session itself stays alive and listed.
    expect(prepared.runtime.sessions.list.getSnapshot().ids).toContain(sessionId)
  })

  it('releases only the closed window and swallows unknown ids', async () => {
    const { prepared, bridge } = await bench()
    const first = 'a1' as WindowId
    const second = 'a2' as WindowId
    bridge.ensure(first)
    bridge.ensure(second)
    await prepared.runtime.flush()
    expect(bridge.windowIds()).toHaveLength(2)

    expect(() => { bridge.release('missing' as WindowId) }).not.toThrow()
    bridge.release(first)
    expect(bridge.windowIds()).toEqual([second])
    bridge.release(first)
    expect(bridge.windowIds()).toEqual([second])
  })

  it('publishes the chat title with the session and follows renames', async () => {
    const { prepared, bridge } = await bench()
    const windowId = 'a1' as WindowId
    const channel = bridge.channel(windowId)
    bridge.ensure(windowId)
    await prepared.runtime.flush()
    const sessionId = channel.getSnapshot().sessionId
    if (sessionId === undefined) throw new Error('missing session id')
    expect(channel.getSnapshot().displayTitle).toBeDefined()

    await prepared.runtime.sessions.updateSummary(sessionId, { displayTitle: 'Отчёт по складу' })
    await prepared.runtime.flush()
    expect(channel.getSnapshot().displayTitle).toBe('Отчёт по складу')
  })

  it('republishes the chat title when the window rebinds to another session', async () => {
    const { prepared, bridge } = await bench()
    const windowId = 'a1' as WindowId
    const channel = bridge.channel(windowId)
    bridge.ensure(windowId)
    await prepared.runtime.flush()

    const second = await prepared.runtime.sessions.add({ id: 'session-2', summary: { displayTitle: 'Second chat' } })
    bridge.bind(windowId, second)
    await prepared.runtime.flush()
    expect(channel.getSnapshot().sessionId).toBe(second)
    expect(channel.getSnapshot().displayTitle).toBe('Second chat')
  })

  it('publishes the lane history flags and the running calls', async () => {
    const { prepared, bridge } = await bench()
    const windowId = 'a1' as WindowId
    const channel = bridge.channel(windowId)
    bridge.ensure(windowId)
    await prepared.runtime.flush()

    prepared.chat.set(chatSnapshot([USER_NODE]))
    await prepared.runtime.flush()
    expect(channel.getSnapshot().hasMore).toBe(false)
    expect(channel.getSnapshot().loadingOlder).toBe(false)

    const sessionId = channel.getSnapshot().sessionId
    if (sessionId === undefined) throw new Error('missing session id')
    await prepared.runtime.sessions.updateSessionSnapshot(sessionId, (snapshot) => {
      snapshot.hasMore = true
      snapshot.loadingOlder = true
      snapshot.lastAgentError = 'model exploded'
      snapshot.promptError = { op: 'send', error: { code: 'gateway/internal', message: 'refused' } as never }
    })
    await prepared.runtime.flush()
    expect(channel.getSnapshot().hasMore).toBe(true)
    expect(channel.getSnapshot().loadingOlder).toBe(true)
    expect(channel.getSnapshot().turnError).toBe('model exploded')
    expect(channel.getSnapshot().promptError).toBe('gateway/internal: refused')
  })

  it('executes command lines and reports their outcome on the channel', async () => {
    const { prepared, bridge } = await bench()
    const windowId = 'a1' as WindowId
    const channel = bridge.channel(windowId)
    bridge.ensure(windowId)
    await prepared.runtime.flush()

    const execute = vi.fn()
    ;(prepared.runtime.ctx.remote as unknown as { commands: { execute: unknown } }).commands.execute = execute

    execute.mockResolvedValueOnce({ ok: true, value: undefined })
    bridge.executeCommand(windowId, '/missing')
    await prepared.runtime.flush()
    expect(execute).toHaveBeenCalledWith(expect.anything(), '/missing', [])
    expect(channel.getSnapshot().commandError).toBe('Unknown command /missing')

    execute.mockResolvedValueOnce({ ok: true, value: { commandId: 'c1', result: { kind: 'error', text: 'bad argument' } } })
    bridge.executeCommand(windowId, '/goal x')
    await prepared.runtime.flush()
    expect(channel.getSnapshot().commandError).toBe('bad argument')

    execute.mockResolvedValueOnce({ ok: true, value: { commandId: 'c2', result: { kind: 'success' } } })
    bridge.executeCommand(windowId, '/compact')
    await prepared.runtime.flush()
    expect(channel.getSnapshot().commandError).toBeUndefined()
  })

  it('clears a command failure when the next prompt is sent', async () => {
    const { prepared, bridge } = await bench()
    const windowId = 'a1' as WindowId
    const channel = bridge.channel(windowId)
    bridge.ensure(windowId)
    await prepared.runtime.flush()

    const execute = vi.fn(async () => ({ ok: true as const, value: undefined }))
    ;(prepared.runtime.ctx.remote as unknown as { commands: { execute: unknown } }).commands.execute = execute
    bridge.executeCommand(windowId, '/missing')
    await prepared.runtime.flush()
    expect(channel.getSnapshot().commandError).toBeDefined()

    bridge.send(windowId, 'привет', 'queue')
    await prepared.runtime.flush()
    expect(channel.getSnapshot().commandError).toBeUndefined()
  })

  it('stages files through the upload service and reports failures', async () => {
    const { prepared, bridge } = await bench()
    const windowId = 'a1' as WindowId
    bridge.ensure(windowId)
    await prepared.runtime.flush()

    const upload = vi.fn(async () => ({ ok: true as const, value: { receiptId: 'receipt-1' } }))
    prepared.runtime.fileUpload.available = true
    prepared.runtime.fileUpload.upload = upload
    await expect(bridge.uploadFile(windowId, 'a.txt', new Uint8Array([1]))).resolves.toEqual({ receiptId: 'receipt-1' })

    prepared.runtime.fileUpload.available = false
    const refused = await bridge.uploadFile(windowId, 'a.txt', new Uint8Array([1]))
    expect(refused.error).toBe('File uploads are unavailable on this host')
  })

  it('drops every record on disposal', async () => {
    const { prepared, bridge } = await bench()
    bridge.ensure('a1' as WindowId)
    await prepared.runtime.flush()
    expect(bridge.windowIds()).toHaveLength(1)

    bridge.dispose()
    expect(bridge.windowIds()).toEqual([])
  })

  it('restores every stored pair, opening each session once', async () => {
    const { prepared, bridge } = await twoChatBench()
    const first = 'a1' as WindowId
    const second = 'a2' as WindowId

    bridge.restore({ a1: 'session-1', a2: 'session-2' }, [first, second])
    await prepared.runtime.flush()

    expect(openedSessions(prepared)).toEqual(['session-1', 'session-2'])
    expect(bridge.channel(first).getSnapshot()).toMatchObject({ status: 'ready', sessionId: 'session-1' })
    expect(bridge.channel(second).getSnapshot()).toMatchObject({
      status: 'ready',
      sessionId: 'session-2',
      displayTitle: 'Second chat',
    })
    expect(createdSessions(prepared)).toEqual([])
  })

  it('keeps a restored window restoring until the list answers, then attaches it', async () => {
    const { prepared, bridge } = await bench()
    const windowId = 'a1' as WindowId
    const channel = bridge.channel(windowId)
    // The baseline has not answered yet: a pair the list cannot confirm must
    // not be read as missing.
    prepared.runtime.sessions.list.update((draft) => { draft.phase = 'pending' })
    await prepared.runtime.flush()

    bridge.restore({ a1: 'session-offline' }, [windowId])

    expect(channel.getSnapshot().status).toBe('restoring')
    expect(createdSessions(prepared)).toEqual([])

    await prepared.runtime.sessions.add({
      id: 'session-offline',
      session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) },
    })
    await prepared.runtime.flush()

    expect(channel.getSnapshot()).toMatchObject({ status: 'ready', sessionId: 'session-offline' })
  })

  it('marks a restored session the list does not hold as missing and reattaches when it returns', async () => {
    const { prepared, bridge } = await bench()
    const windowId = 'a1' as WindowId
    const channel = bridge.channel(windowId)

    bridge.restore({ a1: 'gone' }, [windowId])
    await prepared.runtime.flush()

    expect(channel.getSnapshot().status).toBe('missing')
    expect(channel.getSnapshot().sessionId).toBe('gone')
    // A missing chat is never silently replaced: the body offers create or pick.
    bridge.ensure(windowId)
    await prepared.runtime.flush()
    expect(createdSessions(prepared)).toEqual([])

    await prepared.runtime.sessions.add({
      id: 'gone',
      session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) },
    })
    await prepared.runtime.flush()

    expect(channel.getSnapshot()).toMatchObject({ status: 'ready', sessionId: 'gone' })
  })

  it('replaces a missing session when the window starts a new chat', async () => {
    const { prepared, bridge } = await bench()
    const windowId = 'a1' as WindowId
    const channel = bridge.channel(windowId)
    bridge.restore({ a1: 'gone' }, [windowId])
    await prepared.runtime.flush()
    expect(channel.getSnapshot().status).toBe('missing')

    await bridge.startChat(windowId)
    await prepared.runtime.flush()

    // The explicit recovery replaces the dead pair; the new chat is bound.
    expect(channel.getSnapshot()).toMatchObject({ status: 'ready', sessionId: 'session-1' })
    expect(bridge.bindings()).toEqual({ a1: 'session-1' })
  })

  it('moves an attached window to missing when its session leaves the list and back when it returns', async () => {
    const { prepared, bridge } = await bench()
    const windowId = 'a1' as WindowId
    const channel = bridge.channel(windowId)
    bridge.restore({ a1: 'session-1' }, [windowId])
    await prepared.runtime.flush()
    expect(channel.getSnapshot().status).toBe('ready')

    await prepared.runtime.sessions.remove('session-1')
    await prepared.runtime.flush()
    expect(channel.getSnapshot().status).toBe('missing')
    expect(channel.getSnapshot().chat).toBeUndefined()
    expect(bridge.windowIds()).toEqual([windowId])
    expect(createdSessions(prepared)).toEqual([])

    await prepared.runtime.sessions.add({
      id: 'session-1',
      session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) },
    })
    await prepared.runtime.flush()
    expect(channel.getSnapshot().status).toBe('ready')
    expect(openedSessions(prepared)).toEqual(['session-1', 'session-1'])
  })

  it('drops duplicate and stale pairs on restore, persisting the reconciled map', async () => {
    const persistBindings = vi.fn()
    const { prepared, bridge } = await twoChatBench({ persistBindings })
    const first = 'a1' as WindowId
    const second = 'a2' as WindowId

    bridge.restore({ a1: 'session-1', a2: 'session-1', ghost: 'session-2' }, [first, second])
    await prepared.runtime.flush()

    // One session, one window: the later duplicate is not attached, and the
    // pair of a window the layout no longer holds never reaches the board.
    expect(bridge.bindings()).toEqual({ a1: 'session-1' })
    expect(persistBindings).toHaveBeenLastCalledWith({ a1: 'session-1' })
    expect(bridge.windowFor('session-1' as SessionId)).toBe(first)
    expect(bridge.channel(second).getSnapshot().sessionId).toBeUndefined()
  })

  it('reports duplicate, unknown, and same outcomes instead of rebinding silently', async () => {
    const { prepared, bridge } = await twoChatBench()
    const first = 'a1' as WindowId
    const second = 'a2' as WindowId
    bridge.restore({ a1: 'session-1' }, [first])
    await prepared.runtime.flush()

    expect(bridge.bind(second, 'session-1' as SessionId)).toEqual({ kind: 'duplicate', windowId: first })
    expect(bridge.channel(second).getSnapshot().sessionId).toBeUndefined()
    expect(bridge.bind(first, 'session-1' as SessionId)).toEqual({ kind: 'same' })
    expect(bridge.bind(second, 'no-such-session' as SessionId)).toEqual({ kind: 'unknown' })

    expect(bridge.bind(second, 'session-2' as SessionId)).toEqual({ kind: 'bound' })
    await prepared.runtime.flush()
    expect(bridge.channel(first).getSnapshot().sessionId).toBe('session-1')
    expect(bridge.channel(second).getSnapshot().sessionId).toBe('session-2')
  })

  it('persists the map on creation, rebind, and close, and never on disposal', async () => {
    const persistBindings = vi.fn()
    const { prepared, bridge } = await bench({ persistBindings })
    const windowId = 'a1' as WindowId

    bridge.ensure(windowId)
    await prepared.runtime.flush()
    expect(persistBindings).toHaveBeenLastCalledWith({ a1: 'session-1' })

    await prepared.runtime.sessions.add({
      id: 'session-2',
      session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) },
      summary: { displayTitle: 'Second chat' },
    })
    bridge.bind(windowId, 'session-2' as SessionId)
    await prepared.runtime.flush()
    expect(persistBindings).toHaveBeenLastCalledWith({ a1: 'session-2' })

    bridge.release(windowId)
    expect(persistBindings).toHaveBeenLastCalledWith({})

    persistBindings.mockClear()
    bridge.dispose()
    expect(persistBindings).not.toHaveBeenCalled()
  })

  it('reuses a project blank session only while no other window shows it', async () => {
    const { prepared, bridge } = await twoChatBench()
    const blank = await prepared.runtime.sessions.add(
      { id: 'blank-1', summary: { blank: true, displayTitle: 'New Session' } },
      { current: false },
    )
    await prepared.runtime.workspaces.update((draft) => {
      draft.items = [{
        workspaceId: 'ws-1' as never,
        path: '/work/project',
        title: 'Project',
        sessionIds: [blank],
        createdAt: '',
        updatedAt: '',
      }]
    })
    const first = 'a1' as WindowId
    const second = 'a2' as WindowId

    await bridge.startChat(first, 'ws-1' as never)
    expect(bridge.channel(first).getSnapshot().sessionId).toBe(blank)

    // The reusable blank chat belongs to one window: the second window creates
    // its own chat instead of stealing the one the first window shows.
    await bridge.startChat(second, 'ws-1' as never)
    expect(bridge.channel(first).getSnapshot().sessionId).toBe(blank)
    expect(bridge.channel(second).getSnapshot().sessionId).not.toBe(blank)
    expect(bridge.channel(second).getSnapshot().sessionId).toBeDefined()
  })

  it('drops a creation that settles after its window closed', async () => {
    const { prepared, bridge } = await bench()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    prepared.runtime.sessions.stubCreate(async () => {
      await gate
      return 'session-1' as SessionId
    })
    const windowId = 'a1' as WindowId

    bridge.ensure(windowId)
    bridge.release(windowId)
    release()
    await prepared.runtime.flush()

    expect(bridge.windowIds()).toEqual([])
    expect(bridge.bindings()).toEqual({})
  })

  it('keeps the chat the user picks while a creation is in flight', async () => {
    const { prepared, bridge } = await bench()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    prepared.runtime.sessions.stubCreate(async () => {
      await gate
      return 'session-1' as SessionId
    })
    const windowId = 'a1' as WindowId
    const channel = bridge.channel(windowId)
    await prepared.runtime.sessions.add({
      id: 'session-2',
      session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) },
      summary: { displayTitle: 'Picked chat' },
    })

    bridge.ensure(windowId)
    expect(bridge.bind(windowId, 'session-2' as SessionId)).toEqual({ kind: 'bound' })
    release()
    await prepared.runtime.flush()

    // The late creation does not clobber the chat the user chose meanwhile.
    expect(channel.getSnapshot()).toMatchObject({
      status: 'ready',
      sessionId: 'session-2',
      displayTitle: 'Picked chat',
    })
  })

  it('releases the previous session subscriptions on rebind', async () => {
    const { prepared, bridge } = await twoChatBench()
    const windowId = 'a1' as WindowId
    const channel = bridge.channel(windowId)
    bridge.restore({ a1: 'session-1' }, [windowId])
    await prepared.runtime.flush()

    bridge.bind(windowId, 'session-2' as SessionId)
    await prepared.runtime.flush()
    expect(channel.getSnapshot().sessionId).toBe('session-2')
    const afterRebind = channel.getSnapshot()

    await prepared.runtime.sessions.updateSessionSnapshot('session-1', (draft) => {
      draft.lastAgentError = 'old session exploded'
    })
    await prepared.runtime.flush()
    expect(channel.getSnapshot()).toBe(afterRebind)

    for (let cycle = 0; cycle < 5; cycle += 1) {
      bridge.bind(windowId, (cycle % 2 === 0 ? 'session-1' : 'session-2') as SessionId)
      await prepared.runtime.flush()
    }
    expect(Object.keys(bridge.bindings())).toEqual(['a1'])
  })

  it('leaves no subscription or map growth across open-close cycles', async () => {
    const { prepared, bridge } = await bench()
    const windowId = 'a1' as WindowId
    bridge.ensure(windowId)
    await prepared.runtime.flush()
    const sessionId = bridge.channel(windowId).getSnapshot().sessionId
    if (sessionId === undefined) throw new Error('missing session id')
    const deadChannel = bridge.channel(windowId)
    const frozen = deadChannel.getSnapshot()

    bridge.release(windowId)
    // A released record must not answer the dead session's later changes: the
    // channel reference it left behind stays at its last published state.
    await prepared.runtime.sessions.updateSessionSnapshot(sessionId, (draft) => { draft.running = true })
    await prepared.runtime.flush()
    expect(deadChannel.getSnapshot()).toBe(frozen)

    for (let cycle = 0; cycle < 5; cycle += 1) {
      bridge.ensure(windowId)
      await prepared.runtime.flush()
      bridge.release(windowId)
    }
    expect(bridge.windowIds()).toEqual([])
    expect(bridge.bindings()).toEqual({})
    // One creation per cycle, no growth: closing a window never deletes the
    // session, and reopening never leaks a second record or subscription.
    expect(createdSessions(prepared)).toHaveLength(6)
    expect(prepared.runtime.sessions.list.getSnapshot().ids).toContain(sessionId)
  })
})
