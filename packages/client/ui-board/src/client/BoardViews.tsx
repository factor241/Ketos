/**
 * React entry views for the Spatial Board slot registrations.
 *
 * The root owns the board's layer ladder: the canvas grid and its windows
 * (z-index 10–99, see `WINDOW_Z_MAX`), the floating chrome — dock, omnibar,
 * minimap — at 100, the active handle ring at 150, the screen-space popover
 * layer (tooltips and menus, see `BOARD_POPOVER_Z`) at 300, the
 * element-selection overlay at 500, and the fullscreen frame (with an overlay
 * chats panel) at 1000. An expanded chats panel and a fullscreen window stand
 * the floating chrome down, so no root-level layer can cover the panel's edge
 * or the fullscreen frame. `isolation: isolate` contains that ladder inside
 * the board box, so an app-level overlay above the box stays above every board
 * layer instead of losing hit-testing to the chrome.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import clsx from 'clsx'
import { BOARD_POPOVER_Z, type BoardStoreHandle } from './store.ts'
import { BoardPopoverSurfaceContext, type BoardPopoverSurface } from './board-popover.tsx'
import { BOARD_PANEL_ID } from './contract/slots.ts'
import { isBoardEditingTarget } from './editing-target.ts'
import { useBoardPointerGesture } from './pointer-gesture.ts'
import { startBoardPanGesture } from './pan-gesture.ts'
import { describeElement } from './element-capture.ts'
import { resolveChatWindow } from './open-window.ts'
import { ElementSelectionOverlay } from './ElementSelectionOverlay.tsx'
import { HandleRing } from './HandleRing.tsx'
import { classifyBoardZoomKey } from './keyboard-zoom.ts'
import { createBoardPinchGesture, type BoardPinchEvent } from './pinch.ts'
import { resolveBoardWheel, wheelPanDelta, wheelZoomFactor, type BoardWheelMode } from './wheel-zoom.ts'
import css from './BoardViews.module.css'

/** Wheel behavior the plugin Config injects into the board root. */
export interface BoardRootInjected {
  /** What an unmodified wheel does over the canvas and the floating chrome. */
  readonly wheelMode: BoardWheelMode
  /** Exponential zoom sensitivity `k` (`factor = exp(−Δ·k)`). */
  readonly zoomSensitivity: number
  /** Zoom below which windows render their simplified card (R-6). */
  readonly detailZoomThreshold: number
}

/** Props of the board main-panel body: the child render share, the store share, the injected runtime config, and the locale seat. */
export type BoardRootProps =
  PropsRuntime<'main'>
  & PropsRenderSlots<'board.canvas' | 'board.dock' | 'board.omnibar' | 'board.minimap'>
  & PropsStore<BoardStoreHandle>
  & InjectFace<BoardRootInjected>
  & PropsLocale<'board'>

/** How long the window the user returns to stays highlighted. */
const RETURN_HIGHLIGHT_MS = 1600

/** Read the Safari gesture fields from a DOM event the board's listener receives. */
function readPinchEvent(event: Event): BoardPinchEvent {
  const gesture = event as Event & BoardPinchEvent
  return { scale: gesture.scale, clientX: gesture.clientX, clientY: gesture.clientY }
}

/**
 * Board-root coordinates of a screen point: the wheel and the Safari pinch
 * share this mapping, so `zoomBy` anchors on the board root even when an
 * expanded sidebar offsets it from the viewport.
 * @param box - the board root's screen rectangle.
 * @param event - the event carrying screen-pixel client coordinates.
 * @returns the point in board-root pixels.
 */
function boardPoint(box: DOMRect, event: { readonly clientX: number; readonly clientY: number }): { x: number; y: number } {
  return { x: event.clientX - box.left, y: event.clientY - box.top }
}

export function BoardRoot({
  renderSlot, useStore, actions, t, usePanelInfo, wheelMode, zoomSensitivity, detailZoomThreshold,
}: BoardRootProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const pointerInsideRef = useRef(false)
  const spaceRef = useRef(false)
  const [panArmed, setPanArmed] = useState(false)
  const [boardRoot, setBoardRoot] = useState<HTMLDivElement | null>(null)
  const [popoverLayer, setPopoverLayer] = useState<HTMLDivElement | null>(null)
  // The elements exist one commit after mount, so the surface stays null until
  // both ref callbacks have run; consumers render without a host until then.
  const surface = useMemo<BoardPopoverSurface | null>(
    () => boardRoot === null || popoverLayer === null ? null : { layer: popoverLayer, root: boardRoot },
    [boardRoot, popoverLayer],
  )
  const captureRoot = useCallback((element: HTMLDivElement | null) => {
    rootRef.current = element
    setBoardRoot(element)
  }, [])
  const startGesture = useBoardPointerGesture()
  const panX = useStore(s => s.panX)
  const panY = useStore(s => s.panY)
  const selecting = useStore(s => s.isSelectingElement)
  const windows = useStore(s => s.windows)
  const activeWindowId = useStore(s => s.activeWindowId)
  // A fullscreen window fills the panel, so its chrome stands down. An open
  // chats panel is a management surface: the floating chrome would otherwise
  // cover its outer edge, its resize handle, or (in the overlay presentation)
  // the window's own bottom edge.
  const fullscreen = useStore(s => s.fullscreenWindowId !== null)
  // A collapsed panel is only its rail, so the chrome comes back.
  const panelOpen = useStore(s => s.panelWindowId !== null && !s.panelCollapsed)
  const activePanelId = usePanelInfo(info => info.activePanelId)
  const returnWindowId = useStore(s => s.returnWindowId)
  // The simplified view swaps the frames' contents; the ring's resize handles
  // stand down with the frame's own handles below the threshold (Д6.1).
  const simplified = useStore(s => s.zoom < detailZoomThreshold)

  // The lane sends the user to the main panel for a pending approval or
  // question; when the board panel comes back, the window they left from is
  // brought forward and highlighted briefly, so the return trip has a target.
  useEffect(() => {
    if (returnWindowId === null || activePanelId !== BOARD_PANEL_ID) return
    actions.centerOnWindow(returnWindowId)
    actions.clearReturnWindow()
    actions.setHighlightWindow(returnWindowId)
    const timer = window.setTimeout(() => { actions.setHighlightWindow(null) }, RETURN_HIGHLIGHT_MS)
    return () => { window.clearTimeout(timer) }
  }, [returnWindowId, activePanelId, actions])

  // Wheel and pinch decisions. React's `onWheel` is a passive listener, so
  // they log a preventDefault error through it; native non-passive listeners
  // on the root also cover the floating chrome, which sits beside the canvas
  // rather than inside it. A wheel over a window lane or an open chats panel
  // keeps its own scrolling unless ctrl/meta (a trackpad pinch) is held; a
  // plain wheel pans, or zooms in `wheelMode: 'zoom'` (R-4).
  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const pinch = createBoardPinchGesture((factor, clientX, clientY) => {
      const point = boardPoint(root.getBoundingClientRect(), { clientX, clientY })
      actions.zoomBy(factor, point.x, point.y)
    })
    const onWheel = (event: WheelEvent): void => {
      const decision = resolveBoardWheel(event, event.target, wheelMode, fullscreen)
      if (!decision.preventDefault) return
      event.preventDefault()
      // A browser reporting one pinch twice applies the gesture's ratio only.
      if (!decision.apply || (decision.classification === 'zoom' && pinch.active())) return
      const box = root.getBoundingClientRect()
      if (decision.classification === 'zoom') {
        const point = boardPoint(box, event)
        actions.zoomBy(wheelZoomFactor(event, box.height, zoomSensitivity), point.x, point.y)
        return
      }
      const pan = wheelPanDelta(event)
      actions.panBy(pan.x, pan.y)
    }
    // A fullscreen window fills the panel and is not part of the canvas, so its
    // Safari gesture blocks the page pinch exactly as its wheel zoom does:
    // preventDefault only, never `zoomBy` or a pinch-state change.
    const onGestureStart = (event: Event): void => {
      event.preventDefault()
      if (fullscreen) return
      pinch.start(readPinchEvent(event))
    }
    const onGestureChange = (event: Event): void => {
      event.preventDefault()
      if (fullscreen) return
      pinch.change(readPinchEvent(event))
    }
    const onGestureEnd = (event: Event): void => {
      event.preventDefault()
      if (fullscreen) return
      pinch.end()
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    root.addEventListener('gesturestart', onGestureStart)
    root.addEventListener('gesturechange', onGestureChange)
    root.addEventListener('gestureend', onGestureEnd)
    return () => {
      root.removeEventListener('wheel', onWheel)
      root.removeEventListener('gesturestart', onGestureStart)
      root.removeEventListener('gesturechange', onGestureChange)
      root.removeEventListener('gestureend', onGestureEnd)
    }
  }, [fullscreen, actions, wheelMode, zoomSensitivity])

  // Crisp text at rest (Д6.2): `will-change: transform` holds GPU
  // rasterization, so the surface keeps it only while a board gesture is live.
  // Pointer drags arm on the pointerdown anywhere in the board root (header
  // drags, resizes, panning) and disarm on the pointerup or cancel that ends
  // them; wheel and Safari gesture streams re-arm on every event and disarm on
  // a 150 ms trailing timer.
  useEffect(() => {
    const root = rootRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the board root renders unconditionally. */
    if (root === null) return
    let idle: number | undefined
    const arm = (): void => {
      if (idle !== undefined) {
        window.clearTimeout(idle)
        idle = undefined
      }
      root.dataset.boardGesture = ''
    }
    const schedule = (): void => {
      if (idle !== undefined) window.clearTimeout(idle)
      idle = window.setTimeout(() => {
        idle = undefined
        delete root.dataset.boardGesture
      }, 150)
    }
    const activity = (): void => { arm(); schedule() }
    const onPointerDown = (): void => { arm() }
    const onPointerEnd = (): void => { schedule() }
    root.addEventListener('pointerdown', onPointerDown, true)
    globalThis.addEventListener('pointerup', onPointerEnd, true)
    globalThis.addEventListener('pointercancel', onPointerEnd, true)
    root.addEventListener('wheel', activity, { passive: true })
    root.addEventListener('gesturestart', activity)
    root.addEventListener('gesturechange', activity)
    root.addEventListener('gestureend', activity)
    return () => {
      if (idle !== undefined) window.clearTimeout(idle)
      root.removeEventListener('pointerdown', onPointerDown, true)
      globalThis.removeEventListener('pointerup', onPointerEnd, true)
      globalThis.removeEventListener('pointercancel', onPointerEnd, true)
      root.removeEventListener('wheel', activity)
      root.removeEventListener('gesturestart', activity)
      root.removeEventListener('gesturechange', activity)
      root.removeEventListener('gestureend', activity)
    }
  }, [])

  // Space arms panning while the pointer is over the board — including over a
  // window, whose own gesture then stands down for the capture phase — and a
  // focused editor keeps the key. Cmd/Ctrl+0, +=, and − are board view
  // commands only while the pointer or focus is inside the board; everywhere
  // else the browser keeps its page zoom.
  useEffect(() => {
    const root = rootRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the board root renders unconditionally. */
    if (root === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      const command = classifyBoardZoomKey(event, pointerInsideRef.current || root.contains(document.activeElement))
      if (command !== null) {
        event.preventDefault()
        if (command.kind === 'reset') {
          actions.resetView()
          return
        }
        const box = root.getBoundingClientRect()
        actions.zoomBy(command.factor, box.width / 2, box.height / 2)
        return
      }
      if (event.code !== 'Space' || event.repeat || !pointerInsideRef.current) return
      if (isBoardEditingTarget(event.target)) return
      spaceRef.current = true
      setPanArmed(true)
      event.preventDefault()
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== 'Space') return
      spaceRef.current = false
      setPanArmed(false)
    }
    globalThis.addEventListener('keydown', onKeyDown)
    globalThis.addEventListener('keyup', onKeyUp)
    return () => {
      globalThis.removeEventListener('keydown', onKeyDown)
      globalThis.removeEventListener('keyup', onKeyUp)
    }
  }, [actions])

  // Space or the middle button pans from anywhere on the board, the floating
  // chrome included: the capture phase takes the pointer before a window's own
  // gesture or a chrome control can claim it.
  const handlePointerDownCapture = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!spaceRef.current && e.button !== 1) return
    if (isBoardEditingTarget(e.target)) return
    e.preventDefault()
    e.stopPropagation()
    startBoardPanGesture({ event: e, panX, panY, actions, start: startGesture })
  }

  // A picked element becomes one localized chip in the addressed chat window's
  // draft; the same rule as the Omnibox opens an agent window when the active
  // window is not a chat. The mode ends with the pick.
  const handlePick = (element: Element): void => {
    const capture = describeElement(element)
    const target = resolveChatWindow(actions, windows, activeWindowId)
    actions.pushComposerIntent(target, {
      text: t('inspector.chip', { description: capture.description, selector: capture.selector }),
    })
    actions.setSelectingElement(false)
  }

  return (
    <div
      ref={captureRoot}
      data-surface="board"
      onPointerEnter={() => { pointerInsideRef.current = true }}
      onPointerLeave={() => { pointerInsideRef.current = false }}
      onPointerDownCapture={handlePointerDownCapture}
      className={clsx(css.root, panArmed && css.panArmed)}
    >
      <BoardPopoverSurfaceContext.Provider value={surface}>
        {renderSlot('board.canvas', {})}
        {!fullscreen && !panelOpen && renderSlot('board.dock', {})}
        {!fullscreen && !panelOpen && renderSlot('board.omnibar', {})}
        {!fullscreen && !panelOpen && renderSlot('board.minimap', {})}
        {/* The active window's handle ring rides above the chrome, so a resize
            handle stays grabbable when its window edge sits under a floating
            layer; the selection overlay still paints above both. */}
        {!fullscreen && !simplified && <HandleRing useStore={useStore} actions={actions} />}
        <ElementSelectionOverlay
          t={t}
          active={selecting}
          onCancel={() => { actions.setSelectingElement(false) }}
          onPick={handlePick}
        />
        {/* Screen-space portal target for the board's tooltips and menus: it
            sits outside the canvas transform, takes no pointer events itself,
            and paints above the chrome but below the selection overlay. */}
        <div
          ref={setPopoverLayer}
          data-board-layer="popover"
          className={css.popoverHost}
          style={{ zIndex: BOARD_POPOVER_Z }}
        />
      </BoardPopoverSurfaceContext.Provider>
    </div>
  )
}

export function BoardIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={css.icon}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  )
}
