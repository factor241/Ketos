/**
 * `clones.db` schema: the identity and version stamps that keep a foreign
 * database from being adopted, the ordered forward-only migration steps, and
 * the runner that brings an existing file up to the current version.
 *
 * The runner never drops or rewrites data: each step only adds what its version
 * needs, and an unknown (newer) version is refused instead of downgraded.
 * @module @ketos/clone-core/schema
 */

import type { DatabaseSync } from 'node:sqlite'

/** Schema version this build produces; stored in `PRAGMA user_version`. */
export const CLONE_CORE_SCHEMA_VERSION = 1

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

/** Ordered forward-only steps; entry `n - 1` produces version `n`. */
export const CLONE_CORE_MIGRATION_STEPS: readonly MigrationStep[] = [stepV1]

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
  const { user_version: onDisk } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  db.exec('BEGIN IMMEDIATE')
  try {
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
 * application or written by a newer build, stamp a fresh file with this
 * build's identity, and apply every missing migration step.
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
  if (applicationId === 0) db.exec(`PRAGMA application_id = ${String(CLONE_CORE_APPLICATION_ID)}`)
  runMigrations(db, CLONE_CORE_MIGRATION_STEPS, CLONE_CORE_SCHEMA_VERSION)
}
