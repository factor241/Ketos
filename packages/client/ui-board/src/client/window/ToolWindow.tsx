/**
 * Light window frame (connectors, settings, dashboard, and task windows) with
 * 8-direction resize. The tab strip selects which `board.window.body` occupant
 * fills the frame. The `data-board-surface` marker hands the frame to the
 * ui-theme brand layer's light palette rebind.
 */
import React, { useCallback } from 'react'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { WindowBodyKind } from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'
import { finishBoardPointerGesture } from './pointer-cleanup.ts'
import css from './ToolWindow.module.css'

export type ToolWindowProps =
  PropsRuntime<'board.window'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>

/** The 8 resize directions paired with their handle classes. */
const RESIZE_HANDLES = [
  ['n', css.handleN],
  ['s', css.handleS],
  ['w', css.handleW],
  ['e', css.handleE],
  ['nw', css.handleNw],
  ['ne', css.handleNe],
  ['sw', css.handleSw],
  ['se', css.handleSe],
] as const

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

  return (
    <div
      data-board-window={cardWindow.kind}
      data-board-surface="light"
      className={clsx(css.window, isActive && css.active)}
      onPointerDown={() => { actions.focusWindow(cardWindow.id) }}
      style={{
        left: cardWindow.x,
        top: cardWindow.y,
        width: cardWindow.width,
        height: cardWindow.height,
        zIndex: cardWindow.zIndex,
      }}
    >
      {RESIZE_HANDLES.map(([direction, handleClass]) => (
        <div
          key={direction}
          onPointerDown={createResizeHandler(direction)}
          className={clsx(css.handle, handleClass)}
        />
      ))}

      <div onPointerDown={handleHeaderPointerDown} className={css.header}>
        <div className={css.headerLeft}>
          <div className={css.traffic}>
            <button
              onClick={() => { actions.closeWindow(cardWindow.id) }}
              className={clsx(css.trafficDot, css.trafficClose)}
              title={t('window.close')}
            />
            <div className={clsx(css.trafficDot, css.trafficMinimize)} />
            <div className={clsx(css.trafficDot, css.trafficZoom)} />
          </div>
          <span className={css.title}>{cardWindow.title}</span>
        </div>
        {showTabs && (
          <div className={css.tabs}>
            <button
              onClick={() => { actions.setWindowBodyKind(cardWindow.id, 'connectors') }}
              className={clsx(css.tab, activeTab === 'connectors' && css.active)}
            >
              {t('tool.tabConnectors')}
            </button>
            <button
              onClick={() => { actions.setWindowBodyKind(cardWindow.id, 'settings') }}
              className={clsx(css.tab, activeTab === 'settings' && css.active)}
            >
              {t('tool.tabSettings')}
            </button>
          </div>
        )}
      </div>

      <div className={css.body}>
        {renderBody(cardWindow)}
      </div>
    </div>
  )
}
