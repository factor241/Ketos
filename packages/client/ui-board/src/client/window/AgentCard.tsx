/**
 * Window frame (agent and clone windows) with 8-direction resize.
 */
import React, { useCallback, useEffect } from 'react'
import clsx from 'clsx'
import { IconCloseOutline16, IconFullscreenOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'
import { finishBoardPointerGesture } from './pointer-cleanup.ts'
import { resizeStep, type ResizeDirection } from './resize.ts'
import { ExitFullscreenGlyph } from './fullscreen-glyph.tsx'
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
] as const satisfies readonly (readonly [ResizeDirection, string | undefined])[]

export function AgentCard({ window: cardWindow, renderBody, useStore, actions, t }: AgentCardProps) {
  const zoom = useStore(s => s.zoom)
  const isActive = useStore(s => s.activeWindowId === cardWindow.id)
  const isFullscreen = useStore(s => s.fullscreenWindowId === cardWindow.id)

  // Escape leaves the mode; the header toggle does the same.
  useEffect(() => {
    if (!isFullscreen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') actions.exitFullscreen()
    }
    globalThis.addEventListener('keydown', onKeyDown)
    return () => { globalThis.removeEventListener('keydown', onKeyDown) }
  }, [isFullscreen, actions])

  const handleHeaderPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isFullscreen) return
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
  }, [cardWindow.id, cardWindow.x, cardWindow.y, zoom, isFullscreen, actions])

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
      data-board-fullscreen={isFullscreen ? '' : undefined}
      className={clsx(css.window, isActive && css.active, isFullscreen && css.fullscreen)}
      onPointerDown={() => { actions.focusWindow(cardWindow.id) }}
      style={isFullscreen
        // The canvas drops its pan/zoom while a window is fullscreen, so the
        // inset rectangle maps to the visible board panel.
        ? { inset: 0, zIndex: 1000 }
        : {
          left: cardWindow.x,
          top: cardWindow.y,
          width: cardWindow.width,
          height: cardWindow.height,
          zIndex: cardWindow.zIndex,
        }}
    >
      {!isFullscreen && RESIZE_HANDLES.map(([direction, handleClass]) => (
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
        <div className={css.headerRight}>
          <Tooltip label={t(isFullscreen ? 'window.exitFullscreen' : 'window.fullscreen')} side="bottom">
            <button
              type="button"
              onClick={() => {
                if (isFullscreen) actions.exitFullscreen()
                else actions.setWindowFullscreen(cardWindow.id)
              }}
              className={css.headerButton}
              aria-label={t(isFullscreen ? 'window.exitFullscreen' : 'window.fullscreen')}
            >
              {isFullscreen ? <ExitFullscreenGlyph /> : <IconFullscreenOutline16 />}
            </button>
          </Tooltip>
        </div>
      </div>

      <div className={css.body}>
        {renderBody(cardWindow)}
      </div>
    </div>
  )
}
