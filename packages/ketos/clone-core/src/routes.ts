/**
 * The exact Fetch route owning the clone domain: one path below `/api`, JSON in
 * and out, and stable error codes. Body validation is manual because this is a
 * wire boundary — nothing here trusts the browser, and unknown fields fail
 * loud instead of being dropped.
 * @module @ketos/clone-core/routes
 */

import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CloneDatabase } from './db.ts'
import { CloneConflictError, CloneNotFoundError, CLONE_STATUSES } from './repository.ts'
import type {
  CloneAnswerResponse, CloneBindingResponse, CloneCreateInput, CloneDeletedResponse, CloneErrorCode,
  CloneFailureResponse, CloneId, CloneListResponse, CloneRecord, CloneSessionsResponse, CloneStatus,
  CloneSuccessResponse, CloneUpdatePatch,
} from './types.ts'

/** Exact Fetch route path owning the clone domain. */
export const CLONES_PATH = '/api/ketos.clones'

/** Longest accepted text per field; the browser form enforces the same bounds. */
const LIMITS = {
  id: 200,
  name: 120,
  role: 120,
  description: 500,
  persona: 20_000,
  methodology: 20_000,
  preferredModel: 200,
  sessionId: 200,
  bindingRole: 32,
  skills: 100,
  skill: 200,
} as const

/** Every field each operation accepts, so a typo is a rejected request. */
const FIELDS = {
  list: ['op'],
  get: ['op', 'id'],
  create: ['op', 'name', 'role', 'description', 'persona', 'methodology', 'preferredModel', 'skills', 'status'],
  update: ['op', 'id', 'revision', 'patch'],
  delete: ['op', 'id', 'revision'],
  bindSession: ['op', 'cloneId', 'sessionId', 'role'],
  listSessions: ['op', 'cloneId'],
} as const

/** A request body the route refuses; mapped to 400 `ketos/invalid`. */
class InvalidBody extends Error {
  /**
   * @param reason - what the request got wrong; for tests and logs, never for the browser.
   */
  constructor(reason: string) {
    super(`invalid clone request: ${reason}`)
    this.name = 'InvalidBody'
  }
}

/** Response headers for every answer: clone data is private and never cached. */
const NO_STORE = { 'cache-control': 'no-store' } as const

/** A successful JSON answer. */
function ok(response: CloneSuccessResponse): Response {
  return Response.json(response, { headers: NO_STORE })
}

/** A failed JSON answer with one stable code. */
function fail(status: number, error: CloneErrorCode): Response {
  return Response.json({ ok: false, error } satisfies CloneFailureResponse, { status, headers: NO_STORE })
}

/** Narrow a decoded value to a JSON object. */
function record(value: unknown, reason: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InvalidBody(reason)
  return value as Record<string, unknown>
}

/** Reject any field the operation does not accept. */
function rejectUnknownFields(source: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) throw new InvalidBody(`unknown field ${JSON.stringify(key)}`)
  }
}

/** Required non-empty text, trimmed of surrounding whitespace. */
function requiredText(source: Record<string, unknown>, key: string, max: number): string {
  const value = source[key]
  if (typeof value !== 'string') throw new InvalidBody(`${key} must be a string`)
  const trimmed = value.trim()
  if (trimmed === '') throw new InvalidBody(`${key} must not be empty`)
  if (trimmed.length > max) throw new InvalidBody(`${key} exceeds ${String(max)} characters`)
  return trimmed
}

/** Optional text; absent stays absent, and the stored value keeps its own whitespace. */
function optionalText(source: Record<string, unknown>, key: string, max: number): string | undefined {
  const value = source[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new InvalidBody(`${key} must be a string`)
  if (value.length > max) throw new InvalidBody(`${key} exceeds ${String(max)} characters`)
  return value
}

/** Preferred model: absent, `null` (deployment default), or a bounded route id. */
function optionalModel(source: Record<string, unknown>): string | null | undefined {
  const value = source['preferredModel']
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string') throw new InvalidBody('preferredModel must be a string or null')
  if (value.length > LIMITS.preferredModel) {
    throw new InvalidBody(`preferredModel exceeds ${String(LIMITS.preferredModel)} characters`)
  }
  return value
}

/** Lifecycle status: absent, or one of the stored values. */
function optionalStatus(source: Record<string, unknown>): CloneStatus | undefined {
  const value = source['status']
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !(CLONE_STATUSES as readonly string[]).includes(value)) {
    throw new InvalidBody(`status must be one of ${CLONE_STATUSES.join(', ')}`)
  }
  return value as CloneStatus
}

/** Skills: absent, or a bounded array of bounded names. */
function optionalSkills(source: Record<string, unknown>): string[] | undefined {
  const value = source['skills']
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new InvalidBody('skills must be an array')
  if (value.length > LIMITS.skills) throw new InvalidBody(`skills exceeds ${String(LIMITS.skills)} entries`)
  return value.map((entry: unknown): string => {
    if (typeof entry !== 'string') throw new InvalidBody('skills must hold strings')
    if (entry.length > LIMITS.skill) {
      throw new InvalidBody(`a skill name exceeds ${String(LIMITS.skill)} characters`)
    }
    return entry
  })
}

/** Revision: the concrete integer the caller read. */
function requiredRevision(source: Record<string, unknown>): number {
  const value = source['revision']
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new InvalidBody('revision must be a positive integer')
  }
  return value
}

/** A binding role: absent (`main`), or a short label bounded by the column. */
function optionalBindingRole(source: Record<string, unknown>): string | undefined {
  const value = source['role']
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') throw new InvalidBody('role must be a non-empty string')
  if (value.length > LIMITS.bindingRole) {
    throw new InvalidBody(`role exceeds ${String(LIMITS.bindingRole)} characters`)
  }
  return value
}

/** Build the update patch from validated fields; an empty patch is refused. */
function parsePatch(source: Record<string, unknown>): CloneUpdatePatch {
  rejectUnknownFields(source, ['name', 'role', 'description', 'persona', 'methodology', 'preferredModel', 'status'])
  const name = optionalText(source, 'name', LIMITS.name)?.trim()
  if (name === '') throw new InvalidBody('name must not be empty')
  const role = optionalText(source, 'role', LIMITS.role)?.trim()
  if (role === '') throw new InvalidBody('role must not be empty')
  const description = optionalText(source, 'description', LIMITS.description)
  const persona = optionalText(source, 'persona', LIMITS.persona)
  const methodology = optionalText(source, 'methodology', LIMITS.methodology)
  const preferredModel = optionalModel(source)
  const status = optionalStatus(source)
  const patch: CloneUpdatePatch = {
    ...(name === undefined ? {} : { name }),
    ...(role === undefined ? {} : { role }),
    ...(description === undefined ? {} : { description }),
    ...(persona === undefined ? {} : { persona }),
    ...(methodology === undefined ? {} : { methodology }),
    ...(preferredModel === undefined ? {} : { preferredModel }),
    ...(status === undefined ? {} : { status }),
  }
  if (Object.keys(patch).length === 0) throw new InvalidBody('patch must set at least one field')
  return patch
}

/** Decode one stored record onto the wire. */
function toDto(record: CloneRecord): CloneAnswerResponse['clone'] {
  return {
    id: record.id,
    name: record.name,
    role: record.role,
    description: record.description,
    persona: record.persona,
    methodology: record.methodology,
    preferredModel: record.preferredModel,
    skills: record.skills,
    status: record.status,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** The `create` body decoded into the repository input. */
function parseCreate(source: Record<string, unknown>): CloneCreateInput {
  rejectUnknownFields(source, FIELDS.create)
  const description = optionalText(source, 'description', LIMITS.description)
  const persona = optionalText(source, 'persona', LIMITS.persona)
  const methodology = optionalText(source, 'methodology', LIMITS.methodology)
  const preferredModel = optionalModel(source)
  const skills = optionalSkills(source)
  const status = optionalStatus(source)
  return {
    name: requiredText(source, 'name', LIMITS.name),
    role: requiredText(source, 'role', LIMITS.role),
    ...(description === undefined ? {} : { description }),
    ...(persona === undefined ? {} : { persona }),
    ...(methodology === undefined ? {} : { methodology }),
    ...(preferredModel === undefined ? {} : { preferredModel }),
    ...(skills === undefined ? {} : { skills }),
    ...(status === undefined ? {} : { status }),
  }
}

/** Dispatch one decoded operation against the repository. */
async function dispatch(source: Record<string, unknown>, database: CloneDatabase): Promise<Response> {
  const op = source['op']
  const repository = await database.repository()
  switch (op) {
    case 'list': {
      rejectUnknownFields(source, FIELDS.list)
      const clones = repository.listClones().map(toDto)
      return ok({ ok: true, clones } satisfies CloneListResponse)
    }
    case 'get': {
      rejectUnknownFields(source, FIELDS.get)
      const clone = repository.getClone(requiredText(source, 'id', LIMITS.id) as CloneId)
      if (clone === undefined) return fail(404, 'ketos/clone-not-found')
      return ok({ ok: true, clone: toDto(clone) } satisfies CloneAnswerResponse)
    }
    case 'create': {
      const clone = repository.createClone(parseCreate(source))
      return ok({ ok: true, clone: toDto(clone) } satisfies CloneAnswerResponse)
    }
    case 'update': {
      rejectUnknownFields(source, FIELDS.update)
      const id = requiredText(source, 'id', LIMITS.id) as CloneId
      const revision = requiredRevision(source)
      const clone = repository.updateClone(id, parsePatch(record(source['patch'], 'patch must be an object')), revision)
      return ok({ ok: true, clone: toDto(clone) } satisfies CloneAnswerResponse)
    }
    case 'delete': {
      rejectUnknownFields(source, FIELDS.delete)
      const id = requiredText(source, 'id', LIMITS.id) as CloneId
      const revision = requiredRevision(source)
      repository.deleteClone(id, revision)
      return ok({ ok: true, id } satisfies CloneDeletedResponse)
    }
    case 'bindSession': {
      rejectUnknownFields(source, FIELDS.bindSession)
      const role = optionalBindingRole(source)
      const binding = repository.bindSession({
        cloneId: requiredText(source, 'cloneId', LIMITS.id) as CloneId,
        sessionId: brandString<SessionId>(requiredText(source, 'sessionId', LIMITS.sessionId)),
        ...(role === undefined ? {} : { role }),
      })
      return ok({ ok: true, binding } satisfies CloneBindingResponse)
    }
    case 'listSessions': {
      rejectUnknownFields(source, FIELDS.listSessions)
      const sessions = repository.listSessions(requiredText(source, 'cloneId', LIMITS.id) as CloneId)
      return ok({ ok: true, sessions } satisfies CloneSessionsResponse)
    }
    default:
      throw new InvalidBody(`unknown op ${JSON.stringify(op)}`)
  }
}

/**
 * Handle one authenticated clone request. `GET` lists clones; `POST` carries an
 * `op` field. Domain failures answer 404/409, malformed requests answer 400,
 * and anything else answers 500 without echoing the failure text.
 * @param request - authenticated request from the shared API channel.
 * @param database - the plugin's lazily opened clone database.
 * @returns the response for the browser.
 */
export async function handleCloneRequest(request: Request, database: CloneDatabase): Promise<Response> {
  try {
    if (request.method === 'GET') {
      const clones = (await database.repository()).listClones().map(toDto)
      return ok({ ok: true, clones } satisfies CloneListResponse)
    }
    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new InvalidBody('body must be JSON')
    }
    return await dispatch(record(body, 'body must be a JSON object'), database)
  } catch (error: unknown) {
    if (error instanceof InvalidBody) return fail(400, 'ketos/invalid')
    if (error instanceof CloneNotFoundError) return fail(404, 'ketos/clone-not-found')
    if (error instanceof CloneConflictError) return fail(409, 'ketos/clone-conflict')
    return new Response('clone request failed', { status: 500, headers: NO_STORE })
  }
}

/**
 * Register the clone route on the connection's authenticated Fetch surface.
 * The registration is an effect of the calling fiber, so disposing the plugin
 * withdraws the route.
 * @param ctx - context carrying `connection`.
 * @param database - the plugin's clone database.
 */
export function registerCloneRoutes(ctx: Context, database: CloneDatabase): void {
  ctx.connection.fetch.register({
    path: CLONES_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: request => handleCloneRequest(request, database),
  })
}
