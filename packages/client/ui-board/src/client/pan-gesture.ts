/**
 * Pan gesture shared by the canvas's background drag and the board root's
 * Space/middle-button drag: capture the pointer on the originating element and
 * follow the screen delta, so both paths pan identically.
 */
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { BoardGestureHandlers } from './pointer-gesture.ts'
import type { BoardActions } from './open-window.ts'

/** Everything one pan gesture reads at pointerdown. */
export interface BoardPanGesture {
  /** The pointerdown that starts the pan. */
  readonly event: ReactPointerEvent<HTMLElement>
  /** Pan offset when the gesture started. */
  readonly panX: number
  readonly panY: number
  /** The shared board action face. */
  readonly actions: BoardActions
  /** The owner's gesture starter (canvas or board root). */
  readonly start: (element: Element, pointerId: number, handlers: BoardGestureHandlers) => void
}

/**
 * Start one pan gesture on the element that owns the pointerdown.
 * @param gesture - pointerdown, current pan, action face, and gesture starter.
 */
export function startBoardPanGesture(gesture: BoardPanGesture): void {
  const { event, panX, panY, actions, start } = gesture
  const target = event.currentTarget
  target.setPointerCapture(event.pointerId)
  const startClientX = event.clientX
  const startClientY = event.clientY
  start(target, event.pointerId, {
    move: (moveEvt) => {
      actions.setPan(panX + (moveEvt.clientX - startClientX), panY + (moveEvt.clientY - startClientY))
    },
  })
}
