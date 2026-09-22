/**
 * The immediate-transaction wrapper the store's multi-statement writes share.
 * `BEGIN IMMEDIATE` takes the write lock up front, so a write that must stay
 * all-or-nothing never fails halfway on a competing writer.
 * @module @ketos/clone-core/transaction
 */

import type { DatabaseSync } from 'node:sqlite'

/**
 * Run a synchronous body inside one transaction: commit the value it returns,
 * roll back on a throw.
 * @param db - open database handle.
 * @param body - statements to run inside the transaction.
 * @returns whatever `body` returned.
 */
export function inTransaction<T>(db: DatabaseSync, body: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const value = body()
    db.exec('COMMIT')
    return value
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
