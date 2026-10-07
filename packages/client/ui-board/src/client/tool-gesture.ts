/**
 * Shared lifecycle of the board's tool drags (brush and eraser): capture the
 * pointer on the canvas, feed every coalesced sample to the caller, run one
 * animation-frame callback per batch, and report exactly one end for
 * pointerup, pointercancel, or disposal.
 */
import type { PointerEvent as ReactPointerEvent } from 'react'
import { mintElementId } from '@ketos/board-doc/data'
import type { StrokeBounds, StrokeWidth } from '@ketos/board-doc/types'
import type { BoardElementSpec } from './contract/slots.ts'
import { clientToBoard, screenToWorld, type BoardPoint, type BoardView } from './board-coordinates.ts'
import type { BoardGestureHandlers } from './pointer-gesture.ts'

/** Everything one tool drag reads at pointerdown. */
export interface BoardToolGesture {
  /** The pointerdown that starts the drag. */
  readonly event: ReactPointerEvent<HTMLDivElement>
  /** The owner's gesture starter (the canvas). */
  readonly start: (element: Element, pointerId: number, handlers: BoardGestureHandlers) => void
  /** Receive one pointer sample, coalesced samples included. */
  readonly sample: (event: PointerEvent) => void
  /** Called once per animation frame with the samples collected so far. */
  readonly frame: () => void
  /** Called when the drag ends: pointerup, pointercancel, or disposal (`null`). */
  readonly end: (event: PointerEvent | null) => void
}

/**
 * Translate one pointer sample into world coordinates with the live view, so a
 * zoom in the middle of a drag moves the view for the next sample without
 * shifting the points already taken.
 * @param container - canvas box client coordinates translate against.
 * @param view - live pan and zoom.
 * @param sample - one pointer sample.
 * @returns the world point.
 */
export function boardToolWorldPoint(container: HTMLElement, view: BoardView, sample: PointerEvent): BoardPoint {
  const box = container.getBoundingClientRect()
  const panel = clientToBoard({ left: box.left, top: box.top }, { x: sample.clientX, y: sample.clientY })
  return screenToWorld(view, panel)
}

/**
 * Complete stroke element to create from a resolved box and the paint choices.
 * @param bounds - resolved element box and its relative points.
 * @param width - stroke thickness.
 * @param pen - whether a pen drew the stroke.
 * @returns the element spec.
 */
export function strokeSpecFromBounds(bounds: StrokeBounds, width: StrokeWidth, pen: boolean): BoardElementSpec {
  return {
    id: mintElementId(),
    kind: 'stroke',
    x: bounds.x,
    y: bounds.y,
    w: bounds.w,
    h: bounds.h,
    data: {
      points: bounds.points.map(([x, y, pressure]) => [x, y, pressure]),
      width,
      pen,
    },
  }
}

/**
 * Start one tool drag on the canvas that received the pointerdown.
 * @param gesture - pointerdown, the gesture starter, and the sample/frame/end callbacks.
 */
export function startBoardToolGesture(gesture: BoardToolGesture): void {
  const target = gesture.event.currentTarget
  target.setPointerCapture(gesture.event.pointerId)
  let frame: number | null = null
  let live = true
  const schedule = (): void => {
    if (frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      if (!live) return
      gesture.frame()
    })
  }
  gesture.sample(gesture.event.nativeEvent)
  schedule()
  gesture.start(target, gesture.event.pointerId, {
    move: (moveEvent) => {
      const coalesced = moveEvent.getCoalescedEvents()
      if (coalesced.length === 0) gesture.sample(moveEvent)
      else for (const sample of coalesced) gesture.sample(sample)
      schedule()
    },
    end: (endEvent) => {
      live = false
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      gesture.end(endEvent)
    },
  })
}
