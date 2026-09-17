/**
 * Shared frame for every board window kind: the floating-panel chrome, the
 * header drag, the eight resize handles, and the optional chats-panel and
 * fullscreen controls. Board controls automation drives carry a stable
 * `data-board-action` id next to their localized label, so live audits address
 * them whatever the active locale. A kind differs only in which of those two controls it
 * offers and in the `board.window.body` occupant its `renderBody` dispatches.
 *
 * The two gestures live in leaf components that read the canvas zoom
 * themselves, so a pan or zoom re-renders the handle strips and the header —
 * never the window body. The frame is memoized on the window object and the
 * body dispatcher, so raising another window leaves it alone.
 */
import React, { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { IconCloseOutline16, IconFullscreenOutline16, IconPanelLeftOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'
import type { BoardWindowInjected, BoardWindowState } from '../contract/slots.ts'
import type { BoardTranslate } from '../locale.ts'
import { isWindowHidden } from '../canvas/culling.ts'
import { isBoardEditingTarget } from '../editing-target.ts'
import { useBoardPointerGesture } from '../pointer-gesture.ts'
import { startWindowResizeGesture } from './resize-gesture.ts'
import { RESIZE_DIRECTIONS, type ResizeDirection } from './resize.ts'
import { ExitFullscreenGlyph } from './fullscreen-glyph.tsx'
import { panelWidthFor } from './panel-geometry.ts'
import { windowTitle } from './window-title.ts'
import css from './WindowFrame.module.css'

/** Handle class per direction: the frame's border strips and corners. */
const HANDLE_CLASSES = {
  n: css.handleN,
  s: css.handleS,
  w: css.handleW,
  e: css.handleE,
  nw: css.handleNw,
  ne: css.handleNe,
  sw: css.handleSw,
  se: css.handleSe,
} as const satisfies Record<ResizeDirection, string | undefined>

/** The eight resize directions paired with their handle classes. */
const RESIZE_HANDLES = RESIZE_DIRECTIONS.map(direction => [direction, HANDLE_CLASSES[direction]] as const)

/**
 * Chrome a window kind offers beyond close and drag. A kind without a feature
 * renders neither its header control nor its keyboard behavior.
 */
export interface WindowFrameFeatures {
  /** Chats-panel toggle; its panel occupies the frame's left edge while open. */
  readonly panel?: boolean
  /** Fullscreen toggle; the frame then fills the board panel. */
  readonly fullscreen?: boolean
}

export type WindowFrameProps =
  PropsRuntime<'board.window'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>
  & InjectFace<BoardWindowInjected>
  & { readonly features?: WindowFrameFeatures }

/** Shared face of the two gesture leaves inside a frame. */
interface FrameGestureProps {
  readonly window: BoardWindowState
  readonly useStore: PropsStore<BoardStoreHandle>['useStore']
  readonly actions: PropsStore<BoardStoreHandle>['actions']
}

/** Header strip: drag-to-move, with the zoom read where the gesture starts. */
function WindowHeaderDrag({
  window: cardWindow, useStore, actions, disabled, children,
}: FrameGestureProps & { readonly disabled: boolean; readonly children: ReactNode }) {
  const zoom = useStore(s => s.zoom)
  const startGesture = useBoardPointerGesture()

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    if ((e.target as HTMLElement).closest('button, input, textarea') !== null) return
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    actions.focusWindow(cardWindow.id)

    const startClientX = e.clientX
    const startClientY = e.clientY
    const startX = cardWindow.x
    const startY = cardWindow.y

    startGesture(target, e.pointerId, {
      move: (moveEvt) => {
        const dx = (moveEvt.clientX - startClientX) / zoom
        const dy = (moveEvt.clientY - startClientY) / zoom
        actions.moveWindow(cardWindow.id, startX + dx, startY + dy, !moveEvt.shiftKey)
      },
    })
  }, [cardWindow.id, cardWindow.x, cardWindow.y, zoom, disabled, actions, startGesture])

  return <div onPointerDown={handlePointerDown} className={css.header}>{children}</div>
}

/** One resize handle: it owns the gesture and the zoom read for that gesture. */
function WindowResizeHandle({
  window: cardWindow, useStore, actions, direction, className,
}: FrameGestureProps & { readonly direction: ResizeDirection; readonly className: string | undefined }) {
  const zoom = useStore(s => s.zoom)
  const startGesture = useBoardPointerGesture()

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    startWindowResizeGesture({
      event,
      window: cardWindow,
      direction,
      zoom,
      actions,
      start: (element, pointerId, handlers) => { startGesture(element, pointerId, handlers) },
    })
  }, [cardWindow, direction, zoom, actions, startGesture])

  return <div data-board-handle={direction} onPointerDown={handlePointerDown} className={clsx(css.handle, className)} />
}

interface WindowTitleControlProps {
  readonly window: BoardWindowState
  readonly t: BoardTranslate
  readonly actions: PropsStore<BoardStoreHandle>['actions']
  readonly useWindowSession: InjectFace<BoardWindowInjected>['useWindowSession']
}

/**
 * Header name of one window: the only subscriber to the window channel in the
 * frame. It keeps a streamed chunk from re-rendering the frame's chrome and
 * handles, and it owns the in-place rename editor.
 */
function WindowTitleControl({ window: cardWindow, t, actions, useWindowSession }: WindowTitleControlProps) {
  const session = useWindowSession(cardWindow.id)
  const title = windowTitle(t, cardWindow, session?.displayTitle)
  const [renameDraft, setRenameDraft] = useState<string | null>(null)
  // Escape unmounts the input, and the node's blur must not commit the draft.
  const renameCancelled = useRef(false)

  const commitRename = (value: string): void => {
    actions.setWindowCustomTitle(cardWindow.id, value)
    setRenameDraft(null)
  }

  if (renameDraft !== null) {
    return (
      <input
        className={css.titleInput}
        value={renameDraft}
        autoFocus
        aria-label={t('window.rename')}
        data-board-action="window-title-input"
        onChange={(e) => { setRenameDraft(e.target.value) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commitRename(renameDraft)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            renameCancelled.current = true
            setRenameDraft(null)
          }
        }}
        onBlur={() => {
          if (renameCancelled.current) {
            renameCancelled.current = false
            setRenameDraft(null)
            return
          }
          commitRename(renameDraft)
        }}
      />
    )
  }
  return (
    <Tooltip label={t('window.rename')} side="bottom">
      <button
        type="button"
        data-board-action="window-rename"
        data-board-title={title}
        className={css.titleButton}
        aria-label={title}
        onClick={() => {
          renameCancelled.current = false
          setRenameDraft(cardWindow.customTitle ?? '')
        }}
      >
        <span className={css.title}>{title}</span>
      </button>
    </Tooltip>
  )
}

function WindowFrameView({
  window: cardWindow, renderBody, useStore, actions, t, features, useWindowSession,
}: WindowFrameProps) {
  const isActive = useStore(s => s.activeWindowId === cardWindow.id)
  const fullscreenWindowId = useStore(s => s.fullscreenWindowId)
  const panelWindowId = useStore(s => s.panelWindowId)
  const viewportWidth = useStore(s => s.viewportWidth)
  const panelWidth = useStore(s => s.panelWidth)
  const panelCollapsed = useStore(s => s.panelCollapsed)
  // Culled and fullscreen-hidden windows stay mounted: their lane, draft,
  // attachments, and panel keep their state and return unchanged.
  const hidden = useStore(s => isWindowHidden(s, cardWindow))
  const isSelectingElement = useStore(s => s.isSelectingElement)
  const isFullscreen = features?.fullscreen === true && fullscreenWindowId === cardWindow.id
  // A collapsed panel is a rail: it takes no width, and Escape leaves it alone.
  const isPanelOpen = features?.panel === true && panelWindowId === cardWindow.id && !panelCollapsed
  // Fullscreen docks the chats panel and gives up its width to the chat column.
  const dockedWidth = isPanelOpen ? panelWidthFor(viewportWidth, panelWidth) : 0

  // Escape closes the chats panel first and leaves fullscreen second: one
  // handler owns the key so the two modes never fight over it. The board's
  // ladder is menu -> editor -> selection overlay -> panel -> fullscreen, so
  // this handler stands down while the selection overlay is active.
  useEffect(() => {
    if (isSelectingElement) return
    if (!isFullscreen && !isPanelOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.querySelector('[role="menu"]') !== null) return
      if (isBoardEditingTarget(e.target)) return
      if (isPanelOpen) actions.closeWindowPanel()
      else actions.exitFullscreen()
    }
    globalThis.addEventListener('keydown', onKeyDown)
    return () => { globalThis.removeEventListener('keydown', onKeyDown) }
  }, [isSelectingElement, isFullscreen, isPanelOpen, actions])

  return (
    <div
      data-board-window={cardWindow.kind}
      data-board-window-id={cardWindow.id}
      data-board-fullscreen={isFullscreen ? '' : undefined}
      data-board-culled={hidden ? '' : undefined}
      className={clsx(css.window, isActive && css.active, isFullscreen && css.fullscreen, hidden && css.hidden)}
      onPointerDown={() => { actions.focusWindow(cardWindow.id) }}
      style={isFullscreen
        // The canvas drops its pan/zoom while a window is fullscreen, so the
        // inset rectangle maps to the visible board panel; an open chats panel
        // docks along its left edge and takes that width from the chat.
        ? { inset: `0 0 0 ${String(dockedWidth)}px`, zIndex: 1000 }
        : {
          left: cardWindow.x,
          top: cardWindow.y,
          width: cardWindow.width,
          height: cardWindow.height,
          zIndex: cardWindow.zIndex,
        }}
    >
      {!isFullscreen && RESIZE_HANDLES.map(([direction, handleClass]) => (
        <WindowResizeHandle
          key={direction}
          window={cardWindow}
          useStore={useStore}
          actions={actions}
          direction={direction}
          className={handleClass}
        />
      ))}

      <WindowHeaderDrag
        window={cardWindow}
        useStore={useStore}
        actions={actions}
        disabled={isFullscreen}
      >
        <div className={css.headerLeft}>
          <Tooltip label={t('window.close')} side="bottom">
            <button
              type="button"
              data-board-action="window-close"
              onClick={() => { actions.closeWindow(cardWindow.id) }}
              className={css.headerButton}
              aria-label={t('window.close')}
            >
              <IconCloseOutline16 />
            </button>
          </Tooltip>
          {features?.panel === true && (
            <Tooltip label={t('window.chats')} side="bottom">
              <button
                type="button"
                data-board-action="window-chats"
                onClick={() => {
                  if (isPanelOpen) actions.closeWindowPanel()
                  else actions.openWindowPanel(cardWindow.id)
                }}
                className={css.headerButton}
                aria-label={t('window.chats')}
                aria-expanded={isPanelOpen}
              >
                <IconPanelLeftOutline16 />
              </button>
            </Tooltip>
          )}
          <WindowTitleControl
            window={cardWindow}
            t={t}
            actions={actions}
            useWindowSession={useWindowSession}
          />
        </div>
        {features?.fullscreen === true && (
          <div className={css.headerRight}>
            <Tooltip label={t(isFullscreen ? 'window.exitFullscreen' : 'window.fullscreen')} side="bottom">
              <button
                type="button"
                data-board-action="window-fullscreen"
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
        )}
      </WindowHeaderDrag>

      <div className={css.body}>
        {renderBody(cardWindow)}
      </div>
    </div>
  )
}

/**
 * The frame, memoized on its props: the window object and the body dispatcher
 * are stable between store changes that do not touch this window, so raising,
 * culling, or moving another window does not re-render this one.
 */
export const WindowFrame = memo(WindowFrameView)
