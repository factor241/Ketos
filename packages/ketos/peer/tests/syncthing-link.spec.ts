// Linking two Syncthing devices over the peer channel: each Ketos sends its
// own device id when a channel connects, and applies the other side's id to
// its local Syncthing — the device first, then the shared folder — through
// one queue, idempotently, replacing the device of a peer whose id changed,
// retrying while Syncthing does not answer yet or answers with a server
// error, and stopping with one log line when Syncthing refuses a request.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OwnerId } from '@ketos/board-doc/types'
import { SyncthingClient } from '../src/syncthing-client.ts'
import type { SyncthingDeviceId } from '../src/syncthing-device-id.ts'
import {
  parseSyncthingDeviceFrame, peerDeviceName, peerOfDeviceName, registerSyncthingLink, type SyncthingDeviceFrame,
  type SyncthingLinkOptions,
} from '../src/syncthing-link.ts'
import type { KetosPeerId } from '../src/types.ts'
import { DEVICE_IDS, FAKE_API_KEY, FAKE_RELAY_TOKEN, FakeSyncthing, RELAY_ADDRESS } from './syncthing-fake.ts'

const SELF = brandString<SyncthingDeviceId>(DEVICE_IDS[0])
const DEVICE_A = brandString<SyncthingDeviceId>(DEVICE_IDS[1])
const DEVICE_B = brandString<SyncthingDeviceId>(DEVICE_IDS[2])
const DEVICE_A2 = brandString<SyncthingDeviceId>(DEVICE_IDS[3])
const PEER_A = brandString<KetosPeerId>('a'.repeat(64))
const PEER_B = brandString<KetosPeerId>('b'.repeat(64))
const FOLDER = 'ketos-shared'

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

/** A stand-in for the peer node: one handler slot and a send log. */
class FakeLinkPeer {
  handler: ((payload: unknown, from: KetosPeerId) => unknown) | undefined
  readonly sent: Array<{ readonly peerId: KetosPeerId; readonly payload: SyncthingDeviceFrame }> = []
  /** When set, `send` fails as for a peer without a channel. */
  sendFails = false

  handle(type: 'syncthing.device', handler: (payload: unknown, from: KetosPeerId) => unknown): () => void {
    expect(type).toBe('syncthing.device')
    this.handler = handler
    return () => { this.handler = undefined }
  }

  send(peerId: KetosPeerId, type: 'syncthing.device', payload: SyncthingDeviceFrame): Promise<void> {
    expect(type).toBe('syncthing.device')
    if (this.sendFails) return Promise.reject(new Error(`peer ${peerId} is not connected`))
    this.sent.push({ peerId, payload })
    return Promise.resolve()
  }

  /**
   * Deliver one frame as the channel would.
   * @param from - the sending peer.
   * @param payload - the frame body.
   */
  deliver(from: KetosPeerId, payload: unknown): void {
    expect(this.handler).toBeDefined()
    this.handler?.(payload, from)
  }
}

/** One wired side. */
interface Side {
  readonly ctx: Context
  readonly peer: FakeLinkPeer
  readonly fake: FakeSyncthing
  readonly logs: string[]
  /** Ends the client's requests, as the feature's lifetime does at disposal. */
  readonly lifetime: AbortController
}

/**
 * Wire the linking of one Ketos to a fake Syncthing.
 * @param options - overrides of the link options.
 * @param enabled - false wires a feature whose key was not set.
 * @returns the side.
 */
function createSide(options: Partial<SyncthingLinkOptions> = {}, enabled = true): Side {
  const ctx = new Context()
  const peer = new FakeLinkPeer()
  const fake = new FakeSyncthing()
  const logs: string[] = []
  const lifetime = new AbortController()
  const client = new SyncthingClient({
    url: 'http://127.0.0.1:8384', readApiKey: () => Promise.resolve(FAKE_API_KEY), requestTimeoutMs: 1000, signal: lifetime.signal, fetch: fake.fetch,
  })
  registerSyncthingLink(ctx, peer, Promise.resolve(enabled ? client : undefined), {
    relayAddress: RELAY_ADDRESS,
    folderId: FOLDER,
    folderPath: '/workspace/shared',
    fsWatcherDelayS: 1,
    retryMs: 20,
    kickAfterLostMs: 90_000,
    logger: (message) => { logs.push(message) },
    ...options,
  })
  cleanups.push(() => { lifetime.abort() })
  cleanups.push(() => ctx.fiber.dispose())
  return { ctx, peer, fake, logs, lifetime }
}

/**
 * Announce one connected peer on a side's context.
 * @param side - the side.
 * @param peerId - the peer.
 */
function connect(side: Side, peerId: KetosPeerId): void {
  side.ctx.emit('ketos-peer/connected', { peerId, selfId: brandString<OwnerId>('owner'), name: 'X', color: 1 })
}

/**
 * Announce one forgotten peer on a side's context, as `forget` does once the
 * known-peer file no longer lists it.
 * @param side - the side.
 * @param peerId - the peer.
 */
function forget(side: Side, peerId: KetosPeerId): void {
  side.ctx.emit('ketos-peer/forgotten', { peerId })
}

/**
 * Wait until the side's queue settled: no request for a few retry periods.
 * @param side - the side.
 */
async function settle(side: Side): Promise<void> {
  let seen = -1
  await vi.waitFor(async () => {
    const count = side.fake.requests.length
    const stable = count === seen
    seen = count
    await pause(30)
    expect(stable && side.fake.requests.length === count).toBe(true)
  }, { timeout: 3000, interval: 10 })
}

/**
 * Wait for a number of milliseconds.
 * @param ms - the pause.
 * @returns a promise settling after the pause.
 */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * Hold every request of a side's fake until the returned gate opens.
 * @param side - the side.
 * @returns the gate; `release` answers the held requests and every later one at once.
 */
function hold(side: Side): { readonly release: () => void } {
  let open: () => void = () => undefined
  side.fake.delay = new Promise((resolve) => { open = resolve })
  return {
    release: () => {
      side.fake.delay = undefined
      open()
    },
  }
}

/**
 * Lines that would expose a secret or an address.
 * @param logs - captured lines.
 * @returns the offending lines.
 */
function leaking(logs: readonly string[]): string[] {
  return logs.filter(line => line.includes(FAKE_API_KEY) || line.includes(FAKE_RELAY_TOKEN) || line.includes('relay://'))
}

describe('syncthing.device frame', () => {
  it('accepts exactly one field holding a canonical device id', () => {
    expect(parseSyncthingDeviceFrame({ deviceId: DEVICE_A })).toBe(DEVICE_A)
  })

  it('refuses a wrong length, alphabet, lowercase, check character, extra field, or shape', () => {
    const wrongCheck = `${DEVICE_A.slice(0, -1)}${DEVICE_A.endsWith('A') ? 'B' : 'A'}`
    for (const payload of [
      { deviceId: DEVICE_A.slice(0, -1) },
      { deviceId: `${DEVICE_A.slice(0, 3)}0${DEVICE_A.slice(4)}` },
      { deviceId: DEVICE_A.toLowerCase() },
      { deviceId: wrongCheck },
      { deviceId: DEVICE_A, name: 'x' },
      { deviceID: DEVICE_A },
      {},
      [DEVICE_A],
      DEVICE_A,
      null,
    ]) {
      expect(parseSyncthingDeviceFrame(payload), JSON.stringify(payload)).toBeUndefined()
    }
  })
})

describe('peer device names', () => {
  it('round-trips a peer id through the device name and refuses a name that names no valid peer id', () => {
    expect(peerDeviceName(PEER_A)).toBe(`ketos:${PEER_A}`)
    expect(peerOfDeviceName(peerDeviceName(PEER_A))).toBe(PEER_A)
    expect(peerOfDeviceName(`ketos:${'c'.repeat(512)}`)).toBe('c'.repeat(512))
    for (const name of ['laptop', 'ketos:', `ketos:${'c'.repeat(513)}`, `Ketos:${PEER_A}`]) {
      expect(peerOfDeviceName(name), name).toBeUndefined()
    }
  })
})

describe('Syncthing linking over the channel', () => {
  it('sends its own device id when a channel connects', async () => {
    const side = createSide()
    connect(side, PEER_A)
    await vi.waitFor(() => { expect(side.peer.sent).toEqual([{ peerId: PEER_A, payload: { deviceId: SELF } }]) })
    expect(side.fake.writes()).toEqual([])
  })

  it('refuses an invalid frame with a log line and no request', async () => {
    const side = createSide()
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A.toLowerCase() })
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A, extra: 1 })
    await settle(side)
    expect(side.logs).toEqual([
      `ketos-peer: syncthing.device-invalid from ${PEER_A.slice(0, 12)}: not exactly one canonical deviceId`,
      `ketos-peer: syncthing.device-invalid from ${PEER_A.slice(0, 12)}: not exactly one canonical deviceId`,
    ])
    expect(side.fake.requests).toEqual([])
  })

  it('refuses this Syncthing\'s own id from a peer without writing', async () => {
    const side = createSide()
    side.peer.deliver(PEER_A, { deviceId: SELF })
    await settle(side)
    expect(side.fake.writes()).toEqual([])
    expect(side.logs).toEqual([`ketos-peer: syncthing.device-invalid from ${PEER_A.slice(0, 12)}: the own device id`])
  })

  it('adds the device with a full body first, then creates the folder once with a full body', async () => {
    const side = createSide()
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await settle(side)
    expect(side.fake.writes().map(request => [request.method, request.path, request.body])).toEqual([
      ['PUT', `/rest/config/devices/${DEVICE_A}`, {
        deviceID: DEVICE_A, name: `ketos:${PEER_A}`, addresses: [RELAY_ADDRESS], autoAcceptFolders: false, paused: false,
      }],
      ['PUT', `/rest/config/folders/${FOLDER}`, {
        id: FOLDER, path: '/workspace/shared', type: 'sendreceive', fsWatcherEnabled: true, fsWatcherDelayS: 1,
        devices: [{ deviceID: DEVICE_A }],
      }],
    ])
    expect(side.fake.folderDevices(FOLDER)).toEqual([SELF, DEVICE_A].sort())
    expect(side.logs).toEqual([`ketos-peer: syncthing.linked ${PEER_A.slice(0, 12)}`])
    expect(leaking(side.logs)).toEqual([])
  })

  it('makes zero writing requests for a repeated frame', async () => {
    const side = createSide()
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await settle(side)
    const writes = side.fake.writes().length
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await settle(side)
    expect(side.fake.writes()).toHaveLength(writes)
    expect(side.logs).toHaveLength(1)
  })

  it('rewrites a device whose stored fields drifted, and nothing else', async () => {
    const side = createSide()
    side.fake.seedLinked(FOLDER, DEVICE_A, `ketos:${PEER_A}`, ['dynamic'])
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await settle(side)
    expect(side.fake.writes().map(request => [request.method, request.path])).toEqual([['PUT', `/rest/config/devices/${DEVICE_A}`]])
  })

  it('creates the folder once and lets a second participant join without displacing the first', async () => {
    const side = createSide()
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    side.peer.deliver(PEER_B, { deviceId: DEVICE_B })
    await settle(side)
    const folderWrites = side.fake.writes().filter(request => request.path === `/rest/config/folders/${FOLDER}`)
    expect(folderWrites.map(request => request.method)).toEqual(['PUT', 'PATCH'])
    expect(side.fake.folderDevices(FOLDER)).toEqual([SELF, DEVICE_A, DEVICE_B].sort())
    expect([...side.fake.devices.keys()].sort()).toEqual([SELF, DEVICE_A, DEVICE_B].sort())
  })

  it('replaces the device of a peer whose Syncthing id changed, so the device list does not grow', async () => {
    const side = createSide()
    side.fake.seedLinked(FOLDER, DEVICE_A, `ketos:${PEER_A}`, [RELAY_ADDRESS])
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A2 })
    await settle(side)
    expect([...side.fake.devices.keys()].sort()).toEqual([SELF, DEVICE_A2].sort())
    expect(side.fake.folderDevices(FOLDER)).toEqual([SELF, DEVICE_A2].sort())
    expect(side.fake.writes().map(request => [request.method, request.path])).toEqual([
      ['PUT', `/rest/config/devices/${DEVICE_A2}`],
      ['PATCH', `/rest/config/folders/${FOLDER}`],
      ['DELETE', `/rest/config/devices/${DEVICE_A}`],
    ])
    expect(side.logs).toEqual([
      `ketos-peer: syncthing.device-replaced ${PEER_A.slice(0, 12)}: 1 previous device removed`,
      `ketos-peer: syncthing.linked ${PEER_A.slice(0, 12)}`,
    ])
  })

  it('removes a previous device of the peer that is no longer in the folder', async () => {
    const side = createSide()
    side.fake.seedLinked(FOLDER, DEVICE_A2, `ketos:${PEER_A}`, [RELAY_ADDRESS])
    side.fake.devices.set(DEVICE_A, { ...side.fake.devices.get(DEVICE_A2), deviceID: DEVICE_A })
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A2 })
    await settle(side)
    expect([...side.fake.devices.keys()].sort()).toEqual([SELF, DEVICE_A2].sort())
    expect(side.fake.writes().map(request => request.method)).toEqual(['DELETE'])
  })

  it('retries while Syncthing does not answer, then sends its id and links after it answers', async () => {
    const side = createSide()
    side.fake.down = true
    connect(side, PEER_A)
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await vi.waitFor(() => { expect(side.fake.requests.length).toBeGreaterThan(8) })
    expect(side.peer.sent).toEqual([])
    // One line per retrying step, however often it retried.
    expect(side.logs.filter(line => line.includes('syncthing.retry'))).toHaveLength(2)
    side.fake.down = false
    await vi.waitFor(() => { expect(side.peer.sent).toEqual([{ peerId: PEER_A, payload: { deviceId: SELF } }]) })
    await settle(side)
    expect(side.fake.folderDevices(FOLDER)).toEqual([SELF, DEVICE_A].sort())
    expect(side.logs.at(-1)).toBe(`ketos-peer: syncthing.linked ${PEER_A.slice(0, 12)}`)
    expect(leaking(side.logs)).toEqual([])
  })

  it('resends its id after a failed send while the channel stays connected', async () => {
    const side = createSide()
    side.peer.sendFails = true
    connect(side, PEER_A)
    await vi.waitFor(() => { expect(side.logs.some(line => line.includes('syncthing.retry'))).toBe(true) })
    side.peer.sendFails = false
    await vi.waitFor(() => { expect(side.peer.sent).toHaveLength(1) })
  })

  it('makes one folder PATCH when a frame and a connection arrive at the same moment, and loses no device', async () => {
    const side = createSide()
    side.fake.seedLinked(FOLDER, DEVICE_B, `ketos:${PEER_B}`, [RELAY_ADDRESS])
    const gate = hold(side)
    connect(side, PEER_A)
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    // The announcement and the first application both wait inside their first request.
    await vi.waitFor(() => { expect(side.fake.requests).toHaveLength(2) })
    // The peer's own connection event makes it send its id again while the first application runs.
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await pause(20)
    gate.release()
    await settle(side)
    expect(side.fake.writes().map(request => [request.method, request.path])).toEqual([
      ['PUT', `/rest/config/devices/${DEVICE_A}`],
      ['PATCH', `/rest/config/folders/${FOLDER}`],
    ])
    expect(side.fake.folderDevices(FOLDER)).toEqual([SELF, DEVICE_A, DEVICE_B].sort())
    expect(side.peer.sent).toEqual([{ peerId: PEER_A, payload: { deviceId: SELF } }])
  })

  it('drops a queued application of a peer that disconnected before it ran', async () => {
    const side = createSide()
    const gate = hold(side)
    side.peer.deliver(PEER_B, { deviceId: DEVICE_B })
    await vi.waitFor(() => { expect(side.fake.requests).toHaveLength(1) })
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await pause(20)
    // Peer A's application waits in the queue behind peer B's, so it has sent nothing.
    expect(side.fake.requests).toHaveLength(1)
    side.ctx.emit('ketos-peer/disconnected', { peerId: PEER_A })
    gate.release()
    await settle(side)
    expect([...side.fake.devices.keys()].sort()).toEqual([SELF, DEVICE_B].sort())
    expect(side.fake.folderDevices(FOLDER)).toEqual([SELF, DEVICE_B].sort())
    expect(side.logs).toEqual([`ketos-peer: syncthing.linked ${PEER_B.slice(0, 12)}`])
  })

  it('skips a queued application that a newer id from the same peer superseded', async () => {
    const side = createSide()
    const gate = hold(side)
    side.peer.deliver(PEER_B, { deviceId: DEVICE_B })
    await vi.waitFor(() => { expect(side.fake.requests).toHaveLength(1) })
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await pause(20)
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A2 })
    gate.release()
    await settle(side)
    expect(side.fake.writes().filter(request => request.path.includes(DEVICE_A))).toEqual([])
    expect([...side.fake.devices.keys()].sort()).toEqual([SELF, DEVICE_B, DEVICE_A2].sort())
    expect(side.fake.folderDevices(FOLDER)).toEqual([SELF, DEVICE_B, DEVICE_A2].sort())
  })

  it('stops a step that Syncthing refuses, with one log line per step and no retry', async () => {
    const side = createSide()
    side.fake.apiKey = 'another-key'
    connect(side, PEER_A)
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await settle(side)
    await pause(100)
    expect(side.fake.requests.map(request => request.path)).toEqual(['/rest/system/status', '/rest/system/status'])
    const refused = 'failed (SyncthingError: syncthing GET /rest/system/status: HTTP 403); the next channel connection tries again'
    expect([...side.logs].sort()).toEqual([
      `ketos-peer: syncthing.link-stopped: announcing the device id to ${PEER_A.slice(0, 12)} ${refused}`,
      `ketos-peer: syncthing.link-stopped: linking ${PEER_A.slice(0, 12)} ${refused}`,
    ])
    expect(side.peer.sent).toEqual([])
    expect(leaking(side.logs)).toEqual([])
  })

  it('retries a step while Syncthing answers with a server error, logging once', async () => {
    const side = createSide()
    side.fake.overrides.set('GET /rest/system/status', () => new Response('starting', { status: 503 }))
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await vi.waitFor(() => { expect(side.fake.requests.length).toBeGreaterThan(3) })
    side.fake.overrides.clear()
    await settle(side)
    expect(side.fake.folderDevices(FOLDER)).toEqual([SELF, DEVICE_A].sort())
    expect(side.logs).toEqual([
      `ketos-peer: syncthing.retry: linking ${PEER_A.slice(0, 12)} failed (SyncthingError: syncthing GET /rest/system/status: HTTP 503); retrying every 20 ms`,
      `ketos-peer: syncthing.linked ${PEER_A.slice(0, 12)}`,
    ])
  })

  it('applies only the latest id when a peer sends a new one before the previous was applied', async () => {
    const side = createSide()
    side.fake.down = true
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A2 })
    await vi.waitFor(() => { expect(side.fake.requests.length).toBeGreaterThan(4) })
    side.fake.down = false
    await settle(side)
    expect([...side.fake.devices.keys()].sort()).toEqual([SELF, DEVICE_A2].sort())
  })

  it('stops retrying when the channel disconnects', async () => {
    const side = createSide()
    side.fake.down = true
    connect(side, PEER_A)
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await vi.waitFor(() => { expect(side.fake.requests.length).toBeGreaterThan(4) })
    side.ctx.emit('ketos-peer/disconnected', { peerId: PEER_A })
    await settle(side)
    const count = side.fake.requests.length
    side.fake.down = false
    await pause(100)
    expect(side.fake.requests).toHaveLength(count)
    expect(side.fake.writes()).toEqual([])
    expect(side.peer.sent).toEqual([])
  })

  it('stops retrying and withdraws the handler when the plugin disposes', async () => {
    const side = createSide()
    side.fake.down = true
    connect(side, PEER_A)
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await vi.waitFor(() => { expect(side.fake.requests.length).toBeGreaterThan(4) })
    await side.ctx.fiber.dispose()
    expect(side.peer.handler).toBeUndefined()
    const count = side.fake.requests.length
    side.fake.down = false
    await pause(100)
    expect(side.fake.requests).toHaveLength(count)
    expect(side.fake.writes()).toEqual([])
  })

  it('logs nothing for a step that fails after its channel disconnected', async () => {
    const side = createSide()
    side.fake.hang = true
    connect(side, PEER_A)
    await vi.waitFor(() => { expect(side.fake.requests).toHaveLength(1) })
    side.ctx.emit('ketos-peer/disconnected', { peerId: PEER_A })
    side.lifetime.abort()
    await pause(50)
    expect(side.logs).toEqual([])
    expect(side.fake.requests).toHaveLength(1)
  })

  it('ignores frames and connections while the feature is off', async () => {
    const side = createSide({}, false)
    connect(side, PEER_A)
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await pause(50)
    expect(side.fake.requests).toEqual([])
    expect(side.peer.sent).toEqual([])
    expect(side.logs).toEqual([])
  })
})

describe('Syncthing unlinking of a forgotten peer', () => {
  it('removes the forgotten peer\'s device from the folder, then from the configuration, and keeps the other peer', async () => {
    const side = createSide()
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    side.peer.deliver(PEER_B, { deviceId: DEVICE_B })
    await settle(side)
    const before = side.fake.writes().length
    forget(side, PEER_A)
    await settle(side)
    expect(side.fake.writes().slice(before).map(request => [request.method, request.path, request.body])).toEqual([
      ['PATCH', `/rest/config/folders/${FOLDER}`, { devices: [SELF, DEVICE_B].sort().map(deviceID => ({ deviceID })) }],
      ['DELETE', `/rest/config/devices/${DEVICE_A}`, undefined],
    ])
    expect(side.fake.folderDevices(FOLDER)).toEqual([SELF, DEVICE_B].sort())
    expect([...side.fake.devices.keys()].sort()).toEqual([SELF, DEVICE_B].sort())
    expect(side.logs.at(-1)).toBe(`ketos-peer: syncthing.unlinked ${PEER_A.slice(0, 12)}: 1 device removed`)
    expect(leaking(side.logs)).toEqual([])
  })

  it('removes a device of the forgotten peer that no folder shares, and never the own device', async () => {
    const missingFolder = createSide()
    missingFolder.fake.devices.set(DEVICE_A, { ...missingFolder.fake.devices.get(SELF), deviceID: DEVICE_A, name: `ketos:${PEER_A}` })
    forget(missingFolder, PEER_A)
    await settle(missingFolder)
    expect(missingFolder.fake.writes().map(request => [request.method, request.path])).toEqual([['DELETE', `/rest/config/devices/${DEVICE_A}`]])

    const otherFolder = createSide()
    otherFolder.fake.seedLinked(FOLDER, DEVICE_B, `ketos:${PEER_B}`, [RELAY_ADDRESS])
    otherFolder.fake.devices.set(DEVICE_A, { ...otherFolder.fake.devices.get(DEVICE_B), deviceID: DEVICE_A, name: `ketos:${PEER_A}` })
    // An operator renamed the own device after the peer; it stays.
    otherFolder.fake.devices.set(SELF, { ...otherFolder.fake.devices.get(SELF), name: `ketos:${PEER_A}` })
    forget(otherFolder, PEER_A)
    await settle(otherFolder)
    expect(otherFolder.fake.writes().map(request => [request.method, request.path])).toEqual([['DELETE', `/rest/config/devices/${DEVICE_A}`]])
    expect([...otherFolder.fake.devices.keys()].sort()).toEqual([SELF, DEVICE_B].sort())
  })

  it('writes and logs nothing for a forgotten peer that has no device', async () => {
    const side = createSide()
    side.peer.deliver(PEER_B, { deviceId: DEVICE_B })
    await settle(side)
    const writes = side.fake.writes().length
    forget(side, PEER_A)
    await settle(side)
    expect(side.fake.writes()).toHaveLength(writes)
    expect(side.logs).toEqual([`ketos-peer: syncthing.linked ${PEER_B.slice(0, 12)}`])
  })

  it('retries the removal while Syncthing does not answer, logging once', async () => {
    const side = createSide()
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await settle(side)
    side.fake.down = true
    forget(side, PEER_A)
    await vi.waitFor(() => { expect(side.fake.requests.filter(request => request.path === '/rest/system/status').length).toBeGreaterThan(4) })
    side.fake.down = false
    await settle(side)
    expect([...side.fake.devices.keys()]).toEqual([SELF])
    expect(side.logs.slice(1)).toEqual([
      `ketos-peer: syncthing.retry: unlinking ${PEER_A.slice(0, 12)} failed (SyncthingError: syncthing GET /rest/system/status: no answer); retrying every 20 ms`,
      `ketos-peer: syncthing.unlinked ${PEER_A.slice(0, 12)}: 1 device removed`,
    ])
  })

  it('stops a removal that Syncthing refuses with one log line that says the device stays', async () => {
    const side = createSide()
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await settle(side)
    side.fake.overrides.set(`DELETE /rest/config/devices/${DEVICE_A}`, () => new Response('forbidden', { status: 403 }))
    forget(side, PEER_A)
    await settle(side)
    await pause(60)
    expect(side.fake.writes().filter(request => request.method === 'DELETE')).toHaveLength(1)
    expect(side.logs.slice(1)).toEqual([
      `ketos-peer: syncthing.link-stopped: unlinking ${PEER_A.slice(0, 12)} failed (SyncthingError: syncthing DELETE /rest/config/devices/${DEVICE_A}: HTTP 403); the device stays configured until it is removed in the Syncthing GUI`,
    ])
  })

  it('drops a pending removal when the peer sends its device id again after a new invitation', async () => {
    const side = createSide()
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await settle(side)
    side.fake.down = true
    forget(side, PEER_A)
    await vi.waitFor(() => { expect(side.logs.some(line => line.includes('unlinking'))).toBe(true) })
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    side.fake.down = false
    await settle(side)
    expect(side.fake.writes().filter(request => request.method === 'DELETE')).toEqual([])
    expect(side.fake.folderDevices(FOLDER)).toEqual([SELF, DEVICE_A].sort())
  })

  it('skips a queued removal that a device id the peer sent again superseded', async () => {
    const side = createSide()
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await settle(side)
    const before = side.fake.writes().length
    const gate = hold(side)
    side.peer.deliver(PEER_B, { deviceId: DEVICE_B })
    await vi.waitFor(() => { expect(side.fake.requests.filter(request => request.path === '/rest/system/status')).toHaveLength(2) })
    // The removal waits in the queue behind peer B's application.
    forget(side, PEER_A)
    await pause(20)
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    gate.release()
    await settle(side)
    expect(side.fake.writes().slice(before).filter(request => request.method === 'DELETE' || request.path.includes(DEVICE_A))).toEqual([])
    expect(side.fake.folderDevices(FOLDER)).toEqual([SELF, DEVICE_A, DEVICE_B].sort())
    expect(side.logs.some(line => line.includes('unlinked'))).toBe(false)
  })

  it('makes no request for a forgotten peer while the feature is off', async () => {
    const side = createSide({}, false)
    forget(side, PEER_A)
    await pause(50)
    expect(side.fake.requests).toEqual([])
    expect(side.logs).toEqual([])
  })
})

describe('Syncthing connection restart after a long channel loss', () => {
  // Only `Date` is faked: the outage is measured on the wall clock, while the
  // queue, the retries, and the settle helper keep their real timers.
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }) })
  afterEach(() => { vi.useRealTimers() })

  /** The pause and resume requests a side sent, in order. */
  function kicks(side: Side): string[] {
    return side.fake.writes().filter(request => request.path.startsWith('/rest/system/')).map(request => `${request.method} ${request.path}`)
  }

  /** The configuration writes a side sent. */
  function configWrites(side: Side): string[] {
    return side.fake.writes().filter(request => request.path.startsWith('/rest/config/')).map(request => `${request.method} ${request.path}`)
  }

  /**
   * End the peer's channel, let the given time pass, connect it again, and
   * deliver the peer's device id as the new channel does.
   * @param side - the side.
   * @param lostMs - how long the channel stays lost.
   * @param deviceId - the id the peer sends after the reconnection.
   */
  async function reconnectAfter(side: Side, lostMs: number, deviceId: SyncthingDeviceId = DEVICE_A): Promise<void> {
    side.ctx.emit('ketos-peer/disconnected', { peerId: PEER_A })
    vi.setSystemTime(Date.now() + lostMs)
    connect(side, PEER_A)
    side.peer.deliver(PEER_A, { deviceId })
    await settle(side)
  }

  /**
   * A side whose Syncthing already links peer A, connected once.
   * @returns the side.
   */
  async function linkedSide(): Promise<Side> {
    const side = createSide()
    side.fake.seedLinked(FOLDER, DEVICE_A, `ketos:${PEER_A}`, [RELAY_ADDRESS])
    connect(side, PEER_A)
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await settle(side)
    return side
  }

  it('pauses, then resumes an identical device after the channel was lost for kickAfterLostMs or longer, with no configuration write', async () => {
    const side = await linkedSide()
    await reconnectAfter(side, 95_000)
    expect(kicks(side)).toEqual([
      `POST /rest/system/pause?device=${DEVICE_A}`,
      `POST /rest/system/resume?device=${DEVICE_A}`,
    ])
    expect(configWrites(side)).toEqual([])
    expect(side.fake.devices.get(DEVICE_A)?.paused).toBe(false)
    expect(side.logs).toEqual([`ketos-peer: syncthing.reconnected ${PEER_A.slice(0, 12)}: paused and resumed the peer device`])
    await reconnectAfter(side, 90_000)
    expect(kicks(side)).toHaveLength(4)
  })

  it('leaves the connection alone after a shorter loss, after quick reconnections, and at the first connection', async () => {
    const side = await linkedSide()
    await reconnectAfter(side, 30_000)
    await reconnectAfter(side, 20_000)
    await reconnectAfter(side, 65_000)
    await reconnectAfter(side, 89_999)
    // A replaced link reports its end and the new connection at the same moment.
    await reconnectAfter(side, 0)
    // A second connection without a loss between, as a duplicate dial produces.
    connect(side, PEER_A)
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await settle(side)
    expect(kicks(side)).toEqual([])
    expect(side.fake.writes()).toEqual([])
  })

  it('restarts the connection once per long loss, not for a frame the peer sends again', async () => {
    const side = await linkedSide()
    await reconnectAfter(side, 120_000)
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await settle(side)
    expect(kicks(side)).toHaveLength(2)
  })

  it('does not restart the connection at the first linking or after the peer\'s device id changed', async () => {
    const first = createSide()
    connect(first, PEER_A)
    first.ctx.emit('ketos-peer/disconnected', { peerId: PEER_A })
    vi.setSystemTime(Date.now() + 120_000)
    connect(first, PEER_A)
    first.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await settle(first)
    // The peer's next frame on the same channel finds the device it just added.
    first.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await settle(first)
    expect(kicks(first)).toEqual([])
    expect(configWrites(first)).toEqual([`PUT /rest/config/devices/${DEVICE_A}`, `PUT /rest/config/folders/${FOLDER}`])

    const changed = await linkedSide()
    await reconnectAfter(changed, 120_000, DEVICE_A2)
    expect(kicks(changed)).toEqual([])
  })

  it('forgets the loss of a forgotten peer, so its next channel after a new invitation is a first connection', async () => {
    const side = await linkedSide()
    side.ctx.emit('ketos-peer/disconnected', { peerId: PEER_A })
    side.ctx.emit('ketos-peer/forgotten', { peerId: PEER_A })
    await settle(side)
    vi.setSystemTime(Date.now() + 120_000)
    connect(side, PEER_A)
    side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
    await settle(side)
    expect(kicks(side)).toEqual([])
  })

  it('resumes the device even when Syncthing refuses the pause, logging once', async () => {
    const side = await linkedSide()
    side.fake.overrides.set('POST /rest/system/pause', () => new Response('forbidden', { status: 403 }))
    await reconnectAfter(side, 95_000)
    expect(kicks(side)).toEqual([
      `POST /rest/system/pause?device=${DEVICE_A}`,
      `POST /rest/system/resume?device=${DEVICE_A}`,
    ])
    expect(side.fake.devices.get(DEVICE_A)?.paused).toBe(false)
    expect(side.logs).toEqual([
      `ketos-peer: syncthing.link-stopped: linking ${PEER_A.slice(0, 12)} failed (SyncthingError: syncthing POST /rest/system/pause?device=${DEVICE_A}: HTTP 403); the next channel connection tries again`,
    ])
  })

  it('restarts the connection again after a pause that failed transiently', async () => {
    const side = await linkedSide()
    side.fake.overrides.set('POST /rest/system/pause', () => {
      side.fake.overrides.delete('POST /rest/system/pause')
      return new Response('starting', { status: 503 })
    })
    await reconnectAfter(side, 95_000)
    expect(kicks(side).map(kick => kick.split('?')[0])).toEqual([
      'POST /rest/system/pause', 'POST /rest/system/resume', 'POST /rest/system/pause', 'POST /rest/system/resume',
    ])
    expect(side.fake.devices.get(DEVICE_A)?.paused).toBe(false)
    expect(side.logs.at(-1)).toBe(`ketos-peer: syncthing.reconnected ${PEER_A.slice(0, 12)}: paused and resumed the peer device`)
  })

  it('retries a failed resume until the device is resumed, logging once', async () => {
    const side = await linkedSide()
    let refusals = 2
    side.fake.overrides.set('POST /rest/system/resume', () => {
      if (refusals > 0) {
        refusals -= 1
        return new Response('starting', { status: 503 })
      }
      side.fake.devices.set(DEVICE_A, { ...side.fake.devices.get(DEVICE_A), paused: false })
      return new Response('', { status: 200 })
    })
    await reconnectAfter(side, 95_000)
    expect(side.fake.devices.get(DEVICE_A)?.paused).toBe(false)
    expect(kicks(side).filter(kick => kick.includes('/pause'))).toHaveLength(1)
    expect(configWrites(side)).toEqual([])
    expect(side.logs[0]).toBe(
      `ketos-peer: syncthing.retry: linking ${PEER_A.slice(0, 12)} failed (SyncthingError: syncthing POST /rest/system/resume?device=${DEVICE_A}: HTTP 503); retrying every 20 ms`,
    )
    expect(side.logs.filter(line => line.includes('syncthing.retry'))).toHaveLength(1)
  })

  it('resumes an identical device left paused with exactly one resume and no restart, whatever the loss', async () => {
    for (const lostMs of [undefined, 120_000]) {
      const side = createSide()
      side.fake.seedLinked(FOLDER, DEVICE_A, `ketos:${PEER_A}`, [RELAY_ADDRESS])
      if (lostMs === undefined) {
        // A Ketos that restarted after an interrupted restart: its first connection has no recorded loss.
        side.fake.devices.set(DEVICE_A, { ...side.fake.devices.get(DEVICE_A), paused: true })
        connect(side, PEER_A)
        side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
        await settle(side)
      } else {
        connect(side, PEER_A)
        side.peer.deliver(PEER_A, { deviceId: DEVICE_A })
        await settle(side)
        side.fake.devices.set(DEVICE_A, { ...side.fake.devices.get(DEVICE_A), paused: true })
        await reconnectAfter(side, lostMs)
      }
      expect(side.fake.writes().map(request => `${request.method} ${request.path}`), String(lostMs)).toEqual([
        `POST /rest/system/resume?device=${DEVICE_A}`,
      ])
      expect(side.fake.devices.get(DEVICE_A)?.paused).toBe(false)
      expect(side.logs).toEqual([`ketos-peer: syncthing.device-resumed ${PEER_A.slice(0, 12)}: the peer device was paused`])
    }
  })

  it('sends nothing after a long loss while the feature is off', async () => {
    const side = createSide({}, false)
    connect(side, PEER_A)
    await reconnectAfter(side, 120_000)
    expect(side.fake.requests).toEqual([])
  })
})
