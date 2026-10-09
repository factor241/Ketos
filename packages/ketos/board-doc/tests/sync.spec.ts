// Document synchronization: the state-vector exchange, remote application
// with the `peer` origin, and the local-update relay the peer channel sends.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import * as Y from 'yjs'
import { BoardDocument, BoardSyncError } from '../src/doc.ts'
import { KetosBoardDocService, type BoardChange, type KetosBoardDocOptions } from '../src/service.ts'
import type { BoardCreateOp, BoardElement, ElementId, OwnerId } from '../src/types.ts'

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

const ID_A = brandString<ElementId>('00000000-0000-4000-8000-000000000001')
const ID_B = brandString<ElementId>('00000000-0000-4000-8000-000000000002')

/**
 * One create operation.
 * @param id - element id.
 * @returns the create operation.
 */
function createOp(id: ElementId): BoardCreateOp {
  return {
    op: 'create', id, kind: 'note', x: 0, y: 0, w: 10, h: 10,
    data: { text: '', font: 'sans', size: 'm', scale: 1 },
  }
}

/**
 * One complete element, as the document stores it.
 * @param id - element id.
 * @returns the element.
 */
function noteElement(id: ElementId): BoardElement {
  return {
    id, kind: 'note', ownerId: brandString<OwnerId>('owner-local'),
    x: 0, y: 0, w: 10, h: 10, z: 1,
    data: { text: '', font: 'sans', size: 'm', scale: 1 },
    createdAt: 1, updatedAt: 1,
  }
}

/** Fresh temporary directory that the running test owns. */
async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-board-sync-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

/**
 * Mount one service over a fresh context.
 * @param path - database path.
 * @returns the service, its change recorder, and its invalid-record log.
 */
function mount(path: string): {
  service: KetosBoardDocService
  changes: BoardChange[]
  invalid: string[]
} {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const invalid: string[] = []
  const options: KetosBoardDocOptions = {
    path,
    limits: {
      maxOpsPerRequest: 64,
      maxElements: 2000,
      maxWindowRecords: 100,
      elements: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 },
    },
    journalCompactRows: 500,
    logger: (message) => { invalid.push(message) },
  }
  const service = new KetosBoardDocService(ctx, options)
  cleanups.push(() => service.close())
  return { service, changes: [], invalid }
}

/**
 * Mount two services over two fresh directories.
 * @returns both services.
 */
async function mountPair(): Promise<{
  a: ReturnType<typeof mount>
  b: ReturnType<typeof mount>
}> {
  const first = await temporaryDirectory()
  const second = await temporaryDirectory()
  return { a: mount(join(first, 'board.db')), b: mount(join(second, 'board.db')) }
}

/** One nested participant record map for a raw source document. */
function participantRecord(fields: { readonly name: unknown; readonly color: unknown; readonly updatedAt: unknown }): Y.Map<unknown> {
  const map = new Y.Map<unknown>()
  map.set('name', fields.name)
  map.set('color', fields.color)
  map.set('updatedAt', fields.updatedAt)
  return map
}

describe('board document synchronization', () => {
  it('converges two documents through the state-vector exchange', async () => {
    const { a, b } = await mountPair()
    await a.service.apply([createOp(ID_A)], 'host')

    // B asks for what it misses; A answers with exactly that.
    await b.service.applyRemote(await a.service.diffSince(await b.service.stateVector()))
    expect((await b.service.snapshot()).elements.map(element => element.id)).toEqual([ID_A])

    // The reverse direction carries B's own element to A.
    await b.service.apply([createOp(ID_B)], 'host')
    await a.service.applyRemote(await b.service.diffSince(await a.service.stateVector()))
    const idsA = (await a.service.snapshot()).elements.map(element => element.id).sort()
    const idsB = (await b.service.snapshot()).elements.map(element => element.id).sort()
    expect(idsA).toEqual([ID_A, ID_B])
    expect(idsA).toEqual(idsB)

    // A removal travels as a delete of an element both sides already hold.
    const removed: BoardChange[] = []
    b.service.subscribe((change) => { removed.push(change) })
    await a.service.apply([{ op: 'remove', id: ID_A }], 'host')
    await b.service.applyRemote(await a.service.diffSince(await b.service.stateVector()))
    expect(removed.at(-1)?.removes).toEqual([ID_A])
    expect((await b.service.snapshot()).elements.map(element => element.id)).toEqual([ID_B])
  })

  it('relays only local updates and never re-sends a remote one', async () => {
    const { a, b } = await mountPair()
    const localA: Uint8Array[] = []
    const localB: Uint8Array[] = []
    const stopA = a.service.onLocalUpdate((update) => { localA.push(update) })
    const stopB = b.service.onLocalUpdate((update) => { localB.push(update) })

    await a.service.apply([createOp(ID_A)], 'host')
    expect(localA).toHaveLength(1)
    await b.service.applyRemote(await a.service.diffSince(await b.service.stateVector()))
    expect(localA).toHaveLength(1)
    expect(localB).toEqual([])

    // The relayed bytes carry the whole change to a third document.
    const third = new Y.Doc()
    Y.applyUpdate(third, localA[0] as Uint8Array)
    expect(third.getMap('elements').has(ID_A)).toBe(true)

    await b.service.apply([createOp(ID_B)], 'host')
    expect(localB).toHaveLength(1)
    stopA()
    stopB()
    await a.service.apply([{ op: 'patch', id: ID_A, x: 5 }], 'browser')
    expect(localA).toHaveLength(1)
  })

  it('journals a remote update and keeps it across a restart', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'board.db')
    const source = mount(join(await temporaryDirectory(), 'board.db'))
    const target = mount(path)
    const seen: BoardChange[] = []
    target.service.subscribe((change) => { seen.push(change) })

    await source.service.apply([createOp(ID_A)], 'host')
    const update = await source.service.diffSince(await target.service.stateVector())
    await target.service.applyRemote(update)

    expect(seen).toHaveLength(1)
    expect(seen[0]?.upserts.map(element => element.id)).toEqual([ID_A])
    expect(seen[0]?.removes).toEqual([])
    expect(seen[0]?.participants).toBeUndefined()

    await target.service.close()
    const reopened = mount(path)
    expect((await reopened.service.snapshot()).elements.map(element => element.id)).toEqual([ID_A])
  })

  it('applies a repeated update without a new revision or change', async () => {
    const { a, b } = await mountPair()
    await a.service.apply([createOp(ID_A)], 'host')
    const update = await a.service.diffSince(await b.service.stateVector())
    const seen: BoardChange[] = []
    b.service.subscribe((change) => { seen.push(change) })

    await b.service.applyRemote(update)
    const revision = (await b.service.snapshot()).revision
    await b.service.applyRemote(update)
    expect((await b.service.snapshot()).revision).toBe(revision)
    expect(seen).toHaveLength(1)
  })

  it('reports whether Yjs kept part of an update waiting for an update that has not arrived', async () => {
    const { a, b } = await mountPair()
    const sent: Uint8Array[] = []
    a.service.onLocalUpdate((update) => { sent.push(update) })
    await a.service.apply([createOp(ID_A)], 'host')
    await a.service.apply([createOp(ID_B)], 'host')
    const [first, second] = sent as [Uint8Array, Uint8Array]
    const seen: BoardChange[] = []
    b.service.subscribe((change) => { seen.push(change) })

    // The second update continues the first one's clock range: alone it waits.
    expect(await b.service.applyRemote(second)).toEqual({ pending: true })
    expect((await b.service.snapshot()).elements).toEqual([])
    expect(seen).toEqual([])

    expect(await b.service.applyRemote(first)).toEqual({ pending: false })
    expect((await b.service.snapshot()).elements.map(element => element.id).sort()).toEqual([ID_A, ID_B])
    expect(seen.at(-1)?.upserts.map(element => element.id).sort()).toEqual([ID_A, ID_B])
  })

  it('keeps the waiting part of an update across a restart until the missing update arrives', async () => {
    const path = join(await temporaryDirectory(), 'board.db')
    const peer = new Y.Doc()
    const sent: Uint8Array[] = []
    peer.on('update', (update: Uint8Array) => { sent.push(update) })
    const participants = peer.getMap<Y.Map<unknown>>('participants')
    participants.set('owner-first', participantRecord({ name: 'A', color: 1, updatedAt: 1 }))
    participants.set('owner-second', participantRecord({ name: 'B', color: 2, updatedAt: 2 }))
    const [first, second] = sent as [Uint8Array, Uint8Array]

    const before = mount(path)
    expect(await before.service.applyRemote(second)).toEqual({ pending: true })
    await before.service.close()

    const after = mount(path)
    expect(await after.service.applyRemote(first)).toEqual({ pending: false })
    expect((await after.service.participants()).map(record => record.id).sort()).toEqual(['owner-first', 'owner-second'])
  })

  it('reports no pending update for a complete update and for one that changes nothing', async () => {
    const { a, b } = await mountPair()
    await a.service.apply([createOp(ID_A)], 'host')
    const complete = await a.service.diffSince(await b.service.stateVector())
    expect(await b.service.applyRemote(complete)).toEqual({ pending: false })
    expect(await b.service.applyRemote(new Uint8Array([0, 0]))).toEqual({ pending: false })
  })

  it('refuses unreadable update bytes and leaves the document untouched', async () => {
    const { a, b } = await mountPair()
    await a.service.apply([createOp(ID_A)], 'host')
    const valid = await a.service.diffSince(await b.service.stateVector())

    await expect(b.service.applyRemote(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toBeInstanceOf(BoardSyncError)
    await expect(b.service.applyRemote(valid.slice(0, valid.byteLength - 1))).rejects.toBeInstanceOf(BoardSyncError)
    expect((await b.service.snapshot()).elements).toEqual([])
    expect((await b.service.snapshot()).revision).toBe(0)

    // A readable update that changes nothing emits no patch.
    const seen: BoardChange[] = []
    b.service.subscribe((change) => { seen.push(change) })
    await b.service.applyRemote(new Uint8Array([0, 0]))
    expect(seen).toEqual([])
  })

  it('skips entries another version wrote and carries readable participants', async () => {
    const { b } = await mountPair()
    const holder = new Y.Doc()
    const participants = holder.getMap<Y.Map<unknown>>('participants')
    participants.set('owner-readable', participantRecord({ name: 'Юрист', color: 2, updatedAt: 1 }))
    participants.set('owner-broken', participantRecord({ name: 'X', color: 99, updatedAt: 1 }))
    const elements = holder.getMap<Y.Map<unknown>>('elements')
    elements.set('not-a-uuid', new Y.Map<unknown>())
    const brokenElement = new Y.Map<unknown>()
    brokenElement.set('kind', 'unknown-kind')
    elements.set('00000000-0000-4000-8000-000000000009', brokenElement)

    const seen: BoardChange[] = []
    b.service.subscribe((change) => { seen.push(change) })
    await b.service.applyRemote(Y.encodeStateAsUpdate(holder))

    expect(seen).toHaveLength(1)
    expect(seen[0]?.upserts).toEqual([])
    expect(seen[0]?.removes).toEqual([])
    expect(seen[0]?.participants?.upserts.map(record => record.id)).toEqual(['owner-readable'])
    expect(b.invalid).toHaveLength(2)
    expect((await b.service.snapshot()).participants.map(record => record.id)).toEqual(['owner-readable'])

    participants.delete('owner-readable')
    await b.service.applyRemote(Y.encodeStateAsUpdate(holder))
    expect(seen.at(-1)?.participants?.removes).toEqual(['owner-readable'])
    expect((await b.service.snapshot()).participants).toEqual([])
  })

  it('skips element, participant, and window entries that are not maps, before and after a restart', async () => {
    const path = join(await temporaryDirectory(), 'board.db')
    const target = mount(path)
    await target.service.apply([createOp(ID_A)], 'host')
    const holder = new Y.Doc()
    holder.getMap('elements').set(ID_B, 5)
    holder.getMap('participants').set('owner-peer', 5)
    holder.getMap('windows').set('agent-peer', 5)
    const seen: BoardChange[] = []
    target.service.subscribe((change) => { seen.push(change) })

    expect(await target.service.applyRemote(Y.encodeStateAsUpdate(holder))).toEqual({ pending: false })
    expect(seen).toEqual([])
    const snapshot = await target.service.snapshot()
    expect(snapshot.elements.map(element => element.id)).toEqual([ID_A])
    expect(snapshot.participants).toEqual([])
    expect(snapshot.windows).toEqual([])
    expect(target.invalid).toEqual(expect.arrayContaining([
      `board element ${ID_B} skipped: entry is not a map`,
      'board participant owner-peer skipped: record does not match this build',
      'board window agent-peer skipped: record does not match this build',
    ]))
    // The unreadable key stays occupied; the board still takes writes.
    await expect(target.service.apply([{ op: 'patch', id: ID_B, x: 1 }], 'host')).rejects.toThrow(/does not exist/u)
    expect(await target.service.apply([{ op: 'patch', id: ID_A, x: 1 }], 'host')).toEqual({ revision: 3 })

    await target.service.close()
    const reopened = mount(path)
    expect((await reopened.service.snapshot()).elements.map(element => element.id)).toEqual([ID_A])
    expect(await reopened.service.apply([{ op: 'patch', id: ID_A, x: 2 }], 'browser')).toEqual({ revision: 4 })
    expect(reopened.invalid).toContain(`board element ${ID_B} skipped: entry is not a map`)
  })

  it('replaces a non-map entry at the key of its own participant record', async () => {
    const target = mount(join(await temporaryDirectory(), 'board.db'))
    const holder = new Y.Doc()
    holder.getMap('participants').set(await target.service.selfId(), 'not a record')
    await target.service.applyRemote(Y.encodeStateAsUpdate(holder))

    await target.service.putOwnParticipant({ name: 'Me', color: 2 })
    expect((await target.service.participants()).map(record => record.name)).toEqual(['Me'])
  })

  it('never relays the stored-update replay of an open', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'board.db')
    const first = mount(path)
    await first.service.apply([createOp(ID_A)], 'host')
    await first.service.close()

    const reopened = mount(path)
    const relayed: Uint8Array[] = []
    reopened.service.onLocalUpdate((update) => { relayed.push(update) })
    expect((await reopened.service.snapshot()).elements.map(element => element.id)).toEqual([ID_A])
    expect(relayed).toEqual([])
  })

  it('reports nested data changes and detaches its observers after a throw', async () => {
    const document = BoardDocument.open(await import('yjs'), () => {})
    expect(() => document.changedKeys(() => { throw new Error('mutation failed') })).toThrow(/mutation failed/u)

    const created = document.changedKeys(() => {
      document.transact('host', () => { document.create(noteElement(ID_A)) })
    })
    expect(created.elements.has(ID_A)).toBe(true)

    const patched = document.changedKeys(() => {
      document.transact('host', () => {
        document.patch(ID_A, {
          x: 0, y: 0, w: 10, h: 10, z: 1, updatedAt: 2,
          data: { text: 'changed', font: 'sans', size: 'm', scale: 1 },
        })
      })
    })
    expect(patched.elements.has(ID_A)).toBe(true)

    const removed = document.changedKeys(() => {
      document.transact('host', () => { document.remove(ID_A) })
    })
    expect(removed.elements.has(ID_A)).toBe(true)
    expect(document.hasElement(ID_A)).toBe(false)
    expect(document.changedKeys(() => {}).elements.size).toBe(0)
  })
})
