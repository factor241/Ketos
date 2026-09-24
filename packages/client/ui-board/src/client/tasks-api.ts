/**
 * Browser client of the exact `/api/ketos.tasks` route: the request bodies the
 * host accepts, one decode per answer, and validation of every decoded record
 * before it reaches a component.
 *
 * The path is the host's route constant (`@ketos/clone-core/src/task-routes.ts`).
 * This half imports the domain types only, so the module carries no runtime
 * dependency on the host package.
 */
import type { CloneId, CloneTaskDto, TaskId, TaskStatus } from '@ketos/clone-core/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TaskFailureCode } from './contract/slots.ts'

/** Exact route the clone host package registers below `/api`. */
const TASKS_PATH = '/api/ketos.tasks'

/** How often the tasks window re-reads the roster while a task is active. */
export const TASK_POLL_INTERVAL_MS = 750

/** Outcome of one tasks request: the decoded value, or a stable failure code. */
export type TaskResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: TaskFailureCode }

/** Whether a decoded value is a plain JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a decoded value is one of the stored task statuses. */
function isStatus(value: unknown): value is TaskStatus {
  return value === 'pending' || value === 'running' || value === 'done'
    || value === 'failed' || value === 'cancelled'
}

/**
 * Decode one stored task record, refusing anything the host does not promise.
 * @param value - decoded JSON value of one `task` field.
 * @returns whether the value is a task record.
 */
export function isTask(value: unknown): value is CloneTaskDto {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && value.id !== ''
    && typeof value.cloneId === 'string' && value.cloneId !== ''
    && (value.sessionId === null || typeof value.sessionId === 'string')
    && typeof value.objective === 'string'
    && isStatus(value.status)
    && (value.resultSummary === null || typeof value.resultSummary === 'string')
    && typeof value.maxRounds === 'number'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
}

/**
 * Decode one task-list answer.
 * @param value - decoded JSON value of the `tasks` field.
 * @returns whether the value is a list of task records.
 */
export function isTaskList(value: unknown): value is readonly CloneTaskDto[] {
  return Array.isArray(value) && value.every(isTask)
}

/** Failure codes the host reports in the JSON body. */
const FAILURE_CODES = [
  'ketos/invalid',
  'ketos/task-not-found',
  'ketos/clone-not-found',
  'ketos/invalid-state',
  'ketos/agent-not-live',
] as const satisfies readonly TaskFailureCode[]

/** Whether a decoded value is one of the host's task failure codes. */
function isFailureCode(value: unknown): value is TaskFailureCode {
  return typeof value === 'string' && (FAILURE_CODES as readonly string[]).includes(value)
}

/** One JSON request against the tasks route. */
async function request(body: unknown): Promise<Response> {
  return await fetch(TASKS_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * Read the stable error code of one refused answer. The host always sends
 * `{ ok: false, error }`; a status-only answer still maps to the code its
 * status stands for, so a stripped proxy cannot turn a missing task into
 * silence.
 * @param response - the refused response.
 * @param payload - its decoded body, when it was JSON.
 * @returns the failure code to report.
 */
function failureCode(response: Response, payload: unknown): TaskFailureCode {
  if (isRecord(payload) && isFailureCode(payload['error'])) return payload['error']
  switch (response.status) {
    case 400: return 'ketos/invalid'
    case 404: return 'ketos/task-not-found'
    case 409: return 'ketos/invalid-state'
    default: return 'ketos/unreachable'
  }
}

/**
 * Send one operation and decode its single-task answer.
 * @param body - request body.
 * @returns the decoded task or the failure code.
 */
async function call(body: unknown): Promise<TaskResult<CloneTaskDto>> {
  try {
    const response = await request(body)
    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok) return { ok: false, code: failureCode(response, payload) }
    if (!isRecord(payload) || payload['ok'] !== true || !isTask(payload['task'])) {
      return { ok: false, code: 'ketos/unreachable' }
    }
    return { ok: true, value: payload['task'] }
  } catch {
    return { ok: false, code: 'ketos/unreachable' }
  }
}

/**
 * Send one operation and decode its task-list answer.
 * @param body - request body.
 * @returns the decoded tasks or the failure code.
 */
async function callList(body: unknown): Promise<TaskResult<readonly CloneTaskDto[]>> {
  try {
    const response = await request(body)
    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok) return { ok: false, code: failureCode(response, payload) }
    if (!isRecord(payload) || payload['ok'] !== true || !isTaskList(payload['tasks'])) {
      return { ok: false, code: 'ketos/unreachable' }
    }
    return { ok: true, value: payload['tasks'] }
  } catch {
    return { ok: false, code: 'ketos/unreachable' }
  }
}

/**
 * List the stored tasks, newest first.
 * @param cloneId - restrict to one clone; absent lists every clone's tasks.
 * @returns the tasks or the failure code.
 */
export async function listTasks(cloneId?: CloneId): Promise<TaskResult<readonly CloneTaskDto[]>> {
  return await callList(cloneId === undefined ? { op: 'list' } : { op: 'list', cloneId })
}

/**
 * Store one pending task for a clone.
 * @param cloneId - clone the task belongs to.
 * @param objective - what the clone must achieve.
 * @returns the created task or the failure code.
 */
export async function createTask(cloneId: CloneId, objective: string): Promise<TaskResult<CloneTaskDto>> {
  return await call({ op: 'create', cloneId, objective })
}

/**
 * Start one pending task against a session.
 * @param taskId - task identity.
 * @param sessionId - session that will run the task.
 * @returns the started task or the failure code.
 */
export async function startTask(taskId: TaskId, sessionId: SessionId): Promise<TaskResult<CloneTaskDto>> {
  return await call({ op: 'start', id: taskId, sessionId })
}

/**
 * Cancel one pending or running task; repeating the cancel is idempotent.
 * @param taskId - task identity.
 * @returns the cancelled task or the failure code.
 */
export async function cancelTask(taskId: TaskId): Promise<TaskResult<CloneTaskDto>> {
  return await call({ op: 'cancel', id: taskId })
}
