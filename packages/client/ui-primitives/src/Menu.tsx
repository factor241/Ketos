import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { IconCheckOutline16 } from './icons/index.tsx'
import { usePointerGrace } from './pointer-grace.ts'
import { usePopoverHost } from './PopoverHost.tsx'
import css from './Menu.module.css'

/** Selectable row (optionally with a nested submenu). */
export interface MenuItem {
  id: string
  label: ReactNode
  disabled?: boolean
  /** Leading icon (figma .Menu_cell gap 8). */
  icon?: ReactNode
  /** Destructive row: error-colored text/icon and danger hover fill. */
  danger?: boolean
  /**
   * Nested card for this row. It renders through the popover host beside the
   * row, opening right or left and below or above depending on room.
   */
  submenu?: readonly MenuItem[]
}

/** Hairline between item groups (not selectable). */
export interface MenuSeparator {
  type: 'separator'
  id: string
}

/** Non-interactive heading row above a group of items. */
export interface MenuLabel {
  type: 'label'
  id: string
  text: string
}

/** One primary-menu entry: a row, a separator, or a heading label. */
export type MenuEntry = MenuItem | MenuSeparator | MenuLabel

function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return 'type' in entry && entry.type === 'separator'
}

function isLabel(entry: MenuEntry): entry is MenuLabel {
  return 'type' in entry && entry.type === 'label'
}

/** Unplaced portal element: hidden but laid out at a fixed origin so offsetWidth/offsetHeight are real. */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/** Distance kept between a menu card and each host-boundary edge. */
const MARGIN = 12

/** Horizontal gap the pointer crosses between a row and its portaled submenu. */
const SUBMENU_GAP = 4

/**
 * Whether an anchor measured this frame lies entirely outside the host
 * boundary. Such a trigger dismisses the list instead of clamping an orphaned
 * card onto the board; a zero-size rect (jsdom, `display: none`) is not a
 * measurement and never dismisses.
 * @param anchor - the anchor's screen-pixel rectangle.
 * @param boundary - the host boundary to test against.
 * @returns whether the anchor is outside the boundary.
 */
function anchorOutsideBoundary(anchor: DOMRect, boundary: DOMRect): boolean {
  if (anchor.width <= 0 || anchor.height <= 0) return false
  return anchor.right <= boundary.left
    || anchor.left >= boundary.right
    || anchor.bottom <= boundary.top
    || anchor.top >= boundary.bottom
}

/** Chosen submenu side: horizontal position first, then vertical. */
type SubmenuPlacement = 'right-bottom' | 'right-top' | 'left-bottom' | 'left-top'

/**
 * Render an anchored dropdown menu.
 * @param props.autoFocus - focus the first item on open and enable arrow-key navigation; Escape focuses the anchor's first button.
 * @param props.open - whether the list is showing (owner-controlled).
 * @param props.anchor - the trigger element (rendered in place).
 * @param props.items - selectable rows and optional separators.
 * @param props.selectedId - row shown as selected.
 * @param props.selectedIds - rows shown as selected when a menu contains independent option groups.
 * @param props.onSelect - row click callback (not called for disabled rows or submenu parents that only open children).
 * @param props.onClose - invoked on outside click, Escape, a window blur that
 * moved focus into an iframe (the only signal a pointerdown inside a
 * cross-origin iframe leaves), or the anchor leaving the host boundary (the
 * only signal a host gesture that moved the trigger out of the board leaves).
 * @param props.align - list alignment against the anchor (default 'start').
 * @param props.side - open below (`bottom`, default) or above (`top`) the anchor.
 * @param props.portal - render the list into the popover host's container at
 * its scale, positioned from the anchor rect and clamped to its boundary
 * (repositions on every host signal while open). Without a provider the host
 * is `document.body` at scale 1 inside the browser window; default false
 * keeps the pure-CSS in-place behavior.
 * @param props.closeOnPointerLeave - close the list once the pointer has left
 * both trigger and list for the pointer grace (default false keeps it open
 * until outside click/Escape/selection). The grace makes the 4px trigger->list
 * gap and a brief overshoot survivable; coming back cancels the close.
 * @param props.dense - reduce vertical row spacing without changing the standard typography or card width.
 * @param props.compact - use reduced menu typography and spacing.
 * @param props.getAnchorRect - portal mode only: supply the anchor rect
 * directly (e.g. from a host-owned trigger button) instead of measuring the
 * Menu's own wrapper span. Required when the wrapper isn't itself laid out at
 * the trigger (render-prop anchors, effect-positioned proxies — measuring the
 * wrapper there races the host's layout effects). Called on open and on every
 * host geometry signal; return null to hide the list for that frame.
 * @param props.footer - rows pinned below the scrolling items area, separated
 * by a hairline; they stay visible while the items above scroll.
 * @param props.selection - how a selected row is marked: a trailing check
 * (`'check'`, default — figma .Menu_cell) or the hover fill held on the row
 * with no check (`'fill'`, for icon-labelled rows where a trailing glyph
 * crowds the cell).
 * @returns anchor wrapper with the conditional list and submenu portals.
 */
export function Menu({ open, anchor, items, selectedId, selectedIds, onSelect, onClose, align = 'start', side = 'bottom', portal = false, closeOnPointerLeave = false, dense = false, compact = false, autoFocus = false, selection = 'check', getAnchorRect, footer, className }: {
  open: boolean
  autoFocus?: boolean
  anchor: ReactNode
  items: readonly MenuEntry[]
  footer?: readonly MenuEntry[]
  selectedId?: string | undefined
  selectedIds?: readonly string[] | undefined
  onSelect: (id: string) => void
  onClose: () => void
  align?: 'start' | 'end'
  side?: 'bottom' | 'top' | 'right'
  portal?: boolean
  closeOnPointerLeave?: boolean
  dense?: boolean
  compact?: boolean
  selection?: 'check' | 'fill'
  getAnchorRect?: () => DOMRect | null
  className?: string | undefined
}) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const submenuRowRef = useRef<HTMLDivElement | null>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const [openSubmenu, setOpenSubmenu] = useState<{ id: string; items: readonly MenuItem[] } | null>(null)
  const [fixedPos, setFixedPos] = useState<CSSProperties | null>(null)
  const [submenuPos, setSubmenuPos] = useState<CSSProperties | null>(null)
  const [submenuPlacement, setSubmenuPlacement] = useState<SubmenuPlacement>('right-bottom')
  const host = usePopoverHost()
  const { arm: armClose, cancel: cancelClose } = usePointerGrace(onClose)
  // The placement effect may outlive the render that passed `onClose` (it
  // re-runs only when its own dependencies change), so the dismissal reads the
  // latest callback instead of the captured one.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  // Portal mode: position the list from the anchor rect before paint; track the
  // anchor whenever the host reports changed geometry. getAnchorRect trumps
  // measuring the wrapper span: a child layout effect runs before the parent's,
  // so a wrapper the host positions in its own effect measures stale here — the
  // host callback owns the truth instead. The host reports screen pixels, so
  // the measured card is scaled before clamping: a visual box past the boundary
  // is clamped by its visual size, not its layout size.
  useLayoutEffect(() => {
    if (!open || !portal) { setFixedPos(null); return }
    const place = () => {
      let r: DOMRect | null
      if (getAnchorRect !== undefined) {
        r = getAnchorRect()
      } else {
        /* v8 ignore next 2 -- the ref is attached before the layout effect runs and the listeners die with it. */
        r = rootRef.current?.getBoundingClientRect() ?? null
      }
      if (r === null) { setFixedPos(null); return }
      const b = host.boundary()
      if (anchorOutsideBoundary(r, b)) {
        onCloseRef.current()
        setFixedPos(null)
        return
      }
      const listEl = listRef.current
      const lw = (listEl?.offsetWidth ?? 0) * host.scale
      const lh = (listEl?.offsetHeight ?? 0) * host.scale

      let x: number
      let y: number
      if (side === 'right') {
        x = r.right + 4
        y = r.top
      } else if (align === 'start') {
        x = r.left
        y = side === 'bottom' ? r.bottom + 4 : r.top - lh - 4
      } else {
        x = r.right - lw
        y = side === 'bottom' ? r.bottom + 4 : r.top - lh - 4
      }

      if (lw > 0) x = Math.min(Math.max(x, b.left + MARGIN), b.right - lw - MARGIN)
      if (lh > 0) y = Math.min(Math.max(y, b.top + MARGIN), b.bottom - lh - MARGIN)

      setFixedPos({ left: x, top: y, transform: `scale(${host.scale})`, transformOrigin: 'top left' })
    }
    // First run measures the hidden pre-render (same commit as `open`), so
    // end/top alignment and clamping use real dimensions before anything
    // paints — no visible jump from a zero-size first guess.
    place()
    return host.subscribe(place)
  }, [open, portal, align, side, getAnchorRect, host])

  // Submenu placement: the portaled card is positioned from the row's current
  // rect, opening toward whichever side has room inside the host boundary and
  // sliding inside when neither does.
  useLayoutEffect(() => {
    if (!open || openSubmenu === null) { setSubmenuPos(null); return }
    const place = () => {
      const row = submenuRowRef.current
      const el = submenuRef.current
      /* v8 ignore next -- both refs are attached before this layout effect runs. */
      if (row === null || el === null) return
      const r = row.getBoundingClientRect()
      const b = host.boundary()
      const sw = el.offsetWidth * host.scale
      const sh = el.offsetHeight * host.scale

      const rightX = r.right + SUBMENU_GAP
      const leftX = r.left - SUBMENU_GAP - sw
      let hSide: 'right' | 'left' = 'right'
      if (sw > 0 && rightX + sw > b.right - MARGIN && leftX >= b.left + MARGIN) hSide = 'left'
      let x = hSide === 'right' ? rightX : leftX
      if (sw > 0) x = Math.min(Math.max(x, b.left + MARGIN), b.right - sw - MARGIN)

      const fitsBelow = sh === 0 || r.top + sh <= b.bottom - MARGIN
      let vSide: 'bottom' | 'top' = 'bottom'
      if (!fitsBelow && r.bottom - sh >= b.top + MARGIN) vSide = 'top'
      let y = vSide === 'bottom' ? r.top : r.bottom - sh
      if (sh > 0) y = Math.min(Math.max(y, b.top + MARGIN), b.bottom - sh - MARGIN)

      setSubmenuPlacement(`${hSide}-${vSide}`)
      setSubmenuPos({ left: x, top: y })
    }
    place()
    return host.subscribe(place)
  }, [open, openSubmenu, host])

  useEffect(() => {
    if (open && autoFocus) listRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [open, autoFocus])

  useEffect(() => {
    if (!open) {
      setOpenSubmenu(null)
      return
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return
      // The portaled list and submenu are outside the anchor subtree; check each.
      if (rootRef.current?.contains(e.target) === true) return
      if (listRef.current?.contains(e.target) === true) return
      if (submenuRef.current?.contains(e.target) === true) return
      onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        if (autoFocus) rootRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
      }
      if (!autoFocus || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
      const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (index < 0) return
      e.preventDefault()
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
        : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next]?.focus()
    }
    // A pointerdown inside a cross-origin iframe (a sandboxed HTML preview)
    // never reaches this document; the focus move it causes blurs the window
    // instead. Only that case closes: an app or tab switch leaves the
    // document's focus where it was, so activeElement is not an iframe.
    const onWindowBlur = () => {
      if (document.activeElement instanceof HTMLIFrameElement) onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [open, onClose, autoFocus])

  // A close from selection/Escape/outside click outruns a pending grace close;
  // left armed it would shut a list reopened inside the grace window. Its own
  // effect, not the listener effect above: that one re-runs on every `onClose`
  // identity change and would cancel the grace mid-transit.
  useEffect(() => {
    if (!open) cancelClose()
  }, [open, cancelClose])

  // Height cap: the boundary reports screen pixels, so a scaled card divides by
  // the scale before the inline max-height applies. The footer stays pinned
  // below the scrolling items area.
  const boundary = host.boundary()
  const maxHeight = Math.max(0, (boundary.height - 2 * MARGIN) / (portal ? host.scale : 1))
  const submenuMaxHeight = Math.max(0, (boundary.height - 2 * MARGIN) / host.scale)

  const renderEntry = (entry: MenuEntry) => {
    if (isSeparator(entry)) {
      return <div key={entry.id} className={css.separator} role="separator" />
    }
    if (isLabel(entry)) {
      return <div key={entry.id} className={css.label} role="presentation">{entry.text}</div>
    }
    const submenuItems = entry.submenu !== undefined && entry.submenu.length > 0 ? entry.submenu : null
    const hasSub = submenuItems !== null
    const subOpen = hasSub && openSubmenu?.id === entry.id
    const openItems = subOpen ? submenuItems : null
    const selected = entry.id === selectedId || selectedIds?.includes(entry.id) === true
    return (
      <div
        key={entry.id}
        ref={subOpen ? submenuRowRef : undefined}
        className={css.itemWrap}
        // The submenu portal stays this wrapper's React child: React's
        // enter/leave traversal walks the React tree, so crossing the bridged
        // gap into the portaled card never counts as leaving the row.
        onMouseEnter={() => { setOpenSubmenu(hasSub ? { id: entry.id, items: submenuItems } : null) }}
        onMouseLeave={() => { if (hasSub) setOpenSubmenu(null) }}
      >
        <button
          type="button"
          role="menuitem"
          className={clsx(css.item, selected && (selection === 'fill' ? css.selectedFill : css.selected), entry.danger === true && css.danger)}
          disabled={entry.disabled}
          aria-haspopup={hasSub ? 'menu' : undefined}
          aria-expanded={hasSub ? subOpen : undefined}
          onFocus={() => { setOpenSubmenu(hasSub ? { id: entry.id, items: submenuItems } : null) }}
          onClick={() => {
            if (hasSub) {
              setOpenSubmenu({ id: entry.id, items: submenuItems })
              return
            }
            onSelect(entry.id)
          }}
        >
          {entry.icon !== undefined && <span className={css.itemIcon}>{entry.icon}</span>}
          <span className={css.itemLabel}>{entry.label}</span>
          {/* Selection marker is a trailing check (figma .Menu_cell) unless the fill mode carries it. */}
          {selected && selection === 'check' && <IconCheckOutline16 className={css.check} />}
        </button>
        {openItems !== null && createPortal(
          <div
            ref={submenuRef}
            className={clsx(css.submenu, compact && css.compactList)}
            style={{
              ...(submenuPos ?? MEASURE_STYLE),
              transform: `scale(${host.scale})`,
              transformOrigin: 'top left',
              maxHeight: submenuMaxHeight,
            }}
            role="menu"
            data-placement={submenuPlacement}
          >
            <div className={css.viewport} role="presentation">
              {openItems.map(sub => (
                <button
                  key={sub.id}
                  type="button"
                  role="menuitem"
                  className={css.item}
                  disabled={sub.disabled}
                  onClick={() => { onSelect(sub.id) }}
                >
                  {sub.icon !== undefined && <span className={css.itemIcon}>{sub.icon}</span>}
                  <span className={css.itemLabel}>{sub.label}</span>
                </button>
              ))}
            </div>
          </div>,
          host.container,
        )}
      </div>
    )
  }

  // Portal lists render hidden until placed: the placement effect measures
  // this pre-render in the same commit, so the first painted frame is
  // already at the final position (with getAnchorRect returning null the
  // list simply stays hidden).
  const list = open && (
    <div
      ref={listRef}
      className={clsx(css.list, dense && css.denseList, compact && css.compactList, portal && css.portal, side === 'top' && !portal && css.sideTop, align === 'end' && !portal && css.alignEnd)}
      style={{ ...(portal ? fixedPos ?? MEASURE_STYLE : undefined), maxHeight }}
      role="menu"
      // React portals bubble synthetic events through the REACT tree: without
      // this stop, an item click re-fires the anchor row's own onClick
      // (open/toggle) after onSelect.
      onClick={(e) => { e.stopPropagation() }}
    >
      <div className={css.viewport} role="presentation">
        {items.map(renderEntry)}
      </div>
      {footer !== undefined && footer.length > 0 && (
        <div className={css.footer} role="presentation">
          {footer.map(renderEntry)}
        </div>
      )}
    </div>
  )

  // Pointer-leave dismissal watches the WRAPPER, not the list: React's
  // enter/leave traversal runs over the React tree, so trigger, portaled list,
  // and portaled submenu are one region here. Aiming back at the trigger, or
  // crossing the 4px gap between them, therefore never counts as leaving.
  return (
    <span
      ref={rootRef}
      className={clsx(css.root, className)}
      onPointerEnter={closeOnPointerLeave ? cancelClose : undefined}
      onPointerLeave={closeOnPointerLeave ? () => { if (open) armClose() } : undefined}
    >
      {anchor}
      {portal ? (list !== false && createPortal(list, host.container)) : list}
    </span>
  )
}
