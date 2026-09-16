// @vitest-environment jsdom
/**
 * Board slot composition: the layer cascade and its render sites, keyed window
 * dispatch per type, the keyed window-body seat, open-close cycles, and
 * disposal with the plugin fiber.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { createBoardStore } from '../src/client/store.ts'
import { panelWidthFor } from '../src/client/window/panel-geometry.ts'
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

/** Bench with the services the board injects and the slots it occupies declared. */
async function bench() {
  const prepared = await createBoardBench({ session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) } })
  runtimes.add(prepared.runtime)
  const board = await prepared.mountBoard()
  return { runtime: prepared.runtime, board, chat: prepared.chat, mountBoard: prepared.mountBoard }
}

/** The window state literal the composition tests vary. */
function windowState(overrides: Partial<Parameters<BoardInstance['actions']['openWindow']>[0]> & { id: WindowId }) {
  return {
    kind: 'agent' as const,
    bodyKind: 'conversation' as const,
    title: 'Agent',
    width: 552,
    height: 648,
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
      'board.window.panel': { kind: 'keyed', scope: 'root' },
    })
    expect(runtime.slots.spec('board.window')).toEqual({ kind: 'keyed', scope: 'root' })
    expect(runtime.slots.spec('board.window.body')).toEqual({ kind: 'keyed', scope: 'root' })

    // One frame registration per window type, one body registration for the
    // conversation body (no board window ships mock tool or settings content).
    expect(runtime.slots.entries('board.window').map(entry => entry.options.key)).toEqual([
      'agent', 'clone', 'connectors', 'settings', 'dashboard', 'tasks',
    ])
    expect(runtime.slots.entries('board.window.body').map(entry => entry.options.key)).toEqual([
      'conversation',
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
    const transformed = panel.container.querySelector('[data-surface="canvas-layer"]')
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

    // Each frame renders its own component: only the agent frame carries the
    // session composer, so a frame dispatched to the wrong occupant fails these assertions.
    const agentFrame = panel.container.querySelector('[data-board-window="agent"]')
    const toolFrame = panel.container.querySelector('[data-board-window="connectors"]')
    expect(agentFrame?.querySelector('textarea')).not.toBeNull()
    expect(agentFrame?.querySelector('button[aria-label="Send"]')).not.toBeNull()
    expect(toolFrame?.querySelector('textarea')).toBeNull()
    expect(toolFrame?.querySelector('button[aria-label="Send"]')).toBeNull()
    expect(toolFrame?.textContent).toContain('Tools')
    expect(agentFrame?.textContent).toContain('First agent')
    // Tool windows keep the shared frame without the chat-only controls, so the
    // panel and fullscreen modes never apply to them.
    expect(toolFrame?.querySelector('button[aria-label="Chats"]')).toBeNull()
    expect(toolFrame?.querySelector('button[aria-label="Open fullscreen"]')).toBeNull()
    expect(agentFrame?.querySelector('button[aria-label="Chats"]')).not.toBeNull()
    expect(agentFrame?.querySelector('button[aria-label="Open fullscreen"]')).not.toBeNull()
  })

  it('swaps the body occupant when bodyKind changes', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.openWindow(windowState({ id: 'a1' as WindowId }))
    })
    await runtime.flush()
    expect(panel.container.querySelector('textarea')).not.toBeNull()
    expect(panel.view.getByText('Write a message to start.')).not.toBeNull()

    // An unoccupied body kind renders the frame with an empty content region.
    act(() => { board.actions.setWindowBodyKind('a1' as WindowId, 'connectors') })
    await runtime.flush()
    expect(panel.container.querySelector('textarea')).toBeNull()
    expect(panel.container.querySelector('[data-board-window="agent"]')).not.toBeNull()

    act(() => { board.actions.setWindowBodyKind('a1' as WindowId, 'conversation') })
    await runtime.flush()
    expect(panel.container.querySelector('textarea')).not.toBeNull()
  })

  it('renders the conversation body for an agent window and nothing for an unoccupied body kind', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.openWindow(windowState({ id: 'a1' as WindowId }))
      board.actions.openWindow(windowState({
        id: 'c1' as WindowId,
        kind: 'clone',
        bodyKind: 'clone-memory',
        title: 'Clone memory',
      }))
    })
    await runtime.flush()

    expect(panel.container.querySelector('textarea')).not.toBeNull()

    // A body kind without an occupant renders the frame with an empty body region.
    const cloneFrame = panel.container.querySelector('[data-board-window="clone"]')
    expect(cloneFrame).not.toBeNull()
    expect(cloneFrame?.textContent).toContain('Clone memory')
    expect(cloneFrame?.querySelector('textarea')).toBeNull()
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
    fireEvent.click(firstFrame.querySelector('button[aria-label="Close"]') as Element)
    await runtime.flush()

    expect(panel.container.querySelectorAll('[data-board-window="agent"]')).toHaveLength(1)
    expect(board.store.getSnapshot().windowOrder).toHaveLength(1)
    expect(panel.view.queryByText('First agent')).toBeNull()
    expect(panel.view.getByText('Second agent')).not.toBeNull()
  })

  it('fills the board panel with the fullscreen window and hides its neighbours and chrome', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.setPan(40, 40)
      board.actions.setZoom(1.5)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, title: 'First agent' }))
      board.actions.openWindow(windowState({ id: 'a2' as WindowId, title: 'Second agent' }))
    })
    await runtime.flush()
    expect(panel.container.querySelectorAll('[data-board-window="agent"]')).toHaveLength(2)

    const frame = panel.container.querySelectorAll('[data-board-window="agent"]')[0] as HTMLElement
    fireEvent.click(frame.querySelector('button[aria-label="Open fullscreen"]') as Element)
    await runtime.flush()

    const surface = panel.container.querySelectorAll('[data-surface="canvas"]')[0] as HTMLElement
    const fullscreen = panel.container.querySelector('[data-board-fullscreen]') as HTMLElement
    expect(fullscreen).not.toBeNull()
    // No panel open: the frame keeps the whole board panel.
    expect(fullscreen.style.inset).toBe('0 0 0 0px')
    // The other frame stays mounted and hidden — its draft survives the mode —
    // and the floating chrome leaves with the fullscreen frame.
    expect(panel.container.querySelectorAll('[data-board-window="agent"]')).toHaveLength(2)
    expect(panel.container.querySelectorAll('[data-board-window][data-board-culled]')).toHaveLength(1)
    for (const layer of ['dock', 'omnibar', 'minimap'] as const) {
      expect(panel.container.querySelectorAll(`[data-board-layer="${layer}"]`)).toHaveLength(0)
    }
    // The surface drops its pan and zoom so the inset rectangle maps to the panel.
    expect(surface.style.getPropertyValue('--board-pan-x')).toBe('0px')
    expect(surface.style.getPropertyValue('--board-zoom')).toBe('1')

    // Escape leaves the mode and the window returns to its stored geometry.
    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    const restored = panel.container.querySelector('[data-board-window="agent"]') as HTMLElement
    expect(panel.container.querySelector('[data-board-fullscreen]')).toBeNull()
    expect(restored.style.inset).toBe('')
    expect(restored.style.width).toBe(`${String(board.store.getSnapshot().windows['a1']?.width)}px`)
    expect(panel.container.querySelectorAll('[data-board-window="agent"]')).toHaveLength(2)
    expect(panel.container.querySelectorAll('[data-board-window][data-board-culled]')).toHaveLength(0)
    expect(panel.container.querySelectorAll('[data-board-layer="dock"]')).toHaveLength(1)

    // The header toggle closes the mode too.
    fireEvent.click(panel.container.querySelector('button[aria-label="Open fullscreen"]') as Element)
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-fullscreen]')).not.toBeNull()
    fireEvent.click(panel.container.querySelector('button[aria-label="Exit fullscreen"]') as Element)
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-fullscreen]')).toBeNull()
  })

  it('keeps a rail for every chat window, opens the panel beside the frame, and docks it in fullscreen', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      // Room on both sides of the centred window, so the panel takes its own column.
      board.actions.setViewport(1400, 900)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId }))
    })
    await runtime.flush()

    // The rail keeps the panel one click away while the panel itself is hidden.
    const rail = panel.container.querySelector('[data-board-panel-rail]') as HTMLElement
    expect(rail).not.toBeNull()
    const hidden = panel.container.querySelector('[data-board-panel]') as HTMLElement
    expect(hidden.getAttribute('data-board-panel-open')).toBeNull()

    fireEvent.click(panel.container.querySelector('button[aria-label="Expand the chats panel"]') as Element)
    await runtime.flush()
    const shown = panel.container.querySelector('[data-board-panel]') as HTMLElement
    const window = board.store.getSnapshot().windows['a1'] as BoardWindowState
    const width = panelWidthFor(window.width, board.store.getSnapshot().panelWidth)
    expect(shown.getAttribute('data-board-panel')).toBe('beside')
    expect(shown.getAttribute('data-board-panel-side')).toBe('left')
    expect(shown.getAttribute('data-board-panel-open')).toBe('')
    // The panel stands beside the frame at the stored width and the window height.
    expect(shown.style.left).toBe(`${String(window.x - width)}px`)
    expect(shown.style.top).toBe(`${String(window.y)}px`)
    expect(shown.style.width).toBe(`${String(width)}px`)
    expect(shown.style.height).toBe(`${String(window.height)}px`)
    expect(shown.style.zIndex).toBe('')

    // Dragging the outer edge resizes the panel by the world-unit delta.
    const handle = panel.container.querySelector('[aria-label="Resize the chats panel"]') as HTMLElement
    // jsdom implements no pointer capture at all; the gesture only needs its deltas.
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: () => {},
      configurable: true,
      writable: true,
    })
    act(() => { board.actions.setPanelWidth(320) })
    // The gesture starts from the width the panel actually shows, which the
    // window share may have capped below the stored value.
    const beforeDrag = panelWidthFor(window.width, board.store.getSnapshot().panelWidth)
    fireEvent.pointerDown(handle, { clientX: 200, pointerId: 7 })
    // The panel rides the frame's left edge, so dragging left widens it. The
    // gesture listens on the global; drive it with plain events carrying the
    // pointer coordinates (jsdom ships no PointerEvent constructor).
    for (const [type, clientX] of [['pointermove', 160], ['pointerup', 160]] as const) {
      const event = new Event(type)
      Object.assign(event, { clientX, pointerId: 7 })
      globalThis.dispatchEvent(event)
    }
    expect(board.store.getSnapshot().panelWidth).toBe(beforeDrag + 40)
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')

    // The collapse control lives in the panel's own header.
    fireEvent.click(panel.container.querySelector('button[aria-label="Collapse the chats panel"]') as Element)
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-panel-open]')).toBeNull()
    expect(panel.container.querySelector('[data-board-panel-rail]')).not.toBeNull()

    // Escape closes the panel first and leaves the window alone.
    fireEvent.click(panel.container.querySelector('button[aria-label="Chats"]') as Element)
    await runtime.flush()
    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-panel-open]')).toBeNull()
    expect(panel.container.querySelector('[data-board-window="agent"]')).not.toBeNull()

    // Fullscreen docks it to the board panel and gives its width to the chat.
    fireEvent.click(panel.container.querySelector('button[aria-label="Chats"]') as Element)
    fireEvent.click(panel.container.querySelector('button[aria-label="Open fullscreen"]') as Element)
    await runtime.flush()
    const docked = panel.container.querySelector('[data-board-panel]') as HTMLElement
    const dockedWidth = panelWidthFor(1400, board.store.getSnapshot().panelWidth)
    expect(docked.getAttribute('data-board-panel')).toBe('docked')
    expect(docked.style.left).toBe('0px')
    expect(docked.style.top).toBe('0px')
    expect(docked.style.height).toBe('900px')
    expect(docked.style.width).toBe(`${String(dockedWidth)}px`)
    // The rail stands down while the panel is docked.
    expect(panel.container.querySelector('[data-board-panel-rail]')).toBeNull()
    const fullscreen = panel.container.querySelector('[data-board-fullscreen]') as HTMLElement
    expect(fullscreen.style.inset).toBe(`0 0 0 ${String(dockedWidth)}px`)
  })

  it('points the window at the chat picked in its panel', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    const created = await runtime.sessions.add({ id: 'session-1', summary: { cwd: '/work/one' } })
    runtime.sessions.stubCreate(async () => created)
    await runtime.sessions.add({ id: 'chat-2', summary: { displayTitle: 'Second chat', cwd: '/work/two' } })
    await runtime.workspaces.update((draft) => {
      draft.items = [{
        workspaceId: 'ws-1' as never,
        path: '/work/two',
        title: 'Two',
        sessionIds: ['chat-2' as never],
        createdAt: '2026-09-16T00:00:00.000Z',
        updatedAt: '2026-09-16T00:00:00.000Z',
      }]
    })
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()

    fireEvent.click(panel.container.querySelector('button[aria-label="Chats"]') as Element)
    await runtime.flush()
    fireEvent.click(panel.view.getByText('Two'))
    await runtime.flush()
    fireEvent.click(panel.view.getByText('Second chat'))
    await runtime.flush()

    // The window's session is the picked chat: the panel marks that row current.
    expect(panel.container.querySelector('[data-board-chat-current]')?.textContent).toContain('Second chat')
    expect(runtime.sessions.calls.some(call => call.method === 'open' && call.args[0] === 'chat-2')).toBe(true)
  })

  it('manages projects from the panel: rename, reorder, delete', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    await runtime.workspaces.update((draft) => {
      draft.items = [
        {
          workspaceId: 'ws-1' as never,
          path: '/work/one',
          title: 'One',
          sessionIds: [],
          createdAt: '2026-09-16T00:00:00.000Z',
          updatedAt: '2026-09-16T00:00:00.000Z',
        },
        {
          workspaceId: 'ws-2' as never,
          path: '/work/two',
          title: 'Two',
          sessionIds: ['chat-2' as never],
          createdAt: '2026-09-16T00:00:00.000Z',
          updatedAt: '2026-09-16T00:00:00.000Z',
        },
      ]
    })
    const created = await runtime.sessions.add({ id: 'session-1', summary: { cwd: '/work/one' } })
    runtime.sessions.stubCreate(async () => created)
    await runtime.sessions.add({ id: 'chat-2', summary: { displayTitle: 'Second chat', cwd: '/work/two' } })
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()

    // Rename the first project through its row menu.
    const rows = () => [...panel.container.querySelectorAll('[data-row-key^="project:"]')] as HTMLElement[]
    const firstMenu = rows()[0]?.parentElement?.querySelector('button[aria-label="More actions"]')
    fireEvent.click(firstMenu as Element)
    await runtime.flush()
    fireEvent.click(screen.getByText('Rename'))
    await runtime.flush()
    const input = panel.container.querySelector('[data-board-row-edit="rename"] input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await runtime.flush()
    expect(runtime.workspaces.calls.some(call => call.method === 'rename' && call.args[1] === 'Renamed')).toBe(true)

    // Move it down, then delete the second project with the confirm step.
    fireEvent.click(rows()[0]?.parentElement?.querySelector('button[aria-label="More actions"]') as Element)
    await runtime.flush()
    fireEvent.click(screen.getByText('Move down'))
    await runtime.flush()
    expect(runtime.workspaces.calls.some(call => call.method === 'insertBefore')).toBe(true)

    const second = panel.container.querySelector('[data-row-key="project:ws-2"]')?.parentElement
    fireEvent.click(second?.querySelector('button[aria-label="More actions"]') as Element)
    await runtime.flush()
    fireEvent.click(screen.getByText('Delete project'))
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-row-edit="confirm"]')).not.toBeNull()
    fireEvent.click(screen.getByText('Confirm'))
    await runtime.flush()
    expect(runtime.workspaces.calls.some(call => call.method === 'delete' && call.args[0] === 'ws-2')).toBe(true)
  })

  it('branches and archives a chat from the panel', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    const created = await runtime.sessions.add({ id: 'session-1', summary: { cwd: '/work/one' } })
    runtime.sessions.stubCreate(async () => created)
    await runtime.sessions.add({ id: 'chat-2', summary: { displayTitle: 'Second chat', cwd: '/work/two' } })
    await runtime.workspaces.update((draft) => {
      draft.items = [{
        workspaceId: 'ws-1' as never,
        path: '/work/two',
        title: 'Two',
        sessionIds: ['chat-2' as never],
        createdAt: '2026-09-16T00:00:00.000Z',
        updatedAt: '2026-09-16T00:00:00.000Z',
      }]
    })
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()

    fireEvent.click(panel.container.querySelector('button[aria-label="Chats"]') as Element)
    await runtime.flush()
    fireEvent.click(panel.view.getByText('Two'))
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('button[aria-label="More actions"]') as Element)
    await runtime.flush()
    fireEvent.click(screen.getByText('Branch'))
    await runtime.flush()
    expect(runtime.sessions.calls.some(call => call.method === 'fork')).toBe(true)

    fireEvent.click(panel.container.querySelector('button[aria-label="More actions"]') as Element)
    await runtime.flush()
    fireEvent.click(screen.getByText('Archive chat'))
    await runtime.flush()
    fireEvent.click(screen.getByText('Confirm'))
    await runtime.flush()
    expect(runtime.workspaces.calls.some(call => call.method === 'archiveSession')).toBe(true)
  })

  it('registers a folder through the panel folder browser', async () => {
    const listing = {
      path: '/work',
      home: '/home',
      crumbs: [{ name: '', path: '/' }, { name: 'work', path: '/work' }],
      entries: [{ name: 'ketos', path: '/work/ketos', hidden: false }],
      truncated: false,
    }
    const prepared = await createBoardBench({
      uiWorkspace: {
        listDirectory: async () => listing,
        createDirectory: async () => '/work/ketos',
      },
    })
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    const created = await runtime.sessions.add({ id: 'session-1', summary: { cwd: '/work/one' } })
    runtime.sessions.stubCreate(async () => created)
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()

    fireEvent.click(panel.container.querySelector('button[aria-label="Chats"]') as Element)
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('button[aria-label="Add a folder…"]') as Element)
    await runtime.flush()
    expect(panel.view.getByText('ketos')).not.toBeNull()
    fireEvent.click(panel.view.getByText('Use this folder'))
    await runtime.flush()
    expect(runtime.workspaces.calls.some(call => call.method === 'create' && (call.args[0] as { path: string }).path === '/work')).toBe(true)
  })

  it('falls back to the host chooser when no browse picker is mounted', async () => {
    let picked = 0
    const prepared = await createBoardBench({
      uiWorkspace: {
        listDirectory: async () => { throw new Error('directory browsing is not available') },
        pickDirectory: async () => { picked += 1; return '/work' },
      },
    })
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    const created = await runtime.sessions.add({ id: 'session-1', summary: { cwd: '/work/one' } })
    runtime.sessions.stubCreate(async () => created)
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()

    fireEvent.click(panel.container.querySelector('button[aria-label="Chats"]') as Element)
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('button[aria-label="Add a folder…"]') as Element)
    await runtime.flush()

    // A host whose boot mounted the native picker serves no listing: the level
    // states that and offers the chooser instead of a dead browser.
    expect(panel.view.getByText('Folder browsing is unavailable')).not.toBeNull()
    fireEvent.click(panel.view.getByText('Choose a folder in the system…'))
    await runtime.flush()
    expect(picked).toBe(1)
    expect(runtime.workspaces.calls.some(call => call.method === 'create' && (call.args[0] as { path: string }).path === '/work')).toBe(true)
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
    expect(runtime.slots.entries('board.window.body')).toHaveLength(1)
  })

  it('culls a window that leaves the visible canvas and keeps its draft', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    const created = await runtime.sessions.add({ id: 'session-1', summary: { cwd: '/work' } })
    runtime.sessions.stubCreate(async () => created)
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.setViewport(1200, 900)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, title: 'Agent' }))
    })
    await runtime.flush()
    fireEvent.change(panel.container.querySelector('textarea') as Element, { target: { value: 'draft' } })

    act(() => { board.actions.setPan(-6000, -6000) })
    await runtime.flush()
    const frame = panel.container.querySelector('[data-board-window="agent"]') as HTMLElement
    expect(frame.getAttribute('data-board-culled')).toBe('')
    expect((panel.container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('draft')

    act(() => { board.actions.setPan(0, 0) })
    await runtime.flush()
    expect(frame.getAttribute('data-board-culled')).toBeNull()
    expect((panel.container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('draft')
  })

  it("keeps the active window's resize affordances above the floating chrome", async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true, writable: true })

    act(() => {
      board.actions.setViewport(1200, 900)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, title: 'Agent' }))
      board.actions.moveWindow('a1' as WindowId, 24, 200, false)
    })
    await runtime.flush()

    // The ring projects the window border into panel pixels: the eight handles
    // sit on it, above the chrome (the board root renders it after the layers).
    const ring = panel.container.querySelector('[data-board-handle-ring]') as HTMLElement
    expect(ring).not.toBeNull()
    const handles = [...ring.querySelectorAll('[data-board-handle]')] as HTMLElement[]
    expect(handles.map(handle => handle.getAttribute('data-board-handle'))).toEqual([
      'n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se',
    ])
    const east = ring.querySelector('[data-board-handle="e"]') as HTMLElement
    expect(east.style.left).toBe('573px')
    expect(east.style.top).toBe('214px')
    const rootChildren = [...(panel.container.querySelector('[data-surface="board"]') as HTMLElement).children]
    expect(rootChildren.indexOf(ring)).toBeGreaterThan(rootChildren.findIndex(node => node.getAttribute('data-board-layer') === 'dock'))

    // A ring handle resizes the window through the shared gesture (the drag is
    // snapped to the 24px grid: 552 + 40 lands on 600).
    fireEvent.pointerDown(east, { clientX: 585, pointerId: 9 })
    for (const [type, clientX] of [['pointermove', 625], ['pointerup', 625]] as const) {
      const event = new Event(type)
      Object.assign(event, { clientX, pointerId: 9 })
      window.dispatchEvent(event)
    }
    expect(board.store.getSnapshot().windows['a1']?.width).toBe(600)

    // Fullscreen stands the ring down with the frame's own handles.
    act(() => { board.actions.setWindowFullscreen('a1' as WindowId) })
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-handle-ring]')).toBeNull()
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  })

  it('keeps the active window when the bare canvas is clicked', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true, writable: true })

    act(() => {
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, title: 'First' }))
      board.actions.openWindow(windowState({ id: 'a2' as WindowId, title: 'Second' }))
    })
    await runtime.flush()
    act(() => { board.actions.focusWindow('a1' as WindowId) })
    await runtime.flush()

    fireEvent.pointerDown(panel.container.querySelector('[data-surface="canvas"]') as Element, {
      pointerId: 5, clientX: 10, clientY: 10, button: 0,
    })
    fireEvent.pointerUp(window, { pointerId: 5 })
    await runtime.flush()

    // A panel or fullscreen mode keeps its owner: the empty-canvas click pans only.
    expect(board.store.getSnapshot().activeWindowId).toBe('a1')
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  })

  it('gives Escape one action per press, panel before fullscreen, and never closes the window', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId, title: 'Agent' })) })
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('button[aria-label="Chats"]') as Element)
    fireEvent.click(panel.container.querySelector('button[aria-label="Open fullscreen"]') as Element)
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-panel-open]')).not.toBeNull()
    expect(panel.container.querySelector('[data-board-fullscreen]')).not.toBeNull()

    // First press: the panel, and only the panel.
    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-panel-open]')).toBeNull()
    expect(panel.container.querySelector('[data-board-fullscreen]')).not.toBeNull()

    // Second press: fullscreen, and only fullscreen.
    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-fullscreen]')).toBeNull()
    expect(board.store.getSnapshot().windows['a1']).toBeDefined()
    expect(panel.container.querySelectorAll('[data-board-window="agent"]')).toHaveLength(1)

    // Third press: nothing left to take.
    const before = board.store.getSnapshot()
    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    expect(board.store.getSnapshot().windows).toEqual(before.windows)
  })

  it('zooms from the canvas and the chrome and leaves the window its own wheel', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    const created = await runtime.sessions.add({ id: 'session-1', summary: { cwd: '/work' } })
    runtime.sessions.stubCreate(async () => created)
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId, title: 'Agent' })) })
    await runtime.flush()

    fireEvent.wheel(panel.container.querySelector('[data-surface="canvas"]') as Element, { deltaY: -100, clientX: 100, clientY: 100 })
    expect(board.store.getSnapshot().zoom).toBeCloseTo(1.1)

    // A window lane keeps its own scrolling: the canvas zoom stays put.
    fireEvent.wheel(panel.container.querySelector('textarea') as Element, { deltaY: -100, clientX: 100, clientY: 100 })
    expect(board.store.getSnapshot().zoom).toBeCloseTo(1.1)

    // The floating chrome sits beside the canvas: its wheel still zooms.
    fireEvent.wheel(panel.container.querySelector('[data-board-layer="dock"] button') as Element, { deltaY: -100, clientX: 40, clientY: 400 })
    expect(board.store.getSnapshot().zoom).toBeCloseTo(1.21)
  })

  it('drags a frame header and resizes through a frame handle', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true, writable: true })

    act(() => {
      board.actions.setViewport(1200, 900)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, title: 'Agent' }))
    })
    await runtime.flush()
    const frame = panel.container.querySelector('[data-board-window="agent"]') as HTMLElement
    const before = board.store.getSnapshot().windows['a1'] as BoardWindowState

    // The header drag moves the window by the world delta (snapped to the grid).
    fireEvent.pointerDown(frame.querySelector('[class*="header"]') as Element, {
      pointerId: 11, clientX: 300, clientY: 100,
    })
    for (const [type, clientX, clientY] of [['pointermove', 360, 160], ['pointerup', 360, 160]] as const) {
      const event = new Event(type)
      Object.assign(event, { clientX, clientY, pointerId: 11 })
      window.dispatchEvent(event)
    }
    const moved = board.store.getSnapshot().windows['a1'] as BoardWindowState
    expect(moved.x).toBe(Math.round((before.x + 60) / 24) * 24)
    expect(moved.y).toBe(Math.round((before.y + 60) / 24) * 24)

    // The frame's east handle resizes exactly one axis through the shared gesture.
    fireEvent.pointerDown(frame.querySelector('[data-board-handle="e"]') as Element, {
      pointerId: 12, clientX: 500, clientY: 300,
    })
    for (const [type, clientX] of [['pointermove', 548], ['pointerup', 548]] as const) {
      const event = new Event(type)
      Object.assign(event, { clientX, pointerId: 12 })
      window.dispatchEvent(event)
    }
    const resized = board.store.getSnapshot().windows['a1'] as BoardWindowState
    expect(resized.width).toBe(moved.width + 48)
    expect(resized.height).toBe(moved.height)

    // At zoom 2 the same screen drag is half the world delta.
    act(() => { board.actions.setZoom(2) })
    await runtime.flush()
    const zoomed = board.store.getSnapshot().windows['a1'] as BoardWindowState
    fireEvent.pointerDown(frame.querySelector('[data-board-handle="e"]') as Element, {
      pointerId: 15, clientX: 500, clientY: 300,
    })
    for (const [type, clientX] of [['pointermove', 596], ['pointerup', 596]] as const) {
      const event = new Event(type)
      Object.assign(event, { clientX, pointerId: 15 })
      window.dispatchEvent(event)
    }
    expect((board.store.getSnapshot().windows['a1'] as BoardWindowState).width).toBe(zoomed.width + 48)
    act(() => { board.actions.setZoom(1) })

    // A header button keeps its own gesture: the drag stands down for it.
    fireEvent.pointerDown(frame.querySelector('button[aria-label="Close"]') as Element, {
      pointerId: 13, clientX: 10, clientY: 10,
    })
    expect(board.store.getSnapshot().windows['a1']).toBeDefined()

    // Fullscreen disables the header drag: the stored rectangle is the restore.
    act(() => { board.actions.setWindowFullscreen('a1' as WindowId) })
    await runtime.flush()
    const still = board.store.getSnapshot().windows['a1'] as BoardWindowState
    fireEvent.pointerDown(panel.container.querySelector('[class*="header"]') as Element, {
      pointerId: 14, clientX: 200, clientY: 200,
    })
    for (const [type, clientX, clientY] of [['pointermove', 400, 400], ['pointerup', 400, 400]] as const) {
      const event = new Event(type)
      Object.assign(event, { clientX, clientY, pointerId: 14 })
      window.dispatchEvent(event)
    }
    expect(board.store.getSnapshot().windows['a1']).toMatchObject({ x: still.x, y: still.y })
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  })

  it('re-applies without duplicating registrations and renders again', async () => {
    const { runtime, board, mountBoard } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    await board.dispose()
    // The first mount's DOM must be gone before the rebuild, or the render assertion below is stale.
    await vi.waitFor(() => {
      expect(panel.container.querySelector('[data-surface="canvas"]')).toBeNull()
    })

    const second = await mountBoard()
    try {
      expect(runtime.slots.entries('main').map(entry => entry.options.key)).toEqual(['board'])
      expect(runtime.slots.entriesOfSlot('board.canvas')).toHaveLength(1)
      expect(runtime.slots.entriesOfSlot('board.windows')).toHaveLength(1)
      expect(runtime.slots.entries('board.window')).toHaveLength(6)
      expect(runtime.slots.entries('board.window.body')).toHaveLength(1)
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
