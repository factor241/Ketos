/**
 * Canvas layer of the board: the transformed surface, its dot grid, pan and
 * wheel zoom, and the window layer rendered through `board.windows`.
 *
 * Presentation lives in `DashboardCanvas.module.css`; inline styles are
 * reserved for geometry and the computed metrics that scale with the live
 * pan/zoom (passed as component-local custom properties).
 */
import { useCallback, useEffect, useRef } from 'react'
import clsx from 'clsx'
import type { PropsRenderSlots, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'
import css from './DashboardCanvas.module.css'

export type DashboardCanvasProps =
  PropsRenderSlots<'board.windows'>
  & PropsStore<BoardStoreHandle>

export function DashboardCanvas({ renderSlot, useStore, actions }: DashboardCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const isPanningRef = useRef(false)
  const panX = useStore(s => s.panX)
  const panY = useStore(s => s.panY)
  const zoom = useStore(s => s.zoom)
  const isSelectingElement = useStore(s => s.isSelectingElement)
  const isFullscreen = useStore(s => s.fullscreenWindowId !== null)

  // Publish the canvas box: window placement and the minimap frustum measure against it.
  useEffect(() => {
    const updateSize = () => {
      const container = containerRef.current
      if (container) actions.setViewport(container.clientWidth, container.clientHeight)
    }
    updateSize()
    globalThis.addEventListener('resize', updateSize)
    return () => { globalThis.removeEventListener('resize', updateSize) }
  }, [actions])

  // Canvas pan via dragging on empty space
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== containerRef.current && (e.target as HTMLElement).dataset.surface !== 'canvas') {
      return
    }
    isPanningRef.current = true
    containerRef.current?.setPointerCapture(e.pointerId)

    const startX = e.clientX
    const startY = e.clientY
    const startPanX = panX
    const startPanY = panY

    const onPointerMove = (moveEvt: PointerEvent) => {
      if (!isPanningRef.current) return
      const dx = moveEvt.clientX - startX
      const dy = moveEvt.clientY - startY
      actions.setPan(startPanX + dx, startPanY + dy)
    }

    const onPointerUp = (upEvt: PointerEvent) => {
      isPanningRef.current = false
      try {
        containerRef.current?.releasePointerCapture(upEvt.pointerId)
      } catch {
        // Swallows the pointer-capture miss when a capture never took hold; the gesture ends either way.
      }
      globalThis.removeEventListener('pointermove', onPointerMove)
      globalThis.removeEventListener('pointerup', onPointerUp)
    }

    globalThis.addEventListener('pointermove', onPointerMove)
    globalThis.addEventListener('pointerup', onPointerUp)
  }, [panX, panY, actions])

  // Wheel zoom toward pointer; a fullscreen window owns the wheel so its lane
  // and popups scroll normally.
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (isFullscreen) return
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const pointerX = e.clientX - rect.left
    const pointerY = e.clientY - rect.top
    actions.zoomTowardPointer(e.deltaY, pointerX, pointerY)
  }, [isFullscreen, actions])

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
      onPointerDown={handlePointerDown}
      onWheel={handleWheel}
      className={clsx(css.canvas, isSelectingElement && css.selecting)}
      style={gridStyle}
    >
      {/* Transformed Canvas Content Surface */}
      <div data-surface="canvas" className={css.surface}>
        {renderSlot('board.windows', {})}
      </div>
    </div>
  )
}
