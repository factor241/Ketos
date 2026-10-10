// Proves the peer package composes the way the shipped web profile mounts it:
// a real Loader boots `@ketos/board-doc` and `@ketos/peer` from cordis.yml
// against a connection service that records the routes, the node keeps one
// EndpointId across restarts through its key file, and a wrong-length key
// refuses to start.
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, FiberState, Service, type Message } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OwnerId } from '@ketos/board-doc/types'
import type { KetosPeerId } from '../src/types.ts'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import * as BoardDoc from '@ketos/board-doc'
import * as Peer from '@ketos/peer'
import { PEER_CONNECT_PATH, PEER_FORGET_PATH, PEER_INVITE_PATH, PEER_STATE_PATH, PEER_TRANSCRIPT_PATH } from '../src/routes.ts'
import { KetosPeerService } from '../src/service.ts'
import { registerSyncthing } from '../src/syncthing.ts'
import { FAKE_API_KEY, FakeSyncthing, RELAY_ADDRESS } from './syncthing-fake.ts'

// The real feature by default; one spec makes its start reject.
vi.mock('../src/syncthing.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/syncthing.ts')>()
  return { ...actual, registerSyncthing: vi.fn(actual.registerSyncthing) }
})

/** Stand-in for the authenticated Fetch surface the plugin registers onto. */
class RecordingConnection extends Service {
  readonly routes = new Map<string, ConnectionFetchRoute>()
  readonly withdrawn: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'connection')
  }

  get fetch() {
    const owner = this.ctx
    return {
      register: (route: ConnectionFetchRoute) => owner.effect(() => {
        this.routes.set(route.path, route)
        return async () => {
          this.routes.delete(route.path)
          this.withdrawn.push(route.path)
        }
      }, `recording-connection: ${route.path}`),
    }
  }
}

let root: string | undefined
let context: Context | undefined
let syncthingServer: Server | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  vi.unstubAllEnvs()
  const server = syncthingServer
  syncthingServer = undefined
  if (server !== undefined) await new Promise((resolve) => { server.close(resolve) })
  if (root !== undefined) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  root = undefined
})

/** One booted composition. */
interface Booted {
  readonly ctx: Context
  readonly routes: Map<string, ConnectionFetchRoute>
  readonly withdrawn: string[]
  readonly keyPath: string
  /** Every log message since the context was created, all severities. */
  readonly messages: Message[]
}

/**
 * Boot a temporary cordis.yml carrying the board document and peer rows.
 * @param directory - root to create the configuration and files in.
 * @param keyPath - key file the peer row must use.
 * @param extraPeer - further peer row config lines, already YAML-formatted.
 * @param expectActive - whether every entry must activate; false lets a bad
 * configuration be inspected through its failed fiber.
 * @returns the booted context and recorded routes.
 */
async function boot(
  directory: string,
  keyPath: string,
  extraPeer: readonly string[] = [],
  expectActive = true,
): Promise<Booted> {
  const configPath = join(directory, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@ketos/board-doc'",
    '  config:',
    `    path: ${JSON.stringify(join(directory, 'board.db'))}`,
    "- name: '@ketos/peer'",
    '  config:',
    '    name: Кирилл',
    "    relayUrls: ['http://127.0.0.1:1']",
    `    keyPath: ${JSON.stringify(keyPath)}`,
    `    peersPath: ${JSON.stringify(join(directory, 'peers.json'))}`,
    ...extraPeer,
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  // Registered before the Loader runs, so lines logged during activation land too.
  const messages: Message[] = []
  ctx.logger.exporter({
    levels: { default: 100 },
    export: (message) => { messages.push(message) },
  })
  ctx.baseUrl = pathToFileURL(directory).href + '/'
  const connection = new RecordingConnection(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@ketos/board-doc', BoardDoc],
    ['@ketos/peer', Peer],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as never
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  if (expectActive) {
    for (const name of ['@ketos/board-doc', '@ketos/peer']) {
      const entry = [...ctx.loader.entries()].find(row => row.options.name === name)
      expect(entry?.fiber?.state).toBe(FiberState.ACTIVE)
    }
  }
  return { ctx, routes: connection.routes, withdrawn: connection.withdrawn, keyPath, messages }
}

/**
 * Lines the peer plugin logged that contain one text.
 * @param messages - the captured messages.
 * @param text - the text to look for.
 * @returns the matching lines.
 */
function peerLines(messages: readonly Message[], text: string): string[] {
  return messages
    .filter(message => message.name === 'ketos-peer')
    .map(message => message.args.map(String).join(' '))
    .filter(line => line.includes(text))
}

/**
 * YAML lines of a `syncthing` section, indented under the peer row's config.
 * @param fields - the section's fields.
 * @returns the lines.
 */
function syncthingRows(fields: Readonly<Record<string, string | number>>): string[] {
  return ['    syncthing:', ...Object.entries(fields).map(([key, value]) => `      ${key}: ${JSON.stringify(value)}`)]
}

/**
 * Serve one fake Syncthing over HTTP on a loopback port this spec owns.
 * @param fake - the fake that answers.
 * @returns the base URL.
 */
async function serveSyncthing(fake: FakeSyncthing): Promise<string> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(request.headers)) if (typeof value === 'string') headers[key] = value
      void fake.fetch(`http://127.0.0.1${request.url ?? '/'}`, {
        method: request.method ?? 'GET', headers, ...body === '' ? {} : { body },
      }).then(async (answer) => {
        response.writeHead(answer.status, { 'content-type': answer.headers.get('content-type') ?? 'text/plain' })
        response.end(await answer.text())
      })
    })
  })
  syncthingServer = server
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
}

/** The stand's `syncthing` section with a key variable no test environment sets. */
const SYNCTHING_SECTION = {
  url: 'http://127.0.0.1:8384',
  apiKeyEnv: 'KETOS_PEER_SPEC_UNSET_SYNCTHING_KEY',
  relayAddress: 'relay://203.0.113.7:22067/?id=MFZWI3D-BONSGYC-YLTMRWG-C43ENR5-QXGZDMM-FZWI3DP-BONSGYY-LTMRWAD',
  folderId: 'ketos-shared',
  folderPath: '/workspace/shared',
  fsWatcherDelayS: 1,
} as const

describe('peer package real Loader composition', () => {
  it('activates with the board document, provides the service, and withdraws its routes', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    const { ctx, routes, withdrawn } = await boot(root, keyPath)
    expect([...routes.keys()]).toEqual(expect.arrayContaining([
      PEER_STATE_PATH, PEER_INVITE_PATH, PEER_CONNECT_PATH, PEER_FORGET_PATH, PEER_TRANSCRIPT_PATH,
    ]))
    expect(routes.get(PEER_TRANSCRIPT_PATH)?.methods).toEqual(['POST'])
    expect(routes.get(PEER_STATE_PATH)?.methods).toEqual(['GET'])
    expect(routes.get(PEER_INVITE_PATH)?.methods).toEqual(['GET'])
    expect(routes.get(PEER_CONNECT_PATH)?.methods).toEqual(['POST'])
    expect(ctx.ketosPeer).toBeInstanceOf(KetosPeerService)

    await ctx.fiber.dispose()
    context = undefined
    expect(withdrawn).toEqual(expect.arrayContaining([
      PEER_STATE_PATH, PEER_INVITE_PATH, PEER_CONNECT_PATH, PEER_FORGET_PATH, PEER_TRANSCRIPT_PATH,
    ]))
  })

  it('mounts the transcript handler and withdraws it with the plugin, with no session service present', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    const unsubscribe = vi.fn()
    const handle = vi.spyOn(KetosPeerService.prototype, 'handle').mockReturnValue(unsubscribe)
    try {
      const { ctx } = await boot(root, keyPath)
      expect(ctx.get('sessionPersistence')).toBeUndefined()
      expect(handle.mock.calls.map(([type]) => type)).toContain('chat.transcript.request')
      const withdrawnBefore = unsubscribe.mock.calls.length
      await ctx.fiber.dispose()
      context = undefined
      expect(unsubscribe.mock.calls.length).toBeGreaterThan(withdrawnBefore)
    } finally {
      handle.mockRestore()
    }
  })

  it('keeps the same node identity across restarts through the key file', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    const first = await boot(root, keyPath)
    const firstId = await first.ctx.ketosPeer.nodeId()
    const stored = new Uint8Array(await readFile(keyPath))
    expect(stored.byteLength).toBe(32)
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600)
    await first.ctx.fiber.dispose()
    context = undefined

    const second = await boot(root, keyPath)
    expect(await second.ctx.ketosPeer.nodeId()).toBe(firstId)
  })

  it('refuses to start on a key file of the wrong length', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    await writeFile(keyPath, new Uint8Array(31))
    const { ctx } = await boot(root, keyPath)
    await expect(ctx.ketosPeer.nodeId()).rejects.toThrow(/must hold 32 bytes/u)
  })

  it('binds a pinned address when the deployment names one', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    const { ctx } = await boot(root, keyPath, ["    bindAddr: '127.0.0.1:0'"])
    expect(String(await ctx.ketosPeer.nodeId())).not.toBe('')
  })

  it('logs an eager-start failure and keeps the plugin alive', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    await writeFile(join(root, 'peers.json'), 'not json')
    const { ctx } = await boot(root, keyPath)
    await new Promise((resolve) => { setTimeout(resolve, 50) })
    expect(ctx.ketosPeer.peers()).toEqual([])
    // The plugin stayed mounted; only the node start fails loud.
    await expect(ctx.ketosPeer.state()).rejects.toThrow(/is not JSON/u)
  })

  it('logs reconnect failures through the plugin logger', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    await writeFile(join(root, 'peers.json'), JSON.stringify([{
      peerId: 'peer-x', selfId: 'owner-x', name: 'X', color: 2,
      ticket: 'not-a-ticket', lastSeen: '2026-10-07T00:00:00.000Z',
    }]))
    const { ctx } = await boot(root, keyPath, ['    reconnectMinMs: 100', '    reconnectMaxMs: 200'])
    await expect(ctx.ketosPeer.startIfKnownPeers()).resolves.toBeUndefined()
    await new Promise((resolve) => { setTimeout(resolve, 450) })
    expect(ctx.ketosPeer.peers()[0]?.link).toBe('lost')
  })

  it('refuses a synchronization bound that does not fit the frame bound', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    const { ctx } = await boot(root, keyPath, ['    maxFrameBytes: 1024', '    maxSyncUpdateBytes: 1024'], false)
    const entry = [...ctx.loader.entries()].find(row => row.options.name === '@ketos/peer')
    expect(entry?.fiber?.state).toBe(FiberState.FAILED)
    await expect(entry?.fiber?.await()).rejects.toThrow(/maxSyncUpdateBytes/u)
  })

  it('refuses a reconnection floor above the ceiling', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    const { ctx } = await boot(root, keyPath, ['    reconnectMinMs: 5000', '    reconnectMaxMs: 4000'], false)
    const entry = [...ctx.loader.entries()].find(row => row.options.name === '@ketos/peer')
    expect(entry?.fiber?.state).toBe(FiberState.FAILED)
    await expect(entry?.fiber?.await()).rejects.toThrow(/reconnectMinMs/u)
  })

  it('refuses a transcript bound that leaves no room for the request envelope in a frame', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    const refused = [
      '    maxFrameBytes: 4096', '    maxSyncUpdateBytes: 2048', '    transcriptMaxBytes: 4096', '    transcriptMaxMessageChars: 100',
    ]
    const { ctx } = await boot(root, keyPath, refused, false)
    const entry = [...ctx.loader.entries()].find(row => row.options.name === '@ketos/peer')
    expect(entry?.fiber?.state).toBe(FiberState.FAILED)
    await expect(entry?.fiber?.await()).rejects.toThrow(/transcriptMaxBytes/u)
  })

  it('accepts the largest transcript bound the frame leaves room for', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    await boot(root, keyPath, [
      '    maxFrameBytes: 4096', '    maxSyncUpdateBytes: 2048', '    transcriptMaxBytes: 3072', '    transcriptMaxMessageChars: 100',
    ])
  })

  it('refuses a transcript byte bound below what the longest message can need', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    // 4000 units * 6 bytes of worst-case JSON escape + 256 bytes of wrapper, role, and time = 24256.
    const { ctx } = await boot(root, keyPath, ['    transcriptMaxMessageChars: 4000', '    transcriptMaxBytes: 24255'], false)
    const entry = [...ctx.loader.entries()].find(row => row.options.name === '@ketos/peer')
    expect(entry?.fiber?.state).toBe(FiberState.FAILED)
    await expect(entry?.fiber?.await()).rejects.toThrow(/transcriptMaxMessageChars/u)
  })

  it('accepts the smallest transcript byte bound the longest message fits, and the defaults', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    await boot(root, keyPath, ['    transcriptMaxMessageChars: 4000', '    transcriptMaxBytes: 24256'])
    const defaults = Peer.Config({ name: 'Кирилл', relayUrls: ['http://127.0.0.1:1'], keyPath: 'k', peersPath: 'p' })
    expect((defaults.transcriptMaxMessageChars as number) * 6 + 256).toBeLessThanOrEqual(defaults.transcriptMaxBytes as number)
  })

  it('defaults and bounds the transcript limits', () => {
    const base = { name: 'Кирилл', relayUrls: ['http://127.0.0.1:1'], keyPath: 'peer.key', peersPath: 'peers.json' }
    const config = Peer.Config(base)
    expect(config.transcriptMaxMessages).toBe(20)
    expect(config.transcriptMaxMessageChars).toBe(4000)
    expect(config.transcriptMaxBytes).toBe(65_536)
    expect(config.transcriptTimeoutMs).toBe(5000)
    const accepted: Array<Record<string, number>> = [
      { transcriptMaxMessages: 1 }, { transcriptMaxMessages: 200 },
      { transcriptMaxMessageChars: 1 }, { transcriptMaxMessageChars: 100_000 },
      { transcriptMaxBytes: 1024 }, { transcriptMaxBytes: 1_048_576 },
      { transcriptTimeoutMs: 500 }, { transcriptTimeoutMs: 60_000 },
    ]
    for (const override of accepted) expect(() => Peer.Config({ ...base, ...override })).not.toThrow()
    const refused: Array<Record<string, number>> = [
      { transcriptMaxMessages: 0 }, { transcriptMaxMessages: 201 }, { transcriptMaxMessages: 1.5 },
      { transcriptMaxMessageChars: 0 }, { transcriptMaxMessageChars: 100_001 },
      { transcriptMaxBytes: 1023 }, { transcriptMaxBytes: 1_048_577 },
      { transcriptTimeoutMs: 499 }, { transcriptTimeoutMs: 60_001 },
    ]
    for (const override of refused) expect(() => Peer.Config({ ...base, ...override })).toThrow()
  })

  it('defaults and bounds the heartbeat', () => {
    const base = { name: 'Кирилл', relayUrls: ['http://127.0.0.1:1'], keyPath: 'peer.key', peersPath: 'peers.json' }
    const config = Peer.Config(base)
    expect(config.heartbeatIntervalMs).toBe(3000)
    expect(config.heartbeatTimeoutMs).toBe(9000)
    const accepted: Array<Record<string, number>> = [
      { heartbeatIntervalMs: 500 }, { heartbeatIntervalMs: 30_000 },
      { heartbeatTimeoutMs: 1000 }, { heartbeatTimeoutMs: 60_000 },
    ]
    for (const override of accepted) expect(() => Peer.Config({ ...base, ...override })).not.toThrow()
    const refused: Array<Record<string, number>> = [
      { heartbeatIntervalMs: 499 }, { heartbeatIntervalMs: 30_001 }, { heartbeatIntervalMs: 1500.5 },
      { heartbeatTimeoutMs: 999 }, { heartbeatTimeoutMs: 60_001 }, { heartbeatTimeoutMs: 9000.5 },
    ]
    for (const override of refused) expect(() => Peer.Config({ ...base, ...override })).toThrow()
  })

  it('refuses a heartbeat timeout shorter than two intervals', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    const { ctx } = await boot(root, keyPath, ['    heartbeatIntervalMs: 3000', '    heartbeatTimeoutMs: 5999'], false)
    const entry = [...ctx.loader.entries()].find(row => row.options.name === '@ketos/peer')
    expect(entry?.fiber?.state).toBe(FiberState.FAILED)
    await expect(entry?.fiber?.await()).rejects.toThrow(
      'heartbeatTimeoutMs (5999) must be at least twice heartbeatIntervalMs (3000)',
    )
  })

  it('accepts a heartbeat timeout of exactly two intervals', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const { ctx } = await boot(root, join(root, 'peer.key'), ['    heartbeatIntervalMs: 30000', '    heartbeatTimeoutMs: 60000'])
    expect(ctx.ketosPeer).toBeInstanceOf(KetosPeerService)
  })

  it('defaults the reconnection ceiling to 20 seconds', () => {
    const config = Peer.Config({
      name: 'Кирилл', relayUrls: ['http://127.0.0.1:1'], keyPath: 'peer.key', peersPath: 'peers.json',
    })
    expect(config.reconnectMinMs).toBe(1000)
    expect(config.reconnectMaxMs).toBe(20_000)
  })

  it('routes board synchronization failures through the plugin logger', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    const { ctx } = await boot(root, keyPath)
    // This exporter passes every severity; the built-in buffer keeps INFO and
    // above only, so a warning would not land in it.
    const messages: Message[] = []
    ctx.logger.exporter({
      levels: { default: 100 },
      export: (message) => { messages.push(message) },
    })
    // A connected event for a peer with no channel makes the announcement
    // fail; the line must reach the plugin logger named for this package. The
    // event dispatches on the entry's own scope, where the service emits it.
    const entry = [...ctx.loader.entries()].find(row => row.options.name === '@ketos/peer')
    expect(entry?.fiber?.ctx).toBeDefined()
    entry?.fiber?.ctx.emit('ketos-peer/connected', {
      peerId: brandString<KetosPeerId>('peer-missing'),
      selfId: brandString<OwnerId>('owner-x'),
      name: 'X',
      color: 1,
    })
    await vi.waitFor(() => {
      expect(messages.some(message =>
        message.name === 'ketos-peer'
        && message.type === 'warn'
        && message.args.some(argument => String(argument).includes('board sync announce failed')),
      )).toBe(true)
    })
  })

  it('routes transcript failures through the plugin logger', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    let handler: ((payload: unknown, from: KetosPeerId) => unknown) | undefined
    const handle = vi.spyOn(KetosPeerService.prototype, 'handle').mockImplementation((type, register) => {
      if (type === 'chat.transcript.request') handler = (payload, from) => register(payload as never, from, {})
      return () => undefined
    })
    try {
      const { ctx } = await boot(root, keyPath)
      const messages: Message[] = []
      ctx.logger.exporter({
        levels: { default: 100 },
        export: (message) => { messages.push(message) },
      })
      // A closed board document makes the snapshot fail, which the handler
      // reports as an unavailable owner and a warning line.
      await ctx.ketosBoardDoc.close()
      await expect(handler?.({ windowId: 'w1' }, brandString<KetosPeerId>('peer-x')))
        .resolves.toEqual({ ok: false, reason: 'unavailable' })
      expect(messages.some(message =>
        message.name === 'ketos-peer'
        && message.type === 'warn'
        && message.args.some(argument => String(argument).includes('transcript of window w1 unavailable')),
      )).toBe(true)
    } finally {
      handle.mockRestore()
    }
  })

  it('loads with a syncthing section whose key is not set, the feature off with one log line', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    const { ctx, routes, messages } = await boot(root, keyPath, syncthingRows(SYNCTHING_SECTION))
    expect(ctx.ketosPeer).toBeInstanceOf(KetosPeerService)
    expect(routes.has(PEER_STATE_PATH)).toBe(true)
    await vi.waitFor(() => { expect(peerLines(messages, 'syncthing.')).toHaveLength(1) })
    expect(peerLines(messages, 'syncthing.disabled')).toEqual([
      'ketos-peer: syncthing.disabled: KETOS_PEER_SPEC_UNSET_SYNCTHING_KEY is not set; the shared folder stays off',
    ])
    expect(await ctx.ketosPeer.state()).not.toHaveProperty('sharedFolder')
  })

  it('logs a failed Syncthing start once and keeps the plugin alive', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    vi.mocked(registerSyncthing).mockImplementationOnce(() => ({
      sharedFolder: () => undefined,
      started: Promise.reject(new Error('syncthing start broke')),
    }))
    const { ctx, messages } = await boot(root, join(root, 'peer.key'), syncthingRows(SYNCTHING_SECTION))
    await vi.waitFor(() => {
      expect(peerLines(messages, 'syncthing')).toEqual(['ketos-peer: syncthing start failed: Error: syncthing start broke'])
    })
    expect(ctx.ketosPeer).toBeInstanceOf(KetosPeerService)
    expect(await ctx.ketosPeer.state()).not.toHaveProperty('sharedFolder')
  })

  it('reports no shared-folder state without a syncthing section', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const { ctx, messages } = await boot(root, join(root, 'peer.key'))
    expect(await ctx.ketosPeer.state()).not.toHaveProperty('sharedFolder')
    expect(peerLines(messages, 'syncthing.')).toEqual([])
  })

  it('reads a Syncthing served over HTTP with the key from the environment and reports the shared folder', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const fake = new FakeSyncthing()
    const url = await serveSyncthing(fake)
    vi.stubEnv('KETOS_PEER_SPEC_SYNCTHING_KEY', FAKE_API_KEY)
    const { ctx, messages } = await boot(root, join(root, 'peer.key'), syncthingRows({
      ...SYNCTHING_SECTION, url, apiKeyEnv: 'KETOS_PEER_SPEC_SYNCTHING_KEY', relayAddress: RELAY_ADDRESS,
    }))
    await vi.waitFor(async () => { expect((await ctx.ketosPeer.state()).sharedFolder).toBe('waiting') })
    expect(fake.requests.map(request => request.path)).toEqual(expect.arrayContaining(['/rest/system/ping', '/rest/config/options']))
    expect(fake.requests.every(request => request.apiKey === FAKE_API_KEY)).toBe(true)
    expect(fake.writes()).toEqual([])
    expect(peerLines(messages, 'syncthing.')).toEqual(['ketos-peer: syncthing.waiting: no shared folder yet'])
  })

  it('refuses a syncthing relay address that carries the token, without echoing the token', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    const token = 'spec-relay-token-91c2'
    const { ctx } = await boot(root, keyPath, syncthingRows({
      ...SYNCTHING_SECTION, relayAddress: `${SYNCTHING_SECTION.relayAddress}&token=${token}`,
    }), false)
    const entry = [...ctx.loader.entries()].find(row => row.options.name === '@ketos/peer')
    expect(entry?.fiber?.state).toBe(FiberState.FAILED)
    const error = await entry?.fiber?.await().then(() => undefined, (reason: unknown) => reason)
    expect(String(error)).toMatch(/syncthing\.relayAddress must not carry the relay token/u)
    expect(String(error)).not.toContain(token)
  })

  it('refuses an empty syncthing relay address, as an unset stand variable yields', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    const { ctx } = await boot(root, keyPath, syncthingRows({ ...SYNCTHING_SECTION, relayAddress: '' }), false)
    const entry = [...ctx.loader.entries()].find(row => row.options.name === '@ketos/peer')
    expect(entry?.fiber?.state).toBe(FiberState.FAILED)
    await expect(entry?.fiber?.await()).rejects.toThrow(/syncthing\.relayAddress is empty/u)
  })

  it('refuses a syncthing section outside its bounds', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    const { ctx } = await boot(root, keyPath, syncthingRows({ ...SYNCTHING_SECTION, statusRefreshMs: 10 }), false)
    const entry = [...ctx.loader.entries()].find(row => row.options.name === '@ketos/peer')
    expect(entry?.fiber?.state).toBe(FiberState.FAILED)
  })

  it('ships the web profile row disabled so a developer machine never loads iroh', async () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const patch = await readFile(resolve(here, '../../../bundle/web-app/cordis.patch.yml'), 'utf8')
    const row = patch.slice(patch.indexOf('- id: ketos-peer'))
    const block = row.slice(0, row.indexOf('\n\n'))
    expect(block).toContain("name: '@ketos/peer'")
    expect(block).toContain('disabled: true')
  })
})
