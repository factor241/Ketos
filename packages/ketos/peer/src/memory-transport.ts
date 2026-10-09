/**
 * The in-memory peer transport: two connected endpoints whose connections and
 * byte streams live in the same process. Tests drive the whole channel over
 * it — framing, handshake, invitations, reconnection — without a network or
 * the native iroh module, and the raw stream pair lets a test feed a link
 * malformed bytes directly.
 * @module @ketos/peer/memory-transport
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { PeerConnection, PeerIncoming, PeerStream, PeerTransport } from './transport.ts'
import type { KetosPeerId } from './types.ts'

/** A byte channel with a reader that waits for the writer. */
class MemoryChannel {
  private readonly chunks: Uint8Array[] = []
  private buffered = 0
  private readonly waiters = new Set<() => void>()
  private ended = false

  /**
   * @param bytes - bytes to append.
   */
  push(bytes: Uint8Array): void {
    if (this.ended) throw new Error('memory stream already finished')
    if (bytes.byteLength === 0) return
    this.chunks.push(bytes)
    this.buffered += bytes.byteLength
    this.wake()
  }

  /** Mark the channel ended; readers past this point fail. */
  finish(): void {
    this.ended = true
    this.wake()
  }

  /**
   * Read exactly one byte count, waiting for the writer.
   * @param length - byte count to read.
   * @returns the bytes.
   */
  async readExact(length: number): Promise<Uint8Array> {
    while (this.buffered < length) {
      if (this.ended) throw new Error(`memory stream ended before ${String(length)} bytes`)
      await new Promise<void>((resolve) => { this.waiters.add(resolve) })
    }
    const joined = new Uint8Array(length)
    let offset = 0
    while (offset < length) {
      const chunk = this.chunks[0] as Uint8Array
      const take = Math.min(chunk.byteLength, length - offset)
      joined.set(chunk.subarray(0, take), offset)
      offset += take
      if (take === chunk.byteLength) this.chunks.shift()
      else this.chunks[0] = chunk.subarray(take)
    }
    this.buffered -= length
    return joined
  }

  private wake(): void {
    for (const resolve of [...this.waiters]) {
      this.waiters.delete(resolve)
      resolve()
    }
  }
}

/** One end of an in-memory stream pair. */
class MemoryStream implements PeerStream {
  constructor(
    private readonly inbox: MemoryChannel,
    private readonly outbox: MemoryChannel,
  ) {}

  /** {@inheritDoc PeerStream.write} */
  write(bytes: Uint8Array): Promise<void> {
    try {
      this.outbox.push(bytes)
      return Promise.resolve()
    } catch (error: unknown) {
      return Promise.reject(new Error(String(error)))
    }
  }

  /** {@inheritDoc PeerStream.readExact} */
  readExact(length: number): Promise<Uint8Array> {
    return this.inbox.readExact(length)
  }

  /** {@inheritDoc PeerStream.finish} */
  finish(): Promise<void> {
    this.outbox.finish()
    return Promise.resolve()
  }
}

/**
 * One connected in-memory stream pair, for tests that feed a link raw bytes.
 * @returns both ends; writing to one is readable from the other.
 */
export function createMemoryStreamPair(): readonly [PeerStream, PeerStream] {
  const first = new MemoryChannel()
  const second = new MemoryChannel()
  return [new MemoryStream(first, second), new MemoryStream(second, first)]
}

/** One end of an in-memory connection pair. */
class MemoryConnection implements PeerConnection {
  private closedReason: string | undefined
  private readonly closeWaiters = new Set<(reason: string) => void>()
  private readonly streams: PeerStream[] = []
  private readonly streamWaiters = new Set<{ resolve: (stream: PeerStream) => void; reject: (error: Error) => void }>()
  private peer: MemoryConnection | undefined

  /**
   * @param peerId - identity of the remote node.
   */
  constructor(readonly peerId: KetosPeerId) {}

  /** Pair this half with the other; both share the close state. */
  link(peer: MemoryConnection): void {
    this.peer = peer
  }

  /** {@inheritDoc PeerConnection.openStream} */
  openStream(): Promise<PeerStream> {
    if (this.closedReason !== undefined) return Promise.reject(new Error('connection is closed'))
    const peer = this.peer
    /* v8 ignore next -- only dial constructs and pairs a MemoryConnection before it is observable. */
    if (peer === undefined) return Promise.reject(new Error('connection is not paired'))
    const [mine, theirs] = createMemoryStreamPair()
    peer.deliver(theirs)
    return Promise.resolve(mine)
  }

  /** {@inheritDoc PeerConnection.acceptStream} */
  acceptStream(): Promise<PeerStream> {
    const stream = this.streams.shift()
    if (stream !== undefined) return Promise.resolve(stream)
    if (this.closedReason !== undefined) return Promise.reject(new Error('connection is closed'))
    return new Promise((resolve, reject) => { this.streamWaiters.add({ resolve, reject }) })
  }

  /** {@inheritDoc PeerConnection.closed} */
  closed(): Promise<string> {
    if (this.closedReason !== undefined) return Promise.resolve(this.closedReason)
    return new Promise((resolve) => { this.closeWaiters.add(resolve) })
  }

  /** {@inheritDoc PeerConnection.close} */
  close(code: bigint, reason: string): void {
    this.settle(`closed locally: ${reason} (code ${code.toString()})`)
  }

  /** Close because the transport itself shut down. */
  abort(): void {
    this.settle('transport closed')
  }

  private settle(reason: string): void {
    if (this.closedReason !== undefined) return
    this.closedReason = reason
    for (const resolve of [...this.closeWaiters]) resolve(reason)
    this.closeWaiters.clear()
    for (const waiter of [...this.streamWaiters]) {
      this.streamWaiters.delete(waiter)
      waiter.reject(new Error(reason))
    }
    this.peer?.settle(`closed by peer: ${reason}`)
  }

  private deliver(stream: PeerStream): void {
    const waiter = this.streamWaiters.values().next().value
    if (waiter !== undefined) {
      this.streamWaiters.delete(waiter)
      waiter.resolve(stream)
      return
    }
    this.streams.push(stream)
  }
}

/**
 * An incoming connection whose transport handshake already finished: the
 * in-memory transport has none.
 * @param connection - the paired connection.
 * @returns the incoming connection resolving to it.
 */
function completedIncoming(connection: MemoryConnection): PeerIncoming {
  return { complete: () => Promise.resolve(connection) }
}

/** One in-memory endpoint. */
class MemoryEndpoint implements PeerTransport {
  private bound = false
  private closed = false
  private peer: MemoryEndpoint | undefined
  private readonly accepts: MemoryConnection[] = []
  private readonly acceptWaiters = new Set<{ resolve: (connection: MemoryConnection) => void; reject: (error: Error) => void }>()
  private readonly connections = new Set<MemoryConnection>()

  /**
   * @param id - this endpoint's identity.
   * @param ticket - the ticket this endpoint is dialable by.
   */
  constructor(
    private readonly id: KetosPeerId,
    private readonly ticket: string,
  ) {}

  /** Pair the two endpoints of one memory transport. */
  link(peer: MemoryEndpoint): void {
    this.peer = peer
  }

  /** {@inheritDoc PeerTransport.selfId} */
  selfId(): KetosPeerId {
    return this.id
  }

  /** {@inheritDoc PeerTransport.bind} */
  bind(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('memory transport is closed'))
    this.bound = true
    return Promise.resolve()
  }

  /** {@inheritDoc PeerTransport.online} */
  online(): Promise<void> {
    if (!this.bound) return Promise.reject(new Error('memory transport is not bound'))
    return Promise.resolve()
  }

  /** {@inheritDoc PeerTransport.invitationTicket} */
  invitationTicket(): string {
    if (!this.bound) throw new Error('memory transport is not bound')
    return this.ticket
  }

  /** {@inheritDoc PeerTransport.ticketPeerId} */
  ticketPeerId(ticket: string): KetosPeerId {
    const peer = this.peer
    if (ticket === this.ticket) return this.id
    if (peer !== undefined && ticket === peer.ticket) return peer.id
    throw new Error(`unknown peer ticket: ${ticket}`)
  }

  /** {@inheritDoc PeerTransport.dial} */
  dial(ticket: string): Promise<PeerConnection> {
    const peer = this.peer
    if (this.closed) return Promise.reject(new Error('memory transport is closed'))
    if (peer === undefined || ticket !== peer.ticket) return Promise.reject(new Error(`unknown peer ticket: ${ticket}`))
    const dialer = new MemoryConnection(peer.id)
    const acceptor = new MemoryConnection(this.id)
    dialer.link(acceptor)
    acceptor.link(dialer)
    this.connections.add(dialer)
    peer.connections.add(acceptor)
    void dialer.closed().then(() => { this.connections.delete(dialer) })
    peer.deliverConnection(acceptor)
    return Promise.resolve(dialer)
  }

  /** {@inheritDoc PeerTransport.accept} */
  accept(): Promise<PeerIncoming> {
    const connection = this.accepts.shift()
    if (connection !== undefined) return Promise.resolve(completedIncoming(connection))
    if (this.closed) return Promise.reject(new Error('memory transport is closed'))
    return new Promise((resolve, reject) => {
      this.acceptWaiters.add({ resolve: (accepted) => { resolve(completedIncoming(accepted)) }, reject })
    })
  }

  /** {@inheritDoc PeerTransport.close} */
  close(): Promise<void> {
    if (this.closed) return Promise.resolve()
    this.closed = true
    for (const waiter of [...this.acceptWaiters]) waiter.reject(new Error('memory transport is closed'))
    this.acceptWaiters.clear()
    for (const connection of [...this.connections]) connection.abort()
    this.connections.clear()
    return Promise.resolve()
  }

  /** Drop every open connection without closing the endpoint. */
  dropConnections(): void {
    for (const connection of [...this.connections]) connection.abort()
    this.connections.clear()
  }

  private deliverConnection(connection: MemoryConnection): void {
    const waiter = this.acceptWaiters.values().next().value
    if (waiter !== undefined) {
      this.acceptWaiters.delete(waiter)
      waiter.resolve(connection)
      return
    }
    this.accepts.push(connection)
  }
}

/** The two connected endpoints of one in-memory transport plus test controls. */
export interface MemoryTransportPair {
  /** First endpoint. */
  readonly a: PeerTransport
  /** Second endpoint. */
  readonly b: PeerTransport
  /** Drop every open connection on both ends, as a network failure would. */
  dropConnections(): void
}

let memorySequence = 0

/**
 * Create a connected pair of in-memory endpoints.
 * @returns both endpoints and the connection-drop control.
 */
export function createMemoryTransports(): MemoryTransportPair {
  memorySequence += 1
  const suffix = `${String(memorySequence)}-${Math.random().toString(16).slice(2, 10)}`
  const a = new MemoryEndpoint(brandString<KetosPeerId>(`memory-a-${suffix}`), `memory:<a-${suffix}>`)
  const b = new MemoryEndpoint(brandString<KetosPeerId>(`memory-b-${suffix}`), `memory:<b-${suffix}>`)
  a.link(b)
  b.link(a)
  return {
    a,
    b,
    dropConnections: () => {
      a.dropConnections()
      b.dropConnections()
    },
  }
}
