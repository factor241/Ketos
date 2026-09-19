/**
 * Canvas layer of the board: the transformed surface, its dot grid, and the
 * plain background pan. Space/middle-button panning lives on the board root,
 * which also sees the floating chrome; wheel zoom lives there for the same
 * reason. Presentation lives in `DashboardCanvas.module.css`; inline styles
 * carry only geometry and the computed metrics that scale with pan/zoom.
 */
import { useCallback, useEffect, useRef } from 'react'
import clsx from 'clsx'
import type { PropsRenderSlots, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'
import { useBoardPointerGesture } from '../pointer-gesture.ts'
import { startBoardPanGesture } from '../pan-gesture.ts'
import css from './DashboardCanvas.module.css'

export type DashboardCanvasProps =
  PropsRenderSlots<'board.windows'>
  & PropsStore<BoardStoreHandle>

export function DashboardCanvas({ renderSlot, useStore, actions }: DashboardCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
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

  // A plain drag pans only from the bare canvas, and never while a fullscreen
  // window holds the panel: the mode's identity transform is not the world.
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isFullscreen) return
    if (e.target !== containerRef.current && (e.target as HTMLElement).dataset.surface !== 'canvas-layer') return
    startBoardPanGesture({ event: e, panX, panY, actions, start: startGesture })
  }, [isFullscreen, panX, panY, actions, startGesture])

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
      className={clsx(css.canvas, isSelectingElement && css.selecting)}
      style={gridStyle}
    >
      {/* Transformed Canvas Content Surface */}
      <div data-surface="canvas-layer" className={css.surface}>
        {renderSlot('board.windows', {})}
      </div>
    </div>
  )
}
