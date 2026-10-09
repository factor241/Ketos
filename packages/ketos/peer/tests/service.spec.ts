// The peer service end to end over the in-memory transport: lazy start,
// participant publication and the color rule, the invitation handshake with
// its refusals, the known-peer file, framed send/request handling, and
// reconnection with its pause sequence.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OwnerId } from '@ketos/board-doc/types'
import { encodePeerFrame, PEER_FRAME_CODES } from '../src/frame.ts'
import { formatInvite } from '../src/invite.ts'
import { readPeerFrame, writePeerFrame } from '../src/link.ts'
import { createMemoryStreamPair, createMemoryTransports, type MemoryTransportPair } from '../src/memory-transport.ts'
import { KetosPeerService, type KetosPeerOptions } from '../src/service.ts'
import type { PeerConnection, PeerIncoming, PeerStream, PeerTransport } from '../src/transport.ts'
import type { KetosPeerId } from '../src/types.ts'

// A consumer merges its payload type into the map; this spec uses a test-only
// name so it never collides with the types the reserved codes 5-7 receive.
declare module '../src/frame.ts' {
  interface PeerFrameTypeMap {
    'ketos.test.echo': { readonly n: number }
  }
}

/** Wire code the spec registers for `ketos.test.echo`, outside the reserved range. */
const TEST_ECHO_CODE = 200

beforeAll(() => {
  (PEER_FRAME_CODES as Record<string, number>)['ketos.test.echo'] = TEST_ECHO_CODE
})

afterAll(() => {
  delete (PEER_FRAME_CODES as Record<string, number>)['ketos.test.echo']
})

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
  readonly ownWrites: { name: string; color: number }[] = []
  failWrites = false

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
    if (this.failWrites) throw new Error('participant write refused')
    this.ownWrites.push(participant)
    this.records.set(this.self, { id: brandString<OwnerId>(this.self), ...participant, updatedAt: Date.now() })
  }
}

/** Everything one side of a test channel needs. */
interface Harness {
  readonly ctx: Context
  readonly board: FakeBoardDoc
  readonly service: KetosPeerService
  readonly transport: PeerTransport
  readonly pair: MemoryTransportPair
  readonly root: string
  close(): Promise<void>
}

/** Seed colors for the fake board document. */
interface SeedParticipant {
  readonly id: string
  readonly name: string
  readonly color: number
}

/** Options of one harness. */
interface HarnessOptions {
  readonly selfId: string
  readonly name?: string
  readonly pair?: MemoryTransportPair
  readonly transport?: PeerTransport
  readonly boardSeed?: readonly SeedParticipant[]
  readonly reconnectMinMs?: number
  readonly reconnectMaxMs?: number
  readonly connectTimeoutMs?: number
  readonly onlineTimeoutMs?: number
  readonly inviteTtlMs?: number
  readonly logger?: (message: string) => void
}

let cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups = []
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/**
 * Build one service over a memory transport with a fake board document.
 * @param options - identity, transport, seeds, and bounds.
 * @returns the harness; its `close` is also run by the after-each hook.
 */
async function createHarness(options: HarnessOptions): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-peer-service-'))
  const ctx = new Context()
  const board = new FakeBoardDoc(ctx, options.selfId)
  for (const seed of options.boardSeed ?? []) {
    board.records.set(seed.id, {
      id: brandString<OwnerId>(seed.id),
      name: seed.name,
      color: seed.color,
      updatedAt: 0,
    })
  }
  const pair = options.pair ?? createMemoryTransports()
  const transport = options.transport ?? pair.a
  const peerOptions: KetosPeerOptions = {
    name: options.name ?? 'Кирилл',
    relayUrls: [],
    keyPath: join(root, 'peer.key'),
    peersPath: join(root, 'peers.json'),
    maxFrameBytes: 1_000_000,
    onlineTimeoutMs: options.onlineTimeoutMs ?? 500,
    connectTimeoutMs: options.connectTimeoutMs ?? 500,
    reconnectMinMs: options.reconnectMinMs ?? 50,
    reconnectMaxMs: options.reconnectMaxMs ?? 200,
    inviteTtlMs: options.inviteTtlMs ?? 60_000,
    stateRefreshMs: 1000,
    logger: options.logger ?? (() => undefined),
    transport,
  }
  const service = new KetosPeerService(ctx, peerOptions)
  const close = async (): Promise<void> => {
    await service.close()
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
  cleanups.push(close)
  return { ctx, board, service, transport, pair, root, close }
}

/**
 * Build a connected pair of harnesses sharing one memory transport.
 * @param leftSelf - left board identity.
 * @param rightSelf - right board identity.
 * @returns both harnesses.
 */
async function createPair(leftSelf = 'owner-a', rightSelf = 'owner-b'): Promise<readonly [Harness, Harness]> {
  const pair = createMemoryTransports()
  const left = await createHarness({ selfId: leftSelf, name: 'Кирилл', pair, transport: pair.a })
  const right = await createHarness({ selfId: rightSelf, name: 'Юрист', pair, transport: pair.b })
  return [left, right]
}

/**
 * Open a raw connection to a service, send a `hello`, and read the reply, as
 * a known peer's redial does.
 * @param transport - the dialing endpoint.
 * @param ticket - ticket of the service's endpoint.
 * @returns the open connection and its stream.
 */
async function dialAndHello(
  transport: PeerTransport,
  ticket: string,
): Promise<{ connection: PeerConnection; stream: PeerStream }> {
  const connection = await transport.dial(ticket)
  const stream = await connection.openStream()
  await writePeerFrame(stream, PEER_FRAME_CODES.hello, { v: 2, selfId: 'owner-b', name: 'Юрист', color: 2 })
  await readPeerFrame(stream, 4096)
  return { connection, stream }
}

/** A transport whose configured step fails, to drive error branches. */
class StubTransport implements PeerTransport {
  onlineError: unknown
  ticketError: unknown
  dialError: unknown
  bindError: unknown
  bindGate: Promise<void> | undefined
  bindCalls = 0
  closeCalls = 0
  dialCalls = 0
  readonly dialTimes: number[] = []
  readonly ticket = 'memory:<stub>'
  readonly id = brandString<KetosPeerId>('stub-self')

  /** {@inheritDoc PeerTransport.selfId} */
  selfId(): KetosPeerId { return this.id }
  /** {@inheritDoc PeerTransport.bind} */
  async bind(): Promise<void> {
    this.bindCalls += 1
    await this.bindGate
    if (this.bindError !== undefined) throw this.bindError
  }
  /** {@inheritDoc PeerTransport.online} */
  async online(): Promise<void> {
    if (this.onlineError !== undefined) throw this.onlineError
  }
  /** {@inheritDoc PeerTransport.invitationTicket} */
  invitationTicket(): string {
    if (this.ticketError !== undefined) throw this.ticketError
    return this.ticket
  }
  /** {@inheritDoc PeerTransport.ticketPeerId} */
  ticketPeerId(): KetosPeerId {
    return brandString<KetosPeerId>('stub-peer')
  }
  /** {@inheritDoc PeerTransport.dial} */
  async dial(): Promise<PeerConnection> {
    this.dialCalls += 1
    this.dialTimes.push(Date.now())
    if (this.dialError !== undefined) throw this.dialError
    throw new Error('stub dial is not connected')
  }
  /** {@inheritDoc PeerTransport.accept} */
  accept(): Promise<PeerIncoming> {
    return Promise.reject(new Error('stub accept is not connected'))
  }
  /** {@inheritDoc PeerTransport.close} */
  async close(): Promise<void> {
    this.closeCalls += 1
  }
}

describe('peer service start and participants', () => {
  it('starts lazily and publishes the local participant with the first free color', async () => {
    const harness = await createHarness({
      selfId: 'owner-a',
      boardSeed: [{ id: 'owner-x', name: 'X', color: 1 }, { id: 'owner-y', name: 'Y', color: 3 }],
    })
    expect(harness.board.ownWrites).toEqual([])
    const state = await harness.service.state()
    expect(state.self).toEqual({ selfId: 'owner-a', name: 'Кирилл', color: 2 })
    expect(state.peers).toEqual([])
    expect(state.refreshMs).toBe(1000)
    expect(harness.board.records.get('owner-a')?.color).toBe(2)
  })

  it('counts a known peer color when choosing the local one', async () => {
    const harness = await createHarness({ selfId: 'owner-a' })
    await writeFile(join(harness.root, 'peers.json'), JSON.stringify([{
      peerId: 'peer-x', selfId: 'owner-x', name: 'X', color: 1, lastSeen: '2026-10-07T00:00:00.000Z',
    }]))
    const state = await harness.service.state()
    expect(state.self.color).toBe(2)
    expect(state.peers[0]?.link).toBe('lost')
  })

  it('reports the node identity and rejects calls after close', async () => {
    const harness = await createHarness({ selfId: 'owner-a' })
    expect(String(await harness.service.nodeId())).toBe(String(harness.transport.selfId()))
    await harness.service.close()
    await expect(harness.service.ensureStarted()).rejects.toThrow(/already closed/u)
  })

  it('retries a failed start instead of caching the failure', async () => {
    const transport = new StubTransport()
    transport.bindError = new Error('bind failed')
    const harness = await createHarness({ selfId: 'owner-a', transport })
    await expect(harness.service.ensureStarted()).rejects.toThrow(/bind failed/u)
    transport.bindError = undefined
    await harness.service.ensureStarted()
    expect(transport.bindCalls).toBe(2)
  })

  it('closes the transport of a start that failed when the service closes', async () => {
    const transport = new StubTransport()
    transport.bindError = new Error('bind failed')
    const harness = await createHarness({ selfId: 'owner-a', transport })
    await expect(harness.service.ensureStarted()).rejects.toThrow(/bind failed/u)
    expect(transport.closeCalls).toBe(0)
    await harness.service.close()
    expect(transport.closeCalls).toBe(1)
  })

  it('starts with known peers only when the file names someone', async () => {
    const harness = await createHarness({ selfId: 'owner-a' })
    await harness.service.startIfKnownPeers()
    expect(() => harness.transport.invitationTicket()).toThrow(/not bound/u)
    await writeFile(join(harness.root, 'peers.json'), JSON.stringify([{
      peerId: 'peer-x', selfId: 'owner-x', name: 'X', color: 2,
      ticket: 'memory:<x>', lastSeen: '2026-10-07T00:00:00.000Z',
    }]))
    await harness.service.startIfKnownPeers()
    expect(harness.service.peers()).toHaveLength(1)
    expect(harness.service.peers()[0]?.link).toBe('lost')
    expect(() => harness.transport.invitationTicket()).not.toThrow()
  })
})

describe('peer service invitation handshake', () => {
  it('connects a second Ketos by code and keeps both sides known', async () => {
    const [left, right] = await createPair()
    const connected: KetosPeerId[] = []
    left.ctx.on('ketos-peer/connected', (event) => { connected.push(event.peerId) })
    const code = await left.service.invite()
    expect(code.startsWith('ketos1.')).toBe(true)
    const answer = await right.service.connect(code)
    expect(String(answer.peerId)).toBe(String(left.transport.selfId()))
    await vi.waitFor(() => { expect(left.service.peers()[0]?.link).toBe('online') })
    await vi.waitFor(() => { expect(right.service.peers()[0]?.link).toBe('online') })
    expect(left.service.peers()[0]?.selfId).toBe('owner-b')
    expect(right.service.peers()[0]?.selfId).toBe('owner-a')
    expect(connected).toHaveLength(1)
    const leftRecords = JSON.parse(await readPeers(left.root)) as { peerId: string; ticket?: string }[]
    const rightRecords = JSON.parse(await readPeers(right.root)) as { peerId: string; ticket?: string }[]
    expect(leftRecords[0]?.peerId).toBe(String(right.transport.selfId()))
    expect(leftRecords[0]?.ticket).toBeUndefined()
    expect(rightRecords[0]?.peerId).toBe(String(left.transport.selfId()))
    expect(rightRecords[0]?.ticket).toBe(left.transport.invitationTicket())
  })

  it('refuses malformed, foreign, and own codes', async () => {
    const [left, right] = await createPair()
    await left.service.ensureStarted()
    await expect(right.service.connect('nonsense')).rejects.toMatchObject({ code: 'ketos/invalid' })
    const secret = 'abcdefghijklmnopqrstuvwxyz'
    await expect(right.service.connect(formatInvite('memory:<nobody>', secret)))
      .rejects.toMatchObject({ code: 'ketos/invalid' })
    const own = await right.service.invite()
    await expect(right.service.connect(own)).rejects.toMatchObject({ code: 'ketos/peer-self' })
    expect(left.service.peers()).toEqual([])
  })

  it('refuses an unknown node whose secret is wrong or absent, then accepts the known redial', async () => {
    const [left, right] = await createPair()
    await left.service.ensureStarted()
    const wrong = formatInvite(left.transport.invitationTicket(), 'zzzzzzzzzzzzzzzzzzzzzzzzzz')
    await expect(right.service.connect(wrong)).rejects.toMatchObject({ code: 'ketos/invite-used' })
    expect(left.service.peers()).toEqual([])

    const code = await left.service.invite()
    await right.service.connect(code)
    await vi.waitFor(() => { expect(left.service.peers()[0]?.link).toBe('online') })
    right.pair.dropConnections()
    await vi.waitFor(() => { expect(right.service.peers()[0]?.link).toBe('online') })
    await vi.waitFor(() => { expect(left.service.peers()[0]?.link).toBe('online') })
  })

  it('answers a second connect with the same code with invite-used and no duplicate', async () => {
    const [left, right] = await createPair()
    const code = await left.service.invite()
    await right.service.connect(code)
    await expect(right.service.connect(code)).rejects.toMatchObject({ code: 'ketos/invite-used' })
    expect(left.service.peers()).toHaveLength(1)
    expect(right.service.peers()).toHaveLength(1)
  })

  it('maps a failed dial to peer-unreachable and a missing relay to peer-offline', async () => {
    const dialer = new StubTransport()
    dialer.dialError = new Error('no route')
    const right = await createHarness({ selfId: 'owner-b', transport: dialer })
    const [left] = await createPair()
    await left.service.ensureStarted()
    const code = formatInvite(left.transport.invitationTicket(), 'abcdefghijklmnopqrstuvwxyz')
    await expect(right.service.connect(code)).rejects.toMatchObject({ code: 'ketos/peer-unreachable' })

    const offline = new StubTransport()
    offline.onlineError = new Error('relay down')
    const waiting = await createHarness({ selfId: 'owner-c', transport: offline })
    await expect(waiting.service.invite()).rejects.toMatchObject({ code: 'ketos/peer-offline' })
    offline.onlineError = undefined
    offline.ticketError = new Error('no relay address')
    await expect(waiting.service.invite()).rejects.toMatchObject({ code: 'ketos/peer-offline' })
  })

  it('replaces the live channel when the same known peer connects again', async () => {
    const logs: string[] = []
    const pair = createMemoryTransports()
    const left = await createHarness({ selfId: 'owner-a', pair, transport: pair.a, logger: (message) => { logs.push(message) } })
    await writeFile(join(left.root, 'peers.json'), JSON.stringify([{
      peerId: String(pair.b.selfId()), selfId: 'owner-b', name: 'Юрист', color: 2, lastSeen: '2026-10-07T00:00:00.000Z',
    }]))
    await left.service.ensureStarted()
    await pair.b.bind()
    const connected: unknown[] = []
    const disconnected: unknown[] = []
    left.ctx.on('ketos-peer/connected', (event) => { connected.push(event) })
    left.ctx.on('ketos-peer/disconnected', (event) => { disconnected.push(event) })

    const first = await dialAndHello(pair.b, pair.a.invitationTicket())
    await vi.waitFor(() => { expect(left.service.peers()[0]?.link).toBe('online') })
    // The first connection is dead on the far side; the peer redials.
    const second = await dialAndHello(pair.b, pair.a.invitationTicket())

    await expect(first.connection.closed()).resolves.toMatch(/replaced.*\(code 5\)/u)
    await vi.waitFor(() => { expect(connected).toHaveLength(2) })
    expect(disconnected).toHaveLength(1)
    expect(left.service.peers()[0]?.link).toBe('online')
    expect(logs.some(line => line.includes('peer.replaced'))).toBe(true)
    const secondState = await Promise.race([
      second.connection.closed(),
      new Promise<string>((resolve) => { setTimeout(() => { resolve('open') }, 50) }),
    ])
    expect(secondState).toBe('open')
  })

  it('lets the newer of two racing dials of this node replace the older link, closing it with code 5', async () => {
    const rogue = new RogueDialTransport(async (stream) => {
      await readPeerFrame(stream, 1_000_000)
      await writePeerFrame(stream, PEER_FRAME_CODES.hello, { v: 2, selfId: 'owner-a', name: 'Кирилл', color: 1 })
    })
    const harness = await createHarness({ selfId: 'owner-b', transport: rogue })
    const connected: unknown[] = []
    harness.ctx.on('ketos-peer/connected', (event) => { connected.push(event) })
    const code = formatInvite('memory:<rogue>', 'abcdefghijklmnopqrstuvwxyz')

    // Both calls pass the pre-dial check before either handshake attaches, so
    // the second attach meets the live link of the first. Same dialer: the
    // newer connection wins on both ends, as the accepting side also keeps it.
    const [first, second] = await Promise.all([
      harness.service.connect(code),
      harness.service.connect(code),
    ])

    expect(String(first.peerId)).toBe('rogue-peer')
    expect(String(second.peerId)).toBe('rogue-peer')
    await vi.waitFor(() => { expect(rogue.closes.filter(close => close.code === 5n)).toEqual([{ code: 5n, reason: 'replaced' }]) })
    expect(rogue.closes.filter(close => close.code === 3n)).toEqual([])
    expect(harness.service.peers()).toHaveLength(1)
    expect(harness.service.peers()[0]?.link).toBe('online')
    expect(connected).toHaveLength(2)
  })
})

/** Wraps a transport so its first accept fails, like an incoming handshake that breaks. */
class FailFirstAcceptTransport implements PeerTransport {
  private failed = false

  /**
   * @param inner - the transport every other call delegates to.
   */
  constructor(private readonly inner: PeerTransport) {}

  /** {@inheritDoc PeerTransport.selfId} */
  selfId(): KetosPeerId { return this.inner.selfId() }
  /** {@inheritDoc PeerTransport.bind} */
  bind(): Promise<void> { return this.inner.bind() }
  /** {@inheritDoc PeerTransport.online} */
  online(): Promise<void> { return this.inner.online() }
  /** {@inheritDoc PeerTransport.invitationTicket} */
  invitationTicket(): string { return this.inner.invitationTicket() }
  /** {@inheritDoc PeerTransport.ticketPeerId} */
  ticketPeerId(ticket: string): KetosPeerId { return this.inner.ticketPeerId(ticket) }
  /** {@inheritDoc PeerTransport.dial} */
  dial(ticket: string): Promise<PeerConnection> { return this.inner.dial(ticket) }
  /** {@inheritDoc PeerTransport.accept} */
  accept(): Promise<PeerIncoming> {
    if (this.failed) return this.inner.accept()
    this.failed = true
    return Promise.resolve({ complete: () => Promise.reject(new Error('incoming handshake broke')) })
  }
  /** {@inheritDoc PeerTransport.close} */
  close(): Promise<void> { return this.inner.close() }
}

describe('peer service disposal during start and handshakes', () => {
  it('waits for a start in flight before closing the transport', async () => {
    const transport = new StubTransport()
    let release: () => void = () => undefined
    transport.bindGate = new Promise<void>((resolve) => { release = resolve })
    const harness = await createHarness({ selfId: 'owner-a', transport })
    const starting = harness.service.ensureStarted()
    starting.catch(() => undefined)
    await vi.waitFor(() => { expect(transport.bindCalls).toBe(1) })

    let closed = false
    const closing = harness.service.close().then(() => { closed = true })
    await new Promise((resolve) => { setTimeout(resolve, 30) })
    expect(closed).toBe(false)
    expect(transport.closeCalls).toBe(0)

    release()
    await closing
    await expect(starting).rejects.toThrow(/already closed/u)
    expect(transport.closeCalls).toBe(1)
    expect(harness.board.ownWrites).toEqual([])
  })

  it('refuses to attach a dialed channel after the service closed', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const rogue = new RogueDialTransport(async (stream) => {
      await readPeerFrame(stream, 1_000_000)
      await gate
      await writePeerFrame(stream, PEER_FRAME_CODES.hello, { v: 2, selfId: 'owner-a', name: 'Кирилл', color: 1 })
    })
    const harness = await createHarness({ selfId: 'owner-b', transport: rogue })
    const connected: unknown[] = []
    harness.ctx.on('ketos-peer/connected', (event) => { connected.push(event) })
    const connecting = harness.service.connect(formatInvite('memory:<rogue>', 'abcdefghijklmnopqrstuvwxyz'))
    connecting.catch(() => undefined)
    await vi.waitFor(() => { expect(rogue.dialCalls).toBe(1) })
    await harness.service.close()
    release()
    await expect(connecting).rejects.toMatchObject({ code: 'ketos/peer-offline' })
    expect(connected).toEqual([])
    expect(harness.service.peers()).toEqual([])
    expect(rogue.closes).toHaveLength(1)
    await expect(readPeers(harness.root)).rejects.toThrow(/ENOENT/u)
  })

  it('refuses to attach a dialed channel when the service closes while the peer file is written', async () => {
    let closeService: () => void = () => undefined
    const pair = createMemoryTransports()
    const left = await createHarness({ selfId: 'owner-a', name: 'Кирилл', pair, transport: pair.a })
    const right = await createHarness({
      selfId: 'owner-b', name: 'Юрист', pair, transport: pair.b,
      logger: (message) => { if (message.includes('known-peer file write failed')) closeService() },
    })
    closeService = () => { void right.service.close() }
    const connected: unknown[] = []
    right.ctx.on('ketos-peer/connected', (event) => { connected.push(event) })
    const code = await left.service.invite()
    await right.service.ensureStarted()
    // A directory in place of the file makes the write after the hello fail,
    // and the failure log closes the service between the write and the attach.
    await mkdir(join(right.root, 'peers.json'))

    await expect(right.service.connect(code)).rejects.toMatchObject({ code: 'ketos/peer-offline' })
    expect(connected).toEqual([])
    expect(right.service.peers().map(state => state.link)).not.toContain('online')
  })

  it('closes an accepted channel quietly when the service closed during its handshake', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const hello = encodePeerFrame(PEER_FRAME_CODES.hello, { v: 2, selfId: 'owner-a', name: 'Кирилл', color: 1 })
    const transport = new RogueAcceptTransport(hello, gate)
    const logs: string[] = []
    const harness = await createHarness({ selfId: 'owner-b', transport, logger: (message) => { logs.push(message) } })
    await writeFile(join(harness.root, 'peers.json'), JSON.stringify([{
      peerId: 'rogue-peer', selfId: 'owner-a', name: 'Кирилл', color: 1, lastSeen: '2026-10-07T00:00:00.000Z',
    }]))
    const connected: unknown[] = []
    harness.ctx.on('ketos-peer/connected', (event) => { connected.push(event) })
    await harness.service.ensureStarted()
    await harness.service.close()
    release()
    await vi.waitFor(() => { expect(transport.closes).toEqual([{ code: 0n, reason: 'shutdown' }]) })
    expect(connected).toEqual([])
    expect(logs.filter(line => line.includes('handshake from'))).toEqual([])
  })
})

describe('peer accept loop', () => {
  it('keeps accepting after one incoming handshake fails', async () => {
    const logs: string[] = []
    const pair = createMemoryTransports()
    const left = await createHarness({
      selfId: 'owner-a', name: 'Кирилл', pair, transport: new FailFirstAcceptTransport(pair.a),
      logger: (message) => { logs.push(message) },
    })
    const right = await createHarness({ selfId: 'owner-b', name: 'Юрист', pair, transport: pair.b })
    const code = await left.service.invite()
    await right.service.connect(code)
    await vi.waitFor(() => { expect(left.service.peers()[0]?.link).toBe('online') })
    expect(logs.some(line => line.includes('incoming handshake broke'))).toBe(true)
  })
})

describe('peer accept loop after a refused stranger', () => {
  it('keeps accepting after an unknown node sends a first frame that is not hello', async () => {
    const [left, right] = await createPair()
    const code = await left.service.invite()
    await right.service.ensureStarted()
    const stranger = await right.transport.dial(left.transport.invitationTicket())
    const strangerStream = await stranger.openStream()
    await writePeerFrame(strangerStream, PEER_FRAME_CODES.bye, { reason: 'not a hello' })
    await expect(stranger.closed()).resolves.toContain('(code 2)')

    await right.service.connect(code)
    await vi.waitFor(() => { expect(left.service.peers()[0]?.link).toBe('online') })
  })

  it('keeps accepting after an unknown node presents no secret', async () => {
    const [left, right] = await createPair()
    const code = await left.service.invite()
    await right.service.ensureStarted()
    const stranger = await right.transport.dial(left.transport.invitationTicket())
    const strangerStream = await stranger.openStream()
    await writePeerFrame(strangerStream, PEER_FRAME_CODES.hello, { v: 2, selfId: 'owner-z', name: 'Z', color: 3 })
    await expect(stranger.closed()).resolves.toContain('(code 1)')

    await right.service.connect(code)
    await vi.waitFor(() => { expect(left.service.peers()[0]?.link).toBe('online') })
  })
})

describe('peer framed messages', () => {
  it('delivers messages to every handler and answers the first handler for requests', async () => {
    const [left, right] = await createPair()
    const code = await left.service.invite()
    await right.service.connect(code)
    const leftId = await left.service.nodeId()
    const seen: { payload: unknown; from: KetosPeerId }[] = []
    left.service.handle('ketos.test.echo', (payload, from) => { seen.push({ payload, from }); return { first: payload.n } })
    left.service.handle('ketos.test.echo', (payload) => { seen.push({ payload, from: right.transport.selfId() }); return { second: true } })
    await right.service.send(leftId, 'ketos.test.echo', { n: 7 })
    await vi.waitFor(() => { expect(seen).toHaveLength(2) })
    expect(seen[0]?.payload).toEqual({ n: 7 })
    const response = await right.service.request(leftId, 'ketos.test.echo', { n: 8 }, { timeoutMs: 500 })
    expect(response).toEqual({ first: 8 })
    await vi.waitFor(() => { expect(seen).toHaveLength(4) })
  })

  it('runs every handler when an earlier one throws and logs a later one that rejects', async () => {
    const logs: string[] = []
    const pair = createMemoryTransports()
    const left = await createHarness({ selfId: 'owner-a', pair, transport: pair.a, logger: (message) => { logs.push(message) } })
    const right = await createHarness({ selfId: 'owner-b', name: 'Юрист', pair, transport: pair.b })
    await right.service.connect(await left.service.invite())
    const leftId = await left.service.nodeId()
    const seen: number[] = []
    left.service.handle('ketos.test.echo', () => { throw new Error('first handler threw') })
    left.service.handle('ketos.test.echo', () => { throw 'second handler threw' })
    left.service.handle('ketos.test.echo', async () => { throw new Error('third handler rejected') })
    left.service.handle('ketos.test.echo', (payload) => { seen.push(payload.n) })
    await right.service.send(leftId, 'ketos.test.echo', { n: 1 })
    await vi.waitFor(() => { expect(seen).toEqual([1]) })
    await vi.waitFor(() => { expect(logs.some(line => line.includes('third handler rejected'))).toBe(true) })
    expect(logs.some(line => line.includes('first handler threw'))).toBe(true)
    expect(logs.some(line => line.includes('second handler threw'))).toBe(true)
  })

  it('answers a request with the first handler and logs a later handler that rejects', async () => {
    const logs: string[] = []
    const pair = createMemoryTransports()
    const left = await createHarness({ selfId: 'owner-a', pair, transport: pair.a, logger: (message) => { logs.push(message) } })
    const right = await createHarness({ selfId: 'owner-b', name: 'Юрист', pair, transport: pair.b })
    await right.service.connect(await left.service.invite())
    const leftId = await left.service.nodeId()
    left.service.handle('ketos.test.echo', payload => ({ first: payload.n }))
    left.service.handle('ketos.test.echo', async () => { throw new Error('later handler rejected') })
    await expect(right.service.request(leftId, 'ketos.test.echo', { n: 3 }, { timeoutMs: 500 })).resolves.toEqual({ first: 3 })
    await vi.waitFor(() => { expect(logs.some(line => line.includes('later handler rejected'))).toBe(true) })
  })

  it('uses the connect timeout when a request names none', async () => {
    const [left, right] = await createPair()
    const code = await left.service.invite()
    await right.service.connect(code)
    const leftId = await left.service.nodeId()
    left.service.handle('ketos.test.echo', payload => payload)
    await expect(right.service.request(leftId, 'ketos.test.echo', { n: 9 })).resolves.toEqual({ n: 9 })
  })

  it('times out an unanswered request and surfaces a handler error', async () => {
    const [left, right] = await createPair()
    const code = await left.service.invite()
    await right.service.connect(code)
    const leftId = await left.service.nodeId()
    await expect(right.service.request(leftId, 'ketos.test.echo', { n: 1 }, { timeoutMs: 50 }))
      .rejects.toThrow(/timed out/u)
    const unsubscribe = left.service.handle('ketos.test.echo', () => { throw new Error('handler exploded') })
    await expect(right.service.request(leftId, 'ketos.test.echo', { n: 2 }, { timeoutMs: 500 }))
      .rejects.toThrow(/handler exploded/u)
    unsubscribe()
    await expect(right.service.send(brandString<KetosPeerId>('nobody'), 'ketos.test.echo', { n: 1 }))
      .rejects.toThrow(/not connected/u)
    await expect(right.service.request(brandString<KetosPeerId>('nobody'), 'ketos.test.echo', { n: 1 }))
      .rejects.toThrow(/not connected/u)
  })
})

describe('peer participant color rule', () => {
  it('rewrites the larger selfId to the next free color and leaves the other side alone', async () => {
    const [left, right] = await createPair('owner-a', 'owner-b')
    const code = await left.service.invite()
    await right.service.connect(code)
    await vi.waitFor(() => { expect(left.service.peers()[0]?.color).toBe(2) })
    const leftState = await left.service.state()
    const rightState = await right.service.state()
    expect(leftState.self.color).toBe(1)
    expect(rightState.self.color).toBe(2)
    expect(rightState.peers[0]?.color).toBe(1)
    expect(leftState.peers[0]?.color).toBe(2)
    expect(left.board.records.get('owner-a')?.color).toBe(1)
    expect(right.board.records.get('owner-b')?.color).toBe(2)
    expect(right.board.records.has('owner-a')).toBe(false)
    expect(left.board.records.has('owner-b')).toBe(false)
  })
})

describe('peer reconnection', () => {
  it('reconnects the dialing side after a drop without a new code', async () => {
    const [left, right] = await createPair()
    const code = await left.service.invite()
    await right.service.connect(code)
    await vi.waitFor(() => { expect(right.service.peers()[0]?.link).toBe('online') })
    right.pair.dropConnections()
    await vi.waitFor(() => { expect(right.service.peers()[0]?.link).toBe('online') }, { timeout: 3000 })
    await vi.waitFor(() => { expect(left.service.peers()[0]?.link).toBe('online') }, { timeout: 3000 })
  })

  it('doubles the pause between failed attempts and cancels on close', async () => {
    vi.useFakeTimers()
    const [left, right] = await createPair()
    const realDial = right.transport.dial.bind(right.transport)
    const attempts: number[] = []
    let failures = 0
    vi.spyOn(right.transport, 'dial').mockImplementation(async (ticket: string) => {
      attempts.push(Date.now())
      if (failures > 0) {
        failures -= 1
        throw new Error('dial refused')
      }
      return realDial(ticket)
    })
    const code = await left.service.invite()
    await right.service.connect(code)
    expect(right.service.peers()[0]?.link).toBe('online')
    attempts.length = 0
    failures = 2
    right.pair.dropConnections()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(60)
    expect(attempts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(120)
    expect(attempts).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(240)
    expect(attempts).toHaveLength(3)
    expect(attempts[1]! - attempts[0]!).toBeGreaterThanOrEqual(80)
    expect(attempts[1]! - attempts[0]!).toBeLessThanOrEqual(120)
    expect(attempts[2]! - attempts[1]!).toBeGreaterThanOrEqual(160)
    expect(attempts[2]! - attempts[1]!).toBeLessThanOrEqual(240)
    vi.useRealTimers()
    await vi.waitFor(() => { expect(right.service.peers()[0]?.link).toBe('online') }, { timeout: 2000 })
  })

  /**
   * Build a left/right pair where the left side closes every channel the
   * moment it opens, as a synchronization update over the bound does, and
   * record when the right side lost each channel and when it redialed. The
   * pause before a redial is the redial time minus the loss time on the fake
   * clock, independent of how long the handshake's file writes take.
   * @param logs - receives the right side's log lines.
   * @param stableAtAttempt - the redial count at which the left side stops closing.
   * @returns both harnesses and the recorded times.
   */
  async function createClosingPair(logs: string[], stableAtAttempt = Infinity): Promise<{
    right: Harness
    attempts: number[]
    lostAt: number[]
  }> {
    vi.useFakeTimers()
    const pair = createMemoryTransports()
    // The handshake's file writes finish on the real clock while the fake clock
    // runs ahead, so the handshake bound must not expire under test load.
    const left = await createHarness({
      selfId: 'owner-a', name: 'Кирилл', pair, transport: pair.a, connectTimeoutMs: 60_000,
    })
    const right = await createHarness({
      selfId: 'owner-b', name: 'Юрист', pair, transport: pair.b, connectTimeoutMs: 60_000,
      logger: (message) => { logs.push(message) },
    })
    let closing = true
    left.ctx.on('ketos-peer/connected', (event) => {
      if (closing) left.service.closeSyncTooLarge(event.peerId)
    })
    const lostAt: number[] = []
    right.ctx.on('ketos-peer/disconnected', () => { lostAt.push(Date.now()) })
    const realDial = right.transport.dial.bind(right.transport)
    const attempts: number[] = []
    vi.spyOn(right.transport, 'dial').mockImplementation(async (ticket: string) => {
      attempts.push(Date.now())
      if (attempts.length === stableAtAttempt) closing = false
      return realDial(ticket)
    })
    await right.service.connect(await left.service.invite())
    attempts.length = 0
    return { right, attempts, lostAt }
  }

  /**
   * Advance fake time until the right side redialed a number of times.
   * @param attempts - dial timestamps.
   * @param count - redials to wait for.
   */
  async function advanceUntilAttempts(attempts: readonly number[], count: number): Promise<void> {
    for (let elapsed = 0; elapsed < 5000 && attempts.length < count; elapsed += 5) {
      await vi.advanceTimersByTimeAsync(5)
    }
    expect(attempts).toHaveLength(count)
  }

  /**
   * Advance fake time until the harness reports its peer online; the
   * handshake's file writes finish on the real clock, so the link opens a few
   * fake steps after the redial.
   * @param harness - the dialing side.
   */
  async function advanceUntilOnline(harness: Harness): Promise<void> {
    for (let elapsed = 0; elapsed < 5000 && harness.service.peers()[0]?.link !== 'online'; elapsed += 5) {
      await vi.advanceTimersByTimeAsync(5)
    }
    expect(harness.service.peers()[0]?.link).toBe('online')
  }

  it('doubles the pause while every new channel closes right after it opened', async () => {
    const logs: string[] = []
    const { attempts, lostAt } = await createClosingPair(logs)
    await advanceUntilAttempts(attempts, 4)
    const pauses = attempts.map((time, index) => time - (lostAt[index] as number))
    // Nominal pauses 50, 100, 200, 200 (ceiling) with ±20% jitter, never above 200.
    expect(pauses[0]).toBeGreaterThanOrEqual(40)
    expect(pauses[0]).toBeLessThanOrEqual(60)
    expect(pauses[1]).toBeGreaterThanOrEqual(80)
    expect(pauses[1]).toBeLessThanOrEqual(120)
    expect(pauses[2]).toBeGreaterThanOrEqual(160)
    expect(pauses[2]).toBeLessThanOrEqual(200)
    expect(pauses[3]).toBeGreaterThanOrEqual(160)
    expect(pauses[3]).toBeLessThanOrEqual(200)
    expect(logs.filter(line => line.includes('peer.flapping')).length).toBeGreaterThanOrEqual(3)
  })

  it('returns to the first pause once a channel lived as long as reconnectMaxMs', async () => {
    const logs: string[] = []
    const { right, attempts, lostAt } = await createClosingPair(logs, 3)
    // Attempts 1 and 2 open channels that close at once; attempt 3 stays open.
    await advanceUntilAttempts(attempts, 3)
    await advanceUntilOnline(right)
    await vi.advanceTimersByTimeAsync(250)
    const flappingBefore = logs.filter(line => line.includes('peer.flapping')).length
    right.pair.dropConnections()
    await advanceUntilAttempts(attempts, 4)
    const pause = attempts[3]! - lostAt[3]!
    expect(pause).toBeGreaterThanOrEqual(40)
    expect(pause).toBeLessThanOrEqual(60)
    expect(logs.filter(line => line.includes('peer.flapping'))).toHaveLength(flappingBefore)
  })

  it('never pauses longer than reconnectMaxMs, jitter included', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.999)
    const transport = new StubTransport()
    transport.dialError = new Error('disabled network')
    const harness = await createHarness({ selfId: 'owner-a', transport })
    await writeFile(join(harness.root, 'peers.json'), JSON.stringify([{
      peerId: 'peer-x', selfId: 'owner-x', name: 'X', color: 2,
      ticket: 'memory:<x>', lastSeen: '2026-10-07T00:00:00.000Z',
    }]))
    await harness.service.ensureStarted()
    await vi.advanceTimersByTimeAsync(1500)
    const gaps = transport.dialTimes.slice(1).map((time, index) => time - (transport.dialTimes[index] as number))
    expect(gaps.length).toBeGreaterThanOrEqual(4)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(200)
    expect(gaps.at(-1)).toBe(200)
  })

  it('cancels pending attempts when the plugin unloads', async () => {
    vi.useFakeTimers()
    const transport = new StubTransport()
    transport.dialError = new Error('disabled network')
    const harness = await createHarness({ selfId: 'owner-a', transport })
    await writeFile(join(harness.root, 'peers.json'), JSON.stringify([{
      peerId: 'peer-x', selfId: 'owner-x', name: 'X', color: 2,
      ticket: 'memory:<x>', lastSeen: '2026-10-07T00:00:00.000Z',
    }]))
    await harness.service.ensureStarted()
    await vi.advanceTimersByTimeAsync(600)
    expect(transport.dialCalls).toBeGreaterThan(0)
    const attemptsBeforeClose = transport.dialCalls
    await harness.service.close()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(transport.dialCalls).toBe(attemptsBeforeClose)
  })
})

describe('peer forget', () => {
  /** One stored record of a known peer. */
  const knownRecord = {
    peerId: 'peer-x', selfId: 'owner-x', name: 'X', color: 2, ticket: 'memory:<x>', lastSeen: '2026-10-07T00:00:00.000Z',
  }

  it('removes a lost peer from memory and the file and stops its redials', async () => {
    vi.useFakeTimers()
    const transport = new StubTransport()
    transport.dialError = new Error('disabled network')
    const harness = await createHarness({ selfId: 'owner-a', transport })
    await writeFile(join(harness.root, 'peers.json'), JSON.stringify([knownRecord]))
    await harness.service.ensureStarted()
    await vi.advanceTimersByTimeAsync(600)
    expect(transport.dialCalls).toBeGreaterThan(0)

    await harness.service.forget(brandString<KetosPeerId>('peer-x'))
    const dialsAtForget = transport.dialCalls
    await vi.advanceTimersByTimeAsync(10_000)

    expect(transport.dialCalls).toBe(dialsAtForget)
    expect(harness.service.peers()).toEqual([])
    expect(JSON.parse(await readPeers(harness.root))).toEqual([])
  })

  it('refuses an unknown peer and a peer with an open channel', async () => {
    const [left, right] = await createPair()
    const code = await left.service.invite()
    await right.service.connect(code)
    await vi.waitFor(() => { expect(left.service.peers()[0]?.link).toBe('online') })
    const peerId = left.service.peers()[0]?.peerId as KetosPeerId

    await expect(left.service.forget(peerId)).rejects.toMatchObject({ code: 'ketos/peer-online' })
    await expect(left.service.forget(brandString<KetosPeerId>('nobody')))
      .rejects.toMatchObject({ code: 'ketos/peer-unknown' })
    expect(left.service.peers()).toHaveLength(1)
    expect(JSON.parse(await readPeers(left.root))).toHaveLength(1)
  })

  it('refuses the forgotten peer when it connects again without a code', async () => {
    const pair = createMemoryTransports()
    const left = await createHarness({ selfId: 'owner-a', pair, transport: pair.a })
    await writeFile(join(left.root, 'peers.json'), JSON.stringify([{
      peerId: String(pair.b.selfId()), selfId: 'owner-b', name: 'Юрист', color: 2, lastSeen: '2026-10-07T00:00:00.000Z',
    }]))
    await left.service.ensureStarted()
    await pair.b.bind()
    const known = await dialAndHello(pair.b, pair.a.invitationTicket())
    await vi.waitFor(() => { expect(left.service.peers()[0]?.link).toBe('online') })
    known.connection.close(0n, 'done')
    await vi.waitFor(() => { expect(left.service.peers()[0]?.link).toBe('lost') })

    await left.service.forget(pair.b.selfId())
    const again = await pair.b.dial(pair.a.invitationTicket())
    const stream = await again.openStream()
    await writePeerFrame(stream, PEER_FRAME_CODES.hello, { v: 2, selfId: 'owner-b', name: 'Юрист', color: 2 })
    await expect(again.closed()).resolves.toContain('(code 1)')
    expect(left.service.peers()).toEqual([])
  })

  it('abandons a redial that was in flight when the peer was forgotten', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const rogue = new RogueDialTransport(async (stream) => {
      await readPeerFrame(stream, 1_000_000)
      await gate
      await writePeerFrame(stream, PEER_FRAME_CODES.hello, { v: 2, selfId: 'owner-a', name: 'Кирилл', color: 1 })
    })
    const harness = await createHarness({ selfId: 'owner-b', transport: rogue, reconnectMinMs: 10, reconnectMaxMs: 20 })
    await writeFile(join(harness.root, 'peers.json'), JSON.stringify([{
      peerId: 'rogue-peer', selfId: 'owner-a', name: 'Кирилл', color: 1,
      ticket: 'memory:<rogue>', lastSeen: '2026-10-07T00:00:00.000Z',
    }]))
    const connected: unknown[] = []
    harness.ctx.on('ketos-peer/connected', (event) => { connected.push(event) })
    await harness.service.ensureStarted()
    await vi.waitFor(() => { expect(rogue.dialCalls).toBe(1) })

    await harness.service.forget(brandString<KetosPeerId>('rogue-peer'))
    release()
    await vi.waitFor(() => { expect(rogue.closes).toEqual([{ code: 2n, reason: 'handshake' }]) })

    expect(connected).toEqual([])
    expect(harness.service.peers()).toEqual([])
    expect(JSON.parse(await readPeers(harness.root))).toEqual([])
    expect(rogue.dialCalls).toBe(1)
  })

  it('keeps the peer known and redialing when the file cannot be written', async () => {
    vi.useFakeTimers()
    const transport = new StubTransport()
    transport.dialError = new Error('disabled network')
    const harness = await createHarness({ selfId: 'owner-a', transport })
    await writeFile(join(harness.root, 'peers.json'), JSON.stringify([knownRecord]))
    await harness.service.ensureStarted()
    // A directory in place of the file makes the atomic rename fail.
    await rm(join(harness.root, 'peers.json'))
    await mkdir(join(harness.root, 'peers.json'))

    await expect(harness.service.forget(brandString<KetosPeerId>('peer-x'))).rejects.toThrow()
    expect(harness.service.peers()).toHaveLength(1)
    const dialsAfterFailure = transport.dialCalls
    await vi.advanceTimersByTimeAsync(2000)
    expect(transport.dialCalls).toBeGreaterThan(dialsAfterFailure)
  })
})

describe('peer forget without a ticket', () => {
  it('keeps a peer that has no ticket known when the file cannot be written', async () => {
    const harness = await createHarness({ selfId: 'owner-a' })
    await writeFile(join(harness.root, 'peers.json'), JSON.stringify([{
      peerId: 'peer-x', selfId: 'owner-x', name: 'X', color: 2, lastSeen: '2026-10-07T00:00:00.000Z',
    }]))
    await harness.service.ensureStarted()
    await rm(join(harness.root, 'peers.json'))
    await mkdir(join(harness.root, 'peers.json'))

    await expect(harness.service.forget(brandString<KetosPeerId>('peer-x'))).rejects.toThrow()
    expect(harness.service.peers()).toHaveLength(1)
    expect(harness.service.peers()[0]?.link).toBe('lost')
  })
})

describe('peer eager start failures', () => {
  it('logs and keeps the plugin alive when the eager start fails', async () => {
    const transport = new StubTransport()
    transport.bindError = new Error('eager bind failed')
    const harness = await createHarness({ selfId: 'owner-a', transport })
    await writeFile(join(harness.root, 'peers.json'), JSON.stringify([{
      peerId: 'peer-x', selfId: 'owner-x', name: 'X', color: 1, ticket: 'memory:<x>',
      lastSeen: '2026-10-07T00:00:00.000Z',
    }]))
    await expect(harness.service.startIfKnownPeers()).rejects.toThrow(/eager bind failed/u)
  })
})

/** A transport that answers the accept loop with one prepared first frame. */
class RogueAcceptTransport implements PeerTransport {
  readonly closes: { code: bigint; reason: string }[] = []
  readonly id = brandString<KetosPeerId>('rogue-accept')
  private served = false

  /**
   * @param firstFrame - the bytes the dialing side "sent" before anything else.
   */
  constructor(
    private readonly firstFrame: Uint8Array,
    private readonly gate: Promise<void> = Promise.resolve(),
  ) {}

  /** {@inheritDoc PeerTransport.selfId} */
  selfId(): KetosPeerId { return this.id }
  /** {@inheritDoc PeerTransport.bind} */
  async bind(): Promise<void> {}
  /** {@inheritDoc PeerTransport.online} */
  async online(): Promise<void> {}
  /** {@inheritDoc PeerTransport.invitationTicket} */
  invitationTicket(): string { return 'memory:<rogue>' }
  /** {@inheritDoc PeerTransport.ticketPeerId} */
  ticketPeerId(): KetosPeerId { return this.id }
  /** {@inheritDoc PeerTransport.dial} */
  dial(): Promise<PeerConnection> { return Promise.reject(new Error('no dial')) }
  /** {@inheritDoc PeerTransport.accept} */
  accept(): Promise<PeerIncoming> {
    if (this.served) return new Promise(() => undefined)
    this.served = true
    const [serviceSide, rogueSide] = createMemoryStreamPair()
    void this.gate.then(() => rogueSide.write(this.firstFrame))
    return Promise.resolve({
      complete: () => Promise.resolve({
        peerId: brandString<KetosPeerId>('rogue-peer'),
        openStream: async () => serviceSide,
        acceptStream: async () => serviceSide,
        closed: () => new Promise<string>(() => undefined),
        close: (code, reason) => { this.closes.push({ code, reason }) },
      }),
    })
  }
  /** {@inheritDoc PeerTransport.close} */
  async close(): Promise<void> {}
}

/** A transport whose dial answers with a prepared (usually wrong) reply. */
class RogueDialTransport implements PeerTransport {
  readonly closes: { code: bigint; reason: string }[] = []
  dialCalls = 0
  readonly id = brandString<KetosPeerId>('rogue-dial')

  /**
   * @param reply - runs on the rogue side after the dialer's hello.
   */
  constructor(private readonly reply: (stream: PeerStream) => Promise<void>) {}

  /** {@inheritDoc PeerTransport.selfId} */
  selfId(): KetosPeerId { return this.id }
  /** {@inheritDoc PeerTransport.bind} */
  async bind(): Promise<void> {}
  /** {@inheritDoc PeerTransport.online} */
  async online(): Promise<void> {}
  /** {@inheritDoc PeerTransport.invitationTicket} */
  invitationTicket(): string { return 'memory:<rogue>' }
  /** {@inheritDoc PeerTransport.ticketPeerId} */
  ticketPeerId(): KetosPeerId { return brandString<KetosPeerId>('rogue-peer') }
  /** {@inheritDoc PeerTransport.dial} */
  async dial(): Promise<PeerConnection> {
    this.dialCalls += 1
    const [mine, theirs] = createMemoryStreamPair()
    void this.reply(theirs)
    return {
      peerId: brandString<KetosPeerId>('rogue-peer'),
      openStream: async () => mine,
      acceptStream: async () => mine,
      closed: () => new Promise<string>(() => undefined),
      close: (code, reason) => { this.closes.push({ code, reason }) },
    }
  }
  /** {@inheritDoc PeerTransport.accept} */
  accept(): Promise<PeerIncoming> { return new Promise(() => undefined) }
  /** {@inheritDoc PeerTransport.close} */
  async close(): Promise<void> {}
}

describe('peer handshake refusals', () => {
  it('closes a connection whose first frame is not hello', async () => {
    const transport = new RogueAcceptTransport(encodePeerFrame(PEER_FRAME_CODES.bye, { reason: 'early' }))
    const harness = await createHarness({ selfId: 'owner-a', transport })
    await harness.service.ensureStarted()
    await vi.waitFor(() => { expect(transport.closes).toContainEqual({ code: 2n, reason: 'handshake' }) })
    await expect(harness.service.state()).resolves.toMatchObject({ peers: [] })
  })

  it('closes a connection whose hello is not JSON', async () => {
    const body = new TextEncoder().encode('not json')
    const frame = new Uint8Array(5 + body.byteLength)
    new DataView(frame.buffer).setUint32(0, body.byteLength)
    frame[4] = PEER_FRAME_CODES.hello
    frame.set(body, 5)
    const transport = new RogueAcceptTransport(frame)
    const harness = await createHarness({ selfId: 'owner-a', transport })
    await harness.service.ensureStarted()
    await vi.waitFor(() => { expect(transport.closes).toHaveLength(1) })
    expect(transport.closes[0]?.code).toBe(2n)
  })

  it('refuses a connect whose reply is not hello', async () => {
    const rogue = new RogueDialTransport(async (stream) => {
      await readPeerFrame(stream, 1_000_000)
      await writePeerFrame(stream, PEER_FRAME_CODES.bye, { reason: 'no' })
    })
    const harness = await createHarness({ selfId: 'owner-b', transport: rogue })
    const code = formatInvite('memory:<rogue>', 'abcdefghijklmnopqrstuvwxyz')
    await expect(harness.service.connect(code)).rejects.toMatchObject({ code: 'ketos/invite-used' })
    expect(rogue.closes).toContainEqual({ code: 1n, reason: 'connect failed' })
  })

  it('logs a failed reconnect handshake and keeps retrying', async () => {
    const rogue = new RogueDialTransport(async (stream) => {
      await readPeerFrame(stream, 1_000_000)
      await writePeerFrame(stream, PEER_FRAME_CODES.bye, { reason: 'no' })
    })
    const harness = await createHarness({ selfId: 'owner-b', transport: rogue, reconnectMinMs: 10, reconnectMaxMs: 20 })
    await writeFile(join(harness.root, 'peers.json'), JSON.stringify([{
      peerId: 'rogue-peer', selfId: 'owner-a', name: 'Кирилл', color: 1,
      ticket: 'memory:<rogue>', lastSeen: '2026-10-07T00:00:00.000Z',
    }]))
    await harness.service.ensureStarted()
    await vi.waitFor(() => { expect(rogue.closes).toContainEqual({ code: 2n, reason: 'handshake' }) })
    await vi.waitFor(() => { expect(rogue.dialCalls).toBeGreaterThan(1) })
  })
})

describe('peer first-frame bound', () => {
  /**
   * A frame header that declares a body of the given size, without the body.
   * @param code - frame code.
   * @param length - declared body length.
   * @returns the five header bytes.
   */
  function headerOnly(code: number, length: number): Uint8Array {
    const header = new Uint8Array(5)
    new DataView(header.buffer).setUint32(0, length)
    header[4] = code
    return header
  }

  it('closes an incoming connection whose first frame exceeds the hello bound at once', async () => {
    const transport = new RogueAcceptTransport(headerOnly(PEER_FRAME_CODES.hello, 5000))
    const logs: string[] = []
    const harness = await createHarness({
      selfId: 'owner-a', transport, connectTimeoutMs: 5000, logger: (message) => { logs.push(message) },
    })
    await harness.service.ensureStarted()
    await vi.waitFor(() => { expect(transport.closes).toContainEqual({ code: 2n, reason: 'handshake' }) }, { timeout: 500 })
    expect(logs.some(line => line.includes('exceeds 4096 bytes'))).toBe(true)
  })

  it('refuses a dialed reply whose first frame exceeds the hello bound at once', async () => {
    const rogue = new RogueDialTransport(async (stream) => {
      await readPeerFrame(stream, 1_000_000)
      await stream.write(headerOnly(PEER_FRAME_CODES.hello, 5000))
    })
    const harness = await createHarness({ selfId: 'owner-b', transport: rogue, connectTimeoutMs: 5000 })
    const code = formatInvite('memory:<rogue>', 'abcdefghijklmnopqrstuvwxyz')
    await expect(harness.service.connect(code)).rejects.toMatchObject({ code: 'ketos/invite-used' })
    expect(rogue.closes).toContainEqual({ code: 1n, reason: 'connect failed' })
  })
})

describe('peer participant edge cases', () => {
  it('keeps both colors when the palette is exhausted', async () => {
    const seed = Array.from({ length: 10 }, (_, index) => ({
      id: `owner-${String(index + 1)}`, name: `P${String(index + 1)}`, color: index + 1,
    }))
    const pair = createMemoryTransports()
    const left = await createHarness({ selfId: 'owner-a', name: 'Кирилл', pair, transport: pair.a, boardSeed: seed })
    const right = await createHarness({ selfId: 'owner-b', name: 'Юрист', pair, transport: pair.b, boardSeed: seed })
    const code = await left.service.invite()
    await right.service.connect(code)
    await vi.waitFor(() => { expect(left.service.peers()[0]?.link).toBe('online') })
    expect((await left.service.state()).self.color).toBe(1)
    expect((await right.service.state()).self.color).toBe(1)
    expect(left.board.ownWrites).toHaveLength(1)
    expect(right.board.ownWrites).toHaveLength(1)
  })

  it('logs a refused participant write and keeps the channel up', async () => {
    const logs: string[] = []
    const pair = createMemoryTransports()
    const left = await createHarness({ selfId: 'owner-a', name: 'Кирилл', pair, transport: pair.a })
    const right = await createHarness({
      selfId: 'owner-b', name: 'Юрист', pair, transport: pair.b, logger: (message) => { logs.push(message) },
    })
    // The start write must succeed; only the collision rewrite fails.
    await right.service.ensureStarted()
    right.board.failWrites = true
    const code = await left.service.invite()
    await right.service.connect(code)
    await vi.waitFor(() => { expect(logs.some(message => message.includes('participant write failed'))).toBe(true) })
    expect((await right.service.state()).self.color).toBe(2)
  })

  it('consumes an expired secret only after its lifetime', async () => {
    const pair = createMemoryTransports()
    const left = await createHarness({ selfId: 'owner-a', name: 'Кирилл', pair, transport: pair.a, inviteTtlMs: 1 })
    const right = await createHarness({ selfId: 'owner-b', name: 'Юрист', pair, transport: pair.b })
    const code = await left.service.invite()
    await new Promise((resolve) => { setTimeout(resolve, 10) })
    await expect(right.service.connect(code)).rejects.toMatchObject({ code: 'ketos/invite-used' })
    expect(left.service.peers()).toEqual([])
  })

  it('refuses a wrong secret and keeps the pending invite usable', async () => {
    const [left, right] = await createPair()
    const code = await left.service.invite()
    const wrong = formatInvite(left.transport.invitationTicket(), 'abcdefghijklmnopqrstuvwxyz')
    await expect(right.service.connect(wrong)).rejects.toMatchObject({ code: 'ketos/invite-used' })
    const answer = await right.service.connect(code)
    expect(String(answer.peerId)).toBe(String(left.transport.selfId()))
  })

  it('burns the invitation after five wrong secrets', async () => {
    const logs: string[] = []
    const pair = createMemoryTransports()
    const left = await createHarness({
      selfId: 'owner-a', name: 'Кирилл', pair, transport: pair.a, logger: (message) => { logs.push(message) },
    })
    const right = await createHarness({ selfId: 'owner-b', name: 'Юрист', pair, transport: pair.b })
    const code = await left.service.invite()
    const wrong = formatInvite(left.transport.invitationTicket(), 'abcdefghijklmnopqrstuvwxyz')
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(right.service.connect(wrong)).rejects.toMatchObject({ code: 'ketos/invite-used' })
    }
    expect(logs.some(line => line.includes('peer.invite-burned'))).toBe(true)
    await expect(right.service.connect(code)).rejects.toMatchObject({ code: 'ketos/invite-used' })
    expect(left.service.peers()).toEqual([])
    // A fresh invitation starts a new budget.
    const fresh = await left.service.invite()
    await right.service.connect(fresh)
    await vi.waitFor(() => { expect(left.service.peers()[0]?.link).toBe('online') })
  })

  it('keeps the invitation after four wrong secrets', async () => {
    const [left, right] = await createPair()
    const code = await left.service.invite()
    const wrong = formatInvite(left.transport.invitationTicket(), 'abcdefghijklmnopqrstuvwxyz')
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(right.service.connect(wrong)).rejects.toMatchObject({ code: 'ketos/invite-used' })
    }
    await right.service.connect(code)
    await vi.waitFor(() => { expect(left.service.peers()[0]?.link).toBe('online') })
  })

  it('refuses a secret of the wrong length from an unknown node', async () => {
    const pair = createMemoryTransports()
    const left = await createHarness({ selfId: 'owner-a', name: 'Кирилл', pair, transport: pair.a })
    await left.service.invite()
    await pair.b.bind()
    const connection = await pair.b.dial(pair.a.invitationTicket())
    const stream = await connection.openStream()
    await writePeerFrame(stream, PEER_FRAME_CODES.hello, {
      v: 2, selfId: 'owner-b', name: 'Юрист', color: 2, invite: 'short',
    })
    await expect(connection.closed()).resolves.toContain('(code 1)')
    expect(left.service.peers()).toEqual([])
  })

  it('surfaces a non-Error dial failure as unreachable', async () => {
    const dialer = new StubTransport()
    dialer.dialError = 'string failure'
    const right = await createHarness({ selfId: 'owner-b', transport: dialer })
    const [left] = await createPair()
    await left.service.ensureStarted()
    const code = formatInvite(left.transport.invitationTicket(), 'abcdefghijklmnopqrstuvwxyz')
    await expect(right.service.connect(code)).rejects.toMatchObject({ code: 'ketos/peer-unreachable' })
  })
})

/**
 * Read one side's known-peer file.
 * @param root - harness temporary directory.
 * @returns the file contents.
 */
async function readPeers(root: string): Promise<string> {
  return readFile(join(root, 'peers.json'), 'utf8')
}
