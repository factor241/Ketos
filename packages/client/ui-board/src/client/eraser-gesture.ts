/**
 * Eraser gesture of the board: one pass collects a world path, previews the
 * remaining parts of the owner's strokes, and commits one atomic batch of
 * removals and new parts on pointerup. Foreign strokes are never touched, and
 * a pointercancel or an unmount discards the pass without an operation.
 *
 * The eraser radius is its fixed screen radius over the live zoom, so the hole
 * a pass cuts matches the ring the user sees at any scale. The pass is
 * incremental (see `eraser-pass.ts`): each frame cuts only the path samples
 * added since the previous one, and strokes the new samples cannot reach cost
 * nothing.
 */
import type { PointerEvent as ReactPointerEvent } from 'react'
import { parseStrokeData, STROKE_SIZES, strokeBounds } from '@ketos/board-doc/data'
import type { BoardElement, BoardLimits, ElementId } from '@ketos/board-doc/types'
import type { BoardElementSpec } from './contract/slots.ts'
import type { BoardView } from './board-coordinates.ts'
import type { BoardGestureHandlers } from './pointer-gesture.ts'
import type { BoardEraserPreview, BoardStrokeDraft } from './board-tool.ts'
import { EraserPass, type EraserTarget } from './eraser-pass.ts'
import { boardToolWorldPoint, startBoardToolGesture, strokeSpecFromBounds } from './tool-gesture.ts'

/** One owner stroke the eraser may touch, with its points in world units. */
interface EraserCandidate extends EraserTarget {
  readonly element: BoardElement
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
      id: element.id,
      box: { x: element.x, y: element.y, w: element.w, h: element.h },
      element,
      points: data.points.map(([x, y, pressure]) => [element.x + x, element.y + y, pressure]),
      width: data.width,
      pen: data.pen,
    })
  }
  const pass = new EraserPass(candidates)

  /** Eraser radius in world units at the live zoom. */
  const worldRadius = (): number => options.radiusPx / options.view().zoom

  startBoardToolGesture({
    event: options.event,
    start: options.start,
    sample: (sample) => {
      const world = boardToolWorldPoint(options.container, options.view(), sample)
      pass.add(world.x, world.y, worldRadius())
    },
    frame: () => {
      const touched = pass.touched(worldRadius())
      if (touched.length === 0) {
        options.onPreview(null)
        return
      }
      const parts: BoardStrokeDraft[] = []
      for (const { target, parts: remaining } of touched) {
        for (const part of remaining) parts.push({ points: part, width: target.width, pen: target.pen })
      }
      options.onPreview({ hidden: touched.map(({ target }) => target.element.id), parts })
    },
    end: (endEvent) => {
      options.onPreview(null)
      if (endEvent === null || endEvent.type !== 'pointerup') return
      pass.finish()
      const touched = pass.touched(worldRadius())
      if (touched.length === 0) return
      const removals: ElementId[] = []
      const specs: BoardElementSpec[] = []
      for (const { target, parts } of touched) {
        removals.push(target.element.id)
        for (const part of parts) {
          specs.push(strokeSpecFromBounds(strokeBounds(part, STROKE_SIZES[target.width]), target.width, target.pen))
        }
      }
      options.erase(removals, specs)
    },
  })
}
