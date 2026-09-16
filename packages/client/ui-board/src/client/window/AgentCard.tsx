/**
 * Window frame (agent and clone windows) with 8-direction resize.
 */
import React, { useCallback } from 'react'
import clsx from 'clsx'
import { IconCloseOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'
import { finishBoardPointerGesture } from './pointer-cleanup.ts'
import css from './AgentCard.module.css'

export type AgentCardProps =
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

  return (
    <div
      data-board-window={cardWindow.kind}
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
          <Tooltip label={t('window.close')} side="bottom">
            <button
              type="button"
              onClick={() => { actions.closeWindow(cardWindow.id) }}
              className={css.closeButton}
              aria-label={t('window.close')}
            >
              <IconCloseOutline16 />
            </button>
          </Tooltip>
          <span className={css.title}>{cardWindow.title}</span>
        </div>
      </div>

      <div className={css.body}>
        {renderBody(cardWindow)}
      </div>
    </div>
  )
}
