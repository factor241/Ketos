/**
 * Chats panel of one board window: a layer of its own beside the frame. Collapsed
 * it is a rail hugging the frame's left edge; open it is a resizable column that
 * lists the projects (workspaces) and the chats inside the selected project and
 * points the window at whichever chat is picked. In fullscreen it docks to the
 * board panel's left edge and the chat keeps a centred column beside it.
 */
import { useMemo, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import clsx from 'clsx'
import {
  IconChevronRightOutline14, IconFolderOpen16, IconNewChatOutline16, IconPanelLeftOutline16,
  IconProjectAddOutline16, Tooltip, relativeTime,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { BoardWindowInjected } from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'
import { chatGroups } from './chat-list-model.ts'
import {
  dockedPanelRect, panelPresentation, panelWidthFor, railRect, windowedPanelRect,
} from './panel-geometry.ts'
import { finishBoardPointerGesture } from './pointer-cleanup.ts'
import css from './WindowChatsPanel.module.css'

export type WindowChatsPanelProps =
  PropsRuntime<'board.window.panel'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>
  & InjectFace<BoardWindowInjected>

/** Which level the panel shows: the project list, or one project's chats. */
type PanelLevel =
  | { readonly kind: 'projects' }
  | { readonly kind: 'chats'; readonly workspaceId: WorkspaceId | undefined }

/** Relative age of one chat row, in the board's short units. */
function ageLabel(updatedAt: number, t: WindowChatsPanelProps['t']): string {
  const { unit, n } = relativeTime(updatedAt, Date.now())
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
}

export function WindowChatsPanel({
  window: cardWindow, useStore, actions, useSessionList, useWorkspaceList, useWindowSession,
  bindSession, createChat, pickWorkspace, t,
}: WindowChatsPanelProps) {
  const mounted = useStore(s => s.panelWindowId === cardWindow.id)
  const collapsed = useStore(s => s.panelCollapsed)
  const requestedWidth = useStore(s => s.panelWidth)
  const fullscreen = useStore(s => s.fullscreenWindowId === cardWindow.id)
  const viewportWidth = useStore(s => s.viewportWidth)
  const viewportHeight = useStore(s => s.viewportHeight)
  const panX = useStore(s => s.panX)
  const zoom = useStore(s => s.zoom)
  const sessionList = useSessionList(s => s)
  const workspaceList = useWorkspaceList(s => s)
  const session = useWindowSession(cardWindow.id)
  const [level, setLevel] = useState<PanelLevel>({ kind: 'projects' })

  const groups = useMemo(
    () => chatGroups(workspaceList, sessionList, session?.sessionId),
    [workspaceList, sessionList, session?.sessionId],
  )
  const project = level.kind === 'chats'
    ? groups.find(group => group.workspaceId === level.workspaceId)
    : undefined

  const view = { left: -panX / zoom, right: (-panX + viewportWidth) / zoom }
  const width = panelWidthFor(fullscreen ? viewportWidth : cardWindow.width, requestedWidth)
  const presentation = fullscreen ? { kind: 'docked' } as const : panelPresentation(cardWindow, view, width)
  // Overlay rides inside the window's left edge, so its resize handle sits on
  // the right like a panel that slid out of that edge.
  const side = presentation.kind === 'beside' ? presentation.side : 'right'
  const rect = fullscreen
    ? dockedPanelRect(viewportWidth, viewportHeight, width)
    : windowedPanelRect(cardWindow, view, width)
  const rail = railRect(cardWindow, side)

  const newChat = (): void => {
    if (project === undefined) return
    // Without a workspace the chat lands in the window's own directory, or the
    // default one when the session has no directory yet.
    if (project.workspaceId === undefined) createChat(cardWindow.id, project.cwd === '' ? {} : { cwd: project.cwd })
    else createChat(cardWindow.id, { workspaceId: project.workspaceId })
  }

  // Dragging the outer edge resizes the panel; the delta is world units like
  // every other frame gesture.
  const startResize = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.stopPropagation()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startWidth = width
    const outward = side === 'left' ? -1 : 1
    const onPointerMove = (moveEvt: PointerEvent) => {
      const delta = (moveEvt.clientX - startX) / zoom
      actions.setPanelWidth(startWidth + delta * outward)
    }
    const onPointerUp = (upEvt: PointerEvent) => {
      finishBoardPointerGesture(target, upEvt, onPointerMove, onPointerUp)
    }
    globalThis.addEventListener('pointermove', onPointerMove)
    globalThis.addEventListener('pointerup', onPointerUp)
  }

  const open = mounted && !collapsed

  return (
    <>
      {!fullscreen && !open && (
        <div
          data-board-panel-rail=""
          className={css.rail}
          style={{ left: rail.left, top: rail.top, width: rail.width, height: rail.height }}
        >
          <Tooltip label={t('panel.expand')} side="right">
            <button
              type="button"
              className={css.railButton}
              aria-label={t('panel.expand')}
              onClick={() => { actions.openWindowPanel(cardWindow.id) }}
            >
              <IconPanelLeftOutline16 />
            </button>
          </Tooltip>
          <Tooltip label={t('panel.newChat')} side="right">
            <button
              type="button"
              className={css.railButton}
              aria-label={t('panel.newChat')}
              onClick={() => {
                actions.openWindowPanel(cardWindow.id)
                setLevel({ kind: 'projects' })
              }}
            >
              <IconNewChatOutline16 />
            </button>
          </Tooltip>
          <Tooltip label={t('panel.addFolder')} side="right">
            <button
              type="button"
              className={css.railButton}
              aria-label={t('panel.addFolder')}
              onClick={() => { actions.openWindowPanel(cardWindow.id); pickWorkspace(cardWindow.id) }}
            >
              <IconProjectAddOutline16 />
            </button>
          </Tooltip>
        </div>
      )}

      <div
        data-board-panel={presentation.kind}
        data-board-panel-side={presentation.kind === 'beside' ? side : undefined}
        data-board-panel-open={open ? '' : undefined}
        aria-hidden={!open || undefined}
        className={css.panel}
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          ...(presentation.kind === 'overlay' ? { zIndex: 1000 } : {}),
        }}
      >
        <div
          className={clsx(css.resizeHandle, side === 'left' ? css.resizeLeft : css.resizeRight)}
          onPointerDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label={t('panel.resize')}
        />
        <div className={css.header}>
          {project === undefined
            ? (
              <>
                <span className={css.title}>{t('panel.projects')}</span>
                <button
                  type="button"
                  className={css.action}
                  aria-label={t('panel.addFolder')}
                  onClick={() => { pickWorkspace(cardWindow.id) }}
                >
                  <IconProjectAddOutline16 />
                </button>
              </>
            )
            : (
              <button type="button" className={css.back} onClick={() => { setLevel({ kind: 'projects' }) }}>
                <IconChevronRightOutline14 className={css.backGlyph} />
                <span className={css.title}>{project.label === '' ? t('panel.ungrouped') : project.label}</span>
              </button>
            )}
          {project !== undefined && (
            <button type="button" className={css.action} aria-label={t('panel.newChat')} onClick={newChat}>
              <IconNewChatOutline16 />
            </button>
          )}
          <Tooltip label={t('panel.collapse')} side="bottom">
            <button
              type="button"
              className={css.action}
              aria-label={t('panel.collapse')}
              onClick={() => { actions.setPanelCollapsed(true) }}
            >
              <IconPanelLeftOutline16 />
            </button>
          </Tooltip>
        </div>

        <div className={css.list}>
          {project === undefined
            ? groups.map(group => (
              <button
                key={group.workspaceId ?? 'ungrouped'}
                type="button"
                className={css.row}
                onClick={() => { setLevel({ kind: 'chats', workspaceId: group.workspaceId }) }}
              >
                <span className={css.rowIcon}><IconFolderOpen16 /></span>
                <span className={css.rowText}>{group.label === '' ? t('panel.ungrouped') : group.label}</span>
                <span className={css.rowMeta}>{group.chats.length}</span>
              </button>
            ))
            : project.chats.map(chat => (
              <button
                key={chat.id}
                type="button"
                data-board-chat-current={chat.current ? '' : undefined}
                className={clsx(css.row, chat.current && css.current)}
                onClick={() => { bindSession(cardWindow.id, chat.id) }}
              >
                <span className={css.rowText}>{chat.blank ? t('panel.newChatTitle') : chat.title}</span>
                {chat.running && <span className={css.dot} />}
                <span className={css.rowMeta}>{chat.blank ? '' : ageLabel(chat.updatedAt, t)}</span>
              </button>
            ))}
        </div>
      </div>
    </>
  )
}
