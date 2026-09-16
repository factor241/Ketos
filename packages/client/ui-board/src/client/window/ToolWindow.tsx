/**
 * Tool-window frame (connectors, settings, dashboard, and task windows) with
 * 8-direction resize. The frame supplies chrome and the content region; the
 * `board.window.body` occupant selected by `bodyKind` fills the region.
 */
import React, { useCallback } from 'react'
import clsx from 'clsx'
import { IconCloseOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'
import { finishBoardPointerGesture } from './pointer-cleanup.ts'
import { resizeStep, type ResizeDirection } from './resize.ts'
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
] as const satisfies readonly (readonly [ResizeDirection, string | undefined])[]

export function ToolWindow({ window: cardWindow, renderBody, useStore, actions, t }: ToolWindowProps) {
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

  const createResizeHandler = (direction: ResizeDirection) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    actions.focusWindow(cardWindow.id)

    const start = {
      x: cardWindow.x,
      y: cardWindow.y,
      width: cardWindow.width,
      height: cardWindow.height,
    }
    const startClientX = e.clientX
    const startClientY = e.clientY

    const onPointerMove = (moveEvt: PointerEvent) => {
      const dx = (moveEvt.clientX - startClientX) / zoom
      const dy = (moveEvt.clientY - startClientY) / zoom
      const snap = !moveEvt.shiftKey
      // The step already snapped and clamped to the minimum; the store's
      // actions re-apply the same rules idempotently.
      const next = resizeStep(direction, start, dx, dy, snap)
      if (next.x !== start.x || next.y !== start.y) {
        actions.moveWindow(cardWindow.id, next.x, next.y, false)
      }
      actions.resizeWindow(cardWindow.id, next.width, next.height, false)
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
              className={css.headerButton}
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
