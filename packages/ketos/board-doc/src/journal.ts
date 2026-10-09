/**
 * The `board.db` update journal: loading the stored Yjs updates into the
 * document, appending one row per committed update, compacting the journal
 * when it grows past its budget, and reporting the revision that row carries.
 *
 * The revision is the row's autoincrementing `seq`, so it is monotone across
 * restarts and compactions; a compaction inserts the document's full state as
 * one new row and deletes every earlier row, which never decreases the
 * revision.
 * @module @ketos/board-doc/journal
 */

import type { DatabaseSync } from 'node:sqlite'
import { brandNumber } from '@deepseek-ai/dsh-brand'
import type * as Y from 'yjs'
import type { BoardRevision } from './types.ts'

/** Origin of the updates a load applies; the journal never stores one. */
export const LOAD_ORIGIN = 'load'

/** Origin of the single row a compaction writes. */
export const COMPACT_ORIGIN = 'compact'

/** Origin of an update applied from another Ketos over the peer channel. */
export const PEER_ORIGIN = 'peer'

/**
 * A document update that could not be appended to the journal. The update is
 * in the in-memory document but not in `board.db`, so the owner discards that
 * document and reloads the stored state.
 */
export class BoardJournalError extends Error {
  /**
   * @param reason - what the database reported.
   * @param cause - the database error.
   */
  constructor(reason: string, cause: unknown) {
    super(`board journal: cannot append the update: ${reason}`, { cause })
    this.name = 'BoardJournalError'
  }
}

/** The Yjs module surface the journal uses, loaded lazily on the first open. */
type YjsModule = typeof import('yjs')

/**
 * Append-only journal over one open database and one live document. The
 * constructor detaches nothing and writes nothing; {@link BoardJournal.load}
 * applies the stored updates, and every committed document update after that
 * appends one row before the caller's transaction returns.
 *
 * A failed append throws {@link BoardJournalError} out of the transaction and
 * sets {@link BoardJournal.broken}: Yjs 13.6.33 stops dispatching `update`
 * events of a document whose `update` listener threw, so the document no
 * longer reaches the journal and its owner must reopen it from the database.
 */
export class BoardJournal {
  private readonly db: DatabaseSync
  private readonly doc: Y.Doc
  private readonly compactRows: number
  private readonly logger: (message: string) => void
  private y!: YjsModule
  private rows = 0
  private brokenValue = false
  private revisionValue: BoardRevision = brandNumber<BoardRevision>(0)

  /**
   * @param db - open database handle carrying the `updates` table.
   * @param doc - the live document the journal keeps.
   * @param compactRows - row count that triggers a compaction.
   * @param logger - receives one line per failed compaction.
   */
  constructor(db: DatabaseSync, doc: Y.Doc, compactRows: number, logger: (message: string) => void) {
    this.db = db
    this.doc = doc
    this.compactRows = compactRows
    this.logger = logger
  }

  /**
   * Apply every stored update to the document, then follow the document for
   * later updates. The stored updates load with the `load` origin, which the
   * append listener ignores.
   * @returns the revision the loaded state carries.
   */
  async load(): Promise<BoardRevision> {
    const y = await import('yjs')
    this.y = y
    const rows = this.db.prepare('SELECT seq, "update" FROM updates ORDER BY seq').all()
    const updates = rows.map(row => new Uint8Array(row.update as Uint8Array))
    this.rows = rows.length
    this.revisionValue = brandNumber<BoardRevision>((rows.at(-1)?.seq as number | undefined) ?? 0)
    // The listener is attached before the stored updates apply, so an update
    // that reaches it with the `load` origin is ignored by construction.
    this.doc.on('update', this.onUpdate)
    if (updates.length > 0) y.applyUpdate(this.doc, y.mergeUpdates(updates), LOAD_ORIGIN)
    return this.revisionValue
  }

  /**
   * The current revision: the `seq` of the latest committed row, or 0 while
   * the journal is empty.
   * @returns the current revision.
   */
  revision(): BoardRevision {
    return this.revisionValue
  }

  /**
   * Whether an append failed. The document stops dispatching updates after
   * that failure, so a broken journal never recovers; the owner reopens the
   * document from the database.
   * @returns true after the first failed append.
   */
  get broken(): boolean {
    return this.brokenValue
  }

  /**
   * Stop following the document. The database handle stays owned by its owner;
   * the caller must not mutate the document after this call.
   */
  close(): void {
    this.doc.off('update', this.onUpdate)
  }

  /**
   * Append one update as a journal row, then compact when the journal passed
   * its budget. The document's `update` listener appends every committed
   * transaction this way; the owner also appends an update the event does not
   * carry in full, such as a remote update whose part Yjs keeps waiting for a
   * missing update. A stored update that the document already integrated
   * changes nothing when a load applies it again.
   * @param update - the encoded update.
   * @param origin - the origin recorded with the row.
   * @throws {BoardJournalError} when the row cannot be inserted; the journal is
   * {@link BoardJournal.broken} from then on.
   */
  append(update: Uint8Array, origin: string): void {
    try {
      const result = this.db
        .prepare('INSERT INTO updates ("update", origin, at) VALUES (?, ?, ?)')
        .run(update, origin, new Date().toISOString())
      this.revisionValue = brandNumber<BoardRevision>(Number(result.lastInsertRowid))
      this.rows += 1
    } catch (error: unknown) {
      this.brokenValue = true
      throw new BoardJournalError(String(error), error)
    }
    if (this.rows > this.compactRows) {
      try {
        this.compact()
      } catch (error: unknown) {
        // The appended row is committed and the failed compaction rolled back,
        // so the journal is whole; the next append retries the compaction.
        this.logger(`board journal compaction failed: ${String(error)}`)
      }
    }
  }

  private readonly onUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === LOAD_ORIGIN) return
    this.append(update, typeof origin === 'string' ? origin : 'local')
  }

  /**
   * Replace every row with one row holding the document's full state. The
   * insert and the delete commit as one transaction, so a crash leaves the
   * journal whole; the new row's `seq` is the revision from here on.
   */
  private compact(): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = this.db
        .prepare('INSERT INTO updates ("update", origin, at) VALUES (?, ?, ?)')
        .run(this.y.encodeStateAsUpdate(this.doc), COMPACT_ORIGIN, new Date().toISOString())
      const seq = Number(result.lastInsertRowid)
      this.db.prepare('DELETE FROM updates WHERE seq < ?').run(seq)
      this.db.exec('COMMIT')
      this.revisionValue = brandNumber<BoardRevision>(seq)
      this.rows = 1
    } catch (error: unknown) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // A failing statement may already have ended the transaction; the error
        // that brought us here is the one worth reporting.
      }
      throw error
    }
  }
}
