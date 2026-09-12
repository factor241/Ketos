/**
 * Master GPU-accelerated Spatial Multi-Window Canvas OpenSwarm-style.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardState } from '../store.ts'
import type { BoardWindowState, WindowId } from '../contract/slots.ts'
import { Minimap } from './Minimap.tsx'
import { AgentCard } from '../window/AgentCard.tsx'
import { ToolWindow } from '../window/ToolWindow.tsx'
import { SessionRail } from '../dock/SessionRail.tsx'
import { DashboardToolbar } from '../omnibox/DashboardToolbar.tsx'
import { ElementSelectionOverlay } from '../inspector/ElementSelectionContext.tsx'
import '../tokens.css'

export interface DashboardCanvasProps {
  state: BoardState
  actions: {
    setPan: (panX: number, panY: number) => void
    setZoom: (zoom: number) => void
    zoomTowardPointer: (delta: number, pointerX: number, pointerY: number) => void
    addWindow: (window: BoardWindowState) => void
    moveWindow: (id: WindowId, x: number, y: number, snap: boolean) => void
    resizeWindow: (id: WindowId, width: number, height: number, snap: boolean) => void
    focusWindow: (id: WindowId) => void
    closeWindow: (id: WindowId) => void
    setSelectingElement: (selecting: boolean) => void
  }
}

export function DashboardCanvas({ state, actions }: DashboardCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [viewportSize, setViewportSize] = useState({ width: 1920, height: 1080 })
  const isPanningRef = useRef(false)

  // Track viewport dimensions for minimap and center calculations
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setViewportSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        })
      }
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  // Canvas pan via dragging on empty space
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== containerRef.current && (e.target as HTMLElement).dataset.surface !== 'canvas') {
      return
    }
    isPanningRef.current = true
    containerRef.current?.setPointerCapture(e.pointerId)

    const startX = e.clientX
    const startY = e.clientY
    const startPanX = state.panX
    const startPanY = state.panY

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
      } catch {}
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }, [state.panX, state.panY, actions])

  // Wheel zoom toward pointer
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const pointerX = e.clientX - rect.left
    const pointerY = e.clientY - rect.top
    actions.zoomTowardPointer(e.deltaY, pointerX, pointerY)
  }, [actions])

  // Center on a specific window
  const handleSelectWindow = useCallback((id: WindowId) => {
    actions.focusWindow(id)
    const win = state.windows[id as string]
    if (!win) return
    const targetX = -(win.x + win.width / 2 - viewportSize.width / (2 * state.zoom)) * state.zoom
    const targetY = -(win.y + win.height / 2 - viewportSize.height / (2 * state.zoom)) * state.zoom
    actions.setPan(targetX, targetY)
  }, [state.windows, state.zoom, viewportSize, actions])

  // Add default agent window if none exist
  const handleAddAgent = useCallback(() => {
    const id = `agent-${Date.now()}` as WindowId
    const newWin: BoardWindowState = {
      id,
      kind: 'agent',
      title: `Agent #${state.windowOrder.length + 1}`,
      x: (-state.panX + viewportSize.width / 2 - 240) / state.zoom,
      y: (-state.panY + viewportSize.height / 2 - 280) / state.zoom,
      width: 480,
      height: 560,
      zIndex: 10 + state.windowOrder.length,
      status: 'idle',
      statusText: 'Autonomous AI Expert twin online.',
    }
    actions.addWindow(newWin)
  }, [state.panX, state.panY, state.zoom, state.windowOrder.length, viewportSize, actions])

  const handleAddTools = useCallback(() => {
    const id = `tool-${Date.now()}` as WindowId
    const newWin: BoardWindowState = {
      id,
      kind: 'connectors',
      title: 'Tools & Connectors',
      x: (-state.panX + viewportSize.width / 2 - 260) / state.zoom,
      y: (-state.panY + viewportSize.height / 2 - 240) / state.zoom,
      width: 520,
      height: 480,
      zIndex: 10 + state.windowOrder.length,
    }
    actions.addWindow(newWin)
  }, [state.panX, state.panY, state.zoom, state.windowOrder.length, viewportSize, actions])

  const handleResetView = useCallback(() => {
    actions.setPan(0, 0)
    actions.setZoom(1)
  }, [actions])

  return (
    <div
      ref={containerRef}
      data-surface="canvas"
      onPointerDown={handlePointerDown}
      onWheel={handleWheel}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: '#F5F5F0',
        backgroundImage: `radial-gradient(circle, rgba(0, 0, 0, 0.08) ${Math.max(1, 1.5 * state.zoom)}px, transparent ${Math.max(1, 1.5 * state.zoom)}px)`,
        backgroundSize: `${24 * state.zoom}px ${24 * state.zoom}px`,
        backgroundPosition: `${state.panX % (24 * state.zoom)}px ${state.panY % (24 * state.zoom)}px`,
        cursor: state.isSelectingElement ? 'crosshair' : 'default',
      }}
    >
      {/* Transformed Canvas Content Surface */}
      <div
        data-surface="canvas"
        style={{
          position: 'absolute',
          inset: 0,
          transformOrigin: '0 0',
          transform: `translate3d(${state.panX}px, ${state.panY}px, 0) scale(${state.zoom})`,
          willChange: 'transform',
        }}
      >
        {state.windowOrder.map((id) => {
          const win = state.windows[id as string]
          if (!win) return null
          const isActive = id === state.activeWindowId

          if (win.kind === 'agent') {
            return (
              <AgentCard
                key={win.id}
                cardWindow={win}
                zoom={state.zoom}
                isActive={isActive}
                onFocus={actions.focusWindow}
                onMove={actions.moveWindow}
                onResize={actions.resizeWindow}
                onClose={actions.closeWindow}
                onActionMenuClick={() => actions.setSelectingElement(true)}
              />
            )
          }

          return (
            <ToolWindow
              key={win.id}
              cardWindow={win}
              zoom={state.zoom}
              isActive={isActive}
              onFocus={actions.focusWindow}
              onMove={actions.moveWindow}
              onResize={actions.resizeWindow}
              onClose={actions.closeWindow}
            />
          )
        })}
      </div>

      {/* Floating Overlays */}
      <SessionRail
        state={state}
        onSelectWindow={handleSelectWindow}
        onAddAgent={handleAddAgent}
        onAddTools={handleAddTools}
        onResetView={handleResetView}
      />

      <DashboardToolbar
        onSendMessage={(msg) => alert(`Message sent: ${msg}`)}
        onStartElementSelection={() => actions.setSelectingElement(true)}
        onOpenConnectors={handleAddTools}
      />

      <Minimap
        state={state}
        viewportWidth={viewportSize.width}
        viewportHeight={viewportSize.height}
        onPanChange={actions.setPan}
        onFocusWindow={handleSelectWindow}
      />

      <ElementSelectionOverlay
        active={state.isSelectingElement}
        onCancel={() => actions.setSelectingElement(false)}
      />
    </div>
  )
}
