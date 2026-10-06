/**
 * Common frame of every board element: the owner-colored edge, single-element
 * selection, drag-to-move for the owner, and the bottom-right resize corner
 * for kinds that allow it. A foreign element selects but offers neither the
 * handles nor a drag.
 *
 * The gesture previews locally and commits exactly one operation on pointerup:
 * a drag under the 5 px threshold is a click, and every committed coordinate
 * snaps to the board grid unless Alt is held, like a window gesture.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import type { BoardElement, ElementId } from '@ketos/board-doc/types'
import type { OwnerColorAttr } from '../owners.ts'
import { resizeStep } from '../resize.ts'
import { snapPosition } from '../store.ts'
import { BOARD_ELEMENT_KIND_DESCRIPTORS } from '../board-element-kinds.ts'
import css from './ElementFrame.module.css'

/** Pointer travel below which a press is a click, not a drag. */
const DRAG_THRESHOLD_PX = 5

/** One in-flight gesture over an element. */
type ElementGesture =
  | {
    readonly kind: 'move'
    readonly pointerId: number
    readonly startClientX: number
    readonly startClientY: number
    readonly startX: number
    readonly startY: number
    moved: boolean
  }
  | {
    readonly kind: 'resize'
    readonly pointerId: number
    readonly startClientX: number
    readonly startClientY: number
    readonly startWidth: number
    readonly startHeight: number
  }

/** One previewed box while a gesture runs. */
interface ElementBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** Props of one element frame. */
export interface ElementFrameProps {
  /** The element this frame draws. */
  readonly element: BoardElement
  /** Whether this element is the one selected element. */
  readonly selected: boolean
  /** Whether the acting participant owns the element. */
  readonly editable: boolean
  /** Palette attribute the frame's edge reads. */
  readonly ownerColor: OwnerColorAttr
  /** Board zoom the gesture divides its pointer deltas by. */
  readonly zoom: number
  /** Accessible name of the frame. */
  readonly label: string
  /** Accessible name of the resize corner. */
  readonly resizeLabel: string
  /** Select this element. */
  readonly onSelect: (id: ElementId) => void
  /**
   * Open this element for in-place editing, when the kind has an editor. The
   * frame owns the gesture because its pointer capture retargets the derived
   * click and double-click events away from the body.
   */
  readonly onEdit?: ((id: ElementId) => void) | undefined
  /** Commit one move. */
  readonly onMove: (id: ElementId, x: number, y: number) => void
  /** Commit one resize. */
  readonly onResize: (id: ElementId, width: number, height: number) => void
  /** The body the element layer dispatched. */
  readonly children: ReactNode
}

export function ElementFrame({
  element, selected, editable, ownerColor, zoom, label, resizeLabel, onSelect, onEdit, onMove, onResize, children,
}: ElementFrameProps) {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const gesture = useRef<ElementGesture | null>(null)
  const previewRef = useRef<ElementBox | null>(null)
  const [preview, setPreviewState] = useState<ElementBox | null>(null)
  const descriptor = BOARD_ELEMENT_KIND_DESCRIPTORS[element.kind]

  /** Record and render one gesture preview. */
  const setPreview = (box: ElementBox | null): void => {
    previewRef.current = box
    setPreviewState(box)
  }

  const beginMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    onSelect(element.id)
    if (!editable || !descriptor.movable) return
    frameRef.current?.setPointerCapture(event.pointerId)
    gesture.current = {
      kind: 'move',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: element.x,
      startY: element.y,
      moved: false,
    }
  }

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation()
    onSelect(element.id)
    if (!editable || !descriptor.resizable) return
    frameRef.current?.setPointerCapture(event.pointerId)
    gesture.current = {
      kind: 'resize',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: element.w,
      startHeight: element.h,
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const active = gesture.current
    if (active === null || active.pointerId !== event.pointerId) return
    const dx = (event.clientX - active.startClientX) / zoom
    const dy = (event.clientY - active.startClientY) / zoom
    if (active.kind === 'move') {
      if (!active.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      active.moved = true
      setPreview({
        x: snapPosition(active.startX + dx, !event.altKey),
        y: snapPosition(active.startY + dy, !event.altKey),
        w: element.w,
        h: element.h,
      })
      return
    }
    const box = resizeStep('se', {
      x: element.x,
      y: element.y,
      width: active.startWidth,
      height: active.startHeight,
    }, dx, dy, { proportional: false, snap: !event.altKey }, descriptor.minSize)
    setPreview({ x: box.x, y: box.y, w: box.width, h: box.height })
  }

  const endGesture = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const active = gesture.current
    if (active === null || active.pointerId !== event.pointerId) return
    gesture.current = null
    const committed = previewRef.current
    setPreview(null)
    if (committed === null) return
    if (active.kind === 'move') onMove(element.id, committed.x, committed.y)
    else onResize(element.id, committed.w, committed.h)
  }

  const box = preview ?? { x: element.x, y: element.y, w: element.w, h: element.h }
  return (
    <div
      ref={frameRef}
      data-board-element=""
      data-board-element-id={element.id}
      data-board-element-kind={element.kind}
      data-board-element-selected={selected ? '' : undefined}
      data-board-element-editable={editable ? '' : undefined}
      data-board-owner-color={ownerColor}
      role="group"
      aria-label={label}
      className={clsx(css.frame, selected && css.selected)}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onPointerDown={beginMove}
      onPointerMove={handlePointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onDoubleClick={(event) => {
        event.stopPropagation()
        if (editable) onEdit?.(element.id)
      }}
    >
      <div className={css.body}>{children}</div>
      {editable && descriptor.resizable && (
        <div
          data-board-element-handle="se"
          role="button"
          aria-label={resizeLabel}
          className={css.handle}
          onPointerDown={beginResize}
        />
      )}
    </div>
  )
}
