/**
 * Wheel priority over the board: the canvas and its floating chrome zoom,
 * while a window lane and an open chats panel keep the wheel for their own
 * scrolling.
 */

/**
 * Whether a wheel event over the board zooms the canvas. Events outside the
 * board never reach this decision (the listener is the board root); events
 * inside a window or its chats panel belong to their own scrolling surfaces.
 * @param target - the wheel event's target.
 * @returns true when the canvas may take the event.
 */
export function wheelZoomsBoard(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('[data-surface="board"]') === null) return false
  return target.closest('[data-board-window], [data-board-panel]') === null
}
