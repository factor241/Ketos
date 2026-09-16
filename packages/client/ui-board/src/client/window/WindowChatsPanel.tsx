/**
 * Chats panel of one board window: the window's control surface for projects
 * (workspaces) and chats. Collapsed it is a rail hugging the frame's edge; open
 * it is a resizable column that lists the projects and their chats, creates,
 * renames, reorders, branches, archives, and searches them, and points the
 * window at whichever chat is picked. In fullscreen it docks to the board
 * panel's left edge and the chat keeps a centred column beside it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconArchiveOutline20, IconBranchOutline16, IconChevronRightOutline14,
  IconCloseOutline16, IconEditOutline16, IconEllipsisOutline16, IconFolderOpen16,
  IconNewChatOutline16, IconPanelLeftOutline16, IconPersonalizationOutline16, IconProjectAddOutline16,
  IconSearchOutline16, IconTrashOutline16, Menu, Tooltip, relativeTime,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BoardDirectoryListing, BoardWindowInjected } from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'
import { chatGroups, filterGroups, moveAnchor } from './chat-list-model.ts'
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

/** Which view the panel shows. */
type PanelLevel =
  | { readonly kind: 'projects' }
  | { readonly kind: 'chats'; readonly workspaceId: WorkspaceId | undefined }
  | { readonly kind: 'browse' }

/** One row's rename editor or confirm step, or null when none is open. */
type RowEdit =
  | { readonly step: 'rename'; readonly kind: 'project' | 'chat'; readonly id: string; readonly value: string }
  | { readonly step: 'confirm'; readonly kind: 'project' | 'chat'; readonly id: string }
  | null

/** The row whose menu is open. */
type RowMenuTarget = { readonly kind: 'project' | 'chat'; readonly id: string }

/** The row a drag is hovering, as a data-row key. */
type DropKey = string | null

/** Relative age of one chat row, in the board's short units. */
function ageLabel(updatedAt: number, t: WindowChatsPanelProps['t']): string {
  const { unit, n } = relativeTime(updatedAt, Date.now())
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
}

export function WindowChatsPanel({
  window: cardWindow, useStore, actions, useSessionList, useWorkspaceList, useWindowSession,
  bindSession, createChat, startChat, renameChat, forkChat, archiveChat, reorderChat,
  createWorkspace, renameWorkspace, deleteWorkspace, reorderWorkspace,
  listDirectory, createDirectory, t,
}: WindowChatsPanelProps) {
  const mounted = useStore(s => s.panelWindowId === cardWindow.id)
  const collapsed = useStore(s => s.panelCollapsed)
  const requestedWidth = useStore(s => s.panelWidth)
  const groupBy = useStore(s => s.panelGroupBy)
  const orderBy = useStore(s => s.panelOrderBy)
  const fullscreen = useStore(s => s.fullscreenWindowId === cardWindow.id)
  const viewportWidth = useStore(s => s.viewportWidth)
  const viewportHeight = useStore(s => s.viewportHeight)
  const panX = useStore(s => s.panX)
  const zoom = useStore(s => s.zoom)
  const sessionList = useSessionList(s => s)
  const workspaceList = useWorkspaceList(s => s)
  const session = useWindowSession(cardWindow.id)
  const [level, setLevel] = useState<PanelLevel>({ kind: 'projects' })
  const [edit, setEdit] = useState<RowEdit>(null)
  const [rowMenu, setRowMenu] = useState<RowMenuTarget | null>(null)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [viewOpen, setViewOpen] = useState(false)
  const [drop, setDrop] = useState<DropKey>(null)
  const [error, setError] = useState<string | null>(null)
  const menuAnchor = useRef<HTMLButtonElement | null>(null)
  const viewAnchor = useRef<HTMLButtonElement | null>(null)
  const dragged = useRef(false)

  const windowSessionId = session?.sessionId
  const groups = useMemo(
    () => filterGroups(chatGroups(workspaceList, sessionList, { windowSessionId, groupBy, orderBy }), search),
    [workspaceList, sessionList, windowSessionId, groupBy, orderBy, search],
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
  const open = mounted && !collapsed

  const report = useCallback((failure: unknown): void => {
    setError(failure instanceof Error ? failure.message : String(failure))
  }, [])

  useEffect(() => {
    if (!open) {
      setRowMenu(null)
      setViewOpen(false)
      setSearchOpen(false)
      setSearch('')
      setEdit(null)
    }
  }, [open])

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

  /** The data-row key of the row under a point. */
  const keyAt = (x: number, y: number): string | null =>
    document.elementFromPoint(x, y)?.closest('[data-row-key]')?.getAttribute('data-row-key') ?? null

  // Row drag: after a small threshold the pointer picks the row it is over and
  // releasing commits the move through the same service the menu uses.
  const startRowDrag = (kind: 'project' | 'chat', id: string, e: ReactPointerEvent<HTMLElement>): void => {
    if ((e.target as HTMLElement).closest('button[data-row-action]') !== null) return
    const startX = e.clientX
    const startY = e.clientY
    dragged.current = false
    const onPointerMove = (moveEvt: PointerEvent) => {
      if (!dragged.current && Math.abs(moveEvt.clientX - startX) + Math.abs(moveEvt.clientY - startY) < 5) return
      dragged.current = true
      const key = keyAt(moveEvt.clientX, moveEvt.clientY)
      setDrop(key === `${kind}:${id}` ? null : key)
    }
    const onPointerUp = (upEvt: PointerEvent) => {
      globalThis.removeEventListener('pointermove', onPointerMove)
      globalThis.removeEventListener('pointerup', onPointerUp)
      setDrop(null)
      if (!dragged.current) return
      const key = keyAt(upEvt.clientX, upEvt.clientY)
      if (key === null || key === `${kind}:${id}`) return
      const [targetKind, ...rest] = key.split(':')
      const targetId = rest.join(':')
      if (targetKind !== kind) return
      if (kind === 'project') {
        void reorderWorkspace(id as WorkspaceId, targetId as WorkspaceId).catch(report)
        return
      }
      const groupId = project?.workspaceId
      if (groupId === undefined) return
      void reorderChat(groupId, id as SessionId, targetId as SessionId).catch(report)
    }
    globalThis.addEventListener('pointermove', onPointerMove)
    globalThis.addEventListener('pointerup', onPointerUp)
  }

  /** Consume the click a finished drag leaves on its row. */
  const dragClickGuard = (): boolean => {
    if (!dragged.current) return false
    dragged.current = false
    return true
  }

  const manualChatIds = (groupId: WorkspaceId): readonly SessionId[] =>
    workspaceList.items.find(item => item.workspaceId === groupId)?.sessionIds ?? []

  const menuItems = (target: RowMenuTarget): readonly MenuEntry[] => {
    const common: MenuEntry[] = [
      { id: 'rename', label: t('panel.rename'), icon: <IconEditOutline16 /> },
    ]
    if (target.kind === 'project') {
      return [
        ...common,
        { id: 'up', label: t('panel.moveUp') },
        { id: 'down', label: t('panel.moveDown') },
        { id: 'delete', label: t('panel.deleteFolder'), icon: <IconTrashOutline16 />, danger: true },
      ]
    }
    return [
      ...common,
      { id: 'branch', label: t('panel.branch'), icon: <IconBranchOutline16 /> },
      { id: 'archive', label: t('panel.archive'), icon: <IconArchiveOutline20 size={16} /> },
      { id: 'up', label: t('panel.moveUp') },
      { id: 'down', label: t('panel.moveDown') },
      { id: 'delete', label: t('panel.deleteChat'), icon: <IconTrashOutline16 />, danger: true },
    ]
  }

  const onMenuSelect = (action: string): void => {
    const target = rowMenu
    setRowMenu(null)
    if (target === null) return
    if (target.kind === 'project') {
      const workspaceId = target.id as WorkspaceId
      if (action === 'rename') {
        setEdit({
          step: 'rename',
          kind: 'project',
          id: target.id,
          value: workspaceList.items.find(item => item.workspaceId === workspaceId)?.title ?? '',
        })
        return
      }
      const workspaceOrder = workspaceList.items.map(item => item.workspaceId)
      if (action === 'up') {
        void reorderWorkspace(workspaceId, moveAnchor(workspaceOrder, workspaceId, -1)).catch(report)
        return
      }
      if (action === 'down') {
        void reorderWorkspace(workspaceId, moveAnchor(workspaceOrder, workspaceId, 1)).catch(report)
        return
      }
      if (action === 'delete') setEdit({ step: 'confirm', kind: 'project', id: target.id })
      return
    }
    const chatId = target.id as SessionId
    const groupId = project?.workspaceId
    if (action === 'rename') {
      setEdit({ step: 'rename', kind: 'chat', id: target.id, value: sessionList.byId[chatId]?.displayTitle ?? '' })
      return
    }
    if (action === 'branch') {
      void forkChat(cardWindow.id, chatId).catch(report)
      return
    }
    if (action === 'archive') {
      setEdit({ step: 'confirm', kind: 'chat', id: target.id })
      return
    }
    if (groupId === undefined) return
    if (action === 'up') {
      void reorderChat(groupId, chatId, moveAnchor(manualChatIds(groupId), chatId, -1)).catch(report)
      return
    }
    if (action === 'down') {
      void reorderChat(groupId, chatId, moveAnchor(manualChatIds(groupId), chatId, 1)).catch(report)
    }
  }

  const submitRename = (value: string): void => {
    const current = edit
    setEdit(null)
    const title = value.trim()
    if (current === null || current.step !== 'rename' || title === '') return
    if (current.kind === 'project') void renameWorkspace(current.id as WorkspaceId, title).catch(report)
    else void renameChat(current.id as SessionId, title).catch(report)
  }

  const confirm = (): void => {
    const current = edit
    setEdit(null)
    if (current === null || current.step !== 'confirm') return
    if (current.kind === 'project') {
      const workspaceId = current.id as WorkspaceId
      if (level.kind === 'chats' && level.workspaceId === workspaceId) setLevel({ kind: 'projects' })
      void deleteWorkspace(workspaceId).catch(report)
      return
    }
    void archiveChat(current.id as SessionId).catch(report)
  }

  const newChat = (): void => {
    if (project === undefined) return
    if (project.workspaceId !== undefined) {
      void startChat(cardWindow.id, project.workspaceId).catch(report)
      return
    }
    createChat(cardWindow.id, project.cwd === '' ? {} : { cwd: project.cwd })
  }

  const railButton = (label: string, icon: ReactNode, onClick: () => void): ReactNode => (
    <Tooltip label={label} side="right">
      <button type="button" className={css.railButton} aria-label={label} onClick={onClick}>
        {icon}
      </button>
    </Tooltip>
  )

  return (
    <>
      {!fullscreen && !open && (
        <div
          data-board-panel-rail=""
          className={css.rail}
          style={{ left: rail.left, top: rail.top, width: rail.width, height: rail.height }}
        >
          {railButton(t('panel.expand'), <IconPanelLeftOutline16 />, () => { actions.openWindowPanel(cardWindow.id) })}
          {railButton(t('panel.newChat'), <IconNewChatOutline16 />, () => {
            actions.openWindowPanel(cardWindow.id)
            setLevel({ kind: 'projects' })
            void startChat(cardWindow.id).catch(report)
          })}
          {railButton(t('panel.addFolder'), <IconProjectAddOutline16 />, () => {
            actions.openWindowPanel(cardWindow.id)
            setLevel({ kind: 'browse' })
          })}
          {railButton(t('panel.search'), <IconSearchOutline16 />, () => {
            actions.openWindowPanel(cardWindow.id)
            setSearchOpen(true)
          })}
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
          {level.kind === 'projects' && (
            <>
              <span className={css.title}>{t('panel.projects')}</span>
              <button
                type="button"
                data-row-action=""
                className={clsx(css.action, searchOpen && css.actionActive)}
                aria-label={t('panel.search')}
                aria-expanded={searchOpen}
                onClick={() => {
                  if (searchOpen) setSearch('')
                  setSearchOpen(wasOpen => !wasOpen)
                }}
              >
                <IconSearchOutline16 />
              </button>
              <button
                ref={viewAnchor}
                type="button"
                data-row-action=""
                className={css.action}
                aria-label={t('panel.viewOptions')}
                aria-expanded={viewOpen}
                onClick={() => { setViewOpen(wasOpen => !wasOpen) }}
              >
                <IconPersonalizationOutline16 />
              </button>
              <button
                type="button"
                data-row-action=""
                className={css.action}
                aria-label={t('panel.addFolder')}
                onClick={() => { setLevel({ kind: 'browse' }) }}
              >
                <IconProjectAddOutline16 />
              </button>
            </>
          )}
          {level.kind === 'chats' && (
            <>
              <button type="button" data-row-action="" className={css.back} onClick={() => { setLevel({ kind: 'projects' }) }}>
                <IconChevronRightOutline14 className={css.backGlyph} />
                <span className={css.title}>
                  {project === undefined || project.label === '' ? t('panel.ungrouped') : project.label}
                </span>
              </button>
              {project !== undefined && (
                <button type="button" data-row-action="" className={css.action} aria-label={t('panel.newChat')} onClick={newChat}>
                  <IconNewChatOutline16 />
                </button>
              )}
            </>
          )}
          {level.kind === 'browse' && (
            <button type="button" data-row-action="" className={css.back} onClick={() => { setLevel({ kind: 'projects' }) }}>
              <IconChevronRightOutline14 className={css.backGlyph} />
              <span className={css.title}>{t('panel.chooseFolder')}</span>
            </button>
          )}
          <Tooltip label={t('panel.collapse')} side="bottom">
            <button
              type="button"
              data-row-action=""
              className={css.action}
              aria-label={t('panel.collapse')}
              onClick={() => { actions.setPanelCollapsed(true) }}
            >
              <IconPanelLeftOutline16 />
            </button>
          </Tooltip>
        </div>

        <Menu
          portal
          open={viewOpen}
          side="bottom"
          align="end"
          selection="check"
          selectedId={groupBy}
          anchor={<span className={css.anchor} />}
          getAnchorRect={() => viewAnchor.current?.getBoundingClientRect() ?? null}
          items={[
            { id: 'workspace', label: t('panel.groupWorkspace') },
            { id: 'flat', label: t('panel.groupFlat') },
            { type: 'separator', id: 'sep' },
            { id: 'manual', label: `${t('panel.orderManual')}${orderBy === 'manual' ? ' ✓' : ''}` },
            { id: 'updated', label: `${t('panel.orderUpdated')}${orderBy === 'updated' ? ' ✓' : ''}` },
          ]}
          onSelect={(id) => {
            setViewOpen(false)
            if (id === 'workspace' || id === 'flat') actions.setPanelGroupBy(id)
            else if (id === 'manual' || id === 'updated') actions.setPanelOrderBy(id)
          }}
          onClose={() => { setViewOpen(false) }}
        />

        <Menu
          portal
          open={rowMenu !== null}
          side="bottom"
          align="end"
          selection="fill"
          anchor={<span className={css.anchor} />}
          getAnchorRect={() => menuAnchor.current?.getBoundingClientRect() ?? null}
          items={rowMenu === null ? [] : menuItems(rowMenu)}
          onSelect={onMenuSelect}
          onClose={() => { setRowMenu(null) }}
        />

        {searchOpen && level.kind === 'projects' && (
          <div className={css.editRow} data-board-row-edit="search">
            <input
              className={css.input}
              value={search}
              autoFocus
              aria-label={t('panel.search')}
              placeholder={t('panel.searchPlaceholder')}
              onChange={(e) => { setSearch(e.target.value) }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearch('')
                  setSearchOpen(false)
                }
              }}
            />
          </div>
        )}

        {error !== null && (
          <div className={css.errorRow}>
            <span className={css.rowText}>{error}</span>
            <button type="button" data-row-action="" className={css.rowAction} aria-label={t('panel.dismiss')} onClick={() => { setError(null) }}>
              <IconCloseOutline16 />
            </button>
          </div>
        )}

        <div className={css.list}>
          {level.kind === 'browse' && (
            <FolderBrowser
              t={t}
              listDirectory={listDirectory}
              createDirectory={createDirectory}
              useFolder={(path) => { void createWorkspace(path).then(() => { setLevel({ kind: 'projects' }) }).catch(report) }}
            />
          )}

          {level.kind === 'projects' && groups.map(group => (
            <div key={group.workspaceId ?? 'ungrouped'} className={css.groupRow}>
              <button
                type="button"
                data-row-key={`project:${group.workspaceId ?? ''}`}
                className={clsx(css.row, drop === `project:${group.workspaceId ?? ''}` && css.dropTarget)}
                onPointerDown={(e) => { if (group.workspaceId !== undefined) startRowDrag('project', group.workspaceId, e) }}
                onClick={() => {
                  if (dragClickGuard()) return
                  setLevel({ kind: 'chats', workspaceId: group.workspaceId })
                }}
              >
                <span className={css.rowIcon}><IconFolderOpen16 /></span>
                <span className={css.rowText}>{group.label === '' ? t('panel.ungrouped') : group.label}</span>
                <span className={css.rowMeta}>{group.chats.length}</span>
              </button>
              {group.workspaceId !== undefined && (
                <button
                  type="button"
                  data-row-action=""
                  className={css.rowAction}
                  aria-label={t('panel.rowMenu')}
                  onClick={(e) => { menuAnchor.current = e.currentTarget; setRowMenu({ kind: 'project', id: group.workspaceId as string }) }}
                >
                  <IconEllipsisOutline16 />
                </button>
              )}
            </div>
          ))}

          {level.kind === 'chats' && project?.chats.map(chat => (
            <div key={chat.id} className={css.groupRow}>
              <button
                type="button"
                data-row-key={`chat:${chat.id}`}
                data-board-chat-current={chat.current ? '' : undefined}
                className={clsx(css.row, chat.current && css.current, drop === `chat:${chat.id}` && css.dropTarget)}
                onPointerDown={(e) => { startRowDrag('chat', chat.id, e) }}
                onClick={() => {
                  if (dragClickGuard()) return
                  bindSession(cardWindow.id, chat.id)
                }}
              >
                <span className={css.rowText}>{chat.blank ? t('panel.newChatTitle') : chat.title}</span>
                {chat.running && <span className={css.dot} />}
                <span className={css.rowMeta}>{chat.blank ? '' : ageLabel(chat.updatedAt, t)}</span>
              </button>
              <button
                type="button"
                data-row-action=""
                className={css.rowAction}
                aria-label={t('panel.rowMenu')}
                onClick={(e) => { menuAnchor.current = e.currentTarget; setRowMenu({ kind: 'chat', id: chat.id }) }}
              >
                <IconEllipsisOutline16 />
              </button>
            </div>
          ))}
        </div>

        {edit !== null && (
          <div className={css.editRow} data-board-row-edit={edit.step} data-board-row-kind={edit.kind}>
            {edit.step === 'rename'
              ? (
                <input
                  className={css.input}
                  value={edit.value}
                  autoFocus
                  aria-label={t('panel.rename')}
                  onChange={(e) => { setEdit({ ...edit, value: e.target.value }) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitRename(edit.value)
                    if (e.key === 'Escape') setEdit(null)
                  }}
                />
              )
              : (
                <>
                  <span className={css.rowText}>
                    {edit.kind === 'project' ? t('panel.deleteFolderConfirm') : t('panel.archiveConfirm')}
                  </span>
                  <button type="button" data-row-action="" className={css.confirmAction} onClick={confirm}>
                    {t('panel.confirm')}
                  </button>
                  <button type="button" data-row-action="" className={css.confirmAction} onClick={() => { setEdit(null) }}>
                    {t('panel.cancel')}
                  </button>
                </>
              )}
          </div>
        )}
      </div>
    </>
  )
}

/** The compact folder browser the panel registers a workspace with. */
function FolderBrowser({ t, listDirectory, createDirectory, useFolder }: {
  readonly t: WindowChatsPanelProps['t']
  readonly listDirectory: (path?: string) => Promise<BoardDirectoryListing>
  readonly createDirectory: (path: string, name: string) => Promise<string>
  readonly useFolder: (path: string) => void
}): ReactNode {
  const [listing, setListing] = useState<BoardDirectoryListing | null>(null)
  const [folderName, setFolderName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((path?: string) => {
    void listDirectory(path).then((next) => {
      setListing(next)
      setError(null)
    }).catch((failure: unknown) => {
      setError(failure instanceof Error ? failure.message : String(failure))
    })
  }, [listDirectory])

  useEffect(() => { load() }, [load])

  const createFolder = (): void => {
    const name = (folderName ?? '').trim()
    if (name === '' || listing === null) return
    void createDirectory(listing.path, name).then((path) => {
      setFolderName(null)
      load(path)
    }).catch((failure: unknown) => {
      setError(failure instanceof Error ? failure.message : String(failure))
    })
  }

  if (listing === null) {
    return <div className={css.rowMeta}>{error ?? t('panel.loading')}</div>
  }

  return (
    <>
      <div className={css.crumbs}>
        {listing.crumbs.map((crumb, index) => (
          <button
            key={crumb.path}
            type="button"
            data-row-action=""
            className={css.crumb}
            onClick={() => { load(crumb.path) }}
          >
            {crumb.name === '' ? '/' : crumb.name}{index < listing.crumbs.length - 1 ? ' /' : ''}
          </button>
        ))}
      </div>
      {error !== null && <div className={css.rowMeta}>{error}</div>}
      <div className={css.groupRow}>
        <button type="button" data-row-action="" className={css.row} onClick={() => { setFolderName('') }}>
          <span className={css.rowIcon}><IconProjectAddOutline16 /></span>
          <span className={css.rowText}>{t('panel.newFolder')}</span>
        </button>
      </div>
      {folderName !== null && (
        <div className={css.editRow} data-board-row-edit="folder">
          <input
            className={css.input}
            value={folderName}
            autoFocus
            aria-label={t('panel.newFolder')}
            onChange={(e) => { setFolderName(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createFolder()
              if (e.key === 'Escape') setFolderName(null)
            }}
          />
        </div>
      )}
      {listing.entries.map(entry => (
        <div key={entry.path} className={css.groupRow}>
          <button type="button" data-row-action="" className={css.row} onClick={() => { load(entry.path) }}>
            <span className={css.rowIcon}><IconFolderOpen16 /></span>
            <span className={css.rowText}>{entry.name}</span>
          </button>
        </div>
      ))}
      <button type="button" data-row-action="" className={css.confirmAction} onClick={() => { useFolder(listing.path) }}>
        {t('panel.useFolder')}
      </button>
    </>
  )
}
