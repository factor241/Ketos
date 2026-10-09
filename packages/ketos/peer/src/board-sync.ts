/**
 * Board document synchronization over the peer channel: the state-vector
 * exchange at every connection — the first one and every reconnection — and
 * the ongoing relay of document updates in both directions.
 *
 * The document lives behind `ctx.ketosBoardDoc`; this module owns only the
 * schedule. On `ketos-peer/connected` the local Ketos sends its state vector;
 * a received vector is answered with `diffSince(vector)`, a received update is
 * applied. Every update this Ketos produced is relayed to each connected peer,
 * and the document's `peer` origin keeps an applied update from echoing back.
 * An update over `maxSyncUpdateBytes` is not sent: the line
 * `board.sync.too-large` goes to the host log and the channel closes with the
 * too-large code. An update the document could not apply, or applied only in
 * part, makes this Ketos send its state vector again after a pause that doubles
 * from `reconnectMinMs` to `reconnectMaxMs`, so the sender supplies what the
 * document misses instead of the gap lasting until the next reconnection.
 * @module @ketos/peer/board-sync
 */

import type { Context } from '@deepseek-ai/cordis'
import type { KetosBoardDocService } from '@ketos/board-doc/src/service.ts'
import type { KetosPeerId, PeerState } from './types.ts'

/** Name of one frame type board synchronization sends or receives. */
type BoardSyncFrameType = 'board.sv' | 'board.update'

/** The members of the peer node board synchronization uses; `KetosPeerService` provides them. */
export interface BoardSyncPeer {
  /**
   * Register a handler for one board synchronization frame type.
   * @param type - the frame type.
   * @param handler - receives the frame's bytes and the sending peer.
   * @returns the unsubscribe function.
   */
  handle(type: BoardSyncFrameType, handler: (payload: Uint8Array, from: KetosPeerId) => unknown): () => void
  /**
   * Send one board synchronization frame to a connected peer.
   * @param peerId - the receiving peer.
   * @param type - the frame type.
   * @param payload - the frame's bytes.
   * @returns a promise settling when the transport accepted the bytes.
   */
  send(peerId: KetosPeerId, type: BoardSyncFrameType, payload: Uint8Array): Promise<void>
  /**
   * Every known peer with its link state.
   * @returns the peers' ids and link states.
   */
  peers(): readonly Pick<PeerState, 'peerId' | 'link'>[]
  /**
   * Close the channel to a peer because an outgoing update exceeded the bound.
   * @param peerId - the peer whose channel closes.
   */
  closeSyncTooLarge(peerId: KetosPeerId): void
}

/** The members of the board document service board synchronization uses. */
export type BoardSyncDocument = Pick<KetosBoardDocService, 'stateVector' | 'diffSince' | 'applyRemote' | 'onLocalUpdate'>

/** Deployment inputs of the board synchronization. */
export interface BoardSyncOptions {
  /** Largest update this Ketos sends; a bigger one closes the channel. */
  readonly maxSyncUpdateBytes: number
  /** First pause before a state vector is resent after an unapplied update, in milliseconds. */
  readonly reconnectMinMs: number
  /** Longest such pause, in milliseconds. */
  readonly reconnectMaxMs: number
  /** Receives one line per synchronization act and anomaly. */
  readonly logger: (message: string) => void
}

/** The resynchronization state of one peer. */
interface Resync {
  /** Nominal pause of the latest scheduled resync; absent after a clean apply. */
  delay?: number
  /** The pending resync timer; absent while none is scheduled. */
  timer?: NodeJS.Timeout | undefined
  /**
   * Whether an apply threw since the streak began. Content that failed to
   * apply never arrives by itself, while a gap in the update order closes
   * when the missing update arrives.
   */
  failed: boolean
}

/**
 * Wire board document synchronization into one peer node: the frame handlers,
 * the connection announcement, and the local-update relay, all as effects of
 * the calling fiber.
 * @param ctx - context the peer and board document services live in.
 * @param peer - the peer node to exchange over.
 * @param board - the board document to keep in sync.
 * @param options - update bound and log sink.
 */
export function registerBoardSync(
  ctx: Context,
  peer: BoardSyncPeer,
  board: BoardSyncDocument,
  options: BoardSyncOptions,
): void {
  const log = options.logger
  const short = (peerId: KetosPeerId): string => String(peerId).slice(0, 12)

  const announce = async (peerId: KetosPeerId): Promise<void> => {
    try {
      const vector = await board.stateVector()
      await peer.send(peerId, 'board.sv', vector)
    } catch (error: unknown) {
      log(`ketos-peer: board sync announce failed: ${String(error)}`)
    }
  }

  const answerStateVector = async (peerId: KetosPeerId, vector: Uint8Array): Promise<void> => {
    try {
      const update = await board.diffSince(vector)
      if (update.byteLength > options.maxSyncUpdateBytes) {
        log(`ketos-peer: board.sync.too-large (${String(update.byteLength)} bytes) for ${short(peerId)}`)
        peer.closeSyncTooLarge(peerId)
        return
      }
      await peer.send(peerId, 'board.update', update)
    } catch (error: unknown) {
      log(`ketos-peer: board sync answer failed: ${String(error)}`)
    }
  }

  const resyncs = new Map<KetosPeerId, Resync>()

  const clearResync = (peerId: KetosPeerId): void => {
    clearTimeout(resyncs.get(peerId)?.timer)
    resyncs.delete(peerId)
  }

  const scheduleResync = (peerId: KetosPeerId, failed: boolean): void => {
    const resync = resyncs.get(peerId) ?? { failed }
    resync.failed ||= failed
    resyncs.set(peerId, resync)
    // A pending timer already covers this failure.
    if (resync.timer !== undefined) return
    const delay = resync.delay === undefined ? options.reconnectMinMs : Math.min(resync.delay * 2, options.reconnectMaxMs)
    resync.delay = delay
    resync.timer = setTimeout(() => {
      resync.timer = undefined
      log(`ketos-peer: board.sync.resync for ${short(peerId)} after ${String(delay)} ms`)
      void announce(peerId)
    }, delay)
    resync.timer.unref()
  }

  const receiveUpdate = async (peerId: KetosPeerId, update: Uint8Array): Promise<void> => {
    try {
      const result = await board.applyRemote(update)
      if (result.pending) {
        scheduleResync(peerId, false)
        return
      }
    } catch (error: unknown) {
      log(`ketos-peer: board sync apply failed: ${String(error)}`)
      scheduleResync(peerId, true)
      return
    }
    // A clean apply closes a gap in the update order, so a resync scheduled
    // only for such a gap is no longer needed; one scheduled for a failed
    // apply still is.
    const resync = resyncs.get(peerId)
    if (resync !== undefined && (resync.timer === undefined || !resync.failed)) clearResync(peerId)
  }

  const relayLocalUpdate = (update: Uint8Array): void => {
    const online = peer.peers().filter(state => state.link === 'online')
    if (update.byteLength > options.maxSyncUpdateBytes) {
      for (const state of online) {
        log(`ketos-peer: board.sync.too-large (${String(update.byteLength)} bytes) for ${short(state.peerId)}`)
        peer.closeSyncTooLarge(state.peerId)
      }
      return
    }
    for (const state of online) {
      void peer.send(state.peerId, 'board.update', update).catch((error: unknown) => {
        log(`ketos-peer: board sync send failed: ${String(error)}`)
      })
    }
  }

  ctx.effect(() => peer.handle('board.sv', (vector, from) => {
    void answerStateVector(from, vector)
  }), 'ketos-peer: board state-vector handler')
  ctx.effect(() => peer.handle('board.update', (update, from) => {
    void receiveUpdate(from, update)
  }), 'ketos-peer: board update handler')
  ctx.effect(() => board.onLocalUpdate((update) => { relayLocalUpdate(update) }), 'ketos-peer: board update relay')
  ctx.effect(() => ctx.on('ketos-peer/connected', (event) => {
    clearResync(event.peerId)
    void announce(event.peerId)
  }), 'ketos-peer: board announcement')
  // A new channel starts with a full vector exchange, which replaces any
  // resync of the ended one.
  ctx.effect(() => ctx.on('ketos-peer/disconnected', (event) => { clearResync(event.peerId) }), 'ketos-peer: board resync reset')
  ctx.effect(() => () => {
    for (const peerId of [...resyncs.keys()]) clearResync(peerId)
  }, 'ketos-peer: board resync timers')
}
