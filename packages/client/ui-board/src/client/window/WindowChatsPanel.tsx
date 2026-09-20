/**
 * Chats panel of one board window: the window's control surface for projects
 * (workspaces) and chats. Collapsed it is a rail hugging the frame's edge; open
 * it is a resizable column that lists the projects and their chats, creates,
 * renames, reorders, branches, archives, and searches them, and points the
 * window at whichever chat is picked. In fullscreen it docks to the board
 * panel's left edge and the chat keeps a centred column beside it.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import clsx from 'clsx'
import {
  FileTypeIcon, IconArchiveOutline20, IconBranchOutline16, IconCheckOutline16,
  IconChevronRightOutline14, IconCloseOutline16, IconCopyOutline16, IconEditOutline16,
  IconEllipsisOutline16, IconFolderOpen16, IconNewChatOutline16, IconPanelLeftOutline16,
  IconPersonalizationOutline16, IconProjectAddOutline16, IconSearchOutline16,
  IconTrashOutline16, Menu, Pill, Tag, Tooltip, relativeTime, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BoardDirectoryListing, BoardWindowInjected } from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'
import { isWindowHidden } from '../culling.ts'
import { useBoardPointerGesture } from '../pointer-gesture.ts'
import { chatGroups, filterGroups, moveAnchor } from '../chat-list-model.ts'
import { sessionArtifacts } from './artifacts-model.ts'
import { validateWorkspacePath } from './path-validation.ts'
import {
  dockedPanelRect, panelPresentation, panelWidthFor, railRect, windowedPanelRect,
} from './panel-geometry.ts'
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
  | { readonly step: 'confirm-path'; readonly kind: 'path'; readonly path: string; readonly warning: string }
  | null

/** The row whose menu is open. */
type RowMenuTarget = { readonly kind: 'project' | 'chat'; readonly id: string }

/** The row a drag is hovering, as a data-row key. */
type DropKey = string | null

/** Inert selector equality: a collapsed panel ignores every store change. */
const alwaysEqual = (): boolean => true

/** Relative age of one chat row, in the board's short units. */
function ageLabel(updatedAt: number, t: WindowChatsPanelProps['t']): string {
  const { unit, n } = relativeTime(updatedAt, Date.now())
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
}

function WindowChatsPanelView({
  window: cardWindow, useStore, actions, useSessionList, useWorkspaceList, useWindowSession,
  bindSession, createChat, startChat, renameChat, forkChat, archiveChat, reorderChat,
  createWorkspace, renameWorkspace, deleteWorkspace, reorderWorkspace,
  listDirectory, createDirectory, pickDirectory, canOpenWorkspacePath, openWorkspacePath, t,
}: WindowChatsPanelProps) {
  const mounted = useStore(s => s.panelWindowId === cardWindow.id)
  const collapsed = useStore(s => s.panelCollapsed)
  const panelTab = useStore(s => s.panelTab)
  const requestedWidth = useStore(s => s.panelWidth)
  const groupBy = useStore(s => s.panelGroupBy)
  const orderBy = useStore(s => s.panelOrderBy)
  const fullscreen = useStore(s => s.fullscreenWindowId === cardWindow.id)
  const hidden = useStore(s => isWindowHidden(s, cardWindow))
  const open = mounted && !collapsed
  const { panX, zoom, width: viewportWidth, height: viewportHeight } = useStore(
    // Geometry only while the panel is open: a collapsed rail does not follow
    // the view transform, so panning and zooming the canvas never re-render it.
    s => ({ panX: s.panX, zoom: s.zoom, width: s.viewportWidth, height: s.viewportHeight }),
    open ? undefined : alwaysEqual,
  )
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
  const [copiedArtifact, setCopiedArtifact] = useState<string | null>(null)
  const [pathCopied, setPathCopied] = useState(false)
  const [canOpenPath, setCanOpenPath] = useState(false)
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pathTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const menuAnchor = useRef<HTMLButtonElement | null>(null)
  const viewAnchor = useRef<HTMLButtonElement | null>(null)
  const dragged = useRef(false)

  useEffect(() => () => {
    if (copiedTimeoutRef.current !== null) clearTimeout(copiedTimeoutRef.current)
    if (pathTimeoutRef.current !== null) clearTimeout(pathTimeoutRef.current)
  }, [])

  const windowSessionId = session?.sessionId
  const groups = useMemo(
    () => filterGroups(chatGroups(workspaceList, sessionList, { windowSessionId, groupBy, orderBy }), search),
    [workspaceList, sessionList, windowSessionId, groupBy, orderBy, search],
  )
  const project = level.kind === 'chats'
    ? groups.find(group => group.workspaceId === level.workspaceId)
    : undefined

  const artifacts = useMemo(() => sessionArtifacts(session?.chat), [session?.chat])
  const projectPath = useMemo(() => {
    if (level.kind !== 'chats') return null
    if (project?.cwd && project.cwd !== '') return project.cwd
    const item = workspaceList.items.find(w => w.workspaceId === level.workspaceId)
    return item?.path ?? null
  }, [level, project, workspaceList])

  useEffect(() => {
    let alive = true
    void canOpenWorkspacePath().then((avail) => {
      if (alive && avail) setCanOpenPath(true)
    }).catch(() => {})
    return () => { alive = false }
  }, [canOpenWorkspacePath])

  const activeWorkspaceId = useMemo(() => {
    if (!windowSessionId) return undefined
    for (const group of groups) {
      if (group.chats.some(c => c.id === windowSessionId)) {
        return group.workspaceId
      }
    }
    return undefined
  }, [groups, windowSessionId])

  useEffect(() => {
    if (panelTab === 'artifacts' && level.kind === 'projects') {
      setLevel({ kind: 'chats', workspaceId: activeWorkspaceId })
    }
  }, [panelTab, level.kind, activeWorkspaceId])

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

  const startGesture = useBoardPointerGesture()

  const report = useCallback((failure: unknown): void => {
    setError(failure instanceof Error ? failure.message : String(failure))
  }, [])

  const copyPath = useCallback(() => {
    if (!projectPath) return
    if (pathTimeoutRef.current !== null) clearTimeout(pathTimeoutRef.current)
    void writeClipboard(projectPath).then(() => {
      setPathCopied(true)
      pathTimeoutRef.current = setTimeout(() => {
        setPathCopied(false)
        pathTimeoutRef.current = null
      }, 1500)
    })
  }, [projectPath])

  const openFolder = useCallback(() => {
    if (!projectPath) return
    void openWorkspacePath(projectPath).catch(report)
  }, [projectPath, openWorkspacePath, report])

  const handleSelectFolder = (path: string, home?: string): void => {
    const res = validateWorkspacePath(path, { hostHome: home, t })
    if (res.kind === 'rejected') {
      setError(res.error)
      return
    }
    if (res.kind === 'warning') {
      setEdit({ step: 'confirm-path', kind: 'path', path, warning: res.warning })
      return
    }
    void createWorkspace(path).then(() => { setLevel({ kind: 'projects' }) }).catch(report)
  }

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
    startGesture(target, e.pointerId, {
      move: (moveEvt) => {
        const delta = (moveEvt.clientX - startX) / zoom
        actions.setPanelWidth(startWidth + delta * outward)
      },
    })
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
    startGesture(e.currentTarget, e.pointerId, {
      move: (moveEvt) => {
        if (!dragged.current && Math.abs(moveEvt.clientX - startX) + Math.abs(moveEvt.clientY - startY) < 5) return
        dragged.current = true
        const key = keyAt(moveEvt.clientX, moveEvt.clientY)
        setDrop(key === `${kind}:${id}` ? null : key)
      },
      end: (endEvt) => {
        setDrop(null)
        // Only a real pointerup commits: a pointercancel is the browser taking
        // the gesture back, and the drop target under a cancel means nothing.
        if (endEvt === null || endEvt.type !== 'pointerup' || !dragged.current) return
        const upEvt = endEvt
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
      },
    })
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
    if (current === null) return
    if (current.step === 'confirm-path') {
      void createWorkspace(current.path).then(() => { setLevel({ kind: 'projects' }) }).catch(report)
      return
    }
    if (current.step !== 'confirm') return
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

  const railButton = (label: string, icon: ReactNode, onClick: () => void, action: string): ReactNode => (
    <Tooltip label={label} side="right">
      <button type="button" data-board-action={action} className={css.railButton} aria-label={label} onClick={onClick}>
        {icon}
      </button>
    </Tooltip>
  )

  return (
    <>
      {!fullscreen && !open && (
        <div
          data-board-panel-rail=""
          data-board-culled={hidden ? '' : undefined}
          className={clsx(css.rail, hidden && css.hidden)}
          style={{ left: rail.left, top: rail.top, width: rail.width, height: rail.height }}
        >
          {railButton(t('panel.expand'), <IconPanelLeftOutline16 />, () => { actions.openWindowPanel(cardWindow.id) }, 'panel-rail-expand')}
          {railButton(t('panel.newChat'), <IconNewChatOutline16 />, () => {
            actions.openWindowPanel(cardWindow.id)
            setLevel({ kind: 'projects' })
            void startChat(cardWindow.id).catch(report)
          }, 'panel-rail-new-chat')}
          {railButton(t('panel.addFolder'), <IconProjectAddOutline16 />, () => {
            actions.openWindowPanel(cardWindow.id)
            setLevel({ kind: 'browse' })
          }, 'panel-rail-add-folder')}
          {railButton(t('panel.railArtifacts'), <FileTypeIcon path="artifacts.txt" size={16} />, () => {
            actions.openWindowPanel(cardWindow.id, 'artifacts')
            setLevel({ kind: 'chats', workspaceId: activeWorkspaceId })
          }, 'panel-rail-artifacts')}
          {railButton(t('panel.search'), <IconSearchOutline16 />, () => {
            actions.openWindowPanel(cardWindow.id)
            setSearchOpen(true)
          }, 'panel-rail-search')}
        </div>
      )}

      <div
        data-board-panel={presentation.kind}
        data-board-panel-side={presentation.kind === 'beside' ? side : undefined}
        data-board-panel-open={open ? '' : undefined}
        data-board-culled={hidden ? '' : undefined}
        aria-hidden={!open || undefined}
        className={clsx(css.panel, hidden && css.hidden)}
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          ...(presentation.kind === 'overlay' ? { zIndex: 1000 } : {}),
        }}
      >
        <div
          data-board-action="panel-resize"
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
                data-board-action="panel-search"
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
                data-board-action="panel-add-folder"
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
              <button
                type="button"
                data-row-action=""
                className={css.back}
                onClick={() => {
                  setLevel({ kind: 'projects' })
                  actions.setPanelTab('chats')
                }}
              >
                <IconChevronRightOutline14 className={css.backGlyph} />
                <span className={css.title}>
                  {project === undefined || project.label === '' ? t('panel.ungrouped') : project.label}
                </span>
              </button>
              {project !== undefined && (
                <button type="button" data-row-action="" data-board-action="panel-new-chat" className={css.action} aria-label={t('panel.newChat')} onClick={newChat}>
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
              data-board-action="panel-collapse"
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

        {level.kind === 'chats' && projectPath !== null && (
          <div className={css.projectPathRow} data-board-project-path={projectPath}>
            <span className={css.projectPathText} title={projectPath}>{projectPath}</span>
            <div className={css.projectPathActions}>
              <Tooltip label={pathCopied ? t('panel.pathCopied') : t('panel.copyPath')} side="bottom">
                <button
                  type="button"
                  data-row-action=""
                  data-board-action="panel-copy-path"
                  className={css.pathAction}
                  aria-label={t('panel.copyPath')}
                  onClick={copyPath}
                >
                  {pathCopied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
                </button>
              </Tooltip>
              {canOpenPath && (
                <Tooltip label={t('panel.openFolder')} side="bottom">
                  <button
                    type="button"
                    data-row-action=""
                    data-board-action="panel-open-folder"
                    className={css.pathAction}
                    aria-label={t('panel.openFolder')}
                    onClick={openFolder}
                  >
                    <IconFolderOpen16 />
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
        )}

        {level.kind === 'chats' && (
          <div className={css.tabBar}>
            <Pill
              active={panelTab === 'chats'}
              data-board-tab="chats"
              onClick={() => { actions.setPanelTab('chats') }}
            >
              {t('artifacts.tabChats')}
              <span className={css.tabBadge}>{project?.chats.length ?? 0}</span>
            </Pill>
            <Pill
              active={panelTab === 'artifacts'}
              data-board-tab="artifacts"
              onClick={() => { actions.setPanelTab('artifacts') }}
            >
              {t('artifacts.tabArtifacts')}
              {artifacts.length > 0 && <span className={css.tabBadge}>{artifacts.length}</span>}
            </Pill>
          </div>
        )}

        <div className={css.list}>
          {level.kind === 'browse' && (
            <FolderBrowser
              t={t}
              listDirectory={listDirectory}
              createDirectory={createDirectory}
              pickDirectory={pickDirectory}
              useFolder={handleSelectFolder}
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
                  data-board-action="panel-project-menu"
                  className={css.rowAction}
                  aria-label={t('panel.rowMenu')}
                  onClick={(e) => { menuAnchor.current = e.currentTarget; setRowMenu({ kind: 'project', id: group.workspaceId as string }) }}
                >
                  <IconEllipsisOutline16 />
                </button>
              )}
            </div>
          ))}

          {level.kind === 'chats' && panelTab === 'chats' && project?.chats.map(chat => (
            <div key={chat.id} className={css.groupRow}>
              <button
                type="button"
                data-row-key={`chat:${chat.id}`}
                data-board-chat-current={chat.current ? '' : undefined}
                className={clsx(css.row, chat.current && css.current, drop === `chat:${chat.id}` && css.dropTarget)}
                onPointerDown={(e) => { startRowDrag('chat', chat.id, e) }}
                onClick={() => {
                  if (dragClickGuard()) return
                  setError(null)
                  const outcome = bindSession(cardWindow.id, chat.id)
                  if (outcome.kind === 'unknown') setError(t('panel.chatGone'))
                }}
              >
                <span className={css.rowText}>{chat.blank ? t('panel.newChatTitle') : chat.title}</span>
                {chat.running && <span className={css.dot} />}
                <span className={css.rowMeta}>{chat.blank ? '' : ageLabel(chat.updatedAt, t)}</span>
              </button>
              <button
                type="button"
                data-row-action=""
                data-board-action="panel-row-menu"
                className={css.rowAction}
                aria-label={t('panel.rowMenu')}
                onClick={(e) => { menuAnchor.current = e.currentTarget; setRowMenu({ kind: 'chat', id: chat.id }) }}
              >
                <IconEllipsisOutline16 />
              </button>
            </div>
          ))}

          {level.kind === 'chats' && panelTab === 'artifacts' && (
            artifacts.length === 0 ? (
              <div className={css.artifactsEmpty} data-board-artifacts-empty="">
                {t('artifacts.empty')}
              </div>
            ) : (
              <div className={css.artifactsList} data-board-artifacts-list="">
                {artifacts.map((artifact) => {
                  const isCopied = copiedArtifact === artifact.path
                  const kindLabel = t(`artifacts.${artifact.kind}`)
                  const kindTone = artifact.kind === 'created' ? 'success' : artifact.kind === 'modified' ? 'warning' : 'neutral'
                  return (
                    <div key={artifact.path} className={css.artifactRow} data-board-artifact={artifact.path}>
                      <div className={css.artifactIcon}>
                        <FileTypeIcon path={artifact.path} size={20} />
                      </div>
                      <div className={css.artifactBody}>
                        <span className={css.artifactPath} title={artifact.path}>
                          {artifact.path}
                        </span>
                        <div className={css.artifactMeta}>
                          <span data-board-artifact-kind={artifact.kind}>
                            <Tag tone={kindTone}>
                              {kindLabel}
                            </Tag>
                          </span>
                          <span className={css.artifactTime}>
                            {ageLabel(artifact.time, t)}
                          </span>
                        </div>
                      </div>
                      <div className={css.artifactActions}>
                        <Tooltip label={isCopied ? t('artifacts.copied') : t('artifacts.copy')} side="bottom">
                          <button
                            type="button"
                            data-row-action=""
                            data-board-action="artifact-copy-path"
                            className={css.pathAction}
                            aria-label={t('artifacts.copy')}
                            onClick={() => {
                              if (copiedTimeoutRef.current !== null) clearTimeout(copiedTimeoutRef.current)
                              void writeClipboard(artifact.path).then(() => {
                                setCopiedArtifact(artifact.path)
                                copiedTimeoutRef.current = setTimeout(() => {
                                  setCopiedArtifact(curr => (curr === artifact.path ? null : curr))
                                  copiedTimeoutRef.current = null
                                }, 1500)
                              })
                            }}
                          >
                            {isCopied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
                          </button>
                        </Tooltip>
                        {canOpenPath && (
                          <Tooltip label={t('artifacts.reveal')} side="bottom">
                            <button
                              type="button"
                              data-row-action=""
                              data-board-action="artifact-reveal"
                              className={css.pathAction}
                              aria-label={t('artifacts.reveal')}
                              onClick={() => {
                                void openWorkspacePath(artifact.path, 'reveal').catch(report)
                              }}
                            >
                              <IconFolderOpen16 />
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          )}
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
              : edit.step === 'confirm-path'
                ? (
                  <>
                    <span className={css.rowText}>{edit.warning}</span>
                    <button
                      type="button"
                      data-row-action=""
                      data-board-action="panel-confirm-path"
                      className={css.confirmAction}
                      onClick={confirm}
                    >
                      {t('panel.confirm')}
                    </button>
                    <button
                      type="button"
                      data-row-action=""
                      data-board-action="panel-cancel-path"
                      className={css.confirmAction}
                      onClick={() => { setEdit(null) }}
                    >
                      {t('panel.cancel')}
                    </button>
                  </>
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

/**
 * The compact folder browser the panel registers a workspace with. Hosts whose
 * boot mounted the native picker serve no directory listing, so a failed load
 * falls back to that host chooser instead of leaving the level unusable.
 */
function FolderBrowser({ t, listDirectory, createDirectory, pickDirectory, useFolder }: {
  readonly t: WindowChatsPanelProps['t']
  readonly listDirectory: (path?: string) => Promise<BoardDirectoryListing>
  readonly createDirectory: (path: string, name: string) => Promise<string>
  readonly pickDirectory: () => Promise<string | null>
  readonly useFolder: (path: string, home?: string) => void
}): ReactNode {
  const [listing, setListing] = useState<BoardDirectoryListing | null>(null)
  const [folderName, setFolderName] = useState<string | null>(null)
  const [browseFailed, setBrowseFailed] = useState(false)

  const load = useCallback((path?: string) => {
    void listDirectory(path).then((next) => {
      setListing(next)
      setBrowseFailed(false)
    }).catch(() => {
      setBrowseFailed(true)
    })
  }, [listDirectory])

  useEffect(() => { load() }, [load])

  const pickInSystem = (): void => {
    void pickDirectory().then((path) => {
      if (path !== null) useFolder(path, listing?.home)
    })
  }

  const createFolder = (): void => {
    const name = (folderName ?? '').trim()
    if (name === '' || listing === null) return
    void createDirectory(listing.path, name).then((path) => {
      setFolderName(null)
      load(path)
    }).catch(() => {
      setBrowseFailed(true)
    })
  }

  if (listing === null) {
    return (
      <>
        <div className={css.rowMeta}>{browseFailed ? t('panel.browseUnavailable') : t('panel.loading')}</div>
        {browseFailed && (
          <button
            type="button"
            data-row-action=""
            data-board-action="panel-pick-system"
            className={css.confirmAction}
            onClick={pickInSystem}
          >
            {t('panel.pickFolder')}
          </button>
        )}
      </>
    )
  }

  return (
    <>
      <div className={css.crumbs}>
        {listing.crumbs.map((crumb, index) => (
          <button
            key={crumb.path}
            type="button"
            data-row-action=""
            data-board-action="panel-crumb"
            data-board-crumb-path={crumb.path}
            className={css.crumb}
            onClick={() => { load(crumb.path) }}
          >
            {crumb.name === '' ? '/' : crumb.name}{index < listing.crumbs.length - 1 ? ' /' : ''}
          </button>
        ))}
      </div>
      {browseFailed && <div className={css.rowMeta}>{t('panel.browseUnavailable')}</div>}
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
      <button
        type="button"
        data-row-action=""
        data-board-action="panel-use-folder"
        className={css.confirmAction}
        onClick={() => { useFolder(listing.path, listing.home) }}
      >
        {t('panel.useFolder')}
      </button>
    </>
  )
}

/**
 * The panel, memoized on its props: the window object and the injected face
 * are stable between store changes that do not touch this window, so another
 * window's move or raise does not re-render this panel.
 */
export const WindowChatsPanel = memo(WindowChatsPanelView)
