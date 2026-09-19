// @vitest-environment jsdom
/**
 * Omnibox: draft delivery into the active chat window's session through the
 * shared window bridge, the Action Menu's window and capability entries with
 * their honest notices, the composer file-picker intent, and the portaled menu
 * placement.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import type { SlotTestRuntime, SlotView } from '@deepseek-ai/dsh-client-test-runtime'
import { createBoardStore } from '../src/client/store.ts'
import type { BoardWindowState, WindowId } from '../src/client/contract/slots.ts'
import { createBoardBench, t } from './fixtures.client.ts'

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

/** Bench with the board mounted and the main panel rendered; the fixture session's prompt is spied. */
async function bench() {
  const prompt = vi.fn((_content: unknown, _mode: string) =>
    Promise.resolve({ ok: true as const, value: { accepted: true } }))
  const prepared = await createBoardBench({ session: { prompt } })
  runtimes.add(prepared.runtime)
  await prepared.mountBoard()
  const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
  const board = prepared.runtime.storeOf('board.dock') as BoardInstance
  return { runtime: prepared.runtime, panel, board, prompt }
}

/** Bench whose fixture chat is a settled chat with a directory to list. */
async function chatBench() {
  const prompt = vi.fn((_content: unknown, _mode: string) =>
    Promise.resolve({ ok: true as const, value: { accepted: true } }))
  const prepared = await createBoardBench({
    session: { prompt },
    sessionSummary: { displayTitle: 'Warehouse report', cwd: '/work/warehouse' },
  })
  runtimes.add(prepared.runtime)
  await prepared.mountBoard()
  const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
  const board = prepared.runtime.storeOf('board.dock') as BoardInstance
  return { runtime: prepared.runtime, panel, board, prompt }
}

/** One agent window spec the store opens directly. */
function agentWindow(id: WindowId): Omit<BoardWindowState, 'x' | 'y' | 'zIndex'> {
  return { id, kind: 'agent', bodyKind: 'conversation', ordinal: 1, width: 552, height: 648 }
}

/** Open the `+` menu through its trigger. */
function openActionMenu(panel: SlotView<'main'>): void {
  fireEvent.click(panel.container.querySelector('[data-board-action="omnibar-action-menu"]') as Element)
}

describe('board omnibox', () => {
  it("sends the trimmed draft into the active chat window's session and clears the input", async () => {
    const { runtime, panel, board, prompt } = await bench()
    act(() => { board.actions.openWindow(agentWindow('a1' as WindowId)) })
    await runtime.flush()

    const input = panel.container.querySelector('[data-board-action="omnibar-input"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  hello omnibox  ' } })
    fireEvent.click(panel.container.querySelector('[data-board-action="omnibar-send"]') as Element)
    // The draft leaves the Omnibox at once; delivery reaches the bridge next.
    expect(input.value).toBe('')

    await runtime.flush()
    expect(prompt).toHaveBeenCalledWith(
      [{ type: 'text', text: 'hello omnibox' }], 'queue', undefined, expect.anything(),
    )
  })

  it('opens a new agent window when no chat window is active and sends there', async () => {
    const { runtime, panel, board, prompt } = await bench()

    const input = panel.container.querySelector('[data-board-action="omnibar-input"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'cold start' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    await runtime.flush()

    const state = board.store.getSnapshot()
    expect(state.windowOrder).toHaveLength(1)
    const opened = Object.values(state.windows)
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({ kind: 'agent', bodyKind: 'conversation' })
    expect(prompt).toHaveBeenCalledWith(
      [{ type: 'text', text: 'cold start' }], 'queue', undefined, expect.anything(),
    )
  })

  it('states the host-side web capability is unavailable without acting', async () => {
    const { runtime, panel, board, prompt } = await bench()

    openActionMenu(panel)
    fireEvent.click(screen.getByRole('menuitem', { name: t('menu.webSearch') }))
    await runtime.flush()

    expect(panel.container.querySelector('[data-board-omnibar-notice]')?.textContent)
      .toBe(t('menu.unavailable.webSearch'))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(board.store.getSnapshot().windowOrder).toHaveLength(0)
    expect(prompt).not.toHaveBeenCalled()
  })

  it('states dictation is unsupported instead of closing silently', async () => {
    const { runtime, panel } = await bench()
    // jsdom exposes no SpeechRecognition, so the entry must report that.
    openActionMenu(panel)
    fireEvent.click(screen.getByRole('menuitem', { name: t('menu.dictate') }))
    await runtime.flush()

    expect(panel.container.querySelector('[data-board-omnibar-notice]')?.textContent)
      .toBe(t('voice.unsupported'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens a connectors window from the menu', async () => {
    const { runtime, panel, board } = await bench()

    openActionMenu(panel)
    fireEvent.click(screen.getByRole('menuitem', { name: t('menu.open.connectors') }))
    await runtime.flush()

    const opened = Object.values(board.store.getSnapshot().windows)
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({ kind: 'connectors', bodyKind: 'connectors' })
  })

  it('queues the composer file-picker intent for the active chat window and lets its composer consume it', async () => {
    const { runtime, panel, board } = await bench()
    // The window's session creation is still in flight, so the queued command
    // waits instead of racing the composer's mount.
    act(() => { board.actions.openWindow(agentWindow('a1' as WindowId)) })

    openActionMenu(panel)
    fireEvent.click(screen.getByRole('menuitem', { name: t('menu.attachFile') }))

    expect(board.store.getSnapshot().composerIntents).toContainEqual(
      expect.objectContaining({ windowId: 'a1', pickFiles: true }),
    )
    await runtime.flush()
    expect(board.store.getSnapshot().composerIntents).toEqual([])
  })

  it('lists recent chats with their directory and reopens one under the duplicate rule', async () => {
    const { runtime, panel, board } = await chatBench()

    openActionMenu(panel)
    expect(screen.getByText(t('menu.recentChats'))).not.toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Warehouse report · warehouse' }))
    await runtime.flush()

    const state = board.store.getSnapshot()
    expect(state.windowOrder).toHaveLength(1)
    expect(Object.values(state.windows)[0]).toMatchObject({ kind: 'agent', bodyKind: 'conversation' })
    expect(runtime.sessions.calls.filter(call => call.method === 'open').map(call => call.args[0]))
      .toEqual(['session-1'])

    // The same chat selected again comes forward instead of opening twice.
    const opened = state.windowOrder[0]
    act(() => { board.actions.setPan(100, 100) })
    openActionMenu(panel)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Warehouse report · warehouse' }))
    await runtime.flush()

    expect(board.store.getSnapshot().windowOrder).toEqual([opened])
    expect(board.store.getSnapshot().panX).not.toBe(100)
    expect(runtime.sessions.calls.filter(call => call.method === 'open')).toHaveLength(1)
  })

  it('renders the open menu through the portal, outside the board panel', async () => {
    const { panel } = await bench()

    openActionMenu(panel)

    expect(panel.container.querySelector('[role="menu"]')).toBeNull()
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
  })
})

describe('board omnibox preset pick at creation', () => {
  it('offers the roster, remembers the pick, and opens the window with it', async () => {
    const prompt = vi.fn(() => Promise.resolve({ ok: true as const, value: { accepted: true } }))
    const prepared = await createBoardBench({
      session: { prompt },
      agentPresets: {
        list: async () => ({
          ok: true as const,
          value: {
            presets: [
              { id: 'standard', trust: 'user', isDefault: true, name: 'Standard' },
              { id: 'ptc', trust: 'user', isDefault: false, name: 'PTC mode' },
            ],
            authorable: true,
            modeSelectionEnabled: true,
          },
        }),
      },
    })
    runtimes.add(prepared.runtime)
    await prepared.mountBoard()
    const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = prepared.runtime.storeOf('board.dock') as BoardInstance

    openActionMenu(panel)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Preset' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'PTC mode' }))

    // The pick becomes the remembered default and the window follows.
    expect(board.store.getSnapshot().defaultPreset).toBe('ptc')
    expect(board.store.getSnapshot().windowOrder).toHaveLength(1)
  })

  it('keeps the plain agent entry when the deployment disables preset selection', async () => {
    const prompt = vi.fn(() => Promise.resolve({ ok: true as const, value: { accepted: true } }))
    const prepared = await createBoardBench({
      session: { prompt },
      agentPresets: {
        list: async () => ({
          ok: true as const,
          value: {
            presets: [{ id: 'standard', trust: 'user', isDefault: true, name: 'Standard' }],
            authorable: true,
            modeSelectionEnabled: false,
          },
        }),
      },
    })
    runtimes.add(prepared.runtime)
    await prepared.mountBoard()
    const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })

    openActionMenu(panel)
    expect(screen.queryByRole('menuitem', { name: 'Preset' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: t('menu.open.agent') })).not.toBeNull()
  })
})
