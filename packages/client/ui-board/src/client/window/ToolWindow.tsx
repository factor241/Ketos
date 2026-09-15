/**
 * Light window frame (connectors, settings, dashboard, and task windows) with
 * 8-direction resize. The tab strip selects which `board.window.body` occupant
 * fills the frame.
 */
import React, { useCallback } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { WindowBodyKind } from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'
import { finishBoardPointerGesture } from './pointer-cleanup.ts'

export type ToolWindowProps =
  PropsRuntime<'board.window'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>

export function ToolWindow({ window: cardWindow, renderBody, useStore, actions, t }: ToolWindowProps) {
  const zoom = useStore(s => s.zoom)
  const isActive = useStore(s => s.activeWindowId === cardWindow.id)
  const activeTab: WindowBodyKind = cardWindow.bodyKind === 'settings' ? 'settings' : 'connectors'
  const showTabs = cardWindow.kind === 'connectors' || cardWindow.kind === 'settings'

  const handleHeaderPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    actions.focusWindow(cardWindow.id)

    const startClientX = e.clientX
    const startClientY = e.clientY
    const startX = cardWindow.x
    const startY = cardWindow.y

    const onPointerMove = (moveEvt: PointerEvent) => {
      const dx = (moveEvt.clientX - startClientX) / zoom
      const dy = (moveEvt.clientY - startClientY) / zoom
      const snap = !moveEvt.shiftKey
      actions.moveWindow(cardWindow.id, startX + dx, startY + dy, snap)
    }

    const onPointerUp = (upEvt: PointerEvent) => {
      finishBoardPointerGesture(target, upEvt, onPointerMove, onPointerUp)
    }

    globalThis.addEventListener('pointermove', onPointerMove)
    globalThis.addEventListener('pointerup', onPointerUp)
  }, [cardWindow.id, cardWindow.x, cardWindow.y, zoom, actions])

  const createResizeHandler = (direction: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    actions.focusWindow(cardWindow.id)

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
        if (direction.includes('w')) actions.moveWindow(cardWindow.id, nextX, cardWindow.y, snap)
        actions.resizeWindow(cardWindow.id, nextW, nextH, snap)
      }
      if (nextH >= 200) {
        if (direction.includes('n')) actions.moveWindow(cardWindow.id, cardWindow.x, nextY, snap)
        actions.resizeWindow(cardWindow.id, nextW, nextH, snap)
      }
    }

    const onPointerUp = (upEvt: PointerEvent) => {
      finishBoardPointerGesture(target, upEvt, onPointerMove, onPointerUp)
    }

    globalThis.addEventListener('pointermove', onPointerMove)
    globalThis.addEventListener('pointerup', onPointerUp)
  }

  const tabStyle = (tab: WindowBodyKind) => ({
    padding: '4px 8px',
    fontSize: 12,
    borderRadius: 6,
    border: 'none',
    background: activeTab === tab ? '#F5EEE6' : 'transparent',
    color: activeTab === tab ? '#B8532F' : '#787570',
    fontWeight: 500,
    cursor: 'pointer',
  })

  return (
    <div
      data-board-window={cardWindow.kind}
      onPointerDown={() => { actions.focusWindow(cardWindow.id) }}
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
              onClick={() => { actions.closeWindow(cardWindow.id) }}
              style={{ width: 10, height: 10, borderRadius: '50%', background: '#FF5F56', border: 'none', padding: 0, cursor: 'pointer' }}
              title={t('window.close')}
            />
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#FFBD2E' }} />
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#27C93F' }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1C1B1F', marginLeft: 8 }}>{cardWindow.title}</span>
        </div>
        {showTabs && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => { actions.setWindowBodyKind(cardWindow.id, 'connectors') }}
              style={tabStyle('connectors')}
            >
              {t('tool.tabConnectors')}
            </button>
            <button
              onClick={() => { actions.setWindowBodyKind(cardWindow.id, 'settings') }}
              style={tabStyle('settings')}
            >
              {t('tool.tabSettings')}
            </button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, padding: 16, overflowY: 'auto', fontSize: 13, color: '#1C1B1F' }}>
        {renderBody(cardWindow)}
      </div>
    </div>
  )
}
