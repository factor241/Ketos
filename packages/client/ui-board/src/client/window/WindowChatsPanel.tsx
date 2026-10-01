/**
 * Chats panel of one board window: the window's control surface for projects
 * (workspaces) and chats. Collapsed it is a rail hugging the frame's edge; open
 * it is a resizable column that lists the projects and their chats, creates,
 * renames, reorders, branches, archives, and searches them, and points the
 * window at whichever chat is picked.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconArchiveOutline20, IconBranchOutline16,
  IconChevronRightOutline14, IconCloseOutline16, IconCopyOutline16, IconEditOutline16,
  IconEllipsisOutline16, IconFolderOpen16, IconNewChatOutline16, IconPanelLeftOutline16,
  IconPersonalizationOutline16, IconProjectAddOutline16, IconSearchOutline16,
  IconTrashOutline16, Menu, Tooltip, relativeTime, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BoardDirectoryListing, BoardWindowInjected, BoardWindowState } from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'
import { isWindowHidden } from '../culling.ts'
import { useBoardMenuDismiss } from '../board-popover.tsx'
import { useBoardPointerGesture } from '../pointer-gesture.ts'
import { chatGroups, filterGroups, moveAnchor, type BoardChatGroup } from '../chat-list-model.ts'
import { validateWorkspacePath } from './path-validation.ts'
import { RightPanel } from './RightPanel.tsx'
import { windowPanelRect } from './panel-geometry.ts'
import css from './WindowChatsPanel.module.css'

export type WindowChatsPanelProps =
  PropsRuntime<'board.window.panel'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>
  & InjectFace<BoardWindowInjected>

/** Relative age of one chat row, in the board's short units. */
function ageLabel(updatedAt: number, t: WindowChatsPanelProps['t']): string {
  const { unit, n } = relativeTime(updatedAt, Date.now())
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
}

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

/**
 * Whether a caught workspace-create failure is the host's refusal of a runtime
 * path: `WorkspaceCreateError` carries the Host's `rpcError.code`, while any
 * other thrown value has no business code to map.
 * @param error - the caught value.
 * @returns whether the failure carries the host's `workspace/invalid-path` code.
 */
function isInvalidPathRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { rpcError } = error as { rpcError?: unknown }
  if (typeof rpcError !== 'object' || rpcError === null) return false
  return (rpcError as { code?: unknown }).code === 'workspace/invalid-path'
}

function WindowChatsPanelView({
  window: cardWindow, useStore, actions, useSessionList, useWorkspaceList, useWindowSession,
  bindSession, createChat, startChat, renameChat, forkChat, archiveChat, reorderChat,
  createWorkspace, renameWorkspace, deleteWorkspace, reorderWorkspace,
  listDirectory, createDirectory, pickDirectory, canOpenWorkspacePath, openWorkspacePath,
  openFileInPanel, documentPreviewFor, listWorkspaceDirectory, readWorkspaceFile, t,
}: WindowChatsPanelProps) {
  const groupBy = useStore(s => s.panelGroupBy)
  const orderBy = useStore(s => s.panelOrderBy)
  const hidden = useStore(s => isWindowHidden(s, cardWindow))
  const zoom = useStore(s => s.zoom)
  const sessionList = useSessionList(s => s)
  const workspaceList = useWorkspaceList(s => s)
  const session = useWindowSession(cardWindow.id)
  // Several folders can stay open while the user moves between chats; the
  // expanded keys live in the board store so the tree returns as it was left
  // when the board remounts.
  const expandedKeys = useStore(s => s.panelExpandedGroups)
  const expandedGroups = useMemo(() => new Set(expandedKeys), [expandedKeys])
  // The folder browser replaces the tree while a folder is being picked.
  const [browsing, setBrowsing] = useState(false)
  const [edit, setEdit] = useState<RowEdit>(null)
  const [rowMenu, setRowMenu] = useState<RowMenuTarget | null>(null)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [viewOpen, setViewOpen] = useState(false)
  const [drop, setDrop] = useState<DropKey>(null)
  const [error, setError] = useState<string | null>(null)
  const [canOpenPath, setCanOpenPath] = useState(false)
  const menuAnchor = useRef<HTMLButtonElement | null>(null)
  const viewAnchor = useRef<HTMLButtonElement | null>(null)
  const dragged = useRef(false)
  // Window move, resize, culling, and close dismiss both panel
  // menus; pan and zoom only move them with the panel.
  useBoardMenuDismiss(() => { setViewOpen(false) })
  useBoardMenuDismiss(() => { setRowMenu(null) })

  const windowSessionId = session?.sessionId
  const allGroups = useMemo(
    () => chatGroups(workspaceList, sessionList, { windowSessionId, groupBy, orderBy }),
    [workspaceList, sessionList, windowSessionId, groupBy, orderBy],
  )
  const groups = useMemo(() => filterGroups(allGroups, search), [allGroups, search])
  // The level's identity comes from the unfiltered groups: a search that hides
  // the last matching row still leaves the header, badge, and New-chat control.
  // The tree shows the filtered groups plus every expanded folder: a search
  // that hides a folder's last matching chat must not close the folder the
  // user is working in (the same identity rule the old level had).
  const visibleGroups = useMemo(() => {
    const rendered = new Map(groups.map(group => [group.workspaceId ?? '', group]))
    for (const group of allGroups) {
      const key = group.workspaceId ?? ''
      if (expandedGroups.has(key) && !rendered.has(key)) rendered.set(key, { ...group, chats: [] })
    }
    return [...rendered.values()]
  }, [allGroups, expandedGroups, groups])

  // The window's current session opens its folder automatically, so the row
  // the user works from is visible the first time the panel opens.
  const currentGroupKey = useMemo(() => {
    if (windowSessionId === undefined) return null
    const group = allGroups.find(candidate => candidate.chats.some(chat => chat.id === windowSessionId))
    return group === undefined ? null : group.workspaceId ?? ''
  }, [allGroups, windowSessionId])
  useEffect(() => {
    if (currentGroupKey === null) return
    actions.setPanelGroupExpanded(currentGroupKey, true)
  }, [currentGroupKey, actions])

  /** The rendered group holding one chat (the filtered tree first). */
  const groupOfChat = (sessionId: string): BoardChatGroup | undefined =>
    groups.find(group => group.chats.some(chat => chat.id === sessionId))
    ?? allGroups.find(group => group.chats.some(chat => chat.id === sessionId))
  /** The directory a group's rows act on: the chat's own, else the folder's. */
  const groupPath = (group: BoardChatGroup): string | null => {
    if (group.cwd !== '') return group.cwd
    if (group.workspaceId === undefined) return null
    return workspaceList.items.find(item => item.workspaceId === group.workspaceId)?.path ?? null
  }

  useEffect(() => {
    let alive = true
    void canOpenWorkspacePath().then((avail) => {
      if (alive && avail) setCanOpenPath(true)
    }).catch(() => {})
    return () => { alive = false }
  }, [canOpenWorkspacePath])

  // The two panels sit at fixed world offsets beside the frame, so they follow
  // pan and zoom without reading the transform; only the resize gesture needs
  // the zoom for its world-unit deltas.
  const leftOpen = cardWindow.leftPanelOpen === true
  const rightOpen = cardWindow.rightPanelOpen === true
  const leftRect = windowPanelRect(cardWindow, 'left')
  const rightRect = windowPanelRect(cardWindow, 'right')

  const startGesture = useBoardPointerGesture()

  const report = useCallback((failure: unknown): void => {
    setError(failure instanceof Error ? failure.message : String(failure))
  }, [])

  const copyPath = useCallback((path: string) => {
    void writeClipboard(path).catch(() => {
      setError(t('panel.copy.failed'))
    })
  }, [t])

  const openFolder = useCallback((path: string) => {
    void openWorkspacePath(path).catch(report)
  }, [openWorkspacePath, report])

  /**
   * Register one workspace path and return to the projects level. The host
   * refuses a runtime path the client could not name (a moved DSH_HOME); that
   * refusal shows the localized ketos-home text, every other failure reports.
   */
  const registerWorkspace = (path: string): void => {
    void createWorkspace(path).then(() => { setBrowsing(false) }).catch((failure: unknown) => {
      if (isInvalidPathRefusal(failure)) {
        setError(t('panel.error.ketosHome', { path }))
        return
      }
      report(failure)
    })
  }

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
    registerWorkspace(path)
  }

  useEffect(() => {
    if (!leftOpen) {
      setRowMenu(null)
      setViewOpen(false)
      setSearchOpen(false)
      setSearch('')
      setEdit(null)
    }
  }, [leftOpen])

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
        const groupId = groupOfChat(id)?.workspaceId
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

  const menuItems = (target: RowMenuTarget): readonly MenuEntry[] => {
    const common: MenuEntry[] = [
      { id: 'rename', label: t('panel.rename'), icon: <IconEditOutline16 /> },
    ]
    if (target.kind === 'project') {
      const group = groups.find(candidate => candidate.workspaceId === target.id)
      const path = group === undefined ? null : groupPath(group)
      // The folder's own path actions live in its row menu: the tree carries
      // no path row under the group.
      const folder: MenuEntry[] = path === null
        ? []
        : [
          { id: 'copy-path', label: t('panel.copyPath'), icon: <IconCopyOutline16 /> },
          ...(canOpenPath
            ? [{ id: 'open-folder', label: t('panel.openFolder'), icon: <IconFolderOpen16 /> } satisfies MenuEntry]
            : []),
        ]
      return [
        ...common,
        ...folder,
        { id: 'up', label: t('panel.moveUp') },
        { id: 'down', label: t('panel.moveDown') },
        { id: 'delete', label: t('panel.deleteFolder'), icon: <IconTrashOutline16 />, danger: true },
      ]
    }
    // A row move writes the manual order, so it is offered only while that
    // order is what the list renders; under newest-first it would be a no-op.
    const moves: MenuEntry[] = orderBy === 'manual'
      ? [
        { id: 'up', label: t('panel.moveUp') },
        { id: 'down', label: t('panel.moveDown') },
      ]
      : []
    return [
      ...common,
      { id: 'branch', label: t('panel.branch'), icon: <IconBranchOutline16 /> },
      { id: 'archive', label: t('panel.archive'), icon: <IconArchiveOutline20 size={16} /> },
      ...moves,
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
      const projectGroup = groups.find(candidate => candidate.workspaceId === workspaceId)
      const path = projectGroup === undefined ? null : groupPath(projectGroup)
      if (action === 'copy-path') {
        if (path !== null) copyPath(path)
        return
      }
      if (action === 'open-folder') {
        if (path !== null) openFolder(path)
        return
      }
      const workspaceOrder = groups
        .map(group => group.workspaceId)
        .filter((id): id is WorkspaceId => id !== undefined)
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
    const chatGroup = groupOfChat(chatId)
    const groupId = chatGroup?.workspaceId
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
    const visibleIds = (chatGroup?.chats ?? []).map(chat => chat.id)
    if (action === 'up') {
      void reorderChat(groupId, chatId, moveAnchor(visibleIds, chatId, -1)).catch(report)
      return
    }
    if (action === 'down') {
      void reorderChat(groupId, chatId, moveAnchor(visibleIds, chatId, 1)).catch(report)
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
      registerWorkspace(current.path)
      return
    }
    if (current.step !== 'confirm') return
    if (current.kind === 'project') {
      const workspaceId = current.id as WorkspaceId
      actions.setPanelGroupExpanded(workspaceId, false)
      void deleteWorkspace(workspaceId).catch(report)
      return
    }
    void archiveChat(current.id as SessionId).catch(report)
  }

  const newChat = (group: BoardChatGroup): void => {
    if (group.workspaceId !== undefined) {
      void startChat(cardWindow.id, group.workspaceId).catch(report)
      return
    }
    createChat(cardWindow.id, group.cwd === '' ? {} : { cwd: group.cwd })
  }

  return (
    <>
      <WindowPanelShell
        side="left"
        open={leftOpen}
        rect={leftRect}
        hidden={hidden}
        zIndex={cardWindow.zIndex}
        zoom={zoom}
        t={t}
        actions={actions}
        windowId={cardWindow.id}
        startGesture={startGesture}
      >
        <div className={css.header}>
          {!browsing && (
            <>
              <span className={css.title}>{t('panel.workingFolders')}</span>
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
                onClick={() => { setBrowsing(true) }}
              >
                <IconProjectAddOutline16 />
              </button>
            </>
          )}
          {browsing && (
            <button type="button" data-row-action="" className={css.back} onClick={() => { setBrowsing(false) }}>
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
              onClick={() => { actions.setWindowPanel(cardWindow.id, 'left', false) }}
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

        {searchOpen && !browsing && (
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
          {browsing && (
            <FolderBrowser
              t={t}
              listDirectory={listDirectory}
              createDirectory={createDirectory}
              pickDirectory={pickDirectory}
              useFolder={handleSelectFolder}
              onFailure={setError}
            />
          )}

          {!browsing && visibleGroups.map((group) => {
            const key = group.workspaceId ?? ''
            const expanded = expandedGroups.has(key)
            return (
              <div key={key === '' ? 'ungrouped' : key} className={css.groupBlock} data-board-group={key}>
                <div className={css.groupRow}>
                  <button
                    type="button"
                    data-row-key={`project:${key}`}
                    data-board-group-toggle={expanded ? 'open' : 'closed'}
                    className={clsx(css.row, drop === `project:${key}` && css.dropTarget)}
                    onPointerDown={(e) => { if (group.workspaceId !== undefined) startRowDrag('project', group.workspaceId, e) }}
                    onClick={() => {
                      if (dragClickGuard()) return
                      actions.setPanelGroupExpanded(key, !expanded)
                    }}
                  >
                    <span className={clsx(css.chevron, expanded && css.chevronOpen)}>
                      <IconChevronRightOutline14 />
                    </span>
                    <span className={css.rowIcon}><IconFolderOpen16 /></span>
                    <span className={css.rowText}>{group.label === '' ? t('panel.ungrouped') : group.label}</span>
                  </button>
                  <button
                    type="button"
                    data-row-action=""
                    data-board-action="panel-new-chat"
                    className={css.rowAction}
                    aria-label={t('panel.newChat')}
                    onClick={() => { setError(null); newChat(group) }}
                  >
                    <IconNewChatOutline16 />
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

                {expanded && group.chats.map(chat => (
                  <div key={chat.id} className={css.sessionRow}>
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
              </div>
            )
          })}
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
      </WindowPanelShell>

      {/* The right panel is the session's file surface: tabs, the files tree,
          and file viewers (Т3.7–Т3.11). */}
      <WindowPanelShell
        side="right"
        open={rightOpen}
        rect={rightRect}
        hidden={hidden}
        zIndex={cardWindow.zIndex}
        zoom={zoom}
        t={t}
        actions={actions}
        windowId={cardWindow.id}
        startGesture={startGesture}
      >
        <RightPanel
          windowId={cardWindow.id}
          sessionId={windowSessionId}
          cwd={session?.cwd}
          t={t}
          useStore={useStore}
          actions={actions}
          openFileInPanel={openFileInPanel}
          documentPreviewFor={documentPreviewFor}
          listWorkspaceDirectory={listWorkspaceDirectory}
          readWorkspaceFile={readWorkspaceFile}
        />
      </WindowPanelShell>
    </>
  )
}

/** One of the window's two panels: the sliding shell, its resize handle, and
 * the shared chrome around the side's content. */
function WindowPanelShell({
  side, open, rect, hidden, zIndex, zoom, t, actions, windowId, startGesture, children,
}: {
  readonly side: 'left' | 'right'
  readonly open: boolean
  readonly rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
  readonly hidden: boolean
  readonly zIndex: number
  /** Canvas zoom: the resize gesture divides screen deltas into world units. */
  readonly zoom: number
  readonly t: WindowChatsPanelProps['t']
  readonly actions: WindowChatsPanelProps['actions']
  readonly windowId: BoardWindowState['id']
  readonly startGesture: ReturnType<typeof useBoardPointerGesture>
  readonly children: ReactNode
}): ReactNode {
  // Dragging a panel's outer edge resizes that panel; the delta is world units
  // like every other frame gesture.
  const startResize = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.stopPropagation()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startWidth = rect.width
    const outward = side === 'left' ? -1 : 1
    startGesture(target, e.pointerId, {
      move: (moveEvt) => {
        const delta = (moveEvt.clientX - startX) / zoom
        actions.setWindowPanelWidth(windowId, side, startWidth + delta * outward)
      },
    })
  }
  return (
    <div
      data-board-panel={side}
      data-board-panel-side={side}
      data-board-panel-window={windowId}
      data-board-panel-open={open ? '' : undefined}
      data-board-culled={hidden ? '' : undefined}
      aria-hidden={!open || undefined}
      className={clsx(css.panel, hidden && css.hidden)}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, zIndex }}
    >
      <div
        data-board-action="panel-resize"
        className={clsx(css.resizeHandle, side === 'left' ? css.resizeLeft : css.resizeRight)}
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('panel.resize')}
      />
      {children}
    </div>
  )
}

/**
 * The compact folder browser the panel registers a workspace with. Hosts whose
 * boot mounted the native picker serve no directory listing, so a failed load
 * falls back to that host chooser instead of leaving the level unusable.
 */
function FolderBrowser({ t, listDirectory, createDirectory, pickDirectory, useFolder, onFailure }: {
  readonly t: WindowChatsPanelProps['t']
  readonly listDirectory: (path?: string) => Promise<BoardDirectoryListing>
  readonly createDirectory: (path: string, name: string) => Promise<string>
  readonly pickDirectory: () => Promise<string | null>
  readonly useFolder: (path: string, home?: string) => void
  /** Show one host refusal on the panel's error surface. */
  readonly onFailure: (message: string) => void
}): ReactNode {
  const [listing, setListing] = useState<BoardDirectoryListing | null>(null)
  const [folderName, setFolderName] = useState<string | null>(null)
  const [browseFailed, setBrowseFailed] = useState(false)
  const requestSeq = useRef(0)

  const load = useCallback((path?: string) => {
    const request = ++requestSeq.current
    // Only the newest request settles the view: an older listing that answers
    // late must not replace the level the user already navigated to.
    void listDirectory(path).then((next) => {
      if (request !== requestSeq.current) return
      setListing(next)
      setBrowseFailed(false)
    }).catch(() => {
      if (request !== requestSeq.current) return
      setBrowseFailed(true)
    })
  }, [listDirectory])

  useEffect(() => { load() }, [load])

  const pickInSystem = (): void => {
    void pickDirectory().then((path) => {
      if (path !== null) useFolder(path)
    }, () => {
      onFailure(t('panel.pick.failed'))
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
