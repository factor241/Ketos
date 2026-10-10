// @vitest-environment jsdom
/**
 * Live Files tab of a board window's right panel, driven through the stream
 * double: one directory observation per shown level, a frame re-listing only
 * its own level while the tree stays on screen, observations ending with the
 * level, the tab, the session, the closed panel, and the board, and a failed
 * observation or a failed background re-list leaving a caption that names the
 * folder beside Reload while the listed rows stay.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent } from '@testing-library/react'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { WindowId } from '../src/client/contract/slots.ts'
import { createBoardStore } from '../src/client/store.ts'
import { createBoardBench, createWatchDouble } from './fixtures.client.ts'

type BoardInstance = ReturnType<ReturnType<typeof createBoardStore>['create']>

const runtimes = new Set<{ dispose: () => Promise<void> }>()
afterEach(async () => {
  cleanup()
  for (const runtime of runtimes) await runtime.dispose()
  runtimes.clear()
})

/** One directory's entries as the scripted listing serves them. */
type Entries = readonly { readonly name: string; readonly type?: 'file' | 'directory'; readonly size?: number }[]

/**
 * Scripted `workspaceFiles.list` over a mutable tree: every call is recorded,
 * and while a gate is set each answer waits for it, then reads the tree — or
 * answers the failure scripted for the path.
 */
function listingDouble(initial: Record<string, Entries>) {
  const tree: Record<string, Entries> = { ...initial }
  const failures: Record<string, { readonly code: string; readonly message: string }> = {}
  const calls: string[] = []
  let answered = 0
  let gate: Promise<void> | undefined
  const list = async (_sessionId: SessionId, path: string): Promise<unknown> => {
    calls.push(path)
    if (gate !== undefined) await gate
    answered += 1
    const failure = failures[path]
    if (failure !== undefined) return { ok: false, error: failure }
    return {
      ok: true,
      value: { path: '', entries: (tree[path] ?? []).map(entry => ({ type: 'file', ...entry })), truncated: false },
    }
  }
  return {
    tree,
    failures,
    calls,
    list,
    /** How many listings have answered. */
    answered: (): number => answered,
    /** Hold every answer until the returned release runs. */
    hold: (): (() => void) => {
      const held = Promise.withResolvers<undefined>()
      gate = held.promise.then(() => undefined)
      return () => {
        gate = undefined
        held.resolve(undefined)
      }
    },
  }
}

/** One workspace view with the fields the chats panel reads. */
function workspaceView(id: string, path: string, sessionIds: readonly string[], title: string): WorkspaceView {
  return {
    workspaceId: id as WorkspaceId,
    path,
    title,
    sessionIds: sessionIds.map(sessionId => sessionId as SessionId),
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }
}

/** Mount the board with one window over session `/work`, its right panel open on the Files tab. */
async function openFiles(
  listing: ReturnType<typeof listingDouble>,
  watches: ReturnType<typeof createWatchDouble>,
  options: Partial<Parameters<typeof createBoardBench>[0]> = {},
) {
  const prepared = await createBoardBench({
    session: {},
    sessionSummary: { cwd: '/work', displayTitle: 'One' },
    workspaceFiles: { list: listing.list, changes: watches.changes },
    ...options,
  })
  runtimes.add(prepared.runtime)
  await prepared.mountBoard()
  const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
  const board = prepared.runtime.storeOf('board.dock') as BoardInstance
  act(() => {
    board.actions.openWindow({
      id: 'a1' as WindowId, kind: 'agent', bodyKind: 'conversation', ordinal: 1, width: 552, height: 648,
    })
  })
  await prepared.runtime.flush()
  fireEvent.click(panel.container.querySelector('[data-board-action="window-right-panel"]') as Element)
  fireEvent.click(panel.container.querySelector('[data-board-action="right-tab-add"]') as Element)
  fireEvent.click(panel.container.querySelector('[data-board-action="right-open-files"]') as Element)
  await prepared.runtime.flush()
  return { runtime: prepared.runtime, panel, board }
}

/** The absolute paths of the tree's rows, in display order. */
function rowPaths(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll('[data-board-right-entry]')].map(row => row.getAttribute('data-board-right-path'))
}

/** Click one tree row by its absolute path. */
function clickRow(container: HTMLElement, path: string): void {
  fireEvent.click(container.querySelector(`[data-board-right-path="${path}"]`) as Element)
}

describe('live Files tab', () => {
  it('re-lists only the level whose observation reports a change, keeping the tree on screen', async () => {
    const listing = listingDouble({
      '/work': [{ name: 'shared', type: 'directory' }, { name: 'notes.md' }],
      '/work/shared': [{ name: 'a.txt' }],
    })
    const watches = createWatchDouble()
    const { runtime, panel } = await openFiles(listing, watches)
    expect(watches.active()).toEqual(['/work'])
    clickRow(panel.container, '/work/shared')
    await runtime.flush()
    expect(watches.active()).toEqual(['/work', '/work/shared'])
    expect(listing.calls).toEqual(['/work', '/work/shared'])

    // The opening frame re-lists its level once: a change between the first
    // listing and the observation becoming active is not lost.
    watches.of('/work/shared').push({ kind: 'ready' })
    await vi.waitFor(() => { expect(listing.calls).toEqual(['/work', '/work/shared', '/work/shared']) })

    // Another process adds a file inside the expanded folder.
    const release = listing.hold()
    listing.tree['/work/shared'] = [{ name: 'a.txt' }, { name: 'b.txt' }]
    watches.of('/work/shared').push({ kind: 'change', change: { absolutePath: '/work/shared/b.txt', version: 'v2' } })
    await vi.waitFor(() => { expect(listing.calls).toHaveLength(4) })
    expect(listing.calls[3]).toBe('/work/shared')
    await runtime.flush()
    // While the listing is in flight the tree keeps its rows and paints no loading line.
    expect(panel.container.querySelector('[data-board-right-row="loading"]')).toBeNull()
    expect(rowPaths(panel.container)).toEqual(['/work/shared', '/work/shared/a.txt', '/work/notes.md'])

    await act(async () => { release() })
    await vi.waitFor(() => {
      expect(rowPaths(panel.container))
        .toEqual(['/work/shared', '/work/shared/a.txt', '/work/shared/b.txt', '/work/notes.md'])
    })
    // The root was never asked again.
    expect(listing.calls.filter(path => path === '/work')).toHaveLength(1)
  })

  it('folds frames that arrive during a listing into one more listing', async () => {
    const listing = listingDouble({ '/work': [{ name: 'one.txt' }] })
    const watches = createWatchDouble()
    const { panel } = await openFiles(listing, watches)
    const release = listing.hold()
    const root = watches.of('/work')
    root.push({ kind: 'ready' })
    await vi.waitFor(() => { expect(listing.calls).toEqual(['/work', '/work']) })
    listing.tree['/work'] = [{ name: 'one.txt' }, { name: 'two.txt' }]
    for (const name of ['two.txt', 'three.tmp', 'two.txt']) {
      root.push({ kind: 'change', change: { absolutePath: `/work/${name}`, version: name } })
    }
    // Every frame reaches the panel while the listing is still held.
    await vi.waitFor(() => { expect(root.handled()).toBe(4) })
    expect(listing.calls).toEqual(['/work', '/work'])

    await act(async () => { release() })
    await vi.waitFor(() => { expect(rowPaths(panel.container)).toEqual(['/work/one.txt', '/work/two.txt']) })
    expect(listing.calls).toEqual(['/work', '/work', '/work'])
  })

  it('observes a folder while it is expanded and ends observations with the folder and the tab', async () => {
    const listing = listingDouble({
      '/work': [{ name: 'shared', type: 'directory' }],
      '/work/shared': [{ name: 'deep', type: 'directory' }],
      '/work/shared/deep': [],
    })
    const watches = createWatchDouble()
    const { runtime, panel } = await openFiles(listing, watches)
    clickRow(panel.container, '/work/shared')
    await runtime.flush()
    clickRow(panel.container, '/work/shared/deep')
    await runtime.flush()
    expect(watches.active()).toEqual(['/work', '/work/shared', '/work/shared/deep'])

    // Collapsing a folder ends its observation and the observations below it.
    clickRow(panel.container, '/work/shared')
    await runtime.flush()
    expect(watches.active()).toEqual(['/work'])
    // A re-render of the tree opens nothing new.
    expect(watches.opened).toHaveLength(3)

    // Expanding it again observes the folder and the subfolder it restores.
    clickRow(panel.container, '/work/shared')
    await runtime.flush()
    expect(watches.active()).toEqual(['/work', '/work/shared', '/work/shared/deep'])

    // Closing the Files tab ends every observation of the tab.
    const filesChip = panel.container.querySelector('[data-board-action="right-tab"][data-board-tab-id="files"]')
    fireEvent.click(filesChip?.parentElement?.querySelector('[data-board-action="right-tab-close"]') as Element)
    await runtime.flush()
    expect(watches.active()).toEqual([])
    await vi.waitFor(() => { expect(watches.opened.every(watch => watch.closed())).toBe(true) })
  })

  it('ends the observations when the window moves to another session, the panel closes, or the board goes', async () => {
    const listing = listingDouble({ '/work': [], '/other': [] })
    const watches = createWatchDouble()
    const { runtime, panel } = await openFiles(listing, watches, {
      extraSessions: [{ id: 'session-2', displayTitle: 'Two', summary: { cwd: '/other' } }],
    })
    await runtime.workspaces.update((draft) => {
      draft.items = [workspaceView('ws-1', '/work', ['session-1', 'session-2'], 'Work')]
    })
    await runtime.flush()
    expect(watches.active()).toEqual(['/work'])

    // The window shows another chat: the first session's tab stops observing.
    fireEvent.click(panel.container.querySelector('[data-board-action="window-left-panel"]') as Element)
    await runtime.flush()
    fireEvent.click(panel.container.querySelector('[data-row-key="chat:session-2"]') as Element)
    await runtime.flush()
    expect(watches.active()).toEqual([])

    // Back on the first chat, the Files tab observes its root again.
    fireEvent.click(panel.container.querySelector('[data-row-key="chat:session-1"]') as Element)
    await runtime.flush()
    expect(watches.active()).toEqual(['/work'])
    expect(watches.of('/work').sessionId).toBe('session-1')

    // A collapsed panel stops observing; reopening it observes again.
    fireEvent.click(panel.container.querySelector('[data-board-action="panel-collapse-right"]') as Element)
    await runtime.flush()
    expect(watches.active()).toEqual([])
    fireEvent.click(panel.container.querySelector('[data-board-action="window-right-panel"]') as Element)
    await runtime.flush()
    expect(watches.active()).toEqual(['/work'])

    // Unmounting the board leaves no observation open.
    for (const runtime of runtimes) await runtime.dispose()
    runtimes.clear()
    expect(watches.active()).toEqual([])
    await vi.waitFor(() => { expect(watches.opened.every(watch => watch.closed())).toBe(true) })
  })

  it('shows the caption beside Reload when an observation fails, and Reload observes again', async () => {
    const listing = listingDouble({ '/work': [{ name: 'a.txt' }] })
    const watches = createWatchDouble()
    const { runtime, panel } = await openFiles(listing, watches)
    const caption = (): Element | null => panel.container.querySelector('[data-board-right-files-watch="failed"]')
    expect(caption()).toBeNull()

    watches.of('/work').fail(new RemoteError('workspace-file/watch-unsupported', 'no watcher', { path: '/work' }))
    await vi.waitFor(() => { expect(caption()?.textContent).toBe('Could not watch this folder — reload manually') })
    // The tree stays as it was listed, and Reload stays offered.
    expect(rowPaths(panel.container)).toEqual(['/work/a.txt'])
    expect(panel.container.querySelector('[data-board-action="right-files-reload"]')).not.toBeNull()
    expect(watches.active()).toEqual([])

    listing.tree['/work'] = [{ name: 'a.txt' }, { name: 'b.txt' }]
    fireEvent.click(panel.container.querySelector('[data-board-action="right-files-reload"]') as Element)
    await runtime.flush()
    await vi.waitFor(() => { expect(rowPaths(panel.container)).toEqual(['/work/a.txt', '/work/b.txt']) })
    expect(watches.active()).toEqual(['/work'])
    expect(caption()).toBeNull()
  })

  it('shows the caption when an observation ends without a failure', async () => {
    const listing = listingDouble({ '/work': [] })
    const watches = createWatchDouble()
    const { panel } = await openFiles(listing, watches)
    // A host stream that simply stops leaves the level without live updates.
    const root = watches.of('/work')
    root.push({ kind: 'ready' })
    await vi.waitFor(() => { expect(listing.calls).toEqual(['/work', '/work']) })
    // The supervisor classifies the normal end as a terminal failure.
    root.end()
    await vi.waitFor(() => {
      expect(panel.container.querySelector('[data-board-right-files-watch="failed"]')).not.toBeNull()
    })
  })

  it('lets a frame or a failure in transit when its folder collapses re-list nothing and add no caption', async () => {
    const listing = listingDouble({
      '/work': [{ name: 'shared', type: 'directory' }],
      '/work/shared': [{ name: 'a.txt' }],
    })
    const watches = createWatchDouble()
    const { runtime, panel } = await openFiles(listing, watches)
    const caption = (): Element | null => panel.container.querySelector('[data-board-right-files-watch="failed"]')
    clickRow(panel.container, '/work/shared')
    await runtime.flush()
    const listed = listing.calls.length

    // A change sent before the collapse is delivered after it.
    const first = watches.of('/work/shared')
    first.push({ kind: 'change', change: { absolutePath: '/work/shared/b.txt', version: 'v2' } })
    clickRow(panel.container, '/work/shared')
    await vi.waitFor(() => { expect(first.closed()).toBe(true) })
    await runtime.flush()
    expect(first.delivered()).toBe(1)
    expect(listing.calls).toHaveLength(listed)

    // So is a failure.
    clickRow(panel.container, '/work/shared')
    await runtime.flush()
    const second = watches.of('/work/shared')
    const relisted = listing.calls.length
    second.fail(new RemoteError('workspace-file/not-found', 'gone', { path: '/work/shared' }))
    clickRow(panel.container, '/work/shared')
    await vi.waitFor(() => { expect(second.closed()).toBe(true) })
    await runtime.flush()
    expect(caption()).toBeNull()
    expect(listing.calls).toHaveLength(relisted)
  })

  it('clears the caption of a failed subfolder when that folder collapses', async () => {
    const listing = listingDouble({
      '/work': [{ name: 'shared', type: 'directory' }],
      '/work/shared': [],
    })
    const watches = createWatchDouble()
    const { runtime, panel } = await openFiles(listing, watches)
    const caption = (): Element | null => panel.container.querySelector('[data-board-right-files-watch="failed"]')
    clickRow(panel.container, '/work/shared')
    await runtime.flush()
    watches.of('/work/shared').fail(new RemoteError('workspace-file/watch-unsupported', 'no watcher', { path: '/work/shared' }))
    await vi.waitFor(() => { expect(caption()).not.toBeNull() })
    expect(panel.container.querySelector('[data-board-right-files-path]')).toBeNull()

    clickRow(panel.container, '/work/shared')
    await runtime.flush()
    expect(caption()).toBeNull()
    expect(panel.container.querySelector('[data-board-right-files-path]')?.textContent).toBe('/work')
    expect(watches.active()).toEqual(['/work'])
  })

  it('names each failed subfolder in the caption, whose title is the caption itself', async () => {
    const listing = listingDouble({
      '/work': [{ name: 'shared', type: 'directory' }],
      '/work/shared': [{ name: 'deep', type: 'directory' }],
      '/work/shared/deep': [],
    })
    const watches = createWatchDouble()
    const { runtime, panel } = await openFiles(listing, watches)
    const caption = (): Element | null => panel.container.querySelector('[data-board-right-files-watch="failed"]')
    const refusal = (path: string): RemoteError => new RemoteError('workspace-file/watch-unsupported', 'no watcher', { path })
    clickRow(panel.container, '/work/shared')
    await runtime.flush()
    clickRow(panel.container, '/work/shared/deep')
    await runtime.flush()

    watches.of('/work/shared/deep').fail(refusal('/work/shared/deep'))
    await vi.waitFor(() => {
      expect(caption()?.textContent).toBe('Could not watch the folder shared/deep — reload manually')
    })
    expect(caption()?.getAttribute('title')).toBe(caption()?.textContent)

    watches.of('/work/shared').fail(refusal('/work/shared'))
    await vi.waitFor(() => {
      expect(caption()?.textContent).toBe('Could not watch the folder shared, shared/deep — reload manually')
    })
    expect(caption()?.getAttribute('title')).toBe(caption()?.textContent)

    // Once the root is among them, the caption speaks of the tab's own folder.
    watches.of('/work').fail(refusal('/work'))
    await vi.waitFor(() => { expect(caption()?.textContent).toBe('Could not watch this folder — reload manually') })
    expect(caption()?.getAttribute('title')).toBe(caption()?.textContent)
  })

  it('keeps the listed rows when a background re-list fails, with the caption until a listing succeeds', async () => {
    const listing = listingDouble({
      '/work': [{ name: 'shared', type: 'directory' }],
      '/work/shared': [{ name: 'a.txt' }],
    })
    const watches = createWatchDouble()
    const { runtime, panel } = await openFiles(listing, watches)
    const caption = (): Element | null => panel.container.querySelector('[data-board-right-files-watch="failed"]')
    clickRow(panel.container, '/work/shared')
    await runtime.flush()
    const listed = listing.calls.length

    // The browser's host connection drops while a frame's listing is in flight.
    listing.failures['/work/shared'] = { code: 'gateway/internal', message: 'client api: carrier lost' }
    watches.of('/work/shared').push({ kind: 'change', change: { absolutePath: '/work/shared/b.txt', version: 'v2' } })
    await vi.waitFor(() => {
      expect(caption()?.textContent).toBe('Could not watch the folder shared — reload manually')
    })
    expect(listing.calls).toHaveLength(listed + 1)
    expect(rowPaths(panel.container)).toEqual(['/work/shared', '/work/shared/a.txt'])
    expect(panel.container.querySelector('[data-board-right-row="failed"]')).toBeNull()
    expect(panel.container.querySelector('[data-board-action="right-files-reload"]')).not.toBeNull()

    // The next frame lists the folder again, and the listing that succeeds clears the caption.
    Reflect.deleteProperty(listing.failures, '/work/shared')
    listing.tree['/work/shared'] = [{ name: 'a.txt' }, { name: 'b.txt' }]
    watches.of('/work/shared').push({ kind: 'ready' })
    await vi.waitFor(() => {
      expect(rowPaths(panel.container)).toEqual(['/work/shared', '/work/shared/a.txt', '/work/shared/b.txt'])
    })
    expect(caption()).toBeNull()
    expect(panel.container.querySelector('[data-board-right-files-path]')?.textContent).toBe('/work')
  })

  it('shows the failure of a folder that a background re-list finds gone in place of its rows', async () => {
    const listing = listingDouble({
      '/work': [{ name: 'shared', type: 'directory' }],
      '/work/shared': [{ name: 'a.txt' }],
    })
    const watches = createWatchDouble()
    const { runtime, panel } = await openFiles(listing, watches)
    clickRow(panel.container, '/work/shared')
    await runtime.flush()

    listing.failures['/work/shared'] = { code: 'workspace-file/not-found', message: 'gone' }
    watches.of('/work/shared').push({ kind: 'change', change: { absolutePath: '/work/shared/a.txt', version: 'v2' } })
    await vi.waitFor(() => {
      expect(panel.container.querySelector('[data-board-right-row="failed"]')?.textContent)
        .toBe('The file or folder does not exist')
    })
    expect(rowPaths(panel.container)).toEqual(['/work/shared'])
    expect(panel.container.querySelector('[data-board-right-files-watch="failed"]')).toBeNull()
  })

  it('lets a background re-list that fails after its folder collapses add no caption and keep the rows', async () => {
    const listing = listingDouble({
      '/work': [{ name: 'shared', type: 'directory' }],
      '/work/shared': [{ name: 'a.txt' }],
    })
    const watches = createWatchDouble()
    const { runtime, panel } = await openFiles(listing, watches)
    clickRow(panel.container, '/work/shared')
    await runtime.flush()
    const listed = listing.calls.length

    const release = listing.hold()
    listing.failures['/work/shared'] = { code: 'gateway/internal', message: 'client api: carrier lost' }
    watches.of('/work/shared').push({ kind: 'change', change: { absolutePath: '/work/shared/b.txt', version: 'v2' } })
    await vi.waitFor(() => { expect(listing.calls).toHaveLength(listed + 1) })
    clickRow(panel.container, '/work/shared')
    await runtime.flush()
    await act(async () => { release() })
    await vi.waitFor(() => { expect(listing.answered()).toBe(listed + 1) })
    await runtime.flush()
    expect(panel.container.querySelector('[data-board-right-files-watch="failed"]')).toBeNull()

    // Expanded again, the folder shows the rows it had.
    Reflect.deleteProperty(listing.failures, '/work/shared')
    clickRow(panel.container, '/work/shared')
    await runtime.flush()
    expect(rowPaths(panel.container)).toEqual(['/work/shared', '/work/shared/a.txt'])
  })

  it('leaves the store untouched when a re-list finds the same entries', async () => {
    const listing = listingDouble({ '/work': [{ name: 'a.txt', size: 1 }, { name: 'docs', type: 'directory' }] })
    const watches = createWatchDouble()
    const { runtime, board } = await openFiles(listing, watches)
    const root = watches.of('/work')
    root.push({ kind: 'ready' })
    await vi.waitFor(() => { expect(listing.answered()).toBe(2) })
    await runtime.flush()

    const listener = vi.fn()
    const unsubscribe = board.subscribe(listener)
    try {
      // Temporary files that came and went leave the listing as it was.
      root.push({ kind: 'change', change: { absolutePath: '/work/.syncthing.a.txt.tmp', version: 'v2' } })
      await vi.waitFor(() => { expect(listing.answered()).toBe(3) })
      await runtime.flush()
      expect(listener).not.toHaveBeenCalled()

      // A changed size is a change.
      listing.tree['/work'] = [{ name: 'a.txt', size: 2 }, { name: 'docs', type: 'directory' }]
      root.push({ kind: 'change', change: { absolutePath: '/work/a.txt', version: 'v3' } })
      await vi.waitFor(() => { expect(listener).toHaveBeenCalled() })
    } finally {
      unsubscribe()
    }
  })
})
