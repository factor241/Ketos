/**
 * Model-facing clone memory: the `clone_memory_remember` and
 * `clone_memory_search` tools, and the snapshot text the prompt context
 * renders.
 *
 * The tools are registered into one clone session's agent scope, so an
 * ordinary chat never sees them; their domain refusals are already
 * `HarnessError`s, so the tool bodies propagate them and the executor records
 * their codes on the result.
 * @module @ketos/clone-core/memory-tools
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { MEMORY_LIMITS } from './memory.ts'
import type { MemoryId, MemoryRecord } from './types.ts'

/** Placeholder text of the optional argument in both tool schemas. */
const TAGS_ARGUMENT = 'Short labels for later lookup, for example a topic or a source.'

/** Largest share of the snapshot one memory may occupy before it is shortened. */
const SNAPSHOT_ENTRY_CHARS = 400

/**
 * Cut text to `maxChars` with a trailing ellipsis, never between the halves of
 * a surrogate pair: an unpaired surrogate would reach the model request.
 * @param text - the text to cut.
 * @param maxChars - largest accepted length.
 * @returns the text, shortened with `…` when it was longer.
 */
function cutTo(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars - 1).replace(/[\uD800-\uDBFF]$/u, '')
  return `${cut}…`
}

/**
 * Status a tool reports back: a memory is only ever written `active` or
 * `candidate`, and the tool's declared output schema says the same.
 */
export type ReportedStatus = 'active' | 'candidate'

/** What one remember call reports back to the model. */
export interface RememberedMemory {
  readonly id: MemoryId
  readonly status: ReportedStatus
}

/**
 * One memory a search reports back to the model. Fields are mutable because
 * the tool's declared output schema is: a tool result crosses the lossless
 * JSON boundary, which holds no readonly arrays.
 */
export interface FoundMemory {
  id: MemoryId
  content: string
  tags: string[]
  status: ReportedStatus
}

/** The remember arguments after the tool's own decoding. */
export interface RememberArguments {
  readonly content: string
  readonly tags?: readonly string[]
  readonly methodologyCandidate: boolean
}

/** The search arguments after the tool's own decoding. */
export interface SearchArguments {
  readonly query: string
  readonly limit?: number
}

/**
 * The remember tool: saves one fact for the clone the calling session works
 * for. The repository refuses empty or over-long content, an over-long tag
 * list, and a session without a clone binding.
 * @param remember - the write, bound to the plugin's database and the calling session.
 * @param onRemembered - called with the saving agent after a write committed.
 * @returns the tool definition to register.
 */
export function cloneMemoryRememberTool(
  remember: (sessionId: SessionId, args: RememberArguments) => Promise<RememberedMemory>,
  onRemembered: (agent: Agent) => void,
): ToolDefinition {
  return defineTool({
    name: 'clone_memory_remember',
    description: [
      'Save one durable fact, insight, or preference to this clone\'s long-term memory.',
      'Use it when the person states something that must survive this session: a rule, a preference, a decision, or a lesson learned.',
      `Content is at most ${String(MEMORY_LIMITS.content)} characters.`,
      'Set methodology_candidate to true for a reusable way of working that could later join the shared methodology library.',
    ].join(' '),
    parameters: {
      content: {
        type: 'string',
        required: true,
        description: 'The fact to remember, as one self-contained sentence or short paragraph.',
      },
      tags: {
        type: 'array',
        description: TAGS_ARGUMENT,
        items: { type: 'string' },
      },
      methodology_candidate: {
        type: 'boolean',
        description: 'Mark a reusable methodology insight awaiting review.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          status: { type: 'string', required: true, enum: ['active', 'candidate'] },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Saved to the clone's memory as ${value.status}; its id is ${value.id}.`,
      }],
    },
    execute: async (args, exec) => {
      const agent = exec.agent
      if (agent === undefined) throw new Error('clone_memory_remember requires a calling agent session')
      const saved = await remember(agent.id, {
        content: args.content,
        ...(args.tags === undefined ? {} : { tags: args.tags }),
        methodologyCandidate: args.methodology_candidate === true,
      })
      onRemembered(agent)
      return saved
    },
    presentCall: args => ({ card: 'generic', title: 'Remember clone memory', kind: 'other', rawInput: args }),
  })
}

/**
 * The search tool: finds memories of the clone the calling session works for.
 * A session without a clone binding is refused.
 * @param search - the read, bound to the plugin's database and the calling session.
 * @returns the tool definition to register.
 */
export function cloneMemorySearchTool(
  search: (sessionId: SessionId, args: SearchArguments) => Promise<FoundMemory[]>,
): ToolDefinition {
  return defineTool({
    name: 'clone_memory_search',
    description: [
      'Search this clone\'s long-term memory by keywords.',
      'Every word matches as a prefix, so "навык" also finds "навыки".',
      `Returns at most ${String(MEMORY_LIMITS.searchLimit)} memories with their ids.`,
      'Archived memories are not returned.',
    ].join(' '),
    parameters: {
      query: { type: 'string', required: true, description: 'Keywords to look for in remembered facts and their tags.' },
      limit: {
        type: 'integer',
        description: `Largest number of memories to return, from 1 to ${String(MEMORY_LIMITS.searchLimit)}.`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          memories: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                content: { type: 'string', required: true },
                tags: { type: 'array', required: true, items: { type: 'string' } },
                status: { type: 'string', required: true, enum: ['active', 'candidate'] },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.memories.length === 0
          ? 'No memories matched.'
          : value.memories.map(memory => `[${memory.id}] ${memory.content}`).join('\n'),
      }],
    },
    // Reads only; two searches may run beside any other tool. The remember
    // tool stays exclusive like the other clone write tool.
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      const agent = exec.agent
      if (agent === undefined) throw new Error('clone_memory_search requires a calling agent session')
      return { memories: await search(agent.id, {
        query: args.query,
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      }) }
    },
    presentCall: args => ({ card: 'generic', title: 'Search clone memory', kind: 'other', rawInput: args }),
  })
}

/**
 * Render the memory snapshot the prompt context carries: the newest active
 * memories, each as `[id] content (tags: …)`, inside a character budget.
 * Excess entries are counted in a closing hint; a single entry longer than its
 * share is shortened, so one long memory cannot crowd out the rest. An empty
 * snapshot renders as an empty string, which contributes no context message.
 * @param memories - newest-first active memories.
 * @param maxChars - largest total length of the rendered text.
 * @returns the snapshot text, or an empty string when there is nothing to show.
 */
export function memorySnapshotText(memories: readonly MemoryRecord[], maxChars: number): string {
  if (memories.length === 0) return ''
  const header = 'Facts this clone remembers (newest first). Use clone_memory_search to look up more and clone_memory_remember to save a durable fact.'
  const lines: string[] = []
  let used = header.length
  for (const memory of memories) {
    const tags = memory.tags.length === 0 ? '' : ` (tags: ${memory.tags.join(', ')})`
    const line = cutTo(`- [${memory.id}] ${memory.content}${tags}`, SNAPSHOT_ENTRY_CHARS)
    if (used + line.length + 1 > maxChars) continue
    lines.push(line)
    used += line.length + 1
  }
  // A budget too small for even one entry renders nothing instead of a bare
  // header the model cannot use.
  if (lines.length === 0) return ''
  let omitted = memories.length - lines.length
  const hint = (count: number): string =>
    `${String(count)} more ${count === 1 ? 'memory is' : 'memories are'} not shown; use clone_memory_search.`
  const rendered = (): string => [
    header,
    ...lines,
    ...(omitted === 0 ? [] : [hint(omitted)]),
  ].join('\n')
  // The omission hint must fit as well: drop trailing entries until it does.
  while (omitted > 0 && rendered().length > maxChars && lines.length > 1) {
    lines.pop()
    omitted += 1
  }
  // With one entry left the hint still has to fit: shorten that entry rather
  // than dropping the count of what the model cannot see.
  if (omitted > 0 && rendered().length > maxChars) {
    const room = maxChars - header.length - hint(omitted).length - 2
    if (room >= 1) lines[0] = cutTo(lines[0] as string, room)
  }
  return cutTo(rendered(), maxChars)
}
