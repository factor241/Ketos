/**
 * Canvas layer of the board: the transformed surface, its dot grid, the pan
 * gestures, and the window layer rendered through `board.windows`.
 *
 * Presentation lives in `DashboardCanvas.module.css`; inline styles are
 * reserved for geometry and the computed metrics that scale with the live
 * pan/zoom (passed as component-local custom properties). Wheel zoom lives on
 * the board root, which also sees the floating chrome.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { PropsRenderSlots, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'
import { isBoardEditingTarget } from '../editing-target.ts'
import { useBoardPointerGesture } from '../pointer-gesture.ts'
import css from './DashboardCanvas.module.css'

export type DashboardCanvasProps =
  PropsRenderSlots<'board.windows'>
  & PropsStore<BoardStoreHandle>

export function DashboardCanvas({ renderSlot, useStore, actions }: DashboardCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const spaceRef = useRef(false)
  const pointerInsideRef = useRef(false)
  const [panArmed, setPanArmed] = useState(false)
  const startGesture = useBoardPointerGesture()
  const panX = useStore(s => s.panX)
  const panY = useStore(s => s.panY)
  const zoom = useStore(s => s.zoom)
  const isSelectingElement = useStore(s => s.isSelectingElement)
  const isFullscreen = useStore(s => s.fullscreenWindowId !== null)

  // Publish the canvas box: window placement and the minimap frustum measure
  // against it. A ResizeObserver follows panel geometry — collapsing the
  // sidebar or resizing the rightbar changes the box without a window resize.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const publish = (): void => { actions.setViewport(container.clientWidth, container.clientHeight) }
    publish()
    // jsdom implements no ResizeObserver; the unit lane keeps the mount-time read.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(publish)
    observer.observe(container)
    return () => { observer.disconnect() }
  }, [actions])

  // Space arms panning while the pointer is over the board, and a focused
  // editor keeps the key for itself. Ctrl/Cmd+0 resets the view instead of the
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

  const startPan = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const startClientX = event.clientX
    const startClientY = event.clientY
    const startPanX = panX
    const startPanY = panY
    startGesture(target, event.pointerId, {
      move: (moveEvt) => {
        actions.setPan(startPanX + (moveEvt.clientX - startClientX), startPanY + (moveEvt.clientY - startClientY))
      },
    })
  }, [panX, panY, actions, startGesture])

  // Space or the middle button pans from anywhere on the board — including
  // over a window, whose own gesture stands down for the capture phase; a
  // plain drag pans only from the bare canvas.
  const handlePointerDownCapture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!spaceRef.current && e.button !== 1) return
    if (isBoardEditingTarget(e.target)) return
    e.preventDefault()
    e.stopPropagation()
    startPan(e)
  }, [startPan])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== containerRef.current && (e.target as HTMLElement).dataset.surface !== 'canvas-layer') return
    startPan(e)
  }, [startPan])

  // Grid geometry follows the live zoom; the dot grid paints from these
  // variables. A fullscreen window fills the panel, so the surface drops its
  // pan and zoom under it and the frame's inset rectangle maps to the visible
  // canvas instead of world units.
  const view = isFullscreen ? { panX: 0, panY: 0, zoom: 1 } : { panX, panY, zoom }
  const grid = 24 * view.zoom
  const gridStyle = {
    '--board-grid-dot-radius': `${Math.max(1, 1.5 * view.zoom)}px`,
    '--board-grid-size': `${grid}px`,
    '--board-grid-x': `${view.panX % grid}px`,
    '--board-grid-y': `${view.panY % grid}px`,
    '--board-pan-x': `${view.panX}px`,
    '--board-pan-y': `${view.panY}px`,
    '--board-zoom': view.zoom,
  } as React.CSSProperties

  return (
    <div
      ref={containerRef}
      data-board-layer="canvas"
      data-surface="canvas"
      onPointerEnter={() => { pointerInsideRef.current = true }}
      onPointerLeave={() => { pointerInsideRef.current = false }}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerDown={handlePointerDown}
      className={clsx(css.canvas, panArmed && css.panArmed, isSelectingElement && css.selecting)}
      style={gridStyle}
    >
      {/* Transformed Canvas Content Surface */}
      <div data-surface="canvas-layer" className={css.surface}>
        {renderSlot('board.windows', {})}
      </div>
    </div>
  )
}
