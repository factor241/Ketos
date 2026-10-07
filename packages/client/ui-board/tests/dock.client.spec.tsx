// @vitest-environment jsdom
/**
 * Left floating dock: one honest row per open window (resolved title, kind,
 * session-channel status), the center/focus click rules, the row context menu
 * that renames or closes, the add control, and the layer rules that stand the
 * dock down under a chats panel or a fullscreen window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { createBoardStore } from '../src/client/store.ts'
import { placeInSafeArea, safeArea } from '../src/client/board-coordinates.ts'
import type { BoardWindowState, WindowId } from '../src/client/contract/slots.ts'
import { createBoardBench, t } from './fixtures.client.ts'

const todoApi = vi.hoisted(() => ({
  createTodoList: vi.fn(),
  addTodoItem: vi.fn(),
  setTodoItemDone: vi.fn(),
  refreshTodoList: vi.fn(),
  placeTodoList: vi.fn(),
}))
vi.mock('../src/client/todo-api.ts', () => todoApi)

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

beforeEach(() => {
  for (const mock of Object.values(todoApi)) mock.mockReset()
  todoApi.placeTodoList.mockResolvedValue({ ok: false, code: 'ketos/unreachable' })
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
  return { runtime: prepared.runtime, panel, store, boardDoc: prepared.boardDoc }
}

/** Open the dock's `+` catalog through its trigger. */
function openDockMenu(panel: { container: HTMLElement }): void {
  fireEvent.click(panel.container.querySelector('[data-board-action="dock-add"]') as Element)
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

  it('opens an agent window from the + menu', async () => {
    const { runtime, panel, store } = await bench()
    openDockMenu(panel)
    fireEvent.click(screen.getByRole('menuitem', { name: t('menu.open.agent') }))
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

  it('opens a settings window from the + menu', async () => {
    const { runtime, panel, store } = await bench()
    openDockMenu(panel)
    fireEvent.click(screen.getByRole('menuitem', { name: t('menu.open.settings') }))
    await runtime.flush()

    const order = store.store.getSnapshot().windowOrder
    expect(order).toHaveLength(1)
    expect(store.store.getSnapshot().windows[order[0] as string])
      .toMatchObject({ kind: 'settings', bodyKind: 'settings' })
  })

  it('opens a connectors window from the + menu', async () => {
    const { runtime, panel, store } = await bench()
    openDockMenu(panel)
    fireEvent.click(screen.getByRole('menuitem', { name: t('menu.open.connectors') }))
    await runtime.flush()

    const order = store.store.getSnapshot().windowOrder
    expect(order).toHaveLength(1)
    expect(store.store.getSnapshot().windows[order[0] as string])
      .toMatchObject({ kind: 'connectors', bodyKind: 'connectors' })
  })

  it('opens a tasks window from the + menu without a notice', async () => {
    const { runtime, panel, store } = await bench()
    openDockMenu(panel)
    fireEvent.click(screen.getByRole('menuitem', { name: t('menu.open.tasks') }))
    await runtime.flush()

    const order = store.store.getSnapshot().windowOrder
    expect(order).toHaveLength(1)
    expect(store.store.getSnapshot().windows[order[0] as string])
      .toMatchObject({ kind: 'tasks', bodyKind: 'tasks' })
    expect(panel.container.querySelector('[data-board-dock-notice]')).toBeNull()
  })

  it('creates a note in the center of the visible safe area at any zoom and pan', async () => {
    for (const zoom of [0.5, 2]) {
      const { runtime, panel, store, boardDoc } = await bench()
      act(() => {
        store.actions.setViewport(1200, 900)
        store.actions.setPan(140, -80)
        store.actions.setZoom(zoom)
      })
      openDockMenu(panel)
      expect(screen.getByText(t('menu.group.boardItems'))).not.toBeNull()
      fireEvent.click(screen.getByRole('menuitem', { name: t('menu.create.note') }))
      await runtime.flush()

      const state = store.store.getSnapshot()
      const notes = Object.values(state.boardElements)
      expect(notes, `zoom ${String(zoom)}`).toHaveLength(1)
      const note = notes[0]!
      expect(note).toMatchObject({ kind: 'note', w: 240, h: 160 })
      const area = safeArea(state).world
      expect(note.x + note.w / 2).toBeCloseTo((area.left + area.right) / 2, 6)
      expect(note.y + note.h / 2).toBeCloseTo((area.top + area.bottom) / 2, 6)
      expect(state.selectedBoardElementId).toBe(note.id)
      expect(state.editingBoardElementId).toBe(note.id)
      const editor = panel.container.querySelector('[data-board-note-editor]')
      expect(editor, `zoom ${String(zoom)}`).not.toBeNull()
      expect(document.activeElement).toBe(editor)
      expect(boardDoc.ops.flat().filter(op => op.op === 'create')).toHaveLength(1)
    }
  })

  it('asks for a title and creates a todo list in the center of the visible safe area', async () => {
    const { runtime, panel, store } = await bench()
    act(() => {
      store.actions.setViewport(1200, 900)
      store.actions.setPan(140, -80)
      store.actions.setZoom(2)
    })
    todoApi.createTodoList.mockResolvedValue({
      ok: true,
      elementId: '00000000-0000-4000-8000-0000000000d1',
      revision: 1,
    })
    openDockMenu(panel)
    fireEvent.click(screen.getByRole('menuitem', { name: t('menu.create.todo') }))
    const input = screen.getByPlaceholderText(t('element.todo.create.placeholder'))
    const confirm = screen.getByRole('button', { name: t('element.todo.create.action') })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    fireEvent.change(input, { target: { value: '  Покупки  ' } })
    expect(confirm.hasAttribute('disabled')).toBe(false)
    fireEvent.click(confirm)
    await runtime.flush()

    const at = placeInSafeArea(store.store.getSnapshot(), 280, 240)
    expect(todoApi.createTodoList).toHaveBeenCalledWith('Покупки', at.x, at.y)
    expect(screen.queryByPlaceholderText(t('element.todo.create.placeholder'))).toBeNull()
  })

  it('closes the title popover on Escape without creating', async () => {
    const { runtime, panel } = await bench()
    openDockMenu(panel)
    fireEvent.click(screen.getByRole('menuitem', { name: t('menu.create.todo') }))
    const input = screen.getByPlaceholderText(t('element.todo.create.placeholder'))
    fireEvent.keyDown(input, { key: 'Escape' })
    await runtime.flush()

    expect(screen.queryByRole('dialog', { name: t('element.todo.create.title') })).toBeNull()
    expect(todoApi.createTodoList).not.toHaveBeenCalled()
  })

  it('notices a failed todo creation with the localized text', async () => {
    const { runtime, panel } = await bench()
    todoApi.createTodoList.mockResolvedValue({ ok: false, code: 'ketos/beads-unavailable' })
    openDockMenu(panel)
    fireEvent.click(screen.getByRole('menuitem', { name: t('menu.create.todo') }))
    fireEvent.change(screen.getByPlaceholderText(t('element.todo.create.placeholder')), { target: { value: 'Покупки' } })
    fireEvent.click(screen.getByRole('button', { name: t('element.todo.create.action') }))
    await runtime.flush()

    expect(panel.container.querySelector('[data-board-dock-notice]')?.textContent)
      .toBe(t('element.todo.error.unavailable'))
  })

  it('states the dashboard is unavailable without opening a window', async () => {
    const { runtime, panel, store } = await bench()
    openDockMenu(panel)
    fireEvent.click(screen.getByRole('menuitem', { name: t('menu.open.dashboard') }))
    await runtime.flush()

    expect(store.store.getSnapshot().windowOrder).toHaveLength(0)
    expect(panel.container.querySelector('[data-board-dock-notice]')?.textContent)
      .toBe(t('menu.unavailable.dashboard'))
  })

  it('lists recent chats with their directory and reopens one under the duplicate rule', async () => {
    const { runtime, panel, store } = await bench({
      sessionSummary: { displayTitle: 'Warehouse report', cwd: '/work/warehouse' },
    })

    openDockMenu(panel)
    expect(screen.getByText(t('menu.recentChats'))).not.toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Warehouse report · warehouse' }))
    await runtime.flush()

    const state = store.store.getSnapshot()
    expect(state.windowOrder).toHaveLength(1)
    expect(Object.values(state.windows)[0]).toMatchObject({ kind: 'agent', bodyKind: 'conversation' })
    expect(runtime.sessions.calls.filter(call => call.method === 'retain').map(call => call.args[0]))
      .toEqual(['session-1'])

    // The same chat selected again comes forward instead of opening twice.
    const opened = state.windowOrder[0]
    act(() => { store.actions.setPan(100, 100) })
    openDockMenu(panel)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Warehouse report · warehouse' }))
    await runtime.flush()

    expect(store.store.getSnapshot().windowOrder).toEqual([opened])
    expect(store.store.getSnapshot().panX).not.toBe(100)
    expect(runtime.sessions.calls.filter(call => call.method === 'retain')).toHaveLength(1)
  })

  it('renders the open menu through the portal into the board popover layer', async () => {
    const { panel } = await bench()

    openDockMenu(panel)

    expect(panel.container.querySelector('[data-board-layer="dock"] [role="menu"]')).toBeNull()
    expect(panel.container.querySelector('[data-board-layer="popover"] [role="menu"]')).not.toBeNull()
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
  })

  it('offers the preset roster, remembers the pick, and opens the window with it', async () => {
    const { panel, store } = await bench({
      agentPresets: {
        list: async () => ({
          ok: true as const,
          value: {
            presets: [
              { id: 'standard', trust: 'user', isDefault: true, name: 'Standard' },
              { id: 'ptc', trust: 'user', isDefault: false, name: 'PTC mode' },
            ],
            authorable: true,
          },
        }),
      },
    })

    openDockMenu(panel)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Preset' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'PTC mode' }))

    // The pick becomes the remembered default and the window follows.
    expect(store.store.getSnapshot().defaultPreset).toBe('ptc')
    expect(store.store.getSnapshot().windowOrder).toHaveLength(1)
  })

  it('keeps the plain agent entry when the deployment disables preset selection', async () => {
    const { panel } = await bench({
      developerTools: false,
      agentPresets: {
        list: async () => ({
          ok: true as const,
          value: {
            presets: [{ id: 'standard', trust: 'user', isDefault: true, name: 'Standard' }],
            authorable: true,
          },
        }),
      },
    })

    openDockMenu(panel)
    expect(screen.queryByRole('menuitem', { name: 'Preset' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: t('menu.open.agent') })).not.toBeNull()
  })

  it('arms the element picker from its own dock button, and the pick addresses the active chat window (Т1.10)', async () => {
    const { runtime, panel, store } = await bench()
    act(() => { store.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' })) })
    await runtime.flush()

    fireEvent.click(panel.container.querySelector('[data-board-action="dock-select-element"]') as Element)
    await runtime.flush()
    expect(store.store.getSnapshot().isSelectingElement).toBe(true)
    expect(panel.container.querySelector('[class*="overlay"]')).not.toBeNull()

    // The pick lands as one chip in the active chat window's draft
    // (resolveChatWindow) and ends the mode.
    fireEvent.click(panel.container.querySelector('[data-surface="board"]') as Element)
    await runtime.flush()
    expect(store.store.getSnapshot().isSelectingElement).toBe(false)
    expect(store.store.getSnapshot().drafts['a1']?.text).toContain('[data-surface="board"]')
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
    // The topmost window is the last frame in paint order.
    fireEvent.click([...panel.container.querySelectorAll('[data-board-action="window-left-panel"]')].at(-1) as Element)
    await runtime.flush()
    const openPanel = panel.container.querySelector('[data-board-panel]:not([aria-hidden="true"])')
    if (!(openPanel instanceof HTMLElement)) throw new Error('the chats panel did not open')
    // The window session's ungrouped bucket opened with the panel.
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

  it('reorders dock icons inside their own group and suppresses the click (Т1.5)', async () => {
    const { runtime, panel, store } = await bench()
    act(() => {
      store.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'First' }))
      store.actions.openWindow(windowState({ id: 'a2' as WindowId, customTitle: 'Second', ordinal: 2 }))
      store.actions.openWindow(windowState({ id: 'a3' as WindowId, customTitle: 'Third', ordinal: 3 }))
    })
    await runtime.flush()
    const rows = dockRows(panel)
    const [first, , third] = rows
    if (first === undefined || third === undefined) throw new Error('dock rows are missing')
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true, writable: true })
    // jsdom lays nothing out: the target row's rect and the hit test are the
    // gesture's own coordinates.
    first.getBoundingClientRect = () => ({
      left: 100, right: 140, top: 0, bottom: 40, width: 40, height: 40, x: 100, y: 0, toJSON: () => ({}),
    })
    Object.defineProperty(document, 'elementFromPoint', { value: () => first, configurable: true })
    const step = (type: 'pointermove' | 'pointerup', x: number): void => {
      act(() => {
        const event = new Event(type)
        Object.assign(event, { clientX: x, clientY: 10, pointerId: 41 })
        window.dispatchEvent(event)
      })
    }
    try {
      // Drag the third icon before the first: the indicator appears on the
      // target's leading side and the release commits the new order.
      fireEvent.pointerDown(third, { pointerId: 41, clientX: 300, clientY: 10, button: 0 })
      step('pointermove', 110)
      expect(first.getAttribute('data-dock-drop')).toBe('before')
      step('pointerup', 110)
      expect(store.store.getSnapshot().dockOrder).toEqual(['a3', 'a1', 'a2'])
      expect(panel.container.querySelector('[data-dock-drop]')).toBeNull()

      // The click the finished drag leaves behind is consumed: the inactive
      // first window is not centered; the next click still is.
      expect(store.store.getSnapshot().activeWindowId).toBe('a3')
      fireEvent.click(first)
      expect(store.store.getSnapshot().activeWindowId).toBe('a3')
      fireEvent.click(first)
      expect(store.store.getSnapshot().activeWindowId).toBe('a1')
    } finally {
      Reflect.deleteProperty(document, 'elementFromPoint')
      Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
    }
  })

  it('orders the clone strip by the stored order and refuses cross-group drops (Т1.5)', async () => {
    const cloneDto = (id: string, name: string) => ({
      id, name, role: 'Analyst', description: '', persona: '', methodology: '',
      preferredModel: null, skills: [], status: 'ready', revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ ok: true, clones: [cloneDto('c1', 'Anna'), cloneDto('c2', 'Boris')] }),
      { status: 200 },
    )))
    try {
      const { runtime, panel, store } = await bench()
      act(() => { store.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
      await runtime.flush()
      await runtime.flush()
      const clones = [...panel.container.querySelectorAll('[data-board-clone-row]')] as HTMLElement[]
      expect(clones.map(button => button.getAttribute('data-board-clone-row'))).toEqual(['c1', 'c2'])
      const [firstClone, secondClone] = clones
      if (firstClone === undefined || secondClone === undefined) throw new Error('clone strip is missing')
      Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true, writable: true })
      firstClone.getBoundingClientRect = () => ({
        left: 100, right: 140, top: 0, bottom: 40, width: 40, height: 40, x: 100, y: 0, toJSON: () => ({}),
      })
      Object.defineProperty(document, 'elementFromPoint', { value: () => firstClone, configurable: true })
      const step = (type: 'pointermove' | 'pointerup', x: number, pointerId: number): void => {
        act(() => {
          const event = new Event(type)
          Object.assign(event, { clientX: x, clientY: 10, pointerId })
          window.dispatchEvent(event)
        })
      }

      // Clones reorder inside their own group and persist through the store.
      fireEvent.pointerDown(secondClone, { pointerId: 42, clientX: 300, clientY: 10, button: 0 })
      step('pointermove', 110, 42)
      expect(firstClone.getAttribute('data-dock-drop')).toBe('before')
      step('pointerup', 110, 42)
      expect(store.store.getSnapshot().cloneOrder).toEqual(['c2', 'c1'])

      // A window icon over a clone icon never crosses groups.
      const row = dockRows(panel)[0]
      if (row === undefined) throw new Error('dock row is missing')
      fireEvent.pointerDown(row, { pointerId: 43, clientX: 300, clientY: 10, button: 0 })
      step('pointermove', 110, 43)
      expect(panel.container.querySelector('[data-dock-drop]')).toBeNull()
      step('pointerup', 110, 43)
      expect(store.store.getSnapshot().dockOrder).toEqual(['a1'])
    } finally {
      vi.unstubAllGlobals()
      Reflect.deleteProperty(document, 'elementFromPoint')
      Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
    }
  })

  it('stays visible under the chats panel while the other chrome stands down (Т1.14)', async () => {
    const { runtime, panel, store } = await bench()
    act(() => {
      store.actions.setViewport(1200, 900)
      store.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' }))
    })
    await runtime.flush()
    const dock = () => panel.container.querySelector('[data-board-layer="dock"]')
    expect(panel.container.querySelectorAll('[data-board-layer="dock"], [data-board-layer="minimap"]'))
      .toHaveLength(2)
    const before = dock()?.getBoundingClientRect()

    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()
    // The dock keeps its place; the minimap stands down.
    expect(dock()).not.toBeNull()
    expect(dock()?.getBoundingClientRect()).toEqual(before)
    expect(panel.container.querySelectorAll('[data-board-layer="minimap"]')).toHaveLength(0)

    fireEvent.click(panel.container.querySelector('[data-board-action="panel-collapse"]') as Element)
    await runtime.flush()
    expect(panel.container.querySelectorAll('[data-board-layer="dock"], [data-board-layer="minimap"]'))
      .toHaveLength(2)
  })
})
