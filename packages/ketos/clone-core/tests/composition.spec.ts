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
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderContextSections, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as CloneCore from '@ketos/clone-core'
import { MEMORY_PATH } from '../src/memory-routes.ts'
import { CLONES_PATH } from '../src/routes.ts'
import { openDatabase } from '../src/db.ts'
import {
  CLONE_INTERVIEW_SECTION, CLONE_MEMORY_CONTEXT, CLONE_PROFILE_SECTION,
} from '../src/session.ts'
import type { CloneAnswerResponse, MemoryListResponse } from '../src/types.ts'
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
  return await pathRequest(route, CLONES_PATH, body)
}

/** One decoded request against the booted memory route. */
async function memoryRequest(route: ConnectionFetchRoute, body: unknown): Promise<Record<string, unknown>> {
  return await pathRequest(route, MEMORY_PATH, body)
}

/** One decoded request against one booted route path. */
async function pathRequest(route: ConnectionFetchRoute, path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await route.fetch(new Request(`http://localhost${path}`, {
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
 * @param extraConfig - further row config fields, as literal YAML values.
 * @returns the booted context, the recorded routes, and the database path.
 */
async function boot(withPath = true, extraConfig: Record<string, string | number> = {}): Promise<Booted> {
  root = await mkdtemp(join(tmpdir(), 'dsh-clone-loader-'))
  const path = join(root, 'clones.db')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@ketos/clone-core'",
    ...withPath
      ? [
        '  config:',
        `    path: ${JSON.stringify(path)}`,
        ...Object.entries(extraConfig).map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`),
      ]
      : [],
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
    expect(routes.get(MEMORY_PATH)?.methods).toEqual(['POST'])
    expect(routes.get(MEMORY_PATH)?.requestBody).toBe('buffered')
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
    // The memory route is registered last, so it is withdrawn first.
    expect(withdrawn).toEqual([MEMORY_PATH, CLONES_PATH])
    expect(routes.has(CLONES_PATH)).toBe(false)
    expect(routes.has(MEMORY_PATH)).toBe(false)

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

  it('queues one kickoff even when a stored change lands while the turn opens', async () => {
    // Between the driver claiming the kickoff and appending it to the log no
    // record carries it; a mutation there must not queue a second one.
    const { ctx, routes } = await boot()
    const route = routes.get(CLONES_PATH) as ConnectionFetchRoute
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('Первый вопрос')]))
    const gate = Promise.withResolvers<undefined>()
    let held = false
    ctx.on('agent/pre-step', async (_payload, next) => {
      if (!held) {
        held = true
        await gate.promise
      }
      return await next()
    })
    const created = answered(await request(route, { op: 'create', name: 'Анна', role: 'Аналитик' }))
    await request(route, { op: 'update', id: created.clone.id, revision: 1, patch: { status: 'interviewing' } })
    await request(route, {
      op: 'bindSession', cloneId: created.clone.id, sessionId: 'interview-gap', role: 'interview',
    })

    const agent = await ctx.agentLoop.create(SessionId('interview-gap'), { provider: 'mock', model: 'mock' })
    const opens = (): number => agent.session.snapshotEvents().filter(event => event.type === 'user/message'
      && event.data.source.kind === 'ketos-clone-interview').length
    await vi.waitFor(() => { expect(agent.inbox.nextTurn).toHaveLength(0) })
    expect(opens()).toBe(0)

    // The stored change arrives while the claimed message is still unlogged.
    await request(route, { op: 'update', id: created.clone.id, revision: 2, patch: { description: 'Разбор' } })
    gate.resolve(undefined)
    await vi.waitFor(() => { expect(opens()).toBe(1) })
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    expect(opens()).toBe(1)
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

  it('records the invalid-draft code for a profile the store refuses', async () => {
    const { ctx, routes } = await boot()
    const route = routes.get(CLONES_PATH) as ConnectionFetchRoute
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('Первый вопрос')]))
    const created = answered(await request(route, { op: 'create', name: 'Анна', role: 'Аналитик' }))
    await request(route, { op: 'update', id: created.clone.id, revision: 1, patch: { status: 'interviewing' } })
    await request(route, {
      op: 'bindSession', cloneId: created.clone.id, sessionId: 'interview-bounds', role: 'interview',
    })
    const agent = await ctx.agentLoop.create(SessionId('interview-bounds'), { provider: 'mock', model: 'mock' })
    await vi.waitFor(() => { expect(ctx.tools.get('clone_draft_save', agent)).toBeDefined() })

    const refused = await ctx.tools.execute({
      callId: ToolCallId('call-bounds'),
      name: 'clone_draft_save',
      arguments: {
        role: '  ',
        description: 'описание',
        persona: 'персона',
        methodology: 'метод',
        skills: [],
      },
      agent,
      signal: new AbortController().signal,
    })
    expect(refused.isError).toBe(true)
    expect(refused.error?.info?.code).toBe('ketos/invalid-draft')
    // The refusal wrote nothing: the clone is still interviewing.
    expect(answered(await request(route, { op: 'get', id: created.clone.id })).clone.status).toBe('interviewing')
  })

  it('keeps the assembled interview prompt identical between turns', async () => {
    const { ctx, routes } = await boot()
    const route = routes.get(CLONES_PATH) as ConnectionFetchRoute
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('Первый вопрос')]))
    const created = answered(await request(route, { op: 'create', name: 'Анна', role: 'Аналитик' }))
    await request(route, { op: 'update', id: created.clone.id, revision: 1, patch: { status: 'interviewing' } })
    await request(route, {
      op: 'bindSession', cloneId: created.clone.id, sessionId: 'interview-prompt', role: 'interview',
    })
    const agent = await ctx.agentLoop.create(SessionId('interview-prompt'), { provider: 'mock', model: 'mock' })
    await vi.waitFor(async () => {
      const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
      expect(assembly.sections.map(section => section.name)).toContain(CLONE_INTERVIEW_SECTION)
    })
    const before = renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(agent)))
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Я аналитик' }], source: { kind: 'user' } }))
    await vi.waitFor(() => { expect(agent.status).toBe('idle') })
    const after = renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(agent)))
    expect(after).toBe(before)
  })
})

describe('clone memory over the shipped composition', () => {
  it('composes the memory tools into a bound agent and saves and finds a memory', async () => {
    const { ctx, routes } = await boot()
    const cloneRoute = routes.get(CLONES_PATH) as ConnectionFetchRoute
    const memoryRoute = routes.get(MEMORY_PATH) as ConnectionFetchRoute
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('Привет')]))
    const created = answered(await request(cloneRoute, { op: 'create', name: 'Анна', role: 'Аналитик' }))
    await request(cloneRoute, { op: 'bindSession', cloneId: created.clone.id, sessionId: 'clone-1' })
    const agent = await ctx.agentLoop.create(SessionId('clone-1'), { provider: 'mock', model: 'mock' })
    await vi.waitFor(() => {
      expect(ctx.tools.get('clone_memory_remember', agent)).toBeDefined()
      expect(ctx.tools.get('clone_memory_search', agent)).toBeDefined()
    })
    // The tools belong to this agent's scope only: the global catalog of an
    // ordinary session stays untouched.
    expect(ctx.tools.get('clone_memory_remember')).toBeUndefined()
    expect(ctx.tools.get('clone_memory_search')).toBeUndefined()

    const remembered = await ctx.tools.execute({
      callId: ToolCallId('call-remember'),
      name: 'clone_memory_remember',
      arguments: { content: 'Предпочитает короткие письма', tags: ['стиль'], methodology_candidate: true },
      agent,
      signal: new AbortController().signal,
    })
    expect(remembered.isError).toBe(false)
    const saved = remembered.isError ? { id: '', status: '' } : remembered.value as { id: string; status: string }
    expect(saved.status).toBe('candidate')
    // The model-facing projection is rendered text, never raw JSON.
    expect(remembered.content).toEqual([{
      type: 'text',
      text: `Saved to the clone's memory as candidate; its id is ${saved.id}.`,
    }])

    const found = await ctx.tools.execute({
      callId: ToolCallId('call-search'),
      name: 'clone_memory_search',
      arguments: { query: 'письм' },
      agent,
      signal: new AbortController().signal,
    })
    expect(found.isError).toBe(false)
    expect(found.isError ? [] : (found.value as unknown as { memories: readonly unknown[] }).memories).toMatchObject([{
      id: saved.id,
      content: 'Предпочитает короткие письма',
      tags: ['стиль'],
      status: 'candidate',
    }])
    expect(found.content).toEqual([{ type: 'text', text: `[${saved.id}] Предпочитает короткие письма` }])

    const listed = await memoryRequest(memoryRoute, { op: 'list', cloneId: created.clone.id }) as unknown as MemoryListResponse
    expect(listed.memories).toMatchObject([{
      id: saved.id,
      content: 'Предпочитает короткие письма',
      tags: ['стиль'],
      sourceSessionId: 'clone-1',
      status: 'candidate',
    }])
  })

  it('keeps the memory tools and the memory context out of an unbound session', async () => {
    const { ctx, path } = await boot()
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('Привет')]))
    const agent = await ctx.agentLoop.create(SessionId('plain-1'), { provider: 'mock', model: 'mock' })
    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    expect(assembly.sections.map(section => section.name)).not.toContain(CLONE_PROFILE_SECTION)
    expect(assembly.contexts.map(context => context.name)).not.toContain(CLONE_MEMORY_CONTEXT)
    expect(assembly.tools.map(tool => tool.name)).not.toContain('clone_memory_remember')
    // Nothing about this session is a clone, so its database stays unopened.
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses the memory tools when their session lost the clone binding', async () => {
    const { ctx, routes, path } = await boot()
    const cloneRoute = routes.get(CLONES_PATH) as ConnectionFetchRoute
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('Привет')]))
    const created = answered(await request(cloneRoute, { op: 'create', name: 'Анна', role: 'Аналитик' }))
    await request(cloneRoute, { op: 'bindSession', cloneId: created.clone.id, sessionId: 'clone-2' })
    const agent = await ctx.agentLoop.create(SessionId('clone-2'), { provider: 'mock', model: 'mock' })
    await vi.waitFor(() => { expect(ctx.tools.get('clone_memory_remember', agent)).toBeDefined() })

    // A hand-edited database whose binding outlived the clone it named.
    const direct = await openDatabase(path)
    direct.prepare('DELETE FROM clone_sessions WHERE session_id = ?').run('clone-2')
    direct.close()

    for (const call of [
      { name: 'clone_memory_remember', arguments: { content: 'Факт' } },
      { name: 'clone_memory_search', arguments: { query: 'факт' } },
    ]) {
      const refused = await ctx.tools.execute({
        callId: ToolCallId(`call-${call.name}`),
        name: call.name,
        arguments: call.arguments,
        agent,
        signal: new AbortController().signal,
      })
      expect(refused.isError, call.name).toBe(true)
      expect(refused.error?.info?.code, call.name).toBe('ketos/not-a-clone-session')
    }
  })

  it('refuses a memory whose content or search limit leaves the bounds', async () => {
    const { ctx, routes } = await boot()
    const cloneRoute = routes.get(CLONES_PATH) as ConnectionFetchRoute
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('Привет')]))
    const created = answered(await request(cloneRoute, { op: 'create', name: 'Анна', role: 'Аналитик' }))
    await request(cloneRoute, { op: 'bindSession', cloneId: created.clone.id, sessionId: 'clone-3' })
    const agent = await ctx.agentLoop.create(SessionId('clone-3'), { provider: 'mock', model: 'mock' })
    await vi.waitFor(() => { expect(ctx.tools.get('clone_memory_remember', agent)).toBeDefined() })

    const calls = [
      { name: 'clone_memory_remember', arguments: { content: 'x'.repeat(4001) } },
      { name: 'clone_memory_remember', arguments: { content: '   ' } },
      { name: 'clone_memory_search', arguments: { query: 'факт', limit: 21 } },
    ]
    for (const call of calls) {
      const refused = await ctx.tools.execute({
        callId: ToolCallId(`call-bounds-${call.name}-${String(call.arguments.limit ?? '')}`),
        name: call.name,
        arguments: call.arguments,
        agent,
        signal: new AbortController().signal,
      })
      expect(refused.isError, JSON.stringify(call)).toBe(true)
      expect(refused.error?.info?.code, JSON.stringify(call)).toBe('ketos/invalid-memory')
    }
    // The refusals wrote nothing.
    expect((await memoryRequest(routes.get(MEMORY_PATH) as ConnectionFetchRoute, {
      op: 'list', cloneId: created.clone.id,
    }) as unknown as MemoryListResponse).memories).toEqual([])
  })
})

describe('clone profile and memory injection over the shipped composition', () => {
  it('injects the profile and follows user memory edits without touching the prompt prefix', async () => {
    const { ctx, routes } = await boot()
    const cloneRoute = routes.get(CLONES_PATH) as ConnectionFetchRoute
    const memoryRoute = routes.get(MEMORY_PATH) as ConnectionFetchRoute
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('Привет')]))
    const created = answered(await request(cloneRoute, {
      op: 'create',
      name: 'Анна',
      role: 'Аналитик',
      persona: 'Спокойная и точная',
      methodology: 'Сначала факты, потом гипотезы',
    }))
    await request(cloneRoute, { op: 'bindSession', cloneId: created.clone.id, sessionId: 'clone-profile' })
    const agent = await ctx.agentLoop.create(SessionId('clone-profile'), { provider: 'mock', model: 'mock' })
    await vi.waitFor(async () => {
      const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
      expect(assembly.sections.map(section => section.name)).toContain(CLONE_PROFILE_SECTION)
    })
    const profile = renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(agent)))
    expect(profile).toContain('You are the digital clone of Анна, working as Аналитик.')
    expect(profile).toContain('Character, tone, and working style: Спокойная и точная')
    expect(profile).toContain('Working method: Сначала факты, потом гипотезы')
    // Nothing is remembered yet, so the dynamic snapshot renders nothing.
    const empty = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    expect(renderContextSections(empty).map(context => context.name)).not.toContain(CLONE_MEMORY_CONTEXT)

    // The agent saves one fact; the snapshot picks it up on the next assembly.
    const remembered = await ctx.tools.execute({
      callId: ToolCallId('call-profile-remember'),
      name: 'clone_memory_remember',
      arguments: { content: 'Считает сроки критичными' },
      agent,
      signal: new AbortController().signal,
    })
    expect(remembered.isError).toBe(false)
    const saved = remembered.isError ? { id: '' } : remembered.value as { id: string }
    await vi.waitFor(async () => {
      const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
      expect(renderContextSections(assembly).find(context => context.name === CLONE_MEMORY_CONTEXT)?.text)
        .toContain('Считает сроки критичными')
    })
    // A memory write never touches the stable section prefix.
    expect(renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(agent)))).toBe(profile)

    // The person edits and then deletes the memory; each change reaches the
    // next assembly through the same snapshot.
    await memoryRequest(memoryRoute, {
      op: 'update', id: saved.id, patch: { content: 'Считает сроки критичными, письма — короткими' },
    })
    await vi.waitFor(async () => {
      const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
      expect(renderContextSections(assembly).find(context => context.name === CLONE_MEMORY_CONTEXT)?.text)
        .toContain('письма — короткими')
    })
    await memoryRequest(memoryRoute, { op: 'delete', id: saved.id })
    await vi.waitFor(async () => {
      const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
      expect(renderContextSections(assembly).map(context => context.name)).not.toContain(CLONE_MEMORY_CONTEXT)
    })

    // A profile edit updates the section, because the profile is the clone.
    await request(cloneRoute, {
      op: 'update',
      id: created.clone.id,
      revision: 1,
      patch: { persona: 'Резкая и быстрая' },
    })
    await vi.waitFor(async () => {
      expect(renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(agent))))
        .toContain('Character, tone, and working style: Резкая и быстрая')
    })
  })

  it('honours the configured snapshot size', async () => {
    const { ctx, routes } = await boot(true, { memoryEntries: 1 })
    const cloneRoute = routes.get(CLONES_PATH) as ConnectionFetchRoute
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('Привет')]))
    const created = answered(await request(cloneRoute, { op: 'create', name: 'Анна', role: 'Аналитик' }))
    await request(cloneRoute, { op: 'bindSession', cloneId: created.clone.id, sessionId: 'clone-budget' })
    const agent = await ctx.agentLoop.create(SessionId('clone-budget'), { provider: 'mock', model: 'mock' })
    await vi.waitFor(() => { expect(ctx.tools.get('clone_memory_remember', agent)).toBeDefined() })
    for (const content of ['Первый факт', 'Второй факт']) {
      const saved = await ctx.tools.execute({
        callId: ToolCallId(`call-budget-${content}`),
        name: 'clone_memory_remember',
        arguments: { content },
        agent,
        signal: new AbortController().signal,
      })
      expect(saved.isError).toBe(false)
    }
    await vi.waitFor(async () => {
      const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
      const snapshot = renderContextSections(assembly).find(context => context.name === CLONE_MEMORY_CONTEXT)?.text ?? ''
      expect(snapshot).toContain('Второй факт')
      expect(snapshot).not.toContain('Первый факт')
    })
  })

  it('withdraws the whole clone scope when the clone is deleted', async () => {
    const { ctx, routes } = await boot()
    const cloneRoute = routes.get(CLONES_PATH) as ConnectionFetchRoute
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('Привет')]))
    const created = answered(await request(cloneRoute, { op: 'create', name: 'Анна', role: 'Аналитик', persona: 'Спокойная' }))
    await request(cloneRoute, { op: 'bindSession', cloneId: created.clone.id, sessionId: 'clone-deleted' })
    const agent = await ctx.agentLoop.create(SessionId('clone-deleted'), { provider: 'mock', model: 'mock' })
    await vi.waitFor(() => { expect(ctx.tools.get('clone_memory_remember', agent)).toBeDefined() })

    await request(cloneRoute, { op: 'delete', id: created.clone.id, revision: 1 })
    await vi.waitFor(async () => {
      const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
      expect(assembly.sections.map(section => section.name)).not.toContain(CLONE_PROFILE_SECTION)
      expect(ctx.tools.get('clone_memory_remember', agent)).toBeUndefined()
    })
  })
})
