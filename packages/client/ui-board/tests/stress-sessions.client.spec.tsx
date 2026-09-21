// @vitest-environment jsdom
/**
 * Stress test: 10 sessions simultaneously on the board, 5 parallel streams
 * executing concurrently without crosstalk or interference, and one failed
 * stream confined to its own window.
 *
 * Substage 14.1 behavior under the stress scenario:
 * - 10 windows open simultaneously on BoardSessionBridge and render in board slots.
 * - 5 parallel streams update and settle concurrently; all 5 receive their answers.
 * - No console errors, and no bridge record or channel is left behind.
 * - Failure isolation: one refused prompt does not degrade the other streams.
 *
 * The FPS, worst-frame, long-task, and window-open budgets of §II.4 are measured
 * in the live-browser audit (`docs/ketos/perf-baseline.md`); jsdom has no
 * compositor, so this spec asserts behavior only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent } from '@testing-library/react'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ChatSnapshot, ConversationNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createBoardStore } from '../src/client/store.ts'
import type { WindowId } from '../src/client/contract/slots.ts'
import { chatSnapshot, createBoardBench } from './fixtures.client.ts'
import { BoardSessionBridge } from '../src/client/session-bridge.ts'

type BoardInstance = ReturnType<ReturnType<typeof createBoardStore>['create']>

const SESSION_COUNT = 10
const STREAM_COUNT = 5

const runtimes = new Set<SlotTestRuntime>()

afterEach(async () => {
  try {
    for (const runtime of runtimes) await runtime.dispose()
  } finally {
    runtimes.clear()
    cleanup()
  }
})

/** User node for transcripts. */
function userNode(text: string, seq = 1): ConversationNode {
  return {
    kind: 'user',
    seq,
    time: 0,
    content: [{ type: 'text', text }],
    source: undefined,
  }
}

/** Assistant node for transcript completion. */
function assistantNode(text: string, seq = 2): ConversationNode {
  return {
    kind: 'assistant',
    seq,
    time: 0,
    turn: 1,
    step: 1,
    blocks: [{ kind: 'text', text }],
  }
}

/** Partial block structure for incremental streaming. */
function streamingPartial(text: string): ChatSnapshot['legacy']['partial'] {
  return {
    turn: 1,
    step: 1,
    blocks: [{ kind: 'text', text }],
  }
}

/**
 * Build a multi-session test bench preconfigured with 10 distinct sessions,
 * per-session chat targets, and controllable prompt stubs.
 */
async function multiSessionBench(sessionCount = SESSION_COUNT) {
  const chatStores = new Map<string, SnapshotStore<ChatSnapshot | undefined>>()
  const promptSpies = new Map<string, ReturnType<typeof vi.fn>>()
  const promptResolvers = new Map<string, () => void>()

  for (let i = 1; i <= sessionCount; i++) {
    const id = `session-${i}`
    chatStores.set(id, createSnapshotStore<ChatSnapshot | undefined>(chatSnapshot()))
    promptSpies.set(id, vi.fn(async () => {
      await new Promise<void>((resolve) => {
        promptResolvers.set(id, resolve)
        // Default resolve in next microtask unless controlled
        queueMicrotask(resolve)
      })
      return { ok: true as const, value: { accepted: true } }
    }))
  }

  const extraSessions = []
  for (let i = 2; i <= sessionCount; i++) {
    const id = `session-${i}`
    extraSessions.push({
      id,
      displayTitle: `Agent Session ${i}`,
      session: {
        prompt: promptSpies.get(id),
      },
    })
  }

  let createdSeq = 0
  const prepared = await createBoardBench({
    session: {
      prompt: promptSpies.get('session-1'),
    },
    sessionSummary: { displayTitle: 'Agent Session 1' },
    extraSessions,
    chatTargetFor: (sessionId) => {
      let store = chatStores.get(sessionId)
      if (store === undefined) {
        store = createSnapshotStore<ChatSnapshot | undefined>(chatSnapshot())
        chatStores.set(sessionId, store)
      }
      return store
    },
    createSession: async () => {
      createdSeq += 1
      return `session-${createdSeq}` as SessionId
    },
  })

  runtimes.add(prepared.runtime)
  const board = await prepared.mountBoard()

  return {
    prepared,
    board,
    chatStores,
    promptSpies,
    promptResolvers,
    runtime: prepared.runtime,
  }
}

describe('Stage 14.1: 10 Sessions Stress Scenario', () => {
  /** Console errors observed since the spy was installed. */
  const consoleErrors: unknown[][] = []
  const consoleRestorers: (() => void)[] = []

  beforeEach(() => {
    consoleErrors.length = 0
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { consoleErrors.push(args) })
    consoleRestorers.push(() => { spy.mockRestore() })
  })

  afterEach(() => {
    for (const restore of consoleRestorers.splice(0)) restore()
  })

  it('opens 10 windows with distinct sessions in board slots', async () => {
    const { runtime } = await multiSessionBench(10)
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.setViewport(3000, 2000)
    })

    // Open 10 windows arranged in a 5x2 grid on the board canvas
    for (let i = 1; i <= 10; i++) {
      const windowId = `w${i}` as WindowId

      act(() => {
        board.actions.addWindow({
          id: windowId,
          kind: 'agent',
          bodyKind: 'conversation',
          ordinal: i,
          x: ((i - 1) % 5) * 580,
          y: Math.floor((i - 1) / 5) * 680,
          width: 552,
          height: 648,
          zIndex: 10 + i,
        })
      })
      await runtime.flush()
    }

    // All 10 windows are rendered in the DOM
    const renderedWindows = panel.container.querySelectorAll('[data-board-window="agent"]')
    expect(renderedWindows).toHaveLength(10)

    // Each window has its distinct id and its own chat title
    for (let i = 1; i <= 10; i++) {
      const windowFrame = panel.container.querySelector(`[data-board-window-id="w${i}"]`)
      expect(windowFrame).not.toBeNull()
      expect(windowFrame?.textContent).toContain(`Agent Session ${i}`)
    }

    // All 10 sessions were opened via ctx.sessions.open
    const opened = runtime.sessions.calls
      .filter(call => call.method === 'open')
      .map(call => call.args[0])
    for (let i = 1; i <= 10; i++) {
      expect(opened).toContain(`session-${i}`)
    }

    // Zero console errors or warnings
    const realErrors = consoleErrors.filter(
      (args: unknown[]) => !args.some((a: unknown) => String(a).includes('act(')),
    )
    expect(realErrors).toHaveLength(0)
  })

  it('executes 5 parallel streams concurrently without crosstalk or interference', async () => {
    const { runtime, chatStores, promptSpies } = await multiSessionBench(10)
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    // 1. Mount 10 windows
    act(() => {
      board.actions.setViewport(3000, 2000)
      for (let i = 1; i <= 10; i++) {
        board.actions.addWindow({
          id: `w${i}` as WindowId,
          kind: 'agent',
          bodyKind: 'conversation',
          ordinal: i,
          x: ((i - 1) % 5) * 580,
          y: Math.floor((i - 1) / 5) * 680,
          width: 552,
          height: 648,
          zIndex: 10 + i,
        })
      }
    })
    await runtime.flush()

    expect(panel.container.querySelectorAll('[data-board-window="agent"]')).toHaveLength(10)

    // 2. Dispatch 5 concurrent prompts to windows w1..w5 via the composer UI
    for (let i = 1; i <= STREAM_COUNT; i++) {
      const frame = panel.container.querySelector(`[data-board-window-id="w${i}"]`)!
      const textarea = frame.querySelector('textarea')!
      const sendBtn = frame.querySelector('button[aria-label="Send"]')!
      fireEvent.change(textarea, { target: { value: `Prompt for session ${i}` } })
      fireEvent.click(sendBtn)
    }
    await runtime.flush()

    // Verify all 5 prompt handlers were invoked
    for (let i = 1; i <= STREAM_COUNT; i++) {
      expect(promptSpies.get(`session-${i}`)).toHaveBeenCalled()
    }
    // Verify sessions 6..10 were NOT prompted (isolated)
    for (let i = STREAM_COUNT + 1; i <= SESSION_COUNT; i++) {
      expect(promptSpies.get(`session-${i}`)).not.toHaveBeenCalled()
    }

    // 3. Phase 1: Stream chunk 1 concurrently across the 5 sessions
    for (let i = 1; i <= STREAM_COUNT; i++) {
      const sessionId = `session-${i}`
      chatStores.get(sessionId)!.set(
        chatSnapshot(
          [userNode(`Prompt for session ${i}`)],
          streamingPartial(`Chunk 1 response from session ${i}`),
        ),
      )
      await runtime.sessions.updateSessionSnapshot(sessionId, (s) => {
        s.running = true
      })
    }
    await runtime.flush()

    // Verify active streaming on windows 1..5 and isolation on windows 6..10
    for (let i = 1; i <= STREAM_COUNT; i++) {
      const frame = panel.container.querySelector(`[data-board-window-id="w${i}"]`)!
      const streamingEl = frame.querySelector('[data-board-streaming]')
      expect(streamingEl).not.toBeNull()
      expect(streamingEl?.textContent).toContain(`Chunk 1 response from session ${i}`)
      // Crosstalk check: verify window i does NOT contain text from any other session j
      for (let j = 1; j <= STREAM_COUNT; j++) {
        if (j !== i) {
          expect(frame.textContent).not.toContain(`Chunk 1 response from session ${j}`)
        }
      }
    }

    // Windows 6..10 must remain idle with no streaming indicators or crosstalk
    for (let i = STREAM_COUNT + 1; i <= SESSION_COUNT; i++) {
      const frame = panel.container.querySelector(`[data-board-window-id="w${i}"]`)!
      expect(frame.querySelector('[data-board-streaming]')).toBeNull()
      expect(frame.querySelector('[data-board-lane-state="running"]')).toBeNull()
      expect(frame.textContent).not.toContain('Chunk 1 response')
    }

    // 4. Phase 2: Stream chunk 2 concurrently across all 5 streams
    for (let i = 1; i <= STREAM_COUNT; i++) {
      const sessionId = `session-${i}`
      chatStores.get(sessionId)!.set(
        chatSnapshot(
          [userNode(`Prompt for session ${i}`)],
          streamingPartial(`Chunk 1 response from session ${i}\nChunk 2 appended from session ${i}`),
        ),
      )
    }
    await runtime.flush()

    // Verify updated chunk 2 on windows 1..5
    for (let i = 1; i <= STREAM_COUNT; i++) {
      const frame = panel.container.querySelector(`[data-board-window-id="w${i}"]`)!
      const streamingEl = frame.querySelector('[data-board-streaming]')
      expect(streamingEl?.textContent).toContain(`Chunk 2 appended from session ${i}`)
    }

    // 5. Phase 3: Settle all 5 streams concurrently with final assistant answers
    for (let i = 1; i <= STREAM_COUNT; i++) {
      const sessionId = `session-${i}`
      chatStores.get(sessionId)!.set(
        chatSnapshot([
          userNode(`Prompt for session ${i}`),
          assistantNode(`Complete response text for session ${i}`),
        ]),
      )
      await runtime.sessions.updateSessionSnapshot(sessionId, (s) => {
        s.running = false
      })
    }
    await runtime.flush()

    // Verify final state on windows 1..5
    for (let i = 1; i <= STREAM_COUNT; i++) {
      const frame = panel.container.querySelector(`[data-board-window-id="w${i}"]`)!
      // Streaming element retired
      expect(frame.querySelector('[data-board-streaming]')).toBeNull()
      // Assistant message present and contains complete response
      const assistantMsg = frame.querySelector('[data-board-message="assistant"]')
      expect(assistantMsg).not.toBeNull()
      expect(assistantMsg?.textContent).toContain(`Complete response text for session ${i}`)
      // No crosstalk in final responses
      for (let j = 1; j <= STREAM_COUNT; j++) {
        if (j !== i) {
          expect(frame.textContent).not.toContain(`Complete response text for session ${j}`)
        }
      }
    }

    // Windows 6..10 remain unaffected
    for (let i = STREAM_COUNT + 1; i <= SESSION_COUNT; i++) {
      const frame = panel.container.querySelector(`[data-board-window-id="w${i}"]`)!
      expect(frame.querySelector('[data-board-message="assistant"]')).toBeNull()
      expect(frame.textContent).not.toContain('Complete response text')
    }

    // Zero console errors
    const realErrors = consoleErrors.filter(
      (args: unknown[]) => !args.some((a: unknown) => String(a).includes('act(')),
    )
    expect(realErrors).toHaveLength(0)
  })

  it('opens another window and pans while 5 streams stay live', async () => {
    const { runtime, chatStores } = await multiSessionBench(10)
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.setViewport(3000, 2000)
      for (let i = 1; i <= 10; i++) {
        board.actions.addWindow({
          id: `w${i}` as WindowId,
          kind: 'agent',
          bodyKind: 'conversation',
          ordinal: i,
          x: ((i - 1) % 5) * 580,
          y: Math.floor((i - 1) / 5) * 680,
          width: 552,
          height: 648,
          zIndex: 10 + i,
        })
      }
    })
    await runtime.flush()

    // Put 5 sessions into active streaming state
    for (let i = 1; i <= STREAM_COUNT; i++) {
      const sessionId = `session-${i}`
      chatStores.get(sessionId)!.set(
        chatSnapshot(
          [userNode(`Active stream prompt ${i}`)],
          streamingPartial(`Active stream token ${i}`),
        ),
      )
      await runtime.sessions.updateSessionSnapshot(sessionId, (s) => {
        s.running = true
      })
    }
    await runtime.flush()

    // Pan the canvas across 24 steps under the live streams: every step keeps
    // the five streaming lanes mounted and painting their own text (the FPS
    // budget itself is measured in the live-browser audit, not in jsdom).
    for (let step = 1; step <= 24; step++) {
      act(() => {
        board.actions.setPan(-step * 24, -step * 16)
      })
      await runtime.flush()
    }
    for (let i = 1; i <= STREAM_COUNT; i++) {
      const streamingEl = panel.container
        .querySelector(`[data-board-window-id="w${i}"]`)
        ?.querySelector('[data-board-streaming]')
      expect(streamingEl?.textContent).toContain(`Active stream token ${i}`)
    }

    // A further window opens while the five streams are live and renders.
    act(() => {
      board.actions.addWindow({
        id: 'w11' as WindowId,
        kind: 'agent',
        bodyKind: 'conversation',
        ordinal: 11,
        x: 300,
        y: 300,
        width: 552,
        height: 648,
        zIndex: 25,
      })
    })
    await runtime.flush()

    expect(panel.container.querySelector('[data-board-window-id="w11"]')).not.toBeNull()
    expect(panel.container.querySelectorAll('[data-board-window="agent"]')).toHaveLength(11)
  })

  it('isolates stream failure on one session without degrading other parallel streams', async () => {
    const { prepared, chatStores, promptSpies } = await multiSessionBench(10)
    const bridge = new BoardSessionBridge(prepared.runtime.ctx)

    // Ensure all 10 windows are initialized on the bridge
    for (let i = 1; i <= 10; i++) {
      bridge.ensure(`w${i}` as WindowId)
    }
    await prepared.runtime.flush()

    expect(bridge.windowIds()).toHaveLength(10)

    // Configure session 3 prompt to reject/fail
    promptSpies.get('session-3')!.mockRejectedValueOnce(new Error('Network gateway timeout'))

    // Send 5 concurrent prompts
    const sendPromises = [
      bridge.send('w1' as WindowId, 'Prompt 1', 'queue'),
      bridge.send('w2' as WindowId, 'Prompt 2', 'queue'),
      bridge.send('w3' as WindowId, 'Prompt 3', 'queue'),
      bridge.send('w4' as WindowId, 'Prompt 4', 'queue'),
      bridge.send('w5' as WindowId, 'Prompt 5', 'queue'),
    ]

    const outcomes = await Promise.all(sendPromises)
    await prepared.runtime.flush()

    // w1, w2, w4, w5 succeeded; w3 failed
    expect(outcomes[0]).toBe(true)
    expect(outcomes[1]).toBe(true)
    expect(outcomes[2]).toBe(false)
    expect(outcomes[3]).toBe(true)
    expect(outcomes[4]).toBe(true)

    // Window 3 reports its prompt error on channel
    const w3State = bridge.channel('w3' as WindowId).getSnapshot()
    expect(w3State.promptError).toBe('Network gateway timeout')

    // Windows 1, 2, 4, 5 and 6..10 have NO prompt errors
    for (const id of ['w1', 'w2', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10'] as WindowId[]) {
      expect(bridge.channel(id).getSnapshot().promptError).toBeUndefined()
    }

    // Now stream and complete the remaining 4 successful sessions
    for (const i of [1, 2, 4, 5]) {
      const sessionId = `session-${i}`
      chatStores.get(sessionId)!.set(
        chatSnapshot([
          userNode(`Prompt ${i}`),
          assistantNode(`Isolated success response ${i}`),
        ]),
      )
      await prepared.runtime.sessions.updateSessionSnapshot(sessionId, (s) => {
        s.running = false
      })
    }
    await prepared.runtime.flush()

    for (const i of [1, 2, 4, 5]) {
      const state = bridge.channel(`w${i}` as WindowId).getSnapshot()
      expect(state.status).toBe('ready')
      expect(state.running).toBe(false)
      expect(state.chat?.legacy.nodes[1]?.kind).toBe('assistant')
    }

    bridge.dispose()
  })

  it('keeps bridge records and channels healthy across all 10 windows without memory residue on release', async () => {
    const { prepared } = await multiSessionBench(10)
    const bridge = new BoardSessionBridge(prepared.runtime.ctx)

    for (let i = 1; i <= 10; i++) {
      bridge.ensure(`w${i}` as WindowId)
    }
    await prepared.runtime.flush()

    expect(bridge.windowIds()).toHaveLength(10)

    // Verify all 10 channels are in 'ready' status
    for (let i = 1; i <= 10; i++) {
      const channel = bridge.channel(`w${i}` as WindowId).getSnapshot()
      expect(channel.status).toBe('ready')
      expect(channel.error).toBeUndefined()
      expect(channel.turnError).toBeUndefined()
      expect(channel.promptError).toBeUndefined()
      expect(channel.sessionId).toBe(`session-${i}`)
    }

    // Release all 10 windows
    for (let i = 1; i <= 10; i++) {
      bridge.release(`w${i}` as WindowId)
    }
    expect(bridge.windowIds()).toHaveLength(0)

    bridge.dispose()
  })
})
