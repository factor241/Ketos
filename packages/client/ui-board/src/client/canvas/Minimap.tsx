/**
 * Interactive SVG Minimap for Spatial Board Canvas.
 */
import { useCallback, useRef } from 'react'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'

export type MinimapProps =
  PropsRuntime<'board.minimap'>
  & PropsStore<BoardStoreHandle>

const MINIMAP_WIDTH = 200
const MINIMAP_HEIGHT = 140
const PADDING = 20

export function Minimap({ useStore, actions }: MinimapProps) {
  const isDraggingRef = useRef(false)
  const panX = useStore(s => s.panX)
  const panY = useStore(s => s.panY)
  const zoom = useStore(s => s.zoom)
  const windows = useStore(s => s.windows)
  const activeWindowId = useStore(s => s.activeWindowId)
  const viewportWidth = useStore(s => s.viewportWidth)
  const viewportHeight = useStore(s => s.viewportHeight)

  const viewLeft = -panX / zoom
  const viewTop = -panY / zoom
  const viewRight = viewLeft + viewportWidth / zoom
  const viewBottom = viewTop + viewportHeight / zoom

  let minX = Math.min(viewLeft, 0)
  let minY = Math.min(viewTop, 0)
  let maxX = Math.max(viewRight, 1000)
  let maxY = Math.max(viewBottom, 800)

  for (const win of Object.values(windows)) {
    minX = Math.min(minX, win.x)
    minY = Math.min(minY, win.y)
    maxX = Math.max(maxX, win.x + win.width)
    maxY = Math.max(maxY, win.y + win.height)
  }

  const worldW = Math.max(100, maxX - minX + PADDING * 2)
  const worldH = Math.max(100, maxY - minY + PADDING * 2)
  const scale = Math.min(MINIMAP_WIDTH / worldW, MINIMAP_HEIGHT / worldH)

  const toMiniX = (x: number) => (x - minX + PADDING) * scale
  const toMiniY = (y: number) => (y - minY + PADDING) * scale
  const toWorldX = (mx: number) => mx / scale + minX - PADDING
  const toWorldY = (my: number) => my / scale + minY - PADDING

  const frustumX = toMiniX(viewLeft)
  const frustumY = toMiniY(viewTop)
  const frustumW = Math.max(8, (viewportWidth / zoom) * scale)
  const frustumH = Math.max(8, (viewportHeight / zoom) * scale)

  const handlePointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    isDraggingRef.current = true

    const rect = e.currentTarget.getBoundingClientRect()
    const clickMx = e.clientX - rect.left
    const clickMy = e.clientY - rect.top

    const targetWorldX = toWorldX(clickMx)
    const targetWorldY = toWorldY(clickMy)

    actions.setPan(
      -(targetWorldX - (viewportWidth / (2 * zoom))) * zoom,
      -(targetWorldY - (viewportHeight / (2 * zoom))) * zoom,
    )
  }, [zoom, viewportWidth, viewportHeight, minX, minY, scale, actions])

  const handlePointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDraggingRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const clickMx = e.clientX - rect.left
    const clickMy = e.clientY - rect.top

    const targetWorldX = toWorldX(clickMx)
    const targetWorldY = toWorldY(clickMy)

    actions.setPan(
      -(targetWorldX - (viewportWidth / (2 * zoom))) * zoom,
      -(targetWorldY - (viewportHeight / (2 * zoom))) * zoom,
    )
  }, [zoom, viewportWidth, viewportHeight, minX, minY, scale, actions])

  const handlePointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    isDraggingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Swallows the capture-release miss after the pointer already left; the drag ends either way.
    }
  }, [])

  return (
    <div
      data-board-layer="minimap"
      style={{
        position: 'absolute',
        bottom: 24,
        right: 24,
        width: MINIMAP_WIDTH,
        height: MINIMAP_HEIGHT,
        background: 'rgba(255, 255, 255, 0.85)',
        backdropFilter: 'blur(12px)',
        borderRadius: 12,
        border: '1px solid rgba(0, 0, 0, 0.08)',
        boxShadow: '0 8px 24px -4px rgba(0, 0, 0, 0.1)',
        overflow: 'hidden',
        zIndex: 100,
        userSelect: 'none',
      }}
    >
      <svg
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
        style={{ display: 'block', cursor: 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {Object.values(windows).map((win) => {
          const wx = toMiniX(win.x)
          const wy = toMiniY(win.y)
          const ww = Math.max(4, win.width * scale)
          const wh = Math.max(4, win.height * scale)
          const isAgent = win.kind === 'agent'
          const fill = isAgent ? '#B8532F' : '#3266AD'
          const opacity = win.id === activeWindowId ? 0.9 : 0.5

          return (
            <rect
              key={win.id}
              x={wx}
              y={wy}
              width={ww}
              height={wh}
              rx={3}
              fill={fill}
              opacity={opacity}
              onClick={(e) => {
                e.stopPropagation()
                actions.centerOnWindow(win.id)
              }}
              style={{ cursor: 'pointer' }}
            />
          )
        })}

        <rect
          x={frustumX}
          y={frustumY}
          width={frustumW}
          height={frustumH}
          rx={4}
          fill="rgba(184, 83, 47, 0.08)"
          stroke="#B8532F"
          strokeWidth={1.5}
          style={{ pointerEvents: 'none' }}
        />
      </svg>
    </div>
  )
}
