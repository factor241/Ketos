/**
 * Common frame of every board element: the owner-colored edge, single-element
 * selection, drag-to-move for the owner, and the bottom-right resize corner
 * for kinds that allow it. A foreign element selects but offers neither the
 * handles nor a drag.
 *
 * The frame and the corner are in the tab order: focusing the frame selects the
 * element, and the arrow keys on the corner resize by one grid step.
 *
 * The gesture previews locally and commits exactly one operation on pointerup:
 * a drag under the 5 px threshold is a click, and every committed coordinate
 * snaps to the board grid unless Alt is held, like a window gesture. Only the
 * primary button starts a gesture; pointercancel or a lost pointer capture
 * discards it without an operation.
 */
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BoardElement, ElementId } from '@ketos/board-doc/types'
import type { OwnerColorAttr } from '../owners.ts'
import { resizeStep } from '../resize.ts'
import { GRID_STEP, snapPosition } from '../store.ts'
import { isBoardEditingTarget } from '../editing-target.ts'
import { BOARD_ELEMENT_KIND_DESCRIPTORS } from '../board-element-kinds.ts'
import css from './ElementFrame.module.css'

/** Pointer travel in screen pixels below which a press is a click, not a drag. */
const DRAG_THRESHOLD_PX = 5

/** Arrow keys of the resize corner and the grid steps (width, height) each applies. */
const ARROW_RESIZE: Readonly<Record<string, { readonly dx: number; readonly dy: number } | undefined>> = {
  ArrowRight: { dx: 1, dy: 0 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowUp: { dx: 0, dy: -1 },
}

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
  /** Stale-data badge text; absent renders no badge (an owner in good standing). */
  readonly staleLabel?: string | undefined
  /** Tooltip of the stale-data badge. */
  readonly staleHint?: string | undefined
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
  element, selected, editable, ownerColor, zoom, label, resizeLabel, staleLabel, staleHint, onSelect, onEdit, onMove,
  onResize, children,
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
    // Only the primary button selects and drags; the middle button pans the
    // board and the secondary button opens no gesture.
    if (event.button !== 0) return
    onSelect(element.id)
    // A press inside a text editor places the caret or extends the selection.
    if (isBoardEditingTarget(event.target)) return
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
    // Like the move, only the primary button resizes: the secondary button's
    // context menu swallows the pointerup that would end the gesture.
    if (event.button !== 0) return
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

  /** One grid step of arrow-key resizing from the focused corner. */
  const handleResizeKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = ARROW_RESIZE[event.key]
    if (step === undefined) return
    event.preventDefault()
    event.stopPropagation()
    const box = resizeStep('se', {
      x: element.x,
      y: element.y,
      width: element.w,
      height: element.h,
    }, step.dx * GRID_STEP, step.dy * GRID_STEP, { proportional: false, snap: true }, descriptor.minSize)
    onResize(element.id, box.width, box.height)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const active = gesture.current
    if (active === null || active.pointerId !== event.pointerId) return
    const screenDx = event.clientX - active.startClientX
    const screenDy = event.clientY - active.startClientY
    const dx = screenDx / zoom
    const dy = screenDy / zoom
    if (active.kind === 'move') {
      if (!active.moved && Math.hypot(screenDx, screenDy) < DRAG_THRESHOLD_PX) return
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

  /**
   * Drop the gesture and its preview without an operation: the browser took
   * the pointer (pointercancel) or the frame lost its capture before pointerup.
   */
  const cancelGesture = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const active = gesture.current
    if (active === null || active.pointerId !== event.pointerId) return
    gesture.current = null
    setPreview(null)
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
      tabIndex={0}
      className={clsx(css.frame, selected && css.selected)}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onFocus={(event) => {
        // Keyboard focus on the frame selects it; focus inside the body (an
        // editor, a checkbox) leaves the selection to the pointer path.
        if (event.target === event.currentTarget) onSelect(element.id)
      }}
      onPointerDown={beginMove}
      onPointerMove={handlePointerMove}
      onPointerUp={endGesture}
      onPointerCancel={cancelGesture}
      onLostPointerCapture={cancelGesture}
      onDoubleClick={(event) => {
        event.stopPropagation()
        if (editable) onEdit?.(element.id)
      }}
    >
      {staleLabel !== undefined && (
        <Tooltip label={staleHint ?? staleLabel} side="top">
          <span data-board-stale="" className={css.stale} tabIndex={0}>{staleLabel}</span>
        </Tooltip>
      )}
      <div className={css.body}>{children}</div>
      {editable && descriptor.resizable && (
        <div
          data-board-element-handle="se"
          role="button"
          aria-label={resizeLabel}
          tabIndex={0}
          className={css.handle}
          onPointerDown={beginResize}
          onKeyDown={handleResizeKey}
        />
      )}
    </div>
  )
}
