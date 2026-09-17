/**
 * Interactive SVG Minimap for Spatial Board Canvas.
 */
import { useCallback, useRef } from 'react'
import clsx from 'clsx'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'
import css from './Minimap.module.css'

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

  // Click or drag on the map recentres the viewport on the pointer's world
  // point; both gestures translate one pointer position through the same map
  // transform, so they share the pan step.
  const panFromPointer = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const targetWorldX = toWorldX(e.clientX - rect.left)
    const targetWorldY = toWorldY(e.clientY - rect.top)
    actions.setPan(
      -(targetWorldX - (viewportWidth / (2 * zoom))) * zoom,
      -(targetWorldY - (viewportHeight / (2 * zoom))) * zoom,
    )
  }, [zoom, viewportWidth, viewportHeight, minX, minY, scale, actions])

  const handlePointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    isDraggingRef.current = true
    panFromPointer(e)
  }, [panFromPointer])

  const handlePointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDraggingRef.current) return
    panFromPointer(e)
  }, [panFromPointer])

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
      className={css.minimap}
      style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT }}
    >
      <svg
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
        className={css.svg}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {Object.values(windows).map((win) => {
          const wx = toMiniX(win.x)
          const wy = toMiniY(win.y)
          const ww = Math.max(4, win.width * scale)
          const wh = Math.max(4, win.height * scale)
          const isAgent = win.kind === 'agent'

          return (
            <rect
              key={win.id}
              x={wx}
              y={wy}
              width={ww}
              height={wh}
              rx={3}
              className={clsx(
                css.rect,
                isAgent ? css.agent : css.tool,
                win.id === activeWindowId ? css.active : css.idle,
              )}
              onClick={(e) => {
                e.stopPropagation()
                actions.centerOnWindow(win.id)
              }}
            />
          )
        })}

        <rect
          x={frustumX}
          y={frustumY}
          width={frustumW}
          height={frustumH}
          rx={4}
          className={css.frustum}
        />
      </svg>
    </div>
  )
}
