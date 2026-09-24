/**
 * Lifecycle of the board's pointer gestures. Every drag (canvas pan, window
 * header, window resize, panel resize, panel row reorder) captures the pointer
 * on its originating element, listens on `globalThis`, and ends on the first
 * of pointerup, pointercancel, or the owner's unmount. One starter owns that
 * lifecycle so no path can leave a global listener or a live capture behind.
 */
import { useCallback, useEffect, useRef } from 'react'

/** What one live gesture listens for. */
export interface BoardGestureHandlers {
  /** Pointer moved while the gesture is live. */
  readonly move?: (event: PointerEvent) => void
  /**
   * The gesture ended: pointerup, pointercancel, or disposal (`null`).
   */
  readonly end?: (event: PointerEvent | null) => void
}

/**
 * Track one pointer gesture on an element that already captured the pointer.
 * Events from any other pointer are ignored, so a second finger's move cannot
 * drive the gesture nor its lift end it. The returned disposer is idempotent;
 * calling it from an unmount effect ends the gesture exactly like a
 * pointercancel would.
 * @param element - element holding the pointer capture.
 * @param pointerId - captured pointer id.
 * @param handlers - move/end callbacks of this gesture.
 * @returns the gesture disposer.
 */
export function startBoardPointerGesture(
  element: Element,
  pointerId: number,
  handlers: BoardGestureHandlers,
): () => void {
  let live = true
  const finish = (event: PointerEvent | null): void => {
    if (!live) return
    live = false
    globalThis.removeEventListener('pointermove', onMove)
    globalThis.removeEventListener('pointerup', onUp)
    globalThis.removeEventListener('pointercancel', onCancel)
    try {
      element.releasePointerCapture(pointerId)
    } catch {
      // The capture may already be gone when the gesture ended elsewhere.
    }
    handlers.end?.(event)
  }
  const onMove = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return
    handlers.move?.(event)
  }
  const onUp = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return
    finish(event)
  }
  const onCancel = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return
    finish(event)
  }

  globalThis.addEventListener('pointermove', onMove)
  globalThis.addEventListener('pointerup', onUp)
  globalThis.addEventListener('pointercancel', onCancel)
  return () => { finish(null) }
}

/**
 * Own the pointer gestures of one component. Starting a gesture ends the
 * previous one, and unmounting the component ends whatever is live — a drag
 * interrupted by closing its window or disposing the board leaves nothing
 * behind.
 * @returns the starter for this component's gestures.
 */
export function useBoardPointerGesture(): (
  element: Element,
  pointerId: number,
  handlers: BoardGestureHandlers,
) => void {
  const liveRef = useRef<(() => void) | null>(null)
  useEffect(() => () => { liveRef.current?.() }, [])
  return useCallback((element, pointerId, handlers) => {
    liveRef.current?.()
    liveRef.current = startBoardPointerGesture(element, pointerId, {
      ...handlers,
      end: (event) => {
        liveRef.current = null
        handlers.end?.(event)
      },
    })
  }, [])
}
