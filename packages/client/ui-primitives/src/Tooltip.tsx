// Cloning the anchor preserves its layout context. The bubble always renders
// through the popover host: a fixed bubble left in place would be positioned
// against a transformed ancestor (the board canvas) instead of the viewport.

import { cloneElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FocusEventHandler, MouseEventHandler, MutableRefObject, ReactElement, Ref } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverHost } from './PopoverHost.tsx'
import css from './Tooltip.module.css'

/** Bubble placement relative to the anchor. */
export type TooltipSide = 'right' | 'bottom' | 'top'

/** Props Tooltip injects into its anchor child; the child's own handlers are chained ahead of the tooltip's. */
interface AnchorProps {
  ref?: Ref<HTMLElement> | undefined
  onMouseEnter?: MouseEventHandler | undefined
  onMouseLeave?: MouseEventHandler | undefined
  onFocus?: FocusEventHandler | undefined
  onBlur?: FocusEventHandler | undefined
}

type TooltipLabel = string | (() => string)

/** The one open tooltip's close function: a new show closes the previous bubble. */
let closeOpenTooltip: (() => void) | null = null

/**
 * Whether one anchor can carry a visible bubble right now: attached to the
 * document and rendering. A collapsed sidebar, a hidden panel, or a removed
 * anchor must never leave a portalled bubble behind.
 * @param el - the anchor element.
 * @returns whether the anchor is visible.
 */
function anchorVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false
  const checkVisibility = (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility
  if (typeof checkVisibility === 'function') return checkVisibility.call(el)
  // Engines without checkVisibility (jsdom included) have no layout: the
  // computed style is the only available signal.
  const style = getComputedStyle(el)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

/**
 * Attach a hover/focus tooltip to an anchor element.
 * @param props.label - bubble text, or a resolver evaluated only while the bubble is visible.
 * @param props.side - placement relative to the anchor (default 'right').
 * @param props.delayMs - hover delay in milliseconds; keyboard focus remains immediate.
 * @param props.disabled - suppress the bubble while true; the anchor renders identically so
 * toggling never remounts it (which would cut its CSS transitions).
 * @param props.maxWidth - bubble width cap in pixels, for labels long enough that the default
 * half-viewport cap would render a slab wider than the surface the anchor sits on.
 * @param props.children - a single anchor element; its own ref (callback or object) is forwarded alongside the tooltip's.
 * @returns the cloned anchor plus a bubble while hovered/focused, portaled into
 * the popover host's container at its scale and clamped to its boundary.
 */
export function Tooltip({ label, side = 'right', delayMs = 0, disabled = false, maxWidth, children }: { label: TooltipLabel; side?: TooltipSide; delayMs?: number; disabled?: boolean; maxWidth?: number; children: ReactElement<AnchorProps> }) {
  const host = usePopoverHost()
  const anchor = useRef<HTMLElement | null>(null)
  // React 18 keeps the element's ref outside props; forward it so wrapping an
  // anchor in Tooltip never silently severs the owner's ref.
  const childRef = (children as ReactElement<AnchorProps> & { ref?: Ref<HTMLElement> }).ref
  const mergedRef = useCallback((el: HTMLElement | null) => {
    anchor.current = el
    if (typeof childRef === 'function') childRef(el)
    else if (childRef != null) (childRef as MutableRefObject<HTMLElement | null>).current = el
  }, [childRef])
  // The anchor's edges rather than final coordinates: a vertical flip has to
  // re-derive the bubble's own top from the opposite edge.
  const [pos, setPos] = useState<{ x: number; top: number; bottom: number } | null>(null)
  // Where the bubble actually sits, which is the requested side until the
  // viewport refuses it.
  const [placement, setPlacement] = useState<TooltipSide>(side)
  const bubble = useRef<HTMLSpanElement | null>(null)
  // Whether this tooltip is the one that should be visible. A hide always
  // wins over a fit that was already queued in the same batch: without the
  // flag a geometry signal landing beside a leave would re-set the position
  // and the bubble would never close.
  const bubbleOpen = useRef(false)
  const resolvedLabel = pos === null
    ? null
    : typeof label === 'function' ? label() : label
  const y = pos === null
    ? 0
    : placement === 'right'
      ? pos.top + (pos.bottom - pos.top) / 2
      : placement === 'top' ? pos.top - 8 : pos.bottom + 8
  // Scaling about the edge that faces the anchor keeps the visual gap constant
  // while the label grows with the hosted surface. At scale 1 the stylesheet's
  // data-side transform stands alone.
  const sideTransform = placement === 'right'
    ? 'translateY(-50%)'
    : placement === 'top' ? 'translate(-50%, -100%)' : 'translateX(-50%)'
  const transformOrigin = placement === 'right' ? 'left center' : placement === 'top' ? 'bottom center' : 'top center'
  const EDGE_MARGIN = 12
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Hover and focus are independent triggers: the bubble hides only after
  // BOTH clear (hovering away from a focused anchor must not drop it).
  const triggers = useRef({ hover: false, focus: false })

  // Disabling mid-hover (e.g. clicking a rail control expands the sidebar)
  // must drop an already-visible bubble: no mouseleave fires.
  const cancelShow = useCallback(() => {
    if (showTimer.current === null) return
    clearTimeout(showTimer.current)
    showTimer.current = null
  }, [])
  /** Drop the bubble and clear both triggers: the anchor can no longer host it. */
  const hideNow = useCallback(() => {
    cancelShow()
    triggers.current = { hover: false, focus: false }
    bubbleOpen.current = false
    setPos(null)
  }, [cancelShow])

  // Fit against the host boundary: fixed positioning knows nothing about edges,
  // so a centered bubble near the right edge would clip and a long label under
  // an anchor low on the page would run off the bottom. Horizontally the bubble
  // slides back inside; vertically it flips to the opposite side, which is the
  // only move that does not cover the anchor being read. Every host signal
  // re-reads the anchor too, so the bubble follows a pan or zoom instead of
  // keeping the coordinates captured on show. Each measurement resets the base
  // position first, so a shorter label or a larger boundary releases a previous
  // adjustment without another render.
  useLayoutEffect(() => {
    if (pos === null) return
    const fit = () => {
      const el = bubble.current
      const anchorEl = anchor.current
      /* v8 ignore next -- pos is set only while the bubble and its anchor are mounted. */
      if (el === null || anchorEl === null) return
      // A queued fit must never resurrect a bubble a leave just dropped.
      if (!bubbleOpen.current) return
      // A host signal (pan, zoom, layout) is also the moment to notice that
      // the anchor stopped rendering: its bubble must not outlive it.
      if (!anchorVisible(anchorEl)) {
        hideNow()
        return
      }
      const a = anchorEl.getBoundingClientRect()
      const x = side === 'right' ? a.right + 10 : a.left + a.width / 2
      // Only a real anchor move schedules a render: a same-value update still
      // costs one render pass, which would re-resolve a lazy label.
      if (pos.x !== x || pos.top !== a.top || pos.bottom !== a.bottom) {
        setPos({ x, top: a.top, bottom: a.bottom })
      }
      el.style.left = `${x}px`
      const b = host.boundary()
      const r = el.getBoundingClientRect()
      let dx = 0
      if (r.right > b.right - EDGE_MARGIN) dx = b.right - EDGE_MARGIN - r.right
      if (r.left + dx < b.left + EDGE_MARGIN) dx = b.left + EDGE_MARGIN - r.left
      el.style.left = `${x + dx}px`
      if (side === 'right') return
      // Flip only into a side that genuinely fits, so an anchor with room on
      // neither side keeps the requested placement instead of oscillating.
      const fitsBelow = a.bottom + 8 + r.height <= b.bottom - EDGE_MARGIN
      const fitsAbove = a.top - 8 - r.height >= b.top + EDGE_MARGIN
      if (placement === 'bottom' && !fitsBelow && fitsAbove) setPlacement('top')
      if (placement === 'top' && !fitsAbove && fitsBelow) setPlacement('bottom')
    }
    fit()
    return host.subscribe(fit)
  }, [hideNow, host, placement, pos, resolvedLabel, side])

  // The open bubble registers itself as the one the next show replaces; a
  // bubble that hides first leaves the registry empty.
  useEffect(() => {
    if (pos === null) return
    closeOpenTooltip = hideNow
    return () => { if (closeOpenTooltip === hideNow) closeOpenTooltip = null }
  }, [hideNow, pos])

  // While the bubble is open, a collapsed container or a removed anchor must
  // take it down: neither mouseleave nor blur fires for an element that stops
  // rendering. Both observers re-check the anchor and close the bubble.
  useEffect(() => {
    if (pos === null) return
    const el = anchor.current
    /* v8 ignore next -- pos is set only while the anchor is attached. */
    if (el === null) return
    const check = (): void => { if (!anchorVisible(el)) hideNow() }
    const disposes: (() => void)[] = []
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(check)
      observer.observe(el)
      disposes.push(() => { observer.disconnect() })
    }
    if (typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver(check)
      observer.observe(el)
      disposes.push(() => { observer.disconnect() })
    }
    return () => { for (const dispose of disposes) dispose() }
  }, [hideNow, pos])
  useEffect(() => {
    if (disabled) hideNow()
    return cancelShow
  }, [cancelShow, disabled, hideNow])

  const show = () => {
    if (disabled) return
    const el = anchor.current
    /* v8 ignore next -- the ref is attached by event time: events fire on the cloned anchor. */
    if (el === null || !anchorVisible(el)) return
    // One bubble at a time: a new anchor's bubble replaces the open one, so a
    // bubble whose own hide update never committed cannot linger beside it.
    closeOpenTooltip?.()
    bubbleOpen.current = true
    const r = el.getBoundingClientRect()
    // Every show starts from the requested side; the fit pass flips it only
    // where this anchor's position demands it.
    setPlacement(side)
    setPos({ x: side === 'right' ? r.right + 10 : r.left + r.width / 2, top: r.top, bottom: r.bottom })
  }
  const showAfterHoverDelay = () => {
    cancelShow()
    if (delayMs <= 0) {
      show()
      return
    }
    showTimer.current = setTimeout(() => {
      showTimer.current = null
      show()
    }, delayMs)
  }
  const hide = () => {
    cancelShow()
    if (!triggers.current.hover && !triggers.current.focus) setPos(null)
  }

  // Hover state cannot rely on mouseleave alone: an anchor that relocates under
  // a still pointer (a window mode flip, a layout change) never receives one,
  // and the bubble would stay forever. While the bubble is visible, a pointer
  // move whose target is outside the anchor clears hover exactly like a leave
  // would; moving over another tooltip's anchor closes this one too.
  useEffect(() => {
    if (pos === null) return
    const onPointerMove = (event: PointerEvent): void => {
      /* v8 ignore next -- the anchor ref is attached whenever the bubble renders. */
      if (anchor.current !== null && event.target instanceof Node && anchor.current.contains(event.target)) return
      triggers.current.hover = false
      cancelShow()
      bubbleOpen.current = false
      setPos(null)
    }
    document.addEventListener('pointermove', onPointerMove, true)
    return () => { document.removeEventListener('pointermove', onPointerMove, true) }
  }, [cancelShow, pos])

  return (
    <>
      {cloneElement(children, {
        ref: mergedRef,
        onMouseEnter: (e) => { children.props.onMouseEnter?.(e); triggers.current.hover = true; showAfterHoverDelay() },
        onMouseLeave: (e) => {
          children.props.onMouseLeave?.(e)
          triggers.current.hover = false
          cancelShow()
          bubbleOpen.current = false
          setPos(null)
        },
        onFocus: (e) => { children.props.onFocus?.(e); triggers.current.focus = true; cancelShow(); show() },
        onBlur: (e) => { children.props.onBlur?.(e); triggers.current.focus = false; hide() },
      })}
      {pos !== null && createPortal(
        <span
          ref={bubble}
          className={css.bubble}
          data-side={placement}
          style={{
            left: pos.x,
            top: y,
            ...host.scale === 1 ? {} : { transform: `${sideTransform} scale(${host.scale})`, transformOrigin },
            ...maxWidth === undefined ? {} : { maxWidth },
          }}
          role="tooltip"
        >
          {resolvedLabel}
        </span>,
        host.container,
      )}
    </>
  )
}
