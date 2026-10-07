/**
 * Body of a `stroke` element: the stored relative points drawn as one
 * owner-colored freehand path with the thickness the data stores.
 *
 * The frame's rectangle is transparent to pointers so a large stroke never
 * intercepts panning from its empty parts; the highlighted path and an
 * invisible thickened axis over the points are what accept a click or drag.
 * Data that fails the kind's decoder falls back to the neutral body instead of
 * rendering a half-valid drawing.
 */
import { useMemo } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { parseStrokeData } from '@ketos/board-doc/data'
import { participantLabel, participantOf } from '../owners.ts'
import type { BoardStoreHandle } from '../store.ts'
import { strokeAxisPath, strokeToSvgPath } from '../stroke-path.ts'
import { NeutralElementBody } from './NeutralElementBody.tsx'
import css from './StrokeElement.module.css'

/** Screen-pixel width of the invisible hit axis the body offers for a click or drag. */
const HIT_AXIS_SCREEN_WIDTH = 12

export type StrokeElementProps =
  PropsRuntime<'board.element.body', 'stroke'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>

export function StrokeElement({ element, useStore, t }: StrokeElementProps) {
  const limits = useStore(s => s.boardLimits)
  const zoom = useStore(s => s.zoom)
  const selfId = useStore(s => s.selfId)
  // The parse result is a fresh object per call, so it is memoized by the
  // stored data it derived from; the path module then memoizes by this object,
  // which keeps a pan or zoom from recomputing the outline.
  const data = useMemo(
    () => limits === null
      ? null
      : parseStrokeData(element.data, limits, { w: element.w, h: element.h }),
    [element.data, element.w, element.h, limits],
  )
  if (data === null) return <NeutralElementBody element={element} t={t} />
  const participant = participantOf({ selfId }, element.ownerId)
  return (
    <svg
      data-board-stroke=""
      role="img"
      aria-label={t('stroke.aria', { name: participantLabel(t, participant) })}
      className={css.stroke}
      overflow="visible"
      pointerEvents="none"
    >
      <path
        data-board-stroke-outline=""
        d={strokeToSvgPath(data)}
        fill="var(--board-owner-edge)"
        pointerEvents="visibleFill"
      />
      <path
        data-board-stroke-axis=""
        d={strokeAxisPath(data.points)}
        fill="none"
        stroke="transparent"
        strokeWidth={HIT_AXIS_SCREEN_WIDTH / zoom}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="stroke"
      />
    </svg>
  )
}
