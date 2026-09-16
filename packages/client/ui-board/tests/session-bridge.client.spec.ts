// @vitest-environment jsdom
/**
 * Window session bridge: one record per open window. Closing a window drops
 * its record, channel, and session subscriptions while the session itself
 * stays alive and listed; disposing the plugin releases everything.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { BoardSessionBridge } from '../src/client/session-bridge.ts'
import type { WindowId } from '../src/client/contract/slots.ts'
import { createBoardBench } from './fixtures.client.ts'

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

  it('drops every record on disposal', async () => {
    const { prepared, bridge } = await bench()
    bridge.ensure('a1' as WindowId)
    await prepared.runtime.flush()
    expect(bridge.windowIds()).toHaveLength(1)

    bridge.dispose()
    expect(bridge.windowIds()).toEqual([])
  })
})
