/** The clone profile tool: its schema, and the domain refusals it propagates. */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { cloneDraftSaveTool } from '../src/session.ts'
import { CloneConflictError, CloneSessionNotBoundError } from '../src/repository.ts'
import type { CloneDraftFields } from '../src/types.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
  contexts.length = 0
})

/** Tool runtime over a fresh context with the calling agent's identity. */
async function fixture(
  save: (sessionId: SessionId, fields: CloneDraftFields) => Promise<never> | Promise<{ name: string; revision: number }>,
) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const saved: SessionId[] = []
  ctx.tools.register(cloneDraftSaveTool(save, (agent) => { saved.push(agent.id) }))
  const agent = { id: SessionId('interview-1') } as unknown as Agent
  return { ctx, agent, saved }
}

/** The five profile fields every call carries. */
const DRAFT = {
  role: 'Старший аналитик',
  description: 'Разбирает требования',
  persona: 'Спокойная',
  methodology: 'Сначала факты',
  skills: ['анализ'],
} as const

describe('clone_draft_save', () => {
  it('reports the saved record and notifies with the calling agent', async () => {
    const { ctx, agent, saved } = await fixture(() => Promise.resolve({ name: 'Анна', revision: 2 }))
    const result = await ctx.tools.execute({
      callId: ToolCallId('call-1'),
      name: 'clone_draft_save',
      arguments: DRAFT,
      agent,
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    expect(result.value).toEqual({ name: 'Анна', revision: 2 })
    expect(result.content).toEqual([{ type: 'text', text: 'Saved the profile draft of "Анна" at revision 2; it is ready for review.' }])
    expect(saved).toEqual([SessionId('interview-1')])
  })

  it('records the not-a-clone-session code when the session has no binding', async () => {
    const { ctx, agent } = await fixture(sessionId => Promise.reject(new CloneSessionNotBoundError(sessionId)))
    const result = await ctx.tools.execute({
      callId: ToolCallId('call-2'),
      name: 'clone_draft_save',
      arguments: DRAFT,
      agent,
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('ketos/not-a-clone-session')
    expect(result.content).toEqual([{ type: 'text', text: 'Error: session interview-1 is not bound to a clone' }])
  })

  it('records the conflict code when the stored revision moved', async () => {
    const { ctx, agent } = await fixture(() => Promise.reject(new CloneConflictError('clone-1', 3, 4)))
    const result = await ctx.tools.execute({
      callId: ToolCallId('call-3'),
      name: 'clone_draft_save',
      arguments: DRAFT,
      agent,
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
    expect(result.error?.info).toMatchObject({ name: 'CloneConflictError', code: 'ketos/clone-conflict' })
  })
})
