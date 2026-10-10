// The to-do route: every action's answer and failure code, the owner rule
// that refuses a foreign element before any bd call, the missing-epic marker,
// and the placement race between two tabs.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import { openDatabase } from '@ketos/board-doc/src/db.ts'
import { BoardJournal } from '@ketos/board-doc/src/journal.ts'
import { KetosBoardDocService } from '@ketos/board-doc/src/service.ts'
import type { ElementId } from '@ketos/board-doc/types'
import * as Y from 'yjs'
import { BeadsCommandError, BeadsProtocolError, BeadsUnavailableError } from '../src/beads.ts'
import type { BeadsIssue } from '../src/beads.ts'
import { registerTodoRoutes, TODO_PATH } from '../src/routes.ts'
import type { TodoBeads, TodoDoc } from '../src/routes.ts'

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

/** Fresh temporary directory that the running test owns. */
async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-board-todo-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

/** One scripted Beads issue. */
function issue(id: string, title: string, status: 'open' | 'closed' = 'open'): BeadsIssue {
  return { id: brandString<BeadsIssue['id']>(id), title, status, createdAt: '2026-10-05T23:32:37Z' }
}

/** The `bd` double: one epic, its items, and a scripted failure. */
class FakeBeads implements TodoBeads {
  readonly calls: string[] = []
  epic = issue('kt-1', 'Список')
  readonly items: BeadsIssue[] = []
  missing = false
  failure: Error | undefined

  createEpic(title: string): Promise<BeadsIssue> {
    this.calls.push('createEpic')
    this.throwIfFailed()
    this.epic = { ...this.epic, title }
    return Promise.resolve(this.epic)
  }

  createItem(epicId: BeadsIssue['id'], title: string): Promise<BeadsIssue> {
    this.calls.push('createItem')
    this.throwIfFailed()
    const item = issue(`${epicId}.${String(this.items.length + 1)}`, title)
    this.items.push(item)
    return Promise.resolve(item)
  }

  setDone(id: BeadsIssue['id'], done: boolean): Promise<BeadsIssue> {
    this.calls.push('setDone')
    this.throwIfFailed()
    const index = this.items.findIndex(item => item.id === id)
    const updated = { ...(this.items[index] as BeadsIssue), status: done ? 'closed' as const : 'open' as const }
    this.items[index] = updated
    return Promise.resolve(updated)
  }

  children(): Promise<BeadsIssue[]> {
    this.calls.push('children')
    this.throwIfFailed()
    return Promise.resolve([...this.items])
  }

  show(): Promise<BeadsIssue | undefined> {
    this.calls.push('show')
    this.throwIfFailed()
    return Promise.resolve(this.missing ? undefined : this.epic)
  }

  private throwIfFailed(): void {
    if (this.failure !== undefined) throw this.failure
  }
}

/**
 * Store one element directly in the database before the service opens it, as
 * a synchronized document from another Ketos would arrive.
 * @param path - database path.
 * @param id - element id.
 * @param kind - element kind.
 * @param ownerId - element owner.
 * @param data - element data fields.
 */
async function seedElement(path: string, id: ElementId, kind: string, ownerId: string, data: Record<string, unknown>): Promise<void> {
  const db = await openDatabase(path)
  const doc = new Y.Doc()
  const journal = new BoardJournal(db, doc, 500, () => {})
  await journal.load()
  doc.transact(() => {
    const map = new Y.Map<unknown>()
    map.set('kind', kind)
    map.set('ownerId', ownerId)
    map.set('x', 0)
    map.set('y', 0)
    map.set('w', 280)
    map.set('h', 240)
    map.set('z', 1)
    map.set('createdAt', 1)
    map.set('updatedAt', 1)
    const dataMap = new Y.Map<unknown>()
    for (const [key, value] of Object.entries(data)) dataMap.set(key, value)
    map.set('data', dataMap)
    doc.getMap<Y.Map<unknown>>('elements').set(id, map)
  }, 'host')
  journal.close()
  db.close()
}

interface Fixture {
  readonly path: string
  readonly service: KetosBoardDocService
  readonly beads: FakeBeads
  readonly logs: string[]
  readonly failures: { throwOnApply: boolean }
  readonly post: (body: unknown) => Promise<Response>
  /** Mark one element as waiting for placement, as the `/todo` command leaves it. */
  readonly pend: (id: string) => Promise<void>
}

/**
 * Mount the route over a real board document and one scripted bd.
 * @param options - item limit and title bound to replace.
 * @returns the database path, the doubles, and the request helper.
 */
async function fixture(options: { todoItemsMax?: number; titleMaxChars?: number } = {}): Promise<Fixture> {
  const root = await temporaryDirectory()
  const path = join(root, 'board.db')
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
  const service = new KetosBoardDocService(ctx, {
    path,
    limits: {
      maxOpsPerRequest: 64,
      maxElements: 2000,
      maxWindowRecords: 100,
      elements: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: options.todoItemsMax ?? 200 },
    },
    journalCompactRows: 500,
    logger: () => {},
  })
  cleanups.push(() => service.close())
  const failures = { throwOnApply: false }
  const doc: TodoDoc = {
    selfId: () => service.selfId(),
    snapshot: () => service.snapshot(),
    apply: (ops, origin) => failures.throwOnApply ? Promise.reject(new Error('apply exploded')) : service.apply(ops, origin),
  }
  const beads = new FakeBeads()
  const logs: string[] = []
  const fiber = ctx.plugin({
    inject: ['connection'],
    apply: (scope) => {
      registerTodoRoutes(scope, {
        doc,
        beads,
        titleMaxChars: options.titleMaxChars ?? 200,
        logger: (message) => { logs.push(message) },
      })
    },
  })
  await fiber
  cleanups.push(() => fiber.dispose())
  const handler = connection.createSharedFetchHandler('/api')
  return {
    path,
    service,
    beads,
    logs,
    failures,
    post: body => handler.fetch(new Request(`http://localhost${TODO_PATH}`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })),
    pend: async (id) => {
      await service.apply([{
        op: 'patch',
        id: brandString<ElementId>(id),
        data: { pendingPlacement: true },
      }], 'host')
    },
  }
}

/** The decoded body of one response. */
async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>
}

const ID_FOREIGN = brandString<ElementId>('00000000-0000-4000-8000-0000000000f1')
const ID_NOTE = brandString<ElementId>('00000000-0000-4000-8000-0000000000f2')
const ID_BROKEN = brandString<ElementId>('00000000-0000-4000-8000-0000000000f3')

/** One valid list snapshot for seeded elements. */
const SNAPSHOT = {
  epicId: 'kt-9',
  title: 'Чужой список',
  items: [{ id: 'kt-9.1', title: 'Молоко', status: 'open' }],
  syncedAt: '2026-10-06T12:00:00Z',
}

/**
 * Create one list through the route and return its element id.
 * @param fix - the fixture.
 * @param title - list title.
 * @returns the created element id.
 */
async function createList(fix: Fixture, title = 'Список'): Promise<string> {
  const response = await fix.post({ action: 'create', title, x: 10, y: 20 })
  expect(response.status).toBe(200)
  return (await body(response))['elementId'] as string
}

describe('to-do route: create', () => {
  it('creates the epic and one element in the center the caller asked for', async () => {
    const fix = await fixture()
    const response = await fix.post({ action: 'create', title: '  Покупки  ', x: 10, y: 20 })
    expect(response.status).toBe(200)
    const answer = await body(response)
    expect(answer['ok']).toBe(true)
    expect(typeof answer['elementId']).toBe('string')
    expect(fix.beads.calls).toEqual(['createEpic', 'children'])
    expect(fix.beads.epic.title).toBe('Покупки')
  })

  it('refuses malformed bodies before any bd call', async () => {
    const fix = await fixture()
    const cases: unknown[] = [
      'not json',
      null,
      [],
      { action: 'rename' },
      { action: 'create', title: 'x', x: 0, y: 0, extra: 1 },
      { action: 'create', title: '', x: 0, y: 0 },
      { action: 'create', title: 7, x: 0, y: 0 },
      { action: 'create', title: 'x', x: 'left', y: 0 },
      { action: 'create', title: 'x', x: Number.NaN, y: 0 },
      { action: 'create', title: 'x', x: 100_001, y: 0 },
      { action: 'addItem', elementId: 'nope', title: 'x' },
      { action: 'setDone', elementId: '00000000-0000-4000-8000-000000000001', itemId: 'KT-1', done: true },
      { action: 'setDone', elementId: '00000000-0000-4000-8000-000000000001', itemId: 'kt-1', done: 'yes' },
      { action: 'setDone', elementId: '00000000-0000-4000-8000-000000000001', done: true },
      { action: 'refresh' },
      { action: 'place', elementId: '00000000-0000-4000-8000-000000000001', x: 0, y: 0, z: 1 },
    ]
    for (const payload of cases) {
      const response = await fix.post(payload)
      expect(response.status).toBe(400)
      expect((await body(response))['error']).toBe('ketos/invalid')
    }
    expect(fix.beads.calls).toEqual([])
  })

  it('refuses a title longer than the deployment bound', async () => {
    const fix = await fixture({ titleMaxChars: 4 })
    const response = await fix.post({ action: 'create', title: 'Покупки', x: 0, y: 0 })
    expect(response.status).toBe(400)
  })
})

describe('to-do route: items', () => {
  it('adds an item and writes the re-read snapshot', async () => {
    const fix = await fixture()
    const id = await createList(fix)
    const response = await fix.post({ action: 'addItem', elementId: id, title: 'Молоко' })
    expect(response.status).toBe(200)
    expect(fix.beads.calls).toEqual(['createEpic', 'children', 'createItem', 'children'])
    const snapshot = await fix.post({ action: 'addItem', elementId: id, title: 'Хлеб' })
    expect(snapshot.status).toBe(200)
  })

  it('refuses one item over the deployment limit before calling bd', async () => {
    const fix = await fixture({ todoItemsMax: 1 })
    const id = await createList(fix)
    await fix.post({ action: 'addItem', elementId: id, title: 'Молоко' })
    fix.beads.calls.length = 0
    const response = await fix.post({ action: 'addItem', elementId: id, title: 'Хлеб' })
    expect(response.status).toBe(409)
    expect((await body(response))['error']).toBe('ketos/limit')
    expect(fix.beads.calls).toEqual([])
  })

  it('closes and reopens an item, idempotently', async () => {
    const fix = await fixture()
    const id = await createList(fix)
    await fix.post({ action: 'addItem', elementId: id, title: 'Молоко' })
    const itemId = fix.beads.items[0]?.id as string
    const closed = await fix.post({ action: 'setDone', elementId: id, itemId, done: true })
    expect(closed.status).toBe(200)
    const again = await fix.post({ action: 'setDone', elementId: id, itemId, done: true })
    expect(again.status).toBe(200)
    const opened = await fix.post({ action: 'setDone', elementId: id, itemId, done: false })
    expect(opened.status).toBe(200)
    expect(fix.beads.items[0]?.status).toBe('open')
  })

  it('refuses an item that does not belong to the list before calling bd', async () => {
    const fix = await fixture()
    const id = await createList(fix)
    fix.beads.calls.length = 0
    const response = await fix.post({ action: 'setDone', elementId: id, itemId: 'kt-999.1', done: true })
    expect(response.status).toBe(400)
    expect(fix.beads.calls).toEqual([])
  })
})

describe('to-do route: refresh', () => {
  it('marks a missing epic and keeps the items', async () => {
    const fix = await fixture()
    const id = await createList(fix)
    await fix.post({ action: 'addItem', elementId: id, title: 'Молоко' })
    fix.beads.missing = true
    const response = await fix.post({ action: 'refresh', elementId: id })
    expect(response.status).toBe(200)
    const listed = await fix.service.snapshot()
    const element = listed.elements.find(candidate => candidate.id === id)
    expect(element?.data).toMatchObject({ missing: true, items: [{ title: 'Молоко' }] })
  })

  it('clears the marker and takes the epic title when the epic returns', async () => {
    const fix = await fixture()
    const id = await createList(fix)
    fix.beads.missing = true
    await fix.post({ action: 'refresh', elementId: id })
    fix.beads.missing = false
    fix.beads.epic = issue('kt-1', 'Новое имя')
    const response = await fix.post({ action: 'refresh', elementId: id })
    expect(response.status).toBe(200)
    const listed = await fix.service.snapshot()
    expect(listed.elements.find(candidate => candidate.id === id)?.data).toMatchObject({ title: 'Новое имя' })
    expect(listed.elements.find(candidate => candidate.id === id)?.data).not.toHaveProperty('missing')
  })
})

describe('to-do route: placement', () => {
  it('places a pending list exactly once', async () => {
    const fix = await fixture()
    const id = await createList(fix)
    // The route create places immediately; a command-created list waits, so
    // seed the pending flag through a direct host patch of the same document.
    await fix.pend(id)
    const first = await fix.post({ action: 'place', elementId: id, x: 100, y: 200 })
    expect(first.status).toBe(200)
    const second = await fix.post({ action: 'place', elementId: id, x: 300, y: 400 })
    expect(second.status).toBe(409)
    expect((await body(second))['error']).toBe('ketos/placement-taken')
  })

  it('lets one of two concurrent placements win', async () => {
    const fix = await fixture()
    const id = await createList(fix)
    await fix.pend(id)
    const [first, second] = await Promise.all([
      fix.post({ action: 'place', elementId: id, x: 1, y: 2 }),
      fix.post({ action: 'place', elementId: id, x: 3, y: 4 }),
    ])
    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([200, 409])
  })

  it('keeps the queue running after a failed placement', async () => {
    const fix = await fixture()
    const id = await createList(fix)
    await fix.pend(id)
    fix.failures.throwOnApply = true
    const failed = await fix.post({ action: 'place', elementId: id, x: 1, y: 2 })
    expect(failed.status).toBe(500)
    fix.failures.throwOnApply = false
    const placed = await fix.post({ action: 'place', elementId: id, x: 1, y: 2 })
    expect(placed.status).toBe(200)
  })

  it('refuses placement of a list that is not pending', async () => {
    const fix = await fixture()
    const id = await createList(fix)
    const response = await fix.post({ action: 'place', elementId: id, x: 1, y: 2 })
    expect(response.status).toBe(409)
  })
})

describe('to-do route: ownership and existence', () => {
  it('refuses a foreign element without any bd call', async () => {
    const fix = await fixture()
    await seedElement(fix.path, ID_FOREIGN, 'todo', 'demo-legal', SNAPSHOT)
    const response = await fix.post({ action: 'addItem', elementId: ID_FOREIGN, title: 'x' })
    expect(response.status).toBe(409)
    expect((await body(response))['error']).toBe('ketos/not-owner')
    expect(fix.beads.calls).toEqual([])
  })

  it('answers 404 for a missing element and for a non-list element', async () => {
    const fix = await fixture()
    await seedElement(fix.path, ID_NOTE, 'note', 'demo-legal', { text: '', font: 'sans', size: 'm', scale: 1 })
    const missing = await fix.post({ action: 'refresh', elementId: '00000000-0000-4000-8000-00000000dead' })
    expect(missing.status).toBe(404)
    const note = await fix.post({ action: 'refresh', elementId: ID_NOTE })
    expect(note.status).toBe(404)
    expect(fix.beads.calls).toEqual([])
  })

  it('answers 404 for a todo element whose snapshot is unreadable', async () => {
    const fix = await fixture()
    await seedElement(fix.path, ID_BROKEN, 'todo', 'demo-legal', { a: 1 })
    const response = await fix.post({ action: 'refresh', elementId: ID_BROKEN })
    expect(response.status).toBe(404)
    expect(fix.beads.calls).toEqual([])
  })
})

describe('to-do route: bd failures', () => {
  it('answers 502 without the stderr and logs it', async () => {
    const fix = await fixture()
    fix.beads.failure = new BeadsCommandError(1, 'secret stderr', 'bd create failed')
    const response = await fix.post({ action: 'create', title: 'x', x: 0, y: 0 })
    expect(response.status).toBe(502)
    expect(await body(response)).toEqual({ ok: false, error: 'ketos/beads-failed' })
    expect(fix.logs).toEqual(['to-do list: bd create failed: secret stderr'])
  })

  it('logs a timed-out bd call by its message, which carries no stderr', async () => {
    const fix = await fixture()
    fix.beads.failure = new BeadsCommandError(null, '', 'bd init --prefix kt timed out after 15000ms')
    const response = await fix.post({ action: 'create', title: 'x', x: 0, y: 0 })
    expect(response.status).toBe(502)
    expect(await body(response)).toEqual({ ok: false, error: 'ketos/beads-failed' })
    expect(fix.logs).toEqual(['to-do list: bd init --prefix kt timed out after 15000ms'])
  })

  it('answers 502 for a protocol failure and 503 for a missing executable', async () => {
    const fix = await fixture()
    fix.beads.failure = new BeadsProtocolError('odd answer')
    const protocol = await fix.post({ action: 'create', title: 'x', x: 0, y: 0 })
    expect(protocol.status).toBe(502)
    fix.beads.failure = new BeadsUnavailableError('no bd')
    const unavailable = await fix.post({ action: 'create', title: 'x', x: 0, y: 0 })
    expect(unavailable.status).toBe(503)
  })

  it('answers an empty 500 for an unexpected failure', async () => {
    const fix = await fixture()
    fix.failures.throwOnApply = true
    const response = await fix.post({ action: 'create', title: 'x', x: 0, y: 0 })
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('')
  })
})
