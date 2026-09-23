/** The task runner: starting a goal, terminal statuses, and cancellation. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import GoalService from '@deepseek-ai/dsh-goal'
import { createMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { CloneDatabase } from '../src/db.ts'
import { DEFAULT_TASK_ROUNDS, TaskStateError } from '../src/task-repository.ts'
import { AgentNotLiveError, CloneTaskRunner } from '../src/task-runner.ts'
import type { CloneId, TaskId } from '../src/types.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

/** Mirror the public Agent.inject contract for domain tests; status stays settable. */
function stubAgent(ctx: Context, session: Session): { agent: Agent; setStatus: (status: AgentStatus) => void } {
  const inbox = createInboxStub()
  const status: { value: AgentStatus } = { value: 'idle' }
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx,
    get status() { return status.value },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { this.inbox.append('next-step', input) },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, setStatus: (value) => { status.value = value } }
}

/** A booted runner over an in-memory database, one ready clone, and one live agent. */
async function harness(): Promise<{
  ctx: Context
  database: CloneDatabase
  runner: CloneTaskRunner
  agent: Agent
  session: Session
  cloneId: CloneId
  taskId: TaskId
  disposeSession: () => Promise<void>
  syncSessionScope: ReturnType<typeof vi.fn>
  setStatus: (status: AgentStatus) => void
}> {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(GoalService)
  const session = ctx.sessions.prepare(SessionId(`task-session-${String(Math.random())}`))
  // The session belongs to a fiber of its own, so a test can dispose it and
  // observe the `session/disposed` event without tearing down the runner.
  const owner = ctx.plugin({
    inject: ['sessions'],
    apply: (scope) => { scope.effect(function* () { yield scope.sessions.enter(session); scope.sessions.announce(session) }) },
  })
  await owner
  cleanups.push(() => owner.dispose())
  const { agent, setStatus } = stubAgent(ctx, session)
  ctx.agents.register(agent)

  const database = new CloneDatabase(':memory:')
  cleanups.push(() => database.close())
  const clone = (await database.repository()).createClone({ name: 'Анна', role: 'Аналитик', status: 'ready' })
  const task = (await database.taskRepository())
    .createTask({ cloneId: clone.id, objective: 'Собрать отчёт', maxRounds: DEFAULT_TASK_ROUNDS })
  const syncSessionScope = vi.fn(() => Promise.resolve())
  const runner = new CloneTaskRunner(ctx, database, { syncSessionScope })
  runner.start()
  return {
    ctx, database, runner, agent, session, cloneId: clone.id, taskId: task.id,
    disposeSession: () => owner.dispose(), syncSessionScope, setStatus,
  }
}

/** The stored task, or a loud failure when it vanished. */
async function stored(database: CloneDatabase, id: TaskId) {
  const task = (await database.taskRepository()).getTask(id)
  if (task === undefined) throw new Error('the task vanished')
  return task
}

describe('task runner start', () => {
  it('binds the session, creates the goal, and marks the task running', async () => {
    const { ctx, database, runner, agent, session, cloneId, taskId } = await harness()
    const started = await runner.startTask(taskId, session.id)
    expect(started).toMatchObject({ status: 'running', sessionId: session.id })
    const goal = ctx.goals.get(agent)
    expect(goal).toMatchObject({
      objective: 'Собрать отчёт',
      phase: 'active',
      activation: 'armed',
      maxGoalRounds: DEFAULT_TASK_ROUNDS,
      roundsStarted: 0,
    })
    expect((await database.repository()).bindingFor(session.id)).toMatchObject({ cloneId, role: 'main' })
    expect(await runner.runningTaskFor(session.id)).toMatchObject({ id: taskId, status: 'running' })
  })

  it('refuses a second start, a dead session, and an unfinished goal', async () => {
    const { ctx, database, runner, agent, session, cloneId, taskId } = await harness()
    await runner.startTask(taskId, session.id)
    await expect(runner.startTask(taskId, session.id)).rejects.toBeInstanceOf(TaskStateError)

    const idle = (await database.taskRepository())
      .createTask({ cloneId, objective: 'Проверить', maxRounds: 3 })
    await expect(runner.startTask(idle.id, SessionId('not-live'))).rejects.toBeInstanceOf(AgentNotLiveError)

    // A session already driving an unfinished goal cannot take another task.
    const other = (await database.taskRepository())
      .createTask({ cloneId, objective: 'Ещё одна', maxRounds: 3 })
    expect(ctx.goals.get(agent)?.phase).toBe('active')
    await expect(runner.startTask(other.id, session.id)).rejects.toBeInstanceOf(TaskStateError)
    expect((await stored(database, other.id)).status).toBe('pending')
  })
})

describe('task runner terminal statuses', () => {
  it('marks the task done with the report the clone filed', async () => {
    const { ctx, database, runner, agent, session, taskId } = await harness()
    await runner.startTask(taskId, session.id)
    await runner.report(session.id, '  Отчёт собран: 3 документа.  ')
    await vi.waitFor(async () => {
      expect((await stored(database, taskId)).status).toBe('done')
    })
    expect((await stored(database, taskId)).resultSummary).toBe('  Отчёт собран: 3 документа.  ')
    expect(ctx.goals.get(agent)?.phase).toBe('complete')
  })

  it('falls back to the last assistant text when the goal completes without a report', async () => {
    const { ctx, database, runner, agent, session, taskId } = await harness()
    await runner.startTask(taskId, session.id)
    session.append('turn/start', { turn: 1 })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'Готово: отчёт лежит в workspace.' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      }),
      stream: [],
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const goal = ctx.goals.get(agent)
    if (goal === undefined) throw new Error('the goal vanished')
    ctx.goals.complete(agent, { id: goal.id, revision: goal.revision })
    await vi.waitFor(async () => {
      expect((await stored(database, taskId)).status).toBe('done')
    })
    expect((await stored(database, taskId)).resultSummary).toBe('Готово: отчёт лежит в workspace.')
  })

  it('marks the task failed when the goal is blocked and keeps the reason', async () => {
    const { ctx, database, runner, agent, session, taskId } = await harness()
    await runner.startTask(taskId, session.id)
    const goal = ctx.goals.get(agent)
    if (goal === undefined) throw new Error('the goal vanished')
    ctx.goals.block(agent, { id: goal.id, revision: goal.revision }, {
      code: 'round-limit',
      message: 'Goal reached its configured limit of 3 rounds.',
    })
    await vi.waitFor(async () => {
      expect((await stored(database, taskId)).status).toBe('failed')
    })
    expect((await stored(database, taskId)).resultSummary).toBe('Goal reached its configured limit of 3 rounds.')
  })

  it('cancels the task and blocks the goal with the cancelled code', async () => {
    const { ctx, runner, agent, session, taskId } = await harness()
    await runner.startTask(taskId, session.id)
    const cancelled = await runner.cancelTask(taskId)
    expect(cancelled).toMatchObject({ status: 'cancelled', sessionId: session.id })
    expect(ctx.goals.get(agent)).toMatchObject({ phase: 'blocked', blockedReason: { code: 'cancelled' } })
    expect(await runner.runningTaskFor(session.id)).toBeUndefined()
    // A repeated cancel is a no-op, and a finished task refuses one.
    expect((await runner.cancelTask(taskId)).status).toBe('cancelled')
  })

  it('cancels a pending task without touching a goal', async () => {
    const { database, runner, cloneId } = await harness()
    const pending = (await database.taskRepository())
      .createTask({ cloneId, objective: 'Никогда не стартует', maxRounds: 3 })
    expect(await runner.cancelTask(pending.id)).toMatchObject({ status: 'cancelled', sessionId: null })
  })

  it('keeps a terminal status when a later goal event arrives', async () => {
    const { ctx, database, runner, agent, session, taskId } = await harness()
    await runner.startTask(taskId, session.id)
    await runner.report(session.id, 'Готово')
    await vi.waitFor(async () => {
      expect((await stored(database, taskId)).status).toBe('done')
    })
    const goal = ctx.goals.get(agent)
    if (goal === undefined) throw new Error('the goal vanished')
    ctx.goals.clear(agent, { id: goal.id, revision: goal.revision })
    await Promise.resolve()
    expect((await stored(database, taskId)).status).toBe('done')
  })

  it('fails a running task when its session goes away', async () => {
    const { database, runner, session, taskId, disposeSession } = await harness()
    await runner.startTask(taskId, session.id)
    await disposeSession()
    await vi.waitFor(async () => {
      expect((await stored(database, taskId)).status).toBe('failed')
    })
    expect((await stored(database, taskId)).resultSummary).toMatch(/session closed/u)
  })

  it('keeps the report tool through the turn that completes the task', async () => {
    const { database, runner, session, taskId, syncSessionScope, setStatus } = await harness()
    await runner.startTask(taskId, session.id)
    syncSessionScope.mockClear()
    // The terminal event lands while the model is still in its turn; the
    // report tool must survive until the turn ends.
    setStatus('running')
    await runner.report(session.id, 'Готово')
    await vi.waitFor(async () => {
      expect((await stored(database, taskId)).status).toBe('done')
    })
    expect(syncSessionScope).not.toHaveBeenCalled()
    setStatus('idle')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await vi.waitFor(() => { expect(syncSessionScope).toHaveBeenCalledTimes(1) })
    // A repeated turn/end does not reconcile twice.
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    await Promise.resolve()
    expect(syncSessionScope).toHaveBeenCalledTimes(1)
  })

  it('withdraws the tool immediately when the task settles outside a turn', async () => {
    const { runner, session, taskId, syncSessionScope } = await harness()
    await runner.startTask(taskId, session.id)
    syncSessionScope.mockClear()
    await runner.cancelTask(taskId)
    expect(syncSessionScope).toHaveBeenCalledTimes(1)
  })

  it('refuses a report from a session that runs no task', async () => {
    const { runner } = await harness()
    await expect(runner.report(SessionId('no-task'), 'отчёт')).rejects.toBeInstanceOf(HarnessError)
  })
})
