// The snapshot and operation routes: every answer, every failure code, the
// request bound, and withdrawal with the registering fiber.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import * as Y from 'yjs'
import { openDatabase } from '../src/db.ts'
import { BoardJournal } from '../src/journal.ts'
import { BOARD_OPS_PATH, BOARD_PATH, registerBoardRoutes, type BoardRouteConfig } from '../src/routes.ts'
import { KetosBoardDocService, type KetosBoardDocOptions } from '../src/service.ts'
import type { BoardCreateOp, ElementId } from '../src/types.ts'

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

const ID_A = brandString<ElementId>('00000000-0000-4000-8000-000000000001')
const ID_B = brandString<ElementId>('00000000-0000-4000-8000-000000000002')

/** The deployment limits the fixture mounts. */
const LIMITS = { maxOpsPerRequest: 64, maxElements: 2000, elements: { elementBytesMax: 262_144, noteTextMax: 20_000 } } as const

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
  const root = await mkdtemp(join(tmpdir(), 'dsh-board-route-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

/**
 * Store one element owned by another participant, as a synchronized document
 * would carry it.
 * @param path - database path.
 */
async function seedForeignElement(path: string): Promise<void> {
  const db = await openDatabase(path)
  const doc = new Y.Doc()
  const journal = new BoardJournal(db, doc, 500)
  await journal.load()
  doc.transact(() => {
    const map = new Y.Map<unknown>()
    map.set('kind', 'note')
    map.set('ownerId', 'demo-legal')
    map.set('x', 0)
    map.set('y', 0)
    map.set('w', 10)
    map.set('h', 10)
    map.set('z', 1)
    map.set('createdAt', 1)
    map.set('updatedAt', 1)
    map.set('data', new Y.Map())
    doc.getMap<Y.Map<unknown>>('elements').set(ID_A, map)
  }, 'host')
  journal.close()
  db.close()
}

/** The decoded JSON body of one response. */
async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>
}

interface Fixture {
  readonly service: KetosBoardDocService
  readonly fiber: Fiber
  readonly get: () => Promise<Response>
  readonly post: (body: unknown) => Promise<Response>
}

/**
 * Mount both routes over a fresh context and service.
 * @param options - database path, route config, and service options to replace.
 * @returns the service, the registering fiber, and both request helpers.
 */
async function fixture(options: {
  path?: string
  config?: Partial<BoardRouteConfig>
  service?: Partial<KetosBoardDocOptions>
} = {}): Promise<Fixture> {
  const root = await temporaryDirectory()
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
  const service = new KetosBoardDocService(ctx, {
    path: options.path ?? join(root, 'board.db'),
    limits: { ...LIMITS, elements: { ...LIMITS.elements } },
    journalCompactRows: 500,
    logger: () => {},
    ...options.service,
  })
  cleanups.push(() => service.close())
  const fiber = ctx.plugin({
    inject: ['connection'],
    apply: (scope) => {
      registerBoardRoutes(scope, service, { opLimits: { ...LIMITS }, maxRequestBytes: 1_048_576, ...options.config })
    },
  })
  await fiber
  cleanups.push(() => fiber.dispose())
  const handler = connection.createSharedFetchHandler('/api')
  return {
    service,
    fiber,
    get: () => handler.fetch(new Request(`http://localhost${BOARD_PATH}`)),
    post: (body: unknown) => handler.fetch(new Request(`http://localhost${BOARD_OPS_PATH}`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })),
  }
}

describe('board snapshot route', () => {
  it('answers the snapshot with the private no-store header', async () => {
    const { get } = await fixture()
    const response = await get()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await jsonBody(response)).toMatchObject({
      revision: 0,
      elements: [],
      limits: { elementBytesMax: 262_144 },
    })
  })

  it('answers an empty 500 when the document cannot open', async () => {
    const root = await temporaryDirectory()
    const blocker = join(root, 'blocker')
    await writeFile(blocker, 'not a directory')
    const { get } = await fixture({ path: join(blocker, 'board.db') })
    const response = await get()
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('')
  })
})

describe('board operation route', () => {
  it('creates, patches, and removes through one route', async () => {
    const { get, post } = await fixture()
    const created = await post({ ops: [createOp(ID_A)] })
    expect(created.status).toBe(200)
    expect(await jsonBody(created)).toEqual({ ok: true, revision: 1 })
    const listed = await jsonBody(await get()) as { elements: readonly unknown[] }
    expect(listed.elements).toMatchObject([{ id: ID_A, kind: 'note', z: 1 }])

    expect(await jsonBody(await post({ ops: [{ op: 'patch', id: ID_A, x: 4 }] })))
      .toEqual({ ok: true, revision: 2 })
    expect(await jsonBody(await post({ ops: [{ op: 'remove', id: ID_A }] })))
      .toEqual({ ok: true, revision: 3 })
    const emptied = await jsonBody(await get()) as { elements: readonly unknown[] }
    expect(emptied.elements).toEqual([])
  })

  it('refuses malformed bodies and unknown fields with 400', async () => {
    const { post } = await fixture()
    const bodies: unknown[] = [
      'not json',
      { ops: 'x' },
      { ops: [], extra: 1 },
      { ops: [{ op: 'bogus', id: ID_A }] },
      { ops: [{ op: 'create', id: ID_A, kind: 'note', x: 0, y: 0, w: 1, h: 1, ownerId: 'someone' }] },
    ]
    for (const body of bodies) {
      const response = await post(body)
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect(await jsonBody(response)).toMatchObject({ ok: false, error: 'ketos/invalid' })
    }
  })

  it('answers 404 for a missing element and 409 for another owner', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'board.db')
    await seedForeignElement(path)
    const { post } = await fixture({ path })

    const missing = await post({ ops: [{ op: 'patch', id: ID_B, x: 1 }] })
    expect(missing.status).toBe(404)
    expect(await jsonBody(missing)).toMatchObject({ error: 'ketos/element-not-found' })

    const foreign = await post({ ops: [{ op: 'patch', id: ID_A, x: 1 }] })
    expect(foreign.status).toBe(409)
    expect(await jsonBody(foreign)).toMatchObject({ error: 'ketos/element-foreign' })
    const removal = await post({ ops: [{ op: 'remove', id: ID_A }] })
    expect(removal.status).toBe(409)
    expect(await jsonBody(removal)).toMatchObject({ error: 'ketos/element-foreign' })
  })

  it('answers 409 when the document reached its element budget', async () => {
    const { post } = await fixture({
      config: { opLimits: { ...LIMITS, maxElements: 1 } },
      service: { limits: { ...LIMITS, maxElements: 1 } },
    })
    expect((await post({ ops: [createOp(ID_A)] })).status).toBe(200)
    const over = await post({ ops: [createOp(ID_B)] })
    expect(over.status).toBe(409)
    expect(await jsonBody(over)).toMatchObject({ error: 'ketos/limit' })
  })

  it('answers 413 for a body over the request bound', async () => {
    const { post } = await fixture({ config: { maxRequestBytes: 16 } })
    const response = await post({ ops: [createOp(ID_A)] })
    expect(response.status).toBe(413)
    expect(await jsonBody(response)).toMatchObject({ ok: false, error: 'ketos/invalid' })
  })

  it('answers an empty 500 when the document cannot open', async () => {
    const root = await temporaryDirectory()
    const blocker = join(root, 'blocker')
    await writeFile(blocker, 'not a directory')
    const { post } = await fixture({ path: join(blocker, 'board.db') })
    const response = await post({ ops: [] })
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('')
  })

  it('withdraws both routes when the registering fiber disposes', async () => {
    const { fiber, get, post } = await fixture()
    expect((await get()).status).toBe(200)
    await fiber.dispose()
    expect((await get()).status).toBe(404)
    expect((await post({ ops: [] })).status).toBe(404)
  })
})
