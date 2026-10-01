// @vitest-environment jsdom
/**
 * Chats panel and right-panel tests:
 * - Project path display and quick actions (copy path, open folder)
 * - Right panel tabs, workspace files tree, viewers, and lane file links
 * - Path validation and isolation of ~/.ketos / filesystem roots
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import type { ChatSnapshot, ConversationNode, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { WorkspaceCreateError } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
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

function chatWith(nodes: readonly ConversationNode[]): ChatSnapshot {
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
  fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
  await prepared.runtime.flush()
  return { prepared, panel, board }
}

/** The data-row keys of the rendered chat rows, in order. */
function chatRowKeys(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('[data-row-key^="chat:"]')).map(el => el.getAttribute('data-row-key'))
}

/** One workspace listing reply in the generated remote's resolved shape. */
function level(
  entries: readonly { name: string; type?: 'file' | 'directory' | 'other' }[],
  truncated = false,
): unknown {
  return {
    ok: true,
    value: { path: '', entries: entries.map(entry => ({ type: 'file', ...entry })), truncated },
  }
}

/** One workspace failure reply. */
function readFailure(code: string, message = 'refused'): unknown {
  return { ok: false, error: { code, message } }
}

/** One text-page reply. */
function textPage(text: string): unknown {
  return {
    ok: true,
    value: { absolutePath: '', version: 'v1', offset: 1, text, lines: text.split('\n').length, eof: true },
  }
}

/** One complete-bytes reply over base64 data. */
function bytePage(data: string): unknown {
  return { ok: true, value: { absolutePath: '', version: 'v1', offset: 0, data, eof: true } }
}

/** Mount the board with one open window and its right panel revealed. */
async function openRightPanel(options: Parameters<typeof createBoardBench>[0] = {}) {
  const prepared = await createBoardBench(options)
  runtimes.add(prepared.runtime)
  await prepared.mountBoard()
  const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
  const board = prepared.runtime.storeOf('board.dock') as unknown as BoardInstance
  act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
  await prepared.runtime.flush()
  fireEvent.click(panel.container.querySelector('[data-board-action="window-right-panel"]') as Element)
  await prepared.runtime.flush()
  return { prepared, panel, board }
}

/** Open the right panel's Files tab through Home. */
function openFilesTab(panel: { container: HTMLElement }): void {
  fireEvent.click(panel.container.querySelector('[data-board-action="right-tab-add"]') as Element)
  fireEvent.click(panel.container.querySelector('[data-board-action="right-open-files"]') as Element)
}

/** Click one tree row by its absolute path. */
function clickTreeRow(panel: { container: HTMLElement }, path: string): void {
  fireEvent.click(panel.container.querySelector(`[data-board-right-path="${path}"]`) as Element)
}

/** Activate one right-panel tab by id. */
function openTab(panel: { container: HTMLElement }, tabId: string): void {
  fireEvent.click(panel.container.querySelector(`[data-board-action="right-tab"][data-board-tab-id="${tabId}"]`) as Element)
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
    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()

    // The window's own session lives in MyProject, so the tree opened it.
    expect(panel.container.querySelector('[data-board-group="ws-1"] [data-board-group-toggle="open"]')).not.toBeNull()

    // The folder's path actions live in its row menu, not in the tree.
    expect(panel.container.querySelector('[data-board-project-path]')).toBeNull()
    fireEvent.click(panel.container.querySelector('[data-board-action="panel-project-menu"]') as Element)
    await runtime.flush()
    fireEvent.click(screen.getByText('Copy path'))
    await runtime.flush()

    fireEvent.click(panel.container.querySelector('[data-board-action="panel-project-menu"]') as Element)
    await runtime.flush()
    fireEvent.click(screen.getByText('Open folder'))
    await runtime.flush()
    expect(openedPath).toBe('/work/my-project')
  })

  it('reports a refused clipboard write instead of claiming the path was copied', async () => {
    const prepared = await createBoardBench({
      session: {},
      sessionSummary: { cwd: '/work/my-project' },
    })
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    await runtime.workspaces.update((draft) => {
      draft.items = [workspaceView('ws-1', '/work/my-project', ['session-1'], 'MyProject')]
    })
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as unknown as BoardInstance
    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()
    // The window session's group opened with the panel (Т3.3).
    expect(panel.container.querySelector('[data-board-group="ws-1"] [data-board-group-toggle="open"]')).not.toBeNull()

    // A host that denies clipboard access fails the accessor itself; the panel
    // must say so rather than claiming the path was copied.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      get() { throw new Error('clipboard denied') },
    })
    try {
      fireEvent.click(panel.container.querySelector('[data-board-action="panel-project-menu"]') as Element)
      await runtime.flush()
      fireEvent.click(screen.getByText('Copy path'))
      await runtime.flush()
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard')
    }

    expect(panel.container.textContent).toContain('Could not copy the path')
  })

  it('reports a refused system picker on the browse-failed fallback', async () => {
    const prepared = await createBoardBench({
      session: {},
      sessionSummary: { cwd: '/work/my-project' },
      uiWorkspace: {
        listDirectory: async () => { throw new Error('listing refused') },
        pickDirectory: async () => { throw new Error('picker refused') },
      },
    })
    runtimes.add(prepared.runtime)
    await prepared.mountBoard()
    const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = prepared.runtime.storeOf('board.dock') as unknown as BoardInstance
    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await prepared.runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await prepared.runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-board-action="panel-add-folder"]') as Element)
    await prepared.runtime.flush()

    // The listing is unavailable, so the level offers the host chooser; a
    // refused chooser must be said out loud, not swallowed.
    const pick = panel.container.querySelector('[data-board-action="panel-pick-system"]') as Element
    expect(pick).not.toBeNull()
    fireEvent.click(pick)
    await prepared.runtime.flush()

    expect(panel.container.textContent).toContain('Could not choose a folder in the system')
  })

  it('localizes the host refusal of a runtime path picked through the native fallback', async () => {
    const prepared = await createBoardBench({
      session: {},
      sessionSummary: { cwd: '/work/my-project' },
      uiWorkspace: {
        listDirectory: async () => { throw new Error('listing refused') },
        pickDirectory: async () => '/home/user/.ketos',
      },
    })
    runtimes.add(prepared.runtime)
    const { runtime } = prepared
    // The host refuses the runtime home with its structured code; the panel must
    // show its own localized text rather than the server's English message.
    runtime.workspaces.stub('create', async () => {
      throw new WorkspaceCreateError(
        new RemoteError('workspace/invalid-path', 'Host refusal: /home/user/.ketos is a runtime directory', {
          path: '/home/user/.ketos',
        }),
      )
    })
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as unknown as BoardInstance
    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-board-action="panel-add-folder"]') as Element)
    await runtime.flush()

    const pick = panel.container.querySelector('[data-board-action="panel-pick-system"]') as Element
    expect(pick).not.toBeNull()
    fireEvent.click(pick)
    await runtime.flush()

    expect(runtime.workspaces.calls.some(call => call.method === 'create'
      && (call.args[0] as { path: string }).path === '/home/user/.ketos')).toBe(true)
    expect(panel.container.textContent).toContain('Cannot use Ketos home directory as a workspace: /home/user/.ketos')
    expect(panel.container.textContent).not.toContain('Host refusal')
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
    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
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

describe('WindowChatsPanel right panel', () => {
  it('opens Home, lists the workspace files, expands a directory, and opens a viewer tab (Т3.7)', async () => {
    const listCalls: string[] = []
    const readCalls: string[] = []
    const { prepared, panel, board } = await openRightPanel({
      session: {},
      sessionSummary: { cwd: '/work' },
      workspaceFiles: {
        list: async (_sessionId, path) => {
          listCalls.push(path)
          if (path === '/work') {
            return level([
              { name: 'src', type: 'directory' },
              { name: 'docs', type: 'directory' },
              { name: 'zfile.txt' },
              { name: 'afile.txt' },
              { name: 'pipe', type: 'other' },
            ], true)
          }
          if (path === '/work/src') return level([{ name: 'main.ts' }])
          return level([])
        },
        read: async (_sessionId, path) => { readCalls.push(path); return textPage(`content of ${path}`) },
      },
    })
    const { runtime } = prepared

    // A session without tabs shows the quiet line; `+` adds Home, twice adds
    // nothing further because the open tab is activated instead.
    expect(panel.container.querySelector('[data-board-right-empty]')).not.toBeNull()
    const add = panel.container.querySelector('[data-board-action="right-tab-add"]') as Element
    fireEvent.click(add)
    fireEvent.click(add)
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-right-home]')).not.toBeNull()
    expect(panel.container.querySelectorAll('[data-board-action="right-tab"]')).toHaveLength(1)
    const homeChip = panel.container.querySelector('[data-board-action="right-tab"]') as HTMLElement
    expect(homeChip.getAttribute('data-board-tab-id')).toBe('home')
    expect(homeChip.getAttribute('data-board-tab-kind')).toBe('home')
    expect(homeChip.getAttribute('aria-selected')).toBe('true')

    // «Файлы рабочей области» opens the Files tab and lists the root.
    fireEvent.click(panel.container.querySelector('[data-board-action="right-open-files"]') as Element)
    await runtime.flush()
    expect(listCalls).toEqual(['/work'])
    const pathRow = panel.container.querySelector('[data-board-right-files-path]') as HTMLElement
    expect(pathRow.textContent).toBe('/work')
    expect(pathRow.getAttribute('title')).toBe('/work')
    expect(panel.container.querySelector('[data-board-action="right-files-reload"]')).not.toBeNull()
    expect(panel.container.querySelector('[data-board-right-row="truncated"]')?.textContent)
      .toContain('The listing was truncated')
    expect(Array.from(panel.container.querySelectorAll('[data-board-right-entry="directory"]'))
      .map(element => element.getAttribute('data-board-right-path'))).toEqual(['/work/docs', '/work/src'])
    expect(Array.from(panel.container.querySelectorAll('[data-board-right-entry="file"]'))
      .map(element => element.getAttribute('data-board-right-path'))).toEqual(['/work/afile.txt', '/work/zfile.txt'])
    expect(panel.container.querySelector('[data-board-right-entry="other"]')).not.toBeNull()

    // Expanding a directory lists it once and shows its file row.
    clickTreeRow(panel, '/work/src')
    await runtime.flush()
    expect(listCalls).toEqual(['/work', '/work/src'])
    expect(panel.container.querySelector('[data-board-right-path="/work/src/main.ts"]')).not.toBeNull()

    // A file row opens the viewer tab and reads through the text mode.
    clickTreeRow(panel, '/work/src/main.ts')
    await runtime.flush()
    expect(readCalls).toEqual(['/work/src/main.ts'])
    expect(panel.container.querySelector('[data-board-right-viewer="text"]')?.textContent)
      .toBe('content of /work/src/main.ts')
    expect(board.store.getSnapshot().rightPanels['session-1']?.tabs.map(tab => tab.id))
      .toContain('viewer:/work/src/main.ts')
  })

  it('activates an open viewer tab instead of duplicating it (Т3.11)', async () => {
    const { prepared, panel } = await openRightPanel({
      session: {},
      sessionSummary: { cwd: '/work' },
      workspaceFiles: {
        list: async () => level([{ name: 'a.txt' }]),
        read: async () => textPage('a'),
      },
    })
    const { runtime } = prepared
    openFilesTab(panel)
    await runtime.flush()
    clickTreeRow(panel, '/work/a.txt')
    await runtime.flush()

    // Back to the tree, then open the same path again: the viewer tab is
    // activated, not duplicated.
    openTab(panel, 'files')
    await runtime.flush()
    clickTreeRow(panel, '/work/a.txt')
    await runtime.flush()
    const viewerChips = panel.container.querySelectorAll('[data-board-action="right-tab"][data-board-tab-kind="viewer"]')
    expect(viewerChips).toHaveLength(1)
    expect(viewerChips[0]?.getAttribute('data-board-tab-id')).toBe('viewer:/work/a.txt')
    expect(viewerChips[0]?.getAttribute('aria-selected')).toBe('true')
    expect(panel.container.querySelectorAll('[data-board-action="right-tab"]')).toHaveLength(3)
  })

  it('renders each viewer by type and reports a refused read (Т3.7)', async () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:viewer' })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} })
    const readCalls: string[] = []
    const readAllCalls: string[] = []
    const { prepared, panel } = await openRightPanel({
      session: {},
      sessionSummary: { cwd: '/work' },
      workspaceFiles: {
        list: async () => level([
          { name: 'chart.png' },
          { name: 'manual.pdf' },
          { name: 'notes.md' },
          { name: 'plain.txt' },
          { name: 'Makefile' },
          { name: 'bad.txt' },
        ]),
        read: async (_sessionId, path) => {
          readCalls.push(path)
          if (path === '/work/bad.txt') return readFailure('workspace-file/not-found', 'gone')
          if (path === '/work/notes.md') return textPage('# Title')
          return textPage(`text:${path}`)
        },
        readAll: async (_sessionId, path) => {
          readAllCalls.push(path)
          return bytePage(btoa(path === '/work/manual.pdf' ? '%PDF' : 'PNG'))
        },
      },
    })
    const { runtime } = prepared
    openFilesTab(panel)
    await runtime.flush()

    clickTreeRow(panel, '/work/chart.png')
    await runtime.flush()
    const image = panel.container.querySelector('[data-board-right-viewer="image"]') as HTMLImageElement
    expect(image.tagName).toBe('IMG')
    expect(image.getAttribute('src')).toBe('blob:viewer')

    openTab(panel, 'files')
    await runtime.flush()
    clickTreeRow(panel, '/work/manual.pdf')
    await runtime.flush()
    const frame = panel.container.querySelector('[data-board-right-viewer="pdf"]') as HTMLIFrameElement
    expect(frame.tagName).toBe('IFRAME')
    expect(frame.getAttribute('title')).toBe('manual.pdf')
    expect(readAllCalls).toEqual(['/work/chart.png', '/work/manual.pdf'])

    openTab(panel, 'files')
    await runtime.flush()
    clickTreeRow(panel, '/work/notes.md')
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-right-viewer="markdown"]')?.textContent).toContain('Title')

    openTab(panel, 'files')
    await runtime.flush()
    clickTreeRow(panel, '/work/plain.txt')
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-right-viewer="text"]')?.textContent).toBe('text:/work/plain.txt')

    openTab(panel, 'files')
    await runtime.flush()
    clickTreeRow(panel, '/work/Makefile')
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-right-viewer="text"]')?.textContent).toBe('text:/work/Makefile')

    openTab(panel, 'files')
    await runtime.flush()
    clickTreeRow(panel, '/work/bad.txt')
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-right-viewer="failed"]')?.textContent)
      .toBe('The file or folder does not exist')
    expect(readCalls).toEqual(['/work/notes.md', '/work/plain.txt', '/work/Makefile', '/work/bad.txt'])
  })

  it('falls back to a text read when no preview implementation matches a path', async () => {
    const readAllCalls: string[] = []
    const { prepared, panel } = await openRightPanel({
      session: {},
      sessionSummary: { cwd: '/work' },
      documentPreviews: { candidates: () => [] },
      workspaceFiles: {
        list: async () => level([{ name: 'a.weird' }]),
        read: async () => textPage('fallback'),
        readAll: async (_sessionId, path) => { readAllCalls.push(path); return bytePage('') },
      },
    })
    const { runtime } = prepared
    openFilesTab(panel)
    await runtime.flush()
    clickTreeRow(panel, '/work/a.weird')
    await runtime.flush()
    expect(readAllCalls).toEqual([])
    expect(panel.container.querySelector('[data-board-right-viewer="text"]')?.textContent).toBe('fallback')
  })

  it('declines a bytes read for a viewer that has no byte renderer', async () => {
    const { prepared, panel } = await openRightPanel({
      session: {},
      sessionSummary: { cwd: '/work' },
      documentPreviews: {
        candidates: () => [{
          id: 'bytes', extensions: ['txt'], priority: 'builtin', title: () => 'Bytes', loading: 'bytes-complete',
        }],
      },
      workspaceFiles: {
        list: async () => level([{ name: 'a.txt' }]),
        readAll: async () => bytePage(btoa('x')),
      },
    })
    const { runtime } = prepared
    openFilesTab(panel)
    await runtime.flush()
    clickTreeRow(panel, '/work/a.txt')
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-right-viewer="failed"]')?.textContent)
      .toBe('This file could not be displayed')
  })

  it('keeps tabs per session and switches them with the window session (Т3.11)', async () => {
    const { prepared, panel, board } = await openRightPanel({
      session: {},
      sessionSummary: { cwd: '/work/one', displayTitle: 'One' },
      extraSessions: [{ id: 'session-2', displayTitle: 'Two', summary: { cwd: '/work/two' } }],
    })
    const { runtime } = prepared
    await runtime.workspaces.update((draft) => {
      draft.items = [workspaceView('ws-1', '/work/one', ['session-1', 'session-2'], 'One')]
    })
    await runtime.flush()

    fireEvent.click(panel.container.querySelector('[data-board-action="right-tab-add"]') as Element)
    await runtime.flush()
    expect(board.store.getSnapshot().rightPanels['session-1']?.tabs.map(tab => tab.id)).toEqual(['home'])

    // Point the window at the second chat: the panel shows that session's
    // (empty) tab set.
    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-row-key="chat:session-2"]') as Element)
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-right-empty]')).not.toBeNull()
    expect(panel.container.querySelector('[data-board-tab-id="home"]')).toBeNull()

    // The second session gets its own Home tab.
    fireEvent.click(panel.container.querySelector('[data-board-action="right-tab-add"]') as Element)
    await runtime.flush()
    expect(board.store.getSnapshot().rightPanels['session-2']?.tabs.map(tab => tab.id)).toEqual(['home'])

    // Switching back restores the first session's tabs.
    fireEvent.click(panel.container.querySelector('[data-row-key="chat:session-1"]') as Element)
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-right-empty]')).toBeNull()
    expect(panel.container.querySelector('[data-board-tab-id="home"]')).not.toBeNull()
  })

  it('opens files from the artifacts strip, tool cards, and message mentions (Т3.10)', async () => {
    const readCalls: string[] = []
    const prepared = await createBoardBench({
      session: {},
      sessionSummary: { cwd: '/work' },
      workspaceFiles: {
        read: async (_sessionId, path) => { readCalls.push(path); return textPage('body') },
      },
    })
    runtimes.add(prepared.runtime)
    const { runtime, chat } = prepared
    act(() => {
      chat.set(chatWith([
        toolNode({
          seq: 1,
          call: { name: 'write', argsRaw: '{"file_path":"/work/artifact.txt"}' },
          meta: { diffs: [{ path: '/work/artifact.txt', oldText: null, newText: 'x' }] },
        }),
        toolNode({
          seq: 2,
          call: { name: 'read', argsRaw: '{"file_path":"/work/tool.txt"}' },
          meta: { path: '/work/tool.txt', lines: [{ number: 1, text: 'x' }], totalLines: 1 },
        }),
        {
          kind: 'assistant',
          seq: 3,
          time: 0,
          turn: 1,
          step: 1,
          blocks: [{ kind: 'text', text: 'See `/work/note.md` now.' }],
        },
      ]))
    })
    await prepared.mountBoard()
    const panel = runtime.renderSlot('main', {}, { entryKey: 'board' })
    const board = runtime.storeOf('board.dock') as unknown as BoardInstance
    act(() => { board.actions.openWindow(windowState({ id: 'a1' as WindowId })) })
    await runtime.flush()

    // The artifacts strip's chip opens a viewer tab and reveals the panel.
    fireEvent.click(panel.container.querySelector('[data-board-action="artifact-open"][data-board-artifact="/work/artifact.txt"]') as Element)
    await runtime.flush()
    expect(board.store.getSnapshot().windows['a1']?.rightPanelOpen).toBe(true)
    expect(board.store.getSnapshot().rightPanels['session-1']?.tabs.map(tab => tab.id))
      .toContain('viewer:/work/artifact.txt')
    expect(panel.container.querySelector('[data-board-right-viewer="text"]')?.textContent).toBe('body')

    // The tool card's file chip opens the file it names.
    fireEvent.click(panel.container.querySelector('[data-board-action="tool-open-file"][data-board-file-path="/work/tool.txt"]') as Element)
    await runtime.flush()
    expect(board.store.getSnapshot().rightPanels['session-1']?.activeTabId).toBe('viewer:/work/tool.txt')

    // An inline path mention in a message renders an open control.
    const mention = panel.container.querySelector('button[title="/work/note.md"]') as Element
    expect(mention).not.toBeNull()
    expect(mention.getAttribute('aria-label')).toBe('Open file /work/note.md')
    fireEvent.click(mention)
    await runtime.flush()
    expect(board.store.getSnapshot().rightPanels['session-1']?.activeTabId).toBe('viewer:/work/note.md')
    expect(readCalls).toContain('/work/note.md')
  })

  it('reloads expanded levels and ignores answers a replaced request already settled', async () => {
    const listCalls: string[] = []
    const pending: { path: string; resolve: (reply: unknown) => void }[] = []
    const { prepared, panel } = await openRightPanel({
      session: {},
      sessionSummary: { cwd: '/work' },
      workspaceFiles: {
        list: (_sessionId, path) => {
          listCalls.push(path)
          return new Promise((resolve) => { pending.push({ path, resolve }) })
        },
      },
    })
    const { runtime } = prepared
    openFilesTab(panel)
    await runtime.flush()

    // The root level paints its loading line until its listing settles.
    expect(panel.container.querySelector('[data-board-right-row="loading"]')).not.toBeNull()
    await act(async () => { pending[0]?.resolve(level([{ name: 'dir', type: 'directory' }])) })
    await runtime.flush()
    clickTreeRow(panel, '/work/dir')
    await runtime.flush()
    expect(listCalls).toEqual(['/work', '/work/dir'])

    // Reload drops the levels and asks for the expanded ones again.
    fireEvent.click(panel.container.querySelector('[data-board-action="right-files-reload"]') as Element)
    await runtime.flush()
    expect(listCalls).toEqual(['/work', '/work/dir', '/work', '/work/dir'])

    // The answer the reload replaced settles late: it paints nothing.
    await act(async () => { pending[1]?.resolve(level([{ name: 'stale.txt' }])) })
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-right-path="/work/dir/stale.txt"]')).toBeNull()

    await act(async () => {
      pending[2]?.resolve(level([{ name: 'dir', type: 'directory' }]))
      pending[3]?.resolve(level([{ name: 'fresh.txt' }]))
    })
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-right-path="/work/dir/fresh.txt"]')).not.toBeNull()

    // Closing the tab unmounts the tree; a listing still in flight settles
    // into nothing.
    fireEvent.click(panel.container.querySelector('[data-board-action="right-files-reload"]') as Element)
    await runtime.flush()
    const filesChip = panel.container.querySelector('[data-board-tab-id="files"]') as HTMLElement
    fireEvent.click(filesChip.parentElement?.querySelector('[data-board-action="right-tab-close"]') as Element)
    await runtime.flush()
    await act(async () => { pending[4]?.resolve(level([{ name: 'gone.txt' }])) })
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-right-path="/work/gone.txt"]')).toBeNull()
  })

  it('never paints a read that settled after its tab was switched away', async () => {
    const pendingReads: ((reply: unknown) => void)[] = []
    const { prepared, panel } = await openRightPanel({
      session: {},
      sessionSummary: { cwd: '/work' },
      workspaceFiles: {
        list: async () => level([{ name: 'a.txt' }]),
        read: () => new Promise((resolve) => { pendingReads.push(resolve) }),
      },
    })
    const { runtime } = prepared
    openFilesTab(panel)
    await runtime.flush()
    clickTreeRow(panel, '/work/a.txt')
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-right-viewer="loading"]')).not.toBeNull()

    // Switching to the files tab aborts the read; its late answer paints
    // nothing, and returning to the viewer tab reads again.
    openTab(panel, 'files')
    await runtime.flush()
    await act(async () => { pendingReads[0]?.(textPage('stale')) })
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-right-viewer]')).toBeNull()

    openTab(panel, 'viewer:/work/a.txt')
    await runtime.flush()
    await act(async () => { pendingReads[1]?.(textPage('fresh')) })
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-right-viewer="text"]')?.textContent).toBe('fresh')

    // Closing the active viewer tab activates the files tab.
    const viewerChip = panel.container.querySelector('[data-board-tab-id="viewer:/work/a.txt"]') as HTMLElement
    fireEvent.click(viewerChip.parentElement?.querySelector('[data-board-action="right-tab-close"]') as Element)
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-right-files]')).not.toBeNull()
    expect(panel.container.querySelector('[data-board-right-viewer]')).toBeNull()
  })

  it('localizes workspace failures in the tree and the viewer', async () => {
    const listCalls: string[] = []
    const { prepared, panel } = await openRightPanel({
      session: {},
      sessionSummary: { cwd: '/work' },
      workspaceFiles: {
        list: async (_sessionId, path) => {
          listCalls.push(path)
          if (path === '/work') {
            return level([
              { name: 'a', type: 'directory' },
              { name: 'b', type: 'directory' },
              { name: 'c', type: 'directory' },
              { name: 'empty', type: 'directory' },
              { name: 'bad.txt' },
            ])
          }
          if (path === '/work/a') return readFailure('workspace-file/not-found')
          if (path === '/work/b') return readFailure('workspace-file/outside-workspace')
          if (path === '/work/c') return readFailure('workspace-file/not-directory')
          return level([])
        },
        read: async () => readFailure('gateway/internal', 'boom'),
      },
    })
    const { runtime } = prepared
    openFilesTab(panel)
    await runtime.flush()
    clickTreeRow(panel, '/work/a')
    clickTreeRow(panel, '/work/b')
    clickTreeRow(panel, '/work/c')
    clickTreeRow(panel, '/work/empty')
    await runtime.flush()

    expect(listCalls).toEqual(['/work', '/work/a', '/work/b', '/work/c', '/work/empty'])
    const failed = Array.from(panel.container.querySelectorAll('[data-board-right-row="failed"]'))
    expect(failed.map(element => element.textContent)).toEqual([
      'The file or folder does not exist',
      'The path is outside the workspace',
      'That path is not a folder',
    ])
    expect(panel.container.querySelector('[data-board-right-row="empty"]')?.textContent)
      .toBe('This folder is empty')

    clickTreeRow(panel, '/work/bad.txt')
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-right-viewer="failed"]')?.textContent)
      .toBe('Unavailable: boom')
  })
})

describe('WindowChatsPanel list controls', () => {
  it('auto-expands the group of the window\'s current session without a counter', async () => {
    const { prepared, panel } = await openChatsPanel({
      session: {},
      sessionSummary: { displayTitle: 'Current' },
      extraSessions: [{ id: 'session-2', displayTitle: 'Sibling' }],
    })
    const { runtime } = prepared
    await runtime.workspaces.update((draft) => {
      draft.items = [workspaceView('ws-1', '/work/my-project', ['session-1', 'session-2'], 'MyProject')]
    })
    await runtime.flush()

    const group = panel.container.querySelector('[data-board-group="ws-1"]')
    expect(group).not.toBeNull()
    expect(group?.querySelector('[data-board-group-toggle="open"]')).not.toBeNull()
    expect(chatRowKeys(panel.container).sort()).toEqual(['chat:session-1', 'chat:session-2'])
    // The sidebar shows no chat count beside a folder, and neither does the panel.
    expect(group?.querySelector('[data-board-group-toggle]')?.textContent).toBe('MyProject')
  })

  it('keeps a manually expanded group when the board remounts', async () => {
    const { prepared, panel, board } = await openChatsPanel({
      session: {},
      sessionSummary: { displayTitle: 'Loose' },
      extraSessions: [{ id: 'session-2', displayTitle: 'Second' }],
    })
    const { runtime } = prepared
    await runtime.workspaces.update((draft) => {
      draft.items = [
        workspaceView('ws-1', '/work/one', ['session-1'], 'One'),
        workspaceView('ws-2', '/work/two', ['session-2'], 'Two'),
      ]
    })
    await runtime.flush()

    // The window's own session lives in ws-1, so only ws-2 needs the click.
    fireEvent.click(panel.container.querySelector('[data-board-group="ws-2"] [data-board-group-toggle]') as Element)
    await runtime.flush()
    expect(board.store.getSnapshot().panelExpandedGroups).toContain('ws-2')

    // Switching the main panel away unmounts the board's React tree while the
    // plugin — and its store — stays; a freshly mounted board tree must return
    // the tree as it was left, from the store rather than component state.
    const fresh = runtime.renderRoot()
    try {
      expect(fresh.container.querySelector('[data-board-group="ws-2"] [data-board-group-toggle="open"]')).not.toBeNull()
      expect(fresh.container.querySelector('[data-board-group="ws-1"] [data-board-group-toggle="open"]')).not.toBeNull()
    } finally {
      fresh.unmount()
    }
  })

  it('keeps the folder tree and opens the search field from the panel header', async () => {
    const { prepared, panel } = await openChatsPanel({ session: {} })
    const { runtime } = prepared
    await runtime.workspaces.update((draft) => {
      draft.items = [workspaceView('ws-1', '/work/my-project', ['session-1'], 'MyProject')]
    })
    await runtime.flush()

    // The window session's group is open from the start; collapsing and
    // reopening the panel keeps the same tree.
    fireEvent.click(panel.container.querySelector('[data-board-action="panel-collapse"]') as Element)
    await runtime.flush()
    // The window header control is the only way back in; the panel returns to
    // the same tree, and its own search control opens the field.
    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-board-action="panel-search"]') as Element)
    await runtime.flush()

    expect(panel.container.querySelector('[data-board-row-edit="search"] input')).not.toBeNull()
    expect(panel.view.getByText('Working folders')).not.toBeNull()
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
    // The window session's group opened itself; the rows are on screen.
    expect(chatRowKeys(panel.container).length).toBe(2)

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
    // The window session's group stays open under the filter.
    expect(panel.container.querySelector('[data-board-group="ws-1"] [data-board-group-toggle="open"]')).not.toBeNull()

    fireEvent.click(panel.container.querySelector('[data-board-action="panel-row-menu"]') as Element)
    await runtime.flush()
    fireEvent.click(screen.getByText('Archive chat'))
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-board-row-edit="confirm"] button') as Element)
    await runtime.flush()

    // The tree keeps the folder's identity after its last visible chat leaves:
    // the folder row and its new-chat control stay.
    expect(panel.container.querySelector('[data-board-group="ws-1"]')).not.toBeNull()
    expect(panel.container.querySelector('[data-board-action="panel-new-chat"]')).not.toBeNull()
    expect(panel.view.getByText('MyProject')).not.toBeNull()
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
