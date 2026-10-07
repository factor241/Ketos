/**
 * Eraser gesture of the board: one pass collects a world path, previews the
 * remaining parts of the owner's strokes, and commits one atomic batch of
 * removals and new parts on pointerup. Foreign strokes are never touched, and
 * a pointercancel or an unmount discards the pass without an operation.
 *
 * The eraser radius is its fixed screen radius over the live zoom, so the hole
 * a pass cuts matches the ring the user sees at any scale.
 */
import type { PointerEvent as ReactPointerEvent } from 'react'
import { eraseStroke, parseStrokeData, STROKE_SIZES, strokeBounds } from '@ketos/board-doc/data'
import type { BoardElement, BoardLimits, ElementId, StrokePathPoint, StrokePoint } from '@ketos/board-doc/types'
import type { BoardElementSpec } from './contract/slots.ts'
import type { BoardView } from './board-coordinates.ts'
import type { BoardGestureHandlers } from './pointer-gesture.ts'
import type { BoardEraserPreview, BoardStrokeDraft } from './board-tool.ts'
import { boardToolWorldPoint, startBoardToolGesture, strokeSpecFromBounds } from './tool-gesture.ts'

/** One owner stroke the eraser may touch, with its points in world units. */
interface EraserCandidate {
  readonly element: BoardElement
  readonly points: readonly StrokePoint[]
  readonly width: BoardStrokeDraft['width']
  readonly pen: boolean
}

/** Everything one eraser pass reads at pointerdown. */
export interface BoardEraserGestureOptions {
  /** The pointerdown that starts the pass. */
  readonly event: ReactPointerEvent<HTMLDivElement>
  /** The owner's gesture starter (the canvas). */
  readonly start: (element: Element, pointerId: number, handlers: BoardGestureHandlers) => void
  /** Canvas box client coordinates translate against. */
  readonly container: HTMLElement
  /** Live pan and zoom, read at every sample. */
  readonly view: () => BoardView
  /** Eraser radius in screen pixels; the world radius divides it by the zoom. */
  readonly radiusPx: number
  /** The owner's strokes, as the document held them at pointerdown. */
  readonly strokes: readonly BoardElement[]
  /** Document limits the strokes were validated against. */
  readonly limits: BoardLimits
  /** Commit one batch: removals and the remaining parts. */
  readonly erase: (removals: readonly ElementId[], parts: readonly BoardElementSpec[]) => void
  /** Receive the live preview, or `null` when nothing is touched or the pass ends. */
  readonly onPreview: (preview: BoardEraserPreview | null) => void
}

/**
 * Start one eraser pass on the canvas that received the pointerdown.
 * @param options - pointerdown, live view, the owner's strokes, and the commit callback.
 */
export function startBoardEraserGesture(options: BoardEraserGestureOptions): void {
  const candidates: EraserCandidate[] = []
  for (const element of options.strokes) {
    const data = parseStrokeData(element.data, options.limits, { w: element.w, h: element.h })
    if (data === null) continue
    candidates.push({
      element,
      points: data.points.map(([x, y, pressure]) => [element.x + x, element.y + y, pressure]),
      width: data.width,
      pen: data.pen,
    })
  }
  const path: StrokePathPoint[] = []

  const append = (sample: PointerEvent): void => {
    const world = boardToolWorldPoint(options.container, options.view(), sample)
    path.push([world.x, world.y])
  }

  /** Every touched stroke and its remaining parts at the current path and radius. */
  const touchedStrokes = (): Array<{ candidate: EraserCandidate; parts: StrokePoint[][] }> => {
    const radius = options.radiusPx / options.view().zoom
    const touched: Array<{ candidate: EraserCandidate; parts: StrokePoint[][] }> = []
    for (const candidate of candidates) {
      const parts = eraseStroke(candidate.points, path, radius)
      if (parts.length === 1 && parts[0]?.length === candidate.points.length) continue
      touched.push({ candidate, parts })
    }
    return touched
  }

  startBoardToolGesture({
    event: options.event,
    start: options.start,
    sample: append,
    frame: () => {
      const touched = touchedStrokes()
      if (touched.length === 0) {
        options.onPreview(null)
        return
      }
      const parts: BoardStrokeDraft[] = []
      for (const { candidate, parts: remaining } of touched) {
        for (const part of remaining) parts.push({ points: part, width: candidate.width, pen: candidate.pen })
      }
      options.onPreview({ hidden: touched.map(({ candidate }) => candidate.element.id), parts })
    },
    end: (endEvent) => {
      options.onPreview(null)
      if (endEvent === null || endEvent.type !== 'pointerup') return
      const touched = touchedStrokes()
      if (touched.length === 0) return
      const removals: ElementId[] = []
      const specs: BoardElementSpec[] = []
      for (const { candidate, parts } of touched) {
        removals.push(candidate.element.id)
        for (const part of parts) {
          specs.push(strokeSpecFromBounds(strokeBounds(part, STROKE_SIZES[candidate.width]), candidate.width, candidate.pen))
        }
      }
      options.erase(removals, specs)
    },
  })
}
