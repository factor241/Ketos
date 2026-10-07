/**
 * The to-do route vocabulary the host and the browser share: the request
 * bodies of `/api/ketos.board.todo`, the successful answer, and the stable
 * error codes. The module is types only, so browser code imports it without
 * pulling any host module into the client bundle.
 * @module @ketos/board-todo/types
 */

import type { BeadsIssueId, BoardRevision, ElementId } from '@ketos/board-doc/types'

/** Create one list: the host creates the Beads epic and the board element. */
export interface TodoCreateRequest {
  readonly action: 'create'
  readonly title: string
  readonly x: number
  readonly y: number
}

/** Append one item to the list's epic. */
export interface TodoAddItemRequest {
  readonly action: 'addItem'
  readonly elementId: ElementId
  readonly title: string
}

/** Set one item's done state through a status update of its issue. */
export interface TodoSetDoneRequest {
  readonly action: 'setDone'
  readonly elementId: ElementId
  readonly itemId: BeadsIssueId
  readonly done: boolean
}

/** Re-read the epic and its items from Beads. */
export interface TodoRefreshRequest {
  readonly action: 'refresh'
  readonly elementId: ElementId
}

/**
 * Place a list created from chat at a world position; only a list that still
 * carries `pendingPlacement` can be placed, and the first tab wins.
 */
export interface TodoPlaceRequest {
  readonly action: 'place'
  readonly elementId: ElementId
  readonly x: number
  readonly y: number
}

/** One request body of the to-do route. */
export type TodoRequest = TodoCreateRequest | TodoAddItemRequest | TodoSetDoneRequest | TodoRefreshRequest | TodoPlaceRequest

/** Answer of a successful to-do operation. */
export interface TodoAnswer {
  readonly ok: true
  /** Element the operation acted on. */
  readonly elementId: ElementId
  /** Board revision after the snapshot write. */
  readonly revision: BoardRevision
}

/** Stable error code of the to-do route. */
export type TodoErrorCode =
  | 'ketos/invalid'
  | 'ketos/element-not-found'
  | 'ketos/not-owner'
  | 'ketos/placement-taken'
  | 'ketos/limit'
  | 'ketos/beads-failed'
  | 'ketos/beads-unavailable'

/** Refusal answer of the to-do route; never carries `bd` output. */
export interface TodoFailure {
  readonly ok: false
  readonly error: TodoErrorCode
}

/** Answer of the to-do route. */
export type TodoResponse = TodoAnswer | TodoFailure
