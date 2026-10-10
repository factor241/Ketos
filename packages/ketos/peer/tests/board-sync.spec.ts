// Board synchronization over the peer channel: the document exchange at
// connection, the update relay, and the too-large bound that closes a channel
// instead of sending a frame it cannot carry.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { KetosBoardDocService, type KetosBoardDocOptions } from '@ketos/board-doc/src/service.ts'
import type { BoardCreateOp, ElementId } from '@ketos/board-doc/types'
import { registerBoardSync } from '../src/board-sync.ts'
import { createMemoryTransports, type MemoryTransportPair } from '../src/memory-transport.ts'
import { KetosPeerService, type KetosPeerOptions } from '../src/service.ts'
import type { PeerTransport } from '../src/transport.ts'
import type { KetosPeerId } from '../src/types.ts'

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
  vi.restoreAllMocks()
})

const ID_A = brandString<ElementId>('00000000-0000-4000-8000-000000000001')
const ID_B = brandString<ElementId>('00000000-0000-4000-8000-000000000002')

/**
 * One create operation.
 * @param id - element id.
 * @param text - note text.
 * @returns the create operation.
 */
function createOp(id: ElementId, text = ''): BoardCreateOp {
  return {
    op: 'create', id, kind: 'note', x: 0, y: 0, w: 10, h: 10,
    data: { text, font: 'sans', size: 'm', scale: 1 },
  }
}

/** Everything one side of the synchronized channel needs. */
interface Harness {
  readonly ctx: Context
  readonly board: KetosBoardDocService
  readonly service: KetosPeerService
  readonly logs: string[]
  readonly peerLogs: string[]
}

/** Options one side of a pair may override. */
interface SideOptions {
  readonly name: string
  readonly transport: PeerTransport
  readonly root: string
  readonly maxSyncUpdateBytes?: number
  readonly reconnectMinMs?: number
  readonly reconnectMaxMs?: number
}

/**
 * Build one side: a real board document, a peer node over the given
 * transport, and the synchronization wiring between them.
 * @param options - identity, transport, root directory, and update bound.
 * @returns the side's services and its synchronization log.
 */
async function createSide(options: SideOptions): Promise<Harness> {
  const ctx = new Context()
  const logs: string[] = []
  const peerLogs: string[] = []
  const boardOptions: KetosBoardDocOptions = {
    path: join(options.root, 'board.db'),
    limits: {
      maxOpsPerRequest: 64,
      maxElements: 2000,
      maxWindowRecords: 100,
      elements: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 },
    },
    journalCompactRows: 500,
    logger: () => undefined,
  }
  const board = new KetosBoardDocService(ctx, boardOptions)
  const peerOptions: KetosPeerOptions = {
    name: options.name,
    relayUrls: [],
    keyPath: join(options.root, 'peer.key'),
    peersPath: join(options.root, 'peers.json'),
    maxFrameBytes: 1_000_000,
    onlineTimeoutMs: 500,
    connectTimeoutMs: 500,
    reconnectMinMs: options.reconnectMinMs ?? 50,
    reconnectMaxMs: options.reconnectMaxMs ?? 200,
    inviteTtlMs: 60_000,
    stateRefreshMs: 1000,
    heartbeatIntervalMs: 3000,
    heartbeatTimeoutMs: 9000,
    logger: (message) => { peerLogs.push(message) },
    transport: options.transport,
  }
  const service = new KetosPeerService(ctx, peerOptions)
  registerBoardSync(ctx, service, board, {
    maxSyncUpdateBytes: options.maxSyncUpdateBytes ?? 15_728_640,
    reconnectMinMs: options.reconnectMinMs ?? 50,
    reconnectMaxMs: options.reconnectMaxMs ?? 200,
    logger: (message) => { logs.push(message) },
  })
  cleanups.push(() => board.close())
  cleanups.push(() => ctx.fiber.dispose())
  cleanups.push(() => service.close())
  return { ctx, board, service, logs, peerLogs }
}

/** One connected pair of sides plus its transport controls. */
interface Pair {
  readonly a: Harness
  readonly b: Harness
  readonly transport: MemoryTransportPair
}

/**
 * Build two sides over one in-memory transport pair.
 * @param aBound - update bound of the first side.
 * @param bBound - update bound of the second side.
 * @returns both sides.
 */
async function createPair(
  aBound = 15_728_640,
  bBound = 15_728_640,
  reconnect: { readonly reconnectMinMs?: number; readonly reconnectMaxMs?: number } = {},
): Promise<Pair> {
  const pair = createMemoryTransports()
  const rootA = await mkdtemp(join(tmpdir(), 'dsh-peer-sync-a-'))
  const rootB = await mkdtemp(join(tmpdir(), 'dsh-peer-sync-b-'))
  cleanups.push(() => rm(rootA, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  cleanups.push(() => rm(rootB, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  const a = await createSide({ name: 'Кирилл', transport: pair.a, root: rootA, maxSyncUpdateBytes: aBound, ...reconnect })
  const b = await createSide({ name: 'Юрист', transport: pair.b, root: rootB, maxSyncUpdateBytes: bBound, ...reconnect })
  return { a, b, transport: pair }
}

/**
 * Complete the invitation handshake between two sides.
 * @param pair - the sides to connect.
 */
async function connect(pair: Pair): Promise<void> {
  const code = await pair.a.service.invite()
  await pair.b.service.connect(code)
  await vi.waitFor(() => { expect(pair.a.service.peers()[0]?.link).toBe('online') })
  await vi.waitFor(() => { expect(pair.b.service.peers()[0]?.link).toBe('online') })
}

/** Sorted element ids of one document. */
async function elementIds(harness: Harness): Promise<string[]> {
  return (await harness.board.snapshot()).elements.map(element => element.id).sort()
}

describe('board synchronization over the peer channel', () => {
  it('exchanges both documents and their participants at connection', async () => {
    const pair = await createPair()
    await pair.a.board.apply([createOp(ID_A)], 'host')
    await pair.b.board.apply([createOp(ID_B)], 'host')
    await connect(pair)

    await vi.waitFor(async () => { expect(await elementIds(pair.a)).toEqual([ID_A, ID_B]) })
    await vi.waitFor(async () => { expect(await elementIds(pair.b)).toEqual([ID_A, ID_B]) })

    const selfA = await pair.a.board.selfId()
    const selfB = await pair.b.board.selfId()
    await vi.waitFor(async () => {
      expect((await pair.a.board.participants()).map(record => record.id)).toEqual(expect.arrayContaining([selfA, selfB]))
    })
    await vi.waitFor(async () => {
      expect((await pair.b.board.participants()).map(record => record.id)).toEqual(expect.arrayContaining([selfA, selfB]))
    })
  })

  it('relays a later local change to the connected peer', async () => {
    const pair = await createPair()
    await connect(pair)
    await pair.a.board.apply([createOp(ID_A, 'позже')], 'host')
    await vi.waitFor(async () => { expect(await elementIds(pair.b)).toEqual([ID_A]) })
    expect(pair.a.logs).toEqual([])
    expect(pair.b.logs).toEqual([])
  })

  it('sends one frame per change and never echoes it back', async () => {
    const pair = await createPair()
    await connect(pair)
    // Warm-up change: it completes the connection's own state-vector exchange,
    // so the spy below sees only the frames the measured change produces.
    await pair.a.board.apply([createOp(ID_B)], 'host')
    await vi.waitFor(async () => { expect(await elementIds(pair.b)).toEqual([ID_B]) })
    const sentByA = vi.spyOn(pair.a.service, 'send')
    const sentByB = vi.spyOn(pair.b.service, 'send')
    await pair.a.board.apply([createOp(ID_A)], 'host')
    await vi.waitFor(async () => { expect(await elementIds(pair.b)).toEqual([ID_A, ID_B]) })
    expect(sentByA.mock.calls.filter(([, type]) => type === 'board.update')).toHaveLength(1)
    expect(sentByB.mock.calls.filter(([, type]) => type === 'board.update')).toHaveLength(0)
  })

  it('converges simultaneous edits of different fields and elements', async () => {
    const pair = await createPair()
    await connect(pair)
    await pair.a.board.apply([createOp(ID_A, 'начало')], 'host')
    await vi.waitFor(async () => { expect(await elementIds(pair.b)).toEqual([ID_A]) })

    await Promise.all([
      pair.a.board.apply([{ op: 'patch', id: ID_A, x: 100 }], 'host'),
      pair.b.board.apply([
        { op: 'patch', id: ID_A, data: { text: 'изменено' } },
        createOp(ID_B),
      ], 'host'),
    ])
    for (const side of [pair.a, pair.b]) {
      await vi.waitFor(async () => {
        const elements = (await side.board.snapshot()).elements
        expect(elements).toHaveLength(2)
        expect(elements.find(element => element.id === ID_A)).toMatchObject({ x: 100, data: { text: 'изменено' } })
      })
    }
  })

  it('removes an element on the other side', async () => {
    const pair = await createPair()
    await connect(pair)
    await pair.a.board.apply([createOp(ID_A)], 'host')
    await vi.waitFor(async () => { expect(await elementIds(pair.b)).toEqual([ID_A]) })
    await pair.a.board.apply([{ op: 'remove', id: ID_A }], 'host')
    await vi.waitFor(async () => { expect(await elementIds(pair.b)).toEqual([]) })
  })

  it('catches up edits made on both sides while the channel was down', async () => {
    const pair = await createPair()
    await connect(pair)
    // The reconnect loop may restore the link between two polls, so the drop
    // is observed through its event instead of the link state.
    const disconnected = vi.fn()
    pair.a.ctx.on('ketos-peer/disconnected', disconnected)
    pair.transport.dropConnections()
    await vi.waitFor(() => { expect(disconnected).toHaveBeenCalled() })
    await Promise.all([
      pair.a.board.apply([createOp(ID_A, 'во время разрыва')], 'host'),
      pair.b.board.apply([createOp(ID_B, 'тоже во время разрыва')], 'host'),
    ])
    // The reconnect loop redials; the fresh state-vector exchange on the new
    // channel carries both edits.
    await vi.waitFor(async () => { expect(await elementIds(pair.a)).toEqual([ID_A, ID_B]) }, { timeout: 10_000 })
    await vi.waitFor(async () => { expect(await elementIds(pair.b)).toEqual([ID_A, ID_B]) }, { timeout: 10_000 })
  })

  it('closes the channel when the state-vector answer exceeds the bound', async () => {
    const pair = await createPair(256)
    await pair.a.board.apply([createOp(ID_A, 'x'.repeat(500))], 'host')
    // No online wait: the answer to B's state vector is exactly what closes it.
    const code = await pair.a.service.invite()
    await pair.b.service.connect(code)
    await vi.waitFor(() => {
      expect(pair.a.logs.some(line => line.includes('board.sync.too-large'))).toBe(true)
    })
    await vi.waitFor(() => { expect(pair.a.service.peers()[0]?.link).toBe('lost') })
    // The node survives the closed channel: the document is still readable.
    expect(await elementIds(pair.a)).toEqual([ID_A])
  })

  it('backs off while a state-vector answer over the bound keeps closing the channel', async () => {
    const pair = await createPair(256, 15_728_640, { reconnectMinMs: 40, reconnectMaxMs: 160 })
    await pair.a.board.apply([createOp(ID_A, 'x'.repeat(500))], 'host')
    const connectedAt: number[] = []
    pair.b.ctx.on('ketos-peer/connected', () => { connectedAt.push(Date.now()) })
    await pair.b.service.connect(await pair.a.service.invite())
    // Every connection ends the same way: B announces its vector, A's answer
    // is over the bound and A closes the channel.
    await vi.waitFor(() => { expect(connectedAt.length).toBeGreaterThanOrEqual(4) }, { timeout: 5000 })
    const gaps = connectedAt.slice(1).map((time, index) => time - (connectedAt[index] as number))
    expect(gaps[2] as number).toBeGreaterThan((gaps[0] as number) * 1.5)
    expect(pair.b.peerLogs.filter(line => line.includes('peer.flapping')).length).toBeGreaterThanOrEqual(3)
  })

  it('closes the channel when a local update exceeds the bound', async () => {
    const pair = await createPair(256)
    await connect(pair)
    await pair.a.board.apply([createOp(ID_A, 'y'.repeat(500))], 'host')
    await vi.waitFor(() => {
      expect(pair.a.logs.some(line => line.includes('board.sync.too-large'))).toBe(true)
    })
    await vi.waitFor(() => { expect(pair.a.service.peers()[0]?.link).toBe('lost') })
    expect(await elementIds(pair.b)).toEqual([])
  })

  it('logs a failed announcement and stays mounted', async () => {
    const pair = await createPair()
    vi.spyOn(pair.a.board, 'stateVector').mockRejectedValue(new Error('document closed'))
    await connect(pair)
    await vi.waitFor(() => {
      expect(pair.a.logs.some(line => line.includes('board sync announce failed: Error: document closed'))).toBe(true)
    })
    // The other direction keeps working: B's document still reaches A.
    await vi.waitFor(async () => {
      expect((await pair.a.board.participants()).length).toBeGreaterThanOrEqual(1)
    })
  })

  it('logs a failed state-vector answer without closing the channel', async () => {
    const pair = await createPair()
    vi.spyOn(pair.a.board, 'diffSince').mockRejectedValue(new Error('unreadable vector'))
    await connect(pair)
    await vi.waitFor(() => {
      expect(pair.a.logs.some(line => line.includes('board sync answer failed: Error: unreadable vector'))).toBe(true)
    })
    expect(pair.a.service.peers()[0]?.link).toBe('online')
  })

  it('logs a failed remote apply and keeps the connection alive', async () => {
    const pair = await createPair()
    await pair.b.board.apply([createOp(ID_B)], 'host')
    vi.spyOn(pair.a.board, 'applyRemote').mockRejectedValue(new Error('bad update'))
    await connect(pair)
    await vi.waitFor(() => {
      expect(pair.a.logs.some(line => line.includes('board sync apply failed: Error: bad update'))).toBe(true)
    })
    expect(pair.a.service.peers()[0]?.link).toBe('online')
  })

  /**
   * Make the first side's remote applies misbehave until it has sent its
   * state vector a second time, which only a resynchronization does.
   * @param pair - the connected pair.
   * @param misbehave - what an apply does before the second vector.
   */
  function breakAppliesUntilResync(pair: Pair, misbehave: () => Promise<{ pending: boolean }>): void {
    const real = pair.a.board.applyRemote.bind(pair.a.board)
    const sentByA = vi.spyOn(pair.a.service, 'send')
    const vectorsSent = (): number => sentByA.mock.calls.filter(([, type]) => type === 'board.sv').length
    vi.spyOn(pair.a.board, 'applyRemote').mockImplementation(async (update) => {
      if (vectorsSent() < 2) return misbehave()
      return real(update)
    })
  }

  it('asks the sender again after a remote apply failed', async () => {
    const pair = await createPair()
    await pair.b.board.apply([createOp(ID_B)], 'host')
    breakAppliesUntilResync(pair, () => Promise.reject(new Error('bad update')))
    await connect(pair)
    await vi.waitFor(async () => { expect(await elementIds(pair.a)).toEqual([ID_B]) })
    expect(pair.a.logs.some(line => line.includes('board sync apply failed: Error: bad update'))).toBe(true)
  })

  it('asks the sender again after an update was applied only in part', async () => {
    const pair = await createPair()
    await pair.b.board.apply([createOp(ID_B)], 'host')
    breakAppliesUntilResync(pair, () => Promise.resolve({ pending: true }))
    await connect(pair)
    await vi.waitFor(async () => { expect(await elementIds(pair.a)).toEqual([ID_B]) })
  })

  it('ignores a too-large close for a peer without a channel', async () => {
    const pair = await createPair()
    pair.a.service.closeSyncTooLarge(brandString<KetosPeerId>('peer-missing'))
    expect(pair.a.service.peers()).toEqual([])
  })

  it('logs a failed relay send', async () => {
    const pair = await createPair()
    await connect(pair)
    vi.spyOn(pair.a.service, 'send').mockRejectedValue(new Error('refused'))
    await pair.a.board.apply([createOp(ID_A)], 'host')
    await vi.waitFor(() => {
      expect(pair.a.logs.some(line => line.includes('board sync send failed: Error: refused'))).toBe(true)
    })
  })
})

/** Frames a stand-in peer service recorded. */
interface SentFrame {
  readonly peerId: KetosPeerId
  readonly type: string
}

/** Peer-service stand-in for the synchronization schedule alone. */
class FakePeer {
  readonly handlers = new Map<string, (payload: Uint8Array, from: KetosPeerId) => void>()
  readonly sent: SentFrame[] = []
  failSend = false

  /** The stand-in peer's single online peer. */
  peers(): readonly { peerId: KetosPeerId; link: 'online' }[] {
    return [{ peerId: PEER, link: 'online' }]
  }

  /** Record the handler and return its unsubscribe. */
  handle(type: string, handler: (payload: Uint8Array, from: KetosPeerId) => void): () => void {
    this.handlers.set(type, handler)
    return () => { this.handlers.delete(type) }
  }

  /** Record one frame, or fail it. */
  send(peerId: KetosPeerId, type: string): Promise<void> {
    this.sent.push({ peerId, type })
    return this.failSend ? Promise.reject(new Error('not connected')) : Promise.resolve()
  }

  /** Not used by the resynchronization tests. */
  closeSyncTooLarge(): void {}
}

const PEER = brandString<KetosPeerId>('peer-fake')

/** Document stand-in whose applyRemote outcomes the test scripts. */
class FakeBoard {
  readonly outcomes: Array<'ok' | 'pending' | 'fail'> = []

  /** An empty vector. */
  async stateVector(): Promise<Uint8Array> { return new Uint8Array([1]) }
  /** An empty diff. */
  async diffSince(): Promise<Uint8Array> { return new Uint8Array([2]) }
  /** The next scripted outcome; absent means a clean apply. */
  async applyRemote(): Promise<{ pending: boolean }> {
    const outcome = this.outcomes.shift() ?? 'ok'
    if (outcome === 'fail') throw new Error('bad update')
    return { pending: outcome === 'pending' }
  }
  /** No local updates in these tests. */
  onLocalUpdate(): () => void { return () => undefined }
}

/** The fakes plus the context the schedule registers its effects on. */
interface ResyncHarness {
  readonly ctx: Context
  readonly peer: FakePeer
  readonly board: FakeBoard
  readonly logs: string[]
  /** Deliver one remote update, as the channel would. */
  deliver(): Promise<void>
  /** Sent `board.sv` frames. */
  vectors(): number
}

/**
 * Wire the schedule over the fakes with fake timers.
 * @returns the harness.
 */
function createResyncHarness(): ResyncHarness {
  vi.useFakeTimers()
  const ctx = new Context()
  const peer = new FakePeer()
  const board = new FakeBoard()
  const logs: string[] = []
  registerBoardSync(
    ctx, peer, board,
    { maxSyncUpdateBytes: 1_000_000, reconnectMinMs: 50, reconnectMaxMs: 200, logger: (message) => { logs.push(message) } },
  )
  cleanups.push(() => ctx.fiber.dispose())
  return {
    ctx, peer, board, logs,
    deliver: async () => {
      peer.handlers.get('board.update')?.(new Uint8Array([9]), PEER)
      await vi.advanceTimersByTimeAsync(0)
    },
    vectors: () => peer.sent.filter(frame => frame.type === 'board.sv').length,
  }
}

describe('board resynchronization schedule', () => {
  it('resends the state vector after a failed apply and after a partial one', async () => {
    const harness = createResyncHarness()
    harness.board.outcomes.push('fail')
    await harness.deliver()
    expect(harness.vectors()).toBe(0)
    await vi.advanceTimersByTimeAsync(49)
    expect(harness.vectors()).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.vectors()).toBe(1)

    // A clean apply after the resync ends the streak, so the pause starts over.
    await harness.deliver()
    harness.board.outcomes.push('pending')
    await harness.deliver()
    await vi.advanceTimersByTimeAsync(50)
    expect(harness.vectors()).toBe(2)
    expect(harness.logs.filter(line => line.includes('board.sync.resync'))).toHaveLength(2)
  })

  it('drops the resync of a gap in the update order once a clean apply closes it', async () => {
    const harness = createResyncHarness()
    harness.board.outcomes.push('pending', 'ok')
    await harness.deliver()
    await harness.deliver()
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.vectors()).toBe(0)
    expect(harness.logs).toEqual([])
  })

  it('keeps the resync of a failed apply when a later apply is clean', async () => {
    const harness = createResyncHarness()
    harness.board.outcomes.push('fail', 'ok')
    await harness.deliver()
    await harness.deliver()
    await vi.advanceTimersByTimeAsync(50)
    expect(harness.vectors()).toBe(1)
  })

  it('doubles the pause up to the ceiling while applies keep failing', async () => {
    const harness = createResyncHarness()
    harness.board.outcomes.push('fail', 'fail', 'fail', 'fail')
    const times: number[] = []
    for (let round = 0; round < 4; round += 1) {
      await harness.deliver()
      const before = harness.vectors()
      const started = Date.now()
      while (harness.vectors() === before) await vi.advanceTimersByTimeAsync(10)
      times.push(Date.now() - started)
    }
    expect(times).toEqual([50, 100, 200, 200])
  })

  it('starts over from the first pause after a clean apply', async () => {
    const harness = createResyncHarness()
    harness.board.outcomes.push('fail', 'fail', 'ok', 'fail')
    await harness.deliver()
    await vi.advanceTimersByTimeAsync(50)
    await harness.deliver()
    await vi.advanceTimersByTimeAsync(100)
    expect(harness.vectors()).toBe(2)
    await harness.deliver()
    await harness.deliver()
    const before = harness.vectors()
    await vi.advanceTimersByTimeAsync(50)
    expect(harness.vectors()).toBe(before + 1)
  })

  it('keeps one timer when a second failure arrives before the pause ends', async () => {
    const harness = createResyncHarness()
    harness.board.outcomes.push('fail', 'fail')
    await harness.deliver()
    await harness.deliver()
    await vi.advanceTimersByTimeAsync(400)
    expect(harness.vectors()).toBe(1)
  })

  it('drops a pending resync when the channel ends or the plugin unloads', async () => {
    const harness = createResyncHarness()
    harness.board.outcomes.push('fail')
    await harness.deliver()
    harness.ctx.emit('ketos-peer/disconnected', { peerId: PEER })
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.vectors()).toBe(0)

    harness.board.outcomes.push('fail')
    await harness.deliver()
    await harness.ctx.fiber.dispose()
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.vectors()).toBe(0)
  })

  it('logs a resync that cannot be sent', async () => {
    const harness = createResyncHarness()
    harness.peer.failSend = true
    harness.board.outcomes.push('fail')
    await harness.deliver()
    await vi.advanceTimersByTimeAsync(50)
    expect(harness.logs.some(line => line.includes('board sync announce failed'))).toBe(true)
  })
})
