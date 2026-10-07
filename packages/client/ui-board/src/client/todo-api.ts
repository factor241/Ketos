/**
 * Browser client of the to-do route: one POST per operation, mounted through
 * `ketosRoute`, with decoders that keep an unknown or unreachable answer from
 * breaking the board. The host owns the list; every answer only confirms the
 * element id and the board revision, and the element itself arrives on the
 * element stream.
 */
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { BeadsIssueId, BoardRevision, ElementId } from '@ketos/board-doc/types'
import type { TodoErrorCode, TodoRequest } from '@ketos/board-todo/types'
import { ketosRoute } from './ketos-route.ts'

/** Path of the to-do route below the `/api` mount. */
export const TODO_PATH = '/api/ketos.board.todo'

/** Failure code of a to-do request, including one that never reached the host. */
export type TodoFailureCode = TodoErrorCode | 'ketos/unreachable'

/** Answer of one to-do request. */
export type TodoOutcome =
  | { readonly ok: true; readonly elementId: ElementId; readonly revision: BoardRevision }
  | { readonly ok: false; readonly code: TodoFailureCode }

/** Stable codes the host promises; anything else reads as unreachable. */
const ERROR_CODES: readonly TodoErrorCode[] = [
  'ketos/invalid',
  'ketos/element-not-found',
  'ketos/not-owner',
  'ketos/placement-taken',
  'ketos/limit',
  'ketos/beads-failed',
  'ketos/beads-unavailable',
]

/**
 * Whether a decoded value is a stable to-do error code.
 * @param value - decoded value.
 * @returns true when the value is one of the host's codes.
 */
function isErrorCode(value: unknown): value is TodoErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value)
}

/**
 * Whether a decoded value is a finite number.
 * @param value - decoded value.
 * @returns true when the value is a finite number.
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Send one operation and decode the answer.
 * @param request - the request body to post.
 * @returns the decoded outcome; an unreachable host reads as `ketos/unreachable`.
 */
async function postTodo(request: TodoRequest): Promise<TodoOutcome> {
  let response: Response
  try {
    response = await fetch(ketosRoute(TODO_PATH.slice(1)), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
  } catch {
    // The host may be down or restarting; the caller shows a generic failure.
    return { ok: false, code: 'ketos/unreachable' }
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    // A non-JSON answer can only come from outside the host's route.
    return { ok: false, code: 'ketos/unreachable' }
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, code: 'ketos/unreachable' }
  }
  const answer = body as Record<string, unknown>
  if (answer['ok'] === true
    && typeof answer['elementId'] === 'string'
    && isFiniteNumber(answer['revision'])) {
    return {
      ok: true,
      elementId: brandString<ElementId>(answer['elementId']),
      revision: brandNumber<BoardRevision>(answer['revision']),
    }
  }
  return { ok: false, code: isErrorCode(answer['error']) ? answer['error'] : 'ketos/unreachable' }
}

/**
 * Create one list at a world position.
 * @param title - list title.
 * @param x - world x of the list's top-left.
 * @param y - world y of the list's top-left.
 * @returns the decoded outcome.
 */
export function createTodoList(title: string, x: number, y: number): Promise<TodoOutcome> {
  return postTodo({ action: 'create', title, x, y })
}

/**
 * Append one item to a list.
 * @param elementId - list element id.
 * @param title - item title.
 * @returns the decoded outcome.
 */
export function addTodoItem(elementId: ElementId, title: string): Promise<TodoOutcome> {
  return postTodo({ action: 'addItem', elementId, title })
}

/**
 * Set one item's done state.
 * @param elementId - list element id.
 * @param itemId - item issue id.
 * @param done - true closes the item, false opens it.
 * @returns the decoded outcome.
 */
export function setTodoItemDone(elementId: ElementId, itemId: BeadsIssueId, done: boolean): Promise<TodoOutcome> {
  return postTodo({ action: 'setDone', elementId, itemId, done })
}

/**
 * Re-read a list's epic and items from Beads.
 * @param elementId - list element id.
 * @returns the decoded outcome.
 */
export function refreshTodoList(elementId: ElementId): Promise<TodoOutcome> {
  return postTodo({ action: 'refresh', elementId })
}

/**
 * Place a list created from chat at a world position.
 * @param elementId - list element id.
 * @param x - world x of the list's top-left.
 * @param y - world y of the list's top-left.
 * @returns the decoded outcome.
 */
export function placeTodoList(elementId: ElementId, x: number, y: number): Promise<TodoOutcome> {
  return postTodo({ action: 'place', elementId, x, y })
}
