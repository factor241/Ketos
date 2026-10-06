/**
 * Pan gesture shared by the canvas's background drag and the board root's
 * Space/middle-button drag: capture the pointer on the originating element and
 * follow the screen delta, so both paths pan identically. The canvas passes a
 * `click` callback; the board root does not, so a Space/middle drag never
 * doubles as a canvas click.
 */
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { BoardGestureHandlers } from './pointer-gesture.ts'
import type { BoardActions } from './open-window.ts'

/** Screen-pixel movement below which a finished pan gesture counts as a click. */
export const CLICK_SLOP_PX = 3

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
  /**
   * Invoked when the pointer lifts without dragging: a plain click on the pan
   * surface. Absent for the board root's Space/middle pan, whose gesture is
   * never a click. Never invoked for `pointercancel` or disposal.
   */
  readonly click?: () => void
}

/**
 * Start one pan gesture on the element that owns the pointerdown.
 * @param gesture - pointerdown, current pan, action face, gesture starter, and optional click callback.
 */
export function startBoardPanGesture(gesture: BoardPanGesture): void {
  const { event, panX, panY, actions, start, click } = gesture
  const target = event.currentTarget
  target.setPointerCapture(event.pointerId)
  const startClientX = event.clientX
  const startClientY = event.clientY
  // The farthest the pointer travelled on either axis; a gesture that stayed
  // under the slop is a click, not a drag.
  let travelled = 0
  start(target, event.pointerId, {
    move: (moveEvt) => {
      const dx = moveEvt.clientX - startClientX
      const dy = moveEvt.clientY - startClientY
      travelled = Math.max(travelled, Math.abs(dx), Math.abs(dy))
      actions.setPan(panX + dx, panY + dy)
    },
    end: (endEvt) => {
      if (click === undefined) return
      // Disposal reports a null end; a cancelled pointer is not a click either.
      if (endEvt === null || endEvt.type !== 'pointerup') return
      if (travelled >= CLICK_SLOP_PX) return
      click()
    },
  })
}
