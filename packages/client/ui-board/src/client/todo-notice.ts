/**
 * Dictionary key of the notice a failed to-do request shows. The create flow
 * and the list body read the same host codes, but two codes depend on the
 * request: `ketos/limit` is the board refusing one more list or one list being
 * full, and `ketos/invalid` is a rejected title for a new list or item, or an
 * item the list no longer holds for a toggle or refresh.
 */
import type { BoardKey } from './locale.ts'
import type { TodoFailureCode } from './todo-api.ts'

/** Where the failed request came from. */
export type TodoNoticeScope = 'create' | 'add' | 'list'

/**
 * Notice key for one failed to-do request.
 * @param code - failure code the request ended with.
 * @param scope - `create` for a new list, `add` for a new item in a list,
 * `list` for a toggle or refresh of an existing list.
 * @returns the dictionary key of the notice.
 */
export function todoNoticeKey(code: TodoFailureCode, scope: TodoNoticeScope): BoardKey {
  switch (code) {
    case 'ketos/beads-unavailable':
      return 'element.todo.error.unavailable'
    case 'ketos/limit':
      return scope === 'create' ? 'element.todo.error.limit' : 'element.todo.full'
    case 'ketos/invalid':
      return scope === 'list' ? 'element.todo.error.stale' : 'element.todo.error.invalid'
    default:
      return 'element.todo.error.failed'
  }
}
