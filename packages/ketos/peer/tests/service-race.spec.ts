// Simultaneous dials between two real services over the memory transport with
// a link delay: both sides must keep the same one connection, whoever dialed
// first and whichever `bye` is lost on the way.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OwnerId } from '@ketos/board-doc/types'
import { PEER_FRAME_CODES } from '../src/frame.ts'
import { createMemoryTransports, type MemoryTransportPair } from '../src/memory-transport.ts'
import { KetosPeerService } from '../src/service.ts'
import type { PeerConnection, PeerIncoming, PeerStream, PeerTransport } from '../src/transport.ts'
import type { KetosPeerId } from '../src/types.ts'

/** One participant record the fake board document holds. */
interface StoredParticipant {
  readonly id: OwnerId
  readonly name: string
  readonly color: number
  readonly updatedAt: number
}

/** Board-document stand-in the peer service reads and writes. */
class FakeBoardDoc extends Service {
  readonly records = new Map<string, StoredParticipant>()

  /**
   * @param ctx - context the service registers `ketosBoardDoc` in.
   * @param self - the local participant id.
   */
  constructor(ctx: Context, private readonly self: string) {
    super(ctx, 'ketosBoardDoc')
  }

  /** {@inheritDoc KetosBoardDocService.selfId} */
  async selfId(): Promise<OwnerId> {
    return brandString<OwnerId>(this.self)
  }

  /** {@inheritDoc KetosBoardDocService.participants} */
  async participants(): Promise<readonly StoredParticipant[]> {
    return [...this.records.values()]
  }

  /** {@inheritDoc KetosBoardDocService.putOwnParticipant} */
  async putOwnParticipant(participant: { name: string; color: number }): Promise<void> {
    this.records.set(this.self, { id: brandString<OwnerId>(this.self), ...participant, updatedAt: Date.now() })
  }
}

/** Options of the delayed transport wrapper. */
interface DelayOptions {
  /** Delay of every write and of every close reaching the other side, in milliseconds. */
  readonly ms: number
  /** Drop every `bye` frame, as a QUIC close that wins the race with its last write does. */
  readonly dropBye?: boolean
}

/** Stream whose writes reach the other side after a delay. */
class DelayedStream implements PeerStream {
  constructor(private readonly inner: PeerStream, private readonly options: DelayOptions) {}

  write(bytes: Uint8Array): Promise<void> {
    if (this.options.dropBye === true && bytes[4] === PEER_FRAME_CODES.bye) return Promise.resolve()
    setTimeout(() => {
      this.inner.write(bytes).catch((error: unknown) => {
        // A write behind a closed connection is the delay's own race; the
        // service under test already treats that connection as gone.
        void error
      })
    }, this.options.ms)
    return Promise.resolve()
  }

  readExact(length: number): Promise<Uint8Array> {
    return this.inner.readExact(length)
  }

  finish(): Promise<void> {
    return this.inner.finish()
  }
}

/** Connection whose writes and close reach the other side after a delay. */
class DelayedConnection implements PeerConnection {
  readonly peerId: KetosPeerId

  constructor(private readonly inner: PeerConnection, private readonly options: DelayOptions) {
    this.peerId = inner.peerId
  }

  async openStream(): Promise<PeerStream> {
    return new DelayedStream(await this.inner.openStream(), this.options)
  }

  async acceptStream(): Promise<PeerStream> {
    return new DelayedStream(await this.inner.acceptStream(), this.options)
  }

  closed(): Promise<string> {
    return this.inner.closed()
  }

  close(code: bigint, reason: string): void {
    setTimeout(() => { this.inner.close(code, reason) }, this.options.ms)
  }
}

/** Memory transport whose connections carry a delay. */
class DelayedTransport implements PeerTransport {
  constructor(private readonly inner: PeerTransport, private readonly options: DelayOptions) {}

  selfId(): KetosPeerId { return this.inner.selfId() }
  bind(): Promise<void> { return this.inner.bind() }
  online(): Promise<void> { return this.inner.online() }
  invitationTicket(): string { return this.inner.invitationTicket() }
  ticketPeerId(ticket: string): KetosPeerId { return this.inner.ticketPeerId(ticket) }
  close(): Promise<void> { return this.inner.close() }

  async dial(ticket: string): Promise<PeerConnection> {
    return new DelayedConnection(await this.inner.dial(ticket), this.options)
  }

  async accept(): Promise<PeerIncoming> {
    const incoming = await this.inner.accept()
    return { complete: async () => new DelayedConnection(await incoming.complete(), this.options) }
  }
}

/** Redial pause bounds of one side, in milliseconds. */
interface Pauses {
  readonly minMs: number
  readonly maxMs: number
}

/** Short pauses: a lost link comes back within a fraction of a second. */
const FAST: Pauses = { minMs: 50, maxMs: 200 }

/** Long pauses: within a test, only the dial race itself can leave a link standing. */
const SLOW: Pauses = { minMs: 5000, maxMs: 10_000 }

/** One side of a racing pair. */
interface Side {
  readonly service: KetosPeerService
  readonly logs: string[]
}

let cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups = []
})

/**
 * Build one service over a delayed memory transport.
 * @param selfId - the participant id.
 * @param transport - this side's transport.
 * @param pauses - redial pause bounds.
 * @returns the side; its service closes after the test.
 */
async function createSide(selfId: string, transport: PeerTransport, pauses: Pauses): Promise<Side> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-peer-race-'))
  const ctx = new Context()
  new FakeBoardDoc(ctx, selfId)
  const logs: string[] = []
  const service = new KetosPeerService(ctx, {
    name: selfId,
    relayUrls: [],
    keyPath: join(root, 'peer.key'),
    peersPath: join(root, 'peers.json'),
    maxFrameBytes: 1_000_000,
    onlineTimeoutMs: 500,
    connectTimeoutMs: 500,
    reconnectMinMs: pauses.minMs,
    reconnectMaxMs: pauses.maxMs,
    inviteTtlMs: 60_000,
    stateRefreshMs: 1000,
    logger: (message) => { logs.push(message) },
    transport,
  })
  cleanups.push(() => service.close())
  return { service, logs }
}

/**
 * Wait until both sides report the other one online and stay so for a while.
 * @param left - one side.
 * @param right - the other side.
 * @param holdMs - how long both must stay online.
 * @param limitMs - how long to wait at most.
 * @returns whether both sides held the link.
 */
async function bothHoldLink(left: Side, right: Side, holdMs: number, limitMs: number): Promise<boolean> {
  const started = Date.now()
  let since: number | undefined
  while (Date.now() - started < limitMs) {
    const online = left.service.peers()[0]?.link === 'online' && right.service.peers()[0]?.link === 'online'
    if (!online) since = undefined
    else if (since === undefined) since = Date.now()
    else if (Date.now() - since >= holdMs) return true
    await new Promise((resolve) => { setTimeout(resolve, 10) })
  }
  return false
}

/**
 * Build a racing pair over one memory network.
 * @param options - the link delay.
 * @param pauses - redial pause bounds of both sides.
 * @returns both sides and the network.
 */
async function createPair(options: DelayOptions, pauses: Pauses = FAST): Promise<{ left: Side; right: Side; pair: MemoryTransportPair }> {
  const pair = createMemoryTransports()
  const left = await createSide('owner-a', new DelayedTransport(pair.a, options), pauses)
  const right = await createSide('owner-b', new DelayedTransport(pair.b, options), pauses)
  return { left, right, pair }
}

/**
 * How many times one side reported its link to the peer as ended.
 * @param side - the side.
 * @returns the number of `peer.disconnected` log lines.
 */
function disconnects(side: Side): number {
  return side.logs.filter(line => line.includes('peer.disconnected')).length
}

describe('peer dial races', () => {
  it('keeps one shared link when both sides connect with each other\'s code at the same time', async () => {
    const { left, right } = await createPair({ ms: 20 }, SLOW)
    const [codeA, codeB] = [await left.service.invite(), await right.service.invite()]
    const results = await Promise.allSettled([left.service.connect(codeB), right.service.connect(codeA)])
    expect(results.every(result => result.status === 'fulfilled')).toBe(true)
    expect(await bothHoldLink(left, right, 400, 3000)).toBe(true)
    // The kept link never ended: the losing connection closed before it was a link anywhere.
    expect([disconnects(left), disconnects(right)]).toEqual([0, 0])
  })

  it('converges on one link after every drop when both sides hold a ticket', async () => {
    const { left, right, pair } = await createPair({ ms: 20 })
    await Promise.allSettled([
      left.service.connect(await right.service.invite()),
      right.service.connect(await left.service.invite()),
    ])
    expect(await bothHoldLink(left, right, 200, 3000)).toBe(true)
    const before = [disconnects(left), disconnects(right)]
    for (let drop = 0; drop < 5; drop += 1) {
      pair.dropConnections()
      expect(await bothHoldLink(left, right, 300, 5000)).toBe(true)
    }
    // Each drop ends the one link once on each side; a racing redial never costs another.
    expect([disconnects(left) - (before[0] ?? 0), disconnects(right) - (before[1] ?? 0)]).toEqual([5, 5])
  }, 40_000)

  it('keeps the link when two connects of one side race and every bye is lost', async () => {
    const { left, right, pair } = await createPair({ ms: 20, dropBye: true }, SLOW)
    await right.service.connect(await left.service.invite())
    expect(await bothHoldLink(left, right, 100, 3000)).toBe(true)
    pair.dropConnections()
    const code = await left.service.invite()
    await Promise.allSettled([right.service.connect(code), right.service.connect(code)])
    // With redials seconds away, only a link both dials agreed on can stand now.
    expect(await bothHoldLink(left, right, 400, 2000)).toBe(true)
  }, 20_000)
})

/** Stream whose writes wait for a gate the test opens. */
class GatedStream implements PeerStream {
  constructor(private readonly inner: PeerStream, private readonly gate: Promise<void>) {}

  async write(bytes: Uint8Array): Promise<void> {
    await this.gate
    await this.inner.write(bytes)
  }

  readExact(length: number): Promise<Uint8Array> {
    return this.inner.readExact(length)
  }

  finish(): Promise<void> {
    return this.inner.finish()
  }
}

/** Transport whose next accepted connection holds its writes behind a gate. */
class GatedAcceptTransport implements PeerTransport {
  gate: Promise<void> | undefined

  constructor(private readonly inner: PeerTransport) {}

  selfId(): KetosPeerId { return this.inner.selfId() }
  bind(): Promise<void> { return this.inner.bind() }
  online(): Promise<void> { return this.inner.online() }
  invitationTicket(): string { return this.inner.invitationTicket() }
  ticketPeerId(ticket: string): KetosPeerId { return this.inner.ticketPeerId(ticket) }
  close(): Promise<void> { return this.inner.close() }
  dial(ticket: string): Promise<PeerConnection> { return this.inner.dial(ticket) }

  async accept(): Promise<PeerIncoming> {
    const incoming = await this.inner.accept()
    const gate = this.gate
    if (gate === undefined) return incoming
    return {
      complete: async () => {
        const connection = await incoming.complete()
        return {
          peerId: connection.peerId,
          openStream: async () => new GatedStream(await connection.openStream(), gate),
          acceptStream: async () => new GatedStream(await connection.acceptStream(), gate),
          closed: () => connection.closed(),
          close: (code, reason) => { connection.close(code, reason) },
        }
      },
    }
  }
}

describe('peer forget during a handshake', () => {
  it('does not let an incoming handshake that began before forget bring the peer back', async () => {
    const pair = createMemoryTransports()
    const gated = new GatedAcceptTransport(pair.a)
    const left = await createSide('owner-a', gated, FAST)
    const right = await createSide('owner-b', pair.b, FAST)
    await right.service.connect(await left.service.invite())
    expect(await bothHoldLink(left, right, 50, 3000)).toBe(true)
    const rightId = left.service.peers()[0]?.peerId as KetosPeerId
    let open: () => void = () => undefined
    gated.gate = new Promise<void>((resolve) => { open = resolve })
    pair.dropConnections()
    // The redial reaches the accept side and stops at its hello reply.
    await vi.waitFor(() => { expect(left.service.peers()[0]?.link).not.toBe('online') })
    await new Promise((resolve) => { setTimeout(resolve, 400) })
    await left.service.forget(rightId)
    open()
    await new Promise((resolve) => { setTimeout(resolve, 200) })
    expect(left.service.peers()).toEqual([])
  })
})
