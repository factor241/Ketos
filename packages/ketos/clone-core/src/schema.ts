/**
 * `clones.db` schema: the identity and version stamps that keep a foreign
 * database from being adopted, the ordered forward-only migration steps, and
 * the runner that brings an existing file up to the current version.
 *
 * The runner never drops data: a step adds what its version needs or rewrites
 * one column's value into the shape that version stores, and an unknown
 * (newer) version is refused instead of downgraded.
 * @module @ketos/clone-core/schema
 */

import type { DatabaseSync } from 'node:sqlite'

/** Schema version this build produces; stored in `PRAGMA user_version`. */
export const CLONE_CORE_SCHEMA_VERSION = 5

/** `application_id` marking a database as this package's own ("KTCL"). */
export const CLONE_CORE_APPLICATION_ID = 0x4b54434c

/** One forward migration step; its index in the step list plus one is the version it produces. */
export type MigrationStep = (db: DatabaseSync) => void

/** Version 1: the clone records and their session bindings. */
const stepV1: MigrationStep = (db) => {
  db.exec(`
    CREATE TABLE clones (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      role            TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      persona         TEXT NOT NULL DEFAULT '',
      methodology     TEXT NOT NULL DEFAULT '',
      preferred_model TEXT,
      skills_json     TEXT NOT NULL DEFAULT '[]',
      status          TEXT NOT NULL DEFAULT 'draft',
      revision        INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE clone_sessions (
      session_id TEXT PRIMARY KEY,
      clone_id   TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'main',
      created_at TEXT NOT NULL
    ) STRICT
  `)
  db.exec('CREATE INDEX clone_sessions_clone_id ON clone_sessions (clone_id)')
}

/**
 * Version 2: the lifecycle narrowed to `draft` → `interviewing` → `ready`, the
 * statuses the interview stage owns. Records written under the earlier
 * speculative pair keep their authored fields: an in-use record is a confirmed
 * profile (`ready`), an archived one returns to `draft` and can be interviewed.
 */
const stepV2: MigrationStep = (db) => {
  db.exec("UPDATE clones SET status = 'ready' WHERE status = 'active'")
  db.exec("UPDATE clones SET status = 'draft' WHERE status = 'archived'")
}

/**
 * Version 3: the clone memory. `memories_fts` is a standalone FTS5 index —
 * no external content and no triggers — so the repository keeps the index in
 * step with the table inside the same transaction as every write, and the
 * index holds no state a hand-edited row could desynchronize silently.
 */
const stepV3: MigrationStep = (db) => {
  db.exec(`
    CREATE TABLE memories (
      id                TEXT PRIMARY KEY,
      clone_id          TEXT NOT NULL,
      content           TEXT NOT NULL,
      tags              TEXT NOT NULL DEFAULT '[]',
      source_session_id TEXT,
      status            TEXT NOT NULL DEFAULT 'active',
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    ) STRICT
  `)
  db.exec('CREATE INDEX memories_clone_status ON memories (clone_id, status)')
  db.exec(`
    CREATE VIRTUAL TABLE memories_fts USING fts5(
      id UNINDEXED,
      content,
      tags,
      clone_id UNINDEXED,
      tokenize = 'unicode61'
    )
  `)
}

/**
 * Version 4: a stored skill carries a description and instructions beside its
 * name. A legacy row holds a JSON array of names; each name becomes
 * `{ name, description: '', instructions: '' }` in place, which preserves the
 * order the person wrote and leaves the skill an unauthored draft until the
 * editor fills it. A row already holding skill objects is left untouched, so
 * the step never rewrites the new shape.
 */
const stepV4: MigrationStep = (db) => {
  const rows = db.prepare('SELECT id, skills_json FROM clones').all() as unknown as
    readonly { id: string; skills_json: string }[]
  const rewrite = db.prepare('UPDATE clones SET skills_json = ? WHERE id = ?')
  for (const row of rows) {
    let value: unknown
    try {
      value = JSON.parse(row.skills_json)
    } catch {
      // Not JSON at all; the repository's decode guard reports it on the first
      // read instead of failing the whole database open.
      continue
    }
    if (!Array.isArray(value) || !value.every(entry => typeof entry === 'string')) continue
    const skills = (value as readonly string[]).map(name => ({ name, description: '', instructions: '' }))
    rewrite.run(JSON.stringify(skills), row.id)
  }
}

/**
 * Version 5: the autonomous tasks of a clone. A task names the clone it works
 * for, the objective the clone's goal pursues, the round budget that goal may
 * use, and the session that runs it once started; the status column carries
 * the lifecycle the window shows and the report or failure reason the run left
 * behind.
 */
const stepV5: MigrationStep = (db) => {
  db.exec(`
    CREATE TABLE clone_tasks (
      id             TEXT PRIMARY KEY,
      clone_id       TEXT NOT NULL,
      session_id     TEXT,
      objective      TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'pending',
      result_summary TEXT,
      max_rounds     INTEGER NOT NULL,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    ) STRICT
  `)
  db.exec('CREATE INDEX clone_tasks_clone_id ON clone_tasks (clone_id)')
  db.exec('CREATE INDEX clone_tasks_session_id ON clone_tasks (session_id)')
}

/** Ordered forward-only steps; entry `n - 1` produces version `n`. */
export const CLONE_CORE_MIGRATION_STEPS: readonly MigrationStep[] = [stepV1, stepV2, stepV3, stepV4, stepV5]

/**
 * Apply every step between the database's stamped version and `currentVersion`,
 * in order and in one pass, then stamp `currentVersion`. The steps and the
 * stamp commit as one transaction, so a crash or a failing step leaves the file
 * at its previous version with no half-applied DDL to replay.
 * @param db - open database handle.
 * @param steps - ordered steps, one per version.
 * @param currentVersion - version this build produces.
 */
export function runMigrations(
  db: DatabaseSync,
  steps: readonly MigrationStep[],
  currentVersion: number,
): void {
  if (steps.length < currentVersion) {
    throw new Error(`clone database: ${String(currentVersion)} schema versions need ${String(steps.length)} migration steps`)
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    // Read the version under the write lock: a concurrent opener that committed
    // between this call's entry and the transaction must not be re-migrated.
    const { user_version: onDisk } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    for (let version = onDisk; version < currentVersion; version++) {
      const step = steps[version]
      if (step === undefined) throw new Error(`clone database: no migration step for version ${String(version + 1)}`)
      step(db)
    }
    if (onDisk !== currentVersion) db.exec(`PRAGMA user_version = ${String(currentVersion)}`)
    db.exec('COMMIT')
  } catch (error: unknown) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // A failing statement may already have ended the transaction; the error
      // that brought us here is the one worth reporting.
    }
    throw error
  }
}

/**
 * Adopt an open database as `clones.db`: refuse a file stamped for another
 * application or written by a newer build, apply every missing migration step,
 * and stamp the adopted file with this build's identity. The identity stamp is
 * written only after the migrations committed, so a step that fails on a
 * foreign file leaves the file unlabelled instead of mislabelled.
 * @param db - open database handle.
 */
export function migrate(db: DatabaseSync): void {
  const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
  const { user_version: onDisk } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (applicationId !== 0 && applicationId !== CLONE_CORE_APPLICATION_ID) {
    throw new Error(`clone database: application id ${String(applicationId)} belongs to another application`)
  }
  if (onDisk > CLONE_CORE_SCHEMA_VERSION) {
    throw new Error(`clone database: schema version ${String(onDisk)} is newer than this build (${String(CLONE_CORE_SCHEMA_VERSION)})`)
  }
  runMigrations(db, CLONE_CORE_MIGRATION_STEPS, CLONE_CORE_SCHEMA_VERSION)
  if (applicationId === 0) db.exec(`PRAGMA application_id = ${String(CLONE_CORE_APPLICATION_ID)}`)
}
