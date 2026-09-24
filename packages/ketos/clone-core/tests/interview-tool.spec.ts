/** The clone profile tool: its schema, the domain refusals, and its merge over the store. */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/db.ts'
import { cloneDraftSaveTool } from '../src/session.ts'
import { CloneConflictError, CloneRepository, CloneSessionNotBoundError } from '../src/repository.ts'
import type { CloneDraftFields, CloneSkill } from '../src/types.ts'

const contexts: Context[] = []
const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
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

/** One stored skill with a description unless the test says otherwise. */
const skill = (name: string, description = 'Что делает навык', instructions = ''): CloneSkill =>
  ({ name, description, instructions })

/**
 * An interviewing clone whose profile the repository owns, plus the tool
 * runtime that saves into it.
 * @param skills - the skills the clone already carries.
 * @returns the repository, the clone, the tool context, and the calling agent.
 */
async function interviewFixture(skills: readonly CloneSkill[]) {
  const db = await openDatabase(':memory:')
  cleanups.push(() => { db.close() })
  const repository = new CloneRepository(db)
  const clone = repository.createClone({ name: 'Анна', role: 'Аналитик', skills: [...skills] })
  repository.updateClone(clone.id, { status: 'interviewing' }, 1)
  repository.bindSession({ cloneId: clone.id, sessionId: SessionId('interview-1'), role: 'interview' })
  const forwarded: CloneDraftFields[] = []
  const { ctx, agent } = await fixture((sessionId, fields) => {
    forwarded.push(fields)
    const saved = repository.saveDraft(sessionId, fields)
    return Promise.resolve({ name: saved.name, revision: saved.revision })
  })
  return { repository, clone, forwarded, ctx, agent }
}

/** The five profile fields every call carries. */
const DRAFT = {
  role: 'Старший аналитик',
  description: 'Разбирает требования',
  persona: 'Спокойная',
  methodology: 'Сначала факты',
  skills: [skill('analiz', 'Разбор требований')],
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

  it('accepts skill objects and merges them over the stored list by name', async () => {
    const { repository, clone, forwarded, ctx, agent } = await interviewFixture([
      skill('sql', 'Старое описание'),
      skill('otchety', 'Отчёты'),
    ])
    const result = await ctx.tools.execute({
      callId: ToolCallId('call-merge'),
      name: 'clone_draft_save',
      arguments: {
        ...DRAFT,
        // `sql` is edited in place, `otchety` is not mentioned, `analiz` is new.
        skills: [skill('sql', 'Новое описание', 'Пиши SELECT'), skill('analiz', 'Разбор требований')],
      },
      agent,
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    expect(forwarded).toEqual([{
      ...DRAFT,
      skills: [skill('sql', 'Новое описание', 'Пиши SELECT'), skill('analiz', 'Разбор требований')],
    }])
    expect(repository.getClone(clone.id)?.skills).toEqual([
      skill('sql', 'Новое описание', 'Пиши SELECT'),
      skill('otchety', 'Отчёты'),
      skill('analiz', 'Разбор требований'),
    ])
  })

  it('refuses a draft whose skill name repeats or leaves the name grammar', async () => {
    const { repository, clone, ctx, agent } = await interviewFixture([])
    const refusals: ReadonlyArray<readonly [string, readonly CloneSkill[]]> = [
      ['a duplicate name', [skill('analiz', 'первый'), skill('analiz', 'второй')]],
      ['a non-kebab name', [skill('Анализ', 'Разбор')]],
    ]
    for (const [reason, skills] of refusals) {
      const result = await ctx.tools.execute({
        callId: ToolCallId(`call-${skills[0]?.name ?? 'skill'}`),
        name: 'clone_draft_save',
        arguments: { ...DRAFT, skills: [...skills] },
        agent,
        signal: new AbortController().signal,
      })
      expect(result.isError, reason).toBe(true)
      expect(result.error?.info?.code, reason).toBe('ketos/invalid-draft')
    }
    // The refusals wrote nothing: the clone is still interviewing.
    expect(repository.getClone(clone.id)?.status).toBe('interviewing')
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
