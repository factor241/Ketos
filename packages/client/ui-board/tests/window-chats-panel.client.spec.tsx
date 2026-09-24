// @vitest-environment jsdom
/**
 * Chats panel and artifacts tests:
 * - Project path display and quick actions (copy path, open folder)
 * - Artifacts tab, empty state, and settled tool-result artifacts
 * - Rail and conversation strip quick openers
 * - Path validation and isolation of ~/.ketos / filesystem roots
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import type { ChatSnapshot, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BoardDirectoryListing, WindowId } from '../src/client/contract/slots.ts'
import { createBoardStore } from '../src/client/store.ts'
import { createBoardBench } from './fixtures.client.ts'

type BoardInstance = ReturnType<ReturnType<typeof createBoardStore>['create']>

function windowState(overrides: Partial<Parameters<BoardInstance['actions']['openWindow']>[0]> & { id: WindowId }) {
  return {
    kind: 'agent' as const,
    bodyKind: 'conversation' as const,
    ordinal: 1,
    x: 0,
    y: 0,
    width: 552,
    height: 648,
    zIndex: 10,
    ...overrides,
  }
}

const runtimes = new Set<{ dispose: () => Promise<void> }>()
afterEach(async () => {
  cleanup()
  for (const runtime of runtimes) await runtime.dispose()
  runtimes.clear()
})

function toolNode(overrides: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 1,
    time: 1000,
    callId: 'call-1',
    call: { name: 'write', argsRaw: '{"file_path":"/work/test.txt"}' },
    callTime: 900,
    content: [{ type: 'text', text: 'contents' }],
    isError: false,
    subCalls: [],
    ...overrides,
  }
}

function chatWith(nodes: readonly ToolResultNode[]): ChatSnapshot {
  return {
    phase: 'ready',
    legacy: {
      nodes,
      runningCalls: [],
      partial: undefined,
    },
    hasMore: false,
    loadingOlder: false,
    running: false,
  } as unknown as ChatSnapshot
}

/** One workspace view with the fields the panel reads. */
function workspaceView(id: string, path: string, sessionIds: readonly string[], title = ''): WorkspaceView {
  return {
    workspaceId: id as WorkspaceId,
    path,
    title,
    sessionIds: sessionIds.map(sessionId => sessionId as SessionId),
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
  }
}

/** One directory level the folder browser renders. */
function listing(path: string, name: string, entries: readonly { name: string; path: string }[]): BoardDirectoryListing {
  return {
    path,
    home: '/home/user',
    crumbs: [{ name: '', path: '/' }, { name, path }],
    entries: entries.map(entry => ({ ...entry, hidden: false })),
    truncated: false,
  }
}

/** Mount the board with one open window and its chats panel open at the projects level. */
async function openChatsPanel(options: Parameters<typeof createBoardBench>[0] = {}) {
  const prepared = await createBoardBench(options)
  runtimes.add(prepared.runtime)
  await prepared.mountBoard()
  const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
  const board = prepared.runtime.storeOf('board.dock') as unknown as BoardInstance
  act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
  await prepared.runtime.flush()
  fireEvent.click(panel.container.querySelector('button[aria-label="Chats"]') as Element)
  await prepared.runtime.flush()
  return { prepared, panel, board }
}

/** The data-row keys of the rendered chat rows, in order. */
function chatRowKeys(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('[data-row-key^="chat:"]')).map(el => el.getAttribute('data-row-key'))
}

describe('WindowChatsPanel project path and artifacts', () => {
  it('displays the project path in chats level and supports copying and opening folder', async () => {
    let openedPath: string | null = null
    const prepared = await createBoardBench({
      session: {},
      sessionSummary: { cwd: '/work/my-project' },
      remoteSession: {
        openWorkspacePath: async (req) => {
          openedPath = req.path
          return { ok: true, value: { opened: true } }
        },
      },
    })
    runtimes.add(prepared.runtime)
    const { runtime } = prepared

    await runtime.workspaces.update((draft) => {
      draft.items = [{
        workspaceId: 'ws-1' as never,
        path: '/work/my-project',
        title: 'MyProject',
        sessionIds: ['session-1' as never],
        createdAt: '2026-09-16T00:00:00.000Z',
        updatedAt: '2026-09-16T00:00:00.000Z',
      }]
    })

    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as unknown as BoardInstance

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()

    // Open chats panel
    fireEvent.click(panel.container.querySelector('button[aria-label="Chats"]') as Element)
    await runtime.flush()

    // Navigate to MyProject group
    fireEvent.click(panel.view.getByText('MyProject'))
    await runtime.flush()

    // Project path row is visible
    const pathRow = panel.container.querySelector('[data-board-project-path="/work/my-project"]')
    expect(pathRow).not.toBeNull()
    expect(pathRow?.textContent).toContain('/work/my-project')

    // Quick action: copy path
    const copyBtn = panel.container.querySelector('[data-board-action="panel-copy-path"]') as Element
    expect(copyBtn).not.toBeNull()
    fireEvent.click(copyBtn)
    await runtime.flush()

    // Quick action: open folder
    const openBtn = panel.container.querySelector('[data-board-action="panel-open-folder"]') as Element
    expect(openBtn).not.toBeNull()
    fireEvent.click(openBtn)
    await runtime.flush()
    expect(openedPath).toBe('/work/my-project')
  })

  it('renders artifacts tab, empty state, and artifact list derived from tool results', async () => {
    let revealedPath: string | null = null
    let revealedAction: string | undefined
    const node1 = toolNode({
      call: { name: 'write', argsRaw: '{"file_path":"/work/created.ts"}' },
      meta: { diffs: [{ path: '/work/created.ts', oldText: null, newText: 'code' }] },
      time: 2000,
    })
    const node2 = toolNode({
      call: { name: 'read', argsRaw: '{"file_path":"/work/read.md"}' },
      time: 2500,
    })

    const prepared = await createBoardBench({
      session: {},
      sessionSummary: { cwd: '/work/my-project' },
      remoteSession: {
        openWorkspacePath: async (req) => {
          revealedPath = req.path
          revealedAction = req.action
          return { ok: true, value: { opened: true } }
        },
      },
    })
    runtimes.add(prepared.runtime)
    const { runtime, chat } = prepared

    await runtime.workspaces.update((draft) => {
      draft.items = [{
        workspaceId: 'ws-1' as never,
        path: '/work/my-project',
        title: 'MyProject',
        sessionIds: ['session-1' as never],
        createdAt: '2026-09-16T00:00:00.000Z',
        updatedAt: '2026-09-16T00:00:00.000Z',
      }]
    })

    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as unknown as BoardInstance

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()

    // Open chats panel and go to MyProject
    fireEvent.click(panel.container.querySelector('button[aria-label="Chats"]') as Element)
    await runtime.flush()
    fireEvent.click(panel.view.getByText('MyProject'))
    await runtime.flush()

    // Click Artifacts tab
    const artifactsTab = panel.container.querySelector('[data-board-tab="artifacts"]') as Element
    expect(artifactsTab).not.toBeNull()
    fireEvent.click(artifactsTab)
    await runtime.flush()

    // With no artifacts, shows empty state
    expect(panel.container.querySelector('[data-board-artifacts-empty]')).not.toBeNull()

    // Now populate chat with tool result nodes
    act(() => {
      chat.set(chatWith([node1, node2]))
    })
    await runtime.flush()

    // Artifacts list appears
    const list = panel.container.querySelector('[data-board-artifacts-list]')
    expect(list).not.toBeNull()

    const item1 = panel.container.querySelector('[data-board-artifact="/work/created.ts"]')
    expect(item1).not.toBeNull()
    expect(item1?.querySelector('[data-board-artifact-kind="created"]')).not.toBeNull()

    const item2 = panel.container.querySelector('[data-board-artifact="/work/read.md"]')
    expect(item2).not.toBeNull()
    expect(item2?.querySelector('[data-board-artifact-kind="read"]')).not.toBeNull()

    // Click reveal action
    const revealBtn = item1?.querySelector('[data-board-action="artifact-reveal"]') as Element
    expect(revealBtn).not.toBeNull()
    fireEvent.click(revealBtn)
    await runtime.flush()
    expect(revealedPath).toBe('/work/created.ts')
    expect(revealedAction).toBe('reveal')
  })

  it('rail artifacts button opens panel directly in artifacts tab', async () => {
    const prepared = await createBoardBench({
      session: {},
      sessionSummary: { cwd: '/work' },
    })
    runtimes.add(prepared.runtime)
    const { runtime, chat } = prepared

    act(() => {
      chat.set(chatWith([
        toolNode({
          call: { name: 'write', argsRaw: '{"file_path":"/work/file.txt"}' },
          meta: { diffs: [{ path: '/work/file.txt', oldText: null, newText: 'hi' }] },
        }),
      ]))
    })

    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as unknown as BoardInstance

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()

    // Panel is closed initially; click rail artifacts button
    const railBtn = panel.container.querySelector('[data-board-action="panel-rail-artifacts"]') as Element
    expect(railBtn).not.toBeNull()
    fireEvent.click(railBtn)
    await runtime.flush()

    expect(board.store.getSnapshot().panelWindowId).toBe('a1')
    expect(board.store.getSnapshot().panelCollapsed).toBe(false)
    expect(board.store.getSnapshot().panelTab).toBe('artifacts')
    expect(panel.container.querySelector('[data-board-artifacts-list]')).not.toBeNull()
  })

  it('conversation strip displays artifacts count and opens artifacts tab on click', async () => {
    const prepared = await createBoardBench({
      session: {},
      sessionSummary: { cwd: '/work' },
    })
    runtimes.add(prepared.runtime)
    const { runtime, chat } = prepared

    act(() => {
      chat.set(chatWith([
        toolNode({
          call: { name: 'write', argsRaw: '{"file_path":"/work/file1.txt"}' },
          meta: { diffs: [{ path: '/work/file1.txt', oldText: null, newText: '1' }] },
        }),
        toolNode({
          call: { name: 'write', argsRaw: '{"file_path":"/work/file2.txt"}' },
          meta: { diffs: [{ path: '/work/file2.txt', oldText: null, newText: '2' }] },
        }),
      ]))
    })

    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as unknown as BoardInstance

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()

    // ConversationBody shows strip
    const strip = panel.container.querySelector('[data-board-artifacts-strip]')
    expect(strip).not.toBeNull()
    expect(strip?.textContent).toContain('2')

    // Click toggle button on strip
    const toggle = strip?.querySelector('[data-board-action="artifacts-strip-toggle"]') as Element
    expect(toggle).not.toBeNull()
    fireEvent.click(toggle)
    await runtime.flush()

    expect(board.store.getSnapshot().panelCollapsed).toBe(false)
    expect(board.store.getSnapshot().panelTab).toBe('artifacts')
  })

  it('rejects registering ~/.ketos and warns on filesystem root', async () => {
    let currentPath = '/home/user/.ketos'
    const prepared = await createBoardBench({
      uiWorkspace: {
        listDirectory: async (p) => {
          if (p !== undefined) currentPath = p
          return {
            path: currentPath,
            home: '/home/user',
            crumbs: [{ name: '', path: '/' }, { name: '.ketos', path: '/home/user/.ketos' }],
            entries: [],
            truncated: false,
          }
        },
        createDirectory: async () => currentPath,
      },
    })
    runtimes.add(prepared.runtime)
    const { runtime } = prepared

    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as unknown as BoardInstance

    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()

    // Open chats panel and browse folder
    fireEvent.click(panel.container.querySelector('button[aria-label="Chats"]') as Element)
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('button[aria-label="Add a folder…"]') as Element)
    await runtime.flush()

    // Try to use ~/.ketos
    fireEvent.click(panel.container.querySelector('[data-board-action="panel-use-folder"]') as Element)
    await runtime.flush()

    // Rejected: error text visible, create was NOT called
    expect(runtime.workspaces.calls.some(call => call.method === 'create')).toBe(false)
    expect(panel.container.querySelector('[data-board-row-edit="confirm-path"]')).toBeNull()

    // Navigate to root '/' via crumb
    const rootCrumb = panel.container.querySelector('[data-board-crumb-path="/"]') as Element
    expect(rootCrumb).not.toBeNull()
    fireEvent.click(rootCrumb)
    await runtime.flush()

    // Now try filesystem root '/' -> warning confirm step
    fireEvent.click(panel.container.querySelector('[data-board-action="panel-use-folder"]') as Element)
    await runtime.flush()

    const confirmRow = panel.container.querySelector('[data-board-row-edit="confirm-path"]')
    expect(confirmRow).not.toBeNull()
    expect(runtime.workspaces.calls.some(call => call.method === 'create')).toBe(false)

    // Click cancel
    fireEvent.click(confirmRow?.querySelector('[data-board-action="panel-cancel-path"]') as Element)
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-row-edit="confirm-path"]')).toBeNull()

    // Try '/' again and click confirm
    fireEvent.click(panel.container.querySelector('[data-board-action="panel-use-folder"]') as Element)
    await runtime.flush()
    const confirmBtn = panel.container.querySelector('[data-board-action="panel-confirm-path"]') as Element
    expect(confirmBtn).not.toBeNull()
    fireEvent.click(confirmBtn)
    await runtime.flush()

    expect(runtime.workspaces.calls.some(call => call.method === 'create' && (call.args[0] as { path: string }).path === '/')).toBe(true)
  })
})

describe('WindowChatsPanel list controls', () => {
  it('opens the projects level with the search field from the rail search button', async () => {
    const { prepared, panel } = await openChatsPanel({ session: {} })
    const { runtime } = prepared
    await runtime.workspaces.update((draft) => {
      draft.items = [workspaceView('ws-1', '/work/my-project', ['session-1'], 'MyProject')]
    })
    await runtime.flush()

    fireEvent.click(panel.view.getByText('MyProject'))
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-board-action="panel-collapse"]') as Element)
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-board-action="panel-rail-search"]') as Element)
    await runtime.flush()

    expect(panel.container.querySelector('[data-board-row-edit="search"] input')).not.toBeNull()
    expect(panel.view.getByText('Projects')).not.toBeNull()
  })

  it('moves a chat against its rendered neighbour while hidden rows stay in place', async () => {
    const { prepared, panel, board } = await openChatsPanel({
      session: {},
      sessionSummary: { displayTitle: 'Hidden' },
      extraSessions: [
        { id: 'session-2', displayTitle: 'Second' },
        { id: 'session-3', displayTitle: 'Third' },
      ],
    })
    const { runtime } = prepared
    runtime.workspaces.stub('insertSessionBefore', async (workspaceId, sessionId, beforeSessionId) => {
      await runtime.workspaces.update((draft) => {
        draft.items = draft.items.map((item) => {
          if (item.workspaceId !== workspaceId) return item
          const ids = item.sessionIds.filter(id => id !== sessionId)
          const at = beforeSessionId === undefined ? ids.length : ids.indexOf(beforeSessionId)
          ids.splice(at === -1 ? ids.length : at, 0, sessionId)
          return { ...item, sessionIds: ids }
        })
      })
      return runtime.workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId) as WorkspaceView
    })
    await runtime.workspaces.update((draft) => {
      draft.items = [workspaceView('ws-1', '/work/my-project', ['session-2', 'session-1', 'session-3'], 'MyProject')]
      draft.archivedSessionIds = ['session-1' as SessionId]
    })
    act(() => { board.actions.setPanelOrderBy('manual') })
    await runtime.flush()
    fireEvent.click(panel.view.getByText('MyProject'))
    await runtime.flush()

    expect(chatRowKeys(panel.container)).toEqual(['chat:session-2', 'chat:session-3'])
    fireEvent.click(panel.container.querySelectorAll('[data-board-action="panel-row-menu"]')[1] as Element)
    await runtime.flush()
    fireEvent.click(screen.getByText('Move up'))
    await runtime.flush()

    expect(runtime.workspaces.calls.find(call => call.method === 'insertSessionBefore')?.args)
      .toEqual(['ws-1', 'session-3', 'session-2'])
    expect(chatRowKeys(panel.container)).toEqual(['chat:session-3', 'chat:session-2'])
  })

  it('moves a project against the rendered groups while search hides another project', async () => {
    const { prepared, panel } = await openChatsPanel({
      session: {},
      sessionSummary: { displayTitle: 'Alpha loose' },
      extraSessions: [
        { id: 'session-2', displayTitle: 'Alpha' },
        { id: 'session-3', displayTitle: 'Beta' },
        { id: 'session-4', displayTitle: 'Alpha two' },
      ],
    })
    const { runtime } = prepared
    await runtime.workspaces.update((draft) => {
      draft.items = [
        workspaceView('ws-1', '/work/one', ['session-2'], 'One'),
        workspaceView('ws-2', '/work/two', ['session-3'], 'Two'),
        workspaceView('ws-3', '/work/three', ['session-4'], 'Three'),
      ]
    })
    await runtime.flush()

    fireEvent.click(panel.container.querySelector('[data-board-action="panel-search"]') as Element)
    await runtime.flush()
    fireEvent.change(panel.container.querySelector('[data-board-row-edit="search"] input') as Element, { target: { value: 'alpha' } })
    await runtime.flush()

    const menus = panel.container.querySelectorAll('[data-board-action="panel-project-menu"]')
    expect(menus).toHaveLength(2)
    fireEvent.click(menus[1] as Element)
    await runtime.flush()
    fireEvent.click(screen.getByText('Move up'))
    await runtime.flush()

    expect(runtime.workspaces.calls.find(call => call.method === 'insertBefore')?.args).toEqual(['ws-3', 'ws-1'])
  })

  it('offers chat move actions only while the manual order is chosen', async () => {
    const { prepared, panel, board } = await openChatsPanel({
      session: {},
      sessionSummary: { displayTitle: 'First' },
      extraSessions: [{ id: 'session-2', displayTitle: 'Second' }],
    })
    const { runtime } = prepared
    await runtime.workspaces.update((draft) => {
      draft.items = [workspaceView('ws-1', '/work/my-project', ['session-1', 'session-2'], 'MyProject')]
    })
    await runtime.flush()
    fireEvent.click(panel.view.getByText('MyProject'))
    await runtime.flush()

    fireEvent.click(panel.container.querySelector('[data-board-action="panel-row-menu"]') as Element)
    await runtime.flush()
    expect(screen.queryByText('Move up')).toBeNull()
    expect(screen.queryByText('Move down')).toBeNull()
    expect(screen.getByText('Rename')).not.toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    act(() => { board.actions.setPanelOrderBy('manual') })
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-board-action="panel-row-menu"]') as Element)
    await runtime.flush()
    expect(screen.getByText('Move up')).not.toBeNull()
    expect(screen.getByText('Move down')).not.toBeNull()
  })

  it('keeps the project level identity when the search hides its last chat', async () => {
    const { prepared, panel } = await openChatsPanel({ session: {}, sessionSummary: { displayTitle: 'Alpha' } })
    const { runtime } = prepared
    await runtime.workspaces.update((draft) => {
      draft.items = [workspaceView('ws-1', '/work/ketos', ['session-1'], 'MyProject')]
    })
    await runtime.flush()

    fireEvent.click(panel.container.querySelector('[data-board-action="panel-search"]') as Element)
    await runtime.flush()
    fireEvent.change(panel.container.querySelector('[data-board-row-edit="search"] input') as Element, { target: { value: 'Alpha' } })
    await runtime.flush()
    fireEvent.click(panel.view.getByText('MyProject'))
    await runtime.flush()

    fireEvent.click(panel.container.querySelector('[data-board-action="panel-row-menu"]') as Element)
    await runtime.flush()
    fireEvent.click(screen.getByText('Archive chat'))
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-board-row-edit="confirm"] button') as Element)
    await runtime.flush()

    expect(panel.container.querySelector('[data-board-project-path="/work/ketos"]')).not.toBeNull()
    expect(panel.container.querySelector('[data-board-action="panel-new-chat"]')).not.toBeNull()
    expect(panel.view.queryByText('Ungrouped')).toBeNull()
  })

  it('ignores a folder listing that resolves after a newer request', async () => {
    const pending: Array<(value: BoardDirectoryListing) => void> = []
    const { prepared, panel } = await openChatsPanel({
      session: {},
      uiWorkspace: {
        listDirectory: () => new Promise((resolve) => { pending.push(resolve) }),
      },
    })
    const { runtime } = prepared

    fireEvent.click(panel.container.querySelector('button[aria-label="Add a folder…"]') as Element)
    await runtime.flush()
    await act(async () => {
      pending[0]?.(listing('/root', 'root', [
        { name: 'slow', path: '/slow' },
        { name: 'fast', path: '/fast' },
      ]))
    })
    await runtime.flush()

    fireEvent.click(panel.view.getByText('slow'))
    fireEvent.click(panel.view.getByText('fast'))
    await runtime.flush()
    await act(async () => { pending[2]?.(listing('/fast', 'fast', [])) })
    await runtime.flush()
    await act(async () => { pending[1]?.(listing('/slow', 'slow', [])) })
    await runtime.flush()

    expect(panel.container.querySelector('[data-board-crumb-path="/fast"]')).not.toBeNull()
    expect(panel.container.querySelector('[data-board-crumb-path="/slow"]')).toBeNull()
  })

  it('ignores a failed folder listing that a newer request already replaced', async () => {
    const pending: Array<{ resolve: (value: BoardDirectoryListing) => void; reject: (error: Error) => void }> = []
    const { prepared, panel } = await openChatsPanel({
      session: {},
      uiWorkspace: {
        listDirectory: () => new Promise((resolve, reject) => { pending.push({ resolve, reject }) }),
      },
    })
    const { runtime } = prepared

    fireEvent.click(panel.container.querySelector('button[aria-label="Add a folder…"]') as Element)
    await runtime.flush()
    await act(async () => {
      pending[0]?.resolve(listing('/root', 'root', [
        { name: 'slow', path: '/slow' },
        { name: 'fast', path: '/fast' },
      ]))
    })
    await runtime.flush()

    fireEvent.click(panel.view.getByText('slow'))
    fireEvent.click(panel.view.getByText('fast'))
    await runtime.flush()
    await act(async () => { pending[2]?.resolve(listing('/fast', 'fast', [])) })
    await runtime.flush()
    await act(async () => { pending[1]?.reject(new Error('browse failed')) })
    await runtime.flush()

    expect(panel.container.querySelector('[data-board-crumb-path="/fast"]')).not.toBeNull()
    expect(panel.view.queryByText('Folder browsing is unavailable')).toBeNull()
  })
})
