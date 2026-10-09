/**
 * Canvas layer of the board: the transformed surface, its dot grid, the plain
 * background pan, and the brush/eraser tool gestures. Space/middle-button
 * panning lives on the board root, which also sees the floating chrome; wheel
 * zoom lives there for the same reason. Presentation lives in
 * `DashboardCanvas.module.css`; inline styles carry only geometry and the
 * computed metrics that scale with pan/zoom.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { PropsRenderSlots, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'
import { useBoardPointerGesture } from '../pointer-gesture.ts'
import { startBoardPanGesture } from '../pan-gesture.ts'
import { ERASER_RADIUS_PX, type BoardStrokeDraft } from '../board-tool.ts'
import { startBoardBrushGesture } from '../brush-gesture.ts'
import { startBoardEraserGesture } from '../eraser-gesture.ts'
import type { BoardElementInjected } from '../contract/slots.ts'
import { isBoardWindowTarget } from '../editing-target.ts'
import { ownerColorAttr } from '../owners.ts'
import { StrokeDraft } from './StrokeDraft.tsx'
import css from './DashboardCanvas.module.css'

export type DashboardCanvasProps =
  PropsRenderSlots<'board.windows' | 'board.elements' | 'board.foreign.windows'>
  & PropsStore<BoardStoreHandle>
  & BoardElementInjected

export function DashboardCanvas({ renderSlot, useStore, actions, createElement, eraseStrokes }: DashboardCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const startGesture = useBoardPointerGesture()
  const panX = useStore(s => s.panX)
  const panY = useStore(s => s.panY)
  const zoom = useStore(s => s.zoom)
  const tool = useStore(s => s.tool)
  const brushWidth = useStore(s => s.brushWidth)
  const limits = useStore(s => s.boardLimits)
  const selfId = useStore(s => s.selfId)
  // The live stroke is this participant's; its color comes from the roster.
  const selfColor = useStore(s => s.selfId === null ? 'unknown' as const : ownerColorAttr(s, s.selfId))
  const boardElements = useStore(s => s.boardElements)
  const eraserPreview = useStore(s => s.eraserPreview)
  const isSelectingElement = useStore(s => s.isSelectingElement)
  const [eraserPoint, setEraserPoint] = useState<{ readonly x: number; readonly y: number } | null>(null)
  const [draft, setDraft] = useState<BoardStrokeDraft | null>(null)
  // The brush samples read the view at their own moment: the ref is rewritten
  // every render, so a wheel zoom in the middle of a stroke moves the view for
  // the next sample without shifting the points already drawn.
  const viewRef = useRef({ panX, panY, zoom })
  viewRef.current = { panX, panY, zoom }

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

  // A plain drag pans only from the bare canvas; a plain click without a drag
  // drops the window and element selection (the canvas is the board's empty
  // space). With the brush or eraser active, a primary left press starts the
  // tool gesture from anywhere on the canvas instead — a window keeps its own gesture, and
  // the tool CSS makes element boxes transparent so the press reaches here.
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (tool !== 'select') {
      if (e.button !== 0 || !e.isPrimary) return
      if (isBoardWindowTarget(e.target)) return
      const container = containerRef.current
      if (tool === 'brush' && limits !== null && container !== null) {
        startBoardBrushGesture({
          event: e,
          start: startGesture,
          container,
          view: () => viewRef.current,
          limits,
          width: brushWidth,
          create: createElement,
          onDraft: setDraft,
        })
        return
      }
      if (tool === 'eraser' && limits !== null && container !== null) {
        // Before the first snapshot nothing belongs to this participant yet.
        const owner = selfId
        startBoardEraserGesture({
          event: e,
          start: startGesture,
          container,
          view: () => viewRef.current,
          radiusPx: ERASER_RADIUS_PX[brushWidth],
          strokes: Object.values(boardElements).filter(
            element => element.kind === 'stroke' && owner !== null && element.ownerId === owner,
          ),
          limits,
          erase: eraseStrokes,
          onPreview: (preview) => { actions.setEraserPreview(preview) },
        })
        return
      }
      return
    }
    if (e.target !== containerRef.current && (e.target as HTMLElement).dataset.surface !== 'canvas-layer') return
    startBoardPanGesture({
      event: e,
      panX,
      panY,
      actions,
      start: startGesture,
      click: () => {
        actions.clearActiveWindow()
        // A selected element would otherwise take the next Backspace.
        actions.selectBoardElement(null)
      },
    })
  }, [tool, limits, brushWidth, selfId, boardElements, createElement, eraseStrokes, panX, panY, actions, startGesture])

  // The eraser ring follows the pointer in screen space; its screen size is
  // fixed, because the world radius it erases with is this size over the zoom.
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (tool !== 'eraser') return
    const box = containerRef.current?.getBoundingClientRect()
    if (box === undefined) return
    setEraserPoint({ x: e.clientX - box.left, y: e.clientY - box.top })
  }

  const handlePointerLeave = (): void => { setEraserPoint(null) }

  // Grid geometry follows the live zoom; the dot grid paints from these
  // variables.
  const view = { panX, panY, zoom }
  // The dot grid never renders denser than 8 screen pixels (Д6.3): below that
  // the world step doubles (24 → 48 → 96), and the dots fade out as the step
  // approaches the floor so the density change does not read as a jump.
  let step = 24
  while (step < 96 && step * view.zoom < 8) step *= 2
  const grid = step * view.zoom
  const dotOpacity = Math.max(0, Math.min(1, (grid - 8) / 4))
  const gridStyle = {
    '--board-grid-dot-radius': `${Math.max(1, 1.5 * view.zoom)}px`,
    '--board-grid-size': `${grid}px`,
    '--board-grid-dot-opacity': `${dotOpacity}`,
    '--board-grid-x': `${view.panX % grid}px`,
    '--board-grid-y': `${view.panY % grid}px`,
    '--board-pan-x': `${view.panX}px`,
    '--board-pan-y': `${view.panY}px`,
    '--board-zoom': view.zoom,
  } as React.CSSProperties

  const eraserDiameter = ERASER_RADIUS_PX[brushWidth] * 2

  return (
    <div
      ref={containerRef}
      data-board-layer="canvas"
      data-surface="canvas"
      data-board-tool={tool}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={clsx(css.canvas, isSelectingElement && css.selecting)}
      style={gridStyle}
    >
      {/* Transformed Canvas Content Surface */}
      <div data-surface="canvas-layer" className={css.surface}>
        {renderSlot('board.elements', {})}
        {/* The live stroke draws in world coordinates under the windows, the
            same layer the committed element takes. */}
        {draft !== null && (
          <StrokeDraft
            points={draft.points}
            width={draft.width}
            pen={draft.pen}
            ownerColor={selfColor}
          />
        )}
        {/* The eraser pass draws the remaining parts where the hidden originals
            were; the batch on pointerup replaces both. */}
        {eraserPreview?.parts.map((part, index) => (
          <StrokeDraft
            key={index}
            points={part.points}
            width={part.width}
            pen={part.pen}
            ownerColor={selfColor}
            preview
          />
        ))}
        {/* Foreign windows paint above the elements and below the local
            windows, each at its published z. */}
        {renderSlot('board.foreign.windows', {})}
        {renderSlot('board.windows', {})}
      </div>
      {tool === 'eraser' && eraserPoint !== null && (
        <div
          data-board-eraser-ring=""
          className={css.eraserRing}
          style={{
            left: eraserPoint.x,
            top: eraserPoint.y,
            width: eraserDiameter,
            height: eraserDiameter,
          }}
        />
      )}
    </div>
  )
}
