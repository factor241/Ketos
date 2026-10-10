// The service's default iroh transport across a failing start: one loopback
// endpoint serves every retry instead of one bound node per attempt.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OwnerId } from '@ketos/board-doc/types'
import { createIrohTransport } from '../src/iroh-transport.ts'
import { KetosPeerService } from '../src/service.ts'

vi.mock('../src/iroh-transport.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/iroh-transport.ts')>()
  return { ...actual, createIrohTransport: vi.fn(actual.createIrohTransport) }
})

/** Board-document stand-in whose first reads fail, after the node has bound. */
class FlakyBoardDoc extends Service {
  failures = 2

  constructor(ctx: Context) {
    super(ctx, 'ketosBoardDoc')
  }

  /** {@inheritDoc KetosBoardDocService.selfId} */
  async selfId(): Promise<OwnerId> {
    if (this.failures > 0) {
      this.failures -= 1
      throw new Error('board document is not ready')
    }
    return brandString<OwnerId>('owner-a')
  }

  /** {@inheritDoc KetosBoardDocService.participants} */
  async participants(): Promise<never[]> {
    return []
  }

  /** {@inheritDoc KetosBoardDocService.putOwnParticipant} */
  async putOwnParticipant(): Promise<void> {}
}

let cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups = []
  vi.mocked(createIrohTransport).mockClear()
})

describe('peer service default transport', () => {
  it('reuses one bound iroh node across failed start attempts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-peer-start-'))
    const ctx = new Context()
    const board = new FlakyBoardDoc(ctx)
    const service = new KetosPeerService(ctx, {
      name: 'Кирилл',
      relayUrls: [],
      keyPath: join(root, 'peer.key'),
      peersPath: join(root, 'peers.json'),
      bindAddr: '127.0.0.1:0',
      maxFrameBytes: 1_000_000,
      onlineTimeoutMs: 500,
      connectTimeoutMs: 500,
      reconnectMinMs: 50,
      reconnectMaxMs: 200,
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

    await expect(service.ensureStarted()).rejects.toThrow(/not ready/u)
    await expect(service.ensureStarted()).rejects.toThrow(/not ready/u)
    await service.ensureStarted()
    expect(board.failures).toBe(0)
    expect(vi.mocked(createIrohTransport)).toHaveBeenCalledTimes(1)
  })
})
