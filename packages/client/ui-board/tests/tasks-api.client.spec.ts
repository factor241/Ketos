/**
 * Tasks route client: the request bodies each operation sends, the decoding of
 * every answer, and the stable failure code each refusal maps to.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CloneId, CloneTaskDto, TaskId } from '@ketos/clone-core/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  TASK_POLL_INTERVAL_MS, cancelTask, createTask, isTask, isTaskList, listTasks, startTask,
} from '../src/client/tasks-api.ts'

afterEach(() => { vi.unstubAllGlobals() })

/** One stored task as the host sends it. */
function task(overrides: Partial<CloneTaskDto> = {}): CloneTaskDto {
  return {
    id: 'task-1' as TaskId,
    cloneId: 'clone-1' as CloneId,
    sessionId: 'session-1',
    objective: 'Собрать недельный отчёт',
    status: 'running',
    resultSummary: null,
    maxRounds: 8,
    createdAt: '2026-09-21T10:00:00.000Z',
    updatedAt: '2026-09-21T10:00:00.000Z',
    ...overrides,
  }
}

/** The decoded body of the one recorded request. */
interface Recorded {
  readonly body: Record<string, unknown>
}

/**
 * Stub the tasks route with one answering function, asserting the exact path.
 * @param answer - builds the response for one decoded request body.
 * @returns the recorded requests.
 */
function stubRoute(answer: (body: Record<string, unknown>) => Response): Recorded[] {
  const recorded: Recorded[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
    expect(String(input)).toBe('/api/ketos.tasks')
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>
    recorded.push({ body })
    return answer(body)
  }))
  return recorded
}

/** One refused answer carrying the host's JSON failure code. */
function refusal(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status })
}

describe('task decoding', () => {
  it('accepts a complete stored task and refuses every malformed field', () => {
    expect(isTask(task())).toBe(true)
    expect(isTask(task({ sessionId: null, resultSummary: 'Готово', status: 'done' }))).toBe(true)

    expect(isTask(null)).toBe(false)
    expect(isTask([])).toBe(false)
    expect(isTask(task({ id: '' as TaskId }))).toBe(false)
    expect(isTask(task({ cloneId: '' as CloneId }))).toBe(false)
    expect(isTask(task({ sessionId: 7 as unknown as string }))).toBe(false)
    expect(isTask(task({ objective: 7 as unknown as string }))).toBe(false)
    expect(isTask(task({ status: 'unknown' as CloneTaskDto['status'] }))).toBe(false)
    expect(isTask(task({ resultSummary: 7 as unknown as string }))).toBe(false)
    expect(isTask(task({ maxRounds: '8' as unknown as number }))).toBe(false)
    expect(isTask(task({ createdAt: 7 as unknown as string }))).toBe(false)
    expect(isTask(task({ updatedAt: 7 as unknown as string }))).toBe(false)
  })

  it('accepts only an array of complete tasks as a list answer', () => {
    expect(isTaskList([])).toBe(true)
    expect(isTaskList([task(), task({ id: 'task-2' as TaskId })])).toBe(true)
    expect(isTaskList('tasks')).toBe(false)
    expect(isTaskList([{}])).toBe(false)
  })
})

describe('task operations', () => {
  it('sends bare and clone-scoped list requests and decodes the rows', async () => {
    const recorded = stubRoute(() => Response.json({ ok: true, tasks: [task()] }))
    const all = await listTasks()
    expect(all).toEqual({ ok: true, value: [task()] })
    expect(recorded[0]?.body).toEqual({ op: 'list' })

    const scoped = await listTasks('clone-1' as CloneId)
    expect(scoped.ok).toBe(true)
    expect(recorded[1]?.body).toEqual({ op: 'list', cloneId: 'clone-1' })
  })

  it('sends create, start, and cancel with the exact fields the route accepts', async () => {
    const recorded = stubRoute(() => Response.json({ ok: true, task: task() }))
    const created = await createTask('clone-1' as CloneId, 'Собрать отчёт')
    expect(created).toEqual({ ok: true, value: task() })
    expect(recorded[0]?.body).toEqual({ op: 'create', cloneId: 'clone-1', objective: 'Собрать отчёт' })

    await startTask('task-1' as TaskId, 'session-1' as SessionId)
    expect(recorded[1]?.body).toEqual({ op: 'start', id: 'task-1', sessionId: 'session-1' })

    await cancelTask('task-1' as TaskId)
    expect(recorded[2]?.body).toEqual({ op: 'cancel', id: 'task-1' })

    expect(TASK_POLL_INTERVAL_MS).toBe(750)
  })

  it('reports the host failure code of a refused answer', async () => {
    const answers = [
      refusal(400, 'ketos/invalid'),
      refusal(404, 'ketos/task-not-found'),
      refusal(404, 'ketos/clone-not-found'),
      refusal(409, 'ketos/invalid-state'),
      refusal(409, 'ketos/agent-not-live'),
    ]
    let index = 0
    stubRoute(() => answers[index++] as Response)
    await expect(cancelTask('task-1' as TaskId)).resolves.toEqual({ ok: false, code: 'ketos/invalid' })
    await expect(cancelTask('task-1' as TaskId)).resolves.toEqual({ ok: false, code: 'ketos/task-not-found' })
    await expect(cancelTask('task-1' as TaskId)).resolves.toEqual({ ok: false, code: 'ketos/clone-not-found' })
    await expect(cancelTask('task-1' as TaskId)).resolves.toEqual({ ok: false, code: 'ketos/invalid-state' })
    await expect(cancelTask('task-1' as TaskId)).resolves.toEqual({ ok: false, code: 'ketos/agent-not-live' })
  })

  it('falls back to the status code when the failure carries no code', async () => {
    const answers = [
      Response.json({ ok: false, error: 'ketos/other' }, { status: 409 }),
      new Response('bad request', { status: 400 }),
      new Response('missing', { status: 404 }),
      new Response('refused', { status: 409 }),
      new Response('boom', { status: 500 }),
    ]
    let index = 0
    stubRoute(() => answers[index++] as Response)
    await expect(cancelTask('task-1' as TaskId)).resolves.toEqual({ ok: false, code: 'ketos/invalid-state' })
    await expect(cancelTask('task-1' as TaskId)).resolves.toEqual({ ok: false, code: 'ketos/invalid' })
    await expect(cancelTask('task-1' as TaskId)).resolves.toEqual({ ok: false, code: 'ketos/task-not-found' })
    await expect(cancelTask('task-1' as TaskId)).resolves.toEqual({ ok: false, code: 'ketos/invalid-state' })
    await expect(cancelTask('task-1' as TaskId)).resolves.toEqual({ ok: false, code: 'ketos/unreachable' })
  })

  it('reports an unexpected or unreachable answer as unreachable', async () => {
    const answers = [
      Response.json({ ok: true, task: { id: 'task-1' } }),
      Response.json({ ok: false }),
      Response.json({ ok: true, tasks: 'nope' }),
    ]
    let index = 0
    stubRoute(() => answers[index++] as Response)
    await expect(startTask('task-1' as TaskId, 'session-1' as SessionId)).resolves.toEqual({
      ok: false,
      code: 'ketos/unreachable',
    })
    await expect(startTask('task-1' as TaskId, 'session-1' as SessionId)).resolves.toEqual({
      ok: false,
      code: 'ketos/unreachable',
    })
    await expect(listTasks()).resolves.toEqual({ ok: false, code: 'ketos/unreachable' })

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(listTasks()).resolves.toEqual({ ok: false, code: 'ketos/unreachable' })
  })
})
