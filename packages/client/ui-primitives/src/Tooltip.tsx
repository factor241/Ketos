/** Anchor-preserving tooltips; an optional body portal escapes clipping containers and stacking contexts that cap the bubble's z-index. */

import { cloneElement, createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { FocusEventHandler, MouseEventHandler, MutableRefObject, ReactElement, Ref } from 'react'
import { createPortal } from 'react-dom'
import { useOptionalPopoverHost, usePopoverHost } from './PopoverHost.tsx'
import { ShortcutKeys } from './ShortcutKeys.tsx'
import { useDismissOnOutsidePointer } from './useDismissOnOutsidePointer.ts'
import css from './Tooltip.module.css'
// Tooltips take the wide answer — any key returns to the keyboard. Focus rings read the
// narrower `data-input-modality` attribute the same module publishes.
import { pointerModality } from './input-modality.ts'

/** Bubble placement relative to the anchor. */
export type TooltipSide = 'right' | 'bottom' | 'top'

/**
 * Suppression channel for enclosing tooltip and hover-card anchors: a visible
 * tooltip within an anchor withdraws the enclosing preview while its bubble is shown.
 */
export const TooltipSuppression = createContext<((suppressed: boolean) => void) | null>(null)

/** Props Tooltip injects into its anchor child; the child's own handlers are chained ahead of the tooltip's. */
interface AnchorProps {
  'aria-describedby'?: string | undefined
  ref?: Ref<HTMLElement> | undefined
  onMouseEnter?: MouseEventHandler | undefined
  onMouseLeave?: MouseEventHandler | undefined
  onClick?: MouseEventHandler | undefined
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

/** Scale a side's centering transform, keeping the edge that faces the anchor fixed. */
function scaledTransform(placement: TooltipSide, align: 'center' | 'end', scale: number): { transform: string; origin: string } {
  const translate = placement === 'right'
    ? 'translateY(-50%)'
    : placement === 'top'
      ? align === 'end' ? 'translate(-100%, -100%)' : 'translate(-50%, -100%)'
      : align === 'end' ? 'translateX(-100%)' : 'translateX(-50%)'
  const origin = placement === 'right'
    ? 'left center'
    : placement === 'top'
      ? align === 'end' ? 'bottom right' : 'bottom center'
      : align === 'end' ? 'top right' : 'top center'
  return { transform: `${translate} scale(${scale})`, origin }
}

/**
 * Attach a hover/focus tooltip to an anchor element.
 * @param props.label - bubble text, or a resolver evaluated only while visible; an empty string shows only shortcut keys.
 * @param props.shortcutKeys - effective key labels rendered as platform-formatted keycaps after optional text.
 * @param props.side - placement relative to the anchor (default 'right').
 * @param props.align - horizontal anchor-edge alignment for 'bottom'/'top' bubbles: 'end' pins
 * the bubble's right edge to the anchor's (for anchors beside other hover surfaces the centered
 * bubble would overlap); default 'center'. Ignored for side 'right'.
 * @param props.portal - render the bubble under document.body, so an ancestor's clipping or its
 * stacking context (which confines the bubble's z-index to that context) cannot hide it.
 * @param props.delayMs - hover delay in milliseconds (default 0).
 * @param props.focusDelayMs - keyboard focus delay in milliseconds (default 0); blur, click,
 * mouse leave, disabling, and unmount cancel a pending show.
 * @param props.gap - anchor-to-bubble distance in pixels for 'bottom'/'top' bubbles (default 8);
 * ignored for side 'right'.
 * @param props.disabled - suppress the bubble while true; the anchor renders identically so
 * toggling never remounts it (which would cut its CSS transitions).
 * @param props.maxWidth - bubble width cap in pixels, for labels long enough that the default
 * half-viewport cap would render a slab wider than the surface the anchor sits on.
 * @param props.openOnClick - clicking also pins the bubble for reading; another click, Escape,
 * Tab, or an outside pointerdown dismisses it. Defaults to false for ordinary action tooltips.
 * @param props.children - a single anchor element; its own ref (callback or object) is forwarded alongside the tooltip's.
 * @returns the cloned anchor plus a fixed-position bubble, portaled through the nearest
 * PopoverHost (document.body without a provider) whenever one is mounted, so a transformed
 * ancestor's canvas cannot reposition it.
 * The bubble stays hidden until ResizeObserver supplies its size for boundary fitting; clicking the
 * anchor dismisses the bubble unless openOnClick is enabled, and focus arriving after a pointer
 * interaction (a closing menu refocusing its trigger) never raises it.
 */
export function Tooltip({ label, shortcutKeys, side = 'right', align = 'center', delayMs = 0, focusDelayMs = 0, gap = 8, disabled = false, portal = false, maxWidth, openOnClick = false, children }: { label: TooltipLabel; shortcutKeys?: readonly string[] | undefined; side?: TooltipSide; align?: 'center' | 'end'; delayMs?: number; focusDelayMs?: number; gap?: number; disabled?: boolean; portal?: boolean; maxWidth?: number; openOnClick?: boolean; children: ReactElement<AnchorProps> }) {
  const id = useId()
  const [pinned, setPinned] = useState(false)
  const anchor = useRef<HTMLElement | null>(null)
  // React 18 keeps the element's ref outside props; forward it so wrapping an
  // anchor in Tooltip never silently severs the owner's ref.
  const childRef = (children as ReactElement<AnchorProps> & { ref?: Ref<HTMLElement> }).ref
  const mergedRef = useCallback((el: HTMLElement | null) => {
    anchor.current = el
    if (typeof childRef === 'function') childRef(el)
    else if (childRef != null) (childRef as MutableRefObject<HTMLElement | null>).current = el
  }, [childRef])
  const host = usePopoverHost()
  const provider = useOptionalPopoverHost()
  // A mounted PopoverHost (the board canvas) supplies the screen-space container
  // and boundary; there the bubble must always leave its transformed ancestor.
  const portaled = portal || provider !== null
  // The anchor's edges rather than final coordinates: a vertical flip has to
  // re-derive the bubble's own top from the opposite edge.
  const [pos, setPos] = useState<{ x: number; top: number; bottom: number } | null>(null)
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
    : side === 'right'
      ? pos.top + (pos.bottom - pos.top) / 2
      : side === 'top' ? pos.top - gap : pos.bottom + gap
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Hover and focus are independent triggers: the bubble hides only after
  // BOTH clear (hovering away from a focused anchor must not drop it).
  const triggers = useRef({ hover: false, focus: false })

  // A nested tooltip's bubble owns the pointer position, so this tooltip
  // withdraws its own while a descendant shows one; the state below is set by
  // the descendants this tooltip wraps. Announcing on every visibility change
  // covers hide, disable, and unmount; show() also announces synchronously so
  // a nested pair shown in one commit never paints both bubbles.
  const suppressAncestors = useContext(TooltipSuppression)
  const [suppressed, setSuppressed] = useState(false)
  const announce = useCallback((active: boolean) => { suppressAncestors?.(active) }, [suppressAncestors])
  const visible = pos !== null && !disabled

  // Disabling mid-hover (e.g. clicking a rail control expands the sidebar)
  // must drop an already-visible bubble: no mouseleave fires.
  const cancelShow = useCallback(() => {
    if (showTimer.current === null) return
    clearTimeout(showTimer.current)
    showTimer.current = null
  }, [])
  const withdraw = useCallback(() => {
    setPinned(false)
    bubbleOpen.current = false
    setPos(null)
    announce(false)
  }, [announce])
  /** Drop the bubble and clear both triggers: the anchor can no longer host it. */
  const dismiss = useCallback(() => {
    cancelShow()
    triggers.current = { hover: false, focus: false }
    withdraw()
  }, [cancelShow, withdraw])

  // ResizeObserver supplies the laid-out border box; fitting never reads
  // geometry after a position write or needs a React commit to flip sides.
  // Under a mounted PopoverHost every signal re-reads the anchor, so the
  // bubble follows a pan or zoom instead of keeping the coordinates captured
  // on show, and it slides inside the host boundary measured from the rendered
  // box. Without a provider the browser defaults apply and the captured anchor
  // position is trusted; fitting stays size-only off the captured edges.
  useLayoutEffect(() => {
    const el = bubble.current
    if (pos === null || !visible || suppressed || el === null) return
    const edgeMargin = 12
    const hosted = provider !== null
    let size: ResizeObserverSize | undefined
    let placement = side
    const fit = () => {
      // A queued fit must never resurrect a bubble a leave just dropped.
      if (!bubbleOpen.current) return
      const anchorEl = anchor.current
      /* v8 ignore next -- pos is set only while the bubble and its anchor are mounted. */
      if (anchorEl === null) return
      // A geometry signal (pan, zoom, layout, or the bubble collapsing with a
      // hidden container) is also the moment to notice that the anchor stopped
      // rendering: its bubble must not outlive it.
      if (!anchorVisible(anchorEl)) {
        dismiss()
        return
      }
      const b = host.boundary()
      const scale = host.scale
      let x = pos.x
      let top = pos.top
      let bottom = pos.bottom
      if (hosted) {
        const a = anchorEl.getBoundingClientRect()
        x = side === 'right' ? a.right + 10 : align === 'end' ? a.right : a.left + a.width / 2
        top = a.top
        bottom = a.bottom
        // Only a real anchor move schedules a render: a same-value update still
        // costs one render pass, which would re-resolve a lazy label.
        if (pos.x !== x || pos.top !== top || pos.bottom !== bottom) setPos({ x, top, bottom })
      }
      if (!hosted) {
        if (size === undefined) return
        const width = size.inlineSize * scale
        const height = size.blockSize * scale
        const offset = side === 'right' ? 0 : align === 'end' ? width : width / 2
        const left = Math.max(b.left + edgeMargin, Math.min(x - offset, b.right - edgeMargin - width))
        // Flip only into a side that genuinely fits, so an anchor with room on
        // neither side keeps the requested placement instead of oscillating.
        const fitsBelow = bottom + gap + height <= b.bottom - edgeMargin
        const fitsAbove = top - gap - height >= b.top + edgeMargin
        if (placement === 'bottom' && !fitsBelow && fitsAbove) placement = 'top'
        else if (placement === 'top' && !fitsAbove && fitsBelow) placement = 'bottom'
        el.style.left = `${left + offset}px`
        el.style.top = `${placement === 'right' ? (top + bottom) / 2
          : placement === 'top' ? top - gap : bottom + gap}px`
      } else {
        // Reset the base position first, then clamp from the rendered box (its
        // scale included): a shorter label or a larger boundary releases a
        // previous adjustment without another render.
        el.style.left = `${x}px`
        el.style.top = `${placement === 'right' ? (top + bottom) / 2
          : placement === 'top' ? top - gap : bottom + gap}px`
        const r = el.getBoundingClientRect()
        let dx = 0
        if (r.right > b.right - edgeMargin) dx = b.right - edgeMargin - r.right
        if (r.left + dx < b.left + edgeMargin) dx = b.left + edgeMargin - r.left
        el.style.left = `${x + dx}px`
        if (side !== 'right') {
          const fitsBelow = bottom + gap + r.height <= b.bottom - edgeMargin
          const fitsAbove = top - gap - r.height >= b.top + edgeMargin
          if (placement === 'bottom' && !fitsBelow && fitsAbove) placement = 'top'
          else if (placement === 'top' && !fitsAbove && fitsBelow) placement = 'bottom'
          el.style.top = `${placement === 'top' ? top - gap : bottom + gap}px`
        }
      }
      el.dataset.side = placement
      if (scale === 1) {
        el.style.transform = ''
        el.style.transformOrigin = ''
      } else {
        // Scaling about the edge that faces the anchor keeps the visual gap
        // constant while the label grows with the hosted surface.
        const scaled = scaledTransform(placement, align, scale)
        el.style.transform = scaled.transform
        el.style.transformOrigin = scaled.origin
      }
      el.style.visibility = 'visible'
    }
    const observer = new ResizeObserver((entries) => {
      size = entries[0]?.borderBoxSize[0]
      fit()
    })
    observer.observe(el, { box: 'border-box' })
    const unsubscribe = host.subscribe(fit)
    return () => {
      observer.disconnect()
      unsubscribe()
    }
  }, [align, dismiss, gap, host, pos, provider, side, suppressed, visible])
  useEffect(() => {
    announce(visible)
    return () => { announce(false) }
  }, [announce, visible])

  // The open bubble registers itself as the one the next show replaces; a
  // bubble that hides first leaves the registry empty. Nested tooltips are
  // excluded: their enclosing bubble withdraws through TooltipSuppression and
  // must return when the nested one hides, so a top-level show re-armed by the
  // same pointer event must not close them.
  useEffect(() => {
    if (pos === null || suppressAncestors !== null) return
    closeOpenTooltip = dismiss
    return () => { if (closeOpenTooltip === dismiss) closeOpenTooltip = null }
  }, [dismiss, pos, suppressAncestors])

  useEffect(() => {
    if (pinned && (disabled || !openOnClick)) setPinned(false)
    if (disabled) {
      cancelShow()
      triggers.current = { hover: false, focus: false }
      bubbleOpen.current = false
      setPos(null)
    }
    return cancelShow
  }, [cancelShow, disabled, openOnClick, pinned])

  const show = () => {
    if (disabled) return
    const el = anchor.current
    /* v8 ignore next -- the ref is attached by event time: events fire on the cloned anchor. */
    if (el === null || !anchorVisible(el)) return
    // One bubble at a time: a new anchor's bubble replaces the open one, so a
    // bubble whose own hide update never committed cannot linger beside it.
    // A nested tooltip leaves the enclosing bubble to TooltipSuppression.
    if (suppressAncestors === null) closeOpenTooltip?.()
    bubbleOpen.current = true
    const r = el.getBoundingClientRect()
    setPos({
      x: side === 'right' ? r.right + 10 : align === 'end' ? r.right : r.left + r.width / 2,
      top: r.top,
      bottom: r.bottom,
    })
    announce(true)
  }
  const showAfterDelay = (delay: number) => {
    cancelShow()
    if (delay <= 0) {
      show()
      return
    }
    showTimer.current = setTimeout(() => {
      showTimer.current = null
      show()
    }, delay)
  }
  const hide = () => {
    cancelShow()
    if (!triggers.current.hover && !triggers.current.focus && !pinned) withdraw()
  }
  useDismissOnOutsidePointer(anchor, openOnClick && visible, dismiss, bubble)
  useEffect(() => {
    if (!openOnClick || !visible) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Tab') return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation() }
      dismiss()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => { document.removeEventListener('keydown', onKeyDown, true) }
  }, [dismiss, openOnClick, visible])

  const content = visible && !suppressed && (
    <span
      ref={bubble}
      id={openOnClick ? id : undefined}
      className={css.bubble}
      data-side={side}
      data-portal={portaled || undefined}
      data-pinned={pinned || undefined}
      data-align={align}
      data-has-shortcut={shortcutKeys?.length ? true : undefined}
      style={{ left: pos.x, top: y, visibility: 'hidden', ...maxWidth === undefined ? {} : { maxWidth } }}
      role="tooltip"
      aria-label={shortcutKeys?.length ? [resolvedLabel, shortcutKeys.join(' ')].filter(Boolean).join(' ') : undefined}
    >
      {resolvedLabel && <span className={css.label}>{resolvedLabel}</span>}
      {shortcutKeys !== undefined && shortcutKeys.length > 0 && <ShortcutKeys keys={shortcutKeys} variant="tooltip" />}
    </span>
  )

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
      if (!pinned) dismiss()
    }
    document.addEventListener('pointermove', onPointerMove, true)
    return () => { document.removeEventListener('pointermove', onPointerMove, true) }
  }, [cancelShow, dismiss, pinned, pos])

  return (
    <TooltipSuppression.Provider value={setSuppressed}>
      {cloneElement(children, {
        ref: mergedRef,
        'aria-describedby': openOnClick && visible
          ? [children.props['aria-describedby'], id].filter(Boolean).join(' ')
          : children.props['aria-describedby'],
        onMouseEnter: (e) => { children.props.onMouseEnter?.(e); triggers.current.hover = true; showAfterDelay(delayMs) },
        onMouseLeave: (e) => { children.props.onMouseLeave?.(e); triggers.current.hover = false; cancelShow(); if (!pinned) withdraw() },
        // Activating an ordinary action dismisses the bubble: it often changes
        // what the anchor now does (pin → unpin), and the click leaves the
        // anchor focused, which would otherwise pin the relabelled bubble up.
        onClick: (e) => {
          children.props.onClick?.(e)
          triggers.current.focus = false
          cancelShow()
          if (openOnClick && !disabled && !pinned) { setPinned(true); show() }
          else withdraw()
        },
        onFocus: (e) => {
          children.props.onFocus?.(e)
          if (pointerModality()) return
          triggers.current.focus = true
          showAfterDelay(focusDelayMs)
        },
        onBlur: (e) => { children.props.onBlur?.(e); triggers.current.focus = false; hide() },
      })}
      {portaled ? (content !== false && createPortal(content, host.container)) : content}
    </TooltipSuppression.Provider>
  )
}
