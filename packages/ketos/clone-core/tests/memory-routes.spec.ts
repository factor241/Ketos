/** The /api/ketos.memory route: every operation, every failure code, and disposal. */
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { CloneDatabase } from '../src/db.ts'
import { MEMORY_LIMITS } from '../src/memory.ts'
import { MEMORY_PATH, registerMemoryRoutes } from '../src/memory-routes.ts'
import type { CloneId, CloneRecord, MemoryListResponse, MemoryAnswerResponse } from '../src/types.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

/** One booted route handler: its database, its request helpers, and its clone. */
interface Fixture {
  readonly database: CloneDatabase
  readonly ctx: Context
  readonly fiber: { dispose: () => Promise<void> }
  readonly handler: { fetch: (request: Request) => Promise<Response> }
  readonly post: (body: unknown) => Promise<Response>
  /** Clone the seeded fixture stores; absent when the database cannot open. */
  readonly clone: CloneRecord | undefined
  /** Accepted writes the route reported to its mutation observer. */
  readonly mutations: () => number
}

/** A fixture whose database opened and holds one clone. */
interface SeededFixture extends Fixture {
  readonly clone: CloneRecord
}

/**
 * One booted route handler over a temporary database.
 * @param path - database path; a temporary file is used when absent.
 * @param seedClone - whether to store one clone for the operations to name.
 * @returns the booted fixture.
 */
async function boot(path?: string, seedClone = true): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-route-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const database = new CloneDatabase(path ?? join(root, 'clones.db'))
  cleanups.push(() => database.close())
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
  let mutations = 0
  const fiber = ctx.plugin({
    inject: ['connection'],
    apply: (scope) => { registerMemoryRoutes(scope, database, () => { mutations += 1 }) },
  })
  await fiber
  cleanups.push(() => fiber.dispose())
  const handler = connection.createSharedFetchHandler('/api')
  const post = async (body: unknown): Promise<Response> => handler.fetch(new Request(
    `http://localhost${MEMORY_PATH}`,
    { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } },
  ))
  const clone = seedClone
    ? (await database.repository()).createClone({ name: 'Анна', role: 'Аналитик' })
    : undefined
  return { database, ctx, fiber, handler, post, clone, mutations: (): number => mutations }
}

/**
 * A booted route handler whose database holds one clone.
 * @param path - database path; a temporary file is used when absent.
 * @returns the booted fixture.
 */
async function fixture(path?: string): Promise<SeededFixture> {
  const f = await boot(path)
  return { ...f, clone: f.clone as CloneRecord }
}

/** The decoded body, narrowed to a successful answer. */
async function body<T>(response: Response): Promise<T> {
  return await response.json() as T
}

describe('memory route operations', () => {
  it('lists and searches the memories of one clone with a private no-store answer', async () => {
    const f = await fixture()
    const empty = await f.post({ op: 'list', cloneId: f.clone.id })
    expect(empty.status).toBe(200)
    expect(empty.headers.get('cache-control')).toBe('no-store')
    expect(await body<MemoryListResponse>(empty)).toEqual({ ok: true, memories: [] })

    const memories = await f.database.memoryRepository()
    const first = memories.remember({ cloneId: f.clone.id, content: 'Новый навык анализа', tags: ['право'] })
    memories.remember({ cloneId: f.clone.id, content: 'Любит короткие письма' })

    expect(await body<MemoryListResponse>(await f.post({ op: 'list', cloneId: f.clone.id })))
      .toMatchObject({ ok: true, memories: [{ content: 'Любит короткие письма' }, { content: 'Новый навык анализа' }] })

    const found = await body<MemoryListResponse>(await f.post({ op: 'search', cloneId: f.clone.id, query: 'навык' }))
    expect(found.memories).toHaveLength(1)
    expect(found.memories[0]).toMatchObject({ id: first.id, content: 'Новый навык анализа', tags: ['право'], sourceSessionId: null, status: 'active' })
  })

  it('updates the content, tags, and status of one memory', async () => {
    const f = await fixture()
    const memory = (await f.database.memoryRepository()).remember({ cloneId: f.clone.id, content: 'Факт' })
    const updated = await body<MemoryAnswerResponse>(await f.post({
      op: 'update', id: memory.id, patch: { content: 'Уточнённый факт', tags: ['новое'], status: 'archived' },
    }))
    expect(updated.memory).toMatchObject({ content: 'Уточнённый факт', tags: ['новое'], status: 'archived' })
    expect(await body<MemoryListResponse>(await f.post({ op: 'list', cloneId: f.clone.id, status: 'archived' })))
      .toMatchObject({ memories: [{ id: memory.id }] })
    expect(f.mutations()).toBe(1)
  })

  it('deletes one memory and reports the removed identity', async () => {
    const f = await fixture()
    const memory = (await f.database.memoryRepository()).remember({ cloneId: f.clone.id, content: 'Факт' })
    expect(await body(await f.post({ op: 'delete', id: memory.id }))).toEqual({ ok: true, id: memory.id })
    expect(await body<MemoryListResponse>(await f.post({ op: 'list', cloneId: f.clone.id })))
      .toEqual({ ok: true, memories: [] })
    expect(f.mutations()).toBe(1)
  })

  it('answers 404 for a memory that does not exist', async () => {
    const f = await fixture()
    for (const request of [
      { op: 'update', id: 'missing', patch: { content: 'X' } },
      { op: 'delete', id: 'missing' },
    ]) {
      const response = await f.post(request)
      expect(response.status).toBe(404)
      expect(await body(response)).toEqual({ ok: false, error: 'ketos/memory-not-found' })
    }
  })

  it('answers 400 for every malformed request without touching the store', async () => {
    const f = await fixture()
    const rejected: unknown[] = [
      'not json',
      [],
      { op: 'unknown' },
      { op: 'list' },
      { op: 'list', cloneId: f.clone.id, extra: true },
      { op: 'list', cloneId: f.clone.id, status: 'whatever' },
      { op: 'search', cloneId: f.clone.id },
      { op: 'search', cloneId: f.clone.id, query: '   ' },
      { op: 'search', cloneId: f.clone.id, query: 'навык', limit: 0 },
      { op: 'search', cloneId: f.clone.id, query: 'навык', limit: 21 },
      { op: 'search', cloneId: f.clone.id, query: 'навык', limit: 1.5 },
      { op: 'search', cloneId: f.clone.id, query: 'x'.repeat(MEMORY_LIMITS.query + 1) },
      { op: 'search', cloneId: f.clone.id, query: '()' },
      { op: 'update', id: 'x', patch: {} },
      { op: 'update', id: 'x', patch: [] },
      { op: 'update', id: 'x', patch: { unknown: 1 } },
      { op: 'update', id: 'x', patch: { content: '' } },
      { op: 'update', id: 'x', patch: { content: 'x'.repeat(4001) } },
      { op: 'update', id: 'x', patch: { tags: 'sql' } },
      { op: 'update', id: 'x', patch: { status: 'broken' } },
      { op: 'delete', id: 'x', extra: 1 },
    ]
    for (const request of rejected) {
      const response = await f.post(request)
      expect(response.status, JSON.stringify(request)).toBe(400)
      expect(await body(response)).toEqual({ ok: false, error: 'ketos/invalid' })
    }
    expect(await body<MemoryListResponse>(await f.post({ op: 'list', cloneId: f.clone.id })))
      .toEqual({ ok: true, memories: [] })
  })

  it('refuses an unsearchable query without opening the database', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-memory-lazy-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const path = join(root, 'clones.db')
    const f = await boot(path, false)
    for (const query of ['()', '   ', 'навык\u0000ещё']) {
      const response = await f.post({ op: 'search', cloneId: 'clone-1', query })
      expect(response.status, JSON.stringify(query)).toBe(400)
      expect(await body(response)).toEqual({ ok: false, error: 'ketos/invalid' })
    }
    // Validation runs before the lazy open, so a refused query never creates
    // the file.
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses a malformed tag without opening the database', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-memory-tag-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const path = join(root, 'clones.db')
    const f = await boot(path, false)
    for (const patch of [{ tags: ['a,b'] }, { tags: ['   '] }, { tags: ['a\nb'] }, { tags: ['a\u0000b'] }]) {
      const response = await f.post({ op: 'update', id: 'm1', patch })
      expect(response.status, JSON.stringify(patch)).toBe(400)
      expect(await body(response)).toEqual({ ok: false, error: 'ketos/invalid' })
    }
    // The store's tag rules run before the lazy open, so the answer is 400
    // whether or not the named memory exists, and no file is created.
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('answers 500 without a code when the database cannot open', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-memory-broken-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const directory = join(root, 'clones.db')
    await mkdir(directory)
    const f = await boot(directory, false)
    const response = await f.post({ op: 'list', cloneId: 'x' as CloneId })
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('memory request failed')
  })

  it('withdraws the route when its fiber disposes', async () => {
    const f = await fixture()
    expect((await f.post({ op: 'list', cloneId: f.clone.id })).status).toBe(200)
    await f.fiber.dispose()
    expect((await f.handler.fetch(new Request(`http://localhost${MEMORY_PATH}`, {
      method: 'POST',
      body: JSON.stringify({ op: 'list', cloneId: f.clone.id }),
    }))).status).toBe(404)
  })
})

describe('memory route clone scoping', () => {
  it('leaves another clone memory untouched', async () => {
    const f = await fixture()
    const other = (await f.database.repository()).createClone({ name: 'Борис', role: 'Юрист' })
    const memories = await f.database.memoryRepository()
    memories.remember({ cloneId: f.clone.id, content: 'Навык Анны' })
    memories.remember({ cloneId: other.id, content: 'Навык Бориса' })
    const listed = await body<MemoryListResponse>(await f.post({ op: 'list', cloneId: other.id }))
    expect(listed.memories.map(memory => memory.content)).toEqual(['Навык Бориса'])
    const found = await body<MemoryListResponse>(await f.post({ op: 'search', cloneId: other.id, query: 'навык' }))
    expect(found.memories.map(memory => memory.content)).toEqual(['Навык Бориса'])
  })
})
