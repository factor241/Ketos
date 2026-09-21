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
  /** Skill names the clone may use; empty until stage 18 authors them. */
  skills: string[]
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
  readonly skills: readonly string[]
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
  readonly skills?: readonly string[]
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
  readonly skills?: readonly string[]
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
  readonly skills: readonly string[]
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

/** Failure codes the route reports in the JSON body. */
export type CloneErrorCode = 'ketos/invalid' | 'ketos/clone-not-found' | 'ketos/clone-conflict'

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
