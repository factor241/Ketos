/**
 * Shared shell of the dock's screen-space popovers: the outside-click close,
 * the anchored placement above the dock control, and Escape handling. The `+`
 * catalog's title prompt and the participants popover mount through it, so the
 * placement rule and the dismissal behavior exist once.
 */
import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type RefObject } from 'react'

/** What one dock popover receives from {@link useDockPopover}. */
export interface DockPopoverPlacement {
  /** Attach to the popover surface so outside clicks are measured against it. */
  readonly surfaceRef: RefObject<HTMLDivElement>
  /** Screen placement above the anchor, inside the boundary, at the fixed width. */
  readonly style: CSSProperties
  /** Surface key handler: Escape closes the popover without bubbling. */
  readonly onKeyDown: (event: KeyboardEvent) => void
}

/**
 * Build the shared popover shell for one dock control.
 * @param anchor - screen rectangle of the control at open time.
 * @param boundary - screen rectangle the popover stays inside.
 * @param width - fixed popover width in screen pixels.
 * @param onClose - close without further work.
 * @returns the surface ref, placement, and key handler.
 */
export function useDockPopover(
  anchor: DOMRect,
  boundary: DOMRect,
  width: number,
  onClose: () => void,
): DockPopoverPlacement {
  const surfaceRef = useRef<HTMLDivElement>(null)

  // A click anywhere outside the popover closes it; Escape is handled on the
  // surface itself.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const node = surfaceRef.current
      if (node === null || event.target instanceof Node && node.contains(event.target)) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [onClose])

  const left = Math.min(
    Math.max(anchor.left, boundary.left),
    Math.max(boundary.left, boundary.right - width),
  )
  const style: CSSProperties = {
    left,
    bottom: window.innerHeight - anchor.top + 8,
    width,
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }
  return { surfaceRef, style, onKeyDown }
}
