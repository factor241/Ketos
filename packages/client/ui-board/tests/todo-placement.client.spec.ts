// The placement watcher: one place request per own pending list, the center of
// the visible safe area as the target, nothing while the tab is hidden or the
// board is not mounted, no second request after any answer but an unreachable
// host, and a backed-off retry while the host is unreachable.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { BoardElement, BoardRevision, ElementId, OwnerId } from '@ketos/board-doc/types'
import { placeInSafeArea } from '../src/client/board-coordinates.ts'
import { createBoardStore, type BoardState } from '../src/client/store.ts'
import { TodoPlacement, type TodoPlacementOptions } from '../src/client/todo-placement.ts'
import type { TodoOutcome } from '../src/client/todo-api.ts'

const ID = brandString<ElementId>('00000000-0000-4000-8000-0000000000b1')
const OTHER = brandString<ElementId>('00000000-0000-4000-8000-0000000000b2')

const SELF = brandString<OwnerId>('demo-self')
const RETRY = { initialMs: 1000, maxMs: 4000 }
const OK: TodoOutcome = { ok: true, elementId: ID, revision: brandNumber<BoardRevision>(1) }
const TAKEN: TodoOutcome = { ok: false, code: 'ketos/placement-taken' }
const UNREACHABLE: TodoOutcome = { ok: false, code: 'ketos/unreachable' }

const LIMITS = { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 }

/** One todo element; `pending` adds the placement flag. */
function element(id: ElementId, pending: boolean, ownerId: OwnerId = SELF): BoardElement {
  return {
    id,
    kind: 'todo',
    ownerId,
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
function deferred(): { promise: Promise<TodoOutcome>; resolve: (outcome: TodoOutcome) => void } {
  let resolve: (outcome: TodoOutcome) => void = () => {}
  const promise = new Promise<TodoOutcome>((settle) => { resolve = settle })
  return { promise, resolve }
}

/**
 * Placement over a fixed board with mounted board, the local owner, and a
 * visible tab unless overridden.
 * @param board - the board state to read.
 * @param place - the place request.
 * @param overrides - option overrides.
 * @returns the placement.
 */
function placementOver(
  board: BoardState,
  place: TodoPlacementOptions['place'],
  overrides: Partial<TodoPlacementOptions> = {},
): TodoPlacement {
  return new TodoPlacement({
    getState: () => board,
    isVisible: () => true,
    isBoardMounted: () => true,
    ownerId: () => SELF,
    retry: RETRY,
    place,
    ...overrides,
  })
}

/** Let the settled place promise reach its handler. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

afterEach(() => { vi.useRealTimers() })

describe('todo placement', () => {
  it('places a pending list once in the center of the visible safe area', () => {
    const board = state([element(ID, true)])
    const place = vi.fn(() => Promise.resolve(OK))
    const placement = placementOver(board, place)

    placement.sweep()

    const at = placeInSafeArea(board, 280, 240)
    expect(place).toHaveBeenCalledTimes(1)
    expect(place).toHaveBeenCalledWith(ID, at.x, at.y)
  })

  it('does not place while a request for the same list is in flight', () => {
    const board = state([element(ID, true)])
    const gate = deferred()
    const place = vi.fn(() => gate.promise)
    const placement = placementOver(board, place)

    placement.sweep()
    placement.sweep()
    expect(place).toHaveBeenCalledTimes(1)

    gate.resolve(OK)
  })

  it('requests each list once, whether the host placed it or answered with another code', async () => {
    vi.useFakeTimers()
    const board = state([element(ID, true), element(OTHER, true)])
    const place = vi.fn((id: ElementId) => Promise.resolve(id === ID ? OK : TAKEN))
    const placement = placementOver(board, place)

    placement.sweep()
    await settle()
    placement.sweep()
    placement.sweep()
    await settle()
    expect(place).toHaveBeenCalledTimes(2)
  })

  it('places only lists of the local owner', () => {
    const foreign = brandString<OwnerId>('demo-legal')
    const board = state([element(ID, true, foreign), element(OTHER, true)])
    const place = vi.fn((_id: ElementId, _x: number, _y: number) => Promise.resolve(OK))
    placementOver(board, place).sweep()
    expect(place).toHaveBeenCalledTimes(1)
    expect(place).toHaveBeenCalledWith(OTHER, expect.any(Number), expect.any(Number))

    const place2 = vi.fn(() => Promise.resolve(OK))
    placementOver(board, place2, { ownerId: () => null }).sweep()
    expect(place2).not.toHaveBeenCalled()
  })

  it('places nothing while the board is not mounted, the tab is hidden, or before the limits arrive', () => {
    const board = state([element(ID, true)])
    const place = vi.fn(() => Promise.resolve(OK))
    placementOver(board, place, { isBoardMounted: () => false }).sweep()
    placementOver(board, place, { isVisible: () => false }).sweep()
    placementOver(state([element(ID, true)], null), place).sweep()
    expect(place).not.toHaveBeenCalled()
  })

  it('places a list that was skipped while the board was unmounted once it mounts', () => {
    const board = state([element(ID, true)])
    let mounted = false
    const place = vi.fn(() => Promise.resolve(OK))
    const placement = placementOver(board, place, { isBoardMounted: () => mounted })
    placement.sweep()
    expect(place).not.toHaveBeenCalled()
    mounted = true
    placement.sweep()
    expect(place).toHaveBeenCalledTimes(1)
  })

  it('skips lists that are not pending and elements that are not lists', () => {
    const board = state([
      element(ID, false),
      element(OTHER, true),
      { ...element(OTHER, true), kind: 'note', id: brandString<ElementId>('00000000-0000-4000-8000-0000000000b3') },
    ])
    const place = vi.fn((_id: ElementId, _x: number, _y: number) => Promise.resolve(OK))
    placementOver(board, place).sweep()
    expect(place).toHaveBeenCalledTimes(1)
    expect(place).toHaveBeenCalledWith(OTHER, expect.any(Number), expect.any(Number))
  })

  it('retries an unreachable host with a growing delay capped at the maximum', async () => {
    vi.useFakeTimers()
    const board = state([element(ID, true)])
    const place = vi.fn((_id: ElementId, _x: number, _y: number) => Promise.resolve(UNREACHABLE))
    const placement = placementOver(board, place)

    placement.sweep()
    await settle()
    expect(place).toHaveBeenCalledTimes(1)
    // A sweep inside the backoff window stays quiet.
    placement.sweep()
    expect(place).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(RETRY.initialMs - 1)
    expect(place).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(place).toHaveBeenCalledTimes(2)

    // The second delay doubles.
    await vi.advanceTimersByTimeAsync(RETRY.initialMs * 2 - 1)
    expect(place).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(place).toHaveBeenCalledTimes(3)

    // The third would be 4000 ms, the cap; the fourth stays at the cap.
    await vi.advanceTimersByTimeAsync(RETRY.maxMs)
    expect(place).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(RETRY.maxMs)
    expect(place).toHaveBeenCalledTimes(5)
  })

  it('stops retrying after the host answers and treats a rejected request as unreachable', async () => {
    vi.useFakeTimers()
    const board = state([element(ID, true)])
    const place = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(OK)
    const placement = placementOver(board, place)
    placement.sweep()
    await settle()
    await vi.advanceTimersByTimeAsync(RETRY.initialMs)
    expect(place).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(RETRY.maxMs * 4)
    expect(place).toHaveBeenCalledTimes(2)
  })

  it('cancels pending retries and ignores late answers after dispose', async () => {
    vi.useFakeTimers()
    const board = state([element(ID, true)])
    const place = vi.fn((_id: ElementId, _x: number, _y: number) => Promise.resolve(UNREACHABLE))
    const placement = placementOver(board, place)
    placement.sweep()
    await settle()
    expect(vi.getTimerCount()).toBe(1)
    placement.dispose()
    expect(vi.getTimerCount()).toBe(0)
    placement.sweep()
    await vi.advanceTimersByTimeAsync(RETRY.maxMs * 2)
    expect(place).toHaveBeenCalledTimes(1)

    const gate = deferred()
    const late = placementOver(board, vi.fn(() => gate.promise))
    late.sweep()
    late.dispose()
    gate.resolve(UNREACHABLE)
    await settle()
    expect(vi.getTimerCount()).toBe(0)
  })
})
