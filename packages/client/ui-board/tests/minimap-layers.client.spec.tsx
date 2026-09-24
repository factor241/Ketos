// @vitest-environment jsdom
/**
 * Minimap layer gating: the map leaves while the chats panel is expanded or a
 * window fills the board, and projects the open windows again once it returns.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent } from '@testing-library/react'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { createBoardStore } from '../src/client/store.ts'
import type { WindowId } from '../src/client/contract/slots.ts'
import { createBoardBench } from './fixtures.client.ts'

/** The live board store instance the renderer resolves for the board's registrations. */
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

/** Bench with the services the board injects and the slots it occupies declared. */
async function bench() {
  const prepared = await createBoardBench({ session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) } })
  runtimes.add(prepared.runtime)
  await prepared.mountBoard()
  return prepared.runtime
}

/** One agent window spec literal; the board computes its placement. */
function agentWindow(id: string) {
  return {
    id: id as WindowId,
    kind: 'agent' as const,
    bodyKind: 'conversation' as const,
    ordinal: 1,
    width: 552,
    height: 648,
  }
}

describe('minimap layer gating', () => {
  it('hides the minimap while the chats panel is expanded and restores it on collapse', async () => {
    const runtime = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => { board.actions.openWindow(agentWindow('a1')) })
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-minimap] [data-board-rect="agent"]')).not.toBeNull()

    // An expanded panel is a management surface: the minimap stands down with
    // the rest of the floating chrome.
    fireEvent.click(panel.container.querySelector('button[aria-label="Chats"]') as Element)
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-minimap]')).toBeNull()
    expect(panel.container.querySelectorAll('[data-board-layer="minimap"]')).toHaveLength(0)
    expect(panel.container.querySelectorAll('[data-board-layer="omnibar"]')).toHaveLength(0)

    // Collapsing to the rail brings the chrome back with its projection intact.
    fireEvent.click(panel.container.querySelector('button[aria-label="Collapse the chats panel"]') as Element)
    await runtime.flush()
    expect(panel.container.querySelectorAll('[data-board-layer="minimap"]')).toHaveLength(1)
    expect(panel.container.querySelectorAll('[data-board-layer="omnibar"]')).toHaveLength(1)
    expect(panel.container.querySelector('[data-board-minimap] [data-board-rect="agent"]')).not.toBeNull()
  })

  it('hides the minimap in fullscreen and projects the windows again after exit', async () => {
    const runtime = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => { board.actions.openWindow(agentWindow('a1')) })
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-minimap] [data-board-rect="agent"]')).not.toBeNull()

    fireEvent.click(panel.container.querySelector('button[aria-label="Open fullscreen"]') as Element)
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-fullscreen]')).not.toBeNull()
    expect(panel.container.querySelector('[data-board-layer="minimap"]')).toBeNull()

    // Leaving the mode restores the chrome, and the map still projects the window.
    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-fullscreen]')).toBeNull()
    expect(panel.container.querySelectorAll('[data-board-layer="minimap"]')).toHaveLength(1)
    expect(panel.container.querySelector('[data-board-minimap] [data-board-rect="agent"]')).not.toBeNull()
  })
})
