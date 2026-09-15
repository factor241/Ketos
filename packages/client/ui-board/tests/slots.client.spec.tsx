// @vitest-environment jsdom
/**
 * Board slot composition: the layer cascade, one keyed window occupant per
 * window type, the keyed window-body seat, and disposal with the plugin fiber.
 */
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
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

  it('renders one frame occupant per window type with each instance from owner props', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, title: 'First agent' }))
      board.actions.openWindow(windowState({ id: 'a2' as WindowId, title: 'Second agent' }))
      board.actions.openWindow(windowState({ id: 't1' as WindowId, kind: 'connectors', bodyKind: 'connectors', title: 'Tools' }))
    })
    await runtime.flush()

    // Two agent windows share the single 'agent' registration; the props carry each instance.
    expect(panel.container.querySelectorAll('[data-board-window="agent"]')).toHaveLength(2)
    expect(panel.container.querySelectorAll('[data-board-window="connectors"]')).toHaveLength(1)
    expect(panel.view.getByText('First agent')).not.toBeNull()
    expect(panel.view.getByText('Second agent')).not.toBeNull()
    expect(runtime.slots.entries('board.window')).toHaveLength(6)
  })

  it('renders the body selected by bodyKind and swaps it when the kind changes', async () => {
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
  })

  it('re-applies without duplicating registrations and renders again', async () => {
    const { runtime, board } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    await board.dispose()

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
    expect(panel.container.querySelector('[data-surface="canvas"]')).not.toBeNull()

    await board.dispose()

    for (const key of [
      'board.window', 'board.window.body', 'board.windows', 'board.canvas',
      'board.dock', 'board.omnibar', 'board.minimap', 'sidebar.panellist', 'main',
    ] as const) {
      expect(runtime.slots.entries(key)).toEqual([])
    }
    // The layers the panel entry declared collapse with it.
    expect(runtime.slots.spec('board.canvas')).toBeUndefined()
    expect(runtime.slots.spec('board.windows')).toBeUndefined()
    await vi.waitFor(() => {
      expect(panel.container.querySelector('[data-surface="canvas"]')).toBeNull()
    })
  })
})
