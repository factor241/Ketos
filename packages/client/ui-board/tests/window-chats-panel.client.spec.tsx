// @vitest-environment jsdom
/**
 * Chats panel and artifacts tests:
 * - Project path display and quick actions (copy path, open folder)
 * - Artifacts tab, empty state, and settled tool-result artifacts
 * - Rail and conversation strip quick openers
 * - Path validation and isolation of ~/.ketos / filesystem roots
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent } from '@testing-library/react'
import type { ChatSnapshot, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { WindowId } from '../src/client/contract/slots.ts'
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
