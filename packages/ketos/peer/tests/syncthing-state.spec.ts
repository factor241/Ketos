// The shared-folder state the peer state route reports: one poll reads ping,
// the settings (once per Syncthing run), the folder, its status, the
// connections, and for an idle folder the device names and each peer
// device's completion of the folder, and maps them to unavailable / waiting /
// syncing / synced / error; `synced` also needs an online Ketos channel to a
// peer whose Syncthing shares the folder back and needs nothing, read at every
// state call; the poll loop runs every `statusRefreshMs` until the plugin
// disposes, and log lines appear only on transitions.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SyncthingClient } from '../src/syncthing-client.ts'
import type { SyncthingDeviceId } from '../src/syncthing-device-id.ts'
import { SyncthingMonitor } from '../src/syncthing-state.ts'
import type { KetosPeerId } from '../src/types.ts'
import { DEVICE_IDS, FAKE_API_KEY, FAKE_RELAY_TOKEN, FakeSyncthing, RELAY_ADDRESS } from './syncthing-fake.ts'

const PEER = brandString<SyncthingDeviceId>(DEVICE_IDS[1])
const OTHER = brandString<SyncthingDeviceId>(DEVICE_IDS[2])
const SELF_DEVICE = brandString<SyncthingDeviceId>(DEVICE_IDS[0])
const FOLDER = 'ketos-shared'

const lifetimes: AbortController[] = []
afterEach(() => {
  for (const lifetime of lifetimes) lifetime.abort()
  lifetimes.length = 0
})

/** One monitor over a fake. */
interface Watched {
  readonly fake: FakeSyncthing
  readonly monitor: SyncthingMonitor
  readonly logs: string[]
  readonly lifetime: AbortController
  /** Peers whose Ketos channel is online; holds the peer of `linked` until a spec changes it. */
  readonly online: Set<string>
}

/**
 * A monitor of a fake Syncthing.
 * @param statusRefreshMs - poll interval of the loop.
 * @returns the monitor, its fake, its log, its lifetime, and its online peers.
 */
function watch(statusRefreshMs = 60_000): Watched {
  const fake = new FakeSyncthing()
  const lifetime = new AbortController()
  lifetimes.push(lifetime)
  const client = new SyncthingClient({
    url: 'http://127.0.0.1:8384', readApiKey: () => Promise.resolve(FAKE_API_KEY), requestTimeoutMs: 1000, signal: lifetime.signal, fetch: fake.fetch,
  })
  const logs: string[] = []
  const online = new Set<string>(['peer'])
  const monitor = new SyncthingMonitor(client, {
    folderId: FOLDER,
    relayAddress: RELAY_ADDRESS,
    statusRefreshMs,
    logger: (message) => { logs.push(message) },
    peerOnline: (peerId: KetosPeerId) => online.has(String(peerId)),
  })
  return { fake, monitor, logs, lifetime, online }
}

/**
 * Link the fake's folder with a connected peer device.
 * @param fake - the fake Syncthing.
 * @param state - the folder state to report.
 * @param needTotalItems - the items still needed.
 */
function linked(fake: FakeSyncthing, state = 'idle', needTotalItems = 0): void {
  fake.seedLinked(FOLDER, PEER, 'ketos:peer', [RELAY_ADDRESS])
  fake.connected.set(PEER, 'relay-client')
  fake.folderStates.set(FOLDER, { state, needTotalItems })
}

describe('shared-folder state', () => {
  it('reports waiting before the first poll', () => {
    expect(watch().monitor.state()).toBe('waiting')
  })

  it('reports unavailable without failing while Syncthing does not answer, logging once', async () => {
    const { fake, monitor, logs, lifetime } = watch()
    fake.down = true
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('unavailable')
    await monitor.poll(lifetime.signal)
    expect(monitor.state()).toBe('unavailable')
    expect(logs).toEqual(['ketos-peer: syncthing.unavailable: SyncthingError: syncthing GET /rest/system/ping: no answer'])
  })

  it('reports an error when Syncthing refuses the key', async () => {
    const { fake, monitor, logs, lifetime } = watch()
    fake.apiKey = 'another'
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('error')
    expect(logs).toEqual(['ketos-peer: syncthing.error: SyncthingError: syncthing GET /rest/system/ping: HTTP 403'])
    expect(logs.join('\n')).not.toContain(FAKE_API_KEY)
  })

  it('reports waiting while the folder does not exist or does not run yet', async () => {
    const { fake, monitor, logs, lifetime } = watch()
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('waiting')
    fake.seedLinked(FOLDER, PEER, 'ketos:peer', [RELAY_ADDRESS])
    fake.overrides.set('GET /rest/db/status', () => new Response('folder is not running', { status: 404 }))
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('waiting')
    expect(logs).toEqual([
      'ketos-peer: syncthing.waiting: no shared folder yet',
      'ketos-peer: syncthing.waiting: the shared folder is not running yet',
    ])
  })

  it('reports waiting while no peer device of the folder is connected', async () => {
    const { fake, monitor, lifetime } = watch()
    linked(fake)
    fake.connected.clear()
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('waiting')
  })

  it('reports syncing for every scanning or transferring state and for needed items', async () => {
    for (const state of ['scanning', 'scan-waiting', 'syncing', 'sync-waiting', 'sync-preparing', 'cleaning', 'clean-waiting', 'starting']) {
      const { fake, monitor, lifetime } = watch()
      linked(fake, state)
      await expect(monitor.poll(lifetime.signal), state).resolves.toBe('syncing')
    }
    const { fake, monitor, lifetime } = watch()
    linked(fake, 'idle', 3)
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('syncing')
  })

  it('reports synced when idle, nothing needed, the peer connected, and the peer\'s Syncthing sharing the folder with nothing needed', async () => {
    const { fake, monitor, logs, lifetime } = watch()
    linked(fake)
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('synced')
    expect(logs).toEqual(['ketos-peer: syncthing.synced'])
    expect(fake.requests.at(-1)?.path).toBe(`/rest/db/completion?folder=${FOLDER}&device=${PEER}`)
  })

  it('reports syncing while the peer\'s Syncthing shares the folder but still needs items or deletions, logging nothing', async () => {
    const { fake, monitor, logs, lifetime } = watch()
    linked(fake)
    fake.remote.set(PEER, { remoteState: 'valid', needItems: 2, needDeletes: 0 })
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('syncing')
    fake.remote.set(PEER, { remoteState: 'valid', needItems: 0, needDeletes: 1 })
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('syncing')
    fake.remote.delete(PEER)
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('synced')
    expect(logs).toEqual(['ketos-peer: syncthing.synced'])
  })

  it('reports waiting while the peer\'s Syncthing does not share the folder back, whatever it still needs', async () => {
    for (const remoteState of ['unknown', 'notSharing', 'paused']) {
      const { fake, monitor, logs, lifetime } = watch()
      linked(fake)
      fake.remote.set(PEER, { remoteState, needItems: remoteState === 'paused' ? 0 : 3, needDeletes: 0 })
      await expect(monitor.poll(lifetime.signal), remoteState).resolves.toBe('waiting')
      expect(logs).toEqual(['ketos-peer: syncthing.waiting: no peer with an online Ketos channel shares the folder back yet'])
    }
  })

  it('decides by the peers whose Ketos channel is online, re-reading the channel without a request', async () => {
    const { fake, monitor, lifetime, online } = watch()
    linked(fake)
    fake.devices.set(OTHER, { ...fake.devices.get(PEER), deviceID: OTHER, name: 'ketos:other' })
    fake.folders.set(FOLDER, { ...fake.folders.get(FOLDER), devices: [{ deviceID: SELF_DEVICE }, { deviceID: PEER }, { deviceID: OTHER }] })
    fake.connected.set(OTHER, 'relay-client')
    fake.remote.set(PEER, { remoteState: 'notSharing', needItems: 0, needDeletes: 0 })
    // Only `peer` is online, and its Syncthing does not share the folder; `other`'s would.
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('waiting')
    const requests = fake.requests.length
    online.add('other')
    expect(monitor.state()).toBe('synced')
    expect(fake.requests).toHaveLength(requests)
    fake.remote.set(OTHER, { remoteState: 'valid', needItems: 4, needDeletes: 0 })
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('syncing')
    online.delete('other')
    expect(monitor.state()).toBe('waiting')
  })

  it('reports an error for a completion answer it cannot read', async () => {
    const { fake, monitor, logs, lifetime } = watch()
    linked(fake)
    fake.overrides.set('GET /rest/db/completion', () => Response.json({ remoteState: 'valid', needItems: 0 }))
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('error')
    expect(logs).toEqual([
      `ketos-peer: syncthing.error: SyncthingError: syncthing GET /rest/db/completion?folder=${FOLDER}&device=${PEER}: unexpected response: invalid remote completion`,
    ])
  })

  it('reports waiting when the folder stopped running before its completion was read', async () => {
    const { fake, monitor, logs, lifetime } = watch()
    linked(fake)
    fake.overrides.set('GET /rest/db/completion', () => new Response('folder is not running', { status: 404 }))
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('waiting')
    expect(logs).toEqual(['ketos-peer: syncthing.waiting: the shared folder is not running yet'])
  })

  it('reports waiting while Syncthing reports the peer connected and idle but its Ketos channel is not online', async () => {
    const { fake, monitor, logs, lifetime, online } = watch()
    linked(fake)
    online.clear()
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('waiting')
    expect(monitor.state()).toBe('waiting')
    online.add('peer')
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('synced')
    expect(logs).toEqual([
      'ketos-peer: syncthing.waiting: no Ketos channel to the peer of a connected device is online',
      'ketos-peer: syncthing.synced',
    ])
  })

  it('follows the Ketos channel between polls: synced turns waiting when it is lost and back when it returns', async () => {
    const { fake, monitor, lifetime, online } = watch()
    linked(fake)
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('synced')
    const requests = fake.requests.length
    online.delete('peer')
    expect(monitor.state()).toBe('waiting')
    online.add('peer')
    expect(monitor.state()).toBe('synced')
    expect(fake.requests).toHaveLength(requests)
  })

  it('reports waiting instead of syncing while no Ketos channel to the peer of a connected device is online, and syncing once one is', async () => {
    const { fake, monitor, logs, lifetime, online } = watch()
    linked(fake, 'syncing', 4)
    online.clear()
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('waiting')
    const requests = fake.requests.length
    online.add('peer')
    expect(monitor.state()).toBe('syncing')
    online.clear()
    expect(monitor.state()).toBe('waiting')
    expect(fake.requests).toHaveLength(requests)
    expect(logs).toEqual(['ketos-peer: syncthing.waiting: no Ketos channel to the peer of a connected device is online'])
  })

  it('reports waiting for a syncing folder whose connected devices carry no Ketos peer name', async () => {
    const { fake, monitor, logs, lifetime } = watch()
    fake.seedLinked(FOLDER, PEER, 'laptop', [RELAY_ADDRESS])
    fake.connected.set(PEER, 'relay-client')
    fake.folderStates.set(FOLDER, { state: 'syncing', needTotalItems: 2 })
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('waiting')
    expect(logs).toEqual(['ketos-peer: syncthing.waiting: no connected device of the folder carries a Ketos peer name'])
  })

  it('keeps unavailable and error ahead of the Ketos channel condition', async () => {
    const { fake, monitor, lifetime, online } = watch()
    linked(fake, 'error')
    online.clear()
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('error')
    fake.down = true
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('unavailable')
    expect(monitor.state()).toBe('unavailable')
  })

  it('counts only a connected device the linking named after a Ketos peer, with its own reason', async () => {
    for (const name of ['laptop', 'ketos:', `ketos:${'a'.repeat(513)}`]) {
      const { fake, monitor, logs, lifetime } = watch()
      fake.seedLinked(FOLDER, PEER, name, [RELAY_ADDRESS])
      fake.connected.set(PEER, 'relay-client')
      fake.folderStates.set(FOLDER, { state: 'idle', needTotalItems: 0 })
      await expect(monitor.poll(lifetime.signal), name).resolves.toBe('waiting')
      expect(logs).toEqual(['ketos-peer: syncthing.waiting: no connected device of the folder carries a Ketos peer name'])
    }
  })

  it('maps the unknown state to syncing only while items are needed', async () => {
    const first = watch()
    linked(first.fake, 'unknown', 0)
    await expect(first.monitor.poll(first.lifetime.signal)).resolves.toBe('waiting')
    expect(first.logs).toEqual(['ketos-peer: syncthing.waiting: folder state unknown'])
    const second = watch()
    linked(second.fake, 'unknown', 2)
    await expect(second.monitor.poll(second.lifetime.signal)).resolves.toBe('syncing')
  })

  it('reports an error for a folder in error, even without a connected peer', async () => {
    const { fake, monitor, logs, lifetime } = watch()
    linked(fake, 'error')
    fake.connected.clear()
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('error')
    expect(logs).toEqual(['ketos-peer: syncthing.error: the shared folder reports an error'])
  })

  it('reports an error for diverging settings, checked once per Syncthing run with reads only', async () => {
    const { fake, monitor, logs, lifetime } = watch()
    linked(fake)
    fake.options = { ...fake.options, natEnabled: true }
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('error')
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('error')
    expect(fake.requests.filter(request => request.path === '/rest/config/options')).toHaveLength(1)
    expect(logs).toEqual(['ketos-peer: syncthing.settings-diverge: not the private-relay settings: natEnabled'])
    // A restarted Syncthing is checked again: its settings may have changed.
    fake.down = true
    await monitor.poll(lifetime.signal)
    fake.down = false
    fake.options = { ...fake.options, natEnabled: false }
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('synced')
    expect(fake.requests.filter(request => request.path === '/rest/config/options')).toHaveLength(2)
    expect(fake.writes()).toEqual([])
    const text = logs.join('\n')
    expect(text).not.toContain(FAKE_RELAY_TOKEN)
    expect(text).not.toContain('relay://')
  })

  it('logs transitions only, and not the flips between syncing and synced', async () => {
    const { fake, monitor, logs, lifetime } = watch()
    linked(fake)
    await monitor.poll(lifetime.signal)
    fake.folderStates.set(FOLDER, { state: 'syncing', needTotalItems: 2 })
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('syncing')
    fake.folderStates.set(FOLDER, { state: 'idle', needTotalItems: 0 })
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('synced')
    await monitor.poll(lifetime.signal)
    expect(logs).toEqual(['ketos-peer: syncthing.synced'])
    fake.connected.clear()
    await monitor.poll(lifetime.signal)
    fake.connected.set(PEER, 'relay-client')
    await monitor.poll(lifetime.signal)
    expect(logs).toEqual([
      'ketos-peer: syncthing.synced',
      'ketos-peer: syncthing.waiting: the peer device is not connected',
      'ketos-peer: syncthing.synced',
    ])
  })

  it('reports unavailable when Syncthing stops answering mid-poll, and an error for a refused read', async () => {
    const { fake, monitor, lifetime } = watch()
    linked(fake)
    fake.overrides.set('GET /rest/system/connections', () => { throw new TypeError('fetch failed') })
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('unavailable')
    fake.overrides.set('GET /rest/system/connections', () => new Response('boom', { status: 500 }))
    await expect(monitor.poll(lifetime.signal)).resolves.toBe('error')
  })

  it('polls every statusRefreshMs and stops when its signal aborts', async () => {
    const { fake, monitor, lifetime } = watch(20)
    linked(fake)
    const running = monitor.run(lifetime.signal)
    await vi.waitFor(() => { expect(fake.requests.filter(request => request.path === '/rest/system/ping').length).toBeGreaterThan(3) })
    expect(monitor.state()).toBe('synced')
    lifetime.abort()
    await running
    const count = fake.requests.length
    await new Promise((resolve) => { setTimeout(resolve, 60) })
    expect(fake.requests).toHaveLength(count)
  })

  it('keeps its state and logs nothing for a poll its signal ended', async () => {
    const { fake, monitor, logs, lifetime } = watch()
    linked(fake)
    await monitor.poll(lifetime.signal)
    fake.hang = true
    const pending = monitor.poll(lifetime.signal)
    lifetime.abort()
    await expect(pending).resolves.toBe('synced')
    expect(monitor.state()).toBe('synced')
    expect(logs).toEqual(['ketos-peer: syncthing.synced'])
  })
})
