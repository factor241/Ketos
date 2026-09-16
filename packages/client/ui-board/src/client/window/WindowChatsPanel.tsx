/**
 * Chats panel of one board window: a compact companion layer that lists the
 * projects (workspaces) and the chats inside the selected project, and points
 * the window at whichever chat is picked. Windowed it hides under the frame's
 * left edge and shows a narrow strip; in fullscreen it docks to the board
 * panel's left edge and the chat keeps a centred column beside it.
 */
import { useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  IconChevronRightOutline14, IconFolderOpen16, IconNewChatOutline16, IconProjectAddOutline16,
  relativeTime,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { BoardWindowInjected } from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'
import { chatGroups } from './chat-list-model.ts'
import { dockedPanelRect, panelPresentation, windowedPanelRect } from './panel-geometry.ts'
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
  window: cardWindow, useStore, useSessionList, useWorkspaceList, useWindowSession,
  bindSession, createChat, pickWorkspace, t,
}: WindowChatsPanelProps) {
  const open = useStore(s => s.panelWindowId === cardWindow.id)
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
  const rect = fullscreen ? dockedPanelRect(viewportWidth, viewportHeight) : windowedPanelRect(cardWindow, view)
  // A window covering the visible canvas has no side to protrude on: the panel
  // then rides inside its left edge, above the frame.
  const presentation = fullscreen ? { kind: 'docked' } as const : panelPresentation(cardWindow, view)
  const mode = presentation.kind
  const side = presentation.kind === 'tucked' ? presentation.side : undefined

  const newChat = (): void => {
    if (project === undefined) return
    // Without a workspace the chat lands in the window's own directory, or the
    // default one when the session has no directory yet.
    if (project.workspaceId === undefined) createChat(cardWindow.id, project.cwd === '' ? {} : { cwd: project.cwd })
    else createChat(cardWindow.id, { workspaceId: project.workspaceId })
  }

  return (
    <div
      data-board-panel={mode}
      data-board-panel-side={side}
      data-board-panel-open={open ? '' : undefined}
      aria-hidden={!open || undefined}
      className={css.panel}
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        ...(mode === 'overlay' ? { zIndex: 1000 } : {}),
      }}
    >
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
  )
}
