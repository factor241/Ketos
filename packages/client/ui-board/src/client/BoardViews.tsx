/**
 * React entry views for the Spatial Board slot registrations.
 *
 * The root owns the board's layer ladder: the canvas grid and its windows
 * (z-index 10–99, see `WINDOW_Z_MAX`), the floating chrome — dock, omnibar,
 * minimap — at 100, the element-selection overlay at 500, and the fullscreen
 * frame (with an overlay chats panel) at 1000. An expanded chats panel and a
 * fullscreen window stand the floating chrome down, so no root-level layer can
 * cover the panel's edge or the fullscreen frame. `isolation: isolate`
 * contains that ladder inside the board box, so an app-level overlay above the
 * box stays above every board layer instead of losing hit-testing to the
 * chrome.
 */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import clsx from 'clsx'
import type { BoardStoreHandle } from './store.ts'
import { BOARD_PANEL_ID } from './contract/slots.ts'
import { isBoardEditingTarget } from './editing-target.ts'
import { useBoardPointerGesture } from './pointer-gesture.ts'
import { startBoardPanGesture } from './pan-gesture.ts'
import { describeElement } from './element-capture.ts'
import { resolveChatWindow } from './open-window.ts'
import { ElementSelectionOverlay } from './ElementSelectionOverlay.tsx'
import { HandleRing } from './HandleRing.tsx'
import { wheelZoomsBoard } from './wheel-zoom.ts'
import css from './BoardViews.module.css'

/** Props of the board main-panel body: the child render share, the store share, and the locale seat. */
export type BoardRootProps =
  PropsRuntime<'main'>
  & PropsRenderSlots<'board.canvas' | 'board.dock' | 'board.omnibar' | 'board.minimap'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>

/** How long the window the user returns to stays highlighted. */
const RETURN_HIGHLIGHT_MS = 1600

export function BoardRoot({ renderSlot, useStore, actions, t, usePanelInfo }: BoardRootProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const pointerInsideRef = useRef(false)
  const spaceRef = useRef(false)
  const [panArmed, setPanArmed] = useState(false)
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

  // Wheel zoom toward the pointer. React's `onWheel` is a passive listener,
  // so zooming logs a preventDefault error through it; a native non-passive
  // listener on the root also covers the floating chrome, which sits beside
  // the canvas rather than inside it.
  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const onWheel = (event: WheelEvent): void => {
      if (fullscreen || !wheelZoomsBoard(event.target)) return
      event.preventDefault()
      const box = root.getBoundingClientRect()
      actions.zoomTowardPointer(event.deltaY, event.clientX - box.left, event.clientY - box.top)
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => { root.removeEventListener('wheel', onWheel) }
  }, [fullscreen, actions])

  // Space arms panning while the pointer is over the board — including over a
  // window, whose own gesture then stands down for the capture phase — and a
  // focused editor keeps the key. Ctrl/Cmd+0 resets the view instead of the
  // browser's page zoom.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === '0') {
        event.preventDefault()
        actions.setPan(0, 0)
        actions.setZoom(1)
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
      ref={rootRef}
      data-surface="board"
      onPointerEnter={() => { pointerInsideRef.current = true }}
      onPointerLeave={() => { pointerInsideRef.current = false }}
      onPointerDownCapture={handlePointerDownCapture}
      className={clsx(css.root, panArmed && css.panArmed)}
    >
      {renderSlot('board.canvas', {})}
      {!fullscreen && !panelOpen && renderSlot('board.dock', {})}
      {!fullscreen && !panelOpen && renderSlot('board.omnibar', {})}
      {!fullscreen && !panelOpen && renderSlot('board.minimap', {})}
      {/* The active window's handle ring rides above the chrome, so a resize
          handle stays grabbable when its window edge sits under a floating
          layer; the selection overlay still paints above both. */}
      {!fullscreen && <HandleRing useStore={useStore} actions={actions} />}
      <ElementSelectionOverlay
        t={t}
        active={selecting}
        onCancel={() => { actions.setSelectingElement(false) }}
        onPick={handlePick}
      />
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
