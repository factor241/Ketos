// Proves the board document package composes the way the shipped web profile
// mounts it: a real Loader boots `@ketos/board-doc` from cordis.yml, activates
// it against the connection service, and refuses a config that leaves the
// declared bounds. The database and the routes arrive with later sub-stages;
// this spec pins the composition seam those pieces hang from.
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, FiberState, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import * as Y from 'yjs'
import * as BoardDoc from '@ketos/board-doc'
import { openDatabase } from '../src/db.ts'
import { BOARD_EVENTS_PATH } from '../src/events.ts'
import { BoardJournal } from '../src/journal.ts'
import { BOARD_OPS_PATH, BOARD_PATH } from '../src/routes.ts'
import type { ElementId } from '../src/types.ts'

/**
 * Stand-in for the connection service that records exact routes and disposes
 * them with the registering fiber, mirroring `HostConnectionService.fetch`.
 */
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
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

interface Booted {
  readonly ctx: Context
  readonly routes: Map<string, ConnectionFetchRoute>
  readonly withdrawn: string[]
  readonly path: string
}

/**
 * Load one cordis.yml through the real Loader with a fixed module map.
 * @param ctx - context carrying the services the loaded rows inject.
 * @param configPath - file URL of the cordis.yml to include.
 * @param modules - loader import map, holding every bare plugin the file names.
 */
async function loadThroughLoader(ctx: Context, configPath: string, modules: Map<string, unknown>): Promise<void> {
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  // The custom import map is a test seam over Node's internal loader; the
  // runtime only calls `import(name, baseUrl, attrs)`.
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as never
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
}

/**
 * Boot a temporary cordis.yml carrying the board document package row against
 * a connection service that records registered routes.
 * @param extraConfig - further row config fields, as literal YAML values.
 * @returns the booted context, the recorded routes, and the database path.
 */
async function boot(extraConfig: Record<string, string | number> = {}): Promise<Booted> {
  root = await mkdtemp(join(tmpdir(), 'dsh-board-doc-loader-'))
  const path = join(root, 'board.db')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@ketos/board-doc'",
    '  config:',
    `    path: ${JSON.stringify(path)}`,
    ...Object.entries(extraConfig).map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`),
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const connection = new RecordingConnection(ctx)
  await loadThroughLoader(ctx, configPath, new Map<string, unknown>([['@ketos/board-doc', BoardDoc]]))
  return { ctx, routes: connection.routes, withdrawn: connection.withdrawn, path }
}

describe('board document package real Loader composition', () => {
  it('activates through the Loader and disposes cleanly', async () => {
    const { ctx, routes, withdrawn } = await boot()
    const entry = [...ctx.loader.entries()].find(row => row.options.name === '@ketos/board-doc')
    expect(entry?.fiber?.state).toBe(FiberState.ACTIVE)
    expect([...routes.keys()].sort()).toEqual([BOARD_EVENTS_PATH, BOARD_OPS_PATH, BOARD_PATH].sort())
    expect(routes.get(BOARD_PATH)?.methods).toEqual(['GET'])
    expect(routes.get(BOARD_OPS_PATH)?.methods).toEqual(['POST'])
    expect(routes.get(BOARD_EVENTS_PATH)?.methods).toEqual(['GET'])

    await ctx.fiber.dispose()
    context = undefined
    expect(entry?.fiber?.state).toBe(FiberState.DISPOSED)
    // The event route is registered last, so it is withdrawn first.
    expect(withdrawn).toEqual([BOARD_EVENTS_PATH, BOARD_OPS_PATH, BOARD_PATH])
  })

  it('provides the board document service through the Loader', async () => {
    const { ctx, path } = await boot()
    const service = ctx.ketosBoardDoc
    // The service exists without having opened the database.
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    const snapshot = await service.snapshot()
    expect(snapshot.elements).toEqual([])
    expect(snapshot.revision).toBe(0)

    await ctx.fiber.dispose()
    context = undefined
    await expect(service.selfId()).rejects.toThrow(/already closed/u)
  })

  it('logs and skips an element the document cannot decode', async () => {
    const { ctx, path } = await boot()
    // A stored element another build could have written: the service skips it
    // and reports it through the host log instead of failing the snapshot.
    const db = await openDatabase(path)
    const doc = new Y.Doc()
    const journal = new BoardJournal(db, doc, 500, () => {})
    await journal.load()
    doc.transact(() => {
      const map = new Y.Map<unknown>()
      map.set('kind', 'doodle')
      doc.getMap<Y.Map<unknown>>('elements').set('44444444-4444-4444-8444-444444444444', map)
    }, 'host')
    journal.close()
    db.close()

    const snapshot = await ctx.ketosBoardDoc.snapshot()
    expect(snapshot.elements).toEqual([])
  })

  it('closes an event stream that the configured queue bound overflows with the overflow event', async () => {
    const { ctx, routes } = await boot({ maxStreamQueueBytes: 16_384, noteTextMax: 20_000 })
    const response = await routes.get(BOARD_EVENTS_PATH)!.fetch(new Request(`http://localhost${BOARD_EVENTS_PATH}`))
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    // Nothing is read while a patch larger than the bound is committed.
    await ctx.ketosBoardDoc.snapshot()
    await ctx.ketosBoardDoc.apply([{
      op: 'create',
      id: brandString<ElementId>('00000000-0000-4000-8000-000000000001'),
      kind: 'note',
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      data: { text: 'x'.repeat(17_000), font: 'sans', size: 'm', scale: 1 },
    }], 'host')
    let received = ''
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      received += decoder.decode(chunk.value, { stream: true })
    }
    expect(received.startsWith('event: snapshot')).toBe(true)
    expect(received.endsWith('event: overflow\ndata: {"reason":"queue"}\n\n')).toBe(true)
  })

  it('fails loading when a limit leaves its declared bounds', async () => {
    const booted = await boot({ heartbeatMs: 0 })
    const entry = [...booted.ctx.loader.entries()].find(row => row.options.name === '@ketos/board-doc')
    expect(entry?.fiber?.state).toBe(FiberState.FAILED)
    await expect(entry?.fiber?.await()).rejects.toThrow(/heartbeatMs/)
  })
})
