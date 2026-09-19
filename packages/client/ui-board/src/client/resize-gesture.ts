/**
 * Resize gesture shared by the frame's handles and the screen-space handle
 * ring: capture the pointer, raise the window, and follow the drag through
 * `resizeStep` with the canvas zoom divided out of every delta.
 */
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { BoardWindowState } from './contract/slots.ts'
import type { BoardGestureHandlers } from './pointer-gesture.ts'
import type { BoardActions } from './open-window.ts'
import { resizeStep, type ResizeDirection } from './resize.ts'

/** Everything one resize gesture reads at pointerdown. */
export interface WindowResizeGesture {
  /** The pointerdown on the handle. */
  readonly event: ReactPointerEvent<HTMLElement>
  /** The window being resized. */
  readonly window: BoardWindowState
  /** The handle's direction. */
  readonly direction: ResizeDirection
  /** Canvas zoom at gesture start; deltas are world units. */
  readonly zoom: number
  /** The shared board action face. */
  readonly actions: BoardActions
  /** The owner's gesture starter (frame handle or handle ring). */
  readonly start: (element: Element, pointerId: number, handlers: BoardGestureHandlers) => void
}

/**
 * Start one resize gesture on a handle.
 * @param gesture - handle event, window, direction, zoom, action face, and gesture starter.
 */
export function startWindowResizeGesture(gesture: WindowResizeGesture): void {
  const { event, window: cardWindow, direction, zoom, actions, start } = gesture
  event.stopPropagation()
  const target = event.currentTarget
  target.setPointerCapture(event.pointerId)
  actions.focusWindow(cardWindow.id)

  const origin = {
    x: cardWindow.x,
    y: cardWindow.y,
    width: cardWindow.width,
    height: cardWindow.height,
  }
  const startClientX = event.clientX
  const startClientY = event.clientY

  start(target, event.pointerId, {
    move: (moveEvt) => {
      const dx = (moveEvt.clientX - startClientX) / zoom
      const dy = (moveEvt.clientY - startClientY) / zoom
      // The step already snapped and clamped to the minimum; the store's
      // actions re-apply the same rules idempotently.
      const next = resizeStep(direction, origin, dx, dy, !moveEvt.shiftKey)
      if (next.x !== origin.x || next.y !== origin.y) {
        actions.moveWindow(cardWindow.id, next.x, next.y, false)
      }
      actions.resizeWindow(cardWindow.id, next.width, next.height, false)
    },
  })
}
