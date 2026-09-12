/**
 * Interactive SVG Minimap for Spatial Board Canvas.
 */
import { useCallback, useRef } from 'react'
import type { BoardState } from '../store.ts'
import type { WindowId } from '../contract/slots.ts'

export interface MinimapProps {
  state: BoardState
  viewportWidth: number
  viewportHeight: number
  onPanChange: (panX: number, panY: number) => void
  onFocusWindow: (id: WindowId) => void
}

const MINIMAP_WIDTH = 200
const MINIMAP_HEIGHT = 140
const PADDING = 20

export function Minimap({
  state,
  viewportWidth,
  viewportHeight,
  onPanChange,
  onFocusWindow,
}: MinimapProps) {
  const isDraggingRef = useRef(false)

  const viewLeft = -state.panX / state.zoom
  const viewTop = -state.panY / state.zoom
  const viewRight = viewLeft + viewportWidth / state.zoom
  const viewBottom = viewTop + viewportHeight / state.zoom

  let minX = Math.min(viewLeft, 0)
  let minY = Math.min(viewTop, 0)
  let maxX = Math.max(viewRight, 1000)
  let maxY = Math.max(viewBottom, 800)

  for (const win of Object.values(state.windows)) {
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
  const frustumW = Math.max(8, (viewportWidth / state.zoom) * scale)
  const frustumH = Math.max(8, (viewportHeight / state.zoom) * scale)

  const handlePointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    isDraggingRef.current = true

    const rect = e.currentTarget.getBoundingClientRect()
    const clickMx = e.clientX - rect.left
    const clickMy = e.clientY - rect.top

    const targetWorldX = toWorldX(clickMx)
    const targetWorldY = toWorldY(clickMy)

    const newPanX = -(targetWorldX - (viewportWidth / (2 * state.zoom))) * state.zoom
    const newPanY = -(targetWorldY - (viewportHeight / (2 * state.zoom))) * state.zoom
    onPanChange(newPanX, newPanY)
  }, [state.zoom, viewportWidth, viewportHeight, minX, minY, scale, onPanChange])

  const handlePointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDraggingRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const clickMx = e.clientX - rect.left
    const clickMy = e.clientY - rect.top

    const targetWorldX = toWorldX(clickMx)
    const targetWorldY = toWorldY(clickMy)

    const newPanX = -(targetWorldX - (viewportWidth / (2 * state.zoom))) * state.zoom
    const newPanY = -(targetWorldY - (viewportHeight / (2 * state.zoom))) * state.zoom
    onPanChange(newPanX, newPanY)
  }, [state.zoom, viewportWidth, viewportHeight, minX, minY, scale, onPanChange])

  const handlePointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    isDraggingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Ignored if capture already lost
    }
  }, [])

  return (
    <div
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
        {Object.values(state.windows).map((win) => {
          const wx = toMiniX(win.x)
          const wy = toMiniY(win.y)
          const ww = Math.max(4, win.width * scale)
          const wh = Math.max(4, win.height * scale)
          const isAgent = win.kind === 'agent'
          const fill = isAgent ? '#B8532F' : '#3266AD'
          const opacity = win.id === state.activeWindowId ? 0.9 : 0.5

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
                onFocusWindow(win.id)
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
