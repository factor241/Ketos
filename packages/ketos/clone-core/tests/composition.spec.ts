// Proves the clone package composes the way the shipped web profile mounts it:
// a real Loader boots `@ketos/clone-core` from cordis.yml, activates it against
// the connection, agent, and projection services, and reaches the database
// only through the route. The interview flow then runs against a real
// AgentLoop and a scripted model, so the whole stage-16 path is exercised over
// the shipped composition rather than a hand-built context.
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as CloneCore from '@ketos/clone-core'
import { CLONES_PATH } from '../src/routes.ts'
import { openDatabase } from '../src/db.ts'
import { CLONE_INTERVIEW_SECTION } from '../src/interview.ts'
import type { CloneAnswerResponse } from '../src/types.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

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

/** One decoded request against the booted clone route. */
async function request(route: ConnectionFetchRoute, body: unknown): Promise<Record<string, unknown>> {
  const response = await route.fetch(new Request(`http://localhost${CLONES_PATH}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }))
  return await response.json() as Record<string, unknown>
}

/** One clone answer as the route sends it. */
function answered(answer: Record<string, unknown>): CloneAnswerResponse {
  return answer as unknown as CloneAnswerResponse
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
  // The shipped profile carries the whole agent stack; the testkit mounts the
  // same services so the plugin's `agents` and `sessionProjections`
  // dependencies activate exactly as they do under `dsh web`.
  await mountAgentLoopTestDependencies(ctx)
  await mountAgentLoopTestHarness(ctx)
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

describe('clone interview over the shipped composition', () => {
  it('composes the interview into the bound agent scope and withdraws it on save', async () => {
    const { ctx, routes } = await boot()
    const route = routes.get(CLONES_PATH) as ConnectionFetchRoute
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('Какую роль вы занимаете?')]))

    const created = answered(await request(route, { op: 'create', name: 'Анна', role: 'Аналитик' }))
    await request(route, { op: 'update', id: created.clone.id, revision: 1, patch: { status: 'interviewing' } })
    await request(route, {
      op: 'bindSession', cloneId: created.clone.id, sessionId: 'interview-1', role: 'interview',
    })

    const agent = await ctx.agentLoop.create(SessionId('interview-1'), { provider: 'mock', model: 'mock' })
    // The mode is derived after the lifecycle event answered, so the scope
    // arrives on the next turn of the event loop.
    await vi.waitFor(async () => {
      const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
      expect(assembly.sections.map(section => section.name)).toContain(CLONE_INTERVIEW_SECTION)
      expect(renderPrompt(assembly)).toContain('You are interviewing a person')
      expect(assembly.tools.map(tool => tool.name)).toContain('clone_draft_save')
    })
    // The tool belongs to this agent's scope only: the global catalog of an
    // ordinary session stays untouched.
    expect(ctx.tools.get('clone_draft_save')).toBeUndefined()
    expect(ctx.tools.get('clone_draft_save', agent)).toBeDefined()

    /** Kickoff messages this session logged. */
    const opens = (): number => agent.session.snapshotEvents().filter(event => event.type === 'user/message'
      && event.data.source.kind === 'ketos-clone-interview').length
    await vi.waitFor(() => { expect(opens()).toBe(1) })

    // A stored change re-derives the mode; the opening turn is not queued twice.
    await request(route, { op: 'update', id: created.clone.id, revision: 2, patch: { description: 'Разбор требований' } })
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    expect(opens()).toBe(1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(1)

    const saved = await ctx.tools.execute({
      callId: ToolCallId('call-save'),
      name: 'clone_draft_save',
      arguments: {
        role: 'Старший аналитик',
        description: 'Разбирает требования',
        persona: 'Спокойная и точная',
        methodology: 'Сначала факты, потом гипотезы',
        skills: ['анализ', 'интервью'],
      },
      agent,
      signal: new AbortController().signal,
    })
    expect(saved.isError).toBe(false)

    const stored = answered(await request(route, { op: 'get', id: created.clone.id }))
    expect(stored.clone).toMatchObject({
      status: 'ready',
      role: 'Старший аналитик',
      persona: 'Спокойная и точная',
      skills: ['анализ', 'интервью'],
      revision: 4,
    })

    await vi.waitFor(async () => {
      const after = await ctx.systemPrompt.assemble(assembleContextFor(agent))
      expect(renderPrompt(after)).not.toContain('You are interviewing a person')
      expect(ctx.tools.get('clone_draft_save', agent)).toBeUndefined()
    })
  })

  it('installs the mode when the binding lands after the agent exists', async () => {
    // The shipped browser order creates the session before it binds it, so the
    // lifecycle events see a draft clone and no binding; the route's mutation
    // notification is what turns the mode on.
    const { ctx, routes } = await boot()
    const route = routes.get(CLONES_PATH) as ConnectionFetchRoute
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('С чего начнём?')]))
    const created = answered(await request(route, { op: 'create', name: 'Анна', role: 'Аналитик' }))
    await request(route, { op: 'update', id: created.clone.id, revision: 1, patch: { status: 'interviewing' } })

    const agent = await ctx.agentLoop.create(SessionId('interview-late'), { provider: 'mock', model: 'mock' })
    const before = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    expect(before.sections.map(section => section.name)).not.toContain(CLONE_INTERVIEW_SECTION)

    await request(route, {
      op: 'bindSession', cloneId: created.clone.id, sessionId: 'interview-late', role: 'interview',
    })
    await vi.waitFor(async () => {
      const after = await ctx.systemPrompt.assemble(assembleContextFor(agent))
      expect(after.sections.map(section => section.name)).toContain(CLONE_INTERVIEW_SECTION)
      expect(ctx.tools.get('clone_draft_save', agent)).toBeDefined()
    })
    await vi.waitFor(() => {
      expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message'
        && event.data.source.kind === 'ketos-clone-interview')).toHaveLength(1)
    })
  })

  it('refuses the profile tool when its session lost the clone binding', async () => {
    const { ctx, routes, path } = await boot()
    const route = routes.get(CLONES_PATH) as ConnectionFetchRoute
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('Первый вопрос')]))
    const created = answered(await request(route, { op: 'create', name: 'Анна', role: 'Аналитик' }))
    await request(route, { op: 'update', id: created.clone.id, revision: 1, patch: { status: 'interviewing' } })
    await request(route, {
      op: 'bindSession', cloneId: created.clone.id, sessionId: 'interview-2', role: 'interview',
    })
    const agent = await ctx.agentLoop.create(SessionId('interview-2'), { provider: 'mock', model: 'mock' })

    // A hand-edited database whose binding outlived the clone it named.
    const direct = await openDatabase(path)
    direct.prepare('DELETE FROM clone_sessions WHERE session_id = ?').run('interview-2')
    direct.close()

    const refused = await ctx.tools.execute({
      callId: ToolCallId('call-refused'),
      name: 'clone_draft_save',
      arguments: { role: 'роль', description: 'описание', persona: 'персона', methodology: 'метод', skills: [] },
      agent,
      signal: new AbortController().signal,
    })
    expect(refused.isError).toBe(true)
    expect(refused.error?.info?.code).toBe('ketos/not-a-clone-session')
  })
})
