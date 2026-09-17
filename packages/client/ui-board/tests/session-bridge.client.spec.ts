// @vitest-environment jsdom
/**
 * Window session bridge: one record per open window. Closing a window drops
 * its record, channel, and session subscriptions while the session itself
 * stays alive and listed; disposing the plugin releases everything.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { ConversationNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { BoardSessionBridge } from '../src/client/session-bridge.ts'
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

async function bench() {
  const prepared = await createBoardBench({
    session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) },
  })
  runtimes.add(prepared.runtime)
  // The bridge produces a few of its own failure lines from the board
  // dictionary; production `apply` registers it before constructing the bridge.
  prepared.runtime.ctx.locale.register(NS, { zh, en })
  const bridge = new BoardSessionBridge(prepared.runtime.ctx)
  return { prepared, bridge }
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
})
