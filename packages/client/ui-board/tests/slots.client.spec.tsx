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
import { BOARD_PANEL_ID } from '../src/client/contract/slots.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CloneId } from '@ketos/clone-core/types'
import { chatSnapshot, createBoardBench } from './fixtures.client.ts'
import railCss from '../src/client/dock/SessionRail.module.css'
import minimapCss from '../src/client/canvas/Minimap.module.css'
import type { ConversationNode } from '@deepseek-ai/dsh-client-ui-chat/client'

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
    ordinal: 1,
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

    // One frame registration per window type; the conversation body, the clone
    // card editor, and the clone memory list are the only occupied bodies (no
    // board window ships mock tool or settings content).
    expect(runtime.slots.entries('board.window').map(entry => entry.options.key)).toEqual([
      'agent', 'clone', 'connectors', 'settings', 'dashboard', 'tasks',
    ])
    expect(runtime.slots.entries('board.window.body').map(entry => entry.options.key)).toEqual([
      'conversation', 'clone', 'clone-memory', 'tasks',
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

    const toolKinds = ['connectors', 'settings', 'dashboard', 'tasks'] as const
    act(() => {
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'First agent' }))
      for (const [index, kind] of toolKinds.entries()) {
        board.actions.openWindow(windowState({
          id: `t${String(index)}` as WindowId,
          kind,
          bodyKind: kind,
          ordinal: index + 2,
          customTitle: `Tool ${kind}`,
          width: 520,
          height: 480,
        }))
      }
    })
    await runtime.flush()

    // Each frame renders its own component: only the agent frame carries the
    // session composer, so a frame dispatched to the wrong occupant fails these assertions.
    const agentFrame = panel.container.querySelector('[data-board-window="agent"]')
    expect(agentFrame?.querySelector('textarea')).not.toBeNull()
    expect(agentFrame?.querySelector('button[aria-label="Send"]')).not.toBeNull()
    expect(agentFrame?.textContent).toContain('First agent')
    // Every tool kind keeps the shared frame without the chat-only controls, so
    // the panel and fullscreen modes never apply to them.
    expect(agentFrame?.querySelector('button[aria-label="Chats"]')).not.toBeNull()
    expect(agentFrame?.querySelector('button[aria-label="Open fullscreen"]')).not.toBeNull()
    for (const kind of toolKinds) {
      const toolFrame = panel.container.querySelector(`[data-board-window="${kind}"]`)
      expect(toolFrame).not.toBeNull()
      expect(toolFrame?.textContent).toContain(`Tool ${kind}`)
      expect(toolFrame?.querySelector('textarea')).toBeNull()
      expect(toolFrame?.querySelector('button[aria-label="Send"]')).toBeNull()
      expect(toolFrame?.querySelector('button[aria-label="Chats"]')).toBeNull()
      expect(toolFrame?.querySelector('button[aria-label="Open fullscreen"]')).toBeNull()
    }
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

  it('renders the conversation body for an agent window and the memory body for a clone window', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.openWindow(windowState({ id: 'a1' as WindowId }))
      board.actions.openWindow(windowState({
        id: 'c1' as WindowId,
        kind: 'clone',
        bodyKind: 'clone-memory',
        cloneId: 'clone-1' as CloneId,
        ordinal: 3,
        customTitle: 'Clone memory',
      }))
    })
    await runtime.flush()

    expect(panel.container.querySelector('textarea')).not.toBeNull()

    const cloneFrame = panel.container.querySelector('[data-board-window="clone"]')
    expect(cloneFrame).not.toBeNull()
    expect(cloneFrame?.textContent).toContain('Clone memory')
    // The memory body occupies the clone frame's content region; this bench has
    // no route, so the refused read renders its own failure row rather than an
    // empty memory.
    expect(cloneFrame?.querySelector('[data-board-memory-list]')).not.toBeNull()
    expect(cloneFrame?.querySelector('[data-board-memory-notice="read"]')).not.toBeNull()
    expect(cloneFrame?.querySelector('[data-board-memory-empty]')).toBeNull()
  })

  it('closes a window through its frame and removes it from the layer', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'First agent' }))
      board.actions.openWindow(windowState({ id: 'a2' as WindowId, customTitle: 'Second agent' }))
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
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'First agent' }))
      board.actions.openWindow(windowState({ id: 'a2' as WindowId, customTitle: 'Second agent' }))
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
          id: `t${String(cycle)}` as WindowId, kind: 'connectors', bodyKind: 'connectors', ordinal: 2, customTitle: 'Tools',
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
    expect(runtime.slots.entries('board.window.body')).toHaveLength(4)
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
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' }))
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
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' }))
      board.actions.moveWindow('a1' as WindowId, 24, 200, false)
    })
    await runtime.flush()

    // The ring projects the window border into panel pixels: the eight handles
    // sit outside the frame, above the chrome (the board root renders it after
    // the layers). Sitting outside keeps the scaled header's controls clickable
    // at a zoomed-out canvas.
    const ring = panel.container.querySelector('[data-board-handle-ring]') as HTMLElement
    expect(ring).not.toBeNull()
    const handles = [...ring.querySelectorAll('[data-board-handle]')] as HTMLElement[]
    expect(handles.map(handle => handle.getAttribute('data-board-handle'))).toEqual([
      'n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se',
    ])
    const east = ring.querySelector('[data-board-handle="e"]') as HTMLElement
    expect(east.style.left).toBe('576px')
    expect(east.style.top).toBe('214px')
    const northWest = ring.querySelector('[data-board-handle="nw"]') as HTMLElement
    expect(northWest.style.left).toBe('10px')
    expect(northWest.style.top).toBe('186px')
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
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'First' }))
      board.actions.openWindow(windowState({ id: 'a2' as WindowId, customTitle: 'Second' }))
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

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' })) })
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

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' })) })
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
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' }))
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

  it('pans with Space over the chrome and over a window, and with the middle button on the ring', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true, writable: true })

    act(() => {
      board.actions.setViewport(1200, 900)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' }))
    })
    await runtime.flush()
    const root = panel.container.querySelector('[data-surface="board"]') as HTMLElement
    const dock = panel.container.querySelector('[data-board-layer="dock"]') as HTMLElement

    const drag = (
      target: Element,
      pointerId: number,
      button: number,
      from: { x: number; y: number },
      to: { x: number; y: number },
    ) => {
      fireEvent.pointerDown(target, { pointerId, button, clientX: from.x, clientY: from.y })
      for (const type of ['pointermove', 'pointerup'] as const) {
        const event = new Event(type)
        Object.assign(event, { clientX: to.x, clientY: to.y, pointerId, button })
        window.dispatchEvent(event)
      }
    }

    // Space arms from the root, so the floating chrome pans too.
    fireEvent.pointerEnter(root)
    fireEvent.keyDown(window, { code: 'Space' })
    drag(dock, 41, 0, { x: 300, y: 400 }, { x: 360, y: 440 })
    expect(board.store.getSnapshot().panX).toBe(60)
    fireEvent.keyUp(window, { code: 'Space' })

    // A middle-button drag on a ring handle pans instead of resizing.
    const before = board.store.getSnapshot()
    drag(panel.container.querySelector('[data-board-handle-ring] [data-board-handle="e"]') as Element, 42, 1, { x: 500, y: 300 }, { x: 540, y: 320 })
    expect(board.store.getSnapshot().panX).toBe(before.panX + 40)
    expect(board.store.getSnapshot().windows['a1']?.width).toBe(before.windows['a1']?.width)
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  })

  it('gives Escape one action per press across the menu, selection overlay, and chats panel', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' })) })
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('button[aria-label="Chats"]') as Element)
    // A menu opened before the overlay still owns the first press; the overlay
    // itself would claim a click made while it is up (that is its pick). The
    // panel stands the floating chrome down, so the menu here is the window
    // composer's own action menu.
    fireEvent.click(panel.container.querySelector('[data-board-action="composer-actions"]') as Element)
    await runtime.flush()
    act(() => { board.actions.setSelectingElement(true) })
    await runtime.flush()
    expect(panel.container.querySelector('[class*="overlay"]')).not.toBeNull()
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(board.store.getSnapshot().isSelectingElement).toBe(true)
    expect(board.store.getSnapshot().panelWindowId).toBe('a1')

    // Next press: the selection mode, and only it.
    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    expect(board.store.getSnapshot().isSelectingElement).toBe(false)
    expect(board.store.getSnapshot().panelWindowId).toBe('a1')

    // Next press: the panel, and only it.
    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    expect(board.store.getSnapshot().panelWindowId).toBeNull()
    expect(board.store.getSnapshot().windows['a1']).toBeDefined()
  })

  it('lets the palette keep Escape while the chats panel is open', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('button[aria-label="Chats"]') as Element)
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-panel][data-board-panel-open]')).not.toBeNull()

    const input = panel.container.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '/fi' } })
    const row = panel.container.querySelector('[role="listbox"] [role="option"]') as Element
    expect(row).not.toBeNull()
    fireEvent.keyDown(row, { key: 'Escape' })
    await runtime.flush()

    // Escape dismissed the palette only: the chats panel is still open.
    expect(panel.container.querySelector('[role="listbox"]')).toBeNull()
    expect(panel.container.querySelector('[data-board-panel][data-board-panel-open]')).not.toBeNull()
    expect(input.value).toBe('/fi')
  })

  it('brings the dock and minimap back when the chats panel collapses to its rail', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance

    act(() => {
      board.actions.setViewport(1200, 900)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' }))
    })
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('button[aria-label="Chats"]') as Element)
    await runtime.flush()
    // The expanded panel is a management surface: the whole floating chrome
    // stands down so nothing covers its edge, handle, or the window's bottom.
    for (const layer of ['dock', 'omnibar', 'minimap'] as const) {
      expect(panel.container.querySelectorAll(`[data-board-layer="${layer}"]`)).toHaveLength(0)
    }

    fireEvent.click(panel.container.querySelector('button[aria-label="Collapse the chats panel"]') as Element)
    await runtime.flush()
    expect(panel.container.querySelectorAll('[data-board-layer="dock"]')).toHaveLength(1)
    expect(panel.container.querySelectorAll('[data-board-layer="minimap"]')).toHaveLength(1)
    expect(panel.container.querySelectorAll('[data-board-layer="omnibar"]')).toHaveLength(1)
    expect(panel.container.querySelector('[data-board-panel-rail]')).not.toBeNull()

    // In fullscreen a collapsed panel takes no Escape: the mode leaves at once.
    fireEvent.click(panel.container.querySelector('button[aria-label="Open fullscreen"]') as Element)
    await runtime.flush()
    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-fullscreen]')).toBeNull()
  })

  it('commits a panel row reorder only on a completed drag', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    await runtime.workspaces.update((draft) => {
      draft.items = [1, 2, 3].map(n => ({
        workspaceId: `ws-${String(n)}` as never,
        path: `/work/${String(n)}`,
        title: `P${String(n)}`,
        sessionIds: [`chat-${String(n)}` as never],
        createdAt: '2026-09-16T00:00:00.000Z',
        updatedAt: '2026-09-16T00:00:00.000Z',
      }))
    })
    for (const n of [1, 2, 3]) {
      await runtime.sessions.add({ id: `chat-${String(n)}`, summary: { displayTitle: `C${String(n)}`, cwd: `/work/${String(n)}` } })
    }
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' })) })
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('button[aria-label="Chats"]') as Element)
    await runtime.flush()

    const rows = [...panel.container.querySelectorAll('[data-row-key^="project:"]')] as HTMLElement[]
    const from = rows[0] as HTMLElement
    const to = rows[2] as HTMLElement
    // jsdom lays nothing out, so the gesture carries its own coordinates: the
    // target row comes from the patched hit test.
    Object.defineProperty(document, 'elementFromPoint', { value: () => to, configurable: true })
    const gesture = (lastType: 'pointerup' | 'pointercancel') => {
      fireEvent.pointerDown(from, { pointerId: 51, clientX: 10, clientY: 10 })
      for (const type of ['pointermove', lastType] as const) {
        const event = new Event(type)
        Object.assign(event, { clientX: 10, clientY: 90, pointerId: 51 })
        window.dispatchEvent(event)
      }
    }

    // An aborted drag (pointercancel) leaves the order alone.
    gesture('pointercancel')
    expect(runtime.workspaces.calls.some(call => call.method === 'insertBefore')).toBe(false)

    // A completed drag commits through the same service the menu uses.
    gesture('pointerup')
    expect(runtime.workspaces.calls.some(call => call.method === 'insertBefore')).toBe(true)
    // Drop the own property so the prototype's implementation is visible again.
    Reflect.deleteProperty(document, 'elementFromPoint')
  })

  it('ends every frame gesture when its window closes mid-drag', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true, writable: true })
    const move = vi.fn(board.actions.moveWindow)
    board.actions.moveWindow = move
    const resize = vi.fn(board.actions.resizeWindow)
    board.actions.resizeWindow = resize

    const open = async (id: string, title: string) => {
      act(() => { board.actions.openWindow(windowState({ id: id as WindowId, customTitle: title })) })
      await runtime.flush()
      return panel.container.querySelector(`[data-board-window-id="${id}"]`) as HTMLElement
    }
    /** Start a drag and hand back its move step. */
    const start = (target: Element, pointerId: number) => {
      fireEvent.pointerDown(target, { pointerId, clientX: 100, clientY: 100 })
      return (x: number, y: number) => {
        const event = new Event('pointermove')
        Object.assign(event, { clientX: x, clientY: y, pointerId })
        window.dispatchEvent(event)
      }
    }
    const close = async (frame: HTMLElement) => {
      fireEvent.click(frame.querySelector('button[aria-label="Close"]') as Element)
      await runtime.flush()
    }

    // Header drag.
    let frame = await open('a1', 'Agent 1')
    let step = start(frame.querySelector('[class*="header"]') as Element, 61)
    step(200, 200)
    expect(move).toHaveBeenCalledTimes(1)
    await close(frame)
    step(300, 300)
    expect(move).toHaveBeenCalledTimes(1)

    // Frame handle.
    frame = await open('a2', 'Agent 2')
    step = start(frame.querySelector('[data-board-handle="e"]') as Element, 62)
    step(200, 100)
    expect(resize).toHaveBeenCalled()
    const resizesBeforeClose = resize.mock.calls.length
    await close(frame)
    step(300, 100)
    expect(resize.mock.calls.length).toBe(resizesBeforeClose)

    // Ring handle of the active window.
    frame = await open('a3', 'Agent 3')
    const ring = panel.container.querySelector('[data-board-handle-ring] [data-board-handle="e"]') as Element
    step = start(ring, 63)
    step(200, 100)
    expect(resize.mock.calls.length).toBeGreaterThan(resizesBeforeClose)
    const resizesBeforeRingClose = resize.mock.calls.length
    await close(frame)
    step(300, 100)
    expect(resize.mock.calls.length).toBe(resizesBeforeRingClose)
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  })

  it('ends every panel gesture when its window closes mid-drag', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    await runtime.workspaces.update((draft) => {
      draft.items = [1, 2].map(n => ({
        workspaceId: `ws-${String(n)}` as never,
        path: `/work/${String(n)}`,
        title: `P${String(n)}`,
        sessionIds: [`chat-${String(n)}` as never],
        createdAt: '2026-09-16T00:00:00.000Z',
        updatedAt: '2026-09-16T00:00:00.000Z',
      }))
    })
    for (const n of [1, 2]) {
      await runtime.sessions.add({ id: `chat-${String(n)}`, summary: { displayTitle: `C${String(n)}`, cwd: `/work/${String(n)}` } })
    }
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true, writable: true })
    act(() => {
      board.actions.setViewport(1200, 900)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' }))
    })
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('button[aria-label="Chats"]') as Element)
    await runtime.flush()
    const windowFrame = panel.container.querySelector('[data-board-window-id="a1"]') as HTMLElement

    const step = (pointerId: number, x: number, y: number) => {
      const event = new Event('pointermove')
      Object.assign(event, { clientX: x, clientY: y, pointerId })
      window.dispatchEvent(event)
    }

    // Panel resize.
    const setWidth = vi.fn(board.actions.setPanelWidth)
    board.actions.setPanelWidth = setWidth
    fireEvent.pointerDown(panel.container.querySelector('[aria-label="Resize the chats panel"]') as Element, {
      pointerId: 71, clientX: 200, clientY: 300,
    })
    step(71, 160, 300)
    expect(setWidth).toHaveBeenCalled()
    const widthCalls = setWidth.mock.calls.length
    fireEvent.click(windowFrame.querySelector('button[aria-label="Close"]') as Element)
    await runtime.flush()
    step(71, 120, 300)
    expect(setWidth.mock.calls.length).toBe(widthCalls)

    // Row drag: a pointerup after the window closed must not commit.
    act(() => { board.actions.openWindow(windowState({ id: 'a2' as WindowId, customTitle: 'Agent 2' })) })
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('button[aria-label="Chats"]') as Element)
    await runtime.flush()
    const rows = [...panel.container.querySelectorAll('[data-row-key^="project:"]')] as HTMLElement[]
    Object.defineProperty(document, 'elementFromPoint', { value: () => rows[1], configurable: true })
    fireEvent.pointerDown(rows[0] as Element, { pointerId: 72, clientX: 10, clientY: 10 })
    step(72, 10, 90)
    fireEvent.click(panel.container.querySelector('[data-board-window-id="a2"] button[aria-label="Close"]') as Element)
    await runtime.flush()
    const up = new Event('pointerup')
    Object.assign(up, { clientX: 10, clientY: 90, pointerId: 72 })
    window.dispatchEvent(up)
    expect(runtime.workspaces.calls.some(call => call.method === 'insertBefore')).toBe(false)
    Reflect.deleteProperty(document, 'elementFromPoint')
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  })

  it('marks the focused window in the dock and on the minimap alike', async () => {
    const { runtime } = await bench()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    act(() => {
      board.actions.setViewport(1200, 900)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'First' }))
      board.actions.openWindow(windowState({ id: 'a2' as WindowId, customTitle: 'Second' }))
    })
    await runtime.flush()
    const dockRowOf = (title: string) =>
      panel.container.querySelector(`[data-board-layer="dock"] [data-board-action="dock-row"][data-board-title="${title}"]`) as HTMLElement
    const minimapRects = () => [...panel.container.querySelectorAll('[data-board-layer="minimap"] rect[class*="rect"]')]
    // The stylesheets define both classes; a rename must fail the test loudly.
    const railActive = railCss.active as string
    const minimapActive = minimapCss.active as string

    act(() => { board.actions.focusWindow('a1' as WindowId) })
    await runtime.flush()
    expect(dockRowOf('First').classList.contains(railActive)).toBe(true)
    expect(dockRowOf('Second').classList.contains(railActive)).toBe(false)
    expect(minimapRects()[0]?.classList.contains(minimapActive)).toBe(true)
    expect(minimapRects()[1]?.classList.contains(minimapActive)).toBe(false)

    act(() => { board.actions.focusWindow('a2' as WindowId) })
    await runtime.flush()
    expect(dockRowOf('Second').classList.contains(railActive)).toBe(true)
    expect(minimapRects()[1]?.classList.contains(minimapActive)).toBe(true)
  })

  it('keeps the panel level, its search, and the lane across culling', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    await runtime.workspaces.update((draft) => {
      draft.items = [{
        workspaceId: 'ws-1' as never,
        path: '/work/one',
        title: 'One',
        sessionIds: ['chat-1' as never],
        createdAt: '2026-09-16T00:00:00.000Z',
        updatedAt: '2026-09-16T00:00:00.000Z',
      }]
    })
    const created = await runtime.sessions.add({ id: 'chat-1', summary: { displayTitle: 'Chat one', cwd: '/work/one' } })
    runtime.sessions.stubCreate(async () => created)
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    const userNode: ConversationNode = {
      kind: 'user',
      seq: 1,
      time: 0,
      content: [{ type: 'text', text: 'сообщение в ленте' }],
      source: undefined,
    }

    act(() => {
      board.actions.setViewport(1200, 900)
      board.actions.openWindow(windowState({ id: 'a1' as WindowId, customTitle: 'Agent' }))
    })
    await runtime.flush()
    prepared.chat.set(chatSnapshot([userNode]))
    await runtime.flush()
    expect(panel.container.textContent).toContain('сообщение в ленте')

    // Panel state: the projects level with an active search filter.
    fireEvent.click(panel.container.querySelector('button[aria-label="Chats"]') as Element)
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('button[aria-label="Search chats"]') as Element)
    const search = panel.container.querySelector('[data-board-row-edit="search"] input') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'One' } })
    await runtime.flush()

    act(() => { board.actions.setPan(-6000, -6000) })
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-panel][data-board-culled]')).not.toBeNull()
    act(() => { board.actions.setPan(0, 0) })
    await runtime.flush()
    expect((panel.container.querySelector('[data-board-row-edit="search"] input') as HTMLInputElement).value).toBe('One')
    expect(panel.container.textContent).toContain('сообщение в ленте')

    // The chats level survives a culling round trip too.
    fireEvent.click(panel.view.getByText('One'))
    await runtime.flush()
    expect(panel.container.textContent).toContain('Chat one')
    act(() => { board.actions.setPan(-6000, -6000) })
    await runtime.flush()
    act(() => { board.actions.setPan(0, 0) })
    await runtime.flush()
    expect(panel.container.textContent).toContain('Chat one')
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
      expect(runtime.slots.entries('board.window.body')).toHaveLength(4)
      await vi.waitFor(() => {
        expect(panel.container.querySelector('[data-surface="canvas"]')).not.toBeNull()
      })
    } finally {
      await second.dispose()
    }
  })

  it('navigates to the main panel for a pending approval and brings the window forward on return', async () => {
    const openSession = vi.fn()
    const prepared = await createBoardBench({ uiWorkspace: { openSession } })
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    const created = await runtime.sessions.add({ id: 'session-1' })
    runtime.sessions.stubCreate(async () => created)
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as BoardInstance
    act(() => { board.actions.setViewport(1600, 900) })
    act(() => {
      board.actions.addWindow({
        ...windowState({ id: 'a1' as WindowId }),
        x: 3000,
        y: 2000,
        zIndex: 10,
      })
    })
    await runtime.flush()
    // The window owns a session by now, so the pending flag has a session to target.
    const registerPending = runtime.ctx.uiSession.registerPendingInteraction<{
      readonly key: string
      readonly kind: string
      readonly sessionId: SessionId
    }>(() => 0)
    const releasePending = registerPending(
      { key: 'approval:1', kind: 'approval', sessionId: created },
      async () => {},
    )
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-pending="approval"]')).not.toBeNull()
    fireEvent.click(panel.view.getByText('Open in the main panel'))
    await runtime.flush()

    // The main panel shows the session, and the board remembers the window.
    expect(openSession).toHaveBeenCalledWith(created)
    expect(board.getSnapshot().returnWindowId).toBe('a1')

    // The board panel comes back: the window is centred, active, and highlighted.
    act(() => { runtime.panelInfo.set({ activePanelId: null }) })
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD_PANEL_ID }) })
    await runtime.flush()
    expect(board.getSnapshot().returnWindowId).toBeNull()
    expect(board.getSnapshot().highlightWindowId).toBe('a1')
    expect(board.getSnapshot().activeWindowId).toBe('a1')
    // Centre of a 552x648 window at (3000, 2000) inside a 1600x900 viewport.
    expect(board.getSnapshot().panX).toBe(-(3000 + 552 / 2 - 1600 / 2))
    expect(board.getSnapshot().panY).toBe(-(2000 + 648 / 2 - 900 / 2))
    releasePending()
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
