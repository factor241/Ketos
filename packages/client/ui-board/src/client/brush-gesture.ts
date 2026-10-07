/**
 * Brush gesture of the board: one freehand drag that samples the pointer into
 * world points and commits exactly one stroke element on pointerup.
 *
 * Every sample is translated with the live view read at that moment, so a
 * wheel zoom in the middle of a stroke cannot shift the points already drawn.
 * A pointercancel or an unmount discards the draft without sending an
 * operation.
 */
import type { PointerEvent as ReactPointerEvent } from 'react'
import { simplifyStroke, STROKE_SIZES, strokeBounds } from '@ketos/board-doc/data'
import type { BoardLimits, StrokePoint, StrokeWidth } from '@ketos/board-doc/types'
import type { BoardElementSpec } from './contract/slots.ts'
import type { BoardView } from './board-coordinates.ts'
import type { BoardGestureHandlers } from './pointer-gesture.ts'
import type { BoardStrokeDraft } from './board-tool.ts'
import { boardToolWorldPoint, startBoardToolGesture, strokeSpecFromBounds } from './tool-gesture.ts'

/** Everything one brush gesture reads at pointerdown. */
export interface BoardBrushGestureOptions {
  /** The pointerdown that starts the stroke. */
  readonly event: ReactPointerEvent<HTMLDivElement>
  /** The owner's gesture starter (the canvas). */
  readonly start: (element: Element, pointerId: number, handlers: BoardGestureHandlers) => void
  /** Canvas box client coordinates translate against. */
  readonly container: HTMLElement
  /** Live pan and zoom, read at every sample. */
  readonly view: () => BoardView
  /** Document limits the committed stroke must fit. */
  readonly limits: BoardLimits
  /** Thickness the stroke commits with. */
  readonly width: StrokeWidth
  /** Create the committed element (one create operation). */
  readonly create: (spec: BoardElementSpec) => void
  /** Receive the live draft, or `null` when the gesture ends. */
  readonly onDraft: (draft: BoardStrokeDraft | null) => void
}

/**
 * Start one brush gesture on the canvas that received the pointerdown.
 * @param options - pointerdown, live view, and the draft/commit callbacks.
 */
export function startBoardBrushGesture(options: BoardBrushGestureOptions): void {
  const pen = options.event.pointerType === 'pen'
  const points: StrokePoint[] = []

  /** Pressure of one sample: a mouse reports no pressure, so it draws at 0.5. */
  const pressureOf = (sample: PointerEvent): number => sample.pointerType === 'mouse' ? 0.5 : sample.pressure
  const append = (sample: PointerEvent): void => {
    const world = boardToolWorldPoint(options.container, options.view(), sample)
    points.push([world.x, world.y, pressureOf(sample)])
  }

  startBoardToolGesture({
    event: options.event,
    start: options.start,
    sample: append,
    frame: () => { options.onDraft({ points: [...points], width: options.width, pen }) },
    end: (endEvent) => {
      options.onDraft(null)
      if (endEvent === null || endEvent.type !== 'pointerup') return
      if (points.length < 2) return
      const simplified = simplifyStroke(points, options.limits.strokePointsMax)
      options.create(strokeSpecFromBounds(strokeBounds(simplified, STROKE_SIZES[options.width]), options.width, pen))
    },
  })
}
