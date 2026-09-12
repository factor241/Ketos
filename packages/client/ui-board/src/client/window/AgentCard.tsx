/**
 * Dark Agent Card with 8-direction resize and OpenSwarm styling.
 */
import React, { useCallback, useRef } from 'react'
import type { BoardWindowState, WindowId } from '../contract/slots.ts'

export interface AgentCardProps {
  cardWindow: BoardWindowState
  zoom: number
  isActive: boolean
  onFocus: (id: WindowId) => void
  onMove: (id: WindowId, x: number, y: number, snap: boolean) => void
  onResize: (id: WindowId, width: number, height: number, snap: boolean) => void
  onClose: (id: WindowId) => void
  onActionMenuClick?: (id: WindowId) => void
}

export function AgentCard({
  cardWindow,
  zoom,
  isActive,
  onFocus,
  onMove,
  onResize,
  onClose,
  onActionMenuClick,
}: AgentCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)

  const handleHeaderPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    onFocus(cardWindow.id)

    const startClientX = e.clientX
    const startClientY = e.clientY
    const startX = cardWindow.x
    const startY = cardWindow.y

    const onPointerMove = (moveEvt: PointerEvent) => {
      const dx = (moveEvt.clientX - startClientX) / zoom
      const dy = (moveEvt.clientY - startClientY) / zoom
      const snap = !moveEvt.shiftKey
      onMove(cardWindow.id, startX + dx, startY + dy, snap)
    }

    const onPointerUp = (upEvt: PointerEvent) => {
      try {
        e.currentTarget.releasePointerCapture(upEvt.pointerId)
      } catch {}
      globalThis.removeEventListener('pointermove', onPointerMove)
      globalThis.removeEventListener('pointerup', onPointerUp)
    }

    globalThis.addEventListener('pointermove', onPointerMove)
    globalThis.addEventListener('pointerup', onPointerUp)
  }, [cardWindow.id, cardWindow.x, cardWindow.y, zoom, onFocus, onMove])

  const createResizeHandler = (direction: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    onFocus(cardWindow.id)

    const startClientX = e.clientX
    const startClientY = e.clientY
    const startW = cardWindow.width
    const startH = cardWindow.height
    const startX = cardWindow.x
    const startY = cardWindow.y

    const onPointerMove = (moveEvt: PointerEvent) => {
      const dx = (moveEvt.clientX - startClientX) / zoom
      const dy = (moveEvt.clientY - startClientY) / zoom
      const snap = !moveEvt.shiftKey

      let nextW = startW
      let nextH = startH
      let nextX = startX
      let nextY = startY

      if (direction.includes('e')) nextW = startW + dx
      if (direction.includes('s')) nextH = startH + dy
      if (direction.includes('w')) {
        nextW = startW - dx
        nextX = startX + dx
      }
      if (direction.includes('n')) {
        nextH = startH - dy
        nextY = startY + dy
      }

      if (nextW >= 320) {
        if (direction.includes('w')) onMove(cardWindow.id, nextX, cardWindow.y, snap)
        onResize(cardWindow.id, nextW, nextH, snap)
      }
      if (nextH >= 200) {
        if (direction.includes('n')) onMove(cardWindow.id, cardWindow.x, nextY, snap)
        onResize(cardWindow.id, nextW, nextH, snap)
      }
    }

    const onPointerUp = (upEvt: PointerEvent) => {
      try {
        e.currentTarget.releasePointerCapture(upEvt.pointerId)
      } catch {}
      globalThis.removeEventListener('pointermove', onPointerMove)
      globalThis.removeEventListener('pointerup', onPointerUp)
    }

    globalThis.addEventListener('pointermove', onPointerMove)
    globalThis.addEventListener('pointerup', onPointerUp)
  }

  const contextUsed = cardWindow.contextUsed ?? { usedTokens: 32900, maxTokens: 200000, percent: 16.4 }

  return (
    <div
      ref={cardRef}
      onPointerDown={() => onFocus(cardWindow.id)}
      style={{
        position: 'absolute',
        left: cardWindow.x,
        top: cardWindow.y,
        width: cardWindow.width,
        height: cardWindow.height,
        zIndex: cardWindow.zIndex,
        background: '#2B2A30',
        borderRadius: 18,
        border: isActive ? '1px solid #B8532F' : '1px solid #3A3940',
        boxShadow: isActive
          ? '0 24px 54px -8px rgba(0, 0, 0, 0.38), 0 8px 20px -4px rgba(0, 0, 0, 0.2)'
          : '0 20px 48px -8px rgba(0, 0, 0, 0.28), 0 6px 16px -4px rgba(0, 0, 0, 0.15)',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
        overflow: 'visible',
      }}
    >
      <div onPointerDown={createResizeHandler('n')} style={{ position: 'absolute', top: -3, left: 14, right: 14, height: 6, cursor: 'ns-resize', zIndex: 10 }} />
      <div onPointerDown={createResizeHandler('s')} style={{ position: 'absolute', bottom: -3, left: 14, right: 14, height: 6, cursor: 'ns-resize', zIndex: 10 }} />
      <div onPointerDown={createResizeHandler('w')} style={{ position: 'absolute', left: -3, top: 14, bottom: 14, width: 6, cursor: 'ew-resize', zIndex: 10 }} />
      <div onPointerDown={createResizeHandler('e')} style={{ position: 'absolute', right: -3, top: 14, bottom: 14, width: 6, cursor: 'ew-resize', zIndex: 10 }} />
      <div onPointerDown={createResizeHandler('nw')} style={{ position: 'absolute', top: -4, left: -4, width: 14, height: 14, cursor: 'nwse-resize', zIndex: 11 }} />
      <div onPointerDown={createResizeHandler('ne')} style={{ position: 'absolute', top: -4, right: -4, width: 14, height: 14, cursor: 'nesw-resize', zIndex: 11 }} />
      <div onPointerDown={createResizeHandler('sw')} style={{ position: 'absolute', bottom: -4, left: -4, width: 14, height: 14, cursor: 'nesw-resize', zIndex: 11 }} />
      <div onPointerDown={createResizeHandler('se')} style={{ position: 'absolute', bottom: -4, right: -4, width: 14, height: 14, cursor: 'nwse-resize', zIndex: 11 }} />

      <div
        onPointerDown={handleHeaderPointerDown}
        style={{
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #36353C',
          cursor: 'grab',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => onClose(cardWindow.id)}
              style={{ width: 10, height: 10, borderRadius: '50%', background: '#FF5F56', border: 'none', padding: 0, cursor: 'pointer' }}
              title="Close"
            />
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#FFBD2E' }} />
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#27C93F' }} />
          </div>

          <div
            style={{
              marginLeft: 8,
              background: '#1E1D22',
              borderRadius: 9999,
              padding: '3px 10px',
              fontSize: 12,
              color: '#8F8E94',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ color: '#E6E4E8', fontWeight: 500 }}>{cardWindow.title}</span>
            <span>|</span>
            <span style={{ color: '#265B19', background: '#E9F1DC', borderRadius: 4, padding: '1px 5px', fontSize: 10, fontWeight: 600 }}>
              ✓ Done
            </span>
          </div>
        </div>

        <div style={{ fontSize: 11, color: '#8F8E94', background: '#222126', padding: '2px 8px', borderRadius: 6 }}>
          1 learned
        </div>
      </div>

      <div
        style={{
          flex: 1,
          padding: '16px',
          overflowY: 'auto',
          color: '#E6E4E8',
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        <div style={{ color: '#8F8E94', marginBottom: 8, fontSize: 12 }}>
          {cardWindow.statusText ?? 'Autonomous Agent ready. Instructions executed.'}
        </div>
        <div style={{ background: '#222126', borderRadius: 10, padding: '12px', border: '1px solid #323037' }}>
          Hello! I am your autonomous AI expert twin. I am monitoring corporate workflows and ready to execute routine tasks.
        </div>
      </div>

      <div style={{ padding: '12px 16px' }}>
        <div
          style={{
            background: '#201F24',
            borderRadius: 14,
            border: '1px solid #323037',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <input
            type="text"
            placeholder="Ask agent anything..."
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#E6E4E8',
              fontSize: 13,
              width: '100%',
            }}
          />
          <button
            onClick={() => onActionMenuClick?.(cardWindow.id)}
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: '#2B2A30',
              border: '1px solid #3A3940',
              color: '#E6E4E8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: 15,
              marginLeft: 8,
            }}
            title="Action Menu"
          >
            +
          </button>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: -32,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#1E1D22',
          border: '1px solid #323037',
          borderRadius: 9999,
          padding: '4px 12px',
          fontSize: 11,
          color: '#8F8E94',
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            border: '2px solid #B8532F',
            borderTopColor: 'transparent',
          }}
        />
        <span>
          <strong style={{ color: '#E6E4E8' }}>{contextUsed.percent}%</strong> · {(contextUsed.usedTokens / 1000).toFixed(1)}K / {(contextUsed.maxTokens / 1000).toFixed(1)}K context used
        </span>
      </div>
    </div>
  )
}
