/** Shared tail of the board's pointer gestures: release capture and unlisten. */

/**
 * Both the drag and the resize paths register the same global listeners over
 * the originating element's pointer capture; this one helper releases both
 * instead of the two copies the lint gate previously flagged.
 * @param element - the element whose pointer capture to release.
 * @param upEvt - the pointerup event carrying the captured pointer id.
 * @param onPointerMove - move listener to remove.
 * @param onPointerUp - this listener itself, removed after the release.
 */
export function finishBoardPointerGesture(
  element: Element,
  upEvt: PointerEvent,
  onPointerMove: (event: PointerEvent) => void,
  onPointerUp: (event: PointerEvent) => void,
): void {
  try {
    element.releasePointerCapture(upEvt.pointerId)
  } catch {
    // The capture may already be gone when the gesture ended elsewhere.
  }
  globalThis.removeEventListener('pointermove', onPointerMove)
  globalThis.removeEventListener('pointerup', onPointerUp)
}
