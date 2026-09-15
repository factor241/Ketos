/**
 * Canvas layer of the board: the transformed surface, its dot grid, pan and
 * wheel zoom, and the window layer rendered through `board.windows`.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { PropsRenderSlots, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'

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

  // Wheel zoom toward pointer
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const pointerX = e.clientX - rect.left
    const pointerY = e.clientY - rect.top
    actions.zoomTowardPointer(e.deltaY, pointerX, pointerY)
  }, [actions])

  return (
    <div
      ref={containerRef}
      data-board-layer="canvas"
      data-surface="canvas"
      onPointerDown={handlePointerDown}
      onWheel={handleWheel}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#F5F5F0',
        backgroundImage: `radial-gradient(circle, rgba(0, 0, 0, 0.08) ${Math.max(1, 1.5 * zoom)}px, transparent ${Math.max(1, 1.5 * zoom)}px)`,
        backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        backgroundPosition: `${panX % (24 * zoom)}px ${panY % (24 * zoom)}px`,
        cursor: isSelectingElement ? 'crosshair' : 'default',
      }}
    >
      {/* Transformed Canvas Content Surface */}
      <div
        data-surface="canvas"
        style={{
          position: 'absolute',
          inset: 0,
          transformOrigin: '0 0',
          transform: `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`,
          willChange: 'transform',
        }}
      >
        {renderSlot('board.windows', {})}
      </div>
    </div>
  )
}
