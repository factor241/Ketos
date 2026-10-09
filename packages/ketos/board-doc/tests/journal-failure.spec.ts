// A journal append that fails inside the Yjs update listener leaves the change
// in memory only, and Yjs 13.6.33 then stops dispatching `update` events of
// that document. The service discards such a document and reloads the stored
// state, and a throwing subscriber never turns a committed write into a failure.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import * as Y from 'yjs'
import type { BoardDatabase } from '../src/db.ts'
import { BoardJournalError } from '../src/journal.ts'
import { KetosBoardDocService, type BoardChange } from '../src/service.ts'
import type { BoardCreateOp, ElementId } from '../src/types.ts'

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

/** Fresh temporary directory that the running test owns. */
async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-board-journal-failure-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

/**
 * Mount one service over a fresh context.
 * @param path - database path.
 * @returns the service and its log lines.
 */
function mount(path: string): { service: KetosBoardDocService; logs: string[]; changes: BoardChange[] } {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const logs: string[] = []
  const service = new KetosBoardDocService(ctx, {
    path,
    limits: {
      maxOpsPerRequest: 64,
      maxElements: 2000,
      maxWindowRecords: 100,
      elements: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 },
    },
    journalCompactRows: 500,
    logger: (message) => { logs.push(message) },
  })
  cleanups.push(() => service.close())
  const changes: BoardChange[] = []
  service.subscribe((change) => { changes.push(change) })
  return { service, logs, changes }
}

/**
 * The connection the service itself writes through, so a test can install a
 * trigger on it while the file is locked against every other connection.
 * @param service - a mounted service.
 * @returns the service's open database handle.
 */
async function handleOf(service: KetosBoardDocService): Promise<Awaited<ReturnType<BoardDatabase['handle']>>> {
  const database = Reflect.get(service, 'database') as BoardDatabase
  return database.handle()
}

/**
 * Make every journal append whose origin matches fail.
 * @param service - a mounted service.
 * @param origin - the transaction origin to refuse.
 */
async function refuseAppends(service: KetosBoardDocService, origin: string): Promise<void> {
  const db = await handleOf(service)
  db.exec(`
    CREATE TRIGGER refuse_append BEFORE INSERT ON updates WHEN NEW.origin = '${origin}'
    BEGIN SELECT RAISE(ABORT, 'append refused'); END
  `)
}

/**
 * Let journal appends succeed again.
 * @param service - a mounted service.
 */
async function allowAppends(service: KetosBoardDocService): Promise<void> {
  const db = await handleOf(service)
  db.exec('DROP TRIGGER refuse_append')
}

/**
 * One encoded peer update that adds a participant record.
 * @returns the update bytes.
 */
function peerParticipantUpdate(): Uint8Array {
  const peer = new Y.Doc()
  const map = new Y.Map<unknown>()
  map.set('name', 'Peer')
  map.set('color', 3)
  map.set('updatedAt', 5)
  peer.getMap<Y.Map<unknown>>('participants').set('peer-owner', map)
  const update = Y.encodeStateAsUpdate(peer)
  peer.destroy()
  return update
}

describe('journal append failure', () => {
  it('rejects the batch, reloads the stored state, and keeps accepting writes', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'board.db')
    const { service, changes } = mount(path)
    await service.apply([createOp(ID_A)], 'host')
    await refuseAppends(service, 'host')

    await expect(service.apply([createOp(ID_B)], 'host')).rejects.toBeInstanceOf(BoardJournalError)
    await allowAppends(service)

    const snapshot = await service.snapshot()
    expect(snapshot.elements.map(element => element.id)).toEqual([ID_A])
    expect(snapshot.revision).toBe(1)
    expect(changes).toHaveLength(1)

    expect(await service.apply([createOp(ID_B)], 'host')).toEqual({ revision: 2 })
    await service.close()
    const reopened = mount(path)
    const stored = await reopened.service.snapshot()
    expect(stored.elements.map(element => element.id).sort()).toEqual([ID_A, ID_B])
  })

  it('rejects a peer update with the journal error, then accepts the same update again', async () => {
    const root = await temporaryDirectory()
    const { service, changes } = mount(join(root, 'board.db'))
    await service.apply([createOp(ID_A)], 'host')
    await refuseAppends(service, 'peer')
    const update = peerParticipantUpdate()

    await expect(service.applyRemote(update)).rejects.toBeInstanceOf(BoardJournalError)
    await allowAppends(service)
    expect(await service.participants()).toEqual([])

    await service.applyRemote(update)
    expect((await service.participants()).map(record => record.id)).toEqual(['peer-owner'])
    expect(changes.at(-1)?.participants?.upserts.map(record => record.id)).toEqual(['peer-owner'])
  })

  it('forgets a waiting peer update whose bytes the journal refused', async () => {
    const root = await temporaryDirectory()
    const { service } = mount(join(root, 'board.db'))
    const peer = new Y.Doc()
    const sent: Uint8Array[] = []
    peer.on('update', (update: Uint8Array) => { sent.push(update) })
    peer.getMap('participants').set('owner-first', new Y.Map<unknown>())
    peer.getMap('participants').set('owner-second', new Y.Map<unknown>())
    const [first, second] = sent as [Uint8Array, Uint8Array]
    await service.snapshot()
    await refuseAppends(service, 'peer')

    await expect(service.applyRemote(second)).rejects.toBeInstanceOf(BoardJournalError)
    await allowAppends(service)
    expect(await service.applyRemote(first)).toEqual({ pending: false })
    const replica = new Y.Doc()
    Y.applyUpdate(replica, await service.diffSince(new Uint8Array([0])))
    expect([...replica.getMap('participants').keys()]).toEqual(['owner-first'])
    expect(await service.applyRemote(second)).toEqual({ pending: false })
  })

  it('rejects the own-participant write and leaves no unjournaled record behind', async () => {
    const root = await temporaryDirectory()
    const { service, changes } = mount(join(root, 'board.db'))
    await service.apply([createOp(ID_A)], 'host')
    await refuseAppends(service, 'host')

    await expect(service.putOwnParticipant({ name: 'Me', color: 2 })).rejects.toBeInstanceOf(BoardJournalError)
    await allowAppends(service)
    expect(await service.participants()).toEqual([])
    expect(changes).toHaveLength(1)

    await service.putOwnParticipant({ name: 'Me', color: 2 })
    expect((await service.participants()).map(record => record.name)).toEqual(['Me'])
  })

  it('reloads for a caller that still holds the document the first failure discarded', async () => {
    const root = await temporaryDirectory()
    const { service } = mount(join(root, 'board.db'))
    await service.snapshot()
    await refuseAppends(service, 'host')

    const failing = service.apply([createOp(ID_A)], 'host')
    const waiting = service.apply([createOp(ID_B)], 'browser')
    await expect(failing).rejects.toBeInstanceOf(BoardJournalError)
    await waiting

    const snapshot = await service.snapshot()
    expect(snapshot.elements.map(element => element.id)).toEqual([ID_B])
    expect(snapshot.revision).toBe(1)
  })

  it('never reads the refused change for a reader that obtained the document before the failure', async () => {
    const root = await temporaryDirectory()
    const { service } = mount(join(root, 'board.db'))
    await service.snapshot()
    await refuseAppends(service, 'host')

    const failing = service.apply([createOp(ID_A)], 'host')
    const snapshot = service.snapshot()
    const diff = service.diffSince(new Uint8Array([0]))
    const vector = service.stateVector()
    const participants = service.participants()
    await expect(failing).rejects.toBeInstanceOf(BoardJournalError)

    expect((await snapshot).elements).toEqual([])
    const replica = new Y.Doc()
    Y.applyUpdate(replica, await diff)
    expect(replica.getMap('elements').size).toBe(0)
    expect(Y.decodeStateVector(await vector).size).toBe(0)
    expect(await participants).toEqual([])
  })
})

describe('subscriber failures', () => {
  it('keeps the batch committed and the peer relay running when a local-update listener throws', async () => {
    const root = await temporaryDirectory()
    const { service, logs, changes } = mount(join(root, 'board.db'))
    const relayed: number[] = []
    service.onLocalUpdate(() => { throw new Error('relay failed') })
    service.onLocalUpdate((update) => { relayed.push(update.length) })

    expect(await service.apply([createOp(ID_A)], 'host')).toEqual({ revision: 1 })
    expect(relayed).toHaveLength(1)
    expect(logs).toEqual([expect.stringMatching(/local-update listener failed: .*relay failed/u)])
    expect(changes).toHaveLength(1)

    expect(await service.apply([createOp(ID_B)], 'host')).toEqual({ revision: 2 })
    expect(relayed).toHaveLength(2)
  })

  it('keeps the batch committed when a change subscriber throws', async () => {
    const root = await temporaryDirectory()
    const { service, logs } = mount(join(root, 'board.db'))
    const heard: number[] = []
    service.subscribe(() => { throw new Error('stream failed') })
    service.subscribe((change) => { heard.push(change.revision) })

    expect(await service.apply([createOp(ID_A)], 'browser')).toEqual({ revision: 1 })
    expect(heard).toEqual([1])
    expect(logs).toEqual([expect.stringMatching(/change subscriber failed: .*stream failed/u)])
  })
})
