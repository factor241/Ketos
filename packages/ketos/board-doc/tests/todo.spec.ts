// The todo kind's data rules: the exact snapshot shape the host writes after
// every bd call, the item and status vocabulary, and the Beads issue id guard.
import { describe, expect, it } from 'vitest'
import { isBeadsIssueId, parseTodoData, validateElementData } from '../src/data.ts'
import type { BoardElementData, BoardLimits } from '../src/types.ts'

const LIMITS: BoardLimits = { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 }

/** Element box the todo parser ignores. */
const BOX = { w: 100, h: 100 }

/** One complete, valid list snapshot. */
const TODO: BoardElementData = {
  epicId: 'kt-219',
  title: 'Покупки',
  items: [
    { id: 'kt-219.1', title: 'Молоко', status: 'open' },
    { id: 'kt-219.2', title: 'Хлеб', status: 'closed' },
  ],
  syncedAt: '2026-10-06T12:00:00Z',
}

/**
 * Build one item snapshot.
 * @param index - item serial used in the id and title.
 * @returns an item value.
 */
function item(index: number): BoardElementData {
  return { id: `kt-219.${String(index)}`, title: `item ${String(index)}`, status: 'open' }
}

describe('Beads issue ids', () => {
  it('accepts the epic and child shapes and rejects everything else', () => {
    expect(isBeadsIssueId('kt-219')).toBe(true)
    expect(isBeadsIssueId('ketos-ab12-3')).toBe(true)
    expect(isBeadsIssueId('kt-219.1')).toBe(true)
    expect(isBeadsIssueId('kt-219.1.10')).toBe(true)
    expect(isBeadsIssueId('KT-219')).toBe(false)
    expect(isBeadsIssueId('kt')).toBe(false)
    expect(isBeadsIssueId('-219')).toBe(false)
    expect(isBeadsIssueId('kt-')).toBe(false)
    expect(isBeadsIssueId('kt-219.')).toBe(false)
    expect(isBeadsIssueId('kt-219.1a')).toBe(false)
    expect(isBeadsIssueId(219)).toBe(false)
  })
})

describe('todo data', () => {
  it('parses a complete snapshot and validates it as a board element', () => {
    expect(parseTodoData(TODO, LIMITS)).toEqual(TODO)
    expect(validateElementData('todo', TODO, LIMITS, BOX)).toBeNull()
  })

  it('carries both optional flags when they are true and drops them when absent', () => {
    const flagged = { ...TODO, missing: true, pendingPlacement: true }
    expect(parseTodoData(flagged, LIMITS)).toEqual(flagged)
    expect(parseTodoData({ ...TODO, missing: false }, LIMITS)).toBeNull()
    expect(parseTodoData({ ...TODO, pendingPlacement: 1 }, LIMITS)).toBeNull()
  })

  it('refuses data that is not an object and refuses unknown top-level fields', () => {
    expect(parseTodoData(null, LIMITS)).toBeNull()
    expect(parseTodoData([TODO], LIMITS)).toBeNull()
    expect(parseTodoData({ ...TODO, extra: 1 }, LIMITS)).toBeNull()
  })

  it('refuses a missing field of the snapshot', () => {
    expect(parseTodoData({ title: TODO.title, items: [], syncedAt: TODO.syncedAt }, LIMITS)).toBeNull()
    expect(parseTodoData({ epicId: TODO.epicId, items: [], syncedAt: TODO.syncedAt }, LIMITS)).toBeNull()
    expect(parseTodoData({ epicId: TODO.epicId, title: TODO.title, syncedAt: TODO.syncedAt }, LIMITS)).toBeNull()
    expect(parseTodoData({ epicId: TODO.epicId, title: TODO.title, items: [] }, LIMITS)).toBeNull()
  })

  it('refuses a malformed epic id, an empty title, and an empty sync time', () => {
    expect(parseTodoData({ ...TODO, epicId: 'KT-219' }, LIMITS)).toBeNull()
    expect(parseTodoData({ ...TODO, title: '' }, LIMITS)).toBeNull()
    expect(parseTodoData({ ...TODO, title: 7 }, LIMITS)).toBeNull()
    expect(parseTodoData({ ...TODO, syncedAt: '' }, LIMITS)).toBeNull()
    expect(parseTodoData({ ...TODO, syncedAt: 7 }, LIMITS)).toBeNull()
  })

  it('refuses a non-array item list and one item over the item limit', () => {
    expect(parseTodoData({ ...TODO, items: 'none' }, LIMITS)).toBeNull()
    const exact = Array.from({ length: 200 }, (_value, index) => item(index))
    expect(parseTodoData({ ...TODO, items: exact }, LIMITS)?.items).toHaveLength(200)
    const over = Array.from({ length: 201 }, (_value, index) => item(index))
    expect(parseTodoData({ ...TODO, items: over }, LIMITS)).toBeNull()
    expect(validateElementData('todo', { ...TODO, items: over }, LIMITS, BOX)).toBe('invalid todo data')
  })

  it('refuses a malformed item: non-object, wrong fields, bad id, empty title, unknown status', () => {
    expect(parseTodoData({ ...TODO, items: ['none'] }, LIMITS)).toBeNull()
    expect(parseTodoData({ ...TODO, items: [{ ...item(1), extra: true }] }, LIMITS)).toBeNull()
    expect(parseTodoData({ ...TODO, items: [{ id: item(1)['id'], status: 'open' }] }, LIMITS)).toBeNull()
    expect(parseTodoData({ ...TODO, items: [{ ...item(1), id: 'KT-1' }] }, LIMITS)).toBeNull()
    expect(parseTodoData({ ...TODO, items: [{ ...item(1), title: '' }] }, LIMITS)).toBeNull()
    expect(parseTodoData({ ...TODO, items: [{ ...item(1), status: 'doing' }] }, LIMITS)).toBeNull()
    expect(parseTodoData({ ...TODO, items: [{ ...item(1), status: 1 }] }, LIMITS)).toBeNull()
  })

  it('accepts every status of the Beads vocabulary', () => {
    for (const status of ['open', 'in_progress', 'blocked', 'deferred', 'closed']) {
      expect(parseTodoData({ ...TODO, items: [{ ...item(1), status }] }, LIMITS)?.items[0]?.status).toBe(status)
    }
  })
})
