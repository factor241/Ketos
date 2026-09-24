/**
 * The clone session scope: everything clone-core composes into the agent of a
 * session bound to a clone.
 *
 * A session bound to a clone carries the clone's stable profile section, the
 * personal skills it may invoke, its memory tools, and a dynamic memory
 * snapshot; a session that is also interviewing that clone additionally carries
 * the interview instruction, the `clone_draft_save` tool, and exactly one
 * opening turn. Every contribution lives in that one agent's scope — never in
 * the global registries — so an ordinary chat sees none of it. The scope ends
 * when the agent is disposed or the binding goes; the interview part ends when
 * the profile is saved.
 *
 * @module @ketos/clone-core/session
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import type { CloneDatabase } from './db.ts'
import { MEMORY_LIMITS, MemoryRepository } from './memory.ts'
import type { FoundMemory, RememberArguments, RememberedMemory, SearchArguments } from './memory-tools.ts'
import { cloneMemoryRememberTool, cloneMemorySearchTool, memorySnapshotText } from './memory-tools.ts'
import { METHODOLOGY_SECTIONS } from './methodology.ts'
import type { CloneTaskBridge } from './task-runner.ts'
import { cloneTaskReportTool } from './task-tools.ts'
import type { CloneRecord, CloneBindingRole, CloneDraftFields, CloneId, CloneSkill, TaskId } from './types.ts'
import { CLONE_SKILL_NAME, CLONE_TEXT_LIMITS, CloneSessionNotBoundError } from './repository.ts'
import type { CloneRepository } from './repository.ts'

/**
 * Prompt-section name of the clone profile. A scoped section shadows a global
 * one of the same name, and nothing else owns this name.
 */
export const CLONE_PROFILE_SECTION = 'clone:profile'

/**
 * Placement of the clone profile. The order is package-local on purpose:
 * `getSectionOrder` owns the repository-wide slots, and the profile sorts
 * before the interview instruction it is the subject of.
 */
export const CLONE_PROFILE_ORDER = 690

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

/**
 * Context name of the dynamic memory snapshot. The snapshot rides
 * `systemPrompt.context`, not a section, so a new memory leaves the stable
 * request prefix untouched and arrives as a durable runtime-context message.
 */
export const CLONE_MEMORY_CONTEXT = 'clone:memory'

/**
 * Placement of the memory snapshot among the runtime contexts; it sorts after
 * the sandbox, approval, and delegation policies.
 */
export const CLONE_MEMORY_ORDER = 130

/**
 * Context name of the autonomy instruction a session running a task carries.
 * Like the memory snapshot it rides `systemPrompt.context`, so starting a task
 * adds no stable-prefix section.
 */
export const CLONE_TASK_CONTEXT = 'clone:task'

/**
 * Placement of the autonomy instruction among the runtime contexts; it sorts
 * after the memory snapshot it complements.
 */
export const CLONE_TASK_ORDER = 140

/** Default largest number of memories the prompt snapshot lists. */
export const DEFAULT_MEMORY_ENTRIES = 10

/** Default largest total length, in characters, of the prompt memory snapshot. */
export const DEFAULT_MEMORY_CHARS = 8000

/** Largest configurable snapshot size; beyond this the constant prefix stops paying for itself. */
export const MAX_MEMORY_ENTRIES = 50

/** Largest configurable snapshot length, in characters. */
export const MAX_MEMORY_CHARS = 32_000

/** Source kind of the kickoff turn the interview opens with. */
export const CLONE_INTERVIEW_SOURCE = 'ketos-clone-interview'

/** Projection key of the durable "this session was already opened" answer. */
export const CLONE_KICKOFF_PROJECTION = 'ketos-clone-kickoff'

/**
 * Whether one stored skill may reach the skill registry: its name matches the
 * registry's own grammar and its description is non-empty. Registration reads
 * this decision, so a skill still being drafted stays in the record alone. A
 * database written before the grammar was enforced may carry a name the
 * registry cannot address.
 * @param skill - the stored skill.
 * @returns whether the skill is addressable and registrable.
 */
function registerableSkill(skill: CloneSkill): boolean {
  return CLONE_SKILL_NAME.test(skill.name)
    && skill.name.length <= CLONE_TEXT_LIMITS.skillName
    && skill.description.trim() !== ''
}

/**
 * What the clone profile contributes to the clone's own requests: who it is,
 * how it works, and the instruction to stay in character. The text is built
 * from the stored record, so it carries no secret or PII the person did not
 * write into the profile themselves. Skills are deliberately absent: the skill
 * registry registers them into the agent's own layer, and the catalog the
 * `skill` tool publishes is the one model-facing list of what it may invoke.
 * @param clone - the stored clone record.
 * @returns the profile section text.
 */
export function profileSectionText(clone: CloneRecord): string {
  const lines = [
    `You are the digital clone of ${clone.name}, working as ${clone.role}.`,
    ...clone.description.trim() === '' ? [] : [`Summary: ${clone.description}`],
    ...clone.persona.trim() === '' ? [] : [`Character, tone, and working style: ${clone.persona}`],
    ...clone.methodology.trim() === '' ? [] : [`Working method: ${clone.methodology}`],
    'Keep this role, character, and working method in every reply.',
  ]
  return lines.join('\n')
}

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
  'After 8 to 12 exchanges, or as soon as the person asks to finish, call the clone_draft_save tool once with the complete profile you gathered: the role, a one-line description, the persona (character, tone, and working style), the methodology (how the work is actually done), and the skills the clone may use.',
  `Write the methodology as exactly these four sections, each under its own heading of two hashes and filled with the concrete content the person gave: ${METHODOLOGY_SECTIONS.map(heading => `## ${heading}`).join(', ')}.`,
  'For every skill, supply a kebab-case name (lowercase latin letters, digits, and hyphens), a short description of what the skill is for, and instructions that say how to do it.',
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

/**
 * What a session running an autonomous task must know: nobody is watching the
 * turn, so questions wait for nobody and the work ends through the report tool.
 * The objective itself reaches the model in the goal-round prompt.
 */
const TASK_INSTRUCTION = [
  'You are executing an autonomous task for this clone; no person is watching this session right now.',
  'Work autonomously: do not ask questions, do not wait for approval, and do not stop to request confirmation.',
  'Each round must make concrete progress and verify its result against the workspace and tool output.',
  'When the objective is achieved, call the clone_task_report tool once with the final result; that finishes the task.',
].join('\n')

/** How many memories the prompt snapshot lists and how long it may grow. */
export interface MemoryBudget {
  /** Largest number of active memories the snapshot lists. */
  readonly entries: number
  /** Largest total length, in characters, of the rendered snapshot. */
  readonly chars: number
}

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
      'It replaces the role, description, persona, and methodology of the clone, merges the skills into the clone\'s list by name, and marks the profile ready for the person\'s review.',
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
        description: 'The skills the clone may use; an empty array when the interview found none.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: {
              type: 'string',
              required: true,
              description: 'Kebab-case skill name: lowercase latin letters, digits, and hyphens.',
            },
            description: {
              type: 'string',
              required: true,
              description: 'One line that says what the skill is for.',
            },
            instructions: {
              type: 'string',
              required: true,
              description: 'How to do it: the instructions the clone follows when it uses this skill.',
            },
          },
        },
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

/** A clone a session is bound to, with the role the binding carries. */
interface BoundClone {
  readonly clone: CloneRecord
  readonly role: CloneBindingRole
}

/**
 * Per-agent clone session scope plus the mutable text its prompt providers
 * read. Replacing the text in place refreshes what the next assembly renders
 * without re-registering anything; reinstalling the scope is only for a
 * different clone or a different interview mode.
 */
interface CloneScope {
  /** The scope carrying the tool and prompt registrations. */
  readonly scope: ReturnType<Context['inject']>
  /**
   * The separate scope carrying the skill registry registrations. It activates
   * on its own, because a deployment without a skill registry must not
   * withhold the profile, the tools, or the interview mode.
   */
  readonly skills: ReturnType<Context['inject']>
  /** Clone the scope was installed for. */
  readonly cloneId: CloneId
  /** Whether the interview section, tool, and kickoff are part of this scope. */
  readonly interviewing: boolean
  /** Running task the report tool belongs to, or undefined for a plain session. */
  readonly taskId: TaskId | undefined
  /** Profile text the section provider renders; replaced when the clone is edited. */
  readonly profile: { text: string }
  /** Memory snapshot the context provider renders; replaced when memory changes. */
  readonly memory: { text: string }
  /**
   * Withdraw every registration this entry owns, both scopes together.
   * @returns a promise settling when neither scope holds a registration.
   */
  dispose(): Promise<void>
}

/**
 * Derives the clone session scope from stored clone data and owns the
 * per-agent scopes that carry it.
 *
 * The scope is re-derived after every lifecycle and every stored change rather
 * than cached: `agent/created`, `agent/session-start`, the routes' mutation
 * notification, and the tools' own writes all run the same reconciliation, so
 * a binding written after the agent was created still composes the scope, and
 * a status that moved away from `interviewing` withdraws the interview part.
 */
export class CloneSessionCoordinator {
  private readonly ctx: Context
  private readonly database: CloneDatabase
  private readonly budget: MemoryBudget
  private readonly tasks: CloneTaskBridge
  /** The scope each bound agent carries, keyed by that agent. */
  private readonly installed = new Map<Agent, CloneScope>()
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
   * @param budget - how many memories the prompt snapshot lists and how long it may grow.
   * @param tasks - the task side of a scope: whether the session runs a task
   * and how its report is filed.
   */
  constructor(ctx: Context, database: CloneDatabase, budget: MemoryBudget, tasks: CloneTaskBridge) {
    this.ctx = ctx
    this.database = database
    this.budget = budget
    this.tasks = tasks
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
      // A restored session may belong to a clone from an earlier process; a
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
    this.ctx.effect(() => () => { this.close() }, 'ketos-clone-core: clone session scopes')
    // An agent that already exists at mount (a configured profile agent) may
    // belong to a clone; a fresh process has none, so the database stays shut.
    if (this.ctx.agents.roots().length > 0) this.touchesClones = true
    void this.resync()
  }

  /**
   * Stored clone data changed: re-derive the scope of every live top-level
   * agent. Both routes call this after an accepted request, because a status,
   * binding, profile, or memory write is what changes the scope outside the
   * agent's lifecycle.
   * @returns a promise settling when every agent's scope is reconciled.
   */
  cloneDataChanged(): Promise<void> {
    this.touchesClones = true
    return this.resync()
  }

  /**
   * Re-derive the scope of every live top-level agent.
   * @returns a promise settling when every agent's scope is reconciled.
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
    for (const entry of this.installed.values()) void entry.dispose()
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
        this.ctx.logger.warn(`ketos-clone-core: clone session scope failed for agent "${agent.id}": ${String(error)}`)
      })
    this.chains.set(agent, next)
    return next
  }

  /**
   * Install, refresh, or withdraw one agent's clone session scope. A scope is
   * refreshed in place when its clone and interview mode are unchanged;
   * anything else disposes it and installs the correct one, because the
   * registrations themselves differ.
   */
  private async reconcile(agent: Agent): Promise<void> {
    if (this.disposed || !this.touchesClones) return
    const [repository, memories] = await Promise.all([
      this.database.repository(),
      this.database.memoryRepository(),
    ])
    const bound = this.boundClone(repository, agent.id)
    const installed = this.installed.get(agent)
    if (bound === undefined) {
      if (installed === undefined) return
      this.installed.delete(agent)
      await installed.dispose()
      return
    }
    const interviewing = bound.role === 'interview' && bound.clone.status === 'interviewing'
    const taskId = (await this.tasks.runningTaskFor(agent.id))?.id
    const changed = installed === undefined
      || installed.cloneId !== bound.clone.id
      || installed.interviewing !== interviewing
      || installed.taskId !== taskId
    if (changed) {
      if (installed !== undefined) {
        this.installed.delete(agent)
        await installed.dispose()
      }
      const fresh = await this.install(agent, repository, memories, bound.clone, interviewing, taskId)
      if (fresh === undefined) return
      this.installed.set(agent, fresh)
    } else {
      this.refresh(installed, memories, bound.clone)
    }
    if (interviewing) this.open(agent)
  }

  /**
   * Register the whole clone session scope into one agent and wait for its
   * activation. The prompt providers close over the mutable state the
   * returned entry carries, so a later refresh republishes without
   * re-registering.
   * @returns the installed entry, or undefined when disposal won the race.
   */
  private async install(
    agent: Agent,
    repository: CloneRepository,
    memories: MemoryRepository,
    clone: CloneRecord,
    interviewing: boolean,
    taskId: TaskId | undefined,
  ): Promise<CloneScope | undefined> {
    const profile = { text: profileSectionText(clone) }
    const memory = { text: this.snapshot(memories, clone.id) }
    const scope = agent.ctx.inject(['tools', 'systemPrompt'], (scoped) => {
      scoped.systemPrompt.section({
        name: CLONE_PROFILE_SECTION,
        order: CLONE_PROFILE_ORDER,
        text: () => profile.text,
      })
      scoped.systemPrompt.context({
        name: CLONE_MEMORY_CONTEXT,
        order: CLONE_MEMORY_ORDER,
        text: () => memory.text,
      })
      scoped.tools.register(cloneMemoryRememberTool(
        (sessionId, args) => this.remember(repository, memories, sessionId, args),
        (saving) => { this.request(saving) },
      ))
      scoped.tools.register(cloneMemorySearchTool(
        (sessionId, args) => this.search(repository, memories, sessionId, args),
      ))
      if (taskId !== undefined) {
        scoped.systemPrompt.context({
          name: CLONE_TASK_CONTEXT,
          order: CLONE_TASK_ORDER,
          text: () => TASK_INSTRUCTION,
        })
        scoped.tools.register(cloneTaskReportTool(
          (sessionId, summary) => this.tasks.report(sessionId, summary),
        ))
      }
      if (interviewing) {
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
      }
    })
    await scope
    // The critical scope activated; its optional skill part follows, and
    // disposal may have won the race while the scope was activating, in which
    // case the registrations belong to the disposal from here on.
    const skills = this.registerSkills(agent, clone)
    const entry: CloneScope = {
      scope,
      skills,
      cloneId: clone.id,
      interviewing,
      taskId,
      profile,
      memory,
      dispose: () => Promise.all([scope.dispose(), skills.dispose()]).then(() => undefined),
    }
    if (this.disposed) {
      await entry.dispose()
      return undefined
    }
    return entry
  }

  /**
   * Register one clone's registerable skills into the agent's own registry
   * layer, in a scope of their own that activates whenever a skill registry is
   * reachable. A deployment without one leaves the scope pending; installation
   * never waits for it, so a missing registry cannot withhold the profile, the
   * tools, or the interview mode. Editing the stored skills reaches a live
   * agent only when its scope is reinstalled or the agent is recreated: a
   * stored change refreshes the profile and memory text alone.
   * @param agent - the agent whose layer receives the skills.
   * @param clone - the stored clone the scope was installed for.
   * @returns the registration scope, which the caller owns and disposes.
   */
  private registerSkills(agent: Agent, clone: CloneRecord): ReturnType<Context['inject']> {
    const skills = agent.ctx.inject(['skills'], (scoped) => {
      for (const skill of clone.skills.filter(registerableSkill)) {
        scoped.skills.register({
          name: skill.name,
          description: skill.description,
          content: skill.instructions,
          source: 'runtime',
        })
      }
    })
    // An unhandled rejection would take the process down; the registration is
    // an optional part of the agent's composition, so its failure is a warning.
    void Promise.resolve(skills).catch((error: unknown) => {
      this.ctx.logger.warn(`ketos-clone-core: clone skill registration failed for agent "${agent.id}": ${String(error)}`)
    })
    return skills
  }

  /** Rebuild the profile text and the memory snapshot of one installed scope. */
  private refresh(entry: CloneScope, memories: MemoryRepository, clone: CloneRecord): void {
    entry.profile.text = profileSectionText(clone)
    entry.memory.text = this.snapshot(memories, clone.id)
  }

  /** The newest active memories rendered inside the configured budget. */
  private snapshot(memories: MemoryRepository, cloneId: CloneId): string {
    return memorySnapshotText(memories.recentActive(cloneId, this.budget.entries), this.budget.chars)
  }

  /**
   * The clone one session works for, or undefined when it has none. A binding
   * whose clone disappeared counts as none: nothing may inject a profile the
   * store does not hold.
   */
  private boundClone(repository: CloneRepository, sessionId: SessionId): BoundClone | undefined {
    const binding = repository.bindingFor(sessionId)
    if (binding === undefined) return undefined
    const clone = repository.getClone(binding.cloneId)
    if (clone === undefined) return undefined
    return { clone, role: binding.role }
  }

  /**
   * Save one remembered fact for the calling session's clone. The binding is
   * re-checked at execution time: a tool call may land after the binding went.
   */
  private remember(
    repository: CloneRepository,
    memories: MemoryRepository,
    sessionId: SessionId,
    args: RememberArguments,
  ): Promise<RememberedMemory> {
    const bound = this.boundClone(repository, sessionId)
    if (bound === undefined) throw new CloneSessionNotBoundError(sessionId)
    const status = args.methodologyCandidate ? 'candidate' : 'active'
    const memory = memories.remember({
      cloneId: bound.clone.id,
      content: args.content,
      ...(args.tags === undefined ? {} : { tags: args.tags }),
      sourceSessionId: sessionId,
      status,
    })
    return Promise.resolve({ id: memory.id, status })
  }

  /**
   * Search the calling session's clone memory. The binding is re-checked at
   * execution time, so a call that outlived the binding is refused instead of
   * reading another clone.
   */
  private search(
    repository: CloneRepository,
    memories: MemoryRepository,
    sessionId: SessionId,
    args: SearchArguments,
  ): Promise<FoundMemory[]> {
    const bound = this.boundClone(repository, sessionId)
    if (bound === undefined) throw new CloneSessionNotBoundError(sessionId)
    const found = memories.search(bound.clone.id, args.query, args.limit ?? MEMORY_LIMITS.searchLimit)
    return Promise.resolve(found.map(memory => ({
      id: memory.id,
      content: memory.content,
      tags: [...memory.tags],
      // Search never returns an archived memory without an explicit status
      // filter, and the tool never passes one.
      status: memory.status === 'candidate' ? 'candidate' : 'active',
    })))
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
