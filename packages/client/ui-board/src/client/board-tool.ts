/**
 * The board's active tool and the fixed screen size of the eraser: the tool is
 * transient view state (the layout never carries it), and the eraser's world
 * radius is its screen radius divided by the zoom, so the ring the user sees
 * keeps its size at every scale.
 */
import type { ElementId, StrokePoint, StrokeWidth } from '@ketos/board-doc/types'

/** Tool the board's pointer gestures run; `select` keeps the pan and element gestures. */
export type BoardTool = 'select' | 'brush' | 'eraser'

/** Screen-pixel radius the eraser erases with at each thickness. */
export const ERASER_RADIUS_PX: Readonly<Record<StrokeWidth, number>> = { s: 6, m: 12, l: 24 }

/** One live stroke: absolute world points with the choices fixed at pointerdown. */
export interface BoardStrokeDraft {
  readonly points: readonly StrokePoint[]
  readonly width: StrokeWidth
  readonly pen: boolean
}

/**
 * Live eraser preview: the owner's strokes the pass touched (hidden while it
 * runs) and the remaining parts drawn in their place. Transient view state.
 */
export interface BoardEraserPreview {
  readonly hidden: readonly ElementId[]
  readonly parts: readonly BoardStrokeDraft[]
}
