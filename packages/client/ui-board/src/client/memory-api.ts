/**
 * Browser client of the exact `/api/ketos.memory` route: the request bodies the
 * host accepts, one decode per answer, and validation of every decoded record
 * before it reaches a component.
 *
 * The path is the host's route constant (`@ketos/clone-core/src/memory-routes.ts`).
 * This half imports the domain types only, so the module carries no runtime
 * dependency on the host package.
 */
import type {
  CloneId, MemoryDto, MemoryErrorCode, MemoryId, MemoryStatus, MemoryUpdatePatch,
} from '@ketos/clone-core/types'

/** Exact route the clone host package registers below `/api`. */
const MEMORY_PATH = '/api/ketos.memory'

/** Failure of one memory request. */
export type MemoryFailureCode = MemoryErrorCode | 'ketos/unreachable'

/** Outcome of one memory request: the decoded value, or a stable failure code. */
export type MemoryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: MemoryFailureCode }

/** Whether a decoded value is a plain JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a decoded value is one of the stored memory statuses. */
function isStatus(value: unknown): value is MemoryStatus {
  return value === 'active' || value === 'candidate' || value === 'archived'
}

/** Decode one stored memory record, refusing anything the host does not promise. */
function isMemory(value: unknown): value is MemoryDto {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && value.id !== ''
    && typeof value.cloneId === 'string' && value.cloneId !== ''
    && typeof value.content === 'string'
    && Array.isArray(value.tags) && value.tags.every(tag => typeof tag === 'string')
    && (value.sourceSessionId === null || typeof value.sourceSessionId === 'string')
    && isStatus(value.status)
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
}

/** Whether a decoded value is a list of memory records. */
function isMemoryList(value: unknown): value is readonly MemoryDto[] {
  return Array.isArray(value) && value.every(isMemory)
}

/** Whether a decoded value is one memory identity. */
function isId(value: unknown): value is MemoryId {
  return typeof value === 'string' && value !== ''
}

/** One JSON request against the memory route. */
async function request(body: unknown): Promise<Response> {
  return await fetch(MEMORY_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * Read the stable error code of one refused answer. The host always sends
 * `{ ok: false, error }`; a status-only answer still maps to its code, so a
 * stripped proxy cannot turn a missing memory into silence.
 * @param response - the refused response.
 * @param payload - its decoded body, when it was JSON.
 * @returns the failure code to report.
 */
function failureCode(response: Response, payload: unknown): MemoryFailureCode {
  if (isRecord(payload) && (payload['error'] === 'ketos/invalid' || payload['error'] === 'ketos/memory-not-found')) {
    return payload['error']
  }
  switch (response.status) {
    case 400: return 'ketos/invalid'
    case 404: return 'ketos/memory-not-found'
    default: return 'ketos/unreachable'
  }
}

/**
 * Send one operation and decode its single-record answer.
 * @param body - request body.
 * @param decode - validator for the expected `memory` field.
 * @returns the decoded value or the failure code.
 */
async function call<T>(body: unknown, decode: (value: unknown) => value is T): Promise<MemoryResult<T>> {
  try {
    const response = await request(body)
    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok) return { ok: false, code: failureCode(response, payload) }
    if (!isRecord(payload) || payload['ok'] !== true) return { ok: false, code: 'ketos/unreachable' }
    const value = payload['memory']
    if (!decode(value)) return { ok: false, code: 'ketos/unreachable' }
    return { ok: true, value }
  } catch {
    return { ok: false, code: 'ketos/unreachable' }
  }
}

/**
 * Send one operation and decode its memory-list answer.
 * @param body - request body.
 * @returns the decoded records or the failure code.
 */
async function callList(body: unknown): Promise<MemoryResult<readonly MemoryDto[]>> {
  try {
    const response = await request(body)
    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok) return { ok: false, code: failureCode(response, payload) }
    if (!isRecord(payload) || payload['ok'] !== true || !isMemoryList(payload['memories'])) {
      return { ok: false, code: 'ketos/unreachable' }
    }
    return { ok: true, value: payload['memories'] }
  } catch {
    return { ok: false, code: 'ketos/unreachable' }
  }
}

/**
 * List the memories of one clone, newest first.
 * @param cloneId - clone identity.
 * @param status - restrict to one status; absent lists every status.
 * @returns the memories or the failure code.
 */
export async function listMemories(
  cloneId: CloneId,
  status?: MemoryStatus,
): Promise<MemoryResult<readonly MemoryDto[]>> {
  return await callList({ op: 'list', cloneId, ...(status === undefined ? {} : { status }) })
}

/**
 * Full-text search inside one clone's memories.
 * @param cloneId - clone identity.
 * @param query - search text; every token matches as a prefix.
 * @param status - restrict to one status; absent searches every status but `archived`.
 * @returns the matching memories or the failure code.
 */
export async function searchMemories(
  cloneId: CloneId,
  query: string,
  status?: MemoryStatus,
): Promise<MemoryResult<readonly MemoryDto[]>> {
  return await callList({ op: 'search', cloneId, query, ...(status === undefined ? {} : { status }) })
}

/**
 * Replace the patch's fields on one memory.
 * @param id - memory identity.
 * @param patch - fields to replace.
 * @returns the updated memory or the failure code.
 */
export async function updateMemory(id: MemoryId, patch: MemoryUpdatePatch): Promise<MemoryResult<MemoryDto>> {
  return await call({ op: 'update', id, patch }, isMemory)
}

/**
 * Delete one memory.
 * @param id - memory identity.
 * @returns the removed identity or the failure code.
 */
export async function deleteMemory(id: MemoryId): Promise<MemoryResult<MemoryId>> {
  try {
    const response = await request({ op: 'delete', id })
    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok) return { ok: false, code: failureCode(response, payload) }
    if (!isRecord(payload) || payload['ok'] !== true || !isId(payload['id'])) {
      return { ok: false, code: 'ketos/unreachable' }
    }
    return { ok: true, value: payload['id'] }
  } catch {
    return { ok: false, code: 'ketos/unreachable' }
  }
}
