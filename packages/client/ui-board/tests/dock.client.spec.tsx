// @vitest-environment jsdom
/**
 * Left floating dock: one honest row per open window (resolved title, kind,
 * session-channel status), the center/focus click rules, the row context menu
 * that renames or closes, the add control, and the layer rules that stand the
 * dock down under a chats panel or a fullscreen window.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { createBoardStore } from '../src/client/store.ts'
import type { BoardWindowState, WindowId } from '../src/client/contract/slots.ts'
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

/** Bench with the fixture session the window bridge creates for an agent window. */
async function bench(options: Parameters<typeof createBoardBench>[0] = {}) {
  const prepared = await createBoardBench({
    session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) },
    ...options,
  })
  runtimes.add(prepared.runtime)
  await prepared.mountBoard()
  const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
  const store = prepared.runtime.storeOf('board.dock') as BoardInstance
  return { runtime: prepared.runtime, panel, store }
}

/** One window literal the dock tests open. */
function windowState(overrides: Partial<Parameters<BoardInstance['actions']['openWindow']>[0]> & { id: WindowId }) {
  return {
    kind: 'agent' as const,
    bodyKind: 'conversation' as const,
    ordinal: 1,
    width: 552,
    height: 648,
    ...overrides,
  }
}

/** The dock's rows in DOM order. */
function dockRows(panel: { container: HTMLElement }): HTMLElement[] {
  return [...panel.container.querySelectorAll('[data-board-action="dock-row"]')] as HTMLElement[]
}

/** The dock row of one resolved window title. */
function rowOf(panel: { container: HTMLElement }, title: string): HTMLElement {
  const row = dockRows(panel).find(candidate => candidate.getAttribute('data-board-title') === title)
  if (row === undefined) throw new Error(`missing dock row for "${title}"`)
  return row
}

describe('board dock', () => {
  it('lists the open windows in board order with kind, title, and session status', async () => {
    const { runtime, panel, store } = await bench()

    act(() => {
      store.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'First agent' }))
      store.actions.openWindow(windowState({
        id: 'c1' as WindowId,
        kind: 'connectors',
        bodyKind: 'connectors',
        ordinal: 2,
        customTitle: 'Tools',
        width: 648,
        height: 768,
      }))
    })
    await runtime.flush()

    expect(store.store.getSnapshot().windowOrder).toEqual(['a1', 'c1'])
    const rows = dockRows(panel)
    expect(rows.map(row => row.getAttribute('data-board-kind'))).toEqual(['agent', 'connectors'])
    expect(rows.map(row => row.getAttribute('data-board-title'))).toEqual(['First agent', 'Tools'])
    // The agent's session bound; the tool window has none and reads idle.
    expect(rows.map(row => row.getAttribute('data-board-status'))).toEqual(['ready', 'idle'])
    // The accessible name pairs the resolved title with the localized status.
    expect(rows.map(row => row.getAttribute('aria-label'))).toEqual(['First agent · Idle', 'Tools · Creating'])
  })

  it('follows its window channel through a running turn and a turn failure', async () => {
    const { runtime, panel, store } = await bench()
    act(() => { store.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' })) })
    await runtime.flush()
    expect(rowOf(panel, 'Agent').getAttribute('data-board-status')).toBe('ready')

    const sessionId = runtime.sessions.list.getSnapshot().ids[0]
    if (sessionId === undefined) throw new Error('missing session id')
    await runtime.sessions.updateSessionSnapshot(sessionId, (draft) => { draft.running = true })
    await runtime.flush()
    expect(rowOf(panel, 'Agent').getAttribute('data-board-status')).toBe('running')
    expect(rowOf(panel, 'Agent').querySelector('[data-state="ongoing"]')).not.toBeNull()
    expect(rowOf(panel, 'Agent').getAttribute('aria-label')).toBe('Agent · Running')

    await runtime.sessions.updateSessionSnapshot(sessionId, (draft) => {
      draft.running = false
      draft.lastAgentError = 'model exploded'
    })
    await runtime.flush()
    expect(rowOf(panel, 'Agent').getAttribute('data-board-status')).toBe('error')
    expect(rowOf(panel, 'Agent').querySelector('[data-state="error"]')).not.toBeNull()
  })

  it('centers an inactive window and only focuses the active one', async () => {
    const { runtime, panel, store } = await bench()
    act(() => {
      store.actions.setViewport(1200, 900)
      store.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'First' }))
      store.actions.openWindow(windowState({
        id: 'c1' as WindowId,
        kind: 'connectors',
        bodyKind: 'connectors',
        ordinal: 2,
        customTitle: 'Tools',
        width: 648,
        height: 768,
      }))
      store.actions.setPan(-500, -300)
    })
    await runtime.flush()
    expect(store.store.getSnapshot().activeWindowId).toBe('c1')

    // The inactive row centers its window: the world centre lands on the
    // viewport centre under the recomputed pan, and the row becomes active.
    fireEvent.click(rowOf(panel, 'First'))
    await runtime.flush()
    const centered = store.store.getSnapshot()
    const first = centered.windows['a1'] as BoardWindowState
    expect(centered.activeWindowId).toBe('a1')
    expect((first.x + first.width / 2) * centered.zoom + centered.panX).toBeCloseTo(centered.viewportWidth / 2)
    expect((first.y + first.height / 2) * centered.zoom + centered.panY).toBeCloseTo(centered.viewportHeight / 2)
    expect(centered.panX).not.toBe(-500)

    // The same row now only focuses: the view stays where the first click left it.
    fireEvent.click(rowOf(panel, 'First'))
    await runtime.flush()
    const focused = store.store.getSnapshot()
    expect(focused.activeWindowId).toBe('a1')
    expect(focused.panX).toBe(centered.panX)
    expect(focused.panY).toBe(centered.panY)
  })

  it('brings the active window back when the view has moved off it', async () => {
    const { runtime, panel, store } = await bench()
    act(() => {
      store.actions.setViewport(1200, 900)
      store.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'First' }))
      store.actions.setPan(-4000, -3000)
    })
    await runtime.flush()
    expect(store.store.getSnapshot().activeWindowId).toBe('a1')
    const away = store.store.getSnapshot()
    expect(away.panX).toBe(-4000)

    // The active window is out of sight, so its own row is not a dead gesture:
    // it centres the view on the window again.
    fireEvent.click(rowOf(panel, 'First'))
    await runtime.flush()
    const revealed = store.store.getSnapshot()
    const win = revealed.windows['a1'] as BoardWindowState
    expect(revealed.activeWindowId).toBe('a1')
    expect(revealed.panX).not.toBe(-4000)
    expect((win.x + win.width / 2) * revealed.zoom + revealed.panX).toBeCloseTo(revealed.viewportWidth / 2)
    expect((win.y + win.height / 2) * revealed.zoom + revealed.panY).toBeCloseTo(revealed.viewportHeight / 2)
  })

  it('opens the in-place rename editor from the row menu', async () => {
    const { runtime, panel, store } = await bench()
    act(() => { store.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' })) })
    await runtime.flush()

    fireEvent.contextMenu(rowOf(panel, 'Agent'))
    await runtime.flush()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename window' }))
    const input = panel.container.querySelector('[data-board-action="dock-title-input"]') as HTMLInputElement
    expect(input).not.toBeNull()
    fireEvent.change(input, { target: { value: 'Док-имя' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await runtime.flush()
    expect(rowOf(panel, 'Док-имя')).not.toBeNull()
  })

  it('closes a window from its row menu while its session stays alive', async () => {
    const { runtime, panel, store } = await bench()
    act(() => { store.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' })) })
    await runtime.flush()
    const sessionId = runtime.sessions.list.getSnapshot().ids[0]
    if (sessionId === undefined) throw new Error('missing session id')

    // The menu dismisses on an outside click without touching the window.
    fireEvent.contextMenu(rowOf(panel, 'Agent'))
    await runtime.flush()
    expect(screen.getByRole('menu')).not.toBeNull()
    fireEvent.pointerDown(document.body)
    await runtime.flush()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(store.store.getSnapshot().windowOrder).toEqual(['a1'])

    fireEvent.contextMenu(rowOf(panel, 'Agent'))
    await runtime.flush()
    fireEvent.click(screen.getByRole('menuitem', { name: /Close window/ }))
    await runtime.flush()

    expect(screen.queryByRole('menu')).toBeNull()
    expect(store.store.getSnapshot().windowOrder).toEqual([])
    expect(dockRows(panel)).toHaveLength(0)
    // Closing drops the window, not its chat: the session stays alive and listed.
    expect(runtime.sessions.list.getSnapshot().ids).toContain(sessionId)
  })

  it('creates an agent window from the add control', async () => {
    const { runtime, panel, store } = await bench()
    fireEvent.click(panel.container.querySelector('[data-board-action="dock-add-agent"]') as Element)
    await runtime.flush()

    const order = store.store.getSnapshot().windowOrder
    expect(order).toHaveLength(1)
    const created = store.store.getSnapshot().windows[order[0] as string] as BoardWindowState
    expect(created.kind).toBe('agent')
    expect(created.ordinal).toBe(1)
    expect(created.width).toBe(552)
    expect(created.height).toBe(648)
    expect(dockRows(panel)).toHaveLength(1)
    expect(dockRows(panel)[0]?.getAttribute('data-board-kind')).toBe('agent')
  })

  it('opens the other window kinds from the add control catalog', async () => {
    const { runtime, panel, store } = await bench()
    fireEvent.contextMenu(panel.container.querySelector('[data-board-action="dock-add-agent"]') as Element)
    await runtime.flush()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Connectors window' }))
    await runtime.flush()

    const order = store.store.getSnapshot().windowOrder
    expect(order).toHaveLength(1)
    const created = store.store.getSnapshot().windows[order[0] as string] as BoardWindowState
    expect(created).toMatchObject({ kind: 'connectors', bodyKind: 'connectors' })
    // The catalog adds one window; the left click still adds an agent directly.
    fireEvent.click(panel.container.querySelector('[data-board-action="dock-add-agent"]') as Element)
    await runtime.flush()
    expect(store.store.getSnapshot().windowOrder).toHaveLength(2)
    expect(Object.values(store.store.getSnapshot().windows).map(win => win.kind)).toEqual([
      'connectors', 'agent',
    ])
  })

  it('tints chat chips by folder and glyphs utility windows (Т1.7)', async () => {
    const { runtime, panel, store } = await bench({
      sessionSummary: { displayTitle: 'Chat one', cwd: '/projects/one' },
      extraSessions: [{
        id: 'session-2',
        displayTitle: 'Chat two',
        summary: { cwd: '/projects/one' },
      }],
    })
    act(() => {
      store.actions.openWindow(windowState({ id: 'a1' as WindowId }))
      store.actions.openWindow(windowState({ id: 's1' as WindowId, kind: 'settings', bodyKind: 'settings', ordinal: 2 }))
    })
    await runtime.flush()

    // The chat chip wears the title letters and a folder tint; the utility
    // window wears its kind glyph.
    const first = rowOf(panel, 'Chat one').querySelector('[data-board-icon="letters"]')
    expect(first?.textContent).toBe('Co')
    expect(first?.getAttribute('data-board-palette')).not.toBe('none')
    expect(rowOf(panel, 'Settings').querySelector('[data-board-icon="settings"]')).not.toBeNull()

    // A second chat in the same folder, bound through its chats panel: the
    // same folder paints the same palette slot.
    const dock = runtime.storeOf('board.dock') as BoardInstance
    act(() => { dock.actions.openWindow(windowState({ id: 'a2' as WindowId, ordinal: 3 })) })
    await runtime.flush()
    fireEvent.click(panel.view.getAllByLabelText('Expand the chats panel').at(-1) as Element)
    await runtime.flush()
    const openPanel = panel.container.querySelector('[data-board-panel]:not([aria-hidden="true"])')
    if (!(openPanel instanceof HTMLElement)) throw new Error('the chats panel did not open')
    fireEvent.click(within(openPanel).getByText('Ungrouped'))
    await runtime.flush()
    fireEvent.click(within(openPanel).getByText('Chat two'))
    await runtime.flush()
    await runtime.flush()
    const second = rowOf(panel, 'Chat two').querySelector('[data-board-icon="letters"]')
    expect(second?.textContent).toBe('Ct')
    expect(second?.getAttribute('data-board-palette')).toBe(first?.getAttribute('data-board-palette'))
  })

  it('scrolls sideways under a wheel once the strip outgrows the board (Т1.6)', async () => {
    const { runtime, panel, store } = await bench()
    act(() => { store.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' })) })
    await runtime.flush()
    const dock = panel.container.querySelector('[data-board-layer="dock"]') as HTMLElement
    // jsdom has no layout: the strip reports its real box through the stubs.
    Object.defineProperty(dock, 'scrollWidth', { value: 500, configurable: true })
    Object.defineProperty(dock, 'clientWidth', { value: 200, configurable: true })

    // A vertical wheel scrolls the horizontal strip and is prevented, so the
    // board never pans under it.
    expect(fireEvent.wheel(dock, { deltaY: 120 })).toBe(false)
    expect(dock.scrollLeft).toBe(120)
    // A horizontal wheel scrolls it too.
    expect(fireEvent.wheel(dock, { deltaX: 40 })).toBe(false)
    expect(dock.scrollLeft).toBe(160)
    // A strip that fits the board keeps the wheel for the board.
    Object.defineProperty(dock, 'scrollWidth', { value: 200, configurable: true })
    expect(fireEvent.wheel(dock, { deltaY: 120 })).toBe(true)
    expect(dock.scrollLeft).toBe(160)
  })

  it('stays visible under the chats panel while the other chrome stands down (Т1.14)', async () => {
    const { runtime, panel, store } = await bench()
    act(() => {
      store.actions.setViewport(1200, 900)
      store.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' }))
    })
    await runtime.flush()
    const dock = () => panel.container.querySelector('[data-board-layer="dock"]')
    expect(panel.container.querySelectorAll('[data-board-layer="dock"], [data-board-layer="omnibar"], [data-board-layer="minimap"]'))
      .toHaveLength(3)
    const before = dock()?.getBoundingClientRect()

    fireEvent.click(panel.container.querySelector('button[aria-label="Expand the chats panel"]') as Element)
    await runtime.flush()
    // The dock keeps its place; the omnibar and minimap stand down.
    expect(dock()).not.toBeNull()
    expect(dock()?.getBoundingClientRect()).toEqual(before)
    expect(panel.container.querySelectorAll('[data-board-layer="omnibar"], [data-board-layer="minimap"]')).toHaveLength(0)

    fireEvent.click(panel.container.querySelector('button[aria-label="Collapse the chats panel"]') as Element)
    await runtime.flush()
    expect(panel.container.querySelectorAll('[data-board-layer="dock"], [data-board-layer="omnibar"], [data-board-layer="minimap"]'))
      .toHaveLength(3)
  })
})
