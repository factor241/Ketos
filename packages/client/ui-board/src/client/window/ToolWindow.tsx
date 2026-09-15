/**
 * Light Tool Window (Connectors, Settings, Dashboards) with 8-direction resize.
 */
import React, { useCallback, useState } from 'react'
import type { BoardWindowState, WindowId } from '../contract/slots.ts'
import type { BoardTranslate } from '../locale.ts'
import { finishBoardPointerGesture } from './pointer-cleanup.ts'

export interface ToolWindowProps {
  /** Locale seat resolving this window's copy. */
  t: BoardTranslate
  cardWindow: BoardWindowState
  zoom: number
  isActive: boolean
  onFocus: (id: WindowId) => void
  onMove: (id: WindowId, x: number, y: number, snap: boolean) => void
  onResize: (id: WindowId, width: number, height: number, snap: boolean) => void
  onClose: (id: WindowId) => void
}

export function ToolWindow({
  t,
  cardWindow,
  zoom,
  isActive,
  onFocus,
  onMove,
  onResize,
  onClose,
}: ToolWindowProps) {
  const [activeTab, setActiveTab] = useState<'connectors' | 'settings'>('connectors')

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
      finishBoardPointerGesture(e.currentTarget, upEvt, onPointerMove, onPointerUp)
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
      finishBoardPointerGesture(e.currentTarget, upEvt, onPointerMove, onPointerUp)
    }

    globalThis.addEventListener('pointermove', onPointerMove)
    globalThis.addEventListener('pointerup', onPointerUp)
  }

  return (
    <div
      onPointerDown={() => { onFocus(cardWindow.id) }}
      style={{
        position: 'absolute',
        left: cardWindow.x,
        top: cardWindow.y,
        width: cardWindow.width,
        height: cardWindow.height,
        zIndex: cardWindow.zIndex,
        background: '#FFFFFF',
        borderRadius: 18,
        border: isActive ? '1px solid #B8532F' : '1px solid #E8E6E1',
        boxShadow: isActive
          ? '0 20px 48px -8px rgba(0, 0, 0, 0.12), 0 6px 16px -4px rgba(0, 0, 0, 0.06)'
          : '0 16px 36px -6px rgba(0, 0, 0, 0.06), 0 4px 12px -2px rgba(0, 0, 0, 0.03)',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
        overflow: 'hidden',
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
          borderBottom: '1px solid #F0EEEA',
          background: '#FAFAF8',
          cursor: 'grab',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => { onClose(cardWindow.id) }}
              style={{ width: 10, height: 10, borderRadius: '50%', background: '#FF5F56', border: 'none', padding: 0, cursor: 'pointer' }}
              title={t('window.close')}
            />
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#FFBD2E' }} />
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#27C93F' }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1C1B1F', marginLeft: 8 }}>{cardWindow.title}</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => { setActiveTab('connectors') }}
            style={{
              padding: '4px 8px',
              fontSize: 12,
              borderRadius: 6,
              border: 'none',
              background: activeTab === 'connectors' ? '#F5EEE6' : 'transparent',
              color: activeTab === 'connectors' ? '#B8532F' : '#787570',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {t('tool.tabConnectors')}
          </button>
          <button
            onClick={() => { setActiveTab('settings') }}
            style={{
              padding: '4px 8px',
              fontSize: 12,
              borderRadius: 6,
              border: 'none',
              background: activeTab === 'settings' ? '#F5EEE6' : 'transparent',
              color: activeTab === 'settings' ? '#B8532F' : '#787570',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {t('tool.tabSettings')}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, padding: 16, overflowY: 'auto', fontSize: 13, color: '#1C1B1F' }}>
        {activeTab === 'connectors' ? (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 8, color: '#787570', fontSize: 11, textTransform: 'uppercase' }}>
              {t('tool.connectorsHeading')}
            </div>
            {[
              { name: t('tool.coreName'), desc: t('tool.coreDesc'), enabled: true },
              { name: t('tool.webSearchName'), desc: t('tool.webSearchDesc'), enabled: true },
              { name: t('tool.inspectorName'), desc: t('tool.inspectorDesc'), enabled: true },
              { name: t('tool.temporalName'), desc: t('tool.temporalDesc'), enabled: true },
              { name: t('tool.mcpName'), desc: t('tool.mcpDesc'), enabled: false },
            ].map((tool, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: '#FAFAF8',
                  marginBottom: 8,
                  border: '1px solid #F0EEEA',
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{tool.name}</div>
                  <div style={{ fontSize: 11, color: '#787570' }}>{tool.desc}</div>
                </div>
                <div
                  style={{
                    width: 32,
                    height: 18,
                    borderRadius: 9999,
                    background: tool.enabled ? '#B8532F' : '#E0DED9',
                    position: 'relative',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: '#FFFFFF',
                      position: 'absolute',
                      top: 2,
                      left: tool.enabled ? 16 : 2,
                      transition: 'left 0.15s ease',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 12, color: '#787570', fontSize: 11, textTransform: 'uppercase' }}>
              {t('tool.agentConfigHeading')}
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>{t('tool.systemPrompt')}</label>
              <textarea
                defaultValue={t('tool.defaultSystemPrompt')}
                rows={3}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid #E8E6E1',
                  fontSize: 12,
                  outline: 'none',
                  fontFamily: 'inherit',
                  resize: 'none',
                }}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>{t('tool.modelSelection')}</label>
              <select
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid #E8E6E1',
                  fontSize: 12,
                  background: '#FFFFFF',
                }}
              >
                <option>{t('tool.modelDeepSeekV3')}</option>
                <option>{t('tool.modelDeepSeekR1')}</option>
                <option>{t('tool.modelLocalVllm')}</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
