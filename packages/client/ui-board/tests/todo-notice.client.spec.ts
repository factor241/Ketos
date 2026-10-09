// The to-do notice keys: `ketos/invalid` names the title for a new list or a
// new item, and a changed list for an operation on an existing item;
// `ketos/limit` names the board limit for a new list and the full list inside
// one.
import { describe, expect, it } from 'vitest'
import { todoNoticeKey } from '../src/client/todo-notice.ts'

describe('todo notice keys', () => {
  it('names the title for an invalid new list or new item', () => {
    expect(todoNoticeKey('ketos/invalid', 'create')).toBe('element.todo.error.invalid')
    expect(todoNoticeKey('ketos/invalid', 'add')).toBe('element.todo.error.invalid')
  })

  it('names a changed list for an invalid operation on an existing item', () => {
    expect(todoNoticeKey('ketos/invalid', 'list')).toBe('element.todo.error.stale')
  })

  it('names the board limit for a new list and the full list inside one', () => {
    expect(todoNoticeKey('ketos/limit', 'create')).toBe('element.todo.error.limit')
    expect(todoNoticeKey('ketos/limit', 'add')).toBe('element.todo.full')
    expect(todoNoticeKey('ketos/limit', 'list')).toBe('element.todo.full')
  })

  it('names Beads availability and every other failure the same way in each scope', () => {
    for (const scope of ['create', 'add', 'list'] as const) {
      expect(todoNoticeKey('ketos/beads-unavailable', scope)).toBe('element.todo.error.unavailable')
      expect(todoNoticeKey('ketos/beads-failed', scope)).toBe('element.todo.error.failed')
      expect(todoNoticeKey('ketos/unreachable', scope)).toBe('element.todo.error.failed')
    }
  })
})
