// Disposal while the node is starting: each awaited step of the start —
// transport creation, bind, the known-peer read, and the three board-document
// calls — is held open while the service closes. The start must stop at the
// next step, leave no accept loop or redial behind, and the transport it
// created must be closed.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OwnerId } from '@ketos/board-doc/types'
import { KetosPeerService } from '../src/service.ts'
import type { PeerConnection, PeerIncoming, PeerTransport } from '../src/transport.ts'
import type { KetosPeerId } from '../src/types.ts'

/** The awaited steps of the start, in the order the service runs them. */
const STEPS = ['transport', 'bind', 'load', 'selfId', 'participants', 'put'] as const

/** One awaited step of the start. */
type Step = typeof STEPS[number]

/** The hook the mocked modules and stand-ins report each step to. */
const probe = vi.hoisted(() => ({
  enter: async (_step: string): Promise<void> => undefined,
  transport: undefined as PeerTransport | undefined,
}))

vi.mock('../src/iroh-transport.ts', () => ({
  createIrohTransport: async (): Promise<PeerTransport | undefined> => {
    await probe.enter('transport')
    return probe.transport
  },
  generateSecretKey: async (): Promise<Uint8Array> => new Uint8Array(32).fill(1),
}))

vi.mock('../src/peers-file.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/peers-file.ts')>()
  return {
    ...actual,
    loadKnownPeers: async (path: string) => {
      await probe.enter('load')
      return actual.loadKnownPeers(path)
    },
  }
})

/** Board-document stand-in reporting each call to the probe. */
class ProbeBoard extends Service {
  constructor(ctx: Context) {
    super(ctx, 'ketosBoardDoc')
  }

  /** {@inheritDoc KetosBoardDocService.selfId} */
  async selfId(): Promise<OwnerId> {
    await probe.enter('selfId')
    return brandString<OwnerId>('owner-a')
  }

  /** {@inheritDoc KetosBoardDocService.participants} */
  async participants(): Promise<never[]> {
    await probe.enter('participants')
    return []
  }

  /** {@inheritDoc KetosBoardDocService.putOwnParticipant} */
  async putOwnParticipant(): Promise<void> {
    await probe.enter('put')
  }
}

/** Transport stand-in counting the calls that must not happen after disposal. */
class ProbeTransport implements PeerTransport {
  accepts = 0
  dials = 0
  closes = 0
  readonly id = brandString<KetosPeerId>('probe-self')

  /** {@inheritDoc PeerTransport.selfId} */
  selfId(): KetosPeerId { return this.id }
  /** {@inheritDoc PeerTransport.bind} */
  async bind(): Promise<void> { await probe.enter('bind') }
  /** {@inheritDoc PeerTransport.online} */
  async online(): Promise<void> {}
  /** {@inheritDoc PeerTransport.invitationTicket} */
  invitationTicket(): string { return 'memory:<probe>' }
  /** {@inheritDoc PeerTransport.ticketPeerId} */
  ticketPeerId(): KetosPeerId { return this.id }
  /** {@inheritDoc PeerTransport.dial} */
  dial(): Promise<PeerConnection> {
    this.dials += 1
    return Promise.reject(new Error('probe dial'))
  }
  /** {@inheritDoc PeerTransport.accept} */
  accept(): Promise<PeerIncoming> {
    this.accepts += 1
    return Promise.reject(new Error('probe accept'))
  }
  /** {@inheritDoc PeerTransport.close} */
  async close(): Promise<void> { this.closes += 1 }
}

let cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups = []
  probe.enter = async () => undefined
  probe.transport = undefined
})

describe('peer service closed during each step of its start', () => {
  it.each(STEPS)('stops after the %s step and closes the transport', async (target) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-peer-dispose-'))
    const ctx = new Context()
    new ProbeBoard(ctx)
    const transport = new ProbeTransport()
    probe.transport = transport
    const service = new KetosPeerService(ctx, {
      name: 'Кирилл',
      relayUrls: [],
      keyPath: join(root, 'peer.key'),
      peersPath: join(root, 'peers.json'),
      maxFrameBytes: 1_000_000,
      onlineTimeoutMs: 500,
      connectTimeoutMs: 500,
      reconnectMinMs: 10,
      reconnectMaxMs: 20,
      inviteTtlMs: 60_000,
      stateRefreshMs: 1000,
      heartbeatIntervalMs: 3000,
      heartbeatTimeoutMs: 9000,
      logger: () => undefined,
    })
    cleanups.push(async () => {
      await service.close()
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    })
    await writeFile(join(root, 'peers.json'), JSON.stringify([{
      peerId: 'peer-x', selfId: 'owner-x', name: 'X', color: 2, ticket: 'memory:<x>', lastSeen: '2026-10-07T00:00:00.000Z',
    }]))

    const calls = new Map<string, number>()
    let reached: () => void = () => undefined
    const atTarget = new Promise<void>((resolve) => { reached = resolve })
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    probe.enter = async (step) => {
      calls.set(step, (calls.get(step) ?? 0) + 1)
      if (step !== target) return
      reached()
      await gate
    }

    const starting = service.ensureStarted()
    starting.catch(() => undefined)
    await atTarget
    const closing = service.close()
    release()
    await closing
    await expect(starting).rejects.toThrow(/already closed/u)
    // A redial scheduled by a start that went on would dial within a few ms.
    await new Promise((resolve) => { setTimeout(resolve, 80) })

    const reachedSteps = STEPS.slice(0, STEPS.indexOf(target) + 1)
    for (const step of STEPS as readonly Step[]) {
      expect(calls.get(step) ?? 0, `calls of ${step}`).toBe(reachedSteps.includes(step) ? 1 : 0)
    }
    expect(transport.accepts).toBe(0)
    expect(transport.dials).toBe(0)
    expect(transport.closes).toBe(1)
    expect(service.peers()).toHaveLength(STEPS.indexOf(target) >= STEPS.indexOf('selfId') ? 1 : 0)
  })
})
