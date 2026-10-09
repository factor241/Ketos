// Proves the peer package composes the way the shipped web profile mounts it:
// a real Loader boots `@ketos/board-doc` and `@ketos/peer` from cordis.yml
// against a connection service that records the routes, the node keeps one
// EndpointId across restarts through its key file, and a wrong-length key
// refuses to start.
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
import { PEER_CONNECT_PATH, PEER_INVITE_PATH, PEER_STATE_PATH } from '../src/routes.ts'
import { KetosPeerService } from '../src/service.ts'

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

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  root = undefined
})

/** One booted composition. */
interface Booted {
  readonly ctx: Context
  readonly routes: Map<string, ConnectionFetchRoute>
  readonly withdrawn: string[]
  readonly keyPath: string
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
  return { ctx, routes: connection.routes, withdrawn: connection.withdrawn, keyPath }
}

describe('peer package real Loader composition', () => {
  it('activates with the board document, provides the service, and withdraws its routes', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-loader-'))
    const keyPath = join(root, 'peer.key')
    const { ctx, routes, withdrawn } = await boot(root, keyPath)
    expect([...routes.keys()]).toEqual(expect.arrayContaining([PEER_STATE_PATH, PEER_INVITE_PATH, PEER_CONNECT_PATH]))
    expect(routes.get(PEER_STATE_PATH)?.methods).toEqual(['GET'])
    expect(routes.get(PEER_INVITE_PATH)?.methods).toEqual(['GET'])
    expect(routes.get(PEER_CONNECT_PATH)?.methods).toEqual(['POST'])
    expect(ctx.ketosPeer).toBeInstanceOf(KetosPeerService)

    await ctx.fiber.dispose()
    context = undefined
    expect(withdrawn).toEqual(expect.arrayContaining([PEER_STATE_PATH, PEER_INVITE_PATH, PEER_CONNECT_PATH]))
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

  it('ships the web profile row disabled so a developer machine never loads iroh', async () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const patch = await readFile(resolve(here, '../../../bundle/web-app/cordis.patch.yml'), 'utf8')
    const row = patch.slice(patch.indexOf('- id: ketos-peer'))
    const block = row.slice(0, row.indexOf('\n\n'))
    expect(block).toContain("name: '@ketos/peer'")
    expect(block).toContain('disabled: true')
  })
})
