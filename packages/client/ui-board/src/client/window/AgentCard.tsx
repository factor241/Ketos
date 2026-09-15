/**
 * Dark window frame (agent and clone windows) with 8-direction resize.
 */
import React, { useCallback } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'
import { finishBoardPointerGesture } from './pointer-cleanup.ts'

export type AgentCardProps =
  PropsRuntime<'board.window'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>

export function AgentCard({ window: cardWindow, renderBody, useStore, actions, t }: AgentCardProps) {
  const zoom = useStore(s => s.zoom)
  const isActive = useStore(s => s.activeWindowId === cardWindow.id)

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

  const contextUsed = cardWindow.contextUsed ?? { usedTokens: 32900, maxTokens: 200000, percent: 16.4 }

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
              onClick={() => { actions.closeWindow(cardWindow.id) }}
              style={{ width: 10, height: 10, borderRadius: '50%', background: '#FF5F56', border: 'none', padding: 0, cursor: 'pointer' }}
              title={t('window.close')}
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
              {t('agent.doneBadge')}
            </span>
          </div>
        </div>

        <div style={{ fontSize: 11, color: '#8F8E94', background: '#222126', padding: '2px 8px', borderRadius: 6 }}>
          {t('agent.learnedCount')}
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
        {renderBody(cardWindow)}
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
            placeholder={t('agent.composerPlaceholder')}
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
            onClick={() => { actions.setSelectingElement(true) }}
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
            title={t('agent.actionMenu')}
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
          <strong style={{ color: '#E6E4E8' }}>{contextUsed.percent}%</strong> · {t('agent.contextUsed', { used: (contextUsed.usedTokens / 1000).toFixed(1), max: (contextUsed.maxTokens / 1000).toFixed(1) })}
        </span>
      </div>
    </div>
  )
}
