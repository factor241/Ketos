/**
 * Prepared-statement repository over the clone tables: records with
 * revision-checked (CAS) updates, and the session bindings that tie a Harness
 * session to the clone it works for.
 *
 * Every read validates the durable value it decodes, so a hand-edited database
 * fails loud instead of surfacing a broken clone in the UI.
 * @module @ketos/clone-core/repository
 */

import type { DatabaseSync } from 'node:sqlite'
import { brandString } from '@deepseek-ai/dsh-brand'
import { randomUUID } from 'node:crypto'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  CloneCreateInput, CloneId, CloneRecord, CloneSessionBinding, CloneStatus, CloneUpdatePatch,
} from './types.ts'

/** A clone that the caller asked for and the database does not hold. */
export class CloneNotFoundError extends Error {
  /** Stable wire code the route reports. */
  readonly code = 'ketos/clone-not-found'

  /**
   * @param id - the clone identity that is absent.
   */
  constructor(id: string) {
    super(`clone ${id} does not exist`)
    this.name = 'CloneNotFoundError'
  }
}

/** A clone whose stored revision differs from the caller's expected revision. */
export class CloneConflictError extends Error {
  /** Stable wire code the route reports. */
  readonly code = 'ketos/clone-conflict'

  /**
   * @param id - the clone identity that moved.
   * @param expected - the revision the caller held.
   * @param actual - the revision stored.
   */
  constructor(id: string, expected: number, actual: number) {
    super(`clone ${id} is at revision ${String(actual)}, not ${String(expected)}`)
    this.name = 'CloneConflictError'
  }
}

/** One `clones` row as SQLite returns it. */
interface CloneRow {
  id: string
  name: string
  role: string
  description: string
  persona: string
  methodology: string
  preferred_model: string | null
  skills_json: string
  status: string
  revision: number
  created_at: string
  updated_at: string
}

/** One `clone_sessions` row as SQLite returns it. */
interface CloneSessionRow {
  session_id: string
  clone_id: string
  role: string
  created_at: string
}

/** The only statuses the stored `status` column decodes to and the wire accepts. */
export const CLONE_STATUSES = ['draft', 'active', 'archived'] as const satisfies readonly CloneStatus[]

/** Update-patch field to stored column, in the order the statements bind them. */
const PATCH_COLUMNS = [
  ['name', 'name'],
  ['role', 'role'],
  ['description', 'description'],
  ['persona', 'persona'],
  ['methodology', 'methodology'],
  ['preferredModel', 'preferred_model'],
  ['status', 'status'],
] as const satisfies readonly (readonly [keyof CloneUpdatePatch, string])[]

/** Current time as the ISO-8601 UTC string every timestamp column stores. */
function nowIso(): string {
  return new Date().toISOString()
}

/** Decode the stored skills document, refusing anything but an array of strings. */
function parseSkills(id: string, json: string): string[] {
  const value: unknown = JSON.parse(json)
  if (!Array.isArray(value)) throw new Error(`clone ${id}: skills_json is not an array of strings`)
  const skills: string[] = []
  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== 'string') throw new Error(`clone ${id}: skills_json is not an array of strings`)
    skills.push(entry)
  }
  return skills
}

/** Decode the stored lifecycle status. */
function parseStatus(id: string, value: string): CloneStatus {
  if (!(CLONE_STATUSES as readonly string[]).includes(value)) {
    throw new Error(`clone ${id}: unknown status ${JSON.stringify(value)}`)
  }
  return value as CloneStatus
}

/** Decode one stored clone row. */
function toRecord(row: CloneRow): CloneRecord {
  return {
    id: brandString<CloneId>(row.id),
    name: row.name,
    role: row.role,
    description: row.description,
    persona: row.persona,
    methodology: row.methodology,
    preferredModel: row.preferred_model,
    skills: parseSkills(row.id, row.skills_json),
    status: parseStatus(row.id, row.status),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Decode one stored session-binding row. */
function toBinding(row: CloneSessionRow): CloneSessionBinding {
  return {
    sessionId: brandString<SessionId>(row.session_id),
    cloneId: brandString<CloneId>(row.clone_id),
    role: row.role,
    createdAt: row.created_at,
  }
}

/** Create, read, update, and delete clone records and their session bindings. */
export class CloneRepository {
  private readonly db: DatabaseSync

  /**
   * @param db - open clone database.
   */
  constructor(db: DatabaseSync) {
    this.db = db
  }

  /**
   * Every clone, newest first. Insertion order is the sort key rather than a
   * timestamp, so the list is stable inside one clock tick.
   * @returns the stored records.
   */
  listClones(): CloneRecord[] {
    const rows = this.db.prepare('SELECT * FROM clones ORDER BY rowid DESC').all() as unknown as CloneRow[]
    return rows.map(toRecord)
  }

  /**
   * One clone by identity.
   * @param id - clone identity.
   * @returns the stored record, or undefined when no row holds the identity.
   */
  getClone(id: CloneId): CloneRecord | undefined {
    const row = this.db.prepare('SELECT * FROM clones WHERE id = ?').get(id) as unknown as CloneRow | undefined
    return row === undefined ? undefined : toRecord(row)
  }

  /**
   * Insert one clone at revision 1 with a freshly minted identity.
   * @param input - required name and role plus optional authored fields.
   * @returns the stored record.
   */
  createClone(input: CloneCreateInput): CloneRecord {
    const id = brandString<CloneId>(randomUUID())
    const now = nowIso()
    this.db.prepare(`
      INSERT INTO clones
        (id, name, role, description, persona, methodology, preferred_model, skills_json, status, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      id,
      input.name,
      input.role,
      input.description ?? '',
      input.persona ?? '',
      input.methodology ?? '',
      input.preferredModel ?? null,
      JSON.stringify(input.skills ?? []),
      input.status ?? 'draft',
      now,
      now,
    )
    const created = this.getClone(id)
    if (created === undefined) throw new Error('clone create: the inserted row is missing')
    return created
  }

  /**
   * Replace the patch's fields on one clone, bumping the revision. The update
   * applies only while the stored revision still equals `expectedRevision`;
   * a mismatch refuses rather than overwriting a concurrent edit.
   * @param id - clone identity.
   * @param patch - fields to replace; absent fields keep their stored value.
   * @param expectedRevision - revision the caller read.
   * @returns the updated record.
   * @throws CloneNotFoundError when the clone does not exist.
   * @throws CloneConflictError when the stored revision differs.
   */
  updateClone(id: CloneId, patch: CloneUpdatePatch, expectedRevision: number): CloneRecord {
    const assignments: string[] = []
    const values: (string | null)[] = []
    for (const [field, column] of PATCH_COLUMNS) {
      const value = patch[field]
      if (value === undefined) continue
      assignments.push(`${column} = ?`)
      values.push(value)
    }
    if (assignments.length === 0) throw new Error('clone update: the patch selects no field')
    const result = this.db.prepare(`
      UPDATE clones SET ${assignments.join(', ')}, revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ?
    `).run(...values, nowIso(), id, expectedRevision)
    if (result.changes === 0) {
      const existing = this.getClone(id)
      if (existing === undefined) throw new CloneNotFoundError(id)
      throw new CloneConflictError(id, expectedRevision, existing.revision)
    }
    const updated = this.getClone(id)
    if (updated === undefined) throw new Error('clone update: the updated row is missing')
    return updated
  }

  /**
   * Delete one clone and its session bindings. The delete applies only while
   * the stored revision still equals `expectedRevision`; the revision guard is
   * part of the deleting statement, inside the transaction, so no writer can
   * slip a newer revision between the check and the delete.
   * @param id - clone identity.
   * @param expectedRevision - revision the caller read.
   * @returns the removed identity.
   * @throws CloneNotFoundError when the clone does not exist.
   * @throws CloneConflictError when the stored revision differs.
   */
  deleteClone(id: CloneId, expectedRevision: number): CloneId {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = this.db.prepare('DELETE FROM clones WHERE id = ? AND revision = ?').run(id, expectedRevision)
      if (result.changes === 0) {
        // Reading inside the transaction keeps the classification of an
        // unchanged revision exact.
        const existing = this.getClone(id)
        if (existing === undefined) throw new CloneNotFoundError(id)
        throw new CloneConflictError(id, expectedRevision, existing.revision)
      }
      this.db.prepare('DELETE FROM clone_sessions WHERE clone_id = ?').run(id)
      this.db.exec('COMMIT')
    } catch (error: unknown) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // A failing statement may already have ended the transaction; the
        // error that brought us here is the one worth reporting.
      }
      throw error
    }
    return id
  }

  /**
   * Bind one session to one clone, replacing any earlier binding of that
   * session: a session has at most one clone.
   * @param input - clone identity, session identity, and binding role.
   * @returns the stored binding.
   * @throws CloneNotFoundError when the clone does not exist.
   */
  bindSession(input: { cloneId: CloneId; sessionId: SessionId; role?: string }): CloneSessionBinding {
    const clone = this.getClone(input.cloneId)
    if (clone === undefined) throw new CloneNotFoundError(input.cloneId)
    const role = input.role ?? 'main'
    const createdAt = nowIso()
    this.db.prepare(`
      INSERT INTO clone_sessions (session_id, clone_id, role, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (session_id) DO UPDATE SET
        clone_id = excluded.clone_id, role = excluded.role, created_at = excluded.created_at
    `).run(input.sessionId, input.cloneId, role, createdAt)
    return { sessionId: input.sessionId, cloneId: input.cloneId, role, createdAt }
  }

  /**
   * Session bindings of one clone, newest first by binding order. A clone with
   * no bindings and an identity no clone holds both answer an empty list.
   * @param cloneId - clone identity to filter by.
   * @returns the stored bindings.
   */
  listSessions(cloneId: CloneId): CloneSessionBinding[] {
    const rows = this.db.prepare(
      'SELECT * FROM clone_sessions WHERE clone_id = ? ORDER BY rowid DESC',
    ).all(cloneId) as unknown as CloneSessionRow[]
    return rows.map(toBinding)
  }
}
