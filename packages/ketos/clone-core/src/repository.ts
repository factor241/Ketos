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
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { randomUUID } from 'node:crypto'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  CloneBindingRole, CloneCreateInput, CloneDraftFields, CloneId, CloneRecord, CloneSessionBinding,
  CloneStatus, CloneUpdatePatch,
} from './types.ts'

/**
 * A clone that the caller asked for and the database does not hold. Extending
 * {@link HarnessError} makes the code survive into a tool result as well as
 * into the route's answer.
 */
export class CloneNotFoundError extends HarnessError {
  /**
   * @param id - the clone identity that is absent.
   */
  constructor(id: string) {
    super(`clone ${id} does not exist`, 'ketos/clone-not-found')
  }
}

/**
 * A session that asked for clone data without a clone binding. Extending
 * {@link HarnessError} makes the interview tool's refusal carry this code into
 * the durable tool result.
 */
export class CloneSessionNotBoundError extends HarnessError {
  /**
   * @param sessionId - the unbound session identity.
   */
  constructor(sessionId: string) {
    super(`session ${sessionId} is not bound to a clone`, 'ketos/not-a-clone-session')
  }
}

/**
 * A session that tried to save a profile for a clone that is not interviewing,
 * for example after the person confirmed the profile the session was drafting.
 */
export class CloneNotInterviewingError extends HarnessError {
  /**
   * @param id - the clone identity whose status moved.
   * @param status - the status that made the save inapplicable.
   */
  constructor(id: string, status: CloneStatus) {
    super(`clone ${id} is ${status}, not interviewing`, 'ketos/clone-not-interviewing')
  }
}

/** A clone whose stored revision differs from the caller's expected revision. */
export class CloneConflictError extends HarnessError {
  /**
   * @param id - the clone identity that moved.
   * @param expected - the revision the caller held.
   * @param actual - the revision stored.
   */
  constructor(id: string, expected: number, actual: number) {
    super(`clone ${id} is at revision ${String(actual)}, not ${String(expected)}`, 'ketos/clone-conflict')
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
export const CLONE_STATUSES = ['draft', 'interviewing', 'ready'] as const satisfies readonly CloneStatus[]

/** The only binding roles the stored `role` column decodes to and the wire accepts. */
export const CLONE_BINDING_ROLES = ['main', 'interview'] as const satisfies readonly CloneBindingRole[]

/**
 * Longest authored value each profile field accepts, and the only source of
 * these numbers: the route validates them on the wire and the interview tool
 * validates them before its write, because a tool schema can express neither
 * `maxLength` nor `maxItems`.
 */
export const CLONE_TEXT_LIMITS = {
  role: 120,
  description: 500,
  persona: 20_000,
  methodology: 20_000,
  skillCount: 100,
  skill: 200,
} as const

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

/**
 * Refuse a draft whose required fields are empty or whose values exceed the
 * columns' documented bounds. The live route validates the same numbers; this
 * guard is for the model-facing tool, whose JSON schema cannot carry
 * `minLength`, `maxLength`, or `maxItems`. A profile the person is asked to
 * confirm must carry its four authored lines.
 * @param fields - the complete authored profile.
 */
function requireDraftBounds(fields: CloneDraftFields): void {
  const bounded: ReadonlyArray<readonly [string, string, number]> = [
    ['role', fields.role, CLONE_TEXT_LIMITS.role],
    ['description', fields.description, CLONE_TEXT_LIMITS.description],
    ['persona', fields.persona, CLONE_TEXT_LIMITS.persona],
    ['methodology', fields.methodology, CLONE_TEXT_LIMITS.methodology],
  ]
  for (const [name, value, max] of bounded) {
    if (value.trim() === '') throw new HarnessError(`${name} must not be empty`, 'ketos/invalid-draft')
    if (value.length > max) throw new HarnessError(`${name} exceeds ${String(max)} characters`, 'ketos/invalid-draft')
  }
  if (fields.skills.length > CLONE_TEXT_LIMITS.skillCount) {
    throw new HarnessError(`skills exceeds ${String(CLONE_TEXT_LIMITS.skillCount)} entries`, 'ketos/invalid-draft')
  }
  for (const skill of fields.skills) {
    if (skill.length > CLONE_TEXT_LIMITS.skill) {
      throw new HarnessError(`a skill name exceeds ${String(CLONE_TEXT_LIMITS.skill)} characters`, 'ketos/invalid-draft')
    }
  }
}

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

/** Decode the stored binding role. */
function parseBindingRole(sessionId: string, value: string): CloneBindingRole {
  if (!(CLONE_BINDING_ROLES as readonly string[]).includes(value)) {
    throw new Error(`clone session ${sessionId}: unknown role ${JSON.stringify(value)}`)
  }
  return value as CloneBindingRole
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
    role: parseBindingRole(row.session_id, row.role),
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
    if (patch.skills !== undefined) {
      assignments.push('skills_json = ?')
      values.push(JSON.stringify(patch.skills))
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
  bindSession(input: { cloneId: CloneId; sessionId: SessionId; role?: CloneBindingRole }): CloneSessionBinding {
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

  /**
   * The clone one session works for.
   * @param sessionId - session identity to look up.
   * @returns the stored binding, or undefined when the session has no clone.
   */
  bindingFor(sessionId: SessionId): CloneSessionBinding | undefined {
    const row = this.db.prepare(
      'SELECT * FROM clone_sessions WHERE session_id = ?',
    ).get(sessionId) as unknown as CloneSessionRow | undefined
    return row === undefined ? undefined : toBinding(row)
  }

  /**
   * Replace the authored profile of the clone bound to one session and mark the
   * clone `ready`, in one revision-checked update. The expected revision is the
   * one read in this call, so a user save that landed earlier is already part of
   * the new record, and the write still refuses a clone another writer moved
   * between the read and the update.
   * @param sessionId - the interviewing session whose clone receives the profile.
   * @param fields - the complete authored profile the interview collected.
   * @returns the saved record.
   * @throws CloneSessionNotBoundError when the session has no clone binding.
   * @throws CloneNotFoundError when the bound clone does not exist.
   * @throws CloneConflictError when the stored revision moved during the call.
   */
  saveDraft(sessionId: SessionId, fields: CloneDraftFields): CloneRecord {
    const binding = this.bindingFor(sessionId)
    if (binding === undefined || binding.role !== 'interview') throw new CloneSessionNotBoundError(sessionId)
    requireDraftBounds(fields)
    const clone = this.getClone(binding.cloneId)
    if (clone === undefined) throw new CloneNotFoundError(binding.cloneId)
    // The mode is enforced where the write happens, not only by the interview
    // scope's lifetime: a profile the person confirmed meanwhile must not be
    // overwritten by the agent that was drafting it.
    if (clone.status !== 'interviewing') throw new CloneNotInterviewingError(binding.cloneId, clone.status)
    return this.updateClone(binding.cloneId, { ...fields, status: 'ready' }, clone.revision)
  }
}
