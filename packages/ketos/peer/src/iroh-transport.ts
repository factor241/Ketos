/**
 * The iroh implementation of the peer transport: the only module that
 * dynamically imports `@number0/iroh`. It binds an endpoint with the stored
 * key, the team relay map, and the peer ALPN, and it translates the native
 * stream surface — `Array<number>` buffers, `bigint` close codes — into the
 * transport seam.
 *
 * The version this channel pins (1.1.0) aborts the process on any `watch*`
 * call and never resolves the native `stopped` read, so neither appears here;
 * `tests/native-surface.spec.ts` keeps the ban mechanical.
 * @module @ketos/peer/iroh-transport
 */

import type { BiStream, Connection, Endpoint, EndpointBuilder } from '@number0/iroh'
import { brandString } from '@deepseek-ai/dsh-brand'
import { PEER_PROTOCOL_VERSION } from './frame.ts'
import type { PeerConnection, PeerIncoming, PeerStream, PeerTransport } from './transport.ts'
import type { KetosPeerId } from './types.ts'

/** The ALPN every Ketos peer connection negotiates; it carries the protocol version. */
export const PEER_ALPN = `ketos/peer/${String(PEER_PROTOCOL_VERSION)}`

/** The loaded native module surface. */
type IrohModule = typeof import('@number0/iroh')

let loaded: Promise<IrohModule> | undefined

/**
 * Load the native module once.
 * @returns the module namespace.
 */
function loadIroh(): Promise<IrohModule> {
  loaded ??= import('@number0/iroh')
  return loaded
}

/**
 * Generate one fresh node secret key.
 * @returns 32 key bytes.
 */
export async function generateSecretKey(): Promise<Uint8Array> {
  const iroh = await loadIroh()
  return Uint8Array.from(iroh.SecretKey.generate().toBytes())
}

/** Inputs of one iroh transport. */
export interface IrohTransportOptions {
  /** Relay URLs of the team's private relay; empty disables relaying. */
  readonly relayUrls: readonly string[]
  /** The 32-byte node secret key. */
  readonly key: Uint8Array
  /** Local bind address; absent binds every interface on an ephemeral port. */
  readonly bindAddr?: string
  /** ALPN to advertise; defaults to {@link PEER_ALPN}. */
  readonly alpn?: string
}

/**
 * Create the iroh transport for one node. The endpoint binds on the first
 * {@link PeerTransport.bind} call.
 * @param options - relay URLs, key, and optional bind address.
 * @returns the transport.
 */
export async function createIrohTransport(options: IrohTransportOptions): Promise<PeerTransport> {
  const iroh = await loadIroh()
  const alpn = [...new TextEncoder().encode(options.alpn ?? PEER_ALPN)]
  const builder = iroh.Endpoint.builder()
  iroh.presetMinimal(builder)
  builder.alpns([alpn])
  builder.relayMode(
    options.relayUrls.length === 0
      ? iroh.RelayMode.disabled()
      : iroh.RelayMode.customFromUrls([...options.relayUrls]),
  )
  builder.secretKey([...options.key])
  if (options.bindAddr !== undefined) builder.bindAddr(options.bindAddr)
  return new IrohTransport(iroh, builder, alpn, options.relayUrls.length > 0)
}

/** One bound iroh endpoint behind the transport seam. */
class IrohTransport implements PeerTransport {
  private endpoint: Endpoint | undefined
  private closed = false

  /**
   * @param iroh - the loaded native module.
   * @param builder - the configured endpoint builder.
   * @param alpn - the negotiated ALPN bytes.
   * @param requireRelay - whether a ticket must carry a relay URL.
   */
  constructor(
    private readonly iroh: IrohModule,
    private readonly builder: EndpointBuilder,
    private readonly alpn: readonly number[],
    private readonly requireRelay: boolean,
  ) {}

  /** {@inheritDoc PeerTransport.selfId} */
  selfId(): KetosPeerId {
    return brandString<KetosPeerId>(this.endpointHandle().id().toString())
  }

  /** {@inheritDoc PeerTransport.bind} */
  async bind(): Promise<void> {
    if (this.closed) throw new Error('iroh transport is closed')
    if (this.endpoint !== undefined) return
    const endpoint = await this.builder.bind()
    // `close()` may have run while the native bind was pending; it saw no
    // endpoint to close, so this call releases the one just bound.
    if (this.isClosed()) {
      await endpoint.close()
      throw new Error('iroh transport is closed')
    }
    this.endpoint = endpoint
  }

  /** {@inheritDoc PeerTransport.online} */
  async online(): Promise<void> {
    await this.endpointHandle().online()
  }

  /** {@inheritDoc PeerTransport.invitationTicket} */
  invitationTicket(): string {
    const address = this.endpointHandle().addr()
    if (this.requireRelay && address.relayUrl() === null) throw new Error('peer node has no relay address yet')
    return this.iroh.EndpointTicket.fromAddr(address).toString()
  }

  /** {@inheritDoc PeerTransport.ticketPeerId} */
  ticketPeerId(ticket: string): KetosPeerId {
    const parsed = this.iroh.EndpointTicket.fromString(ticket)
    return brandString<KetosPeerId>(parsed.endpointAddr().id().toString())
  }

  /** {@inheritDoc PeerTransport.dial} */
  async dial(ticket: string): Promise<PeerConnection> {
    const address = this.iroh.EndpointTicket.fromString(ticket).endpointAddr()
    const connection = await this.endpointHandle().connect(address, [...this.alpn])
    return wrapConnection(connection)
  }

  /** {@inheritDoc PeerTransport.accept} */
  async accept(): Promise<PeerIncoming> {
    const incoming = await this.endpointHandle().acceptNext()
    if (incoming === null) throw new Error('iroh endpoint is closed')
    return {
      complete: async () => {
        const accepting = await incoming.accept()
        return wrapConnection(await accepting.connect())
      },
    }
  }

  /** {@inheritDoc PeerTransport.close} */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.endpoint?.close()
  }

  /**
   * Whether {@link IrohTransport.close} ran; the read stops control-flow
   * narrowing from treating the flag as unchanged across an `await`.
   * @returns true after close.
   */
  private isClosed(): boolean {
    return this.closed
  }

  private endpointHandle(): Endpoint {
    if (this.endpoint === undefined) throw new Error('iroh transport is not bound')
    return this.endpoint
  }
}

/**
 * Wrap one native connection.
 * @param connection - the native connection.
 * @returns the seam connection.
 */
function wrapConnection(connection: Connection): PeerConnection {
  return {
    peerId: brandString<KetosPeerId>(connection.remoteId().toString()),
    openStream: async () => wrapStream(await connection.openBi()),
    acceptStream: async () => wrapStream(await connection.acceptBi()),
    closed: () => connection.closed(),
    close: (code, reason) => { connection.close(code, [...new TextEncoder().encode(reason)]) },
  }
}

/**
 * Wrap one native bidirectional stream.
 * @param stream - the native stream pair.
 * @returns the seam stream.
 */
function wrapStream(stream: BiStream): PeerStream {
  return {
    write: async (bytes) => { await stream.send.writeAll([...bytes]) },
    readExact: async length => Uint8Array.from(await stream.recv.readExact(length)),
    finish: async () => { await stream.send.finish() },
  }
}
