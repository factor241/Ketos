// The placement watcher: one place request per pending list and sweep, the
// center of the visible safe area as the target, nothing while the tab is
// hidden, and a freed element after the request settles.
import { describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { BoardElement, ElementId, OwnerId } from '@ketos/board-doc/types'
import { placeInSafeArea } from '../src/client/board-coordinates.ts'
import { createBoardStore, type BoardState } from '../src/client/store.ts'
import { TodoPlacement } from '../src/client/todo-placement.ts'

const ID = brandString<ElementId>('00000000-0000-4000-8000-0000000000b1')
const OTHER = brandString<ElementId>('00000000-0000-4000-8000-0000000000b2')

const LIMITS = { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 }

/** One todo element; `pending` adds the placement flag. */
function element(id: ElementId, pending: boolean): BoardElement {
  return {
    id,
    kind: 'todo',
    ownerId: brandString<OwnerId>('demo-self'),
    x: 0,
    y: 0,
    w: 280,
    h: 240,
    z: 1,
    data: {
      epicId: 'kt-1',
      title: 'Список',
      items: [],
      syncedAt: '2026-10-06T12:00:00Z',
      ...pending ? { pendingPlacement: true } : {},
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

/**
 * Board state with the given elements and limits.
 * @param elements - elements to publish.
 * @param limits - limits to publish; null leaves the snapshot unread.
 * @returns the board state.
 */
function state(elements: readonly BoardElement[], limits: BoardState['boardLimits'] = LIMITS): BoardState {
  const base = createBoardStore().create().getSnapshot()
  return {
    ...base,
    boardLimits: limits,
    boardElements: Object.fromEntries(elements.map(candidate => [String(candidate.id), candidate])),
  }
}

/** A deferred result the test settles explicitly. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((settle) => { resolve = settle })
  return { promise, resolve }
}

describe('todo placement', () => {
  it('places a pending list once in the center of the visible safe area', () => {
    const board = state([element(ID, true)])
    const place = vi.fn(() => Promise.resolve())
    const placement = new TodoPlacement({ getState: () => board, isVisible: () => true, place })

    placement.sweep()

    const at = placeInSafeArea(board, 280, 240)
    expect(place).toHaveBeenCalledTimes(1)
    expect(place).toHaveBeenCalledWith(ID, at.x, at.y)
  })

  it('does not place while a request for the same list is in flight', () => {
    const board = state([element(ID, true)])
    const gate = deferred()
    const place = vi.fn(() => gate.promise)
    const placement = new TodoPlacement({ getState: () => board, isVisible: () => true, place })

    placement.sweep()
    placement.sweep()
    expect(place).toHaveBeenCalledTimes(1)

    gate.resolve()
  })

  it('retries on the next sweep after the request settles', async () => {
    const board = state([element(ID, true)])
    const place = vi.fn(() => Promise.resolve())
    const placement = new TodoPlacement({ getState: () => board, isVisible: () => true, place })
    placement.sweep()
    await Promise.resolve()
    placement.sweep()
    expect(place).toHaveBeenCalledTimes(2)
  })

  it('places nothing while the tab is hidden or before the limits arrive', () => {
    const board = state([element(ID, true)])
    const place = vi.fn(() => Promise.resolve())
    const hidden = new TodoPlacement({ getState: () => board, isVisible: () => false, place })
    hidden.sweep()
    expect(place).not.toHaveBeenCalled()

    const noLimits = new TodoPlacement({ getState: () => state([element(ID, true)], null), isVisible: () => true, place })
    noLimits.sweep()
    expect(place).not.toHaveBeenCalled()
  })

  it('skips lists that are not pending and elements that are not lists', () => {
    const board = state([
      element(ID, false),
      element(OTHER, true),
      { ...element(OTHER, true), kind: 'note', id: brandString<ElementId>('00000000-0000-4000-8000-0000000000b3') },
    ])
    const place = vi.fn((_id: ElementId, _x: number, _y: number) => Promise.resolve())
    const placement = new TodoPlacement({ getState: () => board, isVisible: () => true, place })
    placement.sweep()
    expect(place).toHaveBeenCalledTimes(1)
    expect(place).toHaveBeenCalledWith(OTHER, expect.any(Number), expect.any(Number))
  })
})
