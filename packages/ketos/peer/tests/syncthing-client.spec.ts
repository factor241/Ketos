// The Syncthing REST client against the in-memory fake: the key header, the
// full-body PUT with the id in the body, the folder PATCH that replaces the
// device list, 404 as "missing", boundary validation that tolerates extra
// fields, and errors that never carry the key or the relay token.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import type { OwnerId } from '@ketos/board-doc/types'
import { SyncthingClient, SyncthingError, type SyncthingClientOptions, type SyncthingFetch } from '../src/syncthing-client.ts'
import type { SyncthingSettings } from '../src/syncthing-config.ts'
import type { SyncthingDeviceId } from '../src/syncthing-device-id.ts'
import { readSyncthingApiKey, registerSyncthing, type SyncthingPeer } from '../src/syncthing.ts'
import type { KetosPeerId } from '../src/types.ts'
import { DEVICE_IDS, FAKE_API_KEY, FAKE_RELAY_TOKEN, FakeSyncthing, RELAY_ADDRESS, RELAY_LISTEN_ADDRESS } from './syncthing-fake.ts'

const lifetimes: AbortController[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const lifetime of lifetimes) lifetime.abort()
  lifetimes.length = 0
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.length = 0
})

/** The stand's settings with short timings. */
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

/**
 * A peer node that never connects and drops what it is sent.
 * @returns the stand-in.
 */
function idlePeer(): SyncthingPeer {
  return {
    handle: () => () => undefined,
    send: () => Promise.resolve(),
    peers: () => [],
  }
}

/**
 * A fresh context disposed after the test.
 * @returns the context.
 */
function newContext(): Context {
  const ctx = new Context()
  contexts.push(ctx)
  return ctx
}

const SELF = brandString<SyncthingDeviceId>(DEVICE_IDS[0])
const PEER = brandString<SyncthingDeviceId>(DEVICE_IDS[1])
const OTHER = brandString<SyncthingDeviceId>(DEVICE_IDS[2])

/**
 * A client of one fake.
 * @param fetch - the transport.
 * @param requestTimeoutMs - per-request budget.
 * @returns the client and its lifetime controller.
 */
function clientOf(
  fetch: SyncthingFetch,
  requestTimeoutMs = 1000,
  readApiKey: SyncthingClientOptions['readApiKey'] = () => Promise.resolve(FAKE_API_KEY),
): { client: SyncthingClient; lifetime: AbortController } {
  const lifetime = new AbortController()
  lifetimes.push(lifetime)
  const client = new SyncthingClient({ url: 'http://127.0.0.1:8384', readApiKey, requestTimeoutMs, signal: lifetime.signal, fetch })
  return { client, lifetime }
}

/**
 * The rejection of a promise.
 * @param promise - a promise expected to reject.
 * @returns the rejection value.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error: unknown) {
    return error
  }
  throw new Error('expected a rejection')
}

describe('Syncthing REST client', () => {
  it('reads its own device id and sends the API key header', async () => {
    const fake = new FakeSyncthing()
    const { client } = clientOf(fake.fetch)
    await expect(client.systemStatus()).resolves.toEqual({ myID: SELF })
    await expect(client.ping()).resolves.toBeUndefined()
    expect(fake.requests.map(request => [request.method, request.path, request.apiKey])).toEqual([
      ['GET', '/rest/system/status', FAKE_API_KEY],
      ['GET', '/rest/system/ping', FAKE_API_KEY],
    ])
  })

  it('refuses a myID that is not a canonical device id', async () => {
    const fake = new FakeSyncthing(DEVICE_IDS[0].toLowerCase())
    const { client } = clientOf(fake.fetch)
    const error = await rejectionOf(client.systemStatus())
    expect(error).toBeInstanceOf(SyncthingError)
    expect((error as SyncthingError).status).toBe(200)
    expect((error as SyncthingError).path).toBe('/rest/system/status')
    expect(String(error)).toContain('myID')
  })

  it('puts a device with the full body and the id in the body', async () => {
    const fake = new FakeSyncthing()
    const { client } = clientOf(fake.fetch)
    await client.putDevice({ deviceID: PEER, name: 'ketos:peer-a', addresses: [RELAY_ADDRESS], autoAcceptFolders: false, paused: false })
    expect(fake.writes()).toEqual([{
      method: 'PUT',
      path: `/rest/config/devices/${PEER}`,
      body: { deviceID: PEER, name: 'ketos:peer-a', addresses: [RELAY_ADDRESS], autoAcceptFolders: false, paused: false },
      apiKey: FAKE_API_KEY,
    }])
    await expect(client.getDevice(PEER)).resolves.toEqual({
      deviceID: PEER, name: 'ketos:peer-a', addresses: [RELAY_ADDRESS], autoAcceptFolders: false, paused: false,
    })
    await client.pauseDevice(PEER)
    await expect(client.getDevice(PEER)).resolves.toMatchObject({ paused: true })
    const listed = await client.listDevices()
    expect(listed.map(device => device.deviceID).sort()).toEqual([SELF, PEER].sort())
  })

  it('reads a folder and patches it with the merged device list', async () => {
    const fake = new FakeSyncthing()
    fake.seedLinked('ketos-shared', PEER, 'ketos:peer-a', [RELAY_ADDRESS])
    const { client } = clientOf(fake.fetch)
    await client.putDevice({ deviceID: OTHER, name: 'ketos:peer-b', addresses: [RELAY_ADDRESS], autoAcceptFolders: false, paused: false })
    const folder = await client.getFolder('ketos-shared')
    expect(folder).toEqual({ id: 'ketos-shared', devices: [SELF, PEER].sort() })
    await client.patchFolder('ketos-shared', { devices: [...folder?.devices ?? [], OTHER] })
    expect(fake.writes().at(-1)).toEqual({
      method: 'PATCH',
      path: '/rest/config/folders/ketos-shared',
      body: { devices: [...[SELF, PEER].sort(), OTHER].map(deviceID => ({ deviceID })) },
      apiKey: FAKE_API_KEY,
    })
    expect(fake.folderDevices('ketos-shared')).toEqual([SELF, PEER, OTHER].sort())
  })

  it('creates a folder with a full body, then reads its status', async () => {
    const fake = new FakeSyncthing()
    const { client } = clientOf(fake.fetch)
    await client.putDevice({ deviceID: PEER, name: 'ketos:peer-a', addresses: [RELAY_ADDRESS], autoAcceptFolders: false, paused: false })
    await client.putFolder({
      id: 'ketos-shared', path: '/workspace/shared', type: 'sendreceive', fsWatcherEnabled: true, fsWatcherDelayS: 1, devices: [PEER],
    })
    expect(fake.writes().at(-1)?.body).toEqual({
      id: 'ketos-shared', path: '/workspace/shared', type: 'sendreceive', fsWatcherEnabled: true, fsWatcherDelayS: 1,
      devices: [{ deviceID: PEER }],
    })
    fake.folderStates.set('ketos-shared', { state: 'syncing', needTotalItems: 4 })
    await expect(client.folderStatus('ketos-shared')).resolves.toEqual({ state: 'syncing', needTotalItems: 4 })
    expect(fake.requests.at(-1)?.path).toBe('/rest/db/status?folder=ketos-shared')
  })

  it('reads a remote device\'s completion of a folder', async () => {
    const fake = new FakeSyncthing()
    fake.seedLinked('ketos-shared', PEER, 'ketos:peer-a', [RELAY_ADDRESS])
    const { client } = clientOf(fake.fetch)
    await expect(client.remoteCompletion('ketos-shared', PEER)).resolves.toEqual({ remoteState: 'valid', needItems: 0, needDeletes: 0 })
    expect(fake.requests.at(-1)?.path).toBe(`/rest/db/completion?folder=ketos-shared&device=${PEER}`)
    fake.remote.set(PEER, { remoteState: 'notSharing', needItems: 2, needDeletes: 1 })
    await expect(client.remoteCompletion('ketos-shared', PEER)).resolves.toEqual({ remoteState: 'notSharing', needItems: 2, needDeletes: 1 })
  })

  it('pauses and resumes one device by id, and refuses an unknown device', async () => {
    const fake = new FakeSyncthing()
    fake.seedLinked('ketos-shared', PEER, 'ketos:peer-a', [RELAY_ADDRESS])
    const { client } = clientOf(fake.fetch)
    await client.pauseDevice(PEER)
    expect(fake.devices.get(PEER)?.paused).toBe(true)
    expect(fake.devices.get(SELF)?.paused).toBe(false)
    await client.resumeDevice(PEER)
    expect(fake.devices.get(PEER)?.paused).toBe(false)
    expect(fake.writes()).toEqual([
      { method: 'POST', path: `/rest/system/pause?device=${PEER}`, apiKey: FAKE_API_KEY },
      { method: 'POST', path: `/rest/system/resume?device=${PEER}`, apiKey: FAKE_API_KEY },
    ])
    await expect(client.pauseDevice(OTHER)).rejects.toMatchObject({ status: 404, kind: 'refused', transient: false })
  })

  it('deletes a device', async () => {
    const fake = new FakeSyncthing()
    fake.seedLinked('ketos-shared', PEER, 'ketos:peer-a', [RELAY_ADDRESS])
    const { client } = clientOf(fake.fetch)
    await client.deleteDevice(PEER)
    expect(fake.writes()).toEqual([{ method: 'DELETE', path: `/rest/config/devices/${PEER}`, apiKey: FAKE_API_KEY }])
    await expect(client.getDevice(PEER)).resolves.toBeUndefined()
  })

  it('answers undefined for a missing folder, device, and folder status', async () => {
    const fake = new FakeSyncthing()
    const { client } = clientOf(fake.fetch)
    await expect(client.getFolder('ketos-shared')).resolves.toBeUndefined()
    await expect(client.getDevice(PEER)).resolves.toBeUndefined()
    await expect(client.folderStatus('ketos-shared')).resolves.toBeUndefined()
    await expect(client.remoteCompletion('ketos-shared', PEER)).resolves.toBeUndefined()
  })

  it('reads the options and the connections', async () => {
    const fake = new FakeSyncthing()
    fake.seedLinked('ketos-shared', PEER, 'ketos:peer-a', [RELAY_ADDRESS])
    fake.connected.set(PEER, 'relay-client')
    const { client } = clientOf(fake.fetch)
    await expect(client.getOptions()).resolves.toEqual({
      globalAnnounceEnabled: false,
      localAnnounceEnabled: false,
      natEnabled: false,
      relaysEnabled: true,
      listenAddresses: [RELAY_LISTEN_ADDRESS, 'tcp://0.0.0.0:22000'],
    })
    const connections = await client.connections()
    expect(connections.get(PEER)).toEqual({ connected: true, type: 'relay-client' })
    expect(connections.has(SELF)).toBe(false)
  })

  it('names the status and the path of a refused request, never the key or the relay token', async () => {
    const fake = new FakeSyncthing()
    fake.apiKey = 'another-key'
    const { client } = clientOf(fake.fetch)
    const error = await rejectionOf(client.getOptions())
    expect(error).toBeInstanceOf(SyncthingError)
    expect(error).toMatchObject({ status: 403, path: '/rest/config/options', method: 'GET', kind: 'refused', transient: false })
    const text = `${String(error)} ${(error as Error).stack ?? ''}`
    expect(text).toContain('403')
    expect(text).not.toContain(FAKE_API_KEY)
    expect(text).not.toContain(FAKE_RELAY_TOKEN)
  })

  it('reports a Syncthing that does not answer with status 0', async () => {
    const fake = new FakeSyncthing()
    fake.down = true
    const { client } = clientOf(fake.fetch)
    const error = await rejectionOf(client.ping())
    expect(error).toMatchObject({ status: 0, path: '/rest/system/ping', kind: 'no-answer', transient: true })
    expect(String(error)).toContain('no answer')
  })

  it('gives up on a request after requestTimeoutMs', async () => {
    const fake = new FakeSyncthing()
    fake.hang = true
    const { client } = clientOf(fake.fetch, 20)
    const error = await rejectionOf(client.ping())
    expect(error).toMatchObject({ status: 0 })
    expect(String(error)).toContain('no answer within 20 ms')
  })

  it('cancels a request in flight when its lifetime ends', async () => {
    const fake = new FakeSyncthing()
    fake.hang = true
    const { client, lifetime } = clientOf(fake.fetch, 60_000)
    const pending = client.ping()
    await vi.waitFor(() => { expect(fake.requests).toHaveLength(1) })
    lifetime.abort()
    const error = await rejectionOf(pending)
    expect(error).toMatchObject({ status: 0, kind: 'no-answer' })
    expect(String(error)).toContain('cancelled')
  })

  it('sends nothing when its lifetime ended while the key was read', async () => {
    const fake = new FakeSyncthing()
    const { client, lifetime } = clientOf(fake.fetch)
    const pending = client.ping()
    lifetime.abort()
    const error = await rejectionOf(pending)
    expect(error).toMatchObject({ status: 0, kind: 'no-answer' })
    expect(String(error)).toContain('cancelled')
    expect(fake.requests).toEqual([])
  })

  it('re-reads the API key for every request', async () => {
    const fake = new FakeSyncthing()
    let key = 'first-key'
    fake.apiKey = key
    const { client } = clientOf(fake.fetch, 1000, () => Promise.resolve(key))
    await client.ping()
    key = 'second-key'
    fake.apiKey = key
    await client.ping()
    expect(fake.requests.map(request => request.apiKey)).toEqual(['first-key', 'second-key'])
  })

  it('fails a request without an API key, sending nothing', async () => {
    const fake = new FakeSyncthing()
    const unset = clientOf(fake.fetch, 1000, () => Promise.resolve(undefined)).client
    const error = await rejectionOf(unset.ping())
    expect(error).toMatchObject({ status: 0, kind: 'no-key', transient: false })
    expect(String(error)).toContain('the API key is not set')
    const failing = clientOf(fake.fetch, 1000, () => Promise.reject(new Error(`store holds ${FAKE_API_KEY}`))).client
    const unreadable = await rejectionOf(failing.ping())
    expect(unreadable).toMatchObject({ status: 0, kind: 'no-key' })
    expect(String(unreadable)).toContain('the API key could not be read')
    expect(String(unreadable)).not.toContain(FAKE_API_KEY)
    expect(fake.requests).toEqual([])
  })

  it('counts a server error as transient and a client error as final', async () => {
    const fake = new FakeSyncthing()
    const { client } = clientOf(fake.fetch)
    fake.overrides.set('GET /rest/system/ping', () => new Response('busy', { status: 503 }))
    await expect(client.ping()).rejects.toMatchObject({ status: 503, kind: 'refused', transient: true })
    fake.overrides.set('GET /rest/system/ping', () => new Response('gone', { status: 404 }))
    await expect(client.ping()).rejects.toMatchObject({ status: 404, kind: 'refused', transient: false })
  })

  it('keys the connections by canonical device ids and skips any other key', async () => {
    const fake = new FakeSyncthing()
    fake.overrides.set('GET /rest/system/connections', () => Response.json({
      connections: {
        [PEER]: { connected: true, type: 'relay-client' },
        [PEER.toLowerCase()]: { connected: true, type: 'relay-client' },
        'not-a-device': { connected: false, type: '' },
      },
    }))
    const { client } = clientOf(fake.fetch)
    const connections = await client.connections()
    expect([...connections.keys()]).toEqual([PEER])
  })

  it('refuses an error status other than 404 on a lookup', async () => {
    const fake = new FakeSyncthing()
    fake.overrides.set('GET /rest/config/folders/ketos-shared', () => new Response('boom', { status: 500 }))
    const { client } = clientOf(fake.fetch)
    await expect(client.getFolder('ketos-shared')).rejects.toMatchObject({ status: 500 })
  })

  it('refuses a write the server rejects', async () => {
    const fake = new FakeSyncthing()
    const { client } = clientOf(fake.fetch)
    await expect(client.patchFolder('ketos-shared', { devices: [PEER] })).rejects.toMatchObject({ status: 404, method: 'PATCH' })
  })

  it('accepts extra fields and refuses a response without a required one', async () => {
    const fake = new FakeSyncthing()
    const { client } = clientOf(fake.fetch)
    fake.overrides.set('GET /rest/system/ping', () => Response.json({ ping: 'pong', extra: true }))
    await expect(client.ping()).resolves.toBeUndefined()
    const refused: Array<[string, () => Promise<unknown>, unknown]> = [
      ['GET /rest/system/ping', () => client.ping(), { ping: 'pang' }],
      ['GET /rest/system/status', () => client.systemStatus(), { uptime: 1 }],
      ['GET /rest/system/status', () => client.systemStatus(), []],
      ['GET /rest/system/connections', () => client.connections(), { total: {} }],
      ['GET /rest/system/connections', () => client.connections(), { connections: { [PEER]: { type: '' } } }],
      ['GET /rest/system/connections', () => client.connections(), { connections: { [PEER]: { connected: true, type: 3 } } }],
      ['GET /rest/system/connections', () => client.connections(), { connections: { [PEER]: null } }],
      ['GET /rest/config/options', () => client.getOptions(), { globalAnnounceEnabled: false }],
      ['GET /rest/config/options', () => client.getOptions(), {
        globalAnnounceEnabled: false, localAnnounceEnabled: false, natEnabled: false, relaysEnabled: true, listenAddresses: [1],
      }],
      ['GET /rest/config/devices', () => client.listDevices(), { devices: [] }],
      ['GET /rest/config/devices', () => client.listDevices(), [{ deviceID: 'nope', name: '', addresses: [], autoAcceptFolders: false }]],
      ['GET /rest/config/devices', () => client.listDevices(), [{ deviceID: PEER, name: 1, addresses: [], autoAcceptFolders: false }]],
      ['GET /rest/config/devices', () => client.listDevices(), [{ deviceID: PEER, name: '', addresses: 'x', autoAcceptFolders: false }]],
      ['GET /rest/config/devices', () => client.listDevices(), [{ deviceID: PEER, name: '', addresses: [], autoAcceptFolders: 'no', paused: false }]],
      ['GET /rest/config/devices', () => client.listDevices(), [{ deviceID: PEER, name: '', addresses: [], autoAcceptFolders: false }]],
      ['GET /rest/config/devices', () => client.listDevices(), [{ deviceID: PEER, name: '', addresses: [], autoAcceptFolders: false, paused: 'no' }]],
      ['GET /rest/config/devices', () => client.listDevices(), ['not an object']],
      [`GET /rest/config/devices/${PEER}`, () => client.getDevice(PEER), []],
      ['GET /rest/config/folders/ketos-shared', () => client.getFolder('ketos-shared'), { id: 'ketos-shared' }],
      ['GET /rest/config/folders/ketos-shared', () => client.getFolder('ketos-shared'), { id: 7, devices: [] }],
      ['GET /rest/config/folders/ketos-shared', () => client.getFolder('ketos-shared'), { id: 'ketos-shared', devices: [{ deviceID: 'x' }] }],
      ['GET /rest/config/folders/ketos-shared', () => client.getFolder('ketos-shared'), { id: 'ketos-shared', devices: [null] }],
      ['GET /rest/db/status', () => client.folderStatus('ketos-shared'), { state: 'idle' }],
      ['GET /rest/db/status', () => client.folderStatus('ketos-shared'), { state: 'idle', needTotalItems: -1 }],
      ['GET /rest/db/status', () => client.folderStatus('ketos-shared'), { state: 3, needTotalItems: 0 }],
      ['GET /rest/db/completion', () => client.remoteCompletion('ketos-shared', PEER), []],
      ['GET /rest/db/completion', () => client.remoteCompletion('ketos-shared', PEER), { needItems: 0, needDeletes: 0 }],
      ['GET /rest/db/completion', () => client.remoteCompletion('ketos-shared', PEER), { remoteState: 'valid', needItems: '0', needDeletes: 0 }],
      ['GET /rest/db/completion', () => client.remoteCompletion('ketos-shared', PEER), { remoteState: 'valid', needItems: -1, needDeletes: 0 }],
      ['GET /rest/db/completion', () => client.remoteCompletion('ketos-shared', PEER), { remoteState: 'valid', needItems: 0 }],
      ['GET /rest/db/completion', () => client.remoteCompletion('ketos-shared', PEER), { remoteState: 'valid', needItems: 0, needDeletes: 1.5 }],
    ]
    for (const [route, call, body] of refused) {
      fake.overrides.clear()
      fake.overrides.set(route, () => Response.json(body))
      await expect(call(), `${route} ${JSON.stringify(body)}`).rejects.toMatchObject({ status: 200, kind: 'invalid', transient: false })
    }
  })

  it('refuses an answer that is not JSON', async () => {
    const fake = new FakeSyncthing()
    fake.overrides.set('GET /rest/system/status', () => new Response('<html>', { status: 200 }))
    const { client } = clientOf(fake.fetch)
    const error = await rejectionOf(client.systemStatus())
    expect(error).toMatchObject({ status: 200 })
    expect(String(error)).toContain('not JSON')
  })

  it('joins paths onto a base URL with a trailing slash and encodes path segments', async () => {
    const fake = new FakeSyncthing()
    const lifetime = new AbortController()
    lifetimes.push(lifetime)
    const client = new SyncthingClient({
      url: 'http://127.0.0.1:8384/', readApiKey: () => Promise.resolve(FAKE_API_KEY), requestTimeoutMs: 1000, signal: lifetime.signal, fetch: fake.fetch,
    })
    await client.getFolder('a b')
    expect(fake.requests.at(-1)?.path).toBe('/rest/config/folders/a%20b')
  })

  it('uses the global fetch by default', async () => {
    const fake = new FakeSyncthing()
    const original = globalThis.fetch
    globalThis.fetch = ((url: string, init: RequestInit) => fake.fetch(url, init)) as typeof fetch
    try {
      const lifetime = new AbortController()
      lifetimes.push(lifetime)
      const client = new SyncthingClient({
        url: 'http://127.0.0.1:8384', readApiKey: () => Promise.resolve(FAKE_API_KEY), requestTimeoutMs: 1000, signal: lifetime.signal,
      })
      await client.ping()
      expect(fake.requests).toHaveLength(1)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('Syncthing feature start', () => {
  it('checks the settings with reads only and names the diverging ones without addresses or secrets', async () => {
    const fake = new FakeSyncthing()
    fake.options = { ...fake.options, globalAnnounceEnabled: true, listenAddresses: ['default'] }
    const logs: string[] = []
    const { started } = registerSyncthing(newContext(), idlePeer(), SETTINGS, {
      logger: (message) => { logs.push(message) },
      resolveApiKey: () => Promise.resolve(FAKE_API_KEY),
      fetch: fake.fetch,
    })
    await expect(started).resolves.toBe(true)
    expect(fake.requests.map(request => request.path)).toContain('/rest/config/options')
    expect(fake.writes()).toEqual([])
    expect(logs).toEqual(['ketos-peer: syncthing.settings-diverge: not the private-relay settings: globalAnnounceEnabled, listenAddresses'])
    const text = logs.join('\n')
    expect(text).not.toContain(FAKE_API_KEY)
    expect(text).not.toContain(FAKE_RELAY_TOKEN)
    expect(text).not.toContain('relay://')
  })

  it('reports no divergence when the settings match, writes nothing, and provides the shared-folder state', async () => {
    const fake = new FakeSyncthing()
    const logs: string[] = []
    const feature = registerSyncthing(newContext(), idlePeer(), SETTINGS, {
      logger: (message) => { logs.push(message) },
      resolveApiKey: () => Promise.resolve(FAKE_API_KEY),
      fetch: fake.fetch,
    })
    expect(feature.sharedFolder()).toBeUndefined()
    await feature.started
    expect(logs).toEqual(['ketos-peer: syncthing.waiting: no shared folder yet'])
    expect(fake.writes()).toEqual([])
    expect(feature.sharedFolder()).toBe('waiting')
  })

  it('stays off with one log line when the key is not set, and sends nothing', async () => {
    const fake = new FakeSyncthing()
    const logs: string[] = []
    const feature = registerSyncthing(newContext(), idlePeer(), SETTINGS, {
      logger: (message) => { logs.push(message) },
      resolveApiKey: () => Promise.resolve(undefined),
      fetch: fake.fetch,
    })
    await expect(feature.started).resolves.toBe(false)
    expect(feature.sharedFolder()).toBeUndefined()
    expect(logs).toEqual(['ketos-peer: syncthing.disabled: STGUIAPIKEY is not set; the shared folder stays off'])
    expect(fake.requests).toEqual([])
  })

  it('stays off with one fixed log line when the key cannot be read, never quoting the reader error', async () => {
    const fake = new FakeSyncthing()
    const logs: string[] = []
    const { started } = registerSyncthing(newContext(), idlePeer(), SETTINGS, {
      logger: (message) => { logs.push(message) },
      resolveApiKey: () => Promise.reject(new Error(`store locked; stored value ${FAKE_API_KEY}`)),
      fetch: fake.fetch,
    })
    await expect(started).resolves.toBe(false)
    expect(logs).toEqual(['ketos-peer: syncthing.disabled: STGUIAPIKEY could not be read; the shared folder stays off'])
    expect(logs.join('\n')).not.toContain(FAKE_API_KEY)
    expect(fake.requests).toEqual([])
  })

  it('does not start when the plugin was disposed while the key was read', async () => {
    const fake = new FakeSyncthing()
    const ctx = newContext()
    let release: (key: string) => void = () => undefined
    const { started } = registerSyncthing(ctx, idlePeer(), SETTINGS, {
      logger: () => undefined,
      resolveApiKey: () => new Promise((resolve) => { release = resolve }),
      fetch: fake.fetch,
    })
    await ctx.fiber.dispose()
    release(FAKE_API_KEY)
    await expect(started).resolves.toBe(false)
    expect(fake.requests).toEqual([])
  })

  it('links over the channel once the key is read: sends its id on connection and applies a received one', async () => {
    const fake = new FakeSyncthing()
    const ctx = newContext()
    const sent: unknown[] = []
    let handler: ((payload: unknown, from: KetosPeerId) => unknown) | undefined
    const peerId = brandString<KetosPeerId>('c'.repeat(64))
    const { started } = registerSyncthing(ctx, {
      handle: (_type, register) => {
        handler = register
        return () => { handler = undefined }
      },
      send: (_peerId, _type, payload) => {
        sent.push(payload)
        return Promise.resolve()
      },
      peers: () => [],
    }, SETTINGS, { logger: () => undefined, resolveApiKey: () => Promise.resolve(FAKE_API_KEY), fetch: fake.fetch })
    ctx.emit('ketos-peer/connected', { peerId, selfId: brandString<OwnerId>('owner'), name: 'X', color: 1 })
    handler?.({ deviceId: PEER }, peerId)
    await expect(started).resolves.toBe(true)
    await vi.waitFor(() => {
      expect(sent).toEqual([{ deviceId: SELF }])
      expect(fake.folderDevices('ketos-shared')).toEqual([SELF, PEER].sort())
    })
    await ctx.fiber.dispose()
    expect(handler).toBeUndefined()
  })

  it('reads the key again for every request and reports an error once it is gone', async () => {
    const fake = new FakeSyncthing()
    let key: string | undefined = FAKE_API_KEY
    const logs: string[] = []
    const feature = registerSyncthing(newContext(), idlePeer(), { ...SETTINGS, statusRefreshMs: 250 }, {
      logger: (message) => { logs.push(message) },
      resolveApiKey: () => Promise.resolve(key),
      fetch: fake.fetch,
    })
    await feature.started
    expect(feature.sharedFolder()).toBe('waiting')
    key = undefined
    await vi.waitFor(() => { expect(feature.sharedFolder()).toBe('error') }, { timeout: 3000 })
    expect(logs).toContain('ketos-peer: syncthing.error: SyncthingError: syncthing GET /rest/system/ping: the API key is not set')
  })

  it('reports a Syncthing that does not answer at start as unavailable', async () => {
    const fake = new FakeSyncthing()
    fake.down = true
    const logs: string[] = []
    const feature = registerSyncthing(newContext(), idlePeer(), SETTINGS, {
      logger: (message) => { logs.push(message) },
      resolveApiKey: () => Promise.resolve(FAKE_API_KEY),
      fetch: fake.fetch,
    })
    await expect(feature.started).resolves.toBe(true)
    expect(logs).toEqual(['ketos-peer: syncthing.unavailable: SyncthingError: syncthing GET /rest/system/ping: no answer'])
    expect(feature.sharedFolder()).toBe('unavailable')
  })
})

describe('Syncthing API key lookup', () => {
  it('reads the key through the credentials service when one is present', async () => {
    const ctx = newContext()
    const asked: string[] = []
    ctx.provide('credentials', {
      resolve: (ref: string) => {
        asked.push(ref)
        return Promise.resolve({ value: 'from-credentials', source: 'env' })
      },
    } as never)
    await expect(readSyncthingApiKey(ctx, 'STGUIAPIKEY')).resolves.toBe('from-credentials')
    expect(asked).toEqual(['STGUIAPIKEY'])
  })

  it('falls back to the launch environment when the credentials service misses', async () => {
    const ctx = newContext()
    ctx.provide('credentials', { resolve: () => Promise.resolve(undefined) } as never)
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([
      { source: 'process', values: { STGUIAPIKEY: 'from-env' } },
    ]))
    await expect(readSyncthingApiKey(ctx, 'STGUIAPIKEY')).resolves.toBe('from-env')
  })

  it('reads the key from the launch environment without a credentials service', async () => {
    const ctx = newContext()
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([
      { source: 'process', values: { STGUIAPIKEY: 'from-env', EMPTY_KEY: '' } },
    ]))
    await expect(readSyncthingApiKey(ctx, 'STGUIAPIKEY')).resolves.toBe('from-env')
    await expect(readSyncthingApiKey(ctx, 'EMPTY_KEY')).resolves.toBeUndefined()
    await expect(readSyncthingApiKey(ctx, 'MISSING_KEY')).resolves.toBeUndefined()
  })

  it('treats a key that neither the credentials service nor the launch environment has as not set', async () => {
    const ctx = newContext()
    ctx.provide('credentials', { resolve: () => Promise.resolve(undefined) } as never)
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }]))
    await expect(readSyncthingApiKey(ctx, 'STGUIAPIKEY')).resolves.toBeUndefined()
  })
})
