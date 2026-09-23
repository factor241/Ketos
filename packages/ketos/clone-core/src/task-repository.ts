/**
 * Prepared-statement repository over the `clone_tasks` table: creation, the
 * status transitions the tasks route and the runner drive, and the reads that
 * resolve a task by identity or by the session running it.
 *
 * Every transition is guarded by the status the stored row carries, so a
 * terminal status is never rewritten and a repeated start is refused rather
 * than silently accepted.
 * @module @ketos/clone-core/task-repository
 */

import type { DatabaseSync } from 'node:sqlite'
import { brandString } from '@deepseek-ai/dsh-brand'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { randomUUID } from 'node:crypto'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { CloneNotFoundError, CLONE_STATUSES } from './repository.ts'
import { inTransaction } from './transaction.ts'
import type { CloneId, CloneStatus, CloneTaskRecord, TaskCreateInput, TaskId, TaskStatus } from './types.ts'

/** A task identity the database does not hold. */
export class TaskNotFoundError extends HarnessError {
  /**
   * @param id - the task identity that is absent.
   */
  constructor(id: string) {
    super(`task ${id} does not exist`, 'ketos/task-not-found')
  }
}

/** A transition the stored status does not allow. */
export class TaskStateError extends HarnessError {
  /**
   * @param id - the task identity.
   * @param status - the status that refused the transition.
   * @param action - what the caller tried to do.
   */
  constructor(id: string, status: TaskStatus, action: string) {
    super(`task ${id} is ${status}; cannot ${action}`, 'ketos/invalid-state')
  }
}

/**
 * A clone that is not `ready`, so no task can run for it. A clone without a
 * saved profile has no persona, methodology, or skills to work with.
 */
export class CloneNotReadyError extends HarnessError {
  /**
   * @param id - the clone identity whose status moved.
   * @param status - the stored status.
   */
  constructor(id: string, status: CloneStatus) {
    super(`clone ${id} is ${status}; a task can start only for a ready clone`, 'ketos/invalid-state')
  }
}

/** Default round budget a task hands to its goal. */
export const DEFAULT_TASK_ROUNDS = 10

/**
 * Largest round budget a task may hand to its goal. The cap is a validation
 * invariant of this package, not a deployment setting: a runaway task must not
 * keep a session busy for an unbounded number of model rounds.
 */
export const MAX_TASK_ROUNDS = 50

/** Longest accepted objective in characters. */
export const TASK_OBJECTIVE_LIMIT = 2000

/** Longest accepted stored report or failure reason, in characters. */
export const TASK_REPORT_LIMIT = 20_000

/** The only statuses the stored `status` column decodes to and the wire accepts. */
export const TASK_STATUSES = ['pending', 'running', 'done', 'failed', 'cancelled'] as const satisfies readonly TaskStatus[]

/**
 * What the runner writes into a task a previous process left running. The task
 * cannot continue on its own: the goal driver re-arms nothing after a restart
 * and the round it interrupted is gone, so the status must stop claiming the
 * work is alive.
 */
export const INTERRUPTED_TASK_REASON = 'the process restarted before the task finished'

/** One `clone_tasks` row as SQLite returns it. */
interface TaskRow {
  id: string
  clone_id: string
  session_id: string | null
  objective: string
  status: string
  result_summary: string | null
  max_rounds: number
  created_at: string
  updated_at: string
}

/** Current time as the ISO-8601 UTC string every timestamp column stores. */
function nowIso(): string {
  return new Date().toISOString()
}

/** Decode the stored task status. */
function parseTaskStatus(id: string, value: string): TaskStatus {
  if (!(TASK_STATUSES as readonly string[]).includes(value)) {
    throw new Error(`task ${id}: unknown status ${JSON.stringify(value)}`)
  }
  return value as TaskStatus
}

/** Decode one stored task row. */
function toTaskRecord(row: TaskRow): CloneTaskRecord {
  return {
    id: brandString<TaskId>(row.id),
    cloneId: brandString<CloneId>(row.clone_id),
    sessionId: row.session_id === null ? null : brandString<SessionId>(row.session_id),
    objective: row.objective,
    status: parseTaskStatus(row.id, row.status),
    resultSummary: row.result_summary,
    maxRounds: row.max_rounds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Keep an existing report under a failure reason: the report is what the clone
 * produced, and the reason says why the task still stopped short.
 * @param existing - stored report, if any.
 * @param reason - host-written failure reason.
 * @returns the summary to store.
 */
function failureSummary(existing: string | null, reason: string): string {
  return existing === null || existing.trim() === '' ? reason : `${existing}\n\n${reason}`
}

/**
 * Create, read, and transition the autonomous tasks of clones. Every write
 * runs inside an immediate transaction and re-reads the row under the write
 * lock, so two callers cannot both observe a `pending` task and start it.
 */
export class TaskRepository {
  private readonly db: DatabaseSync

  /**
   * @param db - open clone database.
   */
  constructor(db: DatabaseSync) {
    this.db = db
  }

  /**
   * Tasks of one clone, newest first, or every task when no clone is named.
   * Insertion order is the sort key rather than a timestamp, so the list is
   * stable inside one clock tick.
   * @param cloneId - clone identity to filter by, or undefined for every task.
   * @returns the stored tasks.
   */
  listTasks(cloneId?: CloneId): CloneTaskRecord[] {
    const rows = (cloneId === undefined
      ? this.db.prepare('SELECT * FROM clone_tasks ORDER BY rowid DESC').all()
      : this.db.prepare('SELECT * FROM clone_tasks WHERE clone_id = ? ORDER BY rowid DESC').all(cloneId)) as unknown as TaskRow[]
    return rows.map(toTaskRecord)
  }

  /**
   * One task by identity.
   * @param id - task identity.
   * @returns the stored task, or undefined when no row holds the identity.
   */
  getTask(id: TaskId): CloneTaskRecord | undefined {
    const row = this.db.prepare('SELECT * FROM clone_tasks WHERE id = ?').get(id) as unknown as TaskRow | undefined
    return row === undefined ? undefined : toTaskRecord(row)
  }

  /**
   * The running task of one session, if any. A session runs at most one task:
   * the goal it carries belongs to that task.
   * @param sessionId - session identity to look up.
   * @returns the running task, or undefined.
   */
  runningTaskFor(sessionId: SessionId): CloneTaskRecord | undefined {
    const row = this.db.prepare(
      "SELECT * FROM clone_tasks WHERE session_id = ? AND status = 'running'",
    ).get(sessionId) as unknown as TaskRow | undefined
    return row === undefined ? undefined : toTaskRecord(row)
  }

  /**
   * Insert one task of a clone in `pending`, with a freshly minted identity.
   * @param input - clone identity, non-empty objective, and resolved round budget.
   * @returns the stored task.
   * @throws CloneNotFoundError when the clone does not exist.
   */
  createTask(input: TaskCreateInput): CloneTaskRecord {
    return inTransaction(this.db, () => {
      if (this.cloneStatus(input.cloneId) === undefined) throw new CloneNotFoundError(input.cloneId)
      const id = brandString<TaskId>(randomUUID())
      const now = nowIso()
      this.db.prepare(`
        INSERT INTO clone_tasks (id, clone_id, session_id, objective, status, result_summary, max_rounds, created_at, updated_at)
        VALUES (?, ?, NULL, ?, 'pending', NULL, ?, ?, ?)
      `).run(id, input.cloneId, input.objective, input.maxRounds, now, now)
      return this.require(id)
    })
  }

  /**
   * Move one `pending` task to `running` and record the session that runs it.
   * The clone must still be `ready`; the check, the transition, and the session
   * write commit together, so a task never starts for a clone whose profile
   * moved on or disappeared.
   * @param id - task identity.
   * @param sessionId - session the clone works in.
   * @returns the started task.
   * @throws TaskNotFoundError when the task does not exist.
   * @throws TaskStateError when the task is not `pending`.
   * @throws CloneNotFoundError when the clone disappeared.
   * @throws CloneNotReadyError when the clone is not `ready`.
   */
  startTask(id: TaskId, sessionId: SessionId): CloneTaskRecord {
    return inTransaction(this.db, () => {
      const task = this.entry(id)
      if (task.status !== 'pending') throw new TaskStateError(id, task.status, 'start')
      const status = this.cloneStatus(task.cloneId)
      if (status === undefined) throw new CloneNotFoundError(task.cloneId)
      if (status !== 'ready') throw new CloneNotReadyError(task.cloneId, status)
      this.db.prepare('UPDATE clone_tasks SET status = ?, session_id = ?, updated_at = ? WHERE id = ?')
        .run('running', sessionId, nowIso(), id)
      return this.require(id)
    })
  }

  /**
   * Put a `running` task back to `pending` after the goal could not be created,
   * releasing the session so a later start may pick another one.
   * @param id - task identity.
   * @returns the released task.
   * @throws TaskNotFoundError when the task does not exist.
   * @throws TaskStateError when the task is not `running`.
   */
  releaseTask(id: TaskId): CloneTaskRecord {
    return inTransaction(this.db, () => {
      const task = this.entry(id)
      if (task.status !== 'running') throw new TaskStateError(id, task.status, 'release')
      this.db.prepare("UPDATE clone_tasks SET status = 'pending', session_id = NULL, updated_at = ? WHERE id = ?")
        .run(nowIso(), id)
      return this.require(id)
    })
  }

  /**
   * Store the report a clone filed while its task still runs. The task keeps
   * `running` until its goal reports completion, so the report lands before
   * the terminal transition.
   * @param id - task identity.
   * @param summary - the report text.
   * @returns the updated task.
   * @throws TaskNotFoundError when the task does not exist.
   * @throws TaskStateError when the task is not `running`.
   */
  saveReport(id: TaskId, summary: string): CloneTaskRecord {
    const text = summary.trim()
    if (text === '') throw new HarnessError('the report must not be empty', 'ketos/invalid-report')
    if (summary.length > TASK_REPORT_LIMIT) {
      throw new HarnessError(`the report exceeds ${String(TASK_REPORT_LIMIT)} characters`, 'ketos/invalid-report')
    }
    return inTransaction(this.db, () => {
      const task = this.entry(id)
      if (task.status !== 'running') throw new TaskStateError(id, task.status, 'file a report')
      this.db.prepare('UPDATE clone_tasks SET result_summary = ?, updated_at = ? WHERE id = ?')
        .run(summary, nowIso(), id)
      return this.require(id)
    })
  }

  /**
   * Move one `running` task to `done`, keeping the report it filed. The
   * fallback summary is used only when no report was stored.
   * @param id - task identity.
   * @param fallbackSummary - last assistant text, or null when none was seen.
   * @returns the finished task.
   * @throws TaskNotFoundError when the task does not exist.
   * @throws TaskStateError when the task is not `running`.
   */
  completeTask(id: TaskId, fallbackSummary: string | null): CloneTaskRecord {
    return inTransaction(this.db, () => {
      const task = this.entry(id)
      if (task.status !== 'running') throw new TaskStateError(id, task.status, 'complete')
      const summary = task.resultSummary ?? fallbackSummary
      this.db.prepare("UPDATE clone_tasks SET status = 'done', result_summary = ?, updated_at = ? WHERE id = ?")
        .run(summary, nowIso(), id)
      return this.require(id)
    })
  }

  /**
   * Move one `running` task to `failed` with the reason it stopped.
   * @param id - task identity.
   * @param reason - host-written reason, for example a blocked goal's message.
   * @returns the failed task.
   * @throws TaskNotFoundError when the task does not exist.
   * @throws TaskStateError when the task is not `running`.
   */
  failTask(id: TaskId, reason: string): CloneTaskRecord {
    return inTransaction(this.db, () => {
      const task = this.entry(id)
      if (task.status !== 'running') throw new TaskStateError(id, task.status, 'fail')
      this.db.prepare("UPDATE clone_tasks SET status = 'failed', result_summary = ?, updated_at = ? WHERE id = ?")
        .run(failureSummary(task.resultSummary, reason), nowIso(), id)
      return this.require(id)
    })
  }

  /**
   * Move one `pending` or `running` task to `cancelled`. A task already
   * cancelled is returned unchanged, so a repeated cancel is a no-op.
   * @param id - task identity.
   * @returns the cancelled task.
   * @throws TaskNotFoundError when the task does not exist.
   * @throws TaskStateError when the task already reached `done` or `failed`.
   */
  cancelTask(id: TaskId): CloneTaskRecord {
    return inTransaction(this.db, () => {
      const task = this.entry(id)
      if (task.status === 'cancelled') return task
      if (task.status === 'done' || task.status === 'failed') throw new TaskStateError(id, task.status, 'cancel')
      this.db.prepare("UPDATE clone_tasks SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowIso(), id)
      return this.require(id)
    })
  }

  /**
   * Bump the `updated_at` of one running task; a terminal task is left alone,
   * so a late turn event cannot resurrect it.
   * @param id - task identity.
   */
  touchTask(id: TaskId): void {
    this.db.prepare("UPDATE clone_tasks SET updated_at = ? WHERE id = ? AND status = 'running'")
      .run(nowIso(), id)
  }

  /**
   * Move every `running` task to `failed` with one reason. Called once when
   * this process first opens the task table: a task a previous process left
   * running has no goal and no round, so its status must stop claiming it is
   * alive.
   * @param reason - host-written reason for the reconciliation.
   * @returns how many tasks the reconciliation moved.
   */
  failInterrupted(reason: string): number {
    return inTransaction(this.db, () => {
      const rows = this.db.prepare("SELECT * FROM clone_tasks WHERE status = 'running'").all() as unknown as TaskRow[]
      const now = nowIso()
      const update = this.db.prepare("UPDATE clone_tasks SET status = 'failed', result_summary = ?, updated_at = ? WHERE id = ?")
      for (const row of rows) update.run(failureSummary(row.result_summary, reason), now, row.id)
      return rows.length
    })
  }

  /** The entry read of one transition: a missing row is a missing task. */
  private entry(id: TaskId): CloneTaskRecord {
    const task = this.getTask(id)
    if (task === undefined) throw new TaskNotFoundError(id)
    return task
  }

  /** The read after a guarded write, or a loud failure. */
  private require(id: TaskId): CloneTaskRecord {
    const task = this.getTask(id)
    if (task === undefined) throw new Error(`task ${id}: the written row is missing`)
    return task
  }

  /** The stored status of one clone, or undefined when no row holds it. */
  private cloneStatus(id: CloneId): CloneStatus | undefined {
    const row = this.db.prepare('SELECT status FROM clones WHERE id = ?').get(id) as unknown as
      { status: string } | undefined
    if (row === undefined) return undefined
    if (!(CLONE_STATUSES as readonly string[]).includes(row.status)) {
      throw new Error(`clone ${id}: unknown status ${JSON.stringify(row.status)}`)
    }
    return row.status as CloneStatus
  }
}
