/**
 * Placement watcher for to-do lists created from chat. On every sweep it
 * finds the acting participant's hosted `todo` elements that still carry
 * `pendingPlacement` and sends one place request each, in the center of the
 * visible safe area.
 *
 * A sweep places nothing while the tab is hidden or the board is not mounted,
 * and never touches a list owned by another participant (a synchronized list
 * keeps its owner's placement flag, and the host answers 409 to anyone else).
 * Each list is requested once: a request in flight suppresses a second one,
 * and any answer from the host — success or an error code — ends the list's
 * placement. Only an unreachable host (no answer, or a rejected request)
 * schedules a retry, with a delay that doubles up to a maximum.
 */
import { parseTodoData } from '@ketos/board-doc/data'
import type { ElementId, OwnerId } from '@ketos/board-doc/types'
import { placeInSafeArea } from './board-coordinates.ts'
import type { BoardState } from './store.ts'
import type { TodoOutcome } from './todo-api.ts'

/** Delay schedule of the retry after an unreachable host. */
export interface TodoPlacementRetry {
  /** Delay before the first retry, in milliseconds. */
  readonly initialMs: number
  /** Largest delay between two retries, in milliseconds. */
  readonly maxMs: number
}

/** Inputs of {@link TodoPlacement}: the board state, the gates, and the request. */
export interface TodoPlacementOptions {
  /** Current board state, including the element map and limits. */
  readonly getState: () => BoardState
  /** Whether the document is visible, so a hidden tab places nothing. */
  readonly isVisible: () => boolean
  /** Whether the board main panel is mounted, so an unmounted board places nothing. */
  readonly isBoardMounted: () => boolean
  /** Identity of the acting participant; null before the first snapshot. */
  readonly ownerId: () => OwnerId | null
  /** Retry schedule after an unreachable host. */
  readonly retry: TodoPlacementRetry
  /**
   * Send one place request.
   * @param id - the list element.
   * @param x - world x of the list's top-left.
   * @param y - world y of the list's top-left.
   * @returns the decoded answer; a rejection counts as an unreachable host.
   */
  readonly place: (id: ElementId, x: number, y: number) => Promise<TodoOutcome>
}

/** One placement pass over the acting participant's pending to-do lists. */
export class TodoPlacement {
  private readonly inFlight = new Set<ElementId>()
  /** Lists the host answered for; they are never requested again. */
  private readonly answered = new Set<ElementId>()
  /** Pending retry timers by list. */
  private readonly timers = new Map<ElementId, ReturnType<typeof setTimeout>>()
  /** Consecutive unreachable answers by list. */
  private readonly failures = new Map<ElementId, number>()
  private disposed = false

  constructor(private readonly options: TodoPlacementOptions) {}

  /**
   * Place every own pending list that has no request in flight, no answer,
   * and no retry timer.
   */
  sweep(): void {
    if (this.disposed || !this.options.isVisible() || !this.options.isBoardMounted()) return
    const owner = this.options.ownerId()
    const state = this.options.getState()
    if (owner === null || state.boardLimits === null) return
    for (const id of this.answered) {
      if (state.boardElements[id as string] === undefined) this.answered.delete(id)
    }
    for (const element of Object.values(state.boardElements)) {
      if (element.kind !== 'todo' || element.ownerId !== owner) continue
      if (this.inFlight.has(element.id) || this.answered.has(element.id) || this.timers.has(element.id)) continue
      const data = parseTodoData(element.data, state.boardLimits)
      if (data === null || data.pendingPlacement !== true) continue
      this.inFlight.add(element.id)
      const at = placeInSafeArea(state, element.w, element.h)
      void this.options.place(element.id, at.x, at.y).then(
        (outcome) => { this.settle(element.id, outcome.ok || outcome.code !== 'ketos/unreachable') },
        () => { this.settle(element.id, false) },
      )
    }
  }

  /**
   * Cancel the retry timers and ignore answers still in flight.
   */
  dispose(): void {
    this.disposed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  /**
   * Record the end of one request.
   * @param id - the list the request was for.
   * @param answered - whether the host answered; false schedules a retry.
   */
  private settle(id: ElementId, answered: boolean): void {
    this.inFlight.delete(id)
    if (this.disposed) return
    if (answered) {
      this.failures.delete(id)
      this.answered.add(id)
      return
    }
    const failures = this.failures.get(id) ?? 0
    this.failures.set(id, failures + 1)
    const delay = Math.min(this.options.retry.initialMs * 2 ** failures, this.options.retry.maxMs)
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id)
      this.sweep()
    }, delay))
  }
}
