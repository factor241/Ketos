/**
 * The exact Fetch route owning the clone tasks: one path below `/api`, JSON in
 * and out, and stable error codes. `list` and `get` read, `create` stores a
 * pending task, and `start` and `cancel` drive the lifecycle through the
 * runner the plugin supplies.
 *
 * Body validation is manual because this is a wire boundary — the browser is
 * never trusted, and unknown fields fail loud.
 * @module @ketos/clone-core/task-routes
 */

import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CloneDatabase } from './db.ts'
import { CloneNotFoundError } from './repository.ts'
import {
  TASK_OBJECTIVE_LIMIT, TaskNotFoundError, TaskStateError, CloneNotReadyError,
} from './task-repository.ts'
import { AgentNotLiveError } from './task-runner.ts'
import type { CloneId, CloneTaskDto, CloneTaskRecord, TaskAnswerResponse, TaskId, TaskListResponse } from './types.ts'
import { fail, InvalidBody, NO_STORE, ok, optionalText, record, rejectUnknownFields, requiredText } from './wire.ts'

/** Exact Fetch route path owning the clone tasks domain. */
export const TASKS_PATH = '/api/ketos.tasks'

/** Longest accepted identity per field on the wire. */
const ID_LIMIT = 200

/** Every field each operation accepts, so a typo is a rejected request. */
const FIELDS = {
  list: ['op', 'cloneId'],
  get: ['op', 'id'],
  create: ['op', 'cloneId', 'objective'],
  start: ['op', 'id', 'sessionId'],
  cancel: ['op', 'id'],
} as const

/** What the route delegates to the plugin: the two lifecycle operations. */
export interface TaskRouteHooks {
  /**
   * Start one pending task against a live session.
   * @param taskId - task identity.
   * @param sessionId - session that will run the task.
   * @returns the started task.
   */
  readonly start: (taskId: TaskId, sessionId: SessionId) => Promise<CloneTaskRecord>
  /**
   * Cancel one pending or running task.
   * @param taskId - task identity.
   * @returns the cancelled task.
   */
  readonly cancel: (taskId: TaskId) => Promise<CloneTaskRecord>
  /**
   * Called after a request changed a task, so consumers deriving state from
   * stored tasks re-read it. Its failure is contained: the write already
   * committed, so it must not change the answer.
   */
  readonly onMutated?: (() => void) | undefined
}

/** Decode one stored task onto the wire. */
function toDto(task: CloneTaskRecord): CloneTaskDto {
  return {
    id: task.id,
    cloneId: task.cloneId,
    sessionId: task.sessionId,
    objective: task.objective,
    status: task.status,
    resultSummary: task.resultSummary,
    maxRounds: task.maxRounds,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

/**
 * Dispatch one decoded operation. Every field is parsed before the database is
 * touched, so a malformed request is refused without opening (or creating) the
 * file.
 * @param request - decoded body, the plugin's database, the lifecycle hooks
 * and the configured default round budget.
 * @returns the response for the browser.
 */
async function dispatch(request: {
  readonly source: Record<string, unknown>
  readonly database: CloneDatabase
  readonly hooks: TaskRouteHooks
  readonly defaultMaxRounds: number
}): Promise<Response> {
  const { source, database, hooks, defaultMaxRounds } = request
  const op = source['op']
  switch (op) {
    case 'list': {
      rejectUnknownFields(source, FIELDS.list)
      const cloneId = optionalText(source, 'cloneId', ID_LIMIT)
      const tasks = (await database.taskRepository())
        .listTasks(cloneId === undefined ? undefined : brandString<CloneId>(cloneId))
        .map(toDto)
      return ok({ ok: true, tasks } satisfies TaskListResponse)
    }
    case 'get': {
      rejectUnknownFields(source, FIELDS.get)
      const id = requiredText(source, 'id', ID_LIMIT) as TaskId
      const task = (await database.taskRepository()).getTask(id)
      if (task === undefined) return fail(404, 'ketos/task-not-found')
      return ok({ ok: true, task: toDto(task) } satisfies TaskAnswerResponse)
    }
    case 'create': {
      rejectUnknownFields(source, FIELDS.create)
      const cloneId = requiredText(source, 'cloneId', ID_LIMIT) as CloneId
      const objective = requiredText(source, 'objective', TASK_OBJECTIVE_LIMIT)
      const task = (await database.taskRepository()).createTask({ cloneId, objective, maxRounds: defaultMaxRounds })
      hooks.onMutated?.()
      return ok({ ok: true, task: toDto(task) } satisfies TaskAnswerResponse)
    }
    case 'start': {
      rejectUnknownFields(source, FIELDS.start)
      const id = requiredText(source, 'id', ID_LIMIT) as TaskId
      const sessionId = brandString<SessionId>(requiredText(source, 'sessionId', ID_LIMIT))
      const task = await hooks.start(id, sessionId)
      hooks.onMutated?.()
      return ok({ ok: true, task: toDto(task) } satisfies TaskAnswerResponse)
    }
    case 'cancel': {
      rejectUnknownFields(source, FIELDS.cancel)
      const id = requiredText(source, 'id', ID_LIMIT) as TaskId
      const task = await hooks.cancel(id)
      hooks.onMutated?.()
      return ok({ ok: true, task: toDto(task) } satisfies TaskAnswerResponse)
    }
    default:
      throw new InvalidBody(`unknown op ${JSON.stringify(op)}`)
  }
}

/**
 * Handle one authenticated tasks request. Domain failures answer 404 or 409,
 * malformed requests answer 400, and anything else answers 500 without echoing
 * the failure text.
 * @param request - authenticated request from the shared API channel.
 * @param database - the plugin's lazily opened clone database.
 * @param hooks - the lifecycle operations and the mutation observer.
 * @param defaultMaxRounds - configured round budget a created task stores.
 * @returns the response for the browser.
 */
export async function handleTaskRequest(
  request: Request,
  database: CloneDatabase,
  hooks: TaskRouteHooks,
  defaultMaxRounds: number,
): Promise<Response> {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new InvalidBody('body must be JSON')
    }
    return await dispatch({ source: record(body, 'body must be a JSON object'), database, hooks, defaultMaxRounds })
  } catch (error: unknown) {
    if (error instanceof InvalidBody) return fail(400, 'ketos/invalid')
    if (error instanceof TaskNotFoundError) return fail(404, 'ketos/task-not-found')
    if (error instanceof CloneNotFoundError) return fail(404, 'ketos/clone-not-found')
    if (error instanceof TaskStateError || error instanceof CloneNotReadyError) return fail(409, 'ketos/invalid-state')
    if (error instanceof AgentNotLiveError) return fail(409, 'ketos/agent-not-live')
    return new Response('task request failed', { status: 500, headers: NO_STORE })
  }
}

/**
 * Register the tasks route on the connection's authenticated Fetch surface.
 * The registration is an effect of the calling fiber, so disposing the plugin
 * withdraws the route.
 * @param ctx - context carrying `connection`.
 * @param database - the plugin's clone database.
 * @param hooks - the lifecycle operations and the mutation observer.
 * @param defaultMaxRounds - configured round budget a created task stores.
 */
export function registerTaskRoutes(
  ctx: Context,
  database: CloneDatabase,
  hooks: TaskRouteHooks,
  defaultMaxRounds: number,
): void {
  ctx.connection.fetch.register({
    path: TASKS_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: request => handleTaskRequest(request, database, {
      ...hooks,
      onMutated: () => {
        try {
          hooks.onMutated?.()
        } catch (error: unknown) {
          ctx.logger.warn(`ketos-clone-core: task notification failed: ${String(error)}`)
        }
      },
    }, defaultMaxRounds),
  })
}
