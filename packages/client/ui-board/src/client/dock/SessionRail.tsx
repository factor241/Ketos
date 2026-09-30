/**
 * Bottom floating dock: one icon per open window plus the board controls in a
 * horizontal strip, centred on the board. Each icon shows the window's glyph
 * and the status the window channel reports; a click centers an inactive
 * window and only focuses the active one, the row's context menu renames or
 * closes it, and closing keeps the session alive. The strip grows to the
 * board's width minus the inset and then scrolls sideways, a vertical wheel
 * included.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import clsx from 'clsx'
import {
  IconFullscreenOutline16,
  IconPlusOutline16,
  Menu,
  StateDot,
  Tooltip,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { CloneId } from '@ketos/clone-core/types'
import type { BoardWindowInjected, BoardWindowState, WindowId } from '../contract/slots.ts'
import type { BoardTranslate } from '../locale.ts'
import { nextWindowOrdinal, type BoardStoreHandle } from '../store.ts'
import { menuPlacement, type MenuPlacement } from '../menu-placement.ts'
import { BoardPopoverProvider, useBoardPopoverBoundary } from '../board-popover.tsx'
import { useBoardChromeInset } from '../use-board-chrome-inset.ts'
import { useBoardPointerGesture } from '../pointer-gesture.ts'
import { openBoardWindow, type BoardActions } from '../open-window.ts'
import { windowTitle } from '../window-title.ts'
import { WINDOW_STATUS_DOT, WINDOW_STATUS_KEY, windowStatus } from '../window-status.ts'
import { WindowIcon, windowKindGlyph } from './WindowIcon.tsx'
import css from './SessionRail.module.css'

export type SessionRailProps =
  PropsRuntime<'board.dock'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>
  & InjectFace<BoardWindowInjected>

/**
 * Window kinds the dock's add menu opens. The dock is the quick entry point
 * (left click adds an agent directly); the Omnibox menu carries the full
 * catalog, including the kinds later stages own.
 */
const ADD_MENU_KINDS = ['agent', 'connectors', 'settings'] as const

/** Localized label of one add-menu kind. */
const ADD_MENU_LABEL = {
  agent: 'menu.open.agent',
  connectors: 'menu.open.connectors',
  settings: 'menu.open.settings',
} as const satisfies Record<typeof ADD_MENU_KINDS[number], Parameters<BoardTranslate>[0]>

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

export function SessionRail({
  useStore, actions, t, useWindowSession, useCloneList, useWorkspaceList, openClone,
}: SessionRailProps) {
  // The dock reads its own order (A6): raising a window reorders the paint
  // stack, never the icons.
  const dockOrder = useStore(s => s.dockOrder)
  const windows = useStore(s => s.windows)
  const activeWindowId = useStore(s => s.activeWindowId)
  const cloneOrder = useStore(s => s.cloneOrder)
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
  const addRef = useRef<HTMLButtonElement>(null)
  const boundary = useBoardPopoverBoundary()
  const [dockElement, setDockElement] = useState<HTMLElement | null>(null)
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

  const openAgent = () => {
    openBoardWindow(actions, 'agent', nextWindowOrdinal(windows))
  }

  const addMenuItems: readonly MenuEntry[] = ADD_MENU_KINDS.map(kind => ({
    id: kind,
    label: t(ADD_MENU_LABEL[kind]),
    icon: windowKindGlyph(kind),
  }))

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

      <Tooltip label={t('rail.addAgent')} side="top" delayMs={300}>
        <button
          ref={addRef}
          type="button"
          data-board-action="dock-add-agent"
          onClick={openAgent}
          onContextMenu={(event) => {
            event.preventDefault()
            setAddMenu(menuPlacement(event.currentTarget, boundary()))
          }}
          className={css.addButton}
          aria-label={t('rail.addAgent')}
        >
          <IconPlusOutline16 />
        </button>
      </Tooltip>

      {/* The right-click catalog: the left click stays the one-step agent add. */}
      <Menu
        portal
        open={addMenu !== null}
        side={addMenu?.side ?? 'bottom'}
        align={addMenu?.align ?? 'start'}
        selection="fill"
        anchor={<span />}
        getAnchorRect={() => addRef.current?.getBoundingClientRect() ?? null}
        items={addMenuItems}
        onSelect={(kind) => {
          setAddMenu(null)
          openBoardWindow(actions, kind as typeof ADD_MENU_KINDS[number], nextWindowOrdinal(windows))
        }}
        onClose={() => { setAddMenu(null) }}
      />

      <Tooltip label={t('rail.resetView')} side="top" delayMs={300}>
        <button
          type="button"
          data-board-action="dock-reset-view"
          onClick={() => { actions.resetView() }}
          className={css.control}
          aria-label={t('rail.resetView')}
        >
          <IconFullscreenOutline16 />
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
