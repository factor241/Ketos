/**
 * Placement watcher for to-do lists created from chat. On every sweep it
 * finds hosted `todo` elements that still carry `pendingPlacement` and sends
 * one place request each, in the center of the visible safe area.
 *
 * A hidden tab sweeps nothing; a request in flight suppresses a second one for
 * the same element; and a settled request (success, a 409 from another tab, or
 * a failure) frees the element for the next sweep, which the store
 * subscription triggers.
 */
import { parseTodoData } from '@ketos/board-doc/data'
import type { ElementId } from '@ketos/board-doc/types'
import { placeInSafeArea } from './board-coordinates.ts'
import type { BoardState } from './store.ts'

/** Inputs of {@link TodoPlacement}: the board state, visibility, and the request. */
export interface TodoPlacementOptions {
  /** Current board state, including the element map and limits. */
  readonly getState: () => BoardState
  /** Whether the document is visible, so a hidden tab places nothing. */
  readonly isVisible: () => boolean
  /** Send one place request; the returned promise gates the in-flight set. */
  readonly place: (id: ElementId, x: number, y: number) => Promise<unknown>
}

/** One placement pass over the board's pending to-do lists. */
export class TodoPlacement {
  private readonly inFlight = new Set<ElementId>()

  constructor(private readonly options: TodoPlacementOptions) {}

  /**
   * Place every pending list that no request is in flight for.
   */
  sweep(): void {
    if (!this.options.isVisible()) return
    const state = this.options.getState()
    if (state.boardLimits === null) return
    for (const element of Object.values(state.boardElements)) {
      if (element.kind !== 'todo' || this.inFlight.has(element.id)) continue
      const data = parseTodoData(element.data, state.boardLimits)
      if (data === null || data.pendingPlacement !== true) continue
      this.inFlight.add(element.id)
      const at = placeInSafeArea(state, element.w, element.h)
      const settle = (): void => { this.inFlight.delete(element.id) }
      void this.options.place(element.id, at.x, at.y).then(settle, settle)
    }
  }
}
