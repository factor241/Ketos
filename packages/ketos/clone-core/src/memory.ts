/**
 * Prepared-statement repository over the clone memory and its FTS5 index.
 *
 * The index is a standalone FTS5 table with no triggers, so every write keeps
 * table and index in step inside one transaction; a schema that never synced
 * is impossible to reach through this module. Search matches quoted token
 * prefixes, which keeps FTS5 syntax inert data and compensates for `unicode61`
 * doing no stemming.
 * @module @ketos/clone-core/memory
 */

import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  CloneId, MemoryCreateInput, MemoryId, MemoryRecord, MemoryStatus, MemoryUpdatePatch,
} from './types.ts'
import { CloneNotFoundError } from './repository.ts'
import { inTransaction } from './transaction.ts'

/**
 * A memory that the caller asked for and the database does not hold. Extending
 * {@link HarnessError} makes the code survive into a tool result as well as
 * into the route's answer.
 */
export class MemoryNotFoundError extends HarnessError {
  /**
   * @param id - the memory identity that is absent.
   */
  constructor(id: string) {
    super(`memory ${id} does not exist`, 'ketos/memory-not-found')
  }
}

/**
 * A memory value the store refuses: empty content, an over-long text or tag,
 * an unknown status, or a search request outside its bounds. Extending
 * {@link HarnessError} makes the code survive into the tool result.
 */
export class MemoryInvalidError extends HarnessError {
  /**
   * @param reason - what the value got wrong.
   */
  constructor(reason: string) {
    super(`invalid memory: ${reason}`, 'ketos/invalid-memory')
  }
}

/** The only statuses the stored `status` column decodes to and the wire accepts. */
export const MEMORY_STATUSES = ['active', 'candidate', 'archived'] as const satisfies readonly MemoryStatus[]

/**
 * Longest accepted value per memory field, and the only source of these
 * numbers: the route validates them on the wire and the tools validate them
 * before their write, because a tool schema can express neither `maxLength`
 * nor `maxItems`.
 */
export const MEMORY_LIMITS = {
  content: 4000,
  tag: 100,
  tagCount: 50,
  searchLimit: 20,
} as const

/** One `memories` row as SQLite returns it. */
interface MemoryRow {
  id: string
  clone_id: string
  content: string
  tags: string
  source_session_id: string | null
  status: string
  created_at: string
  updated_at: string
}

/** Current time as the ISO-8601 UTC string every timestamp column stores. */
function nowIso(): string {
  return new Date().toISOString()
}

/** Decode the stored tags document, refusing anything but an array of strings. */
function parseTags(id: string, json: string): string[] {
  const value: unknown = JSON.parse(json)
  if (!Array.isArray(value)) throw new Error(`memory ${id}: tags is not an array of strings`)
  const tags: string[] = []
  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== 'string') throw new Error(`memory ${id}: tags is not an array of strings`)
    tags.push(entry)
  }
  return tags
}

/** Decode the stored lifecycle status. */
function parseMemoryStatus(id: string, value: string): MemoryStatus {
  if (!(MEMORY_STATUSES as readonly string[]).includes(value)) {
    throw new Error(`memory ${id}: unknown status ${JSON.stringify(value)}`)
  }
  return value as MemoryStatus
}

/** Decode one stored memory row. */
function toMemory(row: MemoryRow): MemoryRecord {
  return {
    id: brandString<MemoryId>(row.id),
    cloneId: brandString<CloneId>(row.clone_id),
    content: row.content,
    tags: parseTags(row.id, row.tags),
    sourceSessionId: row.source_session_id === null ? null : brandString<SessionId>(row.source_session_id),
    status: parseMemoryStatus(row.id, row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Quote caller text as one FTS5 phrase so query syntax remains inert data. */
function quoteFtsData(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

/** Control characters a bound C string cannot carry; SQLite would truncate the expression at one. */
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/u

/**
 * Build the FTS5 MATCH expression for a caller query: every
 * whitespace-separated token that holds a letter or digit becomes one quoted
 * literal phrase with a trailing prefix marker (`"навык"*`). Quoting keeps
 * query syntax inert, and the marker finds inflected Russian forms without
 * stemming. Punctuation-only tokens carry no searchable text and are dropped;
 * a query with no token left, or one carrying a control character, is refused.
 * @param query - caller-supplied search text.
 * @returns the MATCH expression.
 * @throws MemoryInvalidError when the query holds no searchable token or a control character.
 */
export function memoryMatchExpression(query: string): string {
  const tokens = query.trim().split(/\s+/u).filter(token => token !== '')
  if (tokens.some(token => CONTROL_CHARACTER.test(token))) {
    throw new MemoryInvalidError('query must not contain control characters')
  }
  const searchable = tokens.filter(token => /[\p{L}\p{N}]/u.test(token))
  if (searchable.length === 0) throw new MemoryInvalidError('query must contain non-whitespace text')
  return searchable.map(token => `${quoteFtsData(token)}*`).join(' ')
}

/** Refuse content the columns cannot hold; the route and the tools validate the same bound. */
function requireContent(content: string): string {
  const trimmed = content.trim()
  if (trimmed === '') throw new MemoryInvalidError('content must not be empty')
  if (trimmed.length > MEMORY_LIMITS.content) {
    throw new MemoryInvalidError(`content exceeds ${String(MEMORY_LIMITS.content)} characters`)
  }
  return trimmed
}

/**
 * Refuse a tag list the columns cannot hold, trimming every tag. The route
 * validates the same rules before it opens the database, so both callers share
 * this function rather than restating the bounds.
 * @param tags - caller-supplied tag list.
 * @returns the trimmed tags.
 * @throws MemoryInvalidError when a tag is empty, over-long, or not a single line.
 */
export function normalizeTags(tags: readonly string[]): string[] {
  if (tags.length > MEMORY_LIMITS.tagCount) {
    throw new MemoryInvalidError(`tags exceeds ${String(MEMORY_LIMITS.tagCount)} entries`)
  }
  return tags.map((tag) => {
    const trimmed = tag.trim()
    if (trimmed === '') throw new MemoryInvalidError('a tag must not be empty')
    if (trimmed.length > MEMORY_LIMITS.tag) {
      throw new MemoryInvalidError(`a tag exceeds ${String(MEMORY_LIMITS.tag)} characters`)
    }
    // A comma separates tags in the memory window's editor, so a stored tag
    // carrying one could never round-trip through that form; the same editor
    // is a single line, so a control character would be silently dropped.
    if (trimmed.includes(',')) throw new MemoryInvalidError('a tag must not contain a comma')
    if (CONTROL_CHARACTER.test(trimmed)) {
      throw new MemoryInvalidError('a tag must not contain control characters')
    }
    return trimmed
  })
}

/** Decode a caller-supplied status. */
function requireStatus(value: string): MemoryStatus {
  if (!(MEMORY_STATUSES as readonly string[]).includes(value)) {
    throw new MemoryInvalidError(`unknown status ${JSON.stringify(value)}`)
  }
  return value as MemoryStatus
}

/** Refuse a search limit outside the documented range. */
function requireSearchLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MEMORY_LIMITS.searchLimit) {
    throw new MemoryInvalidError(`limit must be an integer between 1 and ${String(MEMORY_LIMITS.searchLimit)}`)
  }
}

/** Create, search, update, and delete the memories of a clone. */
export class MemoryRepository {
  private readonly db: DatabaseSync

  /**
   * @param db - open clone database.
   */
  constructor(db: DatabaseSync) {
    this.db = db
  }

  /**
   * Insert one memory at a freshly minted identity and index it, in one
   * transaction.
   * @param input - clone identity, content, and optional tags, source, status.
   * @returns the stored record.
   * @throws CloneNotFoundError when the clone does not exist.
   * @throws MemoryInvalidError when a value exceeds its bound.
   */
  remember(input: MemoryCreateInput): MemoryRecord {
    if (this.db.prepare('SELECT 1 FROM clones WHERE id = ?').get(input.cloneId) === undefined) {
      throw new CloneNotFoundError(input.cloneId)
    }
    const content = requireContent(input.content)
    const tags = normalizeTags(input.tags ?? [])
    const status = requireStatus(input.status ?? 'active')
    const id = brandString<MemoryId>(randomUUID())
    const now = nowIso()
    inTransaction(this.db, () => {
      this.db.prepare(`
        INSERT INTO memories (id, clone_id, content, tags, source_session_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.cloneId, content, JSON.stringify(tags), input.sourceSessionId ?? null, status, now, now)
      this.index(id, content, tags, input.cloneId)
    })
    return this.requireMemory(id)
  }

  /**
   * One memory by identity.
   * @param id - memory identity.
   * @returns the stored record, or undefined when no row holds the identity.
   */
  getMemory(id: MemoryId): MemoryRecord | undefined {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as unknown as MemoryRow | undefined
    return row === undefined ? undefined : toMemory(row)
  }

  /**
   * Full-text search over one clone's memories, best match first, newest
   * first among equal scores.
   * @param cloneId - clone identity to search inside.
   * @param query - search text; every token matches as a quoted prefix.
   * @param limit - largest number of rows to return.
   * @param status - restrict to one status; absent searches every status but `archived`.
   * @returns the matching records.
   * @throws MemoryInvalidError when the query holds no searchable token or the limit is out of range.
   */
  search(cloneId: CloneId, query: string, limit: number = MEMORY_LIMITS.searchLimit, status?: MemoryStatus): MemoryRecord[] {
    requireSearchLimit(limit)
    const expression = memoryMatchExpression(query)
    const statusClause = status === undefined ? "m.status != 'archived'" : 'm.status = ?'
    const bindings: Array<string | number> = [expression, cloneId]
    if (status !== undefined) bindings.push(status)
    bindings.push(limit)
    const rows = this.db.prepare(`
      SELECT m.* FROM memories_fts
      JOIN memories m ON m.id = memories_fts.id
      WHERE memories_fts MATCH ? AND m.clone_id = ? AND ${statusClause}
      ORDER BY memories_fts.rank, m.rowid DESC
      LIMIT ?
    `).all(...bindings) as unknown as MemoryRow[]
    return rows.map(toMemory)
  }

  /**
   * Every memory of one clone, newest first.
   * @param cloneId - clone identity to list.
   * @param status - restrict to one status; absent lists every status.
   * @returns the stored records.
   */
  listMemories(cloneId: CloneId, status?: MemoryStatus): MemoryRecord[] {
    const rows = status === undefined
      ? this.db.prepare('SELECT * FROM memories WHERE clone_id = ? ORDER BY rowid DESC').all(cloneId)
      : this.db.prepare('SELECT * FROM memories WHERE clone_id = ? AND status = ? ORDER BY rowid DESC')
        .all(cloneId, status)
    return (rows as unknown as MemoryRow[]).map(toMemory)
  }

  /**
   * The newest active memories of one clone, newest first. This is the
   * snapshot the prompt context renders; deeper lookup is a search.
   * @param cloneId - clone identity to read.
   * @param limit - largest number of rows to return.
   * @returns the stored records.
   */
  recentActive(cloneId: CloneId, limit: number): MemoryRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM memories WHERE clone_id = ? AND status = 'active' ORDER BY rowid DESC LIMIT ?
    `).all(cloneId, limit) as unknown as MemoryRow[]
    return rows.map(toMemory)
  }

  /**
   * Replace the patch's fields on one memory and re-index the new text, in one
   * transaction.
   * @param id - memory identity.
   * @param patch - fields to replace; absent fields keep their stored value.
   * @returns the updated record.
   * @throws MemoryNotFoundError when the memory does not exist.
   * @throws MemoryInvalidError when the patch selects no field or a value exceeds its bound.
   */
  updateMemory(id: MemoryId, patch: MemoryUpdatePatch): MemoryRecord {
    if (patch.content === undefined && patch.tags === undefined && patch.status === undefined) {
      throw new MemoryInvalidError('patch must set at least one field')
    }
    const existing = this.requireMemory(id)
    const content = patch.content === undefined ? existing.content : requireContent(patch.content)
    const tags = patch.tags === undefined ? [...existing.tags] : normalizeTags(patch.tags)
    const status = patch.status === undefined ? existing.status : requireStatus(patch.status)
    inTransaction(this.db, () => {
      this.db.prepare('UPDATE memories SET content = ?, tags = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(content, JSON.stringify(tags), status, nowIso(), id)
      this.index(id, content, tags, existing.cloneId)
    })
    return this.requireMemory(id)
  }

  /**
   * Delete one memory and its index row, in one transaction.
   * @param id - memory identity.
   * @returns the removed identity.
   * @throws MemoryNotFoundError when the memory does not exist.
   */
  deleteMemory(id: MemoryId): MemoryId {
    this.requireMemory(id)
    inTransaction(this.db, () => {
      this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(id)
      this.db.prepare('DELETE FROM memories WHERE id = ?').run(id)
    })
    return id
  }

  /** One memory the caller requires, refusing an identity no row holds. */
  private requireMemory(id: MemoryId): MemoryRecord {
    const memory = this.getMemory(id)
    if (memory === undefined) throw new MemoryNotFoundError(id)
    return memory
  }

  /**
   * Replace the FTS5 row of one memory. The standalone index has no triggers,
   * so every table write calls this inside its own transaction; deleting the
   * old row first is what makes the replace idempotent for an update.
   */
  private index(id: MemoryId, content: string, tags: readonly string[], cloneId: CloneId): void {
    this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(id)
    this.db.prepare('INSERT INTO memories_fts (id, content, tags, clone_id) VALUES (?, ?, ?, ?)')
      .run(id, content, tags.join(' '), cloneId)
  }
}
