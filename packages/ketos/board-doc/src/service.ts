/**
 * The `ctx.ketosBoardDoc` service: the one point other Ketos packages read and
 * write the board document through. It opens the database, the document, and
 * the journal on the first call, applies operation batches atomically, and
 * reports one change per committed journal row to its subscribers.
 * @module @ketos/board-doc/service
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import {
  PARTICIPANT_COLOR_MAX, PARTICIPANT_COLOR_MIN, PARTICIPANT_NAME_MAX,
} from './data.ts'
import { BoardDatabase, ensureIdentity, type BoardIdentity } from './db.ts'
import { BoardDocument } from './doc.ts'
import { BoardJournal } from './journal.ts'
import { applyBoardOps, type BoardOpLimits } from './ops.ts'
import type {
  BoardDocId, BoardOp, BoardOpsResponse, BoardOrigin, BoardParticipantRecord, BoardPatch,
  BoardSnapshot, OwnerId,
} from './types.ts'

/** One committed document change, as a subscriber receives it. */
export type BoardChange = BoardPatch

/** Deployment inputs the service needs beside the database path. */
export interface KetosBoardDocOptions {
  /** Database file path, or `:memory:`. */
  readonly path: string
  /** Operation and element limits. */
  readonly limits: BoardOpLimits
  /** Journal rows after which the store compacts to one update row. */
  readonly journalCompactRows: number
  /** Receives one line per element the document cannot decode. */
  readonly logger: (message: string) => void
}

/** The open database, identity, document, and journal of one service. */
interface OpenDocument {
  readonly identity: BoardIdentity
  readonly document: BoardDocument
  readonly journal: BoardJournal
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    ketosBoardDoc: KetosBoardDocService
  }
}

/**
 * Board document service. Every method opens the database, the document, and
 * the journal on first use; the owning plugin closes them through
 * {@link KetosBoardDocService.close}, and a call after that close fails
 * instead of reopening the file.
 */
export class KetosBoardDocService extends Service {
  private readonly options: KetosBoardDocOptions
  private readonly database: BoardDatabase
  private readonly listeners = new Set<(change: BoardChange) => void>()
  private opening: Promise<OpenDocument> | undefined
  private closing: Promise<void> | undefined
  private disposed = false

  /**
   * @param ctx - context the service registers `ketosBoardDoc` in.
   * @param options - database path, limits, journal budget, and log sink.
   */
  constructor(ctx: Context, options: KetosBoardDocOptions) {
    super(ctx, 'ketosBoardDoc')
    this.options = options
    this.database = new BoardDatabase(options.path)
  }

  /**
   * Identity of this Ketos, kept outside the synchronized document.
   * @returns the local owner id.
   */
  async selfId(): Promise<OwnerId> {
    return (await this.open()).identity.selfId
  }

  /**
   * Identity of the document.
   * @returns the document id.
   */
  async docId(): Promise<BoardDocId> {
    return (await this.open()).identity.docId
  }

  /**
   * Full document state at the current revision.
   * @returns the snapshot the browser reads first.
   */
  async snapshot(): Promise<BoardSnapshot> {
    const open = await this.open()
    return {
      docId: open.identity.docId,
      selfId: open.identity.selfId,
      revision: open.journal.revision(),
      elements: open.document.readAll(),
      participants: open.document.readParticipants(),
      limits: this.options.limits.elements,
    }
  }

  /**
   * Every stored participant record of the document.
   * @returns the readable participant records.
   */
  async participants(): Promise<readonly BoardParticipantRecord[]> {
    return (await this.open()).document.readParticipants()
  }

  /**
   * Write the local Ketos's own participant record and announce it. The write
   * touches only the record keyed by this Ketos's `selfId`, which is what
   * keeps two Ketos instances from overwriting each other's name and color.
   * @param participant - the name and palette color to publish.
   * @returns a promise settling after the journal row commits.
   */
  async putOwnParticipant(participant: { name: string; color: number }): Promise<void> {
    const { name, color } = participant
    if (name.length === 0 || name.length > PARTICIPANT_NAME_MAX) {
      throw new Error(`participant name must be 1–${String(PARTICIPANT_NAME_MAX)} characters`)
    }
    if (!Number.isInteger(color) || color < PARTICIPANT_COLOR_MIN || color > PARTICIPANT_COLOR_MAX) {
      throw new Error(`participant color must be an integer from ${String(PARTICIPANT_COLOR_MIN)} to ${String(PARTICIPANT_COLOR_MAX)}`)
    }
    const open = await this.open()
    const record: BoardParticipantRecord = {
      id: open.identity.selfId,
      name,
      color,
      updatedAt: Date.now(),
    }
    open.document.transact('host', () => { open.document.writeParticipant(record.id, record) })
    this.emit({
      revision: open.journal.revision(),
      upserts: [],
      removes: [],
      participants: { upserts: [record], removes: [] },
    })
  }

  /**
   * Apply one operation batch atomically. A `browser` batch may only create
   * elements under `selfId` and patch or remove elements it owns; a `host`
   * batch bypasses that check. Subscribers hear the change after the journal
   * row is committed.
   * @param ops - parsed operations.
   * @param origin - who sent the batch.
   * @returns the revision the batch committed at.
   */
  async apply(ops: readonly BoardOp[], origin: BoardOrigin): Promise<BoardOpsResponse> {
    const open = await this.open()
    const result = applyBoardOps(
      open.document,
      ops,
      origin,
      open.identity.selfId,
      this.options.limits,
      Date.now(),
    )
    const revision = open.journal.revision()
    if (result.upserts.length > 0 || result.removes.length > 0) {
      this.emit({ revision, upserts: result.upserts, removes: result.removes })
    }
    return { revision }
  }

  /**
   * Follow committed changes. The caller owns the returned unsubscribe through
   * `ctx.effect`.
   * @param listener - receives one change per committed batch.
   * @returns the unsubscribe function.
   */
  subscribe(listener: (change: BoardChange) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Close the journal and the database. Safe before the first call and safe to
   * call more than once; a call after it fails.
   * @returns a promise settling when every resource is closed.
   */
  close(): Promise<void> {
    this.closing ??= this.dispose()
    return this.closing
  }

  private async open(): Promise<OpenDocument> {
    if (this.disposed) return Promise.reject(new Error('ketos board document: already closed'))
    this.opening ??= this.openDocument().catch((error: unknown) => {
      // A failed open is not cached: a transient lock, permission, or
      // vanished-file failure would otherwise fail every later call until the
      // process restarts. Concurrent callers still share one attempt.
      this.opening = undefined
      throw error
    })
    return this.opening
  }

  private async openDocument(): Promise<OpenDocument> {
    const db = await this.database.handle()
    const identity = ensureIdentity(db)
    const y = await import('yjs')
    const document = BoardDocument.open(y, this.options.logger)
    const journal = new BoardJournal(db, document.ydoc, this.options.journalCompactRows)
    await journal.load()
    return { identity, document, journal }
  }

  private emit(change: BoardChange): void {
    for (const listener of [...this.listeners]) listener(change)
  }

  private async dispose(): Promise<void> {
    const opening = this.opening
    this.disposed = true
    this.opening = undefined
    this.listeners.clear()
    if (opening !== undefined) {
      try {
        (await opening).journal.close()
      } catch {
        // The failed open already closed its own handle and was reported to
        // the caller that requested it; disposal has nothing left to free.
      }
    }
    await this.database.close()
  }
}
