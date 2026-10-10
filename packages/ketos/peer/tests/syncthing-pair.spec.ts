// Two Ketoses with real peer nodes and board documents over the in-memory
// transport, each beside its own fake Syncthing: the `syncthing.device`
// frames travel the real channel, and each side links the other's device and
// the shared folder; a reconnection re-checks without writing, a wiped
// Syncthing gets its device replaced, and a Syncthing that starts late is
// linked once it answers, and a forgotten peer's device leaves the folder and
// the configuration; the shared-folder state is `synced` only while the Ketos
// channel to the linked peer is online and the peer's Syncthing shares the
// folder back.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { KetosBoardDocService, type KetosBoardDocOptions } from '@ketos/board-doc/src/service.ts'
import { createMemoryTransports, type MemoryTransportPair } from '../src/memory-transport.ts'
import { KetosPeerService } from '../src/service.ts'
import type { SyncthingSettings } from '../src/syncthing-config.ts'
import { registerSyncthing } from '../src/syncthing.ts'
import type { PeerTransport } from '../src/transport.ts'
import type { SharedFolderState } from '../src/types.ts'
import { DEVICE_IDS, FAKE_API_KEY, FakeSyncthing, RELAY_ADDRESS } from './syncthing-fake.ts'

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

const SETTINGS: SyncthingSettings = {
  url: 'http://127.0.0.1:8384',
  apiKeyEnv: 'STGUIAPIKEY',
  relayAddress: RELAY_ADDRESS,
  folderId: 'ketos-shared',
  folderPath: '/workspace/shared',
  fsWatcherDelayS: 1,
  statusRefreshMs: 60_000,
  requestTimeoutMs: 1000,
  retryMs: 20,
  kickAfterLostMs: 90_000,
}

/** One Ketos of the pair. */
interface Side {
  readonly service: KetosPeerService
  /** The Syncthing this side talks to; a test may replace it, as a wiped volume would. */
  syncthing: FakeSyncthing
  readonly logs: string[]
}

/** Per-side overrides. */
interface SideOverrides {
  /** Settings fields that replace the shared ones. */
  readonly settings?: Partial<SyncthingSettings>
  /** False builds a side whose Syncthing key is not set. */
  readonly keySet?: boolean
}

/**
 * Build one Ketos: a board document, a peer node over the given transport,
 * and the Syncthing feature against a fake.
 * @param name - participant name.
 * @param transport - the side's endpoint.
 * @param syncthing - the side's fake Syncthing.
 * @param overrides - settings and key overrides.
 * @returns the side.
 */
async function createSide(name: string, transport: PeerTransport, syncthing: FakeSyncthing, overrides: SideOverrides = {}): Promise<Side> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-peer-syncthing-'))
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  const ctx = new Context()
  const boardOptions: KetosBoardDocOptions = {
    path: join(root, 'board.db'),
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
  // As in the plugin entry: the service reads the feature's state through a
  // reader it receives at construction, before the feature exists.
  let sharedFolder: () => SharedFolderState | undefined = () => undefined
  const service = new KetosPeerService(ctx, {
    name,
    relayUrls: [],
    keyPath: join(root, 'peer.key'),
    peersPath: join(root, 'peers.json'),
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
    transport,
    sharedFolder: () => sharedFolder(),
  })
  const side: Side = { service, syncthing, logs: [] }
  sharedFolder = registerSyncthing(ctx, service, { ...SETTINGS, ...overrides.settings }, {
    logger: (message) => { side.logs.push(message) },
    resolveApiKey: () => Promise.resolve(overrides.keySet === false ? undefined : FAKE_API_KEY),
    fetch: (url, init) => side.syncthing.fetch(url, init),
  }).sharedFolder
  cleanups.push(() => board.close())
  cleanups.push(() => ctx.fiber.dispose())
  cleanups.push(() => service.close())
  return side
}

/** Both sides and their transport controls. */
interface Pair {
  readonly a: Side
  readonly b: Side
  readonly transport: MemoryTransportPair
}

/**
 * Make one side's Syncthing report the other side's view of the folder the
 * way Syncthing derives it from the other's cluster configuration: the other
 * device shares the folder back once the other side's folder lists this side.
 * @param side - the side whose Syncthing answers.
 * @param other - the side whose folder decides.
 */
function mirrorRemoteState(side: Side, other: Side): void {
  side.syncthing.overrides.set('GET /rest/db/completion', () => Response.json({
    remoteState: other.syncthing.folderDevices('ketos-shared')?.includes(side.syncthing.myID) === true ? 'valid' : 'notSharing',
    needItems: 0,
    needDeletes: 0,
  }))
}

/**
 * Two sides with distinct Syncthing ids, each reporting the other's view of the folder.
 * @param overrides - settings and key overrides of both sides.
 * @returns the pair.
 */
async function createPair(overrides: SideOverrides = {}): Promise<Pair> {
  const transport = createMemoryTransports()
  const a = await createSide('Кирилл', transport.a, new FakeSyncthing(DEVICE_IDS[0]), overrides)
  const b = await createSide('Юрист', transport.b, new FakeSyncthing(DEVICE_IDS[1]), overrides)
  mirrorRemoteState(a, b)
  mirrorRemoteState(b, a)
  return { a, b, transport }
}

/**
 * Connect the pair through an invitation and wait until both links are online.
 * @param pair - the sides.
 */
async function connect(pair: Pair): Promise<void> {
  const code = await pair.a.service.invite()
  await pair.b.service.connect(code)
  await waitOnline(pair)
}

/**
 * Wait until both sides report the other online.
 * @param pair - the sides.
 */
async function waitOnline(pair: Pair): Promise<void> {
  await vi.waitFor(() => { expect(pair.a.service.peers()[0]?.link).toBe('online') })
  await vi.waitFor(() => { expect(pair.b.service.peers()[0]?.link).toBe('online') })
}

/**
 * Wait until one side's Syncthing has the other's device and shares the folder with it.
 * @param side - the side whose Syncthing is checked.
 * @param other - the other side.
 */
async function waitLinked(side: Side, other: Side): Promise<void> {
  const otherNode = await other.service.nodeId()
  await vi.waitFor(() => {
    expect(side.syncthing.devices.get(other.syncthing.myID)?.name).toBe(`ketos:${otherNode}`)
    expect(side.syncthing.folderDevices('ketos-shared')).toEqual([side.syncthing.myID, other.syncthing.myID].sort())
  }, { timeout: 3000 })
}

describe('Syncthing linking between two Ketoses', () => {
  it('links both devices and the shared folder over the channel', async () => {
    const pair = await createPair()
    await connect(pair)
    await waitLinked(pair.a, pair.b)
    await waitLinked(pair.b, pair.a)
    expect(pair.a.syncthing.devices.get(pair.b.syncthing.myID)?.addresses).toEqual([RELAY_ADDRESS])
    expect(pair.a.syncthing.writes().filter(request => request.path === '/rest/config/folders/ketos-shared')).toHaveLength(1)
  })

  it('re-checks the link at a reconnection after a short loss without writing', async () => {
    const pair = await createPair()
    await connect(pair)
    await waitLinked(pair.a, pair.b)
    await waitLinked(pair.b, pair.a)
    const writes = [pair.a.syncthing.writes().length, pair.b.syncthing.writes().length]
    const reads = pair.a.syncthing.requests.length
    pair.transport.dropConnections()
    // The reconnection's device frame makes A read its configuration again.
    await vi.waitFor(() => { expect(pair.a.syncthing.requests.length).toBeGreaterThan(reads + 3) })
    await waitOnline(pair)
    await new Promise((resolve) => { setTimeout(resolve, 100) })
    expect([pair.a.syncthing.writes().length, pair.b.syncthing.writes().length]).toEqual(writes)
  })

  it('restarts each Syncthing\'s connection to the peer device after a channel loss of kickAfterLostMs, with no configuration write', async () => {
    // Only `Date` is faked, so the outage can last 95 s while the channel's timers stay real.
    vi.useFakeTimers({ toFake: ['Date'] })
    cleanups.push(() => { vi.useRealTimers() })
    const pair = await createPair()
    await connect(pair)
    await waitLinked(pair.a, pair.b)
    await waitLinked(pair.b, pair.a)
    const before = [pair.a.syncthing.writes().length, pair.b.syncthing.writes().length] as const
    // B owns the redial; refusing its dials keeps the channel lost while the clock moves on.
    const dial = vi.spyOn(pair.transport.b, 'dial').mockRejectedValue(new Error('network down'))
    pair.transport.dropConnections()
    await vi.waitFor(() => {
      expect(pair.a.service.peers()[0]?.link).not.toBe('online')
      expect(pair.b.service.peers()[0]?.link).not.toBe('online')
    })
    vi.setSystemTime(Date.now() + 95_000)
    dial.mockRestore()
    await waitOnline(pair)
    for (const [side, other, start] of [[pair.a, pair.b, before[0]], [pair.b, pair.a, before[1]]] as const) {
      await vi.waitFor(() => {
        expect(side.syncthing.writes().slice(start).map(request => `${request.method} ${request.path}`)).toEqual([
          `POST /rest/system/pause?device=${other.syncthing.myID}`,
          `POST /rest/system/resume?device=${other.syncthing.myID}`,
        ])
      })
      expect(side.syncthing.devices.get(other.syncthing.myID)?.paused).toBe(false)
    }
    await new Promise((resolve) => { setTimeout(resolve, 100) })
    expect([pair.a.syncthing.writes().length - before[0], pair.b.syncthing.writes().length - before[1]]).toEqual([2, 2])
  })

  it('replaces the device of a peer whose Syncthing volume was wiped', async () => {
    const pair = await createPair()
    await connect(pair)
    await waitLinked(pair.a, pair.b)
    const previous = pair.b.syncthing.myID
    pair.b.syncthing = new FakeSyncthing(DEVICE_IDS[3])
    pair.transport.dropConnections()
    await waitLinked(pair.a, pair.b)
    await waitLinked(pair.b, pair.a)
    expect(pair.a.syncthing.devices.has(previous)).toBe(false)
    expect(pair.a.syncthing.devices.size).toBe(2)
  })

  it('links once a Syncthing that started late answers', async () => {
    const pair = await createPair()
    pair.b.syncthing.down = true
    await connect(pair)
    await vi.waitFor(() => { expect(pair.b.syncthing.requests.length).toBeGreaterThan(4) })
    pair.b.syncthing.down = false
    await waitLinked(pair.a, pair.b)
    await waitLinked(pair.b, pair.a)
  })

  it('reports the shared-folder state on the peer state, from waiting to synced', async () => {
    const pair = await createPair({ settings: { statusRefreshMs: 250 } })
    await vi.waitFor(async () => { expect((await pair.a.service.state()).sharedFolder).toBe('waiting') })
    await connect(pair)
    await waitLinked(pair.a, pair.b)
    // The fakes do not connect devices by themselves; the stand's relay would.
    pair.a.syncthing.connected.set(pair.b.syncthing.myID, 'relay-client')
    await vi.waitFor(async () => { expect((await pair.a.service.state()).sharedFolder).toBe('synced') }, { timeout: 3000 })
    pair.a.syncthing.down = true
    await vi.waitFor(async () => { expect((await pair.a.service.state()).sharedFolder).toBe('unavailable') }, { timeout: 3000 })
    expect(pair.a.logs).toContain('ketos-peer: syncthing.synced')
  })

  it('reports waiting while the peer\'s Syncthing has not set up the shared folder, and synced once it has', async () => {
    const pair = await createPair({ settings: { statusRefreshMs: 250 } })
    // B's Syncthing refuses the folder, so its linking stops with B's device added but no folder.
    pair.b.syncthing.overrides.set('PUT /rest/config/folders/ketos-shared', () => new Response('forbidden', { status: 403 }))
    await connect(pair)
    await waitLinked(pair.a, pair.b)
    await vi.waitFor(() => { expect(pair.b.logs.some(line => line.includes('syncthing.link-stopped'))).toBe(true) })
    pair.a.syncthing.connected.set(pair.b.syncthing.myID, 'relay-client')
    await vi.waitFor(() => {
      expect(pair.a.logs).toContain('ketos-peer: syncthing.waiting: no peer with an online Ketos channel shares the folder back yet')
    }, { timeout: 3000 })
    expect((await pair.a.service.state()).sharedFolder).toBe('waiting')
    // The next channel connection links B again, now that its Syncthing accepts the folder.
    pair.b.syncthing.overrides.delete('PUT /rest/config/folders/ketos-shared')
    pair.transport.dropConnections()
    await waitLinked(pair.b, pair.a)
    await vi.waitFor(async () => { expect((await pair.a.service.state()).sharedFolder).toBe('synced') }, { timeout: 3000 })
  })

  it('reports waiting while the Ketos channel is lost although Syncthing still reports the peer connected', async () => {
    const pair = await createPair({ settings: { statusRefreshMs: 250 } })
    await connect(pair)
    await waitLinked(pair.a, pair.b)
    pair.a.syncthing.connected.set(pair.b.syncthing.myID, 'relay-client')
    await vi.waitFor(async () => { expect((await pair.a.service.state()).sharedFolder).toBe('synced') }, { timeout: 3000 })
    // B owns the redial; refusing its dials keeps the channel lost while A's Syncthing still reports B connected.
    const dial = vi.spyOn(pair.transport.b, 'dial').mockRejectedValue(new Error('network down'))
    pair.transport.dropConnections()
    await vi.waitFor(async () => { expect((await pair.a.service.state()).sharedFolder).toBe('waiting') })
    expect(pair.a.service.peers()[0]?.link).not.toBe('online')
    expect(pair.a.syncthing.connected.has(pair.b.syncthing.myID)).toBe(true)
    dial.mockRestore()
    await waitOnline(pair)
    await vi.waitFor(async () => { expect((await pair.a.service.state()).sharedFolder).toBe('synced') }, { timeout: 3000 })
  })

  it('removes a forgotten peer\'s device from the shared folder and the configuration', async () => {
    const pair = await createPair()
    await connect(pair)
    await waitLinked(pair.a, pair.b)
    // B owns the redial; refusing its dials keeps the channel lost so A may forget B.
    vi.spyOn(pair.transport.b, 'dial').mockRejectedValue(new Error('network down'))
    pair.transport.dropConnections()
    await vi.waitFor(() => { expect(pair.a.service.peers()[0]?.link).toBe('lost') })
    const before = pair.a.syncthing.writes().length
    await pair.a.service.forget(await pair.b.service.nodeId())
    await vi.waitFor(() => { expect(pair.a.syncthing.devices.has(pair.b.syncthing.myID)).toBe(false) })
    expect(pair.a.syncthing.folderDevices('ketos-shared')).toEqual([pair.a.syncthing.myID])
    expect(pair.a.syncthing.writes().slice(before).map(request => request.method)).toEqual(['PATCH', 'DELETE'])
  })

  it('leaves the shared-folder state out while the feature is off', async () => {
    const pair = await createPair({ keySet: false })
    await vi.waitFor(() => { expect(pair.a.logs).toHaveLength(1) })
    expect(await pair.a.service.state()).not.toHaveProperty('sharedFolder')
    expect(pair.a.syncthing.requests).toEqual([])
  })
})
