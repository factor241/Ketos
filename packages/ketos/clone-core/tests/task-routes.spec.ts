/** The /api/ketos.tasks route: every operation, every failure code, and laziness. */
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloneDatabase } from '../src/db.ts'
import { CloneNotFoundError } from '../src/repository.ts'
import { DEFAULT_TASK_ROUNDS, TaskNotFoundError, TaskStateError } from '../src/task-repository.ts'
import { registerTaskRoutes, TASKS_PATH } from '../src/task-routes.ts'
import { AgentNotLiveError } from '../src/task-runner.ts'
import type { CloneId, TaskAnswerResponse, TaskId, TaskListResponse } from '../src/types.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

/** One booted tasks route over a temporary database with lifecycle hooks over the same store. */
async function fixture(path?: string) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-clone-task-route-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const database = new CloneDatabase(path ?? join(root, 'clones.db'))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
  let mutations = 0
  const hooks = {
    start: vi.fn((taskId: TaskId, sessionId: SessionId) =>
      database.taskRepository().then(repository => repository.startTask(taskId, sessionId))),
    cancel: vi.fn((taskId: TaskId) =>
      database.taskRepository().then(repository => repository.cancelTask(taskId))),
    onMutated: () => { mutations += 1 },
  }
  const fiber = ctx.plugin({
    inject: ['connection'],
    apply: (scope) => { registerTaskRoutes(scope, database, hooks, DEFAULT_TASK_ROUNDS) },
  })
  await fiber
  cleanups.push(() => fiber.dispose())
  const handler = connection.createSharedFetchHandler('/api')
  const post = async (body: unknown): Promise<Response> => handler.fetch(new Request(
    `http://localhost${TASKS_PATH}`,
    { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } },
  ))
  return { database, fiber, handler, hooks, mutations: () => mutations, post }
}

/** The decoded body. */
async function body<T>(response: Response): Promise<T> {
  return await response.json() as T
}

/** One ready clone created through the store. */
async function readyClone(database: CloneDatabase): Promise<CloneId> {
  const repository = await database.repository()
  return repository.createClone({ name: 'Анна', role: 'Аналитик', status: 'ready' }).id
}

describe('task route operations', () => {
  it('creates a pending task, reads it, and lists it by clone with a private no-store answer', async () => {
    const { database, post } = await fixture()
    const cloneId = await readyClone(database)
    const created = await post({ op: 'create', cloneId, objective: '  Собрать отчёт  ' })
    expect(created.status).toBe(200)
    expect(created.headers.get('cache-control')).toBe('no-store')
    const task = (await body<TaskAnswerResponse>(created)).task
    expect(task).toMatchObject({
      cloneId,
      sessionId: null,
      objective: 'Собрать отчёт',
      status: 'pending',
      resultSummary: null,
      maxRounds: DEFAULT_TASK_ROUNDS,
    })
    expect(await body<TaskAnswerResponse>(await post({ op: 'get', id: task.id }))).toEqual({ ok: true, task })
    expect(await body<TaskListResponse>(await post({ op: 'list' }))).toEqual({ ok: true, tasks: [task] })
    expect(await body<TaskListResponse>(await post({ op: 'list', cloneId }))).toEqual({ ok: true, tasks: [task] })
    expect(await body<TaskListResponse>(await post({ op: 'list', cloneId: 'other' }))).toEqual({ ok: true, tasks: [] })
  })

  it('answers 404 for a missing task and a missing clone', async () => {
    const { post } = await fixture()
    const missing = await post({ op: 'get', id: 'missing' })
    expect(missing.status).toBe(404)
    expect(await body(missing)).toEqual({ ok: false, error: 'ketos/task-not-found' })
    const clone = await post({ op: 'create', cloneId: 'missing', objective: 'Собрать отчёт' })
    expect(clone.status).toBe(404)
    expect(await body(clone)).toEqual({ ok: false, error: 'ketos/clone-not-found' })
  })

  it('rejects malformed requests with ketos/invalid before touching the file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-clone-task-lazy-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const path = join(root, 'clones.db')
    const { post } = await fixture(path)
    const rejected = [
      'not json',
      { op: 'unknown' },
      {},
      { op: 'create', cloneId: 'x' },
      { op: 'create', cloneId: 'x', objective: '   ' },
      { op: 'create', cloneId: 'x', objective: 'x'.repeat(2001) },
      { op: 'create', cloneId: 'x', objective: 'ok', extra: 1 },
      { op: 'get' },
      { op: 'start', id: 'x' },
      { op: 'start', id: 'x', sessionId: '' },
      { op: 'cancel' },
      { op: 'list', extra: 1 },
    ]
    for (const request of rejected) {
      const response = await post(request)
      expect(response.status, JSON.stringify(request)).toBe(400)
      expect(await body(response)).toEqual({ ok: false, error: 'ketos/invalid' })
    }
    // Nothing above was well-formed enough to open the database.
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('starts a pending task through the hook and reports the mutation', async () => {
    const { database, post, hooks, mutations } = await fixture()
    const cloneId = await readyClone(database)
    const created = await body<TaskAnswerResponse>(await post({ op: 'create', cloneId, objective: 'Собрать отчёт' }))
    const started = await post({ op: 'start', id: created.task.id, sessionId: 'session-1' })
    expect(started.status).toBe(200)
    expect((await body<TaskAnswerResponse>(started)).task).toMatchObject({ status: 'running', sessionId: 'session-1' })
    expect(hooks.start).toHaveBeenCalledTimes(1)
    expect(hooks.start.mock.calls[0]?.[1]).toBe('session-1')
    expect(mutations()).toBe(2)
  })

  it('refuses a repeated start and cancels a running task idempotently', async () => {
    const { database, post } = await fixture()
    const cloneId = await readyClone(database)
    const created = await body<TaskAnswerResponse>(await post({ op: 'create', cloneId, objective: 'Собрать отчёт' }))
    await post({ op: 'start', id: created.task.id, sessionId: 'session-1' })
    const repeated = await post({ op: 'start', id: created.task.id, sessionId: 'session-2' })
    expect(repeated.status).toBe(409)
    expect(await body(repeated)).toEqual({ ok: false, error: 'ketos/invalid-state' })
    const cancelled = await post({ op: 'cancel', id: created.task.id })
    expect(cancelled.status).toBe(200)
    expect((await body<TaskAnswerResponse>(cancelled)).task.status).toBe('cancelled')
    const again = await post({ op: 'cancel', id: created.task.id })
    expect((await body<TaskAnswerResponse>(again)).task.status).toBe('cancelled')
  })

  it('refuses a task of a clone without a profile with ketos/invalid-state', async () => {
    const { database, post } = await fixture()
    const repository = await database.repository()
    const draft = repository.createClone({ name: 'Борис', role: 'Юрист' })
    const created = await body<TaskAnswerResponse>(await post({ op: 'create', cloneId: draft.id, objective: 'Проверить' }))
    const started = await post({ op: 'start', id: created.task.id, sessionId: 'session-1' })
    expect(started.status).toBe(409)
    expect(await body(started)).toEqual({ ok: false, error: 'ketos/invalid-state' })
  })

  it('maps a session without a live agent to ketos/agent-not-live', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-clone-task-agent-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const database = new CloneDatabase(join(root, 'clones.db'))
    const cloneId = await readyClone(database)
    const created = (await database.taskRepository())
      .createTask({ cloneId, objective: 'Собрать отчёт', maxRounds: DEFAULT_TASK_ROUNDS })
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
    const fiber = ctx.plugin({
      inject: ['connection'],
      apply: (scope) => {
        registerTaskRoutes(scope, database, {
          start: () => { throw new AgentNotLiveError('session-1') },
          cancel: () => { throw new TaskNotFoundError('x') },
        }, DEFAULT_TASK_ROUNDS)
      },
    })
    await fiber
    cleanups.push(() => fiber.dispose())
    const handler = connection.createSharedFetchHandler('/api')
    const response = await handler.fetch(new Request(`http://localhost${TASKS_PATH}`, {
      method: 'POST',
      body: JSON.stringify({ op: 'start', id: created.id, sessionId: 'session-1' }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(response.status).toBe(409)
    expect(await body(response)).toEqual({ ok: false, error: 'ketos/agent-not-live' })
  })

  it('answers 500 without a code when the database cannot open', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-clone-task-broken-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const path = join(root, 'clones.db')
    await mkdir(path)
    const { post } = await fixture(path)
    const response = await post({ op: 'list' })
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('task request failed')
  })

  it('answers the committed write even when the notification throws', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-clone-task-notify-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const database = new CloneDatabase(join(root, 'clones.db'))
    const cloneId = await readyClone(database)
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
    const fiber = ctx.plugin({
      inject: ['connection'],
      apply: (scope) => {
        registerTaskRoutes(scope, database, {
          start: () => { throw new TaskStateError('x', 'pending', 'start') },
          cancel: () => { throw new CloneNotFoundError('x') },
          onMutated: () => { throw new Error('the observer is gone') },
        }, DEFAULT_TASK_ROUNDS)
      },
    })
    await fiber
    cleanups.push(() => fiber.dispose())
    const handler = connection.createSharedFetchHandler('/api')
    const response = await handler.fetch(new Request(`http://localhost${TASKS_PATH}`, {
      method: 'POST',
      body: JSON.stringify({ op: 'create', cloneId, objective: 'Собрать отчёт' }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(response.status).toBe(200)
    expect((await body<TaskAnswerResponse>(response)).task.objective).toBe('Собрать отчёт')
  })

  it('withdraws the route when its fiber disposes', async () => {
    const { database, fiber, handler } = await fixture()
    await readyClone(database)
    const post = (body: unknown): Promise<Response> => handler.fetch(new Request(`http://localhost${TASKS_PATH}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }))
    expect((await post({ op: 'list' })).status).toBe(200)
    await fiber.dispose()
    expect((await post({ op: 'list' })).status).toBe(404)
  })
})
