/** The clone_tasks repository: creation, guarded transitions, and restart reconciliation. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { CloneDatabase, openDatabase } from '../src/db.ts'
import { CloneRepository } from '../src/repository.ts'
import {
  CloneNotReadyError, DEFAULT_TASK_ROUNDS, INTERRUPTED_TASK_REASON,
  TASK_REPORT_LIMIT, TaskNotFoundError, TaskRepository, TaskStateError,
} from '../src/task-repository.ts'
import type { CloneId, TaskId } from '../src/types.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

/** One in-memory database with a ready clone and its task repository. */
async function fixture(): Promise<{
  database: CloneDatabase
  clones: CloneRepository
  tasks: TaskRepository
  cloneId: CloneId
}> {
  const database = new CloneDatabase(':memory:')
  cleanups.push(() => database.close())
  const clones = await database.repository()
  const clone = clones.createClone({ name: 'Анна', role: 'Аналитик', status: 'ready' })
  return { database, clones, tasks: await database.taskRepository(), cloneId: clone.id }
}

/** A pending task of the fixture's clone. */
function pending(tasks: TaskRepository, cloneId: CloneId, objective = 'Собрать отчёт'): TaskId {
  return tasks.createTask({ cloneId, objective, maxRounds: DEFAULT_TASK_ROUNDS }).id
}

describe('task repository', () => {
  it('creates a pending task and lists it by clone and globally', async () => {
    const { tasks, cloneId, clones } = await fixture()
    const other = clones.createClone({ name: 'Борис', role: 'Юрист', status: 'ready' })
    const created = tasks.createTask({ cloneId, objective: '  Собрать отчёт  ', maxRounds: 7 })
    expect(created).toMatchObject({
      cloneId,
      sessionId: null,
      objective: '  Собрать отчёт  ',
      status: 'pending',
      resultSummary: null,
      maxRounds: 7,
    })
    expect(created.id).toMatch(/[0-9a-f-]{36}/u)
    tasks.createTask({ cloneId: other.id, objective: 'Проверить договор', maxRounds: DEFAULT_TASK_ROUNDS })
    expect(tasks.listTasks(cloneId).map(task => task.objective)).toEqual(['  Собрать отчёт  '])
    expect(tasks.listTasks()).toHaveLength(2)
    expect(tasks.listTasks(other.id).map(task => task.objective)).toEqual(['Проверить договор'])
  })

  it('refuses a task of a clone that does not exist', async () => {
    const { tasks } = await fixture()
    expect(() => tasks.createTask({
      cloneId: brandString<CloneId>('missing'),
      objective: 'Собрать отчёт',
      maxRounds: DEFAULT_TASK_ROUNDS,
    })).toThrow(/does not exist/u)
  })

  it('starts only a pending task of a ready clone and records the session', async () => {
    const { tasks, cloneId, clones } = await fixture()
    const id = pending(tasks, cloneId)
    const sessionId = SessionId('session-task-1')
    expect(tasks.startTask(id, sessionId)).toMatchObject({ status: 'running', sessionId })
    expect(tasks.runningTaskFor(sessionId)?.id).toBe(id)
    // A second start is refused: the task already runs.
    expect(() => tasks.startTask(id, SessionId('session-task-2'))).toThrow(TaskStateError)
    // A draft clone has no profile to work with.
    const draft = clones.createClone({ name: 'Борис', role: 'Юрист' })
    const draftTask = tasks.createTask({ cloneId: draft.id, objective: 'Проверить', maxRounds: 3 }).id
    expect(() => tasks.startTask(draftTask, SessionId('session-task-3'))).toThrow(CloneNotReadyError)
    expect(tasks.getTask(draftTask)?.status).toBe('pending')
  })

  it('keeps a report and completes the task, and refuses a report on a terminal task', async () => {
    const { tasks, cloneId } = await fixture()
    const id = pending(tasks, cloneId)
    const sessionId = SessionId('session-task-1')
    tasks.startTask(id, sessionId)
    expect(tasks.saveReport(id, '  Готово: отчёт собран.  ')).toMatchObject({ status: 'running' })
    expect(tasks.completeTask(id, null)).toMatchObject({ status: 'done', resultSummary: '  Готово: отчёт собран.  ' })
    expect(() => tasks.completeTask(id, 'later')).toThrow(TaskStateError)
    expect(() => tasks.saveReport(id, 'later')).toThrow(TaskStateError)
    expect(tasks.getTask(id)).toMatchObject({ status: 'done', resultSummary: '  Готово: отчёт собран.  ' })
  })

  it('falls back to the supplied summary when no report was filed', async () => {
    const { tasks, cloneId } = await fixture()
    const id = pending(tasks, cloneId)
    tasks.startTask(id, SessionId('session-task-1'))
    expect(tasks.completeTask(id, 'Последний текст')).toMatchObject({ status: 'done', resultSummary: 'Последний текст' })
  })

  it('refuses an empty or over-long report', async () => {
    const { tasks, cloneId } = await fixture()
    const id = pending(tasks, cloneId)
    tasks.startTask(id, SessionId('session-task-1'))
    expect(() => tasks.saveReport(id, '   ')).toThrow(HarnessError)
    expect(() => tasks.saveReport(id, 'x'.repeat(TASK_REPORT_LIMIT + 1))).toThrow(/exceeds/u)
    expect(tasks.getTask(id)?.resultSummary).toBeNull()
  })

  it('fails a running task with the reason, keeping an existing report above it', async () => {
    const { tasks, cloneId } = await fixture()
    const id = pending(tasks, cloneId)
    tasks.startTask(id, SessionId('session-task-1'))
    tasks.saveReport(id, 'Промежуточный результат')
    expect(tasks.failTask(id, 'Goal reached its configured limit of 3 rounds.'))
      .toMatchObject({ status: 'failed', resultSummary: 'Промежуточный результат\n\nGoal reached its configured limit of 3 rounds.' })
    expect(() => tasks.failTask(id, 'again')).toThrow(TaskStateError)
  })

  it('cancels a pending or running task and treats a repeated cancel as a no-op', async () => {
    const { tasks, cloneId } = await fixture()
    const idle = pending(tasks, cloneId)
    expect(tasks.cancelTask(idle)).toMatchObject({ status: 'cancelled', sessionId: null })
    expect(tasks.cancelTask(idle).status).toBe('cancelled')
    const running = pending(tasks, cloneId)
    const sessionId = SessionId('session-task-2')
    tasks.startTask(running, sessionId)
    expect(tasks.cancelTask(running)).toMatchObject({ status: 'cancelled', sessionId })
    // A terminal task cannot be cancelled: done and failed are final.
    const done = pending(tasks, cloneId)
    tasks.startTask(done, SessionId('session-task-3'))
    tasks.completeTask(done, null)
    expect(() => tasks.cancelTask(done)).toThrow(TaskStateError)
  })

  it('refuses a hand-edited round budget when the row is read', async () => {
    const db = await openDatabase(':memory:')
    cleanups.push(async () => { db.close() })
    const clones = new CloneRepository(db)
    const tasks = new TaskRepository(db)
    const clone = clones.createClone({ name: 'Борис', role: 'Юрист', status: 'ready' })
    const task = tasks.createTask({ cloneId: clone.id, objective: 'Собрать отчёт', maxRounds: 5 })
    db.prepare('UPDATE clone_tasks SET max_rounds = 0 WHERE id = ?').run(task.id)
    expect(() => tasks.getTask(task.id)).toThrow(/max_rounds/u)
    db.prepare('UPDATE clone_tasks SET max_rounds = -5 WHERE id = ?').run(task.id)
    expect(() => tasks.listTasks()).toThrow(/max_rounds/u)
  })

  it('reports a missing task identity and releases a failed start', async () => {
    const { tasks, cloneId } = await fixture()
    expect(() => tasks.startTask(brandString<TaskId>('missing'), SessionId('s'))).toThrow(TaskNotFoundError)
    const id = pending(tasks, cloneId)
    tasks.startTask(id, SessionId('session-task-1'))
    expect(tasks.releaseTask(id)).toMatchObject({ status: 'pending', sessionId: null })
    expect(() => tasks.releaseTask(id)).toThrow(TaskStateError)
  })

  it('fails every task a previous process left running when the table first opens', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-clone-tasks-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const path = join(root, 'clones.db')
    const first = new CloneDatabase(path)
    const clones = await first.repository()
    const clone = clones.createClone({ name: 'Анна', role: 'Аналитик', status: 'ready' })
    const tasks = await first.taskRepository()
    const running = tasks.createTask({ cloneId: clone.id, objective: 'Собрать отчёт', maxRounds: 5 }).id
    const pendingTask = tasks.createTask({ cloneId: clone.id, objective: 'Проверить', maxRounds: 5 }).id
    tasks.startTask(running, SessionId('session-task-1'))
    await first.close()

    const second = new CloneDatabase(path)
    cleanups.push(() => second.close())
    const reopened = await second.taskRepository()
    expect(reopened.getTask(running)).toMatchObject({ status: 'failed', resultSummary: INTERRUPTED_TASK_REASON })
    expect(reopened.getTask(pendingTask)?.status).toBe('pending')
  })
})
