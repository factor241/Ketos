/**
 * Live brush stroke: the points sampled so far, drawn with the same path
 * construction as the committed element, so the line under the cursor is what
 * the document stores on pointerup. The draft is transient — it never enters
 * the store or the document.
 */
import { STROKE_SIZES, strokeBounds } from '@ketos/board-doc/data'
import type { StrokeData, StrokePoint, StrokeWidth } from '@ketos/board-doc/types'
import { strokeToSvgPath } from '../stroke-path.ts'
import type { OwnerColorAttr } from '../owners.ts'
import css from './StrokeDraft.module.css'

export interface StrokeDraftProps {
  /** Absolute world points sampled so far. */
  readonly points: readonly StrokePoint[]
  /** Thickness fixed at pointerdown. */
  readonly width: StrokeWidth
  /** Whether a pen drew the stroke; fixes the paint options. */
  readonly pen: boolean
  /** Owner palette slot the path paints with. */
  readonly ownerColor: OwnerColorAttr
  /** Marks the box as an eraser preview part instead of the live brush stroke. */
  readonly preview?: boolean
}

export function StrokeDraft({ points, width, pen, ownerColor, preview = false }: StrokeDraftProps) {
  const bounds = strokeBounds(points, STROKE_SIZES[width])
  const data: StrokeData = { points: bounds.points, width, pen }
  return (
    <svg
      data-board-stroke-draft={preview ? undefined : ''}
      data-board-eraser-preview={preview ? '' : undefined}
      data-board-owner-color={ownerColor}
      overflow="visible"
      className={css.draft}
      style={{ left: bounds.x, top: bounds.y, width: bounds.w, height: bounds.h }}
      pointerEvents="none"
    >
      <path d={strokeToSvgPath(data)} fill="var(--board-owner-edge)" />
    </svg>
  )
}
