/**
 * The exact Fetch route owning the clone memory: one path below `/api`, JSON in
 * and out, and stable error codes. `list` and `search` read, `update` and
 * `delete` write; every write notifies the coordinator so the prompt snapshot
 * of the affected clone is rebuilt before its next turn.
 *
 * Body validation is manual because this is a wire boundary — the browser is
 * never trusted, and unknown fields fail loud.
 * @module @ketos/clone-core/memory-routes
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { CloneDatabase } from './db.ts'
import {
  MEMORY_LIMITS, MEMORY_STATUSES, MemoryInvalidError, MemoryNotFoundError, memoryMatchExpression,
} from './memory.ts'
import type {
  CloneId, MemoryAnswerResponse, MemoryDeletedResponse, MemoryDto, MemoryId, MemoryListResponse,
  MemoryRecord, MemoryStatus, MemoryUpdatePatch,
} from './types.ts'
import { fail, InvalidBody, NO_STORE, ok, optionalStringList, optionalText, record, rejectUnknownFields, requiredText } from './wire.ts'

/** Exact Fetch route path owning the clone memory domain. */
export const MEMORY_PATH = '/api/ketos.memory'

/** Longest accepted search text; the repository refuses the same bound. */
const QUERY_LIMIT = 1000

/** Longest accepted memory identity and clone identity on the wire. */
const ID_LIMIT = 200

/** Every field each operation accepts, so a typo is a rejected request. */
const FIELDS = {
  list: ['op', 'cloneId', 'status'],
  search: ['op', 'cloneId', 'query', 'limit', 'status'],
  update: ['op', 'id', 'patch'],
  delete: ['op', 'id'],
} as const

/** Every field a patch may replace, so a typo is a rejected request. */
const PATCH_FIELDS = ['content', 'tags', 'status'] as const

/** Status: absent, or one of the stored values. */
function optionalMemoryStatus(source: Record<string, unknown>): MemoryStatus | undefined {
  const value = source['status']
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !(MEMORY_STATUSES as readonly string[]).includes(value)) {
    throw new InvalidBody(`status must be one of ${MEMORY_STATUSES.join(', ')}`)
  }
  return value as MemoryStatus
}

/** Search limit: absent, or an integer inside the documented range. */
function optionalLimit(source: Record<string, unknown>): number | undefined {
  const value = source['limit']
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MEMORY_LIMITS.searchLimit) {
    throw new InvalidBody(`limit must be an integer between 1 and ${String(MEMORY_LIMITS.searchLimit)}`)
  }
  return value
}

/** Build the update patch from validated fields; an empty patch is refused. */
function parsePatch(source: Record<string, unknown>): MemoryUpdatePatch {
  rejectUnknownFields(source, PATCH_FIELDS)
  const content = optionalText(source, 'content', MEMORY_LIMITS.content)
  if (content !== undefined && content.trim() === '') throw new InvalidBody('content must not be empty')
  const tags = optionalStringList(source, 'tags', MEMORY_LIMITS.tagCount, MEMORY_LIMITS.tag)
  const status = optionalMemoryStatus(source)
  const patch: MemoryUpdatePatch = {
    ...(content === undefined ? {} : { content }),
    ...(tags === undefined ? {} : { tags }),
    ...(status === undefined ? {} : { status }),
  }
  if (Object.keys(patch).length === 0) throw new InvalidBody('patch must set at least one field')
  return patch
}

/** Decode one stored record onto the wire. */
function toDto(memory: MemoryRecord): MemoryDto {
  return {
    id: memory.id,
    cloneId: memory.cloneId,
    content: memory.content,
    tags: memory.tags,
    sourceSessionId: memory.sourceSessionId,
    status: memory.status,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  }
}

/**
 * Dispatch one decoded operation against the memory repository. Every field is
 * parsed before the database is touched, so a malformed request is refused
 * without opening (or creating) the file.
 * @param request - decoded body, the plugin's lazily opened database, and the
 * mutation observer: the three inputs one memory request carries.
 * @returns the response for the browser.
 */
async function dispatchMemory(request: {
  readonly source: Record<string, unknown>
  readonly database: CloneDatabase
  readonly onMutated: (() => void) | undefined
}): Promise<Response> {
  const { source, database, onMutated } = request
  const op = source['op']
  switch (op) {
    case 'list': {
      rejectUnknownFields(source, FIELDS.list)
      const cloneId = requiredText(source, 'cloneId', ID_LIMIT) as CloneId
      const status = optionalMemoryStatus(source)
      const memories = (await database.memoryRepository()).listMemories(cloneId, status).map(toDto)
      return ok({ ok: true, memories } satisfies MemoryListResponse)
    }
    case 'search': {
      rejectUnknownFields(source, FIELDS.search)
      const cloneId = requiredText(source, 'cloneId', ID_LIMIT) as CloneId
      const query = requiredText(source, 'query', QUERY_LIMIT)
      // Build the MATCH expression before the repository opens the database: an
      // unsearchable query must be refused without creating the file.
      memoryMatchExpression(query)
      const limit = optionalLimit(source)
      const status = optionalMemoryStatus(source)
      const memories = (await database.memoryRepository())
        .search(cloneId, query, limit ?? MEMORY_LIMITS.searchLimit, status)
        .map(toDto)
      return ok({ ok: true, memories } satisfies MemoryListResponse)
    }
    case 'update': {
      rejectUnknownFields(source, FIELDS.update)
      const id = requiredText(source, 'id', ID_LIMIT) as MemoryId
      const patch = parsePatch(record(source['patch'], 'patch must be an object'))
      const memory = (await database.memoryRepository()).updateMemory(id, patch)
      onMutated?.()
      return ok({ ok: true, memory: toDto(memory) } satisfies MemoryAnswerResponse)
    }
    case 'delete': {
      rejectUnknownFields(source, FIELDS.delete)
      const id = requiredText(source, 'id', ID_LIMIT) as MemoryId
      const repository = await database.memoryRepository()
      repository.deleteMemory(id)
      onMutated?.()
      return ok({ ok: true, id } satisfies MemoryDeletedResponse)
    }
    default:
      throw new InvalidBody(`unknown op ${JSON.stringify(op)}`)
  }
}

/**
 * Handle one authenticated memory request. Domain failures answer 404,
 * malformed requests answer 400, and anything else answers 500 without echoing
 * the failure text.
 * @param request - authenticated request from the shared API channel.
 * @param database - the plugin's lazily opened clone database.
 * @param onMutated - called after a request changed a memory.
 * @returns the response for the browser.
 */
export async function handleMemoryRequest(
  request: Request,
  database: CloneDatabase,
  onMutated?: () => void,
): Promise<Response> {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new InvalidBody('body must be JSON')
    }
    return await dispatchMemory({ source: record(body, 'body must be a JSON object'), database, onMutated })
  } catch (error: unknown) {
    if (error instanceof InvalidBody || error instanceof MemoryInvalidError) return fail(400, 'ketos/invalid')
    if (error instanceof MemoryNotFoundError) return fail(404, 'ketos/memory-not-found')
    return new Response('memory request failed', { status: 500, headers: NO_STORE })
  }
}

/**
 * Register the memory route on the connection's authenticated Fetch surface.
 * The registration is an effect of the calling fiber, so disposing the plugin
 * withdraws the route.
 * @param ctx - context carrying `connection`.
 * @param database - the plugin's clone database.
 * @param onMutated - called after a request changed a memory, so consumers
 * deriving state from stored memory re-read it. Its failure is contained: the
 * write already committed, so it must not change the answer.
 */
export function registerMemoryRoutes(
  ctx: Context,
  database: CloneDatabase,
  onMutated?: () => void,
): void {
  ctx.connection.fetch.register({
    path: MEMORY_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: request => handleMemoryRequest(request, database, () => {
      try {
        onMutated?.()
      } catch (error: unknown) {
        ctx.logger.warn(`ketos-clone-core: memory notification failed: ${String(error)}`)
      }
    }),
  })
}
