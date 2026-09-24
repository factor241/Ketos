/**
 * Browser client of the exact `/api/ketos.clones` route: the request bodies the
 * host accepts, one decode per answer, and validation of every decoded record
 * before it reaches a component.
 *
 * The path is the host's route constant (`@ketos/clone-core/src/routes.ts`).
 * This half imports the domain types only, so the module carries no runtime
 * dependency on the host package.
 */
import type {
  CloneCreateInput, CloneDto, CloneErrorCode, CloneId, CloneSessionBinding, CloneSkill, CloneStatus,
  CloneUpdatePatch,
} from '@ketos/clone-core/types'

/** Exact route the clone host package registers below `/api`. */
const CLONES_PATH = '/api/ketos.clones'

/** Failure of one clone request. */
export type CloneFailureCode = CloneErrorCode | 'ketos/unreachable'

/** Outcome of one clone request: the decoded value, or a stable failure code. */
export type CloneResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: CloneFailureCode }

/** Whether a decoded value is a plain JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a decoded value is one of the stored lifecycle statuses. */
function isStatus(value: unknown): value is CloneStatus {
  return value === 'draft' || value === 'interviewing' || value === 'ready'
}

/** Whether a decoded value is one stored skill. */
function isSkill(value: unknown): value is CloneSkill {
  if (!isRecord(value)) return false
  return typeof value.name === 'string'
    && typeof value.description === 'string'
    && typeof value.instructions === 'string'
}

/** Decode one stored clone record, refusing anything the host does not promise. */
function isClone(value: unknown): value is CloneDto {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && value.id !== ''
    && typeof value.name === 'string'
    && typeof value.role === 'string'
    && typeof value.description === 'string'
    && typeof value.persona === 'string'
    && typeof value.methodology === 'string'
    && (value.preferredModel === null || typeof value.preferredModel === 'string')
    && Array.isArray(value.skills) && value.skills.every(isSkill)
    && isStatus(value.status)
    && typeof value.revision === 'number'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
}

/** Decode one session binding. */
function isBinding(value: unknown): value is CloneSessionBinding {
  if (!isRecord(value)) return false
  return typeof value.sessionId === 'string' && value.sessionId !== ''
    && typeof value.cloneId === 'string'
    && typeof value.role === 'string'
    && typeof value.createdAt === 'string'
}

/** One JSON request against the clone route. */
async function request(body: unknown, signal?: AbortSignal): Promise<Response> {
  return await fetch(CLONES_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  })
}

/**
 * Read the stable error code of one refused answer. The host always sends
 * `{ ok: false, error }`; a status-only answer (or any other body) still maps
 * to its code so a stripped proxy cannot turn a conflict into silence.
 * @param response - the refused response.
 * @param payload - its decoded body, when it was JSON.
 * @returns the failure code to report.
 */
function failureCode(response: Response, payload: unknown): CloneFailureCode {
  if (isRecord(payload)) {
    const { error } = payload
    if (error === 'ketos/invalid' || error === 'ketos/clone-not-found' || error === 'ketos/clone-conflict') return error
  }
  switch (response.status) {
    case 400: return 'ketos/invalid'
    case 404: return 'ketos/clone-not-found'
    case 409: return 'ketos/clone-conflict'
    default: return 'ketos/unreachable'
  }
}

/**
 * Send one operation and decode its single-record answer.
 * @param body - request body.
 * @param decode - validator for the expected `value` field.
 * @param signal - optional caller cancellation.
 * @returns the decoded value or the failure code.
 */
async function call<T>(body: unknown, decode: (value: unknown) => value is T, signal?: AbortSignal): Promise<CloneResult<T>> {
  try {
    const response = await request(body, signal)
    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok) return { ok: false, code: failureCode(response, payload) }
    if (!isRecord(payload) || payload.ok !== true) return { ok: false, code: 'ketos/unreachable' }
    const value = payload['clone'] ?? payload['binding'] ?? payload['id']
    if (!decode(value)) return { ok: false, code: 'ketos/unreachable' }
    return { ok: true, value }
  } catch {
    return { ok: false, code: 'ketos/unreachable' }
  }
}

/** Whether a decoded value is one clone identity. */
function isId(value: unknown): value is CloneId {
  return typeof value === 'string' && value !== ''
}

/** Whether a decoded value is a list of clone records. */
function isCloneList(value: unknown): value is readonly CloneDto[] {
  return Array.isArray(value) && value.every(isClone)
}

/** Whether a decoded value is a list of session bindings. */
function isBindingList(value: unknown): value is readonly CloneSessionBinding[] {
  return Array.isArray(value) && value.every(isBinding)
}

/**
 * Read every clone.
 * @param signal - optional caller cancellation.
 * @returns the clones or the failure code.
 */
export async function listClones(signal?: AbortSignal): Promise<CloneResult<readonly CloneDto[]>> {
  try {
    const response = await fetch(CLONES_PATH, signal === undefined ? {} : { signal })
    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok) return { ok: false, code: failureCode(response, payload) }
    if (!isRecord(payload) || payload.ok !== true || !isCloneList(payload['clones'])) {
      return { ok: false, code: 'ketos/unreachable' }
    }
    return { ok: true, value: payload['clones'] }
  } catch {
    return { ok: false, code: 'ketos/unreachable' }
  }
}

/**
 * Read one clone.
 * @param id - clone identity.
 * @param signal - optional caller cancellation.
 * @returns the clone or the failure code.
 */
export async function getClone(id: CloneId, signal?: AbortSignal): Promise<CloneResult<CloneDto>> {
  return await call({ op: 'get', id }, isClone, signal)
}

/**
 * Create one clone.
 * @param input - name and role plus the optional authored fields.
 * @returns the created clone or the failure code.
 */
export async function createClone(input: CloneCreateInput): Promise<CloneResult<CloneDto>> {
  return await call({ op: 'create', ...input }, isClone)
}

/**
 * Replace the given fields of one clone under its current revision.
 * @param id - clone identity.
 * @param patch - fields to replace.
 * @param revision - revision the caller read.
 * @returns the updated clone or the failure code.
 */
export async function updateClone(id: CloneId, patch: CloneUpdatePatch, revision: number): Promise<CloneResult<CloneDto>> {
  return await call({ op: 'update', id, revision, patch }, isClone)
}

/**
 * Delete one clone and its session bindings.
 * @param id - clone identity.
 * @param revision - revision the caller read.
 * @returns the removed identity or the failure code.
 */
export async function deleteClone(id: CloneId, revision: number): Promise<CloneResult<CloneId>> {
  return await call({ op: 'delete', id, revision }, isId)
}

/**
 * Bind one session to one clone.
 * @param cloneId - clone identity.
 * @param sessionId - session to bind.
 * @param role - binding role; the host stores `main` when absent.
 * @returns the stored binding or the failure code.
 */
export async function bindSessionToClone(
  cloneId: CloneId,
  sessionId: string,
  role?: string,
): Promise<CloneResult<CloneSessionBinding>> {
  return await call({ op: 'bindSession', cloneId, sessionId, ...(role === undefined ? {} : { role }) }, isBinding)
}

/**
 * List the sessions bound to one clone.
 * @param cloneId - clone identity.
 * @param signal - optional caller cancellation.
 * @returns the bindings or the failure code.
 */
export async function listCloneSessions(
  cloneId: CloneId,
  signal?: AbortSignal,
): Promise<CloneResult<readonly CloneSessionBinding[]>> {
  try {
    const response = await request({ op: 'listSessions', cloneId }, signal)
    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok) return { ok: false, code: failureCode(response, payload) }
    if (!isRecord(payload) || payload.ok !== true || !isBindingList(payload['sessions'])) {
      return { ok: false, code: 'ketos/unreachable' }
    }
    return { ok: true, value: payload['sessions'] }
  } catch {
    return { ok: false, code: 'ketos/unreachable' }
  }
}
