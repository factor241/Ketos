/**
 * The `ctx.ketosPeer` service: one iroh node with a stored key, the accept
 * loop, the invitation code, the known-peer file, the participant record and
 * its color rule, and the framed messages with request/response timeouts.
 *
 * The node starts lazily — on the first route call or at plugin start when
 * `peers.json` already names someone — so a developer machine that never
 * composes the plugin never touches the native module. The transport is a
 * seam: production uses iroh, tests inject the in-memory pair.
 * @module @ketos/peer/service
 */

import { Service, type Context } from '@deepseek-ai/cordis'
// The service type import applies the board document's `ctx.ketosBoardDoc`
// Context declaration merge without pulling its runtime module in.
import type { KetosBoardDocService } from '@ketos/board-doc/src/service.ts'
import type { BoardParticipantRecord } from '@ketos/board-doc/types'
import { firstFreeColor, nextFreeColor } from './color.ts'
import {
  PEER_FRAME_CODES, PEER_HELLO_MAX_BYTES, PEER_PROTOCOL_VERSION, PeerFrameError, frameCodeFor, parseHelloPayload, type PeerFrameType,
  type PeerFrameTypeMap, type PeerHelloPayload,
} from './frame.ts'
import {
  INVITE_MAX_FAILED_ATTEMPTS, encodeBase32, formatInvite, inviteSecretMatches, mintInviteSecret, parseInvite,
} from './invite.ts'
import {
  PeerLink, PEER_LINK_DUPLICATE_CLOSE_CODE, PEER_LINK_PROTOCOL_CLOSE_CODE,
  PEER_LINK_REFUSED_CLOSE_CODE, PEER_LINK_REPLACED_CLOSE_CODE, PEER_LINK_SYNC_TOO_LARGE_CLOSE_CODE,
  PEER_UNHANDLED, readPeerFrame, writePeerFrame, type PeerFrameContext,
} from './link.ts'
import { loadOrCreateSecretKey } from './key-file.ts'
import { loadKnownPeers, saveKnownPeers, type KnownPeer } from './peers-file.ts'
import type { PeerConnection, PeerIncoming, PeerStream, PeerTransport } from './transport.ts'
import type {
  PeerErrorCode, KetosPeerId, PeerLinkState, PeerSelfState, PeerState, PeerStateResponse,
} from './types.ts'

/** One committed peer handshake, as the connected event carries it. */
export interface PeerConnectedEvent {
  /** Identity of the peer's node. */
  readonly peerId: KetosPeerId
  /** The peer's board participant id. */
  readonly selfId: PeerState['selfId']
  /** The peer's participant name. */
  readonly name: string
  /** The peer's palette color. */
  readonly color: number
}

/** One ended channel, as the disconnected event carries it. */
export interface PeerDisconnectedEvent {
  /** Identity of the peer's node. */
  readonly peerId: KetosPeerId
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    ketosPeer: KetosPeerService
  }

  interface Events {
    /** A channel to a known peer became usable; late listeners read the state and catch up.
     * @param peer - the peer that just connected.
     * @mode emit
     */
    'ketos-peer/connected'(peer: PeerConnectedEvent): void
    /** A channel to a known peer ended; reconnection may follow.
     * @param peer - the peer whose channel ended.
     * @mode emit
     */
    'ketos-peer/disconnected'(peer: PeerDisconnectedEvent): void
  }
}

/** Deployment inputs of the peer node. */
export interface KetosPeerOptions {
  /** Participant name this Ketos publishes. */
  readonly name: string
  /**
   * Relay URLs of the team's private iroh relay, the node's only relay map. A
   * connection starts through the relay and moves to a direct path once iroh
   * establishes one.
   */
  readonly relayUrls: readonly string[]
  /** Path of the stored 32-byte node key. */
  readonly keyPath: string
  /** Path of the known-peer file. */
  readonly peersPath: string
  /** Largest accepted frame body, in bytes. */
  readonly maxFrameBytes: number
  /** How long `invite()` waits for a relay address, in milliseconds. */
  readonly onlineTimeoutMs: number
  /** How long a dial or handshake step may take, in milliseconds. */
  readonly connectTimeoutMs: number
  /** First reconnection pause, in milliseconds. */
  readonly reconnectMinMs: number
  /** Reconnection pause ceiling, in milliseconds. */
  readonly reconnectMaxMs: number
  /** Lifetime of one invitation secret, in milliseconds. */
  readonly inviteTtlMs: number
  /** Interval the state route publishes for browser polling, in milliseconds. */
  readonly stateRefreshMs: number
  /** Local address the node binds, when the deployment pins one. */
  readonly bindAddr?: string
  /** Receives one line per connection act and protocol anomaly. */
  readonly logger: (message: string) => void
  /** Test seam: a pre-bound transport; production derives one from iroh. */
  readonly transport?: PeerTransport
}

/** One refused peer operation with its stable route code. */
export class PeerServiceError extends Error {
  /**
   * @param code - stable route code.
   * @param reason - what failed; for logs, never for the browser.
   */
  constructor(
    readonly code: PeerErrorCode,
    reason: string,
  ) {
    super(reason)
    this.name = 'PeerServiceError'
  }
}

/** One handler a consumer registered for a frame type. */
type RegisteredPeerHandler = (payload: unknown, from: KetosPeerId, context: PeerFrameContext) => unknown

/** One pending invitation secret. */
interface PendingInvite {
  /** The encoded one-time secret. */
  readonly secret: string
  /** When the secret stops admitting an unknown node. */
  readonly expiresAt: number
  /** Wrong secrets presented so far; the invitation burns at the limit. */
  failedAttempts: number
}

/** Abort reason of a reconnect loop whose peer got a link: a dial in flight still finishes. */
const LINK_ATTACHED = 'link attached'

/** Abort reason of a reconnect loop stopped by disposal or by forgetting the peer. */
const RECONNECT_CANCELLED = 'reconnect cancelled'

/**
 * The peer node. Every method that needs the channel awaits
 * {@link KetosPeerService.ensureStarted} first; the owning plugin closes the
 * node through {@link KetosPeerService.close}.
 */
export class KetosPeerService extends Service {
  private readonly options: KetosPeerOptions
  private readonly links = new Map<string, PeerLink>()
  private readonly records = new Map<string, KnownPeer>()
  private readonly peerStates = new Map<string, PeerState>()
  private readonly handlers = new Map<number, Set<RegisteredPeerHandler>>()
  private readonly reconnects = new Map<string, AbortController>()
  /** Nominal pause before the latest redial of each peer; cleared by a long-lived link. */
  private readonly backoff = new Map<string, number>()
  /** Endpoint that dialed each live link: this node for an outgoing one, the peer for an incoming one. */
  private readonly dialers = new WeakMap<PeerLink, KetosPeerId>()
  /** Times each peer was forgotten; a handshake that began before a forget must not bring the peer back. */
  private readonly forgets = new Map<string, number>()
  /** Tail of the known-peer file writes; each write snapshots the records when it runs. */
  private persisting: Promise<void> = Promise.resolve()
  private participants: readonly BoardParticipantRecord[] = []
  private transport: PeerTransport | undefined
  private self: PeerSelfState | undefined
  private pendingInvite: PendingInvite | undefined
  private starting: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private disposed = false

  /**
   * @param ctx - context the service registers `ketosPeer` in.
   * @param options - deployment inputs and the transport seam.
   */
  constructor(ctx: Context, options: KetosPeerOptions) {
    super(ctx, 'ketosPeer')
    this.options = options
  }

  /**
   * Start the node once: load or create the key, bind the transport, publish
   * the local participant, and dial the known peers that carry a ticket.
   * A failed start is not cached, so a later call retries.
   * @returns a promise settling when the node is bound and its peers are known.
   */
  ensureStarted(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('ketos peer: already closed'))
    this.starting ??= this.start().catch((error: unknown) => {
      this.starting = undefined
      throw error
    })
    return this.starting
  }

  /**
   * Start the node when the known-peer file already names someone, so a
   * restarted Ketos accepts the other side's redial without a browser.
   * @returns a promise settling when the check finished; a missing file starts nothing.
   */
  async startIfKnownPeers(): Promise<void> {
    const known = await loadKnownPeers(this.options.peersPath)
    if (known.length > 0) await this.ensureStarted()
  }

  /**
   * Every known peer with its current link state.
   * @returns the peer states in the order they were learned.
   */
  peers(): readonly PeerState[] {
    return [...this.peerStates.values()]
  }

  /**
   * Identity of the local node, derived from its stored key. The key file
   * survives restarts, so this identity is stable across them.
   * @returns the local peer id; starts the node.
   */
  async nodeId(): Promise<KetosPeerId> {
    await this.ensureStarted()
    return (this.transport as PeerTransport).selfId()
  }

  /**
   * Mint one invitation code. The secret is single-use and lives for
   * `inviteTtlMs`; a previous unused secret is replaced.
   * @returns the code to show the user.
   */
  async invite(): Promise<string> {
    await this.ensureStarted()
    const transport = this.transport as PeerTransport
    try {
      await withTimeout(transport.online(), this.options.onlineTimeoutMs, 'relay did not come online')
    } catch (error: unknown) {
      throw new PeerServiceError('ketos/peer-offline', String(error))
    }
    let ticket: string
    try {
      ticket = transport.invitationTicket()
    } catch (error: unknown) {
      throw new PeerServiceError('ketos/peer-offline', String(error))
    }
    const secret = encodeBase32(mintInviteSecret())
    this.pendingInvite = { secret, expiresAt: Date.now() + this.options.inviteTtlMs, failedAttempts: 0 }
    return formatInvite(ticket, secret)
  }

  /**
   * Dial the node one invitation code names and complete the handshake. On
   * success both sides know each other and later connections need no code.
   * @param code - the invitation code the other Ketos showed.
   * @returns the connected peer's identity.
   */
  async connect(code: string): Promise<{ peerId: KetosPeerId }> {
    await this.ensureStarted()
    const parsed = parseInvite(code)
    if (parsed === undefined) throw new PeerServiceError('ketos/invalid', 'malformed invitation code')
    const transport = this.transport as PeerTransport
    let peerId: KetosPeerId
    try {
      peerId = transport.ticketPeerId(parsed.ticket)
    } catch {
      throw new PeerServiceError('ketos/invalid', 'invitation code names an unreadable ticket')
    }
    if (peerId === transport.selfId()) throw new PeerServiceError('ketos/peer-self', 'invitation code names this node')
    if (this.links.has(peerId)) throw new PeerServiceError('ketos/invite-used', 'a channel to this peer is already open')
    const connection = await this.dial(parsed.ticket)
    try {
      this.throwIfDisposed()
      const stream = await connection.openStream()
      const hello = await this.exchangeHello(stream, { ...this.ownHello(), invite: parsed.secret })
      this.throwIfDisposed()
      await this.recordHello(peerId, hello, parsed.ticket)
      this.attachLink(connection, stream, 'outgoing')
      this.applyPeerHello(hello)
      return { peerId }
    } catch (error: unknown) {
      connection.close(PEER_LINK_REFUSED_CLOSE_CODE, 'connect failed')
      if (this.disposed) throw new PeerServiceError('ketos/peer-offline', 'ketos peer: already closed')
      throw new PeerServiceError('ketos/invite-used', String(error))
    }
  }

  /**
   * The current peer state the browser polls.
   * @returns the local record, every known peer, and the poll interval.
   */
  async state(): Promise<PeerStateResponse> {
    await this.ensureStarted()
    return {
      self: this.self as PeerSelfState,
      peers: this.peers(),
      refreshMs: this.options.stateRefreshMs,
    }
  }

  /**
   * Send one frame to a connected peer.
   * @param peerId - the peer's node identity.
   * @param type - frame type name.
   * @param payload - the typed payload.
   * @returns a promise settling when the bytes were accepted.
   */
  async send<K extends PeerFrameType>(peerId: KetosPeerId, type: K, payload: PeerFrameTypeMap[K]): Promise<void> {
    const link = this.links.get(peerId)
    if (link === undefined) throw new Error(`peer ${String(peerId)} is not connected`)
    await link.send(frameCodeFor(type), payload)
  }

  /**
   * Send one request and wait for its response.
   * @param peerId - the peer's node identity.
   * @param type - frame type name.
   * @param payload - the typed request body.
   * @param options - per-request timeout; defaults to the connect timeout.
   * @returns the typed response body.
   */
  async request<K extends PeerFrameType>(
    peerId: KetosPeerId,
    type: K,
    payload: PeerFrameTypeMap[K],
    options?: { readonly timeoutMs?: number },
  ): Promise<unknown> {
    const link = this.links.get(peerId)
    if (link === undefined) throw new Error(`peer ${String(peerId)} is not connected`)
    return link.request(frameCodeFor(type), payload, options?.timeoutMs ?? this.options.connectTimeoutMs)
  }

  /**
   * Register a handler for one frame type. The caller owns the unsubscribe
   * through `ctx.effect`. Every registered handler of a type runs, even when
   * an earlier one throws; the first one's resolved value answers a request,
   * and a failure of any later one is logged.
   * @param type - frame type name.
   * @param handler - receives the payload and the sending peer.
   * @returns the unsubscribe function.
   */
  handle<K extends PeerFrameType>(
    type: K,
    handler: (payload: PeerFrameTypeMap[K], from: KetosPeerId, context: PeerFrameContext) => unknown,
  ): () => void {
    const code = frameCodeFor(type)
    const registered: RegisteredPeerHandler = (payload, from, context) =>
      handler(payload as PeerFrameTypeMap[K], from, context)
    let set = this.handlers.get(code)
    if (set === undefined) {
      set = new Set()
      this.handlers.set(code, set)
    }
    set.add(registered)
    return () => { set.delete(registered) }
  }

  /**
   * Close the channel to one peer because an outgoing synchronization update
   * exceeded the sender's bound. The peer stays known and may redial; a later
   * `ketos-peer/disconnected` event reports the regular end.
   * @param peerId - the peer whose channel closes.
   */
  closeSyncTooLarge(peerId: KetosPeerId): void {
    const link = this.links.get(peerId)
    if (link === undefined) return
    void link.close('board.sync.too-large', PEER_LINK_SYNC_TOO_LARGE_CLOSE_CODE)
  }

  /**
   * Forget one known peer that has no open channel: remove it from the
   * known-peer file and the peer list, and cancel its redials, including one
   * in flight. The peer is known again only after a new invitation. When the
   * file cannot be written the peer stays known and its redials continue.
   * @param peerId - the peer to forget.
   * @throws PeerServiceError `ketos/peer-unknown` for an unknown peer and
   * `ketos/peer-online` while a channel to it is open.
   */
  async forget(peerId: KetosPeerId): Promise<void> {
    await this.ensureStarted()
    const record = this.records.get(peerId)
    const state = this.peerStates.get(peerId)
    if (record === undefined || state === undefined) {
      throw new PeerServiceError('ketos/peer-unknown', `peer ${shortId(peerId)} is not known`)
    }
    if (this.links.has(peerId)) {
      throw new PeerServiceError('ketos/peer-online', `a channel to peer ${shortId(peerId)} is open`)
    }
    this.cancelReconnect(peerId)
    this.forgets.set(peerId, (this.forgets.get(peerId) ?? 0) + 1)
    this.backoff.delete(peerId)
    this.records.delete(peerId)
    this.peerStates.delete(peerId)
    try {
      await this.persistPeers()
    } catch (error: unknown) {
      // The file still lists the peer: keep it known and redialing rather than
      // let it reappear at the next start.
      this.records.set(peerId, record)
      this.peerStates.set(peerId, state)
      if (record.ticket !== undefined) this.scheduleReconnect(peerId, record.ticket, this.options.reconnectMinMs)
      throw error
    }
    this.options.logger(`ketos-peer: peer.forgotten ${shortId(peerId)}`)
  }

  /**
   * Close the node, its connections, and every reconnect attempt. Safe before
   * the first start and safe to call more than once.
   * @returns a promise settling when the transport is closed.
   */
  close(): Promise<void> {
    this.closing ??= this.dispose()
    return this.closing
  }

  private async start(): Promise<void> {
    // A failed attempt keeps the transport it created: the retry binds the same
    // node instead of leaving one bound iroh node per attempt behind.
    this.transport ??= this.options.transport ?? await this.createDefaultTransport()
    this.throwIfDisposed()
    const transport = this.transport
    await transport.bind()
    this.throwIfDisposed()
    const known = await loadKnownPeers(this.options.peersPath)
    this.throwIfDisposed()
    for (const record of known) {
      this.records.set(record.peerId, record)
      this.peerStates.set(record.peerId, { ...toState(record), link: 'lost' })
    }
    const board: KetosBoardDocService = this.ctx.ketosBoardDoc
    const selfId = await board.selfId()
    this.throwIfDisposed()
    const stored = await board.participants()
    this.throwIfDisposed()
    const color = firstFreeColor([
      ...stored.filter(participant => participant.id !== selfId).map(participant => participant.color),
      ...known.map(record => record.color),
    ])
    this.self = { selfId, name: this.options.name, color }
    this.participants = [
      ...stored.filter(participant => participant.id !== selfId),
      { id: selfId, name: this.options.name, color, updatedAt: Date.now() },
    ]
    await board.putOwnParticipant({ name: this.options.name, color })
    this.throwIfDisposed()
    void this.acceptLoop(transport)
    for (const record of known) {
      if (record.ticket !== undefined) this.scheduleReconnect(record.peerId, record.ticket, this.options.reconnectMinMs)
    }
  }

  private async createDefaultTransport(): Promise<PeerTransport> {
    const { createIrohTransport, generateSecretKey } = await import('./iroh-transport.ts')
    const key = await loadOrCreateSecretKey(this.options.keyPath, generateSecretKey)
    const options: { relayUrls: readonly string[]; key: Uint8Array; bindAddr?: string } = {
      relayUrls: this.options.relayUrls,
      key,
      ...this.options.bindAddr === undefined ? {} : { bindAddr: this.options.bindAddr },
    }
    return createIrohTransport(options)
  }

  private async acceptLoop(transport: PeerTransport): Promise<void> {
    for (;;) {
      let incoming: PeerIncoming
      try {
        incoming = await transport.accept()
      } catch (error: unknown) {
        // The transport rejects `accept()` only when it is closed, which is
        // the expected end of this loop after disposal; a handshake failure
        // of one incoming connection surfaces in `acceptConnection` instead.
        if (!this.isDisposed()) this.options.logger(`ketos-peer: accept stopped: ${String(error)}`)
        return
      }
      void this.acceptConnection(incoming)
    }
  }

  /**
   * Whether the service is disposed; the read stops control-flow narrowing
   * from hiding the loop's real exit.
   * @returns true after {@link KetosPeerService.close}.
   */
  private isDisposed(): boolean {
    return this.disposed
  }

  /**
   * Stop an asynchronous operation that resumed after disposal. Called after
   * every `await` that precedes a state change.
   * @throws when {@link KetosPeerService.close} ran.
   */
  private throwIfDisposed(): void {
    if (this.disposed) throw new Error('ketos peer: already closed')
  }

  private async acceptConnection(incoming: PeerIncoming): Promise<void> {
    let connection: PeerConnection
    try {
      connection = await incoming.complete()
    } catch (error: unknown) {
      this.options.logger(`ketos-peer: incoming connection failed: ${String(error)}`)
      return
    }
    const peerId = connection.peerId
    try {
      const stream = await withTimeout(
        connection.acceptStream(),
        this.options.connectTimeoutMs,
        'stream did not open',
      )
      const frame = await withTimeout(
        readPeerFrame(stream, this.helloMaxBytes()),
        this.options.connectTimeoutMs,
        'hello did not arrive',
      )
      if (frame.code !== PEER_FRAME_CODES.hello) throw new PeerFrameError('first frame must be hello')
      const hello = parseHelloPayload(frame.payload)
      const known = this.records.get(peerId)
      const forgetsBefore = this.forgets.get(peerId) ?? 0
      if (known === undefined && !this.consumeInvite(hello.invite)) {
        connection.close(PEER_LINK_REFUSED_CLOSE_CODE, 'refused')
        this.options.logger(`ketos-peer: peer.refused ${shortId(peerId)}`)
        return
      }
      this.throwIfDisposed()
      await this.recordHello(peerId, hello, known?.ticket)
      this.throwIfDisposed()
      await writePeerFrame(stream, PEER_FRAME_CODES.hello, this.ownHello())
      this.throwIfDisposed()
      if ((this.forgets.get(peerId) ?? 0) !== forgetsBefore) {
        // forget() ran while this handshake awaited: the record it removed
        // must not come back through this connection.
        connection.close(PEER_LINK_REFUSED_CLOSE_CODE, 'forgotten')
        await this.dropForgottenRecord(peerId)
        return
      }
      this.attachLink(connection, stream, 'incoming')
      this.applyPeerHello(hello)
    } catch (error: unknown) {
      if (this.disposed) {
        connection.close(0n, 'shutdown')
        return
      }
      connection.close(PEER_LINK_PROTOCOL_CLOSE_CODE, 'handshake')
      this.options.logger(`ketos-peer: handshake from ${shortId(peerId)} failed: ${String(error)}`)
    }
  }

  /**
   * Remove the record a handshake wrote for a peer that was forgotten while
   * the handshake ran.
   * @param peerId - the forgotten peer.
   * @returns a promise settling when the known-peer file no longer lists it, or the write failed.
   */
  private async dropForgottenRecord(peerId: KetosPeerId): Promise<void> {
    this.records.delete(peerId)
    this.peerStates.delete(peerId)
    await this.persistPeersLogged()
  }

  /**
   * The body bound of a handshake frame: a `hello` of a node that has not
   * proven itself is read under {@link PEER_HELLO_MAX_BYTES}, never under the
   * large bound of established channels.
   * @returns the bound, in bytes.
   */
  private helloMaxBytes(): number {
    return Math.min(this.options.maxFrameBytes, PEER_HELLO_MAX_BYTES)
  }

  private async dial(ticket: string): Promise<PeerConnection> {
    try {
      return await withTimeout(
        (this.transport as PeerTransport).dial(ticket),
        this.options.connectTimeoutMs,
        'dial timed out',
      )
    } catch (error: unknown) {
      throw new PeerServiceError('ketos/peer-unreachable', error instanceof Error ? error.message : String(error))
    }
  }

  /** Open the stream as the dialing side and complete the hello exchange. */
  private async exchangeHello(stream: PeerStream, hello: PeerHelloPayload): Promise<PeerHelloPayload> {
    await writePeerFrame(stream, PEER_FRAME_CODES.hello, hello)
    const frame = await withTimeout(
      readPeerFrame(stream, this.helloMaxBytes()),
      this.options.connectTimeoutMs,
      'hello did not arrive',
    )
    if (frame.code !== PEER_FRAME_CODES.hello) throw new PeerFrameError('reply must be hello')
    return parseHelloPayload(frame.payload)
  }

  private async dialKnown(peerId: KetosPeerId, ticket: string, signal: AbortSignal): Promise<void> {
    const connection = await this.dial(ticket)
    try {
      this.throwIfRedialCancelled(signal)
      const stream = await withTimeout(connection.openStream(), this.options.connectTimeoutMs, 'stream did not open')
      const hello = await this.exchangeHello(stream, this.ownHello())
      this.throwIfRedialCancelled(signal)
      await this.recordHello(peerId, hello, ticket)
      this.throwIfRedialCancelled(signal)
      this.attachLink(connection, stream, 'outgoing')
      this.applyPeerHello(hello)
    } catch (error: unknown) {
      connection.close(PEER_LINK_PROTOCOL_CLOSE_CODE, 'handshake')
      throw error
    }
  }

  /**
   * Stop a redial whose loop was cancelled — by disposal or by forgetting the
   * peer — before it records or attaches anything.
   * @param signal - the loop's cancellation signal.
   * @throws when the service closed or the loop was cancelled.
   */
  private throwIfRedialCancelled(signal: AbortSignal): void {
    this.throwIfDisposed()
    // A loop stopped because a link to the peer attached lets its dial in
    // flight finish: attachLink then keeps whichever connection the shared
    // rule prefers, so the two sides never drop the one the other kept.
    if (signal.aborted && signal.reason !== LINK_ATTACHED) throw new Error('reconnect cancelled')
  }

  /**
   * Announce the current hello on one link, best effort: a link that ended
   * between the map read and the write must not fail the caller.
   * @param link - the link to write to.
   */
  private announceHello(link: PeerLink): void {
    link.trySend(PEER_FRAME_CODES.hello, this.ownHello())
  }

  /**
   * Install the link of a completed handshake.
   *
   * An `outgoing` connection is one this node dialed, an `incoming` one was
   * dialed by the peer. When the peer already has a live link,
   * {@link newLinkWins} decides which connection stays, by the same rule on
   * both sides; the losing connection closes as a duplicate (code 3) or, when
   * it was the live link, as replaced (code 5). A replaced link is retired at
   * once instead of waiting for the transport's idle timeout.
   * @param connection - the handshaken connection.
   * @param stream - its single stream, past the handshake.
   * @param origin - which side opened the connection.
   */
  private attachLink(connection: PeerConnection, stream: PeerStream, origin: 'incoming' | 'outgoing'): void {
    this.throwIfDisposed()
    const peerId = connection.peerId
    const transport = this.transport as PeerTransport
    const dialer = origin === 'outgoing' ? transport.selfId() : peerId
    const existing = this.links.get(peerId)
    if (existing !== undefined) {
      if (!this.newLinkWins(dialer, this.dialers.get(existing) as KetosPeerId)) {
        connection.close(PEER_LINK_DUPLICATE_CLOSE_CODE, 'duplicate')
        return
      }
      this.replaceLink(peerId, existing)
    }
    const link = new PeerLink(connection, stream, {
      peerId,
      maxFrameBytes: this.options.maxFrameBytes,
      logger: this.options.logger,
      onHello: (hello) => {
        void this.recordHello(peerId, hello, this.records.get(peerId)?.ticket).then(() => {
          this.applyPeerHello(hello)
        })
      },
    })
    link.onFrame((code, payload, context) => this.dispatchFrame(peerId, code, payload, context))
    link.start()
    this.links.set(peerId, link)
    this.dialers.set(link, dialer)
    this.cancelReconnect(peerId, LINK_ATTACHED)
    this.setLinkState(peerId, 'online')
    const state = this.peerStates.get(peerId) as PeerState
    this.options.logger(`ketos-peer: peer.connected ${shortId(peerId)}`)
    this.ctx.emit('ketos-peer/connected', {
      peerId,
      selfId: state.selfId,
      name: state.name,
      color: state.color,
    })
    // Announce the current record once more now that the link exists, so a
    // color the collision rule just changed reaches the peer.
    this.announceHello(link)
    const openedAt = Date.now()
    void link.closed().then((reason) => { this.onLinkClosed(peerId, link, reason, Date.now() - openedAt) })
  }

  /**
   * Whether a new connection to a peer with a live link replaces that link.
   * Both sides apply the same rule to the same pair of connections, so they
   * keep the same one: of two connections with different dialers, the one
   * dialed by the node with the smaller endpoint id stays. Of two connections
   * with the same dialer, the newer one replaces the older on both sides: the
   * accepting side sees a redial only when the dialer's own link is dead, and
   * two dials of one node that race (a pasted code against the reconnect
   * loop) complete in the same order on both ends.
   * @param dialer - endpoint that dialed the new connection.
   * @param existingDialer - endpoint that dialed the live link.
   * @returns true when the new connection replaces the live link.
   */
  private newLinkWins(dialer: KetosPeerId, existingDialer: KetosPeerId): boolean {
    return dialer === existingDialer || dialer < existingDialer
  }

  /**
   * Retire a link that a newer connection of the same peer replaces. The old
   * link leaves the map first, so its close callback reports nothing and
   * schedules no reconnection; the disconnected event keeps every consumer's
   * connected/disconnected pairs balanced before the new link's event.
   * @param peerId - the peer whose link is replaced.
   * @param existing - the link being retired.
   */
  private replaceLink(peerId: KetosPeerId, existing: PeerLink): void {
    this.links.delete(peerId)
    this.options.logger(`ketos-peer: peer.replaced ${shortId(peerId)}`)
    void existing.close('replaced', PEER_LINK_REPLACED_CLOSE_CODE)
    this.setLinkState(peerId, 'lost')
    this.ctx.emit('ketos-peer/disconnected', { peerId })
  }

  /**
   * Report an ended link and schedule the dialing side's redial.
   * @param peerId - the peer whose link ended.
   * @param link - the ended link; a link replaced or unknown is ignored.
   * @param reason - the transport's close reason.
   * @param lifetimeMs - how long the link was open.
   */
  private onLinkClosed(peerId: KetosPeerId, link: PeerLink, reason: string, lifetimeMs: number): void {
    if (this.links.get(peerId) !== link) return
    this.links.delete(peerId)
    this.options.logger(`ketos-peer: peer.disconnected ${shortId(peerId)}: ${reason}`)
    this.setLinkState(peerId, 'lost')
    this.ctx.emit('ketos-peer/disconnected', { peerId })
    const record = this.records.get(peerId)
    if (record?.ticket !== undefined && !this.disposed) {
      this.scheduleReconnect(peerId, record.ticket, this.pauseAfterLink(peerId, lifetimeMs))
    }
  }

  /**
   * The first redial pause after a link ended. A link that lived for less
   * than `reconnectMaxMs` counts as a failed attempt, so the pause doubles
   * from the previous redial's pause and the successful handshake of that
   * redial did not reset it; a repeating exchange that closes the link — an
   * update over the size bound, say — then slows down instead of redialing
   * once per `reconnectMinMs`. Only a link that lived at least
   * `reconnectMaxMs` starts over from `reconnectMinMs`.
   * @param peerId - the peer whose link ended.
   * @param lifetimeMs - how long the link was open.
   * @returns the nominal pause before the first redial.
   */
  private pauseAfterLink(peerId: KetosPeerId, lifetimeMs: number): number {
    const { reconnectMinMs, reconnectMaxMs } = this.options
    if (lifetimeMs >= reconnectMaxMs) {
      this.backoff.delete(peerId)
      return reconnectMinMs
    }
    const previous = this.backoff.get(peerId)
    const next = previous === undefined ? reconnectMinMs : Math.min(previous * 2, reconnectMaxMs)
    this.options.logger(
      `ketos-peer: peer.flapping ${shortId(peerId)}: link lived ${String(lifetimeMs)} ms, next pause ${String(next)} ms`,
    )
    return next
  }

  private scheduleReconnect(peerId: KetosPeerId, ticket: string, firstPause: number): void {
    // Callers reach here only from start() and onLinkClosed, where no loop is
    // pending for the peer and no link exists; the guard is the invariant.
    /* v8 ignore next -- duplicate-schedule guard, by construction unreached. */
    if (this.disposed || this.reconnects.has(peerId) || this.links.has(peerId)) return
    const controller = new AbortController()
    this.reconnects.set(peerId, controller)
    void (async () => {
      let delay = firstPause
      while (!controller.signal.aborted && !this.disposed) {
        this.backoff.set(peerId, delay)
        this.setLinkState(peerId, 'lost')
        try {
          await sleep(jitter(delay, this.options.reconnectMaxMs), controller.signal)
        } catch {
          return
        }
        /* v8 ignore next -- abort race window, covered by the sleep rejection. */
        if (this.isReconnectCancelled(controller)) return
        this.setLinkState(peerId, 'connecting')
        try {
          await this.dialKnown(peerId, ticket, controller.signal)
          return
        } catch (error: unknown) {
          if (this.isReconnectCancelled(controller)) return
          this.options.logger(`ketos-peer: reconnect to ${shortId(peerId)} failed: ${String(error)}`)
        }
        delay = Math.min(delay * 2, this.options.reconnectMaxMs)
      }
    })().finally(() => {
      // Every exit path already removed this controller: attachLink cancels
      // it through cancelReconnect, and disposal clears the map; the check
      // keeps a newer loop's registration safe.
      /* v8 ignore next -- registration cleanup, by construction unreached. */
      if (this.reconnects.get(peerId) === controller) this.reconnects.delete(peerId)
    })
  }

  /**
   * Whether a reconnect loop must stop before its next attempt.
   * @param controller - the loop's cancellation controller.
   * @returns true after disposal or cancellation.
   */
  private isReconnectCancelled(controller: AbortController): boolean {
    return this.disposed || controller.signal.aborted
  }

  private cancelReconnect(peerId: KetosPeerId, reason: string = RECONNECT_CANCELLED): void {
    const controller = this.reconnects.get(peerId)
    if (controller !== undefined) {
      controller.abort(reason)
      this.reconnects.delete(peerId)
    }
  }

  private dispatchFrame(
    peerId: KetosPeerId,
    code: number,
    payload: unknown,
    context: PeerFrameContext,
  ): unknown {
    const handlers = this.handlers.get(code)
    if (handlers === undefined || handlers.size === 0) return PEER_UNHANDLED
    const [first, ...rest] = [...handlers].map(handler => invokeHandler(handler, payload, peerId, context))
    // The link answers a request with the first outcome and logs its failure;
    // a later handler's failure is only logged here.
    void Promise.allSettled(rest).then((outcomes) => {
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
          this.options.logger(`ketos-peer: frame handler for ${shortId(peerId)} failed: ${String(outcome.reason)}`)
        }
      }
    })
    return first
  }

  private async recordHello(peerId: KetosPeerId, hello: PeerHelloPayload, ticket: string | undefined): Promise<void> {
    const existing = this.records.get(peerId)
    const effectiveTicket = ticket ?? existing?.ticket
    const record: KnownPeer = {
      peerId,
      selfId: hello.selfId,
      name: hello.name,
      color: hello.color,
      ...effectiveTicket === undefined ? {} : { ticket: effectiveTicket },
      lastSeen: new Date().toISOString(),
    }
    this.records.set(peerId, record)
    const state = this.peerStates.get(peerId)
    this.peerStates.set(peerId, { ...toState(record), link: state?.link ?? 'lost' })
    await this.persistPeersLogged()
  }

  /**
   * Write the known-peer file and log a failed write instead of throwing; the
   * records in memory stay as they are.
   * @returns a promise settling when the write finished or failed.
   */
  private async persistPeersLogged(): Promise<void> {
    try {
      await this.persistPeers()
    } catch (error: unknown) {
      this.options.logger(`ketos-peer: known-peer file write failed: ${String(error)}`)
    }
  }

  /**
   * Write the known-peer file. Writes run one after another and each takes
   * its snapshot when it starts, so an older snapshot never replaces a newer
   * one — which would bring a forgotten peer back.
   * @returns a promise settling when this write finished or failed.
   */
  private persistPeers(): Promise<void> {
    const write = this.persisting.then(() => saveKnownPeers(this.options.peersPath, [...this.records.values()]))
    this.persisting = write.catch(() => undefined)
    return write
  }

  private applyPeerHello(hello: PeerHelloPayload): void {
    const self = this.self
    if (self === undefined || hello.color !== self.color) return
    // The participant with the larger board selfId yields; the other side
    // keeps its color and its record untouched, so both sides agree on one
    // outcome without negotiation.
    if (String(hello.selfId) >= String(self.selfId)) return
    const color = nextFreeColor(this.takenColors(), self.color)
    if (color === self.color) return
    this.self = { ...self, color }
    this.participants = [
      ...this.participants.filter(participant => participant.id !== self.selfId),
      { id: self.selfId, name: self.name, color, updatedAt: Date.now() },
    ]
    void this.putOwnParticipant(color)
    this.broadcastHello()
  }

  private takenColors(): number[] {
    const selfId = this.self?.selfId
    const colors: number[] = []
    for (const record of this.records.values()) colors.push(record.color)
    for (const participant of this.participants) {
      if (participant.id !== selfId) colors.push(participant.color)
    }
    return colors
  }

  private async putOwnParticipant(color: number): Promise<void> {
    try {
      await this.ctx.ketosBoardDoc.putOwnParticipant({ name: this.options.name, color })
    } catch (error: unknown) {
      this.options.logger(`ketos-peer: participant write failed: ${String(error)}`)
    }
  }

  private broadcastHello(): void {
    for (const link of this.links.values()) this.announceHello(link)
  }

  private ownHello(): PeerHelloPayload {
    const self = this.self
    // Every caller runs behind ensureStarted, which sets `self` before the
    // accept loop or any link exists.
    /* v8 ignore next -- unstarted-node guard, by construction unreached. */
    if (self === undefined) throw new Error('ketos peer: node has not started')
    return { v: PEER_PROTOCOL_VERSION, selfId: self.selfId, name: self.name, color: self.color }
  }

  private consumeInvite(secret: string | undefined): boolean {
    const invite = this.pendingInvite
    if (secret === undefined || invite === undefined) return false
    if (Date.now() > invite.expiresAt) {
      this.pendingInvite = undefined
      return false
    }
    if (!inviteSecretMatches(secret, invite.secret)) {
      invite.failedAttempts += 1
      if (invite.failedAttempts >= INVITE_MAX_FAILED_ATTEMPTS) {
        this.pendingInvite = undefined
        this.options.logger('ketos-peer: peer.invite-burned after repeated wrong secrets')
      }
      return false
    }
    this.pendingInvite = undefined
    return true
  }

  private setLinkState(peerId: KetosPeerId, link: PeerLinkState): void {
    const state = this.peerStates.get(peerId)
    // Every caller reached this peer through a stored record or a handshake,
    // both of which seeded its state.
    /* v8 ignore next -- unseeded-peer guard, by construction unreached. */
    if (state === undefined) return
    this.peerStates.set(peerId, { ...state, link })
  }

  private async dispose(): Promise<void> {
    this.disposed = true
    for (const controller of [...this.reconnects.values()]) controller.abort()
    this.reconnects.clear()
    await this.settleStart()
    // The map empties before the links close, so the close callbacks of a
    // shutdown see no link to report.
    const links = [...this.links.values()]
    this.links.clear()
    await Promise.all(links.map(link => link.close('shutdown')))
    this.handlers.clear()
    this.pendingInvite = undefined
    await this.transport?.close()
    this.transport = undefined
  }

  /**
   * Wait until a start in flight stopped touching state. The start observes
   * the disposed flag after each `await` and ends with an error, so the
   * transport it created is closed by the caller afterwards.
   */
  private async settleStart(): Promise<void> {
    try {
      await this.starting
    } catch {
      // The start failure was already reported to the caller of
      // ensureStarted; disposal only needs the start to have stopped.
    }
  }
}

/**
 * Project one stored record onto the browser's peer state.
 * @param record - the stored known peer.
 * @returns the state without its link field.
 */
function toState(record: KnownPeer): Omit<PeerState, 'link'> {
  return { peerId: record.peerId, selfId: record.selfId, name: record.name, color: record.color }
}

/**
 * Shorten one peer id for a log line.
 * @param peerId - full peer identity.
 * @returns the leading characters.
 */
function shortId(peerId: KetosPeerId): string {
  return String(peerId).slice(0, 12)
}

/**
 * Run one frame handler so that a synchronous throw becomes a rejected
 * outcome instead of stopping the handlers after it.
 * @param handler - the registered handler.
 * @param payload - the decoded payload.
 * @param from - the sending peer.
 * @param context - the frame context.
 * @returns the handler's value, or a rejected promise when it threw.
 */
function invokeHandler(
  handler: RegisteredPeerHandler,
  payload: unknown,
  from: KetosPeerId,
  context: PeerFrameContext,
): unknown {
  try {
    return handler(payload, from, context)
  } catch (error: unknown) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * A reconnection pause drawn uniformly from ±20% around the nominal pause and
 * never above the ceiling. At the ceiling the draw spreads over the lower 20%
 * instead of piling up on the ceiling itself, so two sides that both redial
 * rarely start at the same moment.
 * @param delay - nominal pause in milliseconds.
 * @param ceiling - longest pause, in milliseconds.
 * @returns the jittered pause.
 */
function jitter(delay: number, ceiling: number): number {
  const low = Math.min(delay, ceiling) * 0.8
  const high = Math.min(delay * 1.2, ceiling)
  return Math.round(low + Math.random() * (high - low))
}

/**
 * Await a timer that an abort cancels.
 * @param ms - pause length, in milliseconds.
 * @param signal - cancellation signal.
 * @returns a promise resolving when the pause ends, rejecting on abort.
 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Reject when a promise does not settle in time.
 * @param promise - the promise to bound.
 * @param ms - time budget in milliseconds.
 * @param reason - rejection message.
 * @returns the promise's value.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, reason: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error(reason)) }, ms)
        timer.unref()
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
