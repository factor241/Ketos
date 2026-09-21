/** The /api/ketos.clones route: every operation, every failure code, and disposal. */
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { CloneDatabase } from '../src/db.ts'
import { CLONES_PATH, registerCloneRoutes } from '../src/routes.ts'
import type { CloneAnswerResponse, CloneListResponse } from '../src/types.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

/** One booted route handler over a temporary database. */
async function fixture(path?: string) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-clone-route-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const database = new CloneDatabase(path ?? join(root, 'clones.db'))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
  const fiber = ctx.plugin({ inject: ['connection'], apply: (scope) => { registerCloneRoutes(scope, database) } })
  await fiber
  cleanups.push(() => fiber.dispose())
  const handler = connection.createSharedFetchHandler('/api')
  const post = async (body: unknown): Promise<Response> => handler.fetch(new Request(
    `http://localhost${CLONES_PATH}`,
    { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } },
  ))
  const get = (): Promise<Response> => handler.fetch(new Request(`http://localhost${CLONES_PATH}`))
  return { database, fiber, handler, post, get }
}

/** The decoded body, narrowed to a successful answer. */
async function body<T>(response: Response): Promise<T> {
  return await response.json() as T
}

describe('clone route operations', () => {
  it('lists clones over GET and POST list with a private no-store answer', async () => {
    const { post, get } = await fixture()
    const empty = await get()
    expect(empty.status).toBe(200)
    expect(empty.headers.get('cache-control')).toBe('no-store')
    expect(await body<CloneListResponse>(empty)).toEqual({ ok: true, clones: [] })
    await post({ op: 'create', name: 'Анна', role: 'Аналитик' })
    expect(await body<CloneListResponse>(await get())).toMatchObject({ ok: true, clones: [{ name: 'Анна' }] })
    expect((await post({ op: 'list' })).status).toBe(200)
  })

  it('creates, reads, updates, and deletes one clone with revision CAS', async () => {
    const { post } = await fixture()
    const created = await body<CloneAnswerResponse>(await post({
      op: 'create', name: 'Анна', role: 'Аналитик', description: 'Разбор', preferredModel: 'deepseek-chat', skills: ['sql'], status: 'interviewing',
    }))
    expect(created.clone).toMatchObject({ name: 'Анна', preferredModel: 'deepseek-chat', skills: ['sql'], status: 'interviewing', revision: 1 })

    const fetched = await body<CloneAnswerResponse>(await post({ op: 'get', id: created.clone.id }))
    expect(fetched.clone).toEqual(created.clone)

    const updated = await body<CloneAnswerResponse>(await post({
      op: 'update', id: created.clone.id, revision: 1, patch: { name: 'Анна П.', preferredModel: null, skills: ['sql', 'анализ'] },
    }))
    expect(updated.clone).toMatchObject({ name: 'Анна П.', preferredModel: null, skills: ['sql', 'анализ'], revision: 2 })

    expect(await body(await post({ op: 'delete', id: created.clone.id, revision: 2 }))).toEqual({ ok: true, id: created.clone.id })
    expect((await post({ op: 'get', id: created.clone.id })).status).toBe(404)
  })

  it('binds a session to a clone and lists the bindings', async () => {
    const { post } = await fixture()
    const created = await body<CloneAnswerResponse>(await post({ op: 'create', name: 'Анна', role: 'Аналитик' }))
    const bound = await post({ op: 'bindSession', cloneId: created.clone.id, sessionId: 'session-1', role: 'interview' })
    expect(await body(bound)).toMatchObject({ ok: true, binding: { sessionId: 'session-1', role: 'interview' } })
    expect(await body(await post({ op: 'listSessions', cloneId: created.clone.id }))).toMatchObject({
      ok: true,
      sessions: [{ sessionId: 'session-1' }],
    })
  })
})

describe('clone route failures', () => {
  it('answers 404 for an absent clone and a clone a binding names', async () => {
    const { post } = await fixture()
    for (const request of [
      { op: 'get', id: 'missing' },
      { op: 'update', id: 'missing', revision: 1, patch: { name: 'X' } },
      { op: 'delete', id: 'missing', revision: 1 },
      { op: 'bindSession', cloneId: 'missing', sessionId: 'session-1' },
    ]) {
      const response = await post(request)
      expect(response.status).toBe(404)
      expect(await body(response)).toEqual({ ok: false, error: 'ketos/clone-not-found' })
    }
  })

  it('answers 409 when a caller writes under a stale revision', async () => {
    const { post } = await fixture()
    const created = await body<CloneAnswerResponse>(await post({ op: 'create', name: 'Анна', role: 'Аналитик' }))
    await post({ op: 'update', id: created.clone.id, revision: 1, patch: { name: 'Анна II' } })
    const conflict = await post({ op: 'update', id: created.clone.id, revision: 1, patch: { name: 'Анна III' } })
    expect(conflict.status).toBe(409)
    expect(await body(conflict)).toEqual({ ok: false, error: 'ketos/clone-conflict' })
    expect((await post({ op: 'delete', id: created.clone.id, revision: 1 })).status).toBe(409)
  })

  it('answers 400 for every malformed request without opening the database', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-clone-invalid-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const path = join(root, 'clones.db')
    const { post } = await fixture(path)
    expect((await post({ op: 'unknown' })).status).toBe(400)
    // Validation runs before the lazy open, so a garbage request never creates
    // the file.
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('answers 400 for every malformed request without touching the store', async () => {
    const { post, get } = await fixture()
    const rejected: unknown[] = [
      'not json',
      [],
      { op: 'unknown' },
      { op: 'get' },
      { op: 'create', name: '  ', role: 'Аналитик' },
      { op: 'create', name: 'Анна' },
      { op: 'create', name: 'x'.repeat(121), role: 'Аналитик' },
      { op: 'create', name: 'Анна', role: 'Аналитик', extra: true },
      { op: 'create', name: 'Анна', role: 'Аналитик', status: 'whatever' },
      { op: 'create', name: 'Анна', role: 'Аналитик', skills: 'sql' },
      { op: 'create', name: 'Анна', role: 'Аналитик', skills: [1] },
      { op: 'create', name: 'Анна', role: 'Аналитик', description: 7 },
      { op: 'create', name: 'Анна', role: 'Аналитик', preferredModel: 7 },
      { op: 'update', id: 'x', revision: 1, patch: {} },
      { op: 'update', id: 'x', revision: 1, patch: [] },
      { op: 'update', id: 'x', revision: 1, patch: { unknown: 1 } },
      { op: 'update', id: 'x', revision: 0, patch: { name: 'X' } },
      { op: 'update', id: 'x', revision: 1.5, patch: { name: 'X' } },
      { op: 'update', id: 'x', revision: 1, patch: { name: '   ' } },
      { op: 'bindSession', cloneId: 'x' },
      { op: 'bindSession', cloneId: 'x', sessionId: 'y', role: '' },
      { op: 'bindSession', cloneId: 'x', sessionId: 'y', role: 'task' },
      { op: 'update', id: 'x', revision: 1, patch: { status: 'active' } },
      { op: 'update', id: 'x', revision: 1, patch: { skills: 'sql' } },
      { op: 'listSessions', cloneId: 'x', extra: 1 },
    ]
    for (const request of rejected) {
      const response = await post(request)
      expect(response.status, JSON.stringify(request)).toBe(400)
      expect(await body(response)).toEqual({ ok: false, error: 'ketos/invalid' })
    }
    expect(await body<CloneListResponse>(await get())).toEqual({ ok: true, clones: [] })
  })

  it('answers 500 without a code when the database cannot open', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-clone-broken-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const directory = join(root, 'clones.db')
    await mkdir(directory)
    const { get } = await fixture(directory)
    const response = await get()
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('clone request failed')
  })

  it('reports a mutation to the interview coordinator once it committed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-clone-mutated-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const database = new CloneDatabase(join(root, 'clones.db'))
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
    let mutations = 0
    const fiber = ctx.plugin({
      inject: ['connection'],
      apply: (scope) => { registerCloneRoutes(scope, database, () => { mutations += 1 }) },
    })
    await fiber
    cleanups.push(() => fiber.dispose())
    const handler = connection.createSharedFetchHandler('/api')
    const post = async (body: unknown): Promise<Response> => handler.fetch(new Request(
      `http://localhost${CLONES_PATH}`,
      { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } },
    ))
    // Reads and refused writes notify nothing; accepted writes notify once each.
    await handler.fetch(new Request(`http://localhost${CLONES_PATH}`))
    expect(mutations).toBe(0)
    await post({ op: 'get', id: 'missing' })
    expect(mutations).toBe(0)
    const created = await body<CloneAnswerResponse>(await post({ op: 'create', name: 'Анна', role: 'Аналитик' }))
    expect(mutations).toBe(1)
    await post({ op: 'bindSession', cloneId: created.clone.id, sessionId: 'session-1', role: 'interview' })
    expect(mutations).toBe(2)
    await post({ op: 'update', id: created.clone.id, revision: 1, patch: { status: 'ready' } })
    expect(mutations).toBe(3)
  })

  it('withdraws the route when its fiber disposes', async () => {
    const { fiber, get, handler } = await fixture()
    expect((await get()).status).toBe(200)
    await fiber.dispose()
    expect((await handler.fetch(new Request(`http://localhost${CLONES_PATH}`))).status).toBe(404)
  })
})
