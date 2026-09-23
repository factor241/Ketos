/**
 * Clone domain types shared by the host package and its browser consumers: the
 * stored record, the wire DTO, the request inputs, and the route error codes.
 * Browser code imports this module type-only, so it may contain no runtime code.
 * @module @ketos/clone-core/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Opaque identity of one clone record. */
export type CloneId = Branded<'CloneId'>

/**
 * Lifecycle status of a clone. A clone is `draft` when it is created by hand,
 * `interviewing` while an interview session is filling its profile, and `ready`
 * once a profile has been saved; only `interviewing` composes the interview
 * prompt section and tool into a clone session.
 */
export type CloneStatus = 'draft' | 'interviewing' | 'ready'

/**
 * One personal skill of a clone: the registry identity the model invokes, the
 * one-line routing description its catalog shows, and the instructions loaded
 * when it is invoked. A skill whose description is empty stays in the record
 * as a draft and never reaches the skill registry or the model catalog.
 */
export interface CloneSkill {
  /** Kebab-case identifier accepted by the skill registry. */
  readonly name: string
  /** Short routing description; empty keeps the skill out of the model catalog. */
  readonly description: string
  /** Instructions the model receives when it invokes the skill. */
  readonly instructions: string
}

/** Fields the model-facing methodologist and persona of a clone carry today. */
export interface CloneRecord {
  /** Stable identity minted at creation. */
  id: CloneId
  /** Display name; unique is not required. */
  name: string
  /** Business role of the person the clone doubles, for example "Аналитик". */
  role: string
  /** One-line summary shown in lists. */
  description: string
  /** Character and tone instructions; empty until authored. */
  persona: string
  /** Working method the clone follows; empty until authored. */
  methodology: string
  /** Preferred model route for the clone's sessions, or null to use the deployment default. */
  preferredModel: string | null
  /** Personal skills the clone may invoke; empty until authored. */
  skills: CloneSkill[]
  /** Lifecycle status shown in the editor. */
  status: CloneStatus
  /** Optimistic-concurrency revision; every accepted update increments it by one. */
  revision: number
  /** ISO-8601 UTC creation time. */
  createdAt: string
  /** ISO-8601 UTC time of the last accepted update. */
  updatedAt: string
}

/**
 * One clone as it crosses the `/api/ketos.clones` wire. Field names and JSON
 * types are part of the browser contract, so they never carry `undefined`:
 * an absent optional value is `null` or an empty string.
 */
export interface CloneDto {
  readonly id: CloneId
  readonly name: string
  readonly role: string
  readonly description: string
  readonly persona: string
  readonly methodology: string
  readonly preferredModel: string | null
  readonly skills: readonly CloneSkill[]
  readonly status: CloneStatus
  readonly revision: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** Fields a create request supplies; every other field takes its stored default. */
export interface CloneCreateInput {
  readonly name: string
  readonly role: string
  readonly description?: string
  readonly persona?: string
  readonly methodology?: string
  readonly preferredModel?: string | null
  readonly skills?: readonly CloneSkill[]
  readonly status?: CloneStatus
}

/** Fields an update request may replace; at least one is required. */
export interface CloneUpdatePatch {
  readonly name?: string
  readonly role?: string
  readonly description?: string
  readonly persona?: string
  readonly methodology?: string
  readonly preferredModel?: string | null
  readonly skills?: readonly CloneSkill[]
  readonly status?: CloneStatus
}

/**
 * The authored profile the interview tool writes: the personas and working
 * fields the interviewer collected, kept separate from transport-level patches
 * because the tool always replaces all of them and marks the clone `ready`.
 */
export interface CloneDraftFields {
  readonly role: string
  readonly description: string
  readonly persona: string
  readonly methodology: string
  /** Skills the interviewer proposed; the save merges them over the stored list by name. */
  readonly skills: readonly CloneSkill[]
}

/**
 * Why a session is bound to a clone: `main` for a working session, `interview`
 * for the bootstrap interview the interview mode is derived from.
 */
export type CloneBindingRole = 'main' | 'interview'

/** One session bound to a clone. */
export interface CloneSessionBinding {
  /** Harness session the clone owns. */
  readonly sessionId: SessionId
  readonly cloneId: CloneId
  /** Why the session exists; a missing role means `main`. */
  readonly role: CloneBindingRole
  /** ISO-8601 UTC creation time of the binding. */
  readonly createdAt: string
}

/** Opaque identity of one autonomous task. */
export type TaskId = Branded<'TaskId'>

/**
 * Lifecycle status of one autonomous task of a clone. `pending` until the
 * person starts it, `running` while the clone's goal drives rounds, and one of
 * the terminal `done | failed | cancelled` afterwards; a terminal status is
 * never rewritten.
 */
export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'

/**
 * One stored autonomous task: the objective handed to the clone's goal, the
 * session that runs it once started, the status the window shows, and the
 * report or failure reason left behind.
 */
export interface CloneTaskRecord {
  /** Stable identity minted at creation. */
  readonly id: TaskId
  /** Clone the task belongs to; tasks never cross clones. */
  readonly cloneId: CloneId
  /** Session running the task, or null while the task is pending. */
  readonly sessionId: SessionId | null
  /** What the clone must achieve; the goal's objective. */
  readonly objective: string
  /** Lifecycle status shown in the tasks window. */
  readonly status: TaskStatus
  /** Report the clone filed, or the reason the task failed. */
  readonly resultSummary: string | null
  /** Round budget handed to the goal when the task starts. */
  readonly maxRounds: number
  /** ISO-8601 UTC creation time. */
  readonly createdAt: string
  /** ISO-8601 UTC time of the last accepted update. */
  readonly updatedAt: string
}

/**
 * One task as it crosses the `/api/ketos.tasks` wire. Field names and JSON
 * types are part of the browser contract, so they never carry `undefined`:
 * an absent optional value is `null`.
 */
export interface CloneTaskDto {
  readonly id: TaskId
  readonly cloneId: CloneId
  readonly sessionId: string | null
  readonly objective: string
  readonly status: TaskStatus
  readonly resultSummary: string | null
  readonly maxRounds: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** Fields a task create request supplies; every other field takes its stored default. */
export interface TaskCreateInput {
  readonly cloneId: CloneId
  readonly objective: string
  /** Round budget resolved by the host from its configured default. */
  readonly maxRounds: number
}

/** Opaque identity of one memory record. */
export type MemoryId = Branded<'MemoryId'>

/**
 * Lifecycle status of one memory. `active` memories are the clone's working
 * knowledge and reach both search and the prompt snapshot; `candidate` marks a
 * methodology insight awaiting the post-MVP quarantine pipeline and behaves
 * like an active memory; `archived` leaves search and the snapshot until the
 * person restores it.
 */
export type MemoryStatus = 'active' | 'candidate' | 'archived'

/** One stored memory of a clone. */
export interface MemoryRecord {
  /** Stable identity minted at creation. */
  readonly id: MemoryId
  /** Clone the memory belongs to; memories never cross clones. */
  readonly cloneId: CloneId
  /** The remembered fact, insight, or preference. */
  readonly content: string
  /** Short labels the agent attached; empty until one is supplied. */
  readonly tags: readonly string[]
  /** Session the memory was learned in, or null when the person authored it. */
  readonly sourceSessionId: SessionId | null
  /** Lifecycle status shown in the memory window. */
  readonly status: MemoryStatus
  /** ISO-8601 UTC creation time. */
  readonly createdAt: string
  /** ISO-8601 UTC time of the last accepted update. */
  readonly updatedAt: string
}

/** Fields a remember request supplies; every other field takes its stored default. */
export interface MemoryCreateInput {
  readonly cloneId: CloneId
  readonly content: string
  readonly tags?: readonly string[]
  readonly sourceSessionId?: SessionId | null
  readonly status?: MemoryStatus
}

/** Fields an update request may replace; at least one is required. */
export interface MemoryUpdatePatch {
  readonly content?: string
  readonly tags?: readonly string[]
  readonly status?: MemoryStatus
}

/** One memory as it crosses the `/api/ketos.memory` wire. */
export interface MemoryDto {
  readonly id: MemoryId
  readonly cloneId: CloneId
  readonly content: string
  readonly tags: readonly string[]
  readonly sourceSessionId: string | null
  readonly status: MemoryStatus
  readonly createdAt: string
  readonly updatedAt: string
}

/** Failure codes the route reports in the JSON body. */
export type CloneErrorCode = 'ketos/invalid' | 'ketos/clone-not-found' | 'ketos/clone-conflict'

/** Failure codes the memory route reports in the JSON body. */
export type MemoryErrorCode = 'ketos/invalid' | 'ketos/memory-not-found'

/**
 * Failure codes the tasks route reports in the JSON body. `ketos/invalid-state`
 * covers a refused status transition, an unprofiled clone, and a session that
 * already carries an active goal; `ketos/agent-not-live` reports a session
 * whose agent is not up, so the task cannot run.
 */
export type TaskErrorCode =
  | 'ketos/invalid'
  | 'ketos/task-not-found'
  | 'ketos/clone-not-found'
  | 'ketos/invalid-state'
  | 'ketos/agent-not-live'

/** Successful list answer to `list` (and to `GET`). */
export interface CloneListResponse {
  readonly ok: true
  readonly clones: readonly CloneDto[]
}

/** Successful single-clone answer to `get`, `create`, and `update`. */
export interface CloneAnswerResponse {
  readonly ok: true
  readonly clone: CloneDto
}

/** Successful answer to `delete`: the removed identity. */
export interface CloneDeletedResponse {
  readonly ok: true
  readonly id: CloneId
}

/** Successful answer to `bindSession`. */
export interface CloneBindingResponse {
  readonly ok: true
  readonly binding: CloneSessionBinding
}

/** Successful answer to `listSessions`. */
export interface CloneSessionsResponse {
  readonly ok: true
  readonly sessions: readonly CloneSessionBinding[]
}

/** Failure answer; `error` is the stable code, never a message to render. */
export interface CloneFailureResponse {
  readonly ok: false
  readonly error: CloneErrorCode
}

/** Every successful answer the clone route sends. */
export type CloneSuccessResponse =
  | CloneListResponse
  | CloneAnswerResponse
  | CloneDeletedResponse
  | CloneBindingResponse
  | CloneSessionsResponse

/** Every answer the clone route sends. */
export type CloneResponse = CloneSuccessResponse | CloneFailureResponse

/** Successful answer to `list` and `search`: the matching memories. */
export interface MemoryListResponse {
  readonly ok: true
  readonly memories: readonly MemoryDto[]
}

/** Successful answer to `update`: the updated memory. */
export interface MemoryAnswerResponse {
  readonly ok: true
  readonly memory: MemoryDto
}

/** Successful answer to `delete`: the removed identity. */
export interface MemoryDeletedResponse {
  readonly ok: true
  readonly id: MemoryId
}

/** Failure answer; `error` is the stable code, never a message to render. */
export interface MemoryFailureResponse {
  readonly ok: false
  readonly error: MemoryErrorCode
}

/** Every answer the memory route sends. */
export type MemoryResponse = MemoryListResponse | MemoryAnswerResponse | MemoryDeletedResponse | MemoryFailureResponse

/** Successful answer to `list`: every task the filter selected, newest first. */
export interface TaskListResponse {
  readonly ok: true
  readonly tasks: readonly CloneTaskDto[]
}

/** Successful answer to `get`, `create`, `start`, and `cancel`: the task. */
export interface TaskAnswerResponse {
  readonly ok: true
  readonly task: CloneTaskDto
}

/** Failure answer; `error` is the stable code, never a message to render. */
export interface TaskFailureResponse {
  readonly ok: false
  readonly error: TaskErrorCode
}

/** Every answer the tasks route sends. */
export type TaskResponse = TaskListResponse | TaskAnswerResponse | TaskFailureResponse
