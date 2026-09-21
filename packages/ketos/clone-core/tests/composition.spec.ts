// Proves the clone package composes the way the shipped web profile mounts it:
// a real Loader boots `@ketos/clone-core` from cordis.yml, activates it against
// a connection service, and reaches the database only through the route.
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import * as CloneCore from '@ketos/clone-core'
import { CLONES_PATH } from '../src/routes.ts'
import { openDatabase } from '../src/db.ts'
import type { CloneAnswerResponse } from '../src/types.ts'

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
 * Boot a temporary cordis.yml carrying the clone package row, against a
 * connection service that records registered routes.
 * @param withPath - whether the row config carries the database path.
 * @returns the booted context, the recorded routes, and the database path.
 */
async function boot(withPath = true): Promise<Booted> {
  root = await mkdtemp(join(tmpdir(), 'dsh-clone-loader-'))
  const path = join(root, 'clones.db')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@ketos/clone-core'",
    ...withPath ? ['  config:', `    path: ${JSON.stringify(path)}`] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const connection = new RecordingConnection(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([['@ketos/clone-core', CloneCore]])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return { ctx, routes: connection.routes, withdrawn: connection.withdrawn, path }
}

describe('clone package real Loader composition', () => {
  it('registers the clone route and opens the database only on the first request', async () => {
    const { routes, path } = await boot()
    const route = routes.get(CLONES_PATH)
    expect(route?.methods).toEqual(['GET', 'POST'])
    expect(route?.requestBody).toBe('buffered')
    // Laziness is observable: boot mounted the plugin but nothing opened the file.
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })

    const created = await (route as ConnectionFetchRoute).fetch(new Request(`http://localhost${CLONES_PATH}`, {
      method: 'POST',
      body: JSON.stringify({ op: 'create', name: 'Анна', role: 'Аналитик' }),
    }))
    expect((await created.json() as CloneAnswerResponse).clone).toMatchObject({ name: 'Анна', revision: 1 })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    const listed = await (route as ConnectionFetchRoute).fetch(new Request(`http://localhost${CLONES_PATH}`))
    expect(await listed.json()).toMatchObject({ ok: true, clones: [{ name: 'Анна' }] })
  })

  it('closes the database and withdraws the route at disposal, keeping the records', async () => {
    const { ctx, routes, withdrawn, path } = await boot()
    const route = routes.get(CLONES_PATH) as ConnectionFetchRoute
    await route.fetch(new Request(`http://localhost${CLONES_PATH}`, {
      method: 'POST',
      body: JSON.stringify({ op: 'create', name: 'Борис', role: 'Юрист' }),
    }))
    await ctx.fiber.dispose()
    context = undefined
    expect(withdrawn).toEqual([CLONES_PATH])
    expect(routes.has(CLONES_PATH)).toBe(false)

    const db = await openDatabase(path)
    expect(db.prepare('SELECT name FROM clones').all()).toEqual([{ name: 'Борис' }])
    db.close()
  })

  it('fails loading when the required path is missing', async () => {
    await expect(boot(false)).rejects.toThrow('$.path missing required value')
  })
})
