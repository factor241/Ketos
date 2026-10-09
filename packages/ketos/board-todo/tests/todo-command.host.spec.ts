// The `/todo` command: registration and withdrawal with the plugin fiber, the
// usage error without a title, and the paired command/run + command/done
// events of a successful creation that waits for placement.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type {
  BeadsIssueId, BoardDocId, BoardOp, BoardOpsResponse, BoardOrigin, BoardRevision, BoardSnapshot, OwnerId,
} from '@ketos/board-doc/types'
import { BeadsCommandError } from '../src/beads.ts'
import type { BeadsIssue } from '../src/beads.ts'
import { todoCommand } from '../src/command.ts'
import type { TodoBeads, TodoDoc, TodoRouteConfig } from '../src/routes.ts'

/** The board document double: records the create operation and answers one revision. */
class RecordingDoc implements TodoDoc {
  readonly ops: BoardOp[] = []
  private revision = 0

  selfId(): Promise<OwnerId> {
    return Promise.resolve(brandString<OwnerId>('self'))
  }

  snapshot(): Promise<BoardSnapshot> {
    return Promise.resolve({
      docId: brandString<BoardDocId>('doc'),
      selfId: brandString<OwnerId>('self'),
      revision: brandNumber<BoardRevision>(this.revision),
      elements: [],
      participants: [],
      windows: [],
      limits: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 },
    })
  }

  apply(ops: readonly BoardOp[], _origin: BoardOrigin): Promise<BoardOpsResponse> {
    this.ops.push(...ops)
    this.revision += 1
    return Promise.resolve({ revision: brandNumber<BoardRevision>(this.revision) })
  }
}

/** The bd double: one epic, no items, and one scripted failure. */
class RecordingBeads implements TodoBeads {
  readonly calls: string[] = []
  failure: Error | undefined

  createEpic(title: string): Promise<BeadsIssue> {
    this.calls.push('createEpic')
    this.throwIfFailed()
    return Promise.resolve({
      id: brandString<BeadsIssueId>('kt-1'),
      title,
      status: 'open',
      createdAt: '2026-10-05T23:32:37Z',
    })
  }

  createItem(): Promise<BeadsIssue> {
    return Promise.reject(new Error('the command creates no items'))
  }

  setDone(): Promise<BeadsIssue> {
    return Promise.reject(new Error('the command sets no item state'))
  }

  children(): Promise<BeadsIssue[]> {
    this.calls.push('children')
    this.throwIfFailed()
    return Promise.resolve([])
  }

  show(): Promise<BeadsIssue | undefined> {
    return Promise.reject(new Error('the command shows no epic'))
  }

  private throwIfFailed(): void {
    if (this.failure !== undefined) throw this.failure
  }
}

interface Mounted {
  readonly ctx: Context
  readonly agent: Agent
  readonly doc: RecordingDoc
  readonly beads: RecordingBeads
  readonly logs: string[]
  readonly config: TodoRouteConfig
}

/**
 * Mount the command runtime and mint one live agent.
 * @returns the context, the agent, and the config with fresh doubles.
 */
async function mount(): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SessionId('todo-command'))
  const agent = { id: session.id, session } as Agent
  const doc = new RecordingDoc()
  const beads = new RecordingBeads()
  const logs: string[] = []
  return {
    ctx,
    agent,
    doc,
    beads,
    logs,
    config: { doc, beads, titleMaxChars: 200, logger: (message) => { logs.push(message) } },
  }
}

/**
 * Register the command under its own fiber, as the plugin does.
 * @param ctx - mounted context.
 * @param config - route configuration.
 * @returns the registering fiber.
 */
async function register(ctx: Context, config: TodoRouteConfig) {
  return await ctx.plugin({
    inject: ['commands'],
    apply: (scope: Context) => {
      scope.effect(() => scope.commands.register(todoCommand(config)), 'test: todo command')
    },
  })
}

/** The lifecycle slice of one agent's log. */
function lifecycleOf(agent: Agent): Array<{ type: string; data: unknown }> {
  return agent.session.snapshotEvents()
    .filter(event => event.type === 'command/run' || event.type === 'command/done')
    .map(event => ({ type: event.type, data: event.data }))
}

describe('/todo command', () => {
  it('registers with the plugin fiber, answers the usage error without a title, and withdraws on dispose', async () => {
    const { ctx, agent, config } = await mount()
    const fiber = await register(ctx, config)
    expect(ctx.commands.list(agent).map(descriptor => descriptor.name)).toContain('todo')

    const empty = await ctx.commands.execute(agent, '/todo', [], new AbortController().signal)
    expect(empty?.result).toEqual({ kind: 'error', text: 'Usage: /todo <title>' })

    await fiber.dispose()
    expect(ctx.commands.list(agent).map(descriptor => descriptor.name)).not.toContain('todo')
  })

  it('creates a pending list and logs the command/run + command/done pair', async () => {
    const { ctx, agent, doc, beads, config } = await mount()
    const fiber = await register(ctx, config)

    const execution = await ctx.commands.execute(agent, '/todo Покупки', [], new AbortController().signal)

    expect(execution?.result).toEqual({ kind: 'success', text: 'To-do list added to the board.' })
    expect(beads.calls).toEqual(['createEpic', 'children'])
    expect(doc.ops).toHaveLength(1)
    const create = doc.ops[0] as { op: string; kind: string; x: number; y: number; data: Record<string, unknown> }
    expect(create).toMatchObject({ op: 'create', kind: 'todo', x: 0, y: 0 })
    expect(create.data['pendingPlacement']).toBe(true)
    expect(lifecycleOf(agent)).toMatchObject([
      { type: 'command/run', data: { name: 'todo', args: ' Покупки' } },
      { type: 'command/done', data: { kind: 'success', text: 'To-do list added to the board.' } },
    ])
    await fiber.dispose()
  })

  it('answers an error result and logs the bd failure', async () => {
    const { ctx, agent, beads, logs, config } = await mount()
    const fiber = await register(ctx, config)
    beads.failure = new BeadsCommandError(1, 'stderr text', 'bd create failed')

    const execution = await ctx.commands.execute(agent, '/todo Покупки', [], new AbortController().signal)

    expect(execution?.result).toEqual({ kind: 'error', text: 'The to-do list could not be created.' })
    expect(logs).toEqual(['/todo: stderr text'])
    await fiber.dispose()
  })

  it('logs a non-bd failure by its message', async () => {
    const { ctx, agent, beads, logs, config } = await mount()
    const fiber = await register(ctx, config)
    beads.failure = new Error('boom')

    await ctx.commands.execute(agent, '/todo Покупки', [], new AbortController().signal)

    expect(logs).toEqual(['/todo: Error: boom'])
    await fiber.dispose()
  })
})
