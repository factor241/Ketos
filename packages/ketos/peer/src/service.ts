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
  PEER_FRAME_CODES, PeerFrameError, frameCodeFor, parseHelloPayload, type PeerFrameType,
  type PeerFrameTypeMap, type PeerHelloPayload,
} from './frame.ts'
import { formatInvite, encodeBase32, mintInviteSecret, parseInvite } from './invite.ts'
import {
  PeerLink, PEER_LINK_DUPLICATE_CLOSE_CODE, PEER_LINK_PROTOCOL_CLOSE_CODE,
  PEER_LINK_REFUSED_CLOSE_CODE, PEER_UNHANDLED, readPeerFrame, writePeerFrame, type PeerFrameContext,
} from './link.ts'
import { loadOrCreateSecretKey } from './key-file.ts'
import { loadKnownPeers, saveKnownPeers, type KnownPeer } from './peers-file.ts'
import type { PeerConnection, PeerStream, PeerTransport } from './transport.ts'
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
  /** Relay URLs of the team's private iroh relay; the node's only transport. */
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
}

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
    this.pendingInvite = { secret, expiresAt: Date.now() + this.options.inviteTtlMs }
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
      const stream = await connection.openStream()
      const hello = await this.exchangeHello(stream, { ...this.ownHello(), invite: parsed.secret })
      await this.recordHello(peerId, hello, parsed.ticket)
      this.attachLink(connection, stream)
      this.applyPeerHello(hello)
      return { peerId }
    } catch (error: unknown) {
      connection.close(PEER_LINK_REFUSED_CLOSE_CODE, 'connect failed')
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
   * through `ctx.effect`. Every registered handler of a type runs; the first
   * one's resolved value answers a request.
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
   * Close the node, its connections, and every reconnect attempt. Safe before
   * the first start and safe to call more than once.
   * @returns a promise settling when the transport is closed.
   */
  close(): Promise<void> {
    this.closing ??= this.dispose()
    return this.closing
  }

  private async start(): Promise<void> {
    const transport = this.options.transport ?? await this.createDefaultTransport()
    this.transport = transport
    await transport.bind()
    const known = await loadKnownPeers(this.options.peersPath)
    for (const record of known) {
      this.records.set(record.peerId, record)
      this.peerStates.set(record.peerId, { ...toState(record), link: 'lost' })
    }
    const board: KetosBoardDocService = this.ctx.ketosBoardDoc
    const selfId = await board.selfId()
    const stored = await board.participants()
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
    void this.acceptLoop()
    for (const record of known) {
      if (record.ticket !== undefined) this.scheduleReconnect(record.peerId, record.ticket)
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

  private async acceptLoop(): Promise<void> {
    for (;;) {
      let connection: PeerConnection
      try {
        connection = await (this.transport as PeerTransport).accept()
      } catch (error: unknown) {
        // Disposal closes the transport, which is the expected end of this
        // loop; any other rejection is worth a line.
        if (!this.isDisposed()) this.options.logger(`ketos-peer: accept stopped: ${String(error)}`)
        return
      }
      void this.acceptConnection(connection)
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

  private async acceptConnection(connection: PeerConnection): Promise<void> {
    const peerId = connection.peerId
    try {
      const stream = await withTimeout(
        connection.acceptStream(),
        this.options.connectTimeoutMs,
        'stream did not open',
      )
      const frame = await withTimeout(
        readPeerFrame(stream, this.options.maxFrameBytes),
        this.options.connectTimeoutMs,
        'hello did not arrive',
      )
      if (frame.code !== PEER_FRAME_CODES.hello) throw new PeerFrameError('first frame must be hello')
      const hello = parseHelloPayload(frame.payload)
      const known = this.records.get(peerId)
      if (known === undefined && !this.consumeInvite(hello.invite)) {
        connection.close(PEER_LINK_REFUSED_CLOSE_CODE, 'refused')
        this.options.logger(`ketos-peer: peer.refused ${shortId(peerId)}`)
        return
      }
      if (this.links.has(peerId)) {
        connection.close(PEER_LINK_DUPLICATE_CLOSE_CODE, 'duplicate')
        return
      }
      await this.recordHello(peerId, hello, known?.ticket)
      await writePeerFrame(stream, PEER_FRAME_CODES.hello, this.ownHello())
      this.attachLink(connection, stream)
      this.applyPeerHello(hello)
    } catch (error: unknown) {
      connection.close(PEER_LINK_PROTOCOL_CLOSE_CODE, 'handshake')
      this.options.logger(`ketos-peer: handshake from ${shortId(peerId)} failed: ${String(error)}`)
    }
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
      readPeerFrame(stream, this.options.maxFrameBytes),
      this.options.connectTimeoutMs,
      'hello did not arrive',
    )
    if (frame.code !== PEER_FRAME_CODES.hello) throw new PeerFrameError('reply must be hello')
    return parseHelloPayload(frame.payload)
  }

  private async dialKnown(peerId: KetosPeerId, ticket: string): Promise<void> {
    const connection = await this.dial(ticket)
    try {
      const stream = await withTimeout(connection.openStream(), this.options.connectTimeoutMs, 'stream did not open')
      const hello = await this.exchangeHello(stream, this.ownHello())
      await this.recordHello(peerId, hello, ticket)
      this.attachLink(connection, stream)
      this.applyPeerHello(hello)
    } catch (error: unknown) {
      connection.close(PEER_LINK_PROTOCOL_CLOSE_CODE, 'handshake')
      throw error
    }
  }

  /**
   * Announce the current hello on one link, best effort: a link that ended
   * between the map read and the write must not fail the caller.
   * @param link - the link to write to.
   */
  private announceHello(link: PeerLink): void {
    link.trySend(PEER_FRAME_CODES.hello, this.ownHello())
  }

  private attachLink(connection: PeerConnection, stream: PeerStream): void {
    const peerId = connection.peerId
    // A racing dial — the browser's connect() against the reconnect loop, or
    // two handshakes admitted at once — must not replace the live channel.
    // The first link keeps its place; the duplicate closes with its own code.
    if (this.links.has(peerId)) {
      connection.close(PEER_LINK_DUPLICATE_CLOSE_CODE, 'duplicate')
      return
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
    this.cancelReconnect(peerId)
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
    void link.closed().then((reason) => { this.onLinkClosed(peerId, link, reason) })
  }

  private onLinkClosed(peerId: KetosPeerId, link: PeerLink, reason: string): void {
    if (this.links.get(peerId) !== link) return
    this.links.delete(peerId)
    this.options.logger(`ketos-peer: peer.disconnected ${shortId(peerId)}: ${reason}`)
    this.setLinkState(peerId, 'lost')
    this.ctx.emit('ketos-peer/disconnected', { peerId })
    const record = this.records.get(peerId)
    if (record?.ticket !== undefined && !this.disposed) this.scheduleReconnect(peerId, record.ticket)
  }

  private scheduleReconnect(peerId: KetosPeerId, ticket: string): void {
    // Callers reach here only from start() and onLinkClosed, where no loop is
    // pending for the peer and no link exists; the guard is the invariant.
    /* v8 ignore next -- duplicate-schedule guard, by construction unreached. */
    if (this.disposed || this.reconnects.has(peerId) || this.links.has(peerId)) return
    const controller = new AbortController()
    this.reconnects.set(peerId, controller)
    void (async () => {
      let delay = this.options.reconnectMinMs
      while (!controller.signal.aborted && !this.disposed) {
        this.setLinkState(peerId, 'lost')
        try {
          await sleep(jitter(delay), controller.signal)
        } catch {
          return
        }
        /* v8 ignore next -- abort race window, covered by the sleep rejection. */
        if (this.isReconnectCancelled(controller)) return
        this.setLinkState(peerId, 'connecting')
        try {
          await this.dialKnown(peerId, ticket)
          return
        } catch (error: unknown) {
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

  private cancelReconnect(peerId: KetosPeerId): void {
    const controller = this.reconnects.get(peerId)
    if (controller !== undefined) {
      controller.abort()
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
    const results = [...handlers].map(handler => handler(payload, peerId, context))
    return results[0]
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
    try {
      await saveKnownPeers(this.options.peersPath, [...this.records.values()])
    } catch (error: unknown) {
      this.options.logger(`ketos-peer: known-peer file write failed: ${String(error)}`)
    }
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
    return { v: 1, selfId: self.selfId, name: self.name, color: self.color }
  }

  private consumeInvite(secret: string | undefined): boolean {
    const invite = this.pendingInvite
    if (secret === undefined || invite === undefined) return false
    if (Date.now() > invite.expiresAt) {
      this.pendingInvite = undefined
      return false
    }
    if (secret !== invite.secret) return false
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
 * A reconnection pause with ±20% jitter.
 * @param delay - nominal pause in milliseconds.
 * @returns the jittered pause.
 */
function jitter(delay: number): number {
  return Math.round(delay * (0.8 + Math.random() * 0.4))
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
