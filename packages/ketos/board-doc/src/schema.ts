/**
 * `board.db` schema: the identity and version stamps that keep a foreign
 * database from being adopted, the ordered forward-only migration steps, and
 * the runner that brings an existing file up to the current version.
 *
 * The document is stored as an append-only journal: each row holds one Yjs
 * update, and the row's `seq` is the revision the browser reads. The runner
 * never drops data and an unknown (newer) version is refused instead of
 * downgraded.
 * @module @ketos/board-doc/schema
 */

import type { DatabaseSync } from 'node:sqlite'

/** Schema version this build produces; stored in `PRAGMA user_version`. */
export const BOARD_DOC_SCHEMA_VERSION = 1

/** `application_id` marking a database as this package's own ("KTBD"). */
export const BOARD_DOC_APPLICATION_ID = 0x4b544244

/** One forward migration step; its index in the step list plus one is the version it produces. */
export type MigrationStep = (db: DatabaseSync) => void

/**
 * Version 1: the update journal and the local identity table. `updates` is
 * append-only and its autoincrementing `seq` is the document revision; `meta`
 * holds the local `selfId` and `docId`, which stay outside the synchronized
 * document.
 */
const stepV1: MigrationStep = (db) => {
  db.exec(`
    CREATE TABLE updates (
      seq      INTEGER PRIMARY KEY AUTOINCREMENT,
      "update" BLOB NOT NULL,
      origin   TEXT NOT NULL,
      at       TEXT NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT
  `)
}

/** Ordered forward-only steps; entry `n - 1` produces version `n`. */
export const BOARD_DOC_MIGRATION_STEPS: readonly MigrationStep[] = [stepV1]

/* jscpd:ignore-start -- deliberately mirrors the clone-core migration runner.
   Each package owns a distinct database identity, schema, and version policy,
   so a shared medium helper would couple independently released packages. */
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
    throw new Error(`board database: ${String(currentVersion)} schema versions need ${String(steps.length)} migration steps`)
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    // Read the version under the write lock: a concurrent opener that committed
    // between this call's entry and the transaction must not be re-migrated.
    const { user_version: onDisk } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    for (let version = onDisk; version < currentVersion; version++) {
      const step = steps[version]
      if (step === undefined) throw new Error(`board database: no migration step for version ${String(version + 1)}`)
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
 * Adopt an open database as `board.db`: refuse a file stamped for another
 * application or written by a newer build, apply every missing migration step,
 * and stamp the adopted file with this build's identity. The identity stamp is
 * written only after the migrations committed, so a step that fails on a
 * foreign file leaves the file unlabelled instead of mislabelled.
 * @param db - open database handle.
 */
export function migrate(db: DatabaseSync): void {
  const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
  const { user_version: onDisk } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (applicationId !== 0 && applicationId !== BOARD_DOC_APPLICATION_ID) {
    throw new Error(`board database: application id ${String(applicationId)} belongs to another application`)
  }
  if (onDisk > BOARD_DOC_SCHEMA_VERSION) {
    throw new Error(`board database: schema version ${String(onDisk)} is newer than this build (${String(BOARD_DOC_SCHEMA_VERSION)})`)
  }
  runMigrations(db, BOARD_DOC_MIGRATION_STEPS, BOARD_DOC_SCHEMA_VERSION)
  if (applicationId === 0) db.exec(`PRAGMA application_id = ${String(BOARD_DOC_APPLICATION_ID)}`)
}
/* jscpd:ignore-end */
