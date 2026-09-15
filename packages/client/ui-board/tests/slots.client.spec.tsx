// @vitest-environment jsdom
/**
 * Board slot composition: the layer cascade and its render sites, keyed window
 * dispatch per type, the keyed window-body seat, open-close cycles, and
 * disposal with the plugin fiber.
 */
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { createBoardStore } from '../src/client/store.ts'
import type { WindowId } from '../src/client/contract/slots.ts'

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
  const runtime = await SlotTestRuntime.create()
  runtimes.add(runtime)
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  await runtime.mount({
    inject: ['slots'],
    apply(ctx: Context) {
      ctx.provide('locale', locale)
      ctx.slots.installLocale(locale)
    },
  })
  await runtime.declare({
    main: { kind: 'keyed', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
  })
  const board = await runtime.mount({ inject: [...inject], apply })
  return { runtime, board }
}

/** The window state literal the composition tests vary. */
function windowState(overrides: Partial<Parameters<BoardInstance['actions']['openWindow']>[0]> & { id: WindowId }) {
  return {
    kind: 'agent' as const,
    bodyKind: 'conversation' as const,
    title: 'Agent',
    width: 480,
    height: 560,
    ...overrides,
  }
}

describe('board slot composition', () => {
  it('declares the full board cascade and occupies every declared slot', async () => {
    const { runtime } = await bench()

    // The panel entry declares the four floating layers it renders.
    const panel = runtime.slots.entries('main')[0]
    expect(Object.keys(panel?.children ?? {})).toEqual([
      'board.canvas', 'board.dock', 'board.omnibar', 'board.minimap',
    ])
    for (const key of ['board.canvas', 'board.dock', 'board.omnibar', 'board.minimap'] as const) {
      expect(runtime.slots.entriesOfSlot(key)).toHaveLength(1)
    }

    // Cascade: canvas declares the window layer, the layer declares both keyed window seats.
    expect(runtime.slots.entriesOfSlot('board.windows')).toHaveLength(1)
    expect(runtime.slots.entries('board.windows')[0]?.children).toEqual({
      'board.window': { kind: 'keyed', scope: 'root' },
      'board.window.body': { kind: 'keyed', scope: 'root' },
    })
    expect(runtime.slots.spec('board.window')).toEqual({ kind: 'keyed', scope: 'root' })
    expect(runtime.slots.spec('board.window.body')).toEqual({ kind: 'keyed', scope: 'root' })

    // One frame registration per window type, one body registration per default body.
    expect(runtime.slots.entries('board.window').map(entry => entry.options.key)).toEqual([
      'agent', 'clone', 'connectors', 'settings', 'dashboard', 'tasks',
    ])
    expect(runtime.slots.entries('board.window.body').map(entry => entry.options.key)).toEqual([
      'conversation', 'connectors', 'settings',
    ])

    expect(runtime.slots.entries('sidebar.panellist').map(entry => entry.options.id)).toEqual(['board'])
  })

  it('renders every declared layer and puts the window layer inside the canvas transform', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    // Every declared layer has its render site: a dropped renderSlot call leaves the layer missing.
    for (const layer of ['canvas', 'dock', 'omnibar', 'minimap'] as const) {
      expect(panel.container.querySelectorAll(`[data-board-layer="${layer}"]`)).toHaveLength(1)
    }

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()

    // The window layer renders inside the transformed canvas surface, not beside the canvas.
    const transformed = panel.container.querySelectorAll('[data-surface="canvas"]')[1]
    expect(transformed?.querySelectorAll('[data-board-window="agent"]')).toHaveLength(1)
  })

  it('routes each window to the frame registered for its kind', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, title: 'First agent' }))
      board.actions.openWindow(windowState({
        id: 't1' as WindowId, kind: 'connectors', bodyKind: 'connectors', title: 'Tools', width: 520, height: 480,
      }))
    })
    await runtime.flush()

    // Each frame renders its own component: the dark card's composer and the light frame's tabs
    // are mutually exclusive, so a frame dispatched to the wrong occupant fails these assertions.
    const agentFrame = panel.container.querySelector('[data-board-window="agent"]')
    const toolFrame = panel.container.querySelector('[data-board-window="connectors"]')
    expect(agentFrame?.querySelector('input[placeholder="Ask agent anything..."]')).not.toBeNull()
    expect(toolFrame?.querySelector('input[placeholder="Ask agent anything..."]')).toBeNull()
    expect(toolFrame?.textContent).toContain('Built-in Connectors & MCP Tools')
    expect(agentFrame?.textContent).not.toContain('Built-in Connectors & MCP Tools')
    expect(toolFrame?.textContent).toContain('Settings')
  })

  it('swaps the body occupant when bodyKind changes', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.openWindow(windowState({
        id: 'a1' as WindowId, statusText: 'All routine tasks completed.',
      }))
    })
    await runtime.flush()
    expect(panel.view.getByText(/autonomous AI expert twin/)).not.toBeNull()

    // The connectors body is a different component, so this proves the body seat dispatch.
    act(() => { board.actions.setWindowBodyKind('a1' as WindowId, 'connectors') })
    await runtime.flush()
    expect(panel.view.queryByText(/autonomous AI expert twin/)).toBeNull()
    expect(panel.view.getByText('Built-in Connectors & MCP Tools')).not.toBeNull()
  })

  it('renders the tool body panes selected by bodyKind', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.openWindow(windowState({
        id: 't1' as WindowId, kind: 'connectors', bodyKind: 'connectors', title: 'Tools', width: 520, height: 480,
      }))
    })
    await runtime.flush()
    expect(panel.view.getByText('Built-in Connectors & MCP Tools')).not.toBeNull()

    // The settings body reuses the tool window's configuration pane.
    act(() => { board.actions.setWindowBodyKind('t1' as WindowId, 'settings') })
    await runtime.flush()
    expect(panel.view.queryByText('Built-in Connectors & MCP Tools')).toBeNull()
    expect(panel.view.getByText('Agent Configuration')).not.toBeNull()
    expect(panel.view.getByText('System Prompt')).not.toBeNull()
  })

  it('renders the conversation body for an agent window and nothing for an unoccupied body kind', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.openWindow(windowState({
        id: 'a1' as WindowId,
        statusText: 'All routine tasks completed.',
      }))
      board.actions.openWindow(windowState({
        id: 'c1' as WindowId,
        kind: 'clone',
        bodyKind: 'clone-memory',
        title: 'Clone memory',
      }))
    })
    await runtime.flush()

    expect(panel.view.getByText('All routine tasks completed.')).not.toBeNull()
    expect(panel.view.getByText(/autonomous AI expert twin/)).not.toBeNull()

    // A body kind without an occupant renders the frame with an empty body region.
    const cloneFrame = panel.container.querySelector('[data-board-window="clone"]')
    expect(cloneFrame).not.toBeNull()
    expect(cloneFrame?.textContent).toContain('Clone memory')
    expect(cloneFrame?.textContent).not.toContain('autonomous AI expert twin')
    expect(cloneFrame?.textContent).not.toContain('Built-in Connectors & MCP Tools')
  })

  it('closes a window through its frame and removes it from the layer', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, title: 'First agent' }))
      board.actions.openWindow(windowState({ id: 'a2' as WindowId, title: 'Second agent' }))
    })
    await runtime.flush()
    expect(panel.container.querySelectorAll('[data-board-window="agent"]')).toHaveLength(2)

    const firstFrame = panel.container.querySelectorAll('[data-board-window="agent"]')[0] as HTMLElement
    fireEvent.click(firstFrame.querySelector('button[title="Close"]') as Element)
    await runtime.flush()

    expect(panel.container.querySelectorAll('[data-board-window="agent"]')).toHaveLength(1)
    expect(board.store.getSnapshot().windowOrder).toHaveLength(1)
    expect(panel.view.queryByText('First agent')).toBeNull()
    expect(panel.view.getByText('Second agent')).not.toBeNull()
  })

  it('keeps the ledger, DOM, and store flat across open-close cycles', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    const baselineNodes = panel.container.querySelectorAll('*').length

    for (let cycle = 0; cycle < 10; cycle += 1) {
      act(() => {
        board.actions.openWindow(windowState({ id: `a${String(cycle)}` as WindowId }))
        board.actions.openWindow(windowState({
          id: `t${String(cycle)}` as WindowId, kind: 'connectors', bodyKind: 'connectors', title: 'Tools',
        }))
      })
      await runtime.flush()
      act(() => {
        board.actions.closeWindow(`a${String(cycle)}` as WindowId)
        board.actions.closeWindow(`t${String(cycle)}` as WindowId)
      })
      await runtime.flush()
    }

    expect(board.store.getSnapshot().windows).toEqual({})
    expect(panel.container.querySelectorAll('[data-board-window]')).toHaveLength(0)
    expect(panel.container.querySelectorAll('*').length).toBe(baselineNodes)
    expect(runtime.slots.entriesOfSlot('board.canvas')).toHaveLength(1)
    expect(runtime.slots.entriesOfSlot('board.windows')).toHaveLength(1)
    expect(runtime.slots.entries('board.window')).toHaveLength(6)
    expect(runtime.slots.entries('board.window.body')).toHaveLength(3)
  })

  it('re-applies without duplicating registrations and renders again', async () => {
    const { runtime, board } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    await board.dispose()
    // The first mount's DOM must be gone before the rebuild, or the render assertion below is stale.
    await vi.waitFor(() => {
      expect(panel.container.querySelector('[data-surface="canvas"]')).toBeNull()
    })

    const second = await runtime.mount({ inject: [...inject], apply })
    try {
      expect(runtime.slots.entries('main').map(entry => entry.options.key)).toEqual(['board'])
      expect(runtime.slots.entriesOfSlot('board.canvas')).toHaveLength(1)
      expect(runtime.slots.entriesOfSlot('board.windows')).toHaveLength(1)
      expect(runtime.slots.entries('board.window')).toHaveLength(6)
      expect(runtime.slots.entries('board.window.body')).toHaveLength(3)
      await vi.waitFor(() => {
        expect(panel.container.querySelector('[data-surface="canvas"]')).not.toBeNull()
      })
    } finally {
      await second.dispose()
    }
  })

  it('withdraws every board contribution with the plugin fiber', async () => {
    const { runtime, board } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const instance = runtime.storeOf('board.dock') as BoardInstance

    act(() => { instance.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()
    // The window and its layer exist before disposal, so the withdrawal cannot pass vacuously.
    expect(panel.container.querySelectorAll('[data-board-window]')).toHaveLength(1)
    expect(runtime.slots.entriesOfSlot('board.window')).toHaveLength(6)

    await board.dispose()

    for (const key of [
      'board.window', 'board.window.body', 'board.windows', 'board.canvas',
      'board.dock', 'board.omnibar', 'board.minimap', 'sidebar.panellist', 'main',
    ] as const) {
      expect(runtime.slots.entries(key)).toEqual([])
    }
    expect(runtime.slots.entriesOfSlot('board.window')).toEqual([])
    // The layers the panel entry declared collapse with it.
    expect(runtime.slots.spec('board.canvas')).toBeUndefined()
    expect(runtime.slots.spec('board.windows')).toBeUndefined()
    await vi.waitFor(() => {
      expect(panel.container.querySelectorAll('[data-board-window]')).toHaveLength(0)
      expect(panel.container.querySelector('[data-surface="canvas"]')).toBeNull()
    })
  })
})
