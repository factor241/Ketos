// @vitest-environment jsdom
/**
 * Peer state through the assembled board: the poll lands the host's answer in
 * the store, merges the peer into the roster once, pauses while the tab is
 * hidden, retries through an unreachable host without dropping the roster,
 * stops and reports the not-configured mode only on 404, and offers the
 * connected peer for a window transfer that leaves the window in place.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent } from '@testing-library/react'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OwnerId } from '@ketos/board-doc/types'
import type { KetosPeerId } from '@ketos/peer/types'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { createBoardStore } from '../src/client/store.ts'
import { boardParticipants } from '../src/client/owners.ts'
import type { WindowId } from '../src/client/contract/slots.ts'
import { createBoardBench, createBoardDocDouble } from './fixtures.client.ts'

type BoardInstance = ReturnType<ReturnType<typeof createBoardStore>['create']>

const runtimes = new Set<SlotTestRuntime>()

afterEach(async () => {
  Reflect.deleteProperty(document, 'visibilityState')
  try {
    for (const runtime of runtimes) await runtime.dispose()
  } finally {
    runtimes.clear()
    cleanup()
  }
})

const SELF = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e1')
const REMOTE = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e2')
const PEER = brandString<KetosPeerId>('peer-one')

/** One complete state answer. */
function stateAnswer(): Record<string, unknown> {
  return {
    self: { selfId: SELF, name: 'Kirill', color: 1 },
    peers: [{ peerId: PEER, selfId: REMOTE, name: 'Remote', color: 5, link: 'online' }],
    refreshMs: 50,
  }
}

/** One window literal under test. */
function windowSpec(id: string) {
  return { id: id as WindowId, kind: 'agent' as const, bodyKind: 'conversation' as const, ordinal: 1, width: 552, height: 648 }
}

/** One open menu row by its visible text; a miss fails at the call site. */
function menuRow(text: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find(candidate => candidate.textContent?.trim() === text)
  if (row === undefined) throw new Error(`menu row "${text}" is missing`)
  return row
}

/** Set the document visibility the poll reads. */
function setVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('peer state polling', () => {
  it('applies the answer, merges the peer once, pauses hidden, and resumes visible', async () => {
    let calls = 0
    const boardDoc = createBoardDocDouble(undefined, globalThis.fetch, {
      state: () => {
        calls += 1
        return Response.json(stateAnswer())
      },
    })
    const prepared = await createBoardBench({ boardDoc })
    runtimes.add(prepared.runtime)
    await prepared.mountBoard()
    // The board plugin is loaded but its surface is not rendered yet; the
    // peer routes stay untouched until the board panel appears.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(calls).toBe(0)
    prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
    const store = prepared.runtime.storeOf('board.dock') as BoardInstance

    await vi.waitFor(() => { expect(store.getSnapshot().peerAvailable).toBe(true) })
    expect(store.getSnapshot().peerStates[0]?.selfId).toBe(REMOTE)
    // The document record and the peer record for the same identity collapse.
    const roster = boardParticipants(store.getSnapshot())
    expect(roster.filter(participant => participant.id === REMOTE)).toHaveLength(1)
    expect(roster.map(participant => String(participant.id))).toContain(String(REMOTE))
    await vi.waitFor(() => { expect(calls).toBeGreaterThanOrEqual(2) })

    setVisibility('hidden')
    const hiddenAt = calls
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(calls).toBe(hiddenAt)

    setVisibility('visible')
    await vi.waitFor(() => { expect(calls).toBeGreaterThan(hiddenAt) })
  })

  it('clears the slice and shows the not-configured mode when the route answers 404', async () => {
    let calls = 0
    let enabled = true
    const boardDoc = createBoardDocDouble(undefined, globalThis.fetch, {
      state: () => {
        calls += 1
        return enabled ? Response.json(stateAnswer()) : new Response(null, { status: 404 })
      },
    })
    const prepared = await createBoardBench({ boardDoc })
    runtimes.add(prepared.runtime)
    await prepared.mountBoard()
    prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
    const store = prepared.runtime.storeOf('board.dock') as BoardInstance

    await vi.waitFor(() => { expect(store.getSnapshot().peerAvailable).toBe(true) })
    enabled = false
    await vi.waitFor(() => { expect(store.getSnapshot().peerMissing).toBe(true) })
    expect(store.getSnapshot().peerAvailable).toBe(false)
    expect(store.getSnapshot().peerStates).toEqual([])
    expect(store.getSnapshot().peerSelf).toBeNull()
    // An unavailable route stops the loop: a deployment without the peer
    // plugin must not keep polling a 404 in the background.
    const callsAtUnavailable = calls
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(calls).toBe(callsAtUnavailable)
  })

  it('keeps polling through failures without the not-configured mode and restores the roster', async () => {
    let calls = 0
    // The first three polls fail three different ways — a network reset, a
    // 5xx, and a body outside the protocol — before the host answers.
    const bootFailures: (() => Response)[] = [
      () => { throw new TypeError('network reset') },
      () => new Response(null, { status: 503 }),
      () => Response.json({ self: {} }),
    ]
    let down = false
    const boardDoc = createBoardDocDouble(undefined, globalThis.fetch, {
      state: () => {
        calls += 1
        const bootFailure = bootFailures.shift()
        if (bootFailure !== undefined) return bootFailure()
        if (down) throw new TypeError('network reset')
        return Response.json(stateAnswer())
      },
    })
    const prepared = await createBoardBench({ boardDoc })
    runtimes.add(prepared.runtime)
    await prepared.mountBoard()
    prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
    const store = prepared.runtime.storeOf('board.dock') as BoardInstance

    // Before the first answer the dock shows neither the roster nor the
    // not-configured mode; the fallback interval keeps the poll running.
    await vi.waitFor(() => { expect(calls).toBeGreaterThanOrEqual(3) }, { timeout: 8000 })
    expect(store.getSnapshot().peerAvailable).toBe(false)
    expect(store.getSnapshot().peerMissing).toBe(false)
    expect(store.getSnapshot().peerStates).toEqual([])

    await vi.waitFor(() => { expect(store.getSnapshot().peerAvailable).toBe(true) }, { timeout: 8000 })
    expect(store.getSnapshot().peerStates[0]?.link).toBe('online')

    // A reset after the first answer keeps the roster and the local record,
    // degrades the unconfirmed link, and retries on the host's own interval.
    down = true
    await vi.waitFor(() => { expect(store.getSnapshot().peerStates[0]?.link).toBe('lost') }, { timeout: 3000 })
    expect(store.getSnapshot().peerAvailable).toBe(true)
    expect(store.getSnapshot().peerMissing).toBe(false)
    expect(store.getSnapshot().peerSelf?.selfId).toBe(SELF)
    expect(bootFailures).toEqual([])

    down = false
    await vi.waitFor(() => { expect(store.getSnapshot().peerStates[0]?.link).toBe('online') }, { timeout: 3000 })
  })
})

describe('shared folder state', () => {
  it('shows the state the poll reports in the participants popover and follows its changes', async () => {
    let folder: string | undefined = 'waiting'
    const boardDoc = createBoardDocDouble(undefined, globalThis.fetch, {
      state: () => Response.json(folder === undefined ? stateAnswer() : { ...stateAnswer(), sharedFolder: folder }),
    })
    const prepared = await createBoardBench({ boardDoc })
    runtimes.add(prepared.runtime)
    await prepared.mountBoard()
    const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
    const store = prepared.runtime.storeOf('board.dock') as BoardInstance
    await vi.waitFor(() => { expect(store.getSnapshot().peerSharedFolder).toBe('waiting') })
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-action="dock-participants"]') as Element)
    })
    await prepared.runtime.flush()
    const row = (): Element | null => document.querySelector('[role="dialog"] [data-board-shared-folder]')
    expect(row()?.textContent).toBe('Shared folderWaiting for the other side')

    folder = 'synced'
    await vi.waitFor(() => { expect(row()?.textContent).toBe('Shared folderSynced') })
    expect(row()?.getAttribute('data-board-shared-folder')).toBe('synced')

    // A state this client does not know reads as no folder at all.
    folder = 'paused'
    await vi.waitFor(() => { expect(row()).toBeNull() })
    folder = 'error'
    await vi.waitFor(() => { expect(row()?.textContent).toBe('Shared folderSync error') })
    folder = undefined
    await vi.waitFor(() => { expect(row()).toBeNull() })
    expect(store.getSnapshot().peerAvailable).toBe(true)
  })
})

describe('transfer to a connected peer', () => {
  it('offers the peer and leaves the window on this Ketos under the new owner', async () => {
    const boardDoc = createBoardDocDouble(undefined, globalThis.fetch, {
      state: () => Response.json(stateAnswer()),
    })
    const prepared = await createBoardBench({ session: {}, boardDoc })
    runtimes.add(prepared.runtime)
    await prepared.mountBoard()
    const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
    const store = prepared.runtime.storeOf('board.dock') as BoardInstance

    act(() => { store.actions.openWindow(windowSpec('w1')) })
    await prepared.runtime.flush()
    await vi.waitFor(() => { expect(store.getSnapshot().peerAvailable).toBe(true) })
    await prepared.runtime.flush()

    const frame = panel.container.querySelector('[data-board-window-id="w1"]') as HTMLElement
    fireEvent.click(frame.querySelector('[data-board-action="bezel-owner"]') as Element)
    await prepared.runtime.flush()
    fireEvent.click(menuRow('Remote'))
    await prepared.runtime.flush()
    fireEvent.click(menuRow('Transfer'))
    await prepared.runtime.flush()

    // The transfer changes only the owner: the window stays open here, and the
    // remote participant's palette color paints its edge.
    expect(store.store.getSnapshot().windows['w1']?.ownerId).toBe(REMOTE)
    expect(panel.container.querySelector('[data-board-window-id="w1"]')).not.toBeNull()
    expect((panel.container.querySelector('[data-board-window-id="w1"]') as HTMLElement)
      .getAttribute('data-board-owner-color')).toBe('5')
  })
})
