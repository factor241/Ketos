// @vitest-environment jsdom
/**
 * Element slice of the board store: snapshots replace, stale patches drop,
 * a new document replaces everything, optimistic operations survive their own
 * echo, selection follows the slice, «show all» covers elements, and adopting
 * `selfId` rewrites stored owners and schedules a layout write.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  BoardDocId, BoardElement, BoardPatch, BoardParticipantRecord, BoardRevision, BoardSnapshot, ElementId, OwnerId,
} from '@ketos/board-doc/types'
import type { KetosPeerId, PeerStateResponse } from '@ketos/peer/types'
import { BOARD_SETTINGS_NAMESPACE } from '../src/board-settings.ts'
import { BoardLayoutPersistence } from '../src/client/board-persistence.ts'
import { DEMO_SELF_ID, boardParticipants, currentOwnerId } from '../src/client/owners.ts'
import { createBoardStore, type BoardStoreInstance } from '../src/client/store.ts'
import type { WindowId } from '../src/client/contract/slots.ts'
import { createConfigFormsDouble } from './fixtures.client.ts'

afterEach(() => {
  vi.useRealTimers()
})

const DOC_A = brandString<BoardDocId>('00000000-0000-4000-8000-0000000000d1')
const DOC_B = brandString<BoardDocId>('00000000-0000-4000-8000-0000000000d2')
const SELF = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e1')
const ID_A = brandString<ElementId>('00000000-0000-4000-8000-0000000000a1')
const ID_B = brandString<ElementId>('00000000-0000-4000-8000-0000000000a2')

/** One complete element with test overrides. */
function element(overrides: Partial<BoardElement> = {}): BoardElement {
  return {
    id: ID_A,
    kind: 'note',
    ownerId: SELF,
    x: 1,
    y: 2,
    w: 30,
    h: 40,
    z: 1,
    data: { text: 'x' },
    createdAt: 10,
    updatedAt: 20,
    ...overrides,
  }
}

/** One snapshot with test overrides. */
function snapshot(overrides: Partial<BoardSnapshot> = {}): BoardSnapshot {
  return {
    docId: DOC_A,
    selfId: SELF,
    revision: brandNumber<BoardRevision>(1),
    elements: [element()],
    participants: [],
    windows: [],
    limits: { elementBytesMax: 1024, noteTextMax: 1024, strokePointsMax: 2000, todoItemsMax: 200 },
    ...overrides,
  }
}

/** One patch with test overrides. */
function patch(overrides: Partial<BoardPatch> = {}): BoardPatch {
  return {
    revision: brandNumber<BoardRevision>(2),
    upserts: [],
    removes: [],
    ...overrides,
  }
}

/** One open agent window spec. */
function windowSpec(id: string): {
  id: WindowId
  kind: 'agent'
  bodyKind: 'conversation'
  ordinal: number
  width: number
  height: number
  access: { mode: 'selected'; people: OwnerId[] }
} {
  return {
    id: id as WindowId,
    kind: 'agent',
    bodyKind: 'conversation',
    ordinal: 1,
    width: 552,
    height: 648,
    access: { mode: 'selected', people: [DEMO_SELF_ID] },
  }
}

/** A fresh board store instance. */
function store(): BoardStoreInstance {
  return createBoardStore().create()
}

describe('element snapshot and patch', () => {
  it('replaces the slice and adopts selfId from the first snapshot', () => {
    const instance = store()
    instance.actions.openWindow(windowSpec('w1'))
    // Before the snapshot the acting identity is unknown; the placeholder
    // owner stands in for it.
    expect(currentOwnerId(instance.getSnapshot())).toBeNull()
    expect(instance.getSnapshot().windows['w1']?.ownerId).toBe(DEMO_SELF_ID)

    instance.actions.applyBoardSnapshot(snapshot({ revision: brandNumber<BoardRevision>(3) }))
    const state = instance.getSnapshot()
    expect(state.boardElements[ID_A]).toEqual(element())
    expect(state.boardElementsRevision).toBe(3)
    expect(state.boardDocId).toBe(DOC_A)
    expect(state.boardLimits).toEqual({ elementBytesMax: 1024, noteTextMax: 1024, strokePointsMax: 2000, todoItemsMax: 200 })
    expect(state.selfId).toBe(SELF)
    expect(currentOwnerId(state)).toBe(SELF)
    expect(boardParticipants(state)[0]?.id).toBe(SELF)
    expect(state.windows['w1']?.ownerId).toBe(SELF)
    expect(state.windows['w1']?.access.people).toEqual([SELF])
  })

  it('drops a stale patch and applies a newer one', () => {
    const instance = store()
    instance.actions.applyBoardSnapshot(snapshot({ revision: brandNumber<BoardRevision>(5), elements: [] }))
    instance.actions.applyBoardPatch(patch({ revision: brandNumber<BoardRevision>(5), upserts: [element()] }))
    expect(instance.getSnapshot().boardElements).toEqual({})
    expect(instance.getSnapshot().boardElementsRevision).toBe(5)

    instance.actions.applyBoardPatch(patch({ revision: brandNumber<BoardRevision>(6), upserts: [element()] }))
    expect(instance.getSnapshot().boardElements[ID_A]).toEqual(element())
    expect(instance.getSnapshot().boardElementsRevision).toBe(6)
  })

  it('replaces everything when a snapshot names a new document', () => {
    const instance = store()
    instance.actions.applyBoardSnapshot(snapshot({ docId: DOC_A, revision: brandNumber<BoardRevision>(9) }))
    instance.actions.applyBoardSnapshot(snapshot({ docId: DOC_B, revision: brandNumber<BoardRevision>(1), elements: [] }))
    const state = instance.getSnapshot()
    expect(state.boardDocId).toBe(DOC_B)
    expect(state.boardElements).toEqual({})
    expect(state.boardElementsRevision).toBe(1)
  })

  it('applies removals and clears the selection of a removed element', () => {
    const instance = store()
    instance.actions.applyBoardSnapshot(snapshot())
    instance.actions.selectBoardElement(ID_A)
    instance.actions.applyBoardPatch(patch({ revision: brandNumber<BoardRevision>(2), removes: [ID_A] }))
    expect(instance.getSnapshot().boardElements).toEqual({})
    expect(instance.getSnapshot().selectedBoardElementId).toBeNull()
  })
})

describe('optimistic element operations', () => {
  it('keeps an optimistic move against its own echo', () => {
    const instance = store()
    instance.actions.applyBoardSnapshot(snapshot())
    instance.actions.beginBoardElementOp(ID_A)
    instance.actions.moveBoardElement(ID_A, 100, 50)
    instance.actions.applyBoardPatch(patch({ revision: brandNumber<BoardRevision>(2), upserts: [element()] }))
    expect(instance.getSnapshot().boardElements[ID_A]).toMatchObject({ x: 100, y: 50 })
    expect(instance.getSnapshot().boardElementsRevision).toBe(2)

    instance.actions.endBoardElementOp(ID_A)
    instance.actions.applyBoardPatch(patch({
      revision: brandNumber<BoardRevision>(3),
      upserts: [element({ x: 7, y: 8 })],
    }))
    expect(instance.getSnapshot().boardElements[ID_A]).toMatchObject({ x: 7, y: 8 })
  })

  it('keeps an optimistic removal against an upsert echo', () => {
    const instance = store()
    instance.actions.applyBoardSnapshot(snapshot())
    instance.actions.beginBoardElementOp(ID_A)
    instance.actions.removeBoardElement(ID_A)
    instance.actions.applyBoardPatch(patch({ revision: brandNumber<BoardRevision>(2), upserts: [element()] }))
    expect(instance.getSnapshot().boardElements).toEqual({})

    instance.actions.endBoardElementOp(ID_A)
    instance.actions.applyBoardPatch(patch({ revision: brandNumber<BoardRevision>(3), upserts: [element()] }))
    expect(instance.getSnapshot().boardElements[ID_A]).toEqual(element())
  })

  it('suppresses the echo of a second overlapping request after the first one settles', () => {
    const instance = store()
    instance.actions.applyBoardSnapshot(snapshot())
    instance.actions.beginBoardElementOp(ID_A)
    instance.actions.beginBoardElementOp(ID_A)
    instance.actions.moveBoardElement(ID_A, 100, 50)
    instance.actions.endBoardElementOp(ID_A)
    expect(instance.getSnapshot().pendingBoardElementOps).toEqual([ID_A])
    instance.actions.applyBoardPatch(patch({ revision: brandNumber<BoardRevision>(2), upserts: [element()] }))
    expect(instance.getSnapshot().boardElements[ID_A]).toMatchObject({ x: 100, y: 50 })

    instance.actions.endBoardElementOp(ID_A)
    expect(instance.getSnapshot().pendingBoardElementOps).toEqual([])
    instance.actions.applyBoardPatch(patch({
      revision: brandNumber<BoardRevision>(3),
      upserts: [element({ x: 7, y: 8 })],
    }))
    expect(instance.getSnapshot().boardElements[ID_A]).toMatchObject({ x: 7, y: 8 })
  })

  it('keeps the mark of a request that began after a snapshot when an earlier request settles', () => {
    const instance = store()
    instance.actions.applyBoardSnapshot(snapshot())
    instance.actions.beginBoardElementOp(ID_A)
    instance.actions.applyBoardSnapshot(snapshot())
    instance.actions.beginBoardElementOp(ID_A)
    instance.actions.moveBoardElement(ID_A, 100, 50)
    instance.actions.endBoardElementOp(ID_A)
    instance.actions.applyBoardPatch(patch({ revision: brandNumber<BoardRevision>(2), upserts: [element()] }))
    expect(instance.getSnapshot().boardElements[ID_A]).toMatchObject({ x: 100, y: 50 })

    instance.actions.endBoardElementOp(ID_A)
    expect(instance.getSnapshot().pendingBoardElementOps).toEqual([])
  })

  it('ignores a settle for an element with no request in flight', () => {
    const instance = store()
    instance.actions.endBoardElementOp(ID_A)
    expect(instance.getSnapshot().pendingBoardElementOps).toEqual([])
  })

  it('inserts, moves, resizes, and removes elements locally', () => {
    const instance = store()
    instance.actions.createBoardElement({ id: ID_A, kind: 'note', x: 1, y: 2, w: 30, h: 40, data: { text: 'x' } })
    expect(instance.getSnapshot().boardElements[ID_A]).toMatchObject({
      id: ID_A, kind: 'note', ownerId: DEMO_SELF_ID, z: 1, data: { text: 'x' },
    })
    instance.actions.moveBoardElement(ID_A, 9, 8)
    instance.actions.resizeBoardElement(ID_A, 300, 400)
    expect(instance.getSnapshot().boardElements[ID_A]).toMatchObject({ x: 9, y: 8, w: 300, h: 400 })
    instance.actions.removeBoardElement(ID_A)
    expect(instance.getSnapshot().boardElements).toEqual({})
  })

  it('ignores element mutations of an absent element', () => {
    const instance = store()
    instance.actions.moveBoardElement(ID_A, 1, 1)
    instance.actions.resizeBoardElement(ID_A, 1, 1)
    expect(instance.getSnapshot().boardElements).toEqual({})
  })
})

describe('participants and peer state', () => {
  const OTHER = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e2')
  const first: BoardParticipantRecord = { id: SELF, name: 'Kirill', color: 1, updatedAt: 1 }
  const second: BoardParticipantRecord = { id: OTHER, name: 'Anna', color: 2, updatedAt: 2 }

  it('replaces participants with a snapshot and applies patch upserts and removes', () => {
    const instance = store()
    instance.actions.applyBoardSnapshot(snapshot({ participants: [first] }))
    expect(instance.getSnapshot().boardParticipants).toEqual([first])

    instance.actions.applyBoardPatch(patch({
      revision: brandNumber<BoardRevision>(2),
      participants: { upserts: [second], removes: [] },
    }))
    expect(instance.getSnapshot().boardParticipants).toEqual([first, second])

    const updated: BoardParticipantRecord = { ...first, name: 'Kir', color: 3, updatedAt: 3 }
    instance.actions.applyBoardPatch(patch({
      revision: brandNumber<BoardRevision>(3),
      participants: { upserts: [updated], removes: [OTHER] },
    }))
    expect(instance.getSnapshot().boardParticipants).toEqual([updated])
  })

  it('applies the peer slice, degrades links while unreachable, and clears it on 404', () => {
    const instance = store()
    const response: PeerStateResponse = {
      self: { selfId: SELF, name: 'Kirill', color: 1 },
      peers: [{ peerId: brandString<KetosPeerId>('peer-one'), selfId: OTHER, name: 'Anna', color: 2, link: 'online' }],
      refreshMs: 500,
    }
    const listener = vi.fn()
    const unsubscribe = instance.subscribe(listener)

    instance.actions.applyPeerState(response)
    expect(instance.getSnapshot().peerAvailable).toBe(true)
    expect(instance.getSnapshot().peerMissing).toBe(false)
    expect(instance.getSnapshot().peerSelf).toEqual(response.self)
    expect(instance.getSnapshot().peerStates).toEqual(response.peers)
    // The poll repeats every second: an unchanged answer must not notify.
    instance.actions.applyPeerState(response)
    expect(listener).toHaveBeenCalledTimes(1)

    // An unreachable host keeps the roster and drops the unconfirmed link; a
    // second failure changes nothing.
    instance.actions.markPeerUnreachable()
    expect(instance.getSnapshot().peerAvailable).toBe(true)
    expect(instance.getSnapshot().peerSelf).toEqual(response.self)
    expect(instance.getSnapshot().peerStates[0]?.link).toBe('lost')
    instance.actions.markPeerUnreachable()
    expect(listener).toHaveBeenCalledTimes(2)

    // A 404 is terminal for the dock's hint: the slice and the local record go.
    instance.actions.markPeerUnavailable()
    expect(instance.getSnapshot().peerAvailable).toBe(false)
    expect(instance.getSnapshot().peerMissing).toBe(true)
    expect(instance.getSnapshot().peerSelf).toBeNull()
    expect(instance.getSnapshot().peerStates).toEqual([])
    instance.actions.markPeerUnavailable()
    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
  })

  it('follows the shared-folder state of each answer and drops it with the peer routes', () => {
    const instance = store()
    const response: PeerStateResponse = {
      self: { selfId: SELF, name: 'Kirill', color: 1 },
      peers: [],
      refreshMs: 500,
    }
    const listener = vi.fn()
    const unsubscribe = instance.subscribe(listener)

    // A host without the Syncthing feature reports no folder.
    instance.actions.applyPeerState(response)
    expect(instance.getSnapshot().peerSharedFolder).toBeNull()
    expect(listener).toHaveBeenCalledTimes(1)

    // An answer that changes only the folder state is a store change.
    instance.actions.applyPeerState({ ...response, sharedFolder: 'syncing' })
    expect(instance.getSnapshot().peerSharedFolder).toBe('syncing')
    expect(listener).toHaveBeenCalledTimes(2)
    instance.actions.applyPeerState({ ...response, sharedFolder: 'syncing' })
    expect(listener).toHaveBeenCalledTimes(2)
    instance.actions.applyPeerState({ ...response, sharedFolder: 'synced' })
    expect(instance.getSnapshot().peerSharedFolder).toBe('synced')
    expect(listener).toHaveBeenCalledTimes(3)

    // An unreachable host keeps the last reported state; a 404 drops it.
    instance.actions.markPeerUnreachable()
    expect(instance.getSnapshot().peerSharedFolder).toBe('synced')
    instance.actions.markPeerUnavailable()
    expect(instance.getSnapshot().peerSharedFolder).toBeNull()

    // The feature switched off on the host: the field disappears, and so does the state.
    instance.actions.applyPeerState({ ...response, sharedFolder: 'error' })
    expect(instance.getSnapshot().peerSharedFolder).toBe('error')
    instance.actions.applyPeerState(response)
    expect(instance.getSnapshot().peerSharedFolder).toBeNull()
    unsubscribe()
  })
})

describe('element selection and view', () => {
  it('selects one existing element and clears on focus or absence', () => {
    const instance = store()
    instance.actions.openWindow(windowSpec('w1'))
    instance.actions.applyBoardSnapshot(snapshot())
    instance.actions.selectBoardElement(ID_A)
    expect(instance.getSnapshot().selectedBoardElementId).toBe(ID_A)

    instance.actions.selectBoardElement(ID_B)
    expect(instance.getSnapshot().selectedBoardElementId).toBeNull()

    instance.actions.selectBoardElement(ID_A)
    instance.actions.focusWindow('w1' as WindowId)
    expect(instance.getSnapshot().selectedBoardElementId).toBeNull()

    instance.actions.selectBoardElement(ID_A)
    instance.actions.selectBoardElement(null)
    expect(instance.getSnapshot().selectedBoardElementId).toBeNull()
  })

  it('fits the elements in «show all» even without windows', () => {
    const instance = store()
    instance.actions.applyBoardSnapshot(snapshot({ elements: [element({ x: 5000, y: 5000, w: 100, h: 100 })] }))
    instance.actions.resetView()
    expect(instance.getSnapshot().zoom).toBe(1)
    expect(instance.getSnapshot().panX).toBe(960 - 5050)
    expect(instance.getSnapshot().panY).toBe(540 - 5050)
  })
})

describe('selfId adoption and layout persistence', () => {
  it('rewrites stored owners and schedules a layout write when selfId arrives', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    const instance = store()
    const settings = createConfigFormsDouble({ writable: true, hasDocument: true, namespaces: [] })
    const replace = vi.fn(async (
      _ns: string,
      section: Record<string, unknown>,
      _revision: number | undefined,
    ): Promise<{ ok: true; value: SettingsNamespaceView }> => ({
      ok: true,
      value: {
        ns: BOARD_SETTINGS_NAMESPACE,
        schema: {},
        value: section as SettingsNamespaceView['value'],
        autoGenerate: false,
        applies: 'live',
        secrets: [],
        revision: 1,
      },
    }))
    new TestRemote(ctx, { settings: { replace } })
    const persistence = new BoardLayoutPersistence(ctx, settings.face, instance)
    persistence.start()
    instance.actions.openWindow(windowSpec('w1'))
    await vi.advanceTimersByTimeAsync(600)
    expect(replace).toHaveBeenCalledTimes(1)
    replace.mockClear()

    instance.actions.applyBoardSnapshot(snapshot({ elements: [] }))
    // The writer keeps at least one second between writes, then the 600 ms quiet.
    await vi.advanceTimersByTimeAsync(1_100)
    expect(replace).toHaveBeenCalledTimes(1)
    const section = replace.mock.calls[0]?.[1] as { windows: readonly { ownerId: string }[] }
    expect(section.windows[0]?.ownerId).toBe(SELF)
    persistence.dispose()
    await ctx.fiber.dispose()
  })
})
