/**
 * Bottom floating dock: one icon per open window plus the board controls in a
 * horizontal strip, centred on the board. Each icon shows the window's glyph
 * and the status the window channel reports; a click centers an inactive
 * window and only focuses the active one, the row's context menu renames or
 * closes it, and closing keeps the session alive. The `+` control opens the
 * window catalog (agent with its preset submenu, the utility kinds, and the
 * recent chats), the element picker arms the inspector for the active chat
 * window, and the strip grows to the board's width minus the inset and then
 * scrolls sideways, a vertical wheel included.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import clsx from 'clsx'
import {
  IconAgentPresetOutlineRegular,
  IconFullscreenOutlineRegular,
  IconInspectOutlineRegular,
  IconPlusOutlineRegular,
  IconUsersOutlineRegular,
  Menu,
  StateDot,
  Tooltip,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CloneId } from '@ketos/clone-core/types'
import type { StrokeWidth } from '@ketos/board-doc/types'
import { STROKE_WIDTHS, mintElementId } from '@ketos/board-doc/data'
import type {
  BoardElementInjected, BoardPeerInjected, BoardWindowInjected, BoardWindowState, WindowId,
} from '../contract/slots.ts'
import type { BoardTranslate } from '../locale.ts'
import { nextWindowOrdinal, type BoardStoreHandle } from '../store.ts'
import { BOARD_ELEMENT_KIND_DESCRIPTORS } from '../board-element-kinds.ts'
import { placeInSafeArea } from '../board-coordinates.ts'
import { createTodoList } from '../todo-api.ts'
import { ParticipantsPopover } from './ParticipantsPopover.tsx'
import { TodoCreatePopover } from './TodoCreatePopover.tsx'
import { menuPlacement, type MenuPlacement } from '../menu-placement.ts'
import { BoardPopoverPortal, BoardPopoverProvider, useBoardPopoverBoundary } from '../board-popover.tsx'
import { useBoardChromeInset } from '../use-board-chrome-inset.ts'
import { useBoardPointerGesture } from '../pointer-gesture.ts'
import { openBoardWindow, type BoardActions } from '../open-window.ts'
import { folderName, recentChats } from '../chat-list-model.ts'
import { windowTitle } from '../window-title.ts'
import { WINDOW_STATUS_DOT, WINDOW_STATUS_KEY, windowStatus } from '../window-status.ts'
import { WindowIcon, windowKindGlyph } from './WindowIcon.tsx'
import css from './SessionRail.module.css'

export type SessionRailProps =
  PropsRuntime<'board.dock'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>
  & InjectFace<BoardWindowInjected>
  & InjectFace<BoardPeerInjected>
  & BoardElementInjected

/** Most recent chats the dock's `+` menu offers. */
const RECENT_CHAT_LIMIT = 6

interface DockRowProps {
  readonly window: BoardWindowState
  readonly active: boolean
  readonly actions: BoardActions
  readonly t: BoardTranslate
  readonly useWindowSession: InjectFace<BoardWindowInjected>['useWindowSession']
  readonly useCloneList: InjectFace<BoardWindowInjected>['useCloneList']
  readonly useWorkspaceList: InjectFace<BoardWindowInjected>['useWorkspaceList']
  /** Where the insertion indicator sits for this row while a drag is live. */
  readonly dropSide?: 'before' | 'after' | undefined
  /** Start the reorder gesture on this row. */
  readonly onDragStart: (event: ReactPointerEvent<HTMLElement>) => void
  /** Consume the click a finished drag leaves behind. */
  readonly takeDragClick: () => boolean
}

/**
 * One window row: glyph with its status dot, center-or-focus click, in-place
 * rename on double click, and the context menu that renames or closes.
 */
function DockRow({
  window: win, active, actions, t, useWindowSession, useCloneList, useWorkspaceList,
  dropSide, onDragStart, takeDragClick,
}: DockRowProps) {
  const session = useWindowSession(win.id)
  // A clone window is named by the record it edits, not by the interview
  // session running inside it.
  const clone = useCloneList(roster => win.cloneId === undefined
    ? undefined
    : roster.clones.find(entry => entry.id === win.cloneId))
  const title = windowTitle(t, win, session?.displayTitle, clone?.name)
  const status = windowStatus(session)
  // The chip's folder tint: the workspace the session's directory belongs to,
  // else the directory itself, else none (a session without a folder).
  const cwd = session?.cwd
  const folderKey = useWorkspaceList((list) => {
    if (cwd === undefined) return undefined
    const workspace = list.items.find(item => item.path === cwd)
    return workspace === undefined ? cwd : String(workspace.workspaceId)
  })
  const [draft, setDraft] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuPlacement | null>(null)
  const rowRef = useRef<HTMLButtonElement>(null)
  const boundary = useBoardPopoverBoundary()

  const commit = (value: string): void => {
    actions.setWindowCustomTitle(win.id, value)
    setDraft(null)
  }

  const menuItems: readonly MenuEntry[] = [
    { id: 'rename', label: t('window.rename') },
    {
      id: 'close',
      label: (
        <span className={css.menuItem}>
          <span>{t('rail.closeWindow')}</span>
          <span className={css.menuHint}>{t('rail.closeWindow.hint')}</span>
        </span>
      ),
    },
  ]

  return (
    <div className={css.row}>
      {draft === null
        ? (
          <>
            <Tooltip label={title} side="top" delayMs={300}>
              <button
                ref={rowRef}
                type="button"
                data-board-dock-row=""
                data-board-action="dock-row"
                data-board-kind={win.kind}
                data-board-title={title}
                data-board-status={status}
                data-dock-slot="window"
                data-dock-slot-id={win.id}
                data-dock-drop={dropSide}
                onPointerDown={onDragStart}
                onClick={() => {
                  // A click left by a finished drag must not center the window.
                  if (takeDragClick()) return
                  // The active row only raises the window while the view is on
                  // it; a view that moved away is brought back instead.
                  if (active) actions.revealWindow(win.id)
                  else actions.centerOnWindow(win.id)
                }}
                onDoubleClick={() => {
                  if (takeDragClick()) return
                  setDraft(win.customTitle ?? '')
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setMenu(menuPlacement(event.currentTarget, boundary()))
                }}
                className={clsx(css.windowButton, active && css.active)}
                aria-label={t('rail.statusLabel', { title, status: t(WINDOW_STATUS_KEY[status]) })}
              >
                <WindowIcon kind={win.kind} title={title} cloneName={clone?.name} folderKey={folderKey} />
                <span className={css.statusDot}><StateDot state={WINDOW_STATUS_DOT[status]} size={8} /></span>
              </button>
            </Tooltip>
            <Menu
              portal
              open={menu !== null}
              side={menu?.side ?? 'bottom'}
              align={menu?.align ?? 'start'}
              selection="fill"
              anchor={<span />}
              getAnchorRect={() => rowRef.current?.getBoundingClientRect() ?? null}
              items={menuItems}
              onSelect={(id) => {
                setMenu(null)
                if (id === 'rename') {
                  setDraft(win.customTitle ?? '')
                  return
                }
                actions.closeWindow(win.id)
              }}
              onClose={() => { setMenu(null) }}
            />
          </>
        )
        : (
          <input
            className={css.rowInput}
            value={draft}
            autoFocus
            aria-label={t('window.rename')}
            data-board-action="dock-title-input"
            onChange={(e) => { setDraft(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit(draft)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setDraft(null)
              }
            }}
            onBlur={() => { commit(draft) }}
          />
        )}
    </div>
  )
}

/** Glyph of the `create:note` entry: a note sheet with its text lines. */
function NoteIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="3" width="16" height="18" rx="2" ry="2" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="16" x2="12" y2="16" />
    </svg>
  )
}

/** Glyph of the `create:todo` entry: a checklist with one checked box. */
function TodoIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="6" height="6" rx="1.5" />
      <path d="M4.5 7 5.8 8.3 7.8 5.8" />
      <line x1="13" y1="7" x2="21" y2="7" />
      <rect x="3" y="14" width="6" height="6" rx="1.5" />
      <line x1="13" y1="17" x2="21" y2="17" />
    </svg>
  )
}

/** Glyph of the brush control: a paintbrush with its bristle tip. */
function BrushIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.5 3.5c-1.5-1.5-4-1.5-5.5 0L8 10.5l5.5 5.5 7-7c1.5-1.5 1.5-4 0-5.5Z" />
      <path d="M8 10.5 5 17l-2 4 4-2 6.5-3" />
    </svg>
  )
}

/** Glyph of the eraser control: a tilted eraser with its baseline. */
function EraserIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6.5 20.5-3.5-3.5 10-10a2.1 2.1 0 0 1 3 0l2.5 2.5a2.1 2.1 0 0 1 0 3l-9.5 9.5H6.5Z" />
      <path d="M9 21h11" />
    </svg>
  )
}

/** Glyph of the brush-width control: three line weights, the active one opaque. */
function BrushWidthIcon({ width }: { readonly width: StrokeWidth }) {
  const rows: ReadonlyArray<{ readonly key: StrokeWidth; readonly y: number }> = [
    { key: 's', y: 7 },
    { key: 'm', y: 12 },
    { key: 'l', y: 17 },
  ]
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {rows.map(row => (
        <line key={row.key} x1="4" y1={row.y} x2="20" y2={row.y} opacity={row.key === width ? 1 : 0.35} />
      ))}
    </svg>
  )
}

export function SessionRail({
  useStore, actions, t, useWindowSession, useCloneList, useWorkspaceList, useSessionList,
  useAgentPresetRoster, openChat, openClone, createClone, refreshAgentPresets, refreshClones,
  createElement, createPeerInvite, connectPeerByInvite,
}: SessionRailProps) {
  // The dock reads its own order (A6): raising a window reorders the paint
  // stack, never the icons.
  const dockOrder = useStore(s => s.dockOrder)
  const windows = useStore(s => s.windows)
  const activeWindowId = useStore(s => s.activeWindowId)
  const cloneOrder = useStore(s => s.cloneOrder)
  // The safe-area state the `create:note` entry places a new note with: the
  // same projection the store's window placement runs.
  const panX = useStore(s => s.panX)
  const panY = useStore(s => s.panY)
  const zoom = useStore(s => s.zoom)
  const viewportWidth = useStore(s => s.viewportWidth)
  const viewportHeight = useStore(s => s.viewportHeight)
  const chromeInsetSources = useStore(s => s.chromeInsetSources)
  const tool = useStore(s => s.tool)
  const brushWidth = useStore(s => s.brushWidth)
  const clones = useCloneList(roster => roster.clones)
  // The clone strip renders in the stored dock order (A6): ids the order does
  // not know yet (a roster addition since the last adoption) follow in roster
  // order.
  const orderedClones = useMemo(() => {
    const rank = new Map(cloneOrder.map((id, index) => [String(id), index]))
    return [...clones].sort((left, right) =>
      (rank.get(String(left.id)) ?? Number.MAX_SAFE_INTEGER)
      - (rank.get(String(right.id)) ?? Number.MAX_SAFE_INTEGER))
  }, [cloneOrder, clones])
  const [addMenu, setAddMenu] = useState<MenuPlacement | null>(null)
  const [widthMenu, setWidthMenu] = useState<MenuPlacement | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // The list-title popover: its anchor rectangle at open time and the
  // in-flight flag that keeps one creation per click.
  const [todoCreate, setTodoCreate] = useState<{ anchor: DOMRect; boundary: DOMRect } | null>(null)
  const [todoBusy, setTodoBusy] = useState(false)
  // The participants popover's anchor rectangle at open time.
  const [participants, setParticipants] = useState<{ anchor: DOMRect; boundary: DOMRect } | null>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const participantsRef = useRef<HTMLButtonElement>(null)
  const widthRef = useRef<HTMLButtonElement>(null)
  const boundary = useBoardPopoverBoundary()
  const sessionList = useSessionList(s => s)
  const workspaceList = useWorkspaceList(s => s)
  const presetRoster = useAgentPresetRoster(s => s)
  const recent = useMemo(
    () => recentChats(sessionList, workspaceList, RECENT_CHAT_LIMIT),
    [sessionList, workspaceList],
  )
  const [dockElement, setDockElement] = useState<HTMLElement | null>(null)
  // The clone strip reads the roster, so the first board render loads it; a
  // startup that never opens the board stays free of clone requests.
  useEffect(() => { refreshClones() }, [refreshClones])
  // The stored clone order covers the roster: a clone added since the last
  // adoption is appended through the same action the drag uses, so a reorder
  // never writes an order that forgets the clones it did not move.
  useEffect(() => {
    const known = new Set(cloneOrder.map(String))
    for (const clone of clones) {
      if (!known.has(String(clone.id))) actions.reorderClones(clone.id, null)
    }
  }, [actions, cloneOrder, clones])

  /** The insertion indicator: which slot a live drag would drop before or after. */
  const [drop, setDrop] = useState<{ kind: 'window' | 'clone'; id: string; side: 'before' | 'after' } | null>(null)
  /** Whether the pointer passed the reorder threshold in the live gesture. */
  const dragged = useRef(false)
  const startGesture = useBoardPointerGesture()

  /** The dock slot under one point: its group kind, identity, and element. */
  const slotAt = (x: number, y: number): { kind: 'window' | 'clone'; id: string; element: HTMLElement } | null => {
    const element = document.elementFromPoint(x, y)?.closest('[data-dock-slot]')
    if (!(element instanceof HTMLElement)) return null
    const kind = element.dataset.dockSlot
    const id = element.dataset.dockSlotId
    if ((kind !== 'window' && kind !== 'clone') || id === undefined) return null
    return { kind, id, element }
  }

  /**
   * The move a drop at one point means for its group: the slot the indicator
   * sits at and the `before` target, or null when the point changes nothing
   * (a different group, the dragged icon itself, or its current place).
   */
  const resolveDrop = (
    kind: 'window' | 'clone',
    id: string,
    x: number,
    y: number,
  ): { slotId: string; side: 'before' | 'after'; before: string | null } | null => {
    const slot = slotAt(x, y)
    if (slot === null || slot.kind !== kind || slot.id === id) return null
    const order: readonly string[] = kind === 'window' ? dockOrder : orderedClones.map(clone => String(clone.id))
    const index = order.indexOf(id)
    const targetIndex = order.indexOf(slot.id)
    if (index < 0 || targetIndex < 0) return null
    const rect = slot.element.getBoundingClientRect()
    const side = x < rect.left + rect.width / 2 ? 'before' : 'after'
    const before = side === 'before' ? slot.id : order[targetIndex + 1] ?? null
    // Already in place: dropping here would write the same order.
    const destination = before === null ? order.length : order.indexOf(before)
    if (destination === index || destination === index + 1) return null
    return { slotId: slot.id, side, before }
  }

  /** Scroll the strip while a drag pointer nears its inner edges (Т1.6). */
  const scrollDockAtEdge = (x: number): void => {
    const dock = dockElement
    if (dock === null || dock.scrollWidth <= dock.clientWidth) return
    const rect = dock.getBoundingClientRect()
    const EDGE = 40
    if (x < rect.left + EDGE) dock.scrollLeft -= 12
    else if (x > rect.right - EDGE) dock.scrollLeft += 12
  }

  /**
   * One dock icon's reorder gesture: a 5px threshold starts the drag, the
   * indicator follows the pointer inside the icon's own group, and only a
   * pointerup commits the move through the store's reorder action.
   */
  const startDockDrag = (kind: 'window' | 'clone', id: string, event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    const startX = event.clientX
    const startY = event.clientY
    dragged.current = false
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)
    startGesture(element, event.pointerId, {
      move: (moveEvent) => {
        if (!dragged.current && Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) < 5) return
        dragged.current = true
        scrollDockAtEdge(moveEvent.clientX)
        const resolved = resolveDrop(kind, id, moveEvent.clientX, moveEvent.clientY)
        setDrop(resolved === null ? null : { kind, id: resolved.slotId, side: resolved.side })
      },
      end: (endEvent) => {
        setDrop(null)
        // Only a real pointerup commits: a pointercancel is the browser taking
        // the gesture back, and the drop target under a cancel means nothing.
        if (endEvent === null || endEvent.type !== 'pointerup' || !dragged.current) return
        const resolved = resolveDrop(kind, id, endEvent.clientX, endEvent.clientY)
        if (resolved === null) return
        if (kind === 'window') actions.reorderDock(id as WindowId, resolved.before as WindowId | null)
        else actions.reorderClones(id as CloneId, resolved.before as CloneId | null)
      },
    })
  }

  /** Consume the click a finished drag leaves on its icon. */
  const takeDragClick = (): boolean => {
    if (!dragged.current) return false
    dragged.current = false
    return true
  }
  // The dock declares the board edge it anchors to: the bottom strip.
  useBoardChromeInset('bottom', dockElement, actions)

  // The dock is the floating chrome's one horizontal scroller: a wheel over
  // it scrolls it sideways (a vertical wheel included) and never pans or zooms
  // the canvas. The listener is non-passive — React's root wheel listener is
  // passive, so preventDefault works only from here.
  useEffect(() => {
    if (dockElement === null) return
    const dock = dockElement
    const onWheel = (event: WheelEvent): void => {
      if (dock.scrollWidth <= dock.clientWidth) return
      const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY
      if (delta === 0) return
      event.preventDefault()
      dock.scrollLeft += delta
    }
    dock.addEventListener('wheel', onWheel, { passive: false })
    return () => { dock.removeEventListener('wheel', onWheel) }
  }, [dockElement])

  // The catalog refreshes its presets and clone roster on every open, so a row
  // the host added or removed since the last visit is offered or dropped
  // rather than stored stale.
  const toggleAddMenu = (): void => {
    refreshAgentPresets()
    refreshClones()
    setAddMenu(current => current !== null ? null : menuPlacement(addRef.current, boundary()))
  }

  /** Thickness rows of the brush-width menu. */
  const widthItems: readonly MenuEntry[] = [
    { id: 's', label: t('tool.width.s') },
    { id: 'm', label: t('tool.width.m') },
    { id: 'l', label: t('tool.width.l') },
  ]

  /** Open or close the participants popover above its dock control. */
  const toggleParticipants = (): void => {
    setParticipants(current => current !== null ? null : {
      anchor: participantsRef.current?.getBoundingClientRect() ?? new DOMRect(),
      boundary: boundary(),
    })
  }

  const toggleWidthMenu = (): void => {
    setWidthMenu(current => current !== null ? null : menuPlacement(widthRef.current, boundary()))
  }

  const chooseWidth = (id: string): void => {
    setWidthMenu(null)
    const width = STROKE_WIDTHS.find(candidate => candidate === id)
    if (width !== undefined) actions.setBrushWidth(width)
  }

  const handleMenuSelect = (id: string): void => {
    setAddMenu(null)
    switch (id) {
      case 'open:agent':
        openBoardWindow(actions, 'agent', nextWindowOrdinal(windows))
        return
      case 'open:connectors':
        openBoardWindow(actions, 'connectors', nextWindowOrdinal(windows))
        return
      case 'open:settings':
        openBoardWindow(actions, 'settings', nextWindowOrdinal(windows))
        return
      case 'open:clone':
        void createClone().then((created) => { if (created === 'failed') setNotice(t('clone.failed')) })
        return
      case 'open:dashboard':
        setNotice(t('menu.unavailable.dashboard'))
        return
      case 'open:tasks':
        openBoardWindow(actions, 'tasks', nextWindowOrdinal(windows))
        return
      case 'create:todo': {
        // The catalog asks for the list's title first; the list then opens in
        // the center of the visible safe area.
        const rect = addRef.current?.getBoundingClientRect()
        if (rect === undefined) return
        setTodoCreate({ anchor: rect, boundary: boundary() })
        return
      }
      case 'create:note': {
        // A new note opens at the center of the visible safe area, selected
        // and in editing, whatever the board's pan and zoom.
        const size = BOARD_ELEMENT_KIND_DESCRIPTORS.note.defaultSize
        const at = placeInSafeArea(
          { panX, panY, zoom, viewportWidth, viewportHeight, chromeInsetSources },
          size.width,
          size.height,
        )
        const id = mintElementId()
        createElement({
          id,
          kind: 'note',
          x: at.x,
          y: at.y,
          w: size.width,
          h: size.height,
          data: { text: '', font: 'sans', size: 'm', scale: 1 },
        })
        actions.selectBoardElement(id)
        actions.setEditingBoardElement(id)
        return
      }
      default:
        if (id.startsWith('preset:')) {
          // The quick choice at creation: remember the pick, then open the
          // window; its session is created with this preset by the bridge.
          actions.setDefaultPreset(id.slice('preset:'.length))
          openBoardWindow(actions, 'agent', nextWindowOrdinal(windows))
          return
        }
        if (id.startsWith('recent:')) {
          // The recent list follows the same duplicate rule as the chats panel:
          // an already open chat focuses its window instead of opening twice.
          const outcome = openChat(id.slice('recent:'.length) as SessionId)
          if (outcome.kind === 'unknown') setNotice(t('panel.chatGone'))
        }
        return
    }
  }

  /**
   * Create a list from the catalog popover in the center of the visible safe
   * area; a failure surfaces as the dock's localized notice.
   * @param title - validated list title.
   */
  const createTodo = (title: string): void => {
    const size = BOARD_ELEMENT_KIND_DESCRIPTORS.todo.defaultSize
    const at = placeInSafeArea(
      { panX, panY, zoom, viewportWidth, viewportHeight, chromeInsetSources },
      size.width,
      size.height,
    )
    setTodoBusy(true)
    void createTodoList(title, at.x, at.y).then((outcome) => {
      setTodoBusy(false)
      if (!outcome.ok) {
        setNotice(t(outcome.code === 'ketos/beads-unavailable'
          ? 'element.todo.error.unavailable'
          : 'element.todo.error.failed'))
        return
      }
      setTodoCreate(null)
    })
  }

  const addMenuItems: readonly MenuEntry[] = [
    { type: 'label', id: 'group.newWindow', text: t('menu.newWindow') },
    { id: 'open:agent', label: t('menu.open.agent'), icon: <IconAgentPresetOutlineRegular /> },
    ...(presetRoster.pickerEnabled && presetRoster.presets.length > 0
      ? [{
        id: 'preset',
        label: t('menu.preset'),
        icon: <IconAgentPresetOutlineRegular />,
        submenu: presetRoster.presets.map(preset => ({
          id: `preset:${preset.id}`,
          label: preset.name,
          ...(preset.isDefault === true ? { icon: <IconAgentPresetOutlineRegular /> } : {}),
        })),
      }] satisfies readonly MenuEntry[]
      : []),
    { id: 'open:connectors', label: t('menu.open.connectors'), icon: windowKindGlyph('connectors') },
    { id: 'open:settings', label: t('menu.open.settings'), icon: windowKindGlyph('settings') },
    { id: 'open:clone', label: t('menu.open.clone'), icon: <IconAgentPresetOutlineRegular /> },
    { id: 'open:dashboard', label: t('menu.open.dashboard'), icon: windowKindGlyph('dashboard') },
    { id: 'open:tasks', label: t('menu.open.tasks'), icon: windowKindGlyph('tasks') },
    { type: 'separator', id: 'separator.boardItems' },
    { type: 'label', id: 'group.boardItems', text: t('menu.group.boardItems') },
    { id: 'create:note', label: t('menu.create.note'), icon: <NoteIcon /> },
    { id: 'create:todo', label: t('menu.create.todo'), icon: <TodoIcon /> },
    ...(recent.length === 0 ? [] : [
      { type: 'separator', id: 'separator.recent' },
      { type: 'label', id: 'group.recentChats', text: t('menu.recentChats') },
      ...recent.map(row => ({
        id: `recent:${row.id}`,
        label: row.cwd === undefined || row.cwd === '' ? row.title : `${row.title} · ${folderName(row.cwd)}`,
      })),
    ] satisfies readonly MenuEntry[]),
  ]

  // The dock is screen-space chrome: its tooltips and menus portal into the
  // board's popover layer at scale 1, outside the dock's own centring
  // transform (a containing block for fixed offspring until then).
  const dock = (
    <div ref={setDockElement} data-board-layer="dock" data-board-chrome="bottom" className={css.rail}>
      {dockOrder.map((id) => {
        const win = windows[id as string]
        if (!win) return null

        return (
          <DockRow
            key={id}
            window={win}
            active={id === activeWindowId}
            actions={actions}
            t={t}
            useWindowSession={useWindowSession}
            useCloneList={useCloneList}
            useWorkspaceList={useWorkspaceList}
            dropSide={drop?.kind === 'window' && drop.id === String(id) ? drop.side : undefined}
            onDragStart={(event) => { startDockDrag('window', String(id), event) }}
            takeDragClick={takeDragClick}
          />
        )
      })}

      <div className={css.divider} />

      {notice !== null && (
        <div data-board-dock-notice className={css.notice}>{notice}</div>
      )}

      <Tooltip label={t('menu.openActionMenu')} side="top" delayMs={300} disabled={addMenu !== null}>
        <button
          ref={addRef}
          type="button"
          data-board-action="dock-add"
          onClick={toggleAddMenu}
          className={clsx(css.addButton, addMenu !== null && css.open)}
          aria-label={t('menu.openActionMenu')}
        >
          <IconPlusOutlineRegular />
        </button>
      </Tooltip>

      {/* The `+` catalog: the window kinds, the preset submenu, and the recent
          chats. The clone strip lives beside it, so no clone group repeats. */}
      <Menu
        portal
        open={addMenu !== null}
        side={addMenu?.side ?? 'top'}
        align={addMenu?.align ?? 'start'}
        selection="fill"
        anchor={<span />}
        getAnchorRect={() => addRef.current?.getBoundingClientRect() ?? null}
        items={addMenuItems}
        onSelect={handleMenuSelect}
        onClose={() => { setAddMenu(null) }}
      />

      {todoCreate !== null && (
        <BoardPopoverPortal>
          <TodoCreatePopover
            anchor={todoCreate.anchor}
            boundary={todoCreate.boundary}
            busy={todoBusy}
            t={t}
            onCreate={createTodo}
            onClose={() => { setTodoCreate(null) }}
          />
        </BoardPopoverPortal>
      )}

      <Tooltip label={t('peer.participants')} side="top" delayMs={300} disabled={participants !== null}>
        <button
          ref={participantsRef}
          type="button"
          data-board-action="dock-participants"
          onClick={toggleParticipants}
          className={clsx(css.control, participants !== null && css.controlActive)}
          aria-label={t('peer.participants')}
        >
          <IconUsersOutlineRegular size={12} />
        </button>
      </Tooltip>

      {participants !== null && (
        <BoardPopoverPortal>
          <ParticipantsPopover
            anchor={participants.anchor}
            boundary={participants.boundary}
            t={t}
            useStore={useStore}
            createInvite={createPeerInvite}
            connectPeer={connectPeerByInvite}
            onClose={() => { setParticipants(null) }}
          />
        </BoardPopoverPortal>
      )}

      <Tooltip label={t('menu.selectElement')} side="top" delayMs={300}>
        <button
          type="button"
          data-board-action="dock-select-element"
          onClick={() => { actions.setSelectingElement(true) }}
          className={css.control}
          aria-label={t('menu.selectElement')}
        >
          <IconInspectOutlineRegular size={12} />
        </button>
      </Tooltip>

      <Tooltip label={t('tool.brush')} side="top" delayMs={300}>
        <button
          type="button"
          data-board-action="dock-brush"
          aria-pressed={tool === 'brush'}
          onClick={() => { actions.setTool(tool === 'brush' ? 'select' : 'brush') }}
          className={clsx(css.control, tool === 'brush' && css.controlActive)}
          aria-label={t('tool.brush')}
        >
          <BrushIcon />
        </button>
      </Tooltip>

      <Tooltip label={t('tool.eraser')} side="top" delayMs={300}>
        <button
          type="button"
          data-board-action="dock-eraser"
          aria-pressed={tool === 'eraser'}
          onClick={() => { actions.setTool(tool === 'eraser' ? 'select' : 'eraser') }}
          className={clsx(css.control, tool === 'eraser' && css.controlActive)}
          aria-label={t('tool.eraser')}
        >
          <EraserIcon />
        </button>
      </Tooltip>

      <Tooltip label={t('tool.width')} side="top" delayMs={300} disabled={widthMenu !== null}>
        <button
          ref={widthRef}
          type="button"
          data-board-action="dock-brush-width"
          onClick={toggleWidthMenu}
          className={clsx(css.control, widthMenu !== null && css.controlActive)}
          aria-label={t('tool.width')}
        >
          <BrushWidthIcon width={brushWidth} />
        </button>
      </Tooltip>

      <Menu
        portal
        open={widthMenu !== null}
        side={widthMenu?.side ?? 'top'}
        align={widthMenu?.align ?? 'start'}
        selection="check"
        anchor={<span />}
        getAnchorRect={() => widthRef.current?.getBoundingClientRect() ?? null}
        items={widthItems}
        selectedId={brushWidth}
        onSelect={chooseWidth}
        onClose={() => { setWidthMenu(null) }}
      />

      <Tooltip label={t('rail.resetView')} side="top" delayMs={300}>
        <button
          type="button"
          data-board-action="dock-reset-view"
          onClick={() => { actions.resetView() }}
          className={css.control}
          aria-label={t('rail.resetView')}
        >
          <IconFullscreenOutlineRegular />
        </button>
      </Tooltip>

      {/* Clone mini-panel: one compact row per stored clone, opening (or
          focusing) the window that edits it. The roster is host data; the
          section is absent while the deployment stores no clone. */}
      {orderedClones.length > 0 && (
        <>
          <div className={css.divider} />
          {orderedClones.map(clone => (
            <Tooltip key={clone.id} label={clone.name} side="top" delayMs={300}>
              <button
                type="button"
                className={css.cloneButton}
                data-board-clone-row={clone.id}
                data-dock-slot="clone"
                data-dock-slot-id={clone.id}
                data-dock-drop={drop?.kind === 'clone' && drop.id === String(clone.id) ? drop.side : undefined}
                aria-label={t('rail.openClone', { name: clone.name })}
                onPointerDown={(event) => { startDockDrag('clone', clone.id, event) }}
                onClick={() => {
                  if (takeDragClick()) return
                  openClone(clone.id)
                }}
              >
                <WindowIcon kind="clone" title={clone.name} cloneName={clone.name} />
              </button>
            </Tooltip>
          ))}
        </>
      )}
    </div>
  )
  return <BoardPopoverProvider useStore={useStore}>{dock}</BoardPopoverProvider>
}
