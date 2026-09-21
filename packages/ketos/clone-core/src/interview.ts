/**
 * The clone interview: the mode a session enters while it bootstraps a clone.
 *
 * A session is in interview mode while `clone_sessions` binds it to a clone
 * with role `interview` and that clone's status is `interviewing`. The mode is
 * composed into that one agent's scope — the `clone:interview` prompt section
 * and the `clone_draft_save` tool — never into the global registries, so an
 * ordinary chat sees none of it. The mode ends when the tool saves the profile
 * (the clone becomes `ready`), when the shipped route changes the clone or its
 * bindings, or when the agent is disposed.
 *
 * @module @ketos/clone-core/interview
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import type { CloneDatabase } from './db.ts'
import type { CloneDraftFields } from './types.ts'
import type { CloneRepository } from './repository.ts'

/**
 * Prompt-section name of the interview instruction. A scoped section shadows
 * a global one of the same name, and nothing else owns this name.
 */
export const CLONE_INTERVIEW_SECTION = 'clone:interview'

/**
 * Placement of the interview instruction. The order is package-local on
 * purpose: `getSectionOrder` owns the repository-wide slots, and this fork's
 * section sorts after the plan and Team policies and before the tool notes.
 */
export const CLONE_INTERVIEW_ORDER = 700

/** Source kind of the kickoff turn the interview opens with. */
export const CLONE_INTERVIEW_SOURCE = 'ketos-clone-interview'

/** Projection key of the durable "this session was already opened" answer. */
export const CLONE_KICKOFF_PROJECTION = 'ketos-clone-kickoff'

/**
 * What the interviewer must cover, in the product's terms. The checklist is
 * static so the request prefix a session assembles stays identical between
 * turns; per-turn state reaches the model through the tool result instead.
 */
const INTERVIEW_INSTRUCTION = [
  'You are interviewing a person to draft the profile of their digital clone.',
  'The clone will later work as this person\'s expert double, so the profile must let another agent reproduce how they work.',
  '',
  'Conduct the interview in the language the person writes in.',
  'Ask exactly one question per turn, and wait for the answer before the next one.',
  'Keep each question short and concrete; follow up when an answer is vague, incomplete, or contradicts an earlier one.',
  'Cover these topics before finishing:',
  '- the role and the areas this person is responsible for;',
  '- the regulations and rules that govern the work;',
  '- the data sources and systems the work relies on;',
  '- the communication style the person expects from a double;',
  '- the quality criteria that make a result acceptable;',
  '- reference cases that show the person\'s best work;',
  '- what the double must never do.',
  '',
  'After 8 to 12 exchanges, or as soon as the person asks to finish, call the clone_draft_save tool once with the complete profile you gathered: the role, a one-line description, the persona (character, tone, and working style), the methodology (how the work is actually done), and a short list of skill names.',
  'Do not write the profile as JSON in your messages; the tool arguments carry it.',
  'If the person answers only part of the checklist, save what you have — a missing detail can be added later.',
].join('\n')

/** The opening stimulus: what the interviewer does before the first answer. */
const KICKOFF_TEXT = [
  'The interview that drafts this clone\'s profile starts now.',
  'Ask your first question about the person\'s role and responsibilities, then continue one question at a time.',
].join('\n')

/** The opening stimulus bound for the transcript's collapsed notice row. */
const KICKOFF_SUMMARY = 'Clone interview started'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** The interview kickoff this package queues; never a human message. */
    'ketos-clone-interview': {
      readonly kind: 'ketos-clone-interview'
      readonly form: 'notice'
      readonly summary: string
    }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Whether the session ever logged the interview kickoff. Host-only. */
    'ketos-clone-kickoff': { kickoff: boolean }
  }
}

/** Fold state of the kickoff projection. */
type KickoffState = { kickoff: boolean }

/** Kickoff projection: the durable "this session was already opened" answer. */
const kickoffProjection = {
  key: CLONE_KICKOFF_PROJECTION,
  stateSchema: z.object({ kickoff: z.boolean() }),
  init: (): KickoffState => ({ kickoff: false }),
  apply: (state, event) => event.type === 'user/message'
    && event.data.source.kind === CLONE_INTERVIEW_SOURCE
    ? { kickoff: true }
    : state,
  stateVersion: 0,
} satisfies ProjectionDefinition<'ketos-clone-kickoff', KickoffState>

/** What one profile the tool saves reports back to the model. */
interface SavedDraft {
  readonly name: string
  readonly revision: number
}

/**
 * The clone profile tool. It is registered into one interviewing agent's
 * scope, so its presence is the mode and its absence is an ordinary session.
 * The save's domain refusals are already `HarnessError`s, so the tool body
 * propagates them and the executor records their codes on the result.
 * @param save - the repository write, bound to the plugin's database.
 * @param onSaved - called with the saving agent after a write committed.
 * @returns the tool definition to register.
 */
export function cloneDraftSaveTool(
  save: (sessionId: SessionId, fields: CloneDraftFields) => Promise<SavedDraft>,
  onSaved: (agent: Agent) => void,
): ToolDefinition {
  return defineTool({
    name: 'clone_draft_save',
    description: [
      'Save the completed profile draft of the clone this session is interviewing for.',
      'Call it once, when the checklist is covered or the person asks to finish.',
      'It replaces the role, description, persona, methodology, and skills of the clone and marks the profile ready for the person\'s review.',
    ].join(' '),
    parameters: {
      role: {
        type: 'string',
        required: true,
        description: 'The business role of the person, for example "Financial analyst".',
      },
      description: {
        type: 'string',
        required: true,
        description: 'One line that summarizes what this clone does.',
      },
      persona: {
        type: 'string',
        required: true,
        description: 'Character, tone, and working style the clone must keep in every reply.',
      },
      methodology: {
        type: 'string',
        required: true,
        description: 'How this person does the work: steps, sources, and decision rules.',
      },
      skills: {
        type: 'array',
        required: true,
        description: 'Short names of the skills the clone may use.',
        items: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          revision: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Saved the profile draft of "${value.name}" at revision ${String(value.revision)}; it is ready for review.`,
      }],
    },
    execute: async (args, exec) => {
      const agent = exec.agent
      if (agent === undefined) throw new Error('clone_draft_save requires a calling agent session')
      const saved = await save(agent.id, args)
      onSaved(agent)
      return saved
    },
    presentCall: args => ({ card: 'generic', title: 'Save clone profile draft', kind: 'other', rawInput: args }),
  })
}

/**
 * Derives interview mode from stored clone data and owns the per-agent scope
 * that carries it.
 *
 * The mode is re-derived after every lifecycle and every stored change rather
 * than cached: `agent/created`, `agent/session-start`, the route's mutation
 * notification, and the tool's own save all run the same reconciliation, so a
 * binding written after the agent was created still turns the mode on, and a
 * status that moved to `ready` turns it off.
 */
export class CloneInterviewCoordinator {
  private readonly ctx: Context
  private readonly database: CloneDatabase
  /** The scope each interviewing agent carries, keyed by that agent. */
  private readonly installed = new Map<Agent, ReturnType<Context['inject']>>()
  /**
   * Agents whose triggers were collected in this tick. The lifecycle pair
   * (`agent/created` then `agent/session-start`) fires in one synchronous
   * publication, and reconciling twice would derive the same answer twice —
   * the second pass can then queue a second opening turn because neither the
   * inbox nor the projection has caught up with the first yet.
   */
  private readonly batch = new Set<Agent>()
  /** Whether a batch flush is already scheduled. */
  private flushed = false
  /** Per-agent reconciliation chain, so two passes never install at once. */
  private readonly chains = new Map<Agent, Promise<void>>()
  /**
   * Sessions whose kickoff was observed in the log. The durable projection
   * supplies the same answer after a restart, but a live fold can lag the
   * commit by a tick; the live listener closes that window.
   */
  private readonly opened = new Set<SessionId>()
  /**
   * Sessions whose kickoff this coordinator queued and has not yet seen
   * logged. Between the driver claiming the message and appending it to the
   * log no durable or pending record carries the kickoff, and a stored change
   * landing in that window would otherwise queue a second one.
   */
  private readonly queued = new Set<SessionId>()
  /**
   * Whether clone data is relevant to this process at all. Nothing reads the
   * database until a clone request or a restored session makes it relevant, so
   * a deployment whose chats never touch a clone never opens `clones.db`.
   */
  private touchesClones = false
  private disposed = false

  /**
   * @param ctx - host context carrying `agents` and `sessionProjections`.
   * @param database - the plugin's clone database.
   */
  constructor(ctx: Context, database: CloneDatabase) {
    this.ctx = ctx
    this.database = database
  }

  /** Follow agent lifecycles and register the durable kickoff projection. */
  start(): void {
    this.ctx.sessionProjections.register(kickoffProjection)
    this.ctx.on('session/event', (session, event) => {
      if (event.type === 'user/message' && event.data.source.kind === CLONE_INTERVIEW_SOURCE) {
        this.opened.add(session.id)
        this.queued.delete(session.id)
      }
    })
    this.ctx.on('agent/created', ({ agent }) => { this.request(agent) })
    this.ctx.on('agent/session-start', ({ agent, source }) => {
      // A restored session may be an interview from an earlier process; a
      // fresh one cannot be bound yet, so it is not worth opening the database.
      if (source === 'resume') this.touchesClones = true
      this.request(agent)
    })
    this.ctx.on('agent/disposed', ({ agent }) => {
      this.installed.delete(agent)
      // A later resume materializes the projection from the full log, so the
      // live sets may drop the id with the agent that carried it.
      this.opened.delete(agent.id)
      this.queued.delete(agent.id)
      const chain = this.chains.get(agent)
      if (chain === undefined) return
      // The chain settles on its own; dropping the entry here is what keeps a
      // long-lived process from retaining every agent it ever reconciled.
      void chain.finally(() => {
        if (this.chains.get(agent) === chain) this.chains.delete(agent)
      })
    })
    this.ctx.effect(() => () => { this.close() }, 'ketos-clone-core: interview scopes')
    // An agent that already exists at mount (a configured profile agent) may
    // belong to a clone; a fresh process has none, so the database stays shut.
    if (this.ctx.agents.roots().length > 0) this.touchesClones = true
    void this.resync()
  }

  /**
   * Stored clones changed: re-derive the mode of every live top-level agent.
   * The clone route calls this after an accepted request, because a status or
   * binding write is what turns the mode on outside the agent's lifecycle.
   * @returns a promise settling when every agent's mode is reconciled.
   */
  clonesChanged(): Promise<void> {
    this.touchesClones = true
    return this.resync()
  }

  /**
   * Re-derive the mode of every live top-level agent.
   * @returns a promise settling when every agent's mode is reconciled.
   */
  resync(): Promise<void> {
    if (!this.touchesClones) return Promise.resolve()
    return Promise.all(this.ctx.agents.roots().map(agent => this.run(agent))).then(() => undefined)
  }

  /**
   * Stop reacting to triggers and drop every installed scope. Idempotent: the
   * plugin fiber's disposer runs it once, and an in-flight reconcile consults
   * {@link disposed} after its await so no scope outlives the plugin.
   */
  private close(): void {
    this.disposed = true
    for (const scope of this.installed.values()) void scope.dispose()
    this.installed.clear()
    this.chains.clear()
    this.opened.clear()
  }

  /** Collect one agent's trigger and flush the batch on the next microtask. */
  private request(agent: Agent): void {
    this.batch.add(agent)
    if (this.flushed) return
    this.flushed = true
    queueMicrotask(() => {
      this.flushed = false
      const agents = [...this.batch]
      this.batch.clear()
      for (const pending of agents) void this.run(pending)
    })
  }

  /** Serialize reconciliation passes per agent so overlapping triggers cannot race. */
  private run(agent: Agent): Promise<void> {
    const previous = this.chains.get(agent) ?? Promise.resolve()
    const next = previous
      .then(() => this.reconcile(agent))
      .catch((error: unknown) => {
        this.ctx.logger.warn(`ketos-clone-core: interview mode failed for agent "${agent.id}": ${String(error)}`)
      })
    this.chains.set(agent, next)
    return next
  }

  /** Install, refresh, or withdraw one agent's interview scope. */
  private async reconcile(agent: Agent): Promise<void> {
    if (this.disposed || !this.touchesClones) return
    const repository = await this.database.repository()
    const mode = this.interviewing(repository, agent.id)
    const installed = this.installed.get(agent)
    if (!mode) {
      if (installed === undefined) return
      this.installed.delete(agent)
      await installed.dispose()
      return
    }
    if (installed === undefined) {
      const scope = agent.ctx.inject(['tools', 'systemPrompt'], (scoped) => {
        scoped.systemPrompt.section({
          name: CLONE_INTERVIEW_SECTION,
          order: CLONE_INTERVIEW_ORDER,
          text: INTERVIEW_INSTRUCTION,
        })
        scoped.tools.register(cloneDraftSaveTool(
          (sessionId, fields) => {
            const saved = repository.saveDraft(sessionId, fields)
            return Promise.resolve({ name: saved.name, revision: saved.revision })
          },
          (saving) => { this.request(saving) },
        ))
      })
      await scope
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- close() (a closure) sets it.
      if (this.disposed) {
        await scope.dispose()
        return
      }
      this.installed.set(agent, scope)
    }
    this.open(agent)
  }

  /**
   * Whether stored state puts one session in interview mode.
   * @param repository - the open clone repository.
   * @param sessionId - the session to classify.
   * @returns whether the session interviews a clone whose profile is pending.
   */
  private interviewing(repository: CloneRepository, sessionId: SessionId): boolean {
    const binding = repository.bindingFor(sessionId)
    if (binding === undefined || binding.role !== 'interview') return false
    return repository.getClone(binding.cloneId)?.status === 'interviewing'
  }

  /** Queue the opening turn unless this session already had one. */
  private open(agent: Agent): void {
    if (this.opened.has(agent.id)) return
    const pending = agent.inbox.nextTurn.find(message => message.source.kind === CLONE_INTERVIEW_SOURCE)
    if (pending !== undefined) {
      // The message survived a restart, but a turn never claimed it: queuing it
      // again is what wakes the driver, and reusing the same message cannot
      // duplicate the kickoff.
      if (agent.status === 'idle') {
        agent.inbox.remove(pending.id)
        agent.followup(pending)
      }
      return
    }
    if (this.queued.has(agent.id)) {
      // Neither pending nor logged: either the driver claimed it and is opening
      // the turn, or a cancelled turn dropped it. A running agent means the
      // claim already happened.
      if (agent.status === 'running') return
      this.queued.delete(agent.id)
    }
    const state = this.ctx.sessionProjections.stateOf(agent.session, CLONE_KICKOFF_PROJECTION)
    /* v8 ignore next -- start() registers the projection before any agent exists. */
    if (state === undefined) return
    if (state.kickoff) {
      this.opened.add(agent.id)
      return
    }
    this.queued.add(agent.id)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: KICKOFF_TEXT }],
      source: {
        kind: CLONE_INTERVIEW_SOURCE,
        form: 'notice',
        summary: boundContextSummary(KICKOFF_SUMMARY),
      },
    }))
  }
}
