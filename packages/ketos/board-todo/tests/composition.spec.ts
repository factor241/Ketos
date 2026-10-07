// Proves the to-do package composes the way the shipped web profile mounts
// it: a real Loader boots `@ketos/board-todo` from cordis.yml against the four
// injected services, registers the route and the `/todo` command, withdraws
// both on dispose, and refuses a config outside the declared bounds.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, FiberState, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessTerminalEnvironment } from '@deepseek-ai/dsh-subprocess'
import * as BoardTodo from '@ketos/board-todo'
import { TODO_PATH } from '../src/routes.ts'

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

/** Stand-in for the command registry that records definitions and their disposal. */
class StubCommands extends Service {
  readonly registered = new Map<string, CommandDefinition>()

  constructor(ctx: Context) {
    super(ctx, 'commands')
  }

  register(definition: CommandDefinition): () => void {
    this.registered.set(definition.name, definition)
    return () => { this.registered.delete(definition.name) }
  }
}

/** Stand-in for the board document; the to-do plugin only holds the service. */
class StubBoardDoc extends Service {
  constructor(ctx: Context) {
    super(ctx, 'ketosBoardDoc')
  }
}

/** Stand-in for the subprocess seam; the wrapper resolves lazily on first use. */
class StubSubprocess extends SubprocessRuntime {
  override resolveExecutable(): Promise<string> {
    return Promise.reject(new Error('unused'))
  }

  override terminalEnvironment(): Promise<SubprocessTerminalEnvironment> {
    return Promise.resolve({ platform: 'posix' })
  }

  override spawn(): SubprocessHandle {
    throw new Error('unused')
  }

  override spawnTerminal(): Promise<never> {
    throw new Error('unused')
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
  readonly commands: StubCommands
  readonly entry: { fiber?: { state: FiberState; await(): Promise<unknown> } } | undefined
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
 * Boot a temporary cordis.yml carrying the to-do package row over the four
 * service stand-ins.
 * @param extraConfig - further row config fields, as literal YAML values.
 * @returns the booted context, the recorded routes, the commands, and the entry.
 */
async function boot(extraConfig: Record<string, string | number> = {}): Promise<Booted> {
  root = await mkdtemp(join(tmpdir(), 'dsh-board-todo-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@ketos/board-todo'",
    '  config:',
    `    beadsDir: ${JSON.stringify(join(root, 'beads'))}`,
    '    bdCommand: bd',
    '    beadsPrefix: kt',
    ...Object.entries(extraConfig).map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`),
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const connection = new RecordingConnection(ctx)
  const commands = new StubCommands(ctx)
  new StubBoardDoc(ctx)
  await ctx.plugin(StubSubprocess)
  await loadThroughLoader(ctx, configPath, new Map<string, unknown>([['@ketos/board-todo', BoardTodo]]))
  const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name === '@ketos/board-todo')
  return {
    ctx,
    routes: connection.routes,
    withdrawn: connection.withdrawn,
    commands,
    entry: entry as Booted['entry'],
  }
}

describe('to-do package real Loader composition', () => {
  it('activates through the Loader, registers the route and command, and disposes cleanly', async () => {
    const { ctx, routes, withdrawn, commands, entry } = await boot()
    expect(entry?.fiber?.state).toBe(FiberState.ACTIVE)
    expect([...routes.keys()]).toEqual([TODO_PATH])
    expect(routes.get(TODO_PATH)?.methods).toEqual(['POST'])
    expect(routes.get(TODO_PATH)?.requestBody).toBe('buffered')
    expect([...commands.registered.keys()]).toEqual(['todo'])
    expect(commands.registered.get('todo')?.description).toBe('Add a to-do list to the board')
    expect(commands.registered.get('todo')?.input).toEqual({ hint: '<title>' })

    // A request against the stand-in document fails, and the plugin's route
    // logger carries the unexpected failure to the host journal.
    const failed = await routes.get(TODO_PATH)?.fetch(new Request(`http://localhost${TODO_PATH}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'refresh', elementId: '00000000-0000-4000-8000-000000000001' }),
    }))
    expect(failed?.status).toBe(500)

    await ctx.fiber.dispose()
    expect(entry?.fiber?.state).toBe(FiberState.DISPOSED)
    expect(withdrawn).toEqual([TODO_PATH])
    expect(commands.registered.size).toBe(0)
  })

  it('refuses a config that leaves the declared bounds', async () => {
    const { entry } = await boot({ bdTimeoutMs: 0 })
    expect(entry?.fiber?.state).toBe(FiberState.FAILED)
    await expect(entry?.fiber?.await()).rejects.toThrow(/bdTimeoutMs/u)
  })
})
