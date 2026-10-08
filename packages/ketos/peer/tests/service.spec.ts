// The peer service end to end over the in-memory transport: lazy start,
// participant publication and the color rule, the invitation handshake with
// its refusals, the known-peer file, framed send/request handling, and
// reconnection with its pause sequence.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OwnerId } from '@ketos/board-doc/types'
import { encodePeerFrame, PEER_FRAME_CODES } from '../src/frame.ts'
import { formatInvite } from '../src/invite.ts'
import { readPeerFrame, writePeerFrame } from '../src/link.ts'
import { createMemoryStreamPair, createMemoryTransports, type MemoryTransportPair } from '../src/memory-transport.ts'
import { KetosPeerService, type KetosPeerOptions } from '../src/service.ts'
import type { PeerConnection, PeerStream, PeerTransport } from '../src/transport.ts'
import type { KetosPeerId } from '../src/types.ts'

// The channel reserves codes 3-7 for the consumers of stages 33-35; this spec
// merges one reserved type into the map the way stage 33 will.
declare module '../src/frame.ts' {
  interface PeerFrameTypeMap {
    'board.update': { readonly n: number }
  }
}

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

/** A transport whose configured step fails, to drive error branches. */
class StubTransport implements PeerTransport {
  onlineError: unknown
  ticketError: unknown
  dialError: unknown
  bindError: unknown
  bindCalls = 0
  dialCalls = 0
  readonly ticket = 'memory:<stub>'
  readonly id = brandString<KetosPeerId>('stub-self')

  /** {@inheritDoc PeerTransport.selfId} */
  selfId(): KetosPeerId { return this.id }
  /** {@inheritDoc PeerTransport.bind} */
  async bind(): Promise<void> {
    this.bindCalls += 1
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
    if (this.dialError !== undefined) throw this.dialError
    throw new Error('stub dial is not connected')
  }
  /** {@inheritDoc PeerTransport.accept} */
  accept(): Promise<PeerConnection> {
    return Promise.reject(new Error('stub accept is not connected'))
  }
  /** {@inheritDoc PeerTransport.close} */
  async close(): Promise<void> {}
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

  it('closes a duplicate incoming connection without adding a second channel', async () => {
    const [left, right] = await createPair()
    const code = await left.service.invite()
    await right.service.connect(code)
    await vi.waitFor(() => { expect(left.service.peers()[0]?.link).toBe('online') })
    const duplicate = await right.transport.dial(left.transport.invitationTicket())
    const stream = await duplicate.openStream()
    await writePeerFrame(stream, PEER_FRAME_CODES.hello, { v: 1, selfId: 'owner-b', name: 'Юрист', color: 1 })
    const closed = await duplicate.closed()
    expect(closed).toContain('duplicate')
    expect(closed).toContain('(code 3)')
    expect(left.service.peers()).toHaveLength(1)
  })

  it('keeps the live link when a racing dial attaches a duplicate, closing it with code 3', async () => {
    const rogue = new RogueDialTransport(async (stream) => {
      await readPeerFrame(stream, 1_000_000)
      await writePeerFrame(stream, PEER_FRAME_CODES.hello, { v: 1, selfId: 'owner-a', name: 'Кирилл', color: 1 })
    })
    const harness = await createHarness({ selfId: 'owner-b', transport: rogue })
    const connected: unknown[] = []
    harness.ctx.on('ketos-peer/connected', (event) => { connected.push(event) })
    const code = formatInvite('memory:<rogue>', 'abcdefghijklmnopqrstuvwxyz')

    // Both calls pass the pre-dial check before either handshake attaches, so
    // the second attach meets the live link of the first.
    const [first, second] = await Promise.all([
      harness.service.connect(code),
      harness.service.connect(code),
    ])

    expect(String(first.peerId)).toBe('rogue-peer')
    expect(String(second.peerId)).toBe('rogue-peer')
    expect(rogue.closes.filter(close => close.code === 3n)).toEqual([{ code: 3n, reason: 'duplicate' }])
    expect(harness.service.peers()).toHaveLength(1)
    expect(harness.service.peers()[0]?.link).toBe('online')
    expect(connected).toHaveLength(1)
  })
})

describe('peer framed messages', () => {
  it('delivers messages to every handler and answers the first handler for requests', async () => {
    const [left, right] = await createPair()
    const code = await left.service.invite()
    await right.service.connect(code)
    const leftId = await left.service.nodeId()
    const seen: { payload: unknown; from: KetosPeerId }[] = []
    left.service.handle('board.update', (payload, from) => { seen.push({ payload, from }); return { first: payload.n } })
    left.service.handle('board.update', (payload) => { seen.push({ payload, from: right.transport.selfId() }); return { second: true } })
    await right.service.send(leftId, 'board.update', { n: 7 })
    await vi.waitFor(() => { expect(seen).toHaveLength(2) })
    expect(seen[0]?.payload).toEqual({ n: 7 })
    const response = await right.service.request(leftId, 'board.update', { n: 8 }, { timeoutMs: 500 })
    expect(response).toEqual({ first: 8 })
    await vi.waitFor(() => { expect(seen).toHaveLength(4) })
  })

  it('uses the connect timeout when a request names none', async () => {
    const [left, right] = await createPair()
    const code = await left.service.invite()
    await right.service.connect(code)
    const leftId = await left.service.nodeId()
    left.service.handle('board.update', payload => payload)
    await expect(right.service.request(leftId, 'board.update', { n: 9 })).resolves.toEqual({ n: 9 })
  })

  it('times out an unanswered request and surfaces a handler error', async () => {
    const [left, right] = await createPair()
    const code = await left.service.invite()
    await right.service.connect(code)
    const leftId = await left.service.nodeId()
    await expect(right.service.request(leftId, 'board.update', { n: 1 }, { timeoutMs: 50 }))
      .rejects.toThrow(/timed out/u)
    const unsubscribe = left.service.handle('board.update', () => { throw new Error('handler exploded') })
    await expect(right.service.request(leftId, 'board.update', { n: 2 }, { timeoutMs: 500 }))
      .rejects.toThrow(/handler exploded/u)
    unsubscribe()
    await expect(right.service.send(brandString<KetosPeerId>('nobody'), 'board.update', { n: 1 }))
      .rejects.toThrow(/not connected/u)
    await expect(right.service.request(brandString<KetosPeerId>('nobody'), 'board.update', { n: 1 }))
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
  constructor(private readonly firstFrame: Uint8Array) {}

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
  accept(): Promise<PeerConnection> {
    if (this.served) return new Promise(() => undefined)
    this.served = true
    const [serviceSide, rogueSide] = createMemoryStreamPair()
    void rogueSide.write(this.firstFrame)
    return Promise.resolve({
      peerId: brandString<KetosPeerId>('rogue-peer'),
      openStream: async () => serviceSide,
      acceptStream: async () => serviceSide,
      closed: () => new Promise<string>(() => undefined),
      close: (code, reason) => { this.closes.push({ code, reason }) },
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
  accept(): Promise<PeerConnection> { return new Promise(() => undefined) }
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
