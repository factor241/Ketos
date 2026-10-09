/**
 * The `ctx.ketosBoardDoc` service: the one point other Ketos packages read and
 * write the board document through. It opens the database, the document, and
 * the journal on the first call, applies operation batches atomically, and
 * reports one change per committed journal row to its subscribers.
 * @module @ketos/board-doc/service
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  PARTICIPANT_COLOR_MAX, PARTICIPANT_COLOR_MIN, PARTICIPANT_NAME_MAX, isElementId,
} from './data.ts'
import { BoardDatabase, ensureIdentity, type BoardIdentity } from './db.ts'
import { BoardDocument, type BoardDocumentDelta } from './doc.ts'
import { BoardJournal, LOAD_ORIGIN, PEER_ORIGIN } from './journal.ts'
import { applyBoardOps, type BoardOpLimits } from './ops.ts'
import type {
  BoardDocId, BoardElement, BoardOp, BoardOpsResponse, BoardOrigin, BoardParticipantRecord, BoardPatch,
  BoardRemoteResult, BoardSnapshot, BoardWindowRecord, ElementId, OwnerId, WindowId,
} from './types.ts'
import { isWindowId } from './windows.ts'

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
  private readonly localUpdateListeners = new Set<(update: Uint8Array) => void>()
  private opening: Promise<OpenDocument> | undefined
  private opened: OpenDocument | undefined
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
  snapshot(): Promise<BoardSnapshot> {
    return this.read(open => ({
      docId: open.identity.docId,
      selfId: open.identity.selfId,
      revision: open.journal.revision(),
      elements: open.document.readAll(),
      participants: open.document.readParticipants(),
      windows: open.document.readWindows(),
      limits: this.options.limits.elements,
    }))
  }

  /**
   * Every stored participant record of the document.
   * @returns the readable participant records.
   */
  participants(): Promise<readonly BoardParticipantRecord[]> {
    return this.read(open => open.document.readParticipants())
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
    const { record, revision } = await this.guard((open) => {
      const written: BoardParticipantRecord = {
        id: open.identity.selfId,
        name,
        color,
        updatedAt: Date.now(),
      }
      open.document.transact('host', () => { open.document.writeParticipant(written.id, written) })
      return { record: written, revision: open.journal.revision() }
    })
    this.emit({
      revision,
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
    const { result, revision } = await this.guard((open) => {
      const applied = applyBoardOps(
        open.document,
        ops,
        origin,
        open.identity.selfId,
        this.options.limits,
        Date.now(),
      )
      return { result: applied, revision: open.journal.revision() }
    })
    if (result.upserts.length > 0 || result.removes.length > 0
      || result.windowUpserts.length > 0 || result.windowRemoves.length > 0) {
      this.emit({
        revision,
        upserts: result.upserts,
        removes: result.removes,
        ...(result.windowUpserts.length === 0 && result.windowRemoves.length === 0
          ? {}
          : { windows: { upserts: result.windowUpserts, removes: result.windowRemoves } }),
      })
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
   * Encode this document's state vector, the summary to send to another Ketos
   * at connection time.
   * @returns the encoded state vector.
   */
  stateVector(): Promise<Uint8Array> {
    return this.read(open => open.document.stateVector())
  }

  /**
   * Encode every update the other Ketos's state vector does not cover.
   * @param stateVector - the other Ketos's encoded state vector.
   * @returns the encoded diff update.
   */
  diffSince(stateVector: Uint8Array): Promise<Uint8Array> {
    return this.read(open => open.document.diffSince(stateVector))
  }

  /**
   * Apply one update that arrived from another Ketos. The bytes are validated
   * before the document changes, so an unreadable update refuses with
   * `BoardSyncError` and leaves the document untouched. A committed update
   * appends one journal row and then emits one patch to the subscribers, like
   * any other transaction, but never reaches {@link KetosBoardDocService.onLocalUpdate}.
   * While Yjs keeps part of the document waiting for an earlier update, the
   * received bytes are also appended whole as one more `peer` row: the
   * transaction's own row carries only the integrated part, and the stored
   * bytes let a restarted Ketos integrate the waiting part when the missing
   * update arrives.
   * @param update - one encoded update produced by another Ketos.
   * @returns whether part of the document still waits for an earlier update;
   * the peer channel then asks the sender for the missing range.
   */
  async applyRemote(update: Uint8Array): Promise<BoardRemoteResult> {
    const { change, pending } = await this.guard((open) => {
      const delta = open.document.applyRemote(update)
      const waiting = open.document.hasPendingUpdates()
      if (waiting) open.journal.append(update, PEER_ORIGIN)
      return { change: this.remoteChange(open, delta), pending: waiting }
    })
    if (change !== undefined) this.emit(change)
    return { pending }
  }

  /**
   * Follow transactions this Ketos produced, so the peer channel can relay
   * them. Updates applied by {@link KetosBoardDocService.applyRemote} (origin
   * `peer`) and the journal's stored-update replay (origin `load`) never reach
   * the listener; the journal row of a local transaction is already committed
   * when the listener runs. The caller owns the returned unsubscribe through
   * `ctx.effect`.
   * @param listener - receives one raw update per local transaction.
   * @returns the unsubscribe function.
   */
  onLocalUpdate(listener: (update: Uint8Array) => void): () => void {
    this.localUpdateListeners.add(listener)
    return () => {
      this.localUpdateListeners.delete(listener)
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

  /**
   * Run one synchronous read or mutation on a document whose journal holds
   * every change the document carries. Another caller can break the journal
   * while this call waits for the document; this call then discards that
   * document and waits for the reload, so no snapshot, diff, or mutation sees a
   * change that is missing from `board.db`.
   * @param run - the synchronous read or mutation, called with the open document.
   * @returns what `run` returned.
   */
  private async read<T>(run: (open: OpenDocument) => T): Promise<T> {
    for (;;) {
      const open = await this.open()
      if (!open.journal.broken) return run(open)
      this.discard(open)
    }
  }

  private async openDocument(): Promise<OpenDocument> {
    const db = await this.database.handle()
    const identity = ensureIdentity(db)
    const y = await import('yjs')
    const document = BoardDocument.open(y, this.options.logger)
    const journal = new BoardJournal(db, document.ydoc, this.options.journalCompactRows, this.options.logger)
    await journal.load()
    // The journal attached its own listener during the load, so a local
    // transaction already has its row when this dispatcher runs.
    document.ydoc.on('update', this.onDocumentUpdate)
    const open: OpenDocument = { identity, document, journal }
    this.opened = open
    return open
  }

  /**
   * Run one synchronous document mutation. When the mutation breaks the
   * journal, the document is dropped from the cache so the next call reloads
   * the stored state; the change that failed to reach `board.db` is then gone
   * from memory too, and the caller sees the {@link BoardJournalError}.
   * @param run - the mutation, called with the open document.
   * @returns what `run` returned.
   */
  private guard<T>(run: (open: OpenDocument) => T): Promise<T> {
    return this.read((open) => {
      try {
        return run(open)
      } catch (error: unknown) {
        if (open.journal.broken) this.discard(open)
        throw error
      }
    })
  }

  /**
   * Detach a document whose journal broke and clear the cache entry that holds
   * it, so the next {@link KetosBoardDocService.open} loads `board.db` again.
   * @param open - the broken document.
   */
  private discard(open: OpenDocument): void {
    open.document.ydoc.off('update', this.onDocumentUpdate)
    open.journal.close()
    open.document.ydoc.destroy()
    if (this.opened === open) {
      this.opened = undefined
      this.opening = undefined
    }
  }

  private readonly onDocumentUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === PEER_ORIGIN || origin === LOAD_ORIGIN) return
    for (const listener of [...this.localUpdateListeners]) {
      try {
        listener(update)
      } catch (error: unknown) {
        // An exception that left this Yjs listener would stop every later
        // `update` event of the document, and the journal row is committed.
        this.options.logger(`board local-update listener failed: ${String(error)}`)
      }
    }
  }

  private emit(change: BoardChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change)
      } catch (error: unknown) {
        // The batch is committed; one failing subscriber must not fail it for
        // the caller or starve the subscribers after it.
        this.options.logger(`board change subscriber failed: ${String(error)}`)
      }
    }
  }

  /**
   * Project one remote transaction onto the patch subscribers read: the
   * changed keys that still decode become upserts, the changed keys that left
   * the document become removes, and an entry another Ketos version wrote that
   * this build cannot decode is skipped (the reader logs it, as on snapshot).
   * @param open - the open document.
   * @param delta - keys the remote transaction changed.
   * @returns the patch, or undefined when nothing readable changed.
   */
  private remoteChange(open: OpenDocument, delta: BoardDocumentDelta): BoardChange | undefined {
    const upserts: BoardElement[] = []
    const removes: ElementId[] = []
    for (const key of delta.elements) {
      if (!isElementId(key)) continue
      const id = brandString<ElementId>(key)
      const element = open.document.readElement(id)
      if (element !== undefined) upserts.push(element)
      else if (!open.document.hasElement(id)) removes.push(id)
    }
    const participantUpserts: BoardParticipantRecord[] = []
    const participantRemoves: OwnerId[] = []
    for (const key of delta.participants) {
      const id = brandString<OwnerId>(key)
      const record = open.document.readParticipant(id)
      if (record !== undefined) participantUpserts.push(record)
      else if (!open.document.hasParticipant(id)) participantRemoves.push(id)
    }
    const windowUpserts: BoardWindowRecord[] = []
    const windowRemoves: WindowId[] = []
    for (const key of delta.windows) {
      if (!isWindowId(key)) continue
      const id = brandString<WindowId>(key)
      const record = open.document.readWindow(id)
      if (record !== undefined) windowUpserts.push(record)
      else if (!open.document.hasWindow(id)) windowRemoves.push(id)
    }
    if (upserts.length === 0 && removes.length === 0
      && participantUpserts.length === 0 && participantRemoves.length === 0
      && windowUpserts.length === 0 && windowRemoves.length === 0) {
      return undefined
    }
    return {
      revision: open.journal.revision(),
      upserts,
      removes,
      ...(participantUpserts.length === 0 && participantRemoves.length === 0
        ? {}
        : { participants: { upserts: participantUpserts, removes: participantRemoves } }),
      ...(windowUpserts.length === 0 && windowRemoves.length === 0
        ? {}
        : { windows: { upserts: windowUpserts, removes: windowRemoves } }),
    }
  }

  private async dispose(): Promise<void> {
    const opening = this.opening
    this.disposed = true
    this.opening = undefined
    this.listeners.clear()
    this.localUpdateListeners.clear()
    let open: OpenDocument | undefined
    try {
      open = await opening
    } catch (_error: unknown) {
      // The failed open already closed its own handle and was reported to the
      // caller that requested it; disposal has nothing left to free.
    }
    if (open !== undefined) {
      open.document.ydoc.off('update', this.onDocumentUpdate)
      open.journal.close()
    }
    await this.database.close()
  }
}
