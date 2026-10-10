/**
 * One peer connection's framed message channel: a serialized write queue, a
 * read loop that turns bytes into frames, request/response correlation with
 * per-request timeouts, the heartbeat that notices a silent peer, and close
 * handling that never lets a malformed frame throw past the loop. The channel
 * above it — service, handshake, known peers — sees only typed payloads.
 *
 * The heartbeat runs from {@link PeerLink.start} until the link starts
 * closing: the link sends `peer.ping` every `heartbeatIntervalMs`, answers
 * every received ping with `peer.pong`, and closes with code
 * {@link PEER_LINK_HEARTBEAT_CLOSE_CODE} and reason `heartbeat-timeout` when
 * it completed no read for `heartbeatTimeoutMs`. A completed read is a frame
 * header or one body slice of up to {@link PEER_READ_SLICE_BYTES}, so board
 * traffic keeps a link open, and a large update keeps it open while each
 * slice arrives within the timeout; bytes of an unfinished slice do not
 * count. Pings go out unconditionally and every ping is answered, so each
 * side's detection depends on its own two values only.
 * @module @ketos/peer/link
 */

import {
  PEER_FRAME_CODES, PEER_FRAME_HEADER_BYTES, PeerFrameError, classifyPeerPayload, encodePeerFrame,
  frameNameFor, isBinaryFrameCode, parseByePayload, parseHeartbeatPayload, parseHelloPayload, parsePeerFrameHeader,
  parsePeerFramePayload, peerFrameBodyLimit, type PeerEnvelope, type PeerHelloPayload, type PeerFrameName,
} from './frame.ts'
import type { PeerConnection, PeerStream } from './transport.ts'
import type { KetosPeerId } from './types.ts'

/** The failure of a request the peer did not answer within its timeout. */
export class PeerRequestTimeoutError extends Error {
  /**
   * @param timeoutMs - the timeout that elapsed, in milliseconds.
   */
  constructor(timeoutMs: number) {
    super(`peer request timed out after ${String(timeoutMs)} ms`)
    this.name = 'PeerRequestTimeoutError'
  }
}

/** The close code an application frame error closes a connection with. */
export const PEER_LINK_PROTOCOL_CLOSE_CODE = 2n

/** The close code a refused connection carries. */
export const PEER_LINK_REFUSED_CLOSE_CODE = 1n

/** The close code a duplicate connection carries. */
export const PEER_LINK_DUPLICATE_CLOSE_CODE = 3n

/** The close code a sender carries when a synchronization update is too large. */
export const PEER_LINK_SYNC_TOO_LARGE_CLOSE_CODE = 4n

/** The close code of a link a newer authenticated connection of the same peer replaced. */
export const PEER_LINK_REPLACED_CLOSE_CODE = 5n

/** The close code of a link that completed no read for `heartbeatTimeoutMs`. */
export const PEER_LINK_HEARTBEAT_CLOSE_CODE = 6n

/**
 * Largest slice of a frame body one stream read takes, in bytes. A body
 * longer than this arrives in several reads, and each completed read counts
 * as a sign of life for the heartbeat; a large frame therefore keeps a link
 * open only above one slice per `heartbeatTimeoutMs`, about 14.6 kbit/s with
 * the default 9000 ms.
 */
export const PEER_READ_SLICE_BYTES = 16_384

/**
 * Longest wait, in milliseconds, for the transport to accept a closing link's
 * `bye` before the connection closes regardless.
 */
export const PEER_LINK_BYE_GRACE_MS = 250

/** What one frame listener receives beside the payload. */
export interface PeerFrameContext {
  /** Present when the frame was a request this Ketos must answer. */
  readonly requestId?: string
}

/**
 * Returned by a listener that has no handler for the frame; a request then
 * stays unanswered and its sender times out, which the channel treats as the
 * regular outcome for a reserved type no consumer registered yet.
 */
export const PEER_UNHANDLED: unique symbol = Symbol('ketos-peer-unhandled')

/**
 * Receives one frame of a registered type. For a request, the first
 * registered listener's resolved value becomes the response body; every
 * listener of the type still runs. For a plain message the return value is
 * ignored.
 */
export type PeerFrameListener = (
  code: number,
  payload: unknown,
  context: PeerFrameContext,
) => unknown

/** Deployment inputs of one link. */
export interface PeerLinkOptions {
  /** Identity of the remote node. */
  readonly peerId: KetosPeerId
  /** Largest accepted frame body, in bytes. */
  readonly maxFrameBytes: number
  /** Pause between two `peer.ping` frames, in milliseconds. */
  readonly heartbeatIntervalMs: number
  /** Longest time without a completed read before the link closes, in milliseconds. */
  readonly heartbeatTimeoutMs: number
  /** Receives one line per protocol anomaly and one per heartbeat timeout. */
  readonly logger: (message: string) => void
  /** Receives a `hello` a peer sends after the handshake, such as a color change. */
  readonly onHello: (hello: PeerHelloPayload) => void
}

/** One in-flight request the link is waiting to answer. */
interface PendingRequest {
  /** Frame code the response must carry. */
  readonly code: number
  readonly resolve: (payload: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout
}

/**
 * Read one frame from a stream. The header is read first and its declared
 * length checked against the code's bound before any body byte is read; a
 * body longer than {@link PEER_READ_SLICE_BYTES} is read in slices.
 * @param stream - the stream to read.
 * @param maxFrameBytes - largest accepted body; the heartbeat codes have a smaller one.
 * @param onBytes - runs after each completed read: the header and every body slice.
 * @returns the decoded code and payload.
 */
export async function readPeerFrame(
  stream: PeerStream,
  maxFrameBytes: number,
  onBytes?: () => void,
): Promise<{ code: number; payload: unknown }> {
  const read = async (length: number): Promise<Uint8Array> => {
    const bytes = await stream.readExact(length)
    onBytes?.()
    return bytes
  }
  const { length, code } = parsePeerFrameHeader(await read(PEER_FRAME_HEADER_BYTES))
  const limit = peerFrameBodyLimit(code, maxFrameBytes)
  if (length > limit) {
    throw new PeerFrameError(`frame length ${String(length)} exceeds ${String(limit)} bytes`)
  }
  if (length <= PEER_READ_SLICE_BYTES) {
    return { code, payload: parsePeerFramePayload(code, length === 0 ? new Uint8Array(0) : await read(length)) }
  }
  const body = new Uint8Array(length)
  for (let offset = 0; offset < length; offset += PEER_READ_SLICE_BYTES) {
    body.set(await read(Math.min(PEER_READ_SLICE_BYTES, length - offset)), offset)
  }
  return { code, payload: parsePeerFramePayload(code, body) }
}

/**
 * Write one frame to a stream.
 * @param stream - the stream to write.
 * @param code - frame code.
 * @param payload - the typed payload of the code.
 */
export async function writePeerFrame(stream: PeerStream, code: number, payload: unknown): Promise<void> {
  await stream.write(encodePeerFrame(code, payload))
}

/**
 * One framed channel over an open connection and its single bidirectional
 * stream. The owner constructs the link after the handshake frames and calls
 * {@link PeerLink.start}; disposal is {@link PeerLink.close}.
 */
export class PeerLink {
  private readonly listeners = new Set<PeerFrameListener>()
  private readonly pending = new Map<string, PendingRequest>()
  private readonly closeWaiters = new Set<(reason: string) => void>()
  private writeQueue: Promise<void> = Promise.resolve()
  private closedReason: string | undefined
  private requestSequence = 0
  /** Sends `peer.ping` every `heartbeatIntervalMs`; armed by start, cleared by the close. */
  private pingTimer: NodeJS.Timeout | undefined
  /** Fires `heartbeatTimeoutMs` after the last completed read; armed by start, cleared by the close. */
  private silenceTimer: NodeJS.Timeout | undefined
  /** The close decision one loop turn after the silence timer fired; cleared by the close. */
  private silenceCheck: NodeJS.Timeout | undefined
  /** Completed reads so far; the close decision compares it with its value when the silence timer fired. */
  private reads = 0

  /**
   * @param connection - the open transport connection.
   * @param stream - the connection's single stream, past the handshake.
   * @param options - peer id, frame bound, and log sink.
   */
  constructor(
    private readonly connection: PeerConnection,
    private readonly stream: PeerStream,
    private readonly options: PeerLinkOptions,
  ) {
    void connection.closed().then(
      (reason) => { this.settle(reason) },
      (error: unknown) => { this.settle(`connection closed: ${String(error)}`) },
    )
  }

  /** Identity of the remote node. */
  get peerId(): KetosPeerId {
    return this.options.peerId
  }

  /**
   * Register a frame listener for every type.
   * @param listener - receives each decoded frame.
   * @returns the unsubscribe function.
   */
  onFrame(listener: PeerFrameListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Start the read loop and the heartbeat. A link that already closed starts
   * neither, so no timer outlives it.
   */
  start(): void {
    if (this.closedReason !== undefined) return
    this.pingTimer = setInterval(() => { this.ping() }, this.options.heartbeatIntervalMs)
    this.pingTimer.unref()
    this.silenceTimer = setTimeout(() => { this.onSilence() }, this.options.heartbeatTimeoutMs)
    this.silenceTimer.unref()
    void this.readLoop()
  }

  /**
   * Queue one frame for writing. The frame is encoded and measured before it
   * reaches the queue, so a payload the vocabulary refuses and a body over the
   * link's frame bound both fail at the sender instead of breaking the
   * receiving side.
   * @param code - frame code.
   * @param payload - the typed payload of the code.
   * @returns a promise settling when the transport accepted the bytes.
   */
  send(code: number, payload: unknown): Promise<void> {
    if (this.closedReason !== undefined) return Promise.reject(new Error('peer link is closed'))
    let frame: Uint8Array
    try {
      frame = encodePeerFrame(code, payload)
      if (frame.byteLength > PEER_FRAME_HEADER_BYTES + this.options.maxFrameBytes) {
        throw new PeerFrameError(`frame body exceeds ${String(this.options.maxFrameBytes)} bytes`)
      }
    } catch (error: unknown) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    const write = this.writeQueue.then(() => this.stream.write(frame))
    this.writeQueue = write.catch(() => undefined)
    return write
  }

  /**
   * Send one frame without waiting; a failed write is logged instead of
   * rejecting, for announcements whose caller cannot handle an error.
   * @param code - frame code.
   * @param payload - JSON-serializable payload.
   */
  trySend(code: number, payload: unknown): void {
    void this.send(code, payload).catch((error: unknown) => {
      this.options.logger(`peer ${String(this.options.peerId).slice(0, 12)}: send failed: ${String(error)}`)
    })
  }

  /**
   * Send one request and wait for its response envelope on the same frame
   * type.
   * @param code - frame code.
   * @param payload - request body.
   * @param timeoutMs - how long to wait for the answer.
   * @returns the response body; rejects with {@link PeerRequestTimeoutError} when the peer does not answer in time.
   */
  request(code: number, payload: unknown, timeoutMs: number): Promise<unknown> {
    if (this.closedReason !== undefined) return Promise.reject(new Error('peer link is closed'))
    this.requestSequence += 1
    const requestId = `${Date.now().toString(36)}:${this.requestSequence.toString(36)}:${Math.random().toString(16).slice(2, 10)}`
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new PeerRequestTimeoutError(timeoutMs))
      }, timeoutMs)
      timer.unref()
      this.pending.set(requestId, { code, resolve, reject, timer })
      this.send(code, { requestId, request: payload }).catch((error: unknown) => {
        this.pending.delete(requestId)
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  /**
   * A promise settling with the close reason when the link ends.
   * @returns the close reason.
   */
  closed(): Promise<string> {
    if (this.closedReason !== undefined) return Promise.resolve(this.closedReason)
    return new Promise((resolve) => { this.closeWaiters.add(resolve) })
  }

  /**
   * Close the link regularly: queue `bye`, wait at most
   * {@link PEER_LINK_BYE_GRACE_MS} for the transport to accept it, then close
   * the connection. The `bye` is a courtesy that may not arrive: a write queue
   * stalled behind a peer that stopped reading never delays the close past the
   * grace, and the connection close is the act both sides rely on. The
   * heartbeat stops when the close begins, so the grace never ends in a
   * heartbeat timeout.
   * @param reason - short reason text.
   * @param code - application close code; defaults to a regular close.
   */
  async close(reason: string, code: bigint = 0n): Promise<void> {
    if (this.closedReason !== undefined) return
    this.stopHeartbeat()
    let timer: NodeJS.Timeout | undefined
    const grace = new Promise<void>((resolve) => { timer = setTimeout(resolve, PEER_LINK_BYE_GRACE_MS) })
    // A failed bye means the peer is already gone; the connection close below is the real act.
    const bye = this.send(PEER_FRAME_CODES.bye, { reason }).catch(() => undefined)
    await Promise.race([bye, grace])
    clearTimeout(timer)
    this.fail(code, reason)
  }

  /** Clear the heartbeat timers and a pending close decision; the silence timer's refresh is a no-op afterwards. */
  private stopHeartbeat(): void {
    clearInterval(this.pingTimer)
    clearTimeout(this.silenceTimer)
    clearTimeout(this.silenceCheck)
    this.pingTimer = undefined
    this.silenceTimer = undefined
    this.silenceCheck = undefined
  }

  /** Queue one `peer.ping`. */
  private ping(): void {
    // A failed ping write means the stream broke; the read loop or the
    // silence timer ends the link, so the failure needs no handling here.
    this.send(PEER_FRAME_CODES['peer.ping'], {}).catch(() => undefined)
  }

  /**
   * Decide one loop turn after the silence timer fired. After a blocked event
   * loop, Node runs due timers before it delivers the bytes that arrived
   * meanwhile; a 0 ms timer runs only after that delivery, so a read it
   * completes counts, and its refresh has already re-armed the silence timer.
   */
  private onSilence(): void {
    const reads = this.reads
    this.silenceCheck = setTimeout(() => {
      this.silenceCheck = undefined
      if (this.reads !== reads) return
      this.options.logger(
        `ketos-peer: peer.heartbeat-timeout ${String(this.options.peerId).slice(0, 12)}: no completed read for ${String(this.options.heartbeatTimeoutMs)} ms`,
      )
      this.fail(PEER_LINK_HEARTBEAT_CLOSE_CODE, 'heartbeat-timeout')
    }, 0)
    this.silenceCheck.unref()
  }

  private async readLoop(): Promise<void> {
    // Count the read and restart the silence countdown; the timer is undefined once the link closed.
    const received = (): void => {
      this.reads += 1
      this.silenceTimer?.refresh()
    }
    try {
      while (this.closedReason === undefined) {
        const { code, payload } = await readPeerFrame(this.stream, this.options.maxFrameBytes, received)
        this.dispatch(code, payload)
      }
    } catch (error: unknown) {
      if (this.closedReason !== undefined) return
      const reason = error instanceof Error ? error.message : String(error)
      this.options.logger(`peer ${String(this.options.peerId).slice(0, 12)}: closing after ${reason}`)
      this.fail(PEER_LINK_PROTOCOL_CLOSE_CODE, 'protocol error')
    }
  }

  private dispatch(code: number, payload: unknown): void {
    void this.handleFrame(code, payload).catch((error: unknown) => {
      if (this.closedReason !== undefined) return
      const reason = error instanceof Error ? error.message : String(error)
      this.options.logger(`peer ${String(this.options.peerId).slice(0, 12)}: closing after ${reason}`)
      this.fail(PEER_LINK_PROTOCOL_CLOSE_CODE, 'protocol error')
    })
  }

  private async handleFrame(code: number, payload: unknown): Promise<void> {
    if (code === PEER_FRAME_CODES.bye) {
      const bye = parseByePayload(payload)
      this.settle(`bye: ${bye.reason}`)
      this.fail(0n, 'bye')
      return
    }
    if (code === PEER_FRAME_CODES.hello) {
      this.options.onHello(parseHelloPayload(payload))
      return
    }
    if (code === PEER_FRAME_CODES['peer.ping']) {
      parseHeartbeatPayload(payload)
      // A failed pong write means the stream broke; the read loop or the
      // silence timer ends the link, so the failure needs no handling here.
      this.send(PEER_FRAME_CODES['peer.pong'], {}).catch(() => undefined)
      return
    }
    if (code === PEER_FRAME_CODES['peer.pong']) {
      parseHeartbeatPayload(payload)
      return
    }
    const name = frameNameFor(code)
    if (name === undefined) throw new PeerFrameError(`unknown frame code ${String(code)}`)
    // A binary frame is always a plain message; the request/response envelope
    // exists only on JSON codes.
    const envelope = isBinaryFrameCode(code) ? { kind: 'message' } as const : classifyPeerPayload(payload)
    if (envelope.kind === 'response' || envelope.kind === 'error') {
      this.settleResponse(code, envelope)
      return
    }
    if (envelope.kind === 'message') {
      await this.notifyListeners(name, code, payload, {})
      return
    }
    const listeners = [...this.listeners]
    if (listeners.length === 0) {
      this.logUnhandled(name)
      return
    }
    let body: unknown
    try {
      const results = await Promise.all(
        listeners.map(listener => listener(code, envelope.body, { requestId: envelope.requestId })),
      )
      if (results[0] === PEER_UNHANDLED) {
        this.logUnhandled(name)
        return
      }
      // JSON drops an undefined field, which would leave the envelope without
      // its response marker; a void handler therefore answers null.
      body = results[0]
    } catch (error: unknown) {
      await this.send(code, { requestId: envelope.requestId, error: error instanceof Error ? error.message : String(error) })
      return
    }
    await this.send(code, { requestId: envelope.requestId, response: body === undefined ? null : body })
  }

  /**
   * Run every listener for one plain message. A listener that throws is logged
   * and does not close the channel: one consumer's failure — a document update
   * it cannot read, say — must not cost the connection.
   * @param name - frame type name for the log.
   * @param code - wire code.
   * @param payload - decoded payload.
   * @param context - the frame context, empty for a plain message.
   */
  private async notifyListeners(
    name: PeerFrameName,
    code: number,
    payload: unknown,
    context: PeerFrameContext,
  ): Promise<void> {
    const listeners = [...this.listeners]
    if (listeners.length === 0) {
      this.logUnhandled(name)
      return
    }
    const results = await Promise.all(listeners.map(listener => this.runListener(name, listener, code, payload, context)))
    if (results[0] === PEER_UNHANDLED) this.logUnhandled(name)
  }

  /**
   * One listener invocation whose failure is contained.
   * @param name - frame type name for the log.
   * @param listener - the listener to run.
   * @param code - wire code.
   * @param payload - decoded payload.
   * @param context - the frame context.
   * @returns the listener's value, or undefined when it threw.
   */
  private async runListener(
    name: PeerFrameName,
    listener: PeerFrameListener,
    code: number,
    payload: unknown,
    context: PeerFrameContext,
  ): Promise<unknown> {
    try {
      return await listener(code, payload, context)
    } catch (error: unknown) {
      this.options.logger(`peer ${String(this.options.peerId).slice(0, 12)}: frame ${name} handler failed: ${String(error)}`)
      return undefined
    }
  }

  /**
   * Record one frame no listener handled.
   * @param name - frame type name.
   */
  private logUnhandled(name: PeerFrameName): void {
    this.options.logger(`peer ${String(this.options.peerId).slice(0, 12)}: frame ${name} has no handler`)
  }

  private settleResponse(code: number, envelope: Extract<PeerEnvelope, { kind: 'response' | 'error' }>): void {
    const pending = this.pending.get(envelope.requestId)
    if (pending === undefined) {
      this.options.logger(`peer ${String(this.options.peerId).slice(0, 12)}: response for unknown request ignored`)
      return
    }
    if (pending.code !== code) {
      this.options.logger(`peer ${String(this.options.peerId).slice(0, 12)}: response on the wrong frame type ignored`)
      return
    }
    this.pending.delete(envelope.requestId)
    clearTimeout(pending.timer)
    if (envelope.kind === 'response') pending.resolve(envelope.body)
    else pending.reject(new Error(envelope.message))
  }

  private fail(code: bigint, reason: string): void {
    this.settle(`closed locally: ${reason} (code ${code.toString()})`)
    try {
      this.connection.close(code, reason)
    } catch (error: unknown) {
      this.options.logger(`peer ${String(this.options.peerId).slice(0, 12)}: close failed: ${String(error)}`)
    }
  }

  private settle(reason: string): void {
    if (this.closedReason !== undefined) return
    this.closedReason = reason
    this.stopHeartbeat()
    for (const resolve of [...this.closeWaiters]) resolve(reason)
    this.closeWaiters.clear()
    for (const [requestId, pending] of [...this.pending]) {
      this.pending.delete(requestId)
      clearTimeout(pending.timer)
      pending.reject(new Error(`peer link closed before the response: ${reason}`))
    }
  }
}
