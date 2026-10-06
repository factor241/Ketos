/**
 * The board document's cross-plane vocabulary: the branded identifiers, the
 * element envelope every kind shares, the snapshot and patch the browser reads
 * from the event stream, the operation union it writes, and the stable error
 * codes the routes answer with.
 *
 * The module is types only, so the browser imports it without pulling any host
 * module into the client bundle.
 * @module @ketos/board-doc/types
 */

import type { Branded, BrandedNumber } from '@deepseek-ai/dsh-brand'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Identity of one board element, minted by the creating client. */
export type ElementId = Branded<'ElementId'>

/** Identity of one board participant; the local Ketos owns exactly one. */
export type OwnerId = Branded<'OwnerId'>

/** Identity of the board document, stable across restarts of one Ketos. */
export type BoardDocId = Branded<'BoardDocId'>

/** Monotone revision of the document: the `seq` of its latest journal row. */
export type BoardRevision = BrandedNumber<'BoardRevision'>

/** Kind of a board element; each kind owns its body renderer and data rules. */
export type BoardElementKind = 'note' | 'stroke' | 'todo'

/** Kind-owned payload of one element, carried as plain JSON values. */
export type BoardElementData = Readonly<Record<string, JsonValue>>

/**
 * One board element as both the wire and the document expose it: the envelope
 * the host owns plus the kind-owned `data` payload.
 */
export interface BoardElement {
  readonly id: ElementId
  readonly kind: BoardElementKind
  readonly ownerId: OwnerId
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly z: number
  readonly data: BoardElementData
  /** Creation time in milliseconds since the Unix epoch; the host sets it. */
  readonly createdAt: number
  /** Last-change time in milliseconds since the Unix epoch; the host sets it. */
  readonly updatedAt: number
}

/** Limits the snapshot publishes so the browser can validate before sending. */
export interface BoardLimits {
  /** Largest serialized size, in bytes, of one stored element. */
  readonly elementBytesMax: number
}

/** Full state of the document at one revision, the first event of the stream. */
export interface BoardSnapshot {
  readonly docId: BoardDocId
  /** Identity of the local Ketos; never stored in the synchronized document. */
  readonly selfId: OwnerId
  readonly revision: BoardRevision
  readonly elements: readonly BoardElement[]
  readonly limits: BoardLimits
}

/** Incremental change of the document between two revisions. */
export interface BoardPatch {
  readonly revision: BoardRevision
  readonly upserts: readonly BoardElement[]
  readonly removes: readonly ElementId[]
}

/** One create operation; the host fills `ownerId`, `z`, and the timestamps. */
export interface BoardCreateOp {
  readonly op: 'create'
  readonly id: ElementId
  readonly kind: BoardElementKind
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly data?: BoardElementData
}

/** One patch operation; absent fields keep their stored value. */
export interface BoardPatchOp {
  readonly op: 'patch'
  readonly id: ElementId
  readonly x?: number
  readonly y?: number
  readonly w?: number
  readonly h?: number
  readonly z?: number
  readonly data?: BoardElementData
}

/** One remove operation. */
export interface BoardRemoveOp {
  readonly op: 'remove'
  readonly id: ElementId
}

/** An operation of one atomic batch the browser sends. */
export type BoardOp = BoardCreateOp | BoardPatchOp | BoardRemoveOp

/**
 * Who sent an operation batch: a `browser` batch may only touch the elements
 * `selfId` owns, a `host` batch is a trusted in-process caller and bypasses
 * that check.
 */
export type BoardOrigin = 'browser' | 'host'

/** Answer of a successful operation batch. */
export interface BoardOpsResponse {
  readonly revision: BoardRevision
}

/** Stable error code of the board routes. */
export type BoardErrorCode =
  | 'ketos/invalid'
  | 'ketos/element-not-found'
  | 'ketos/element-foreign'
  | 'ketos/element-exists'
  | 'ketos/limit'
