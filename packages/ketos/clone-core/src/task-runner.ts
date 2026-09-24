/**
 * The autonomous-task runner: the host-side orchestration that starts a stored
 * task against the live session's goal, follows the goal and session events to
 * a truthful terminal status, and answers the report tool.
 *
 * No round loop lives here: the configured `goal-round-driver` adds the next
 * round whenever the agent returns to idle, and this runner only reacts to the
 * durable goal and session events that report what happened.
 * @module @ketos/clone-core/task-runner
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GoalChanged, GoalService } from '@deepseek-ai/dsh-goal'
import type { AssistantMessage } from '@deepseek-ai/dsh-llm'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CloneDatabase } from './db.ts'
import type { CloneRepository } from './repository.ts'
import type { TaskRepository } from './task-repository.ts'
import { TaskNotFoundError, TaskStateError } from './task-repository.ts'
import type { CloneTaskRecord, TaskId } from './types.ts'

/**
 * A session that runs a task but has no live agent. The route refuses the
 * start rather than waiting for an agent that may never come up.
 */
export class AgentNotLiveError extends HarnessError {
  /**
   * @param sessionId - the session without a live agent.
   */
  constructor(sessionId: string) {
    super(`session ${sessionId} has no live agent`, 'ketos/agent-not-live')
  }
}

/**
 * What the clone session scope needs from the runner: whether the session
 * currently runs a task, and the report write its tool performs. The scope
 * owns the tool registration; the runner owns the task data and the goal.
 */
export interface CloneTaskBridge {
  /**
   * The running task of one session, if any.
   * @param sessionId - session identity to look up.
   * @returns the running task, or undefined.
   */
  runningTaskFor(sessionId: SessionId): Promise<CloneTaskRecord | undefined>
  /**
   * Store the final report of the task a session runs and complete its goal.
   * @param sessionId - the reporting session.
   * @param summary - the report text.
   * @returns a promise settling when the report is stored and the goal completed.
   */
  report(sessionId: SessionId, summary: string): Promise<void>
}

/** Options the runner needs from the plugin that owns it. */
export interface CloneTaskRunnerOptions {
  /**
   * Re-derive the clone session scopes after a binding was written. Awaiting
   * it guarantees the reporting tool is installed before the goal's first
   * round can enter the agent's inbox.
   * @returns a promise settling when every live agent's scope was reconciled.
   */
  readonly syncSessionScope: () => Promise<void>
}

/** The text blocks of one assistant message, joined, or an empty string. */
function assistantText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}

/**
 * Starts tasks against live sessions' goals and keeps each stored status
 * truthful. One instance owns the process-wide `active` index of sessions that
 * run a task; a task can become `running` only through {@link startTask}, so
 * the index is complete for this process, and the repository's open-time
 * reconciliation settles everything a previous process left behind.
 */
export class CloneTaskRunner implements CloneTaskBridge {
  private readonly ctx: Context
  private readonly database: CloneDatabase
  private readonly options: CloneTaskRunnerOptions
  /**
   * Sessions that run a task, mapped to the task they run. The index keeps the
   * assistant-text and turn observers from reading the database for every
   * session in the process.
   */
  private readonly active = new Map<SessionId, TaskId>()
  /** Newest assistant text per active session; the completion-summary fallback. */
  private readonly lastText = new Map<SessionId, string>()
  /**
   * Sessions whose task reached a terminal status while a turn was still
   * running. Withdrawing the report tool in the middle of that turn would turn
   * a repeated call into an unknown-tool failure, so the scope is reconciled
   * when the turn ends instead.
   */
  private readonly pendingResync = new Set<SessionId>()

  /**
   * @param ctx - host context carrying `agents` and `goals`.
   * @param database - the plugin's clone database.
   * @param options - the scope-resync callback the plugin supplies.
   */
  constructor(ctx: Context, database: CloneDatabase, options: CloneTaskRunnerOptions) {
    this.ctx = ctx
    this.database = database
    this.options = options
  }

  /** Follow the goal and session events that move a task to its terminal status. */
  start(): void {
    this.ctx.on('goal/changed', ({ agent, change }) => { this.contain('goal change', () => this.onGoalChanged(agent, change)) })
    this.ctx.on('session/event', (session, event) => { this.onSessionEvent(session, event) })
    this.ctx.on('session/disposed', (session) => { this.contain('session disposal', () => this.onSessionDisposed(session)) })
    this.ctx.effect(() => () => {
      this.active.clear()
      this.lastText.clear()
      this.pendingResync.clear()
    }, 'ketos-clone-core: task runner')
  }

  /**
   * Start one `pending` task: bind the session to the clone, install the task
   * scope ahead of the first round, and create the goal that drives the work.
   * A failure after the status write releases the task back to `pending`, so a
   * refused start never leaves a task claiming to run.
   * @param taskId - task identity.
   * @param sessionId - live session that will run the task.
   * @returns the started task.
   * @throws TaskNotFoundError when the task does not exist.
   * @throws AgentNotLiveError when the session has no live agent.
   * @throws TaskStateError when the task is not `pending`, the clone is not
   * `ready`, or the session already carries an unfinished goal.
   */
  async startTask(taskId: TaskId, sessionId: SessionId): Promise<CloneTaskRecord> {
    const tasks = await this.database.taskRepository()
    const task = tasks.getTask(taskId)
    if (task === undefined) throw new TaskNotFoundError(taskId)
    const agent = this.ctx.agents.get(sessionId)
    if (agent === undefined) throw new AgentNotLiveError(sessionId)
    const goal = this.goals().get(agent)
    if (goal !== undefined && goal.phase !== 'complete') {
      throw new TaskStateError(taskId, task.status, 'start while the session already carries an unfinished goal')
    }
    const repository = await this.database.repository()
    // A session that already works for another clone must not be hijacked by a
    // task; a fresh task session has no binding and a rebind of the same clone
    // is a no-op.
    const previous = repository.bindingFor(sessionId)
    if (previous !== undefined && previous.cloneId !== task.cloneId) {
      throw new TaskStateError(taskId, task.status, 'start a session already bound to another clone')
    }
    const started = tasks.startTask(taskId, sessionId)
    try {
      repository.bindSession({ cloneId: started.cloneId, sessionId, role: 'main' })
      await this.options.syncSessionScope()
      this.goals().create(agent, { objective: started.objective, maxGoalRounds: started.maxRounds })
    } catch (error: unknown) {
      if (previous === undefined) this.unbind(repository, sessionId)
      this.release(tasks, taskId)
      throw error
    }
    this.active.set(sessionId, taskId)
    this.lastText.delete(sessionId)
    return started
  }

  /**
   * Cancel one task: block its goal with a durable `cancelled` reason so the
   * driver adds no further round, abort the live turn, and move the status to
   * `cancelled`. Cancelling a task that is already `cancelled` is a no-op.
   * @param taskId - task identity.
   * @returns the cancelled task.
   * @throws TaskNotFoundError when the task does not exist.
   * @throws TaskStateError when the task already reached `done` or `failed`.
   */
  async cancelTask(taskId: TaskId): Promise<CloneTaskRecord> {
    const tasks = await this.database.taskRepository()
    const task = tasks.getTask(taskId)
    if (task === undefined) throw new TaskNotFoundError(taskId)
    if (task.status === 'done' || task.status === 'failed') throw new TaskStateError(taskId, task.status, 'cancel')
    if (task.status === 'running' && task.sessionId !== null) {
      const sessionId = task.sessionId
      const agent = this.ctx.agents.get(sessionId)
      if (agent !== undefined) {
        const goal = this.goals().get(agent)
        if (goal !== undefined && goal.phase === 'active') {
          try {
            this.goals().block(agent, { id: goal.id, revision: goal.revision }, {
              code: 'cancelled',
              message: 'Cancelled by user',
            })
          } catch (error: unknown) {
            // The goal already moved; the status transition below is the
            // authority on whether this task may still be cancelled.
            this.ctx.logger.warn(`ketos-clone-core: could not block the goal of task "${taskId}": ${String(error)}`)
          }
        }
        agent.cancel({ kind: 'user' }, { keepInbox: true })
      }
      this.active.delete(sessionId)
      this.lastText.delete(sessionId)
    }
    const cancelled = tasks.cancelTask(taskId)
    this.settleScope(cancelled.sessionId)
    return cancelled
  }

  /** {@inheritDoc CloneTaskBridge.runningTaskFor} */
  async runningTaskFor(sessionId: SessionId): Promise<CloneTaskRecord | undefined> {
    return (await this.database.taskRepository()).runningTaskFor(sessionId)
  }

  /**
   * The goal service this deployment mounts. An autonomous task is a goal, so
   * a deployment without the service refuses the operation loudly instead of
   * pretending a task started.
   */
  private goals(): GoalService {
    const goals = this.ctx.get('goals')
    if (goals === undefined) {
      throw new Error('ketos-clone-core: autonomous tasks need the goals service, which this deployment does not mount')
    }
    return goals
  }

  /** {@inheritDoc CloneTaskBridge.report} */
  async report(sessionId: SessionId, summary: string): Promise<void> {
    const tasks = await this.database.taskRepository()
    const task = tasks.runningTaskFor(sessionId)
    if (task === undefined) {
      throw new HarnessError(`session ${sessionId} runs no task`, 'ketos/invalid-state')
    }
    const agent = this.ctx.agents.get(sessionId)
    if (agent === undefined) throw new AgentNotLiveError(sessionId)
    tasks.saveReport(task.id, summary)
    const goal = this.goals().get(agent)
    if (goal === undefined) throw new HarnessError(`task ${task.id} has no goal`, 'ketos/invalid-state')
    // A goal that is no longer active already reached its terminal phase; the
    // observers own the status from there.
    if (goal.phase === 'active') {
      this.goals().complete(agent, { id: goal.id, revision: goal.revision })
    }
  }

  /** Follow the durable events that move a running task to its terminal status. */
  private async onGoalChanged(agent: Agent, change: GoalChanged): Promise<void> {
    const taskId = this.active.get(agent.id)
    if (taskId === undefined) return
    const tasks = await this.database.taskRepository()
    const task = tasks.getTask(taskId)
    if (task === undefined || task.status !== 'running') return
    const goal = change.goal
    if (goal === undefined) {
      // The goal was cleared (a tombstone in the log): the task can neither
      // continue nor report, and a later start on the same session must find
      // the session free.
      this.settle(() => tasks.failTask(taskId, 'the goal was cleared before the task finished'))
      return
    }
    if (goal.phase === 'complete') {
      this.settle(() => tasks.completeTask(taskId, this.lastText.get(agent.id) ?? null))
    } else if (goal.phase === 'blocked') {
      const reason = goal.blockedReason
      if (reason?.code === 'cancelled') this.settle(() => tasks.cancelTask(taskId))
      else this.settle(() => tasks.failTask(taskId, reason?.message ?? 'the goal was blocked'))
    }
  }

  /** Keep the newest assistant text of an active session as the summary fallback. */
  private onSessionEvent(session: Session, event: SessionEvent): void {
    if (event.type === 'turn/end' && this.pendingResync.delete(session.id)) {
      this.resyncScope()
    }
    const taskId = this.active.get(session.id)
    if (taskId === undefined) return
    switch (event.type) {
      case 'assistant/message': {
        const text = assistantText(event.data.message)
        if (text !== '') this.lastText.set(session.id, text)
        return
      }
      case 'turn/end': {
        this.touch(taskId)
        return
      }
      default:
        return
    }
  }

  /** A session that went away cannot run its task any longer. */
  private async onSessionDisposed(session: Session): Promise<void> {
    this.pendingResync.delete(session.id)
    const taskId = this.active.get(session.id)
    if (taskId === undefined) return
    this.active.delete(session.id)
    this.lastText.delete(session.id)
    const tasks = await this.database.taskRepository()
    this.settle(() => tasks.failTask(taskId, 'the session closed before the task finished'))
  }

  /**
   * Run one event-driven operation and contain its failure: a durable write
   * that cannot land must not become an unhandled rejection in an emit chain.
   */
  private contain(label: string, operation: () => Promise<void>): void {
    void operation().catch((error: unknown) => {
      this.ctx.logger.warn(`ketos-clone-core: task ${label} handling failed: ${String(error)}`)
    })
  }

  /** Bump the task's `updated_at` without touching its status. */
  private touch(taskId: TaskId): void {
    void this.database.taskRepository().then(
      (tasks) => { tasks.touchTask(taskId) },
      (error: unknown) => {
        this.ctx.logger.warn(`ketos-clone-core: could not touch task "${taskId}": ${String(error)}`)
      },
    )
  }

  /**
   * Apply one terminal write, dropping the session index whether or not the
   * task still needed it, and contain a status that already moved: a repeated
   * event must not turn into an error. A terminal task withdraws the report
   * tool from its session; when the terminal event arrives inside a running
   * turn, that reconciliation waits for the turn to end so the tool the model
   * is still using does not vanish mid-step.
   */
  private settle(write: () => CloneTaskRecord): void {
    let task: CloneTaskRecord
    try {
      task = write()
      if (task.sessionId !== null) {
        this.active.delete(task.sessionId)
        this.lastText.delete(task.sessionId)
      }
    } catch (error: unknown) {
      if (error instanceof TaskStateError) return
      throw error
    }
    this.settleScope(task.sessionId)
  }

  /**
   * Reconcile the scope of a settled task's session, or defer it to the turn
   * that is still running. A session without an agent needs no reconciliation
   * from here: nothing live carries the scope.
   */
  private settleScope(sessionId: SessionId | null): void {
    if (sessionId === null || this.ctx.agents.get(sessionId)?.status !== 'running') {
      this.resyncScope()
      return
    }
    this.pendingResync.add(sessionId)
  }

  /** Re-derive the clone session scopes, containing a reconciliation failure. */
  private resyncScope(): void {
    void this.options.syncSessionScope().catch((error: unknown) => {
      this.ctx.logger.warn(`ketos-clone-core: could not reconcile the task scope: ${String(error)}`)
    })
  }

  /** Remove the binding a refused start wrote, keeping the original failure loud. */
  private unbind(repository: CloneRepository, sessionId: SessionId): void {
    try {
      repository.unbindSession(sessionId)
    } catch (error: unknown) {
      this.ctx.logger.warn(`ketos-clone-core: could not unbind session "${sessionId}": ${String(error)}`)
    }
  }

  /** Release a task whose start failed, keeping the original failure loud. */
  private release(tasks: TaskRepository, taskId: TaskId): void {
    try {
      tasks.releaseTask(taskId)
    } catch (error: unknown) {
      this.ctx.logger.warn(`ketos-clone-core: could not release task "${taskId}": ${String(error)}`)
    }
  }
}
