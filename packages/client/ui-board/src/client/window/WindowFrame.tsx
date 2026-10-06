/**
 * Shared frame for every board window kind: the floating-panel chrome, the
 * header drag, the eight resize handles, and the optional expand-to-standard
 * control.
 * The chats panel is a window body of its own (`board.window.panel`), and its
 * own rail and header carry the controls that open and collapse it. Board
 * controls automation drives carry a stable `data-board-action` id next to
 * their localized label, so live audits address them whatever the active
 * locale. A kind differs only in whether it offers the expand control and
 * in the `board.window.body` occupant its `renderBody` dispatches.
 *
 * The two gestures live in leaf components that read the canvas zoom
 * themselves, so a pan or zoom re-renders the handle strips and the header —
 * never the window body. The frame is memoized on the window object and the
 * body dispatcher, so raising another window leaves it alone.
 */
import React, { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconCloseOutlineRegular, IconFullscreenOutlineRegular, IconPanelLeftOutlineRegular, StateDot, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'
import type { BoardWindowInjected, BoardWindowState } from '../contract/slots.ts'
import type { BoardTranslate } from '../locale.ts'
import { isWindowHidden } from '../culling.ts'
import { isBoardEditingTarget } from '../editing-target.ts'
import { canManageWindow, ownerColorAttr } from '../owners.ts'
import { useBoardPointerGesture } from '../pointer-gesture.ts'
import { startWindowResizeGesture } from '../resize-gesture.ts'
import { RESIZE_DIRECTIONS, type ResizeDirection } from '../resize.ts'
import { windowTitle } from '../window-title.ts'
import { WINDOW_STATUS_DOT, WINDOW_STATUS_KEY, windowStatus } from '../window-status.ts'
import { CloneWindowBar } from './CloneWindowBar.tsx'
import { WindowBezel } from './WindowBezel.tsx'
import { useWindowDragStart } from './window-drag.ts'
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
  /**
   * Expand-to-standard control: the chat windows' header button that hands
   * the session to the standard interface (Т2.1). Only chat windows offer it.
   */
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

/** Header strip: drag-to-move through the shared window-drag hook. */
function WindowHeaderDrag({
  window: cardWindow, useStore, actions, children,
}: FrameGestureProps & { readonly children: ReactNode }) {
  const handlePointerDown = useWindowDragStart(cardWindow, useStore, actions)

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
  readonly useCloneList: InjectFace<BoardWindowInjected>['useCloneList']
}

/**
 * Header name of one window: the only subscriber to the window channel in the
 * frame. It keeps a streamed chunk from re-rendering the frame's chrome and
 * handles, and it owns the in-place rename editor.
 */
function WindowTitleControl({ window: cardWindow, t, actions, useWindowSession, useCloneList }: WindowTitleControlProps) {
  const session = useWindowSession(cardWindow.id)
  // A clone window is named by the record it edits, not by the interview
  // session running inside it.
  const clone = useCloneList(roster => cardWindow.cloneId === undefined
    ? undefined
    : roster.clones.find(entry => entry.id === cardWindow.cloneId))
  const title = windowTitle(t, cardWindow, session?.displayTitle, clone?.name)
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

interface WindowSimplifiedCardProps {
  readonly window: BoardWindowState
  readonly t: BoardTranslate
  readonly detailZoomThreshold: number
  readonly actions: PropsStore<BoardStoreHandle>['actions']
  readonly useWindowSession: InjectFace<BoardWindowInjected>['useWindowSession']
  readonly useCloneList: InjectFace<BoardWindowInjected>['useCloneList']
}

/**
 * Simplified card shown below the detail threshold (Д6.1): the window's name
 * and session status, with no interactive chrome. The frame lives inside the
 * canvas transform, so the type is world-sized as `12 / threshold` — at the
 * threshold it renders at least 12 screen pixels. Clicking restores the detail
 * view: the zoom rises to the threshold and the window is centred.
 */
function WindowSimplifiedCard({
  window: cardWindow, t, detailZoomThreshold, actions, useWindowSession, useCloneList,
}: WindowSimplifiedCardProps) {
  const session = useWindowSession(cardWindow.id)
  // A clone window is named by the record it edits, not by the interview
  // session running inside it.
  const clone = useCloneList(roster => cardWindow.cloneId === undefined
    ? undefined
    : roster.clones.find(entry => entry.id === cardWindow.cloneId))
  const title = windowTitle(t, cardWindow, session?.displayTitle, clone?.name)
  const status = session === undefined ? null : windowStatus(session)
  const fontSize = Math.ceil(12 / detailZoomThreshold)
  // Restore runs on the pointerdown as well as the click: raising the window
  // reorders the window layer, and a real click whose button moved in the DOM
  // between down and up is never delivered. A non-primary button is not an
  // activation.
  const restore = (): void => {
    actions.setZoom(detailZoomThreshold)
    actions.centerOnWindow(cardWindow.id)
  }
  return (
    <button
      type="button"
      data-board-action="window-simplified-card"
      data-board-status={status ?? undefined}
      className={css.simplifiedCard}
      style={{ fontSize: `${String(fontSize)}px` }}
      aria-label={title}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        restore()
      }}
      onClick={restore}
    >
      <span className={css.simplifiedTitle}>{title}</span>
      {status !== null && (
        <span className={css.simplifiedMeta}>
          <StateDot state={WINDOW_STATUS_DOT[status]} size={Math.max(8, Math.round(fontSize * 0.75))} />
          {t(WINDOW_STATUS_KEY[status])}
        </span>
      )}
    </button>
  )
}

function WindowFrameView({
  window: cardWindow, renderBody, useStore, actions, t, features, useWindowSession, useCloneList, refreshClones,
  detailZoomThreshold, expandToStandard,
}: WindowFrameProps) {
  const isActive = useStore(s => s.activeWindowId === cardWindow.id)
  const returned = useStore(s => s.highlightWindowId === cardWindow.id)
  // The owner color and the management predicate select the bezel palette and
  // the attribute later stages read; both come from the store so the owner
  // source can move without touching the frame.
  const ownerColor = useStore(s => ownerColorAttr(s, cardWindow.ownerId))
  const manageable = useStore(s => canManageWindow(s, cardWindow))
  const leftPanelOpen = cardWindow.leftPanelOpen === true
  const rightPanelOpen = cardWindow.rightPanelOpen === true
  // Culled windows stay mounted: their lane, draft,
  // attachments, and panel keep their state and return unchanged.
  const hidden = useStore(s => isWindowHidden(s, cardWindow))
  const isSelectingElement = useStore(s => s.isSelectingElement)
  const hasPanel = features?.panel === true
  // Below the detail threshold the frame swaps its chrome for the simplified
  // card (Д6.1).
  const simplified = useStore(s => s.zoom < detailZoomThreshold)
  // Escape closes whichever panel of this window is open; a closed panel
  // takes no width and Escape leaves it alone.
  const isPanelOpen = hasPanel && (leftPanelOpen || rightPanelOpen)

  // Escape closes the chats panel: one handler owns the key. The board's
  // ladder is menu -> editor -> selection overlay -> panel, so this handler
  // stands down while the selection overlay is active.
  useEffect(() => {
    if (isSelectingElement) return
    if (!isPanelOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.querySelector('[role="menu"]') !== null) return
      if (isBoardEditingTarget(e.target)) return
      if (leftPanelOpen) actions.setWindowPanel(cardWindow.id, 'left', false)
      if (rightPanelOpen) actions.setWindowPanel(cardWindow.id, 'right', false)
    }
    globalThis.addEventListener('keydown', onKeyDown)
    return () => { globalThis.removeEventListener('keydown', onKeyDown) }
  }, [isSelectingElement, isPanelOpen, leftPanelOpen, rightPanelOpen, actions, cardWindow.id])

  return (
    <div
      data-board-window={cardWindow.kind}
      data-board-window-id={cardWindow.id}
      data-board-owner-color={ownerColor}
      data-board-manageable={manageable ? '' : undefined}
      data-board-panel-left-open={leftPanelOpen ? '' : undefined}
      data-board-panel-right-open={rightPanelOpen ? '' : undefined}
      data-board-culled={hidden ? '' : undefined}
      className={clsx(
        css.window,
        isActive && css.active,
        returned && css.returned,
        simplified && css.simplified,
        hidden && css.hidden,
      )}
      onPointerDown={() => { actions.focusWindow(cardWindow.id) }}
      style={{
        left: cardWindow.x,
        top: cardWindow.y,
        width: cardWindow.width,
        height: cardWindow.height,
        zIndex: cardWindow.zIndex,
      }}
    >
      {/* The owner bezel paints under the surface; below the detail threshold
          the window keeps only the owner edge (Д6.1). */}
      {!simplified && (
        <WindowBezel
          window={cardWindow}
          t={t}
          useStore={useStore}
          actions={actions}
        />
      )}

      {!simplified && RESIZE_HANDLES.map(([direction, handleClass]) => (
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
              <IconCloseOutlineRegular />
            </button>
          </Tooltip>
          {/* The window's two panels replace the old rail: the left one holds
              the working folders, the right one the file tabs (Т3.2). */}
          {hasPanel && (
            <Tooltip label={t('window.leftPanel')} side="bottom">
              <button
                type="button"
                data-board-action="window-left-panel"
                onClick={() => { actions.setWindowPanel(cardWindow.id, 'left', !leftPanelOpen) }}
                className={clsx(css.headerButton, leftPanelOpen && css.headerButtonActive)}
                aria-pressed={leftPanelOpen}
                aria-label={t('window.leftPanel')}
              >
                <IconPanelLeftOutlineRegular />
              </button>
            </Tooltip>
          )}
          <WindowTitleControl
            window={cardWindow}
            t={t}
            actions={actions}
            useWindowSession={useWindowSession}
            useCloneList={useCloneList}
          />
        </div>
        {(hasPanel || features?.fullscreen === true) && (
          <div className={css.headerRight}>
            {hasPanel && (
              <Tooltip label={t('window.rightPanel')} side="bottom">
                <button
                  type="button"
                  data-board-action="window-right-panel"
                  onClick={() => { actions.setWindowPanel(cardWindow.id, 'right', !rightPanelOpen) }}
                  className={clsx(css.headerButton, rightPanelOpen && css.headerButtonActive)}
                  aria-pressed={rightPanelOpen}
                  aria-label={t('window.rightPanel')}
                >
                  <IconPanelLeftOutlineRegular className={css.panelRightIcon} />
                </button>
              </Tooltip>
            )}
            {features.fullscreen === true && (
              <Tooltip label={t('window.fullscreen')} side="bottom">
                <button
                  type="button"
                  data-board-action="window-fullscreen"
                  onClick={() => { expandToStandard(cardWindow.id) }}
                  className={css.headerButton}
                  aria-label={t('window.fullscreen')}
                >
                  <IconFullscreenOutlineRegular />
                </button>
              </Tooltip>
            )}
          </div>
        )}
      </WindowHeaderDrag>

      {/* The clone window's tab bar and interview status; it owns the window
          channel subscription so a streamed chunk never re-renders the frame. */}
      {cardWindow.kind === 'clone' && (
        <CloneWindowBar
          window={cardWindow}
          actions={actions}
          t={t}
          useWindowSession={useWindowSession}
          useCloneList={useCloneList}
          refreshClones={refreshClones}
        />
      )}

      <div className={css.body}>
        {renderBody(cardWindow)}
      </div>

      {/* The detail chrome above stays mounted but hidden (CSS), so the card
          adds no state changes of its own on the way in and out. */}
      {simplified && (
        <WindowSimplifiedCard
          window={cardWindow}
          t={t}
          detailZoomThreshold={detailZoomThreshold}
          actions={actions}
          useWindowSession={useWindowSession}
          useCloneList={useCloneList}
        />
      )}
    </div>
  )
}

/**
 * The frame, memoized on its props: the window object and the body dispatcher
 * are stable between store changes that do not touch this window, so raising,
 * culling, or moving another window does not re-render this one.
 */
export const WindowFrame = memo(WindowFrameView)
