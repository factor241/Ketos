/**
 * Left floating dock: one row per open window plus the board controls. Each row
 * shows the window's resolved name (the user's name, else the chat title, else
 * the kind template), its kind, and the status the window channel reports; a
 * click centers an inactive window and only focuses the active one, the row's
 * context menu renames or closes it, and closing keeps the session alive.
 */
import { useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconAgentPresetOutline16,
  IconBrowseOutline16,
  IconFullscreenOutline16,
  IconPlusOutline16,
  Menu,
  StateDot,
  Tooltip,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardWindowInjected, BoardWindowState, WindowKind } from '../contract/slots.ts'
import type { BoardTranslate } from '../locale.ts'
import { nextWindowOrdinal, type BoardStoreHandle } from '../store.ts'
import { menuPlacement, type MenuPlacement } from '../menu-placement.ts'
import { BoardPopoverProvider, useBoardPopoverBoundary } from '../board-popover.tsx'
import { openBoardWindow, type BoardActions } from '../open-window.ts'
import { windowTitle } from '../window-title.ts'
import { WINDOW_STATUS_DOT, WINDOW_STATUS_KEY, windowStatus } from '../window-status.ts'
import css from './SessionRail.module.css'

export type SessionRailProps =
  PropsRuntime<'board.dock'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>
  & InjectFace<BoardWindowInjected>

/** The dock glyph for one window kind. */
function windowGlyph(kind: WindowKind) {
  return kind === 'agent' || kind === 'clone'
    ? <IconAgentPresetOutline16 />
    : <IconBrowseOutline16 />
}

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
}

/**
 * One window row: glyph with its status dot, center-or-focus click, in-place
 * rename on double click, and the context menu that renames or closes.
 */
function DockRow({ window: win, active, actions, t, useWindowSession, useCloneList }: DockRowProps) {
  const session = useWindowSession(win.id)
  // A clone window is named by the record it edits, not by the interview
  // session running inside it.
  const clone = useCloneList(roster => win.cloneId === undefined
    ? undefined
    : roster.clones.find(entry => entry.id === win.cloneId))
  const title = windowTitle(t, win, session?.displayTitle, clone?.name)
  const status = windowStatus(session)
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
            <Tooltip label={title} side="right" delayMs={300}>
              <button
                ref={rowRef}
                type="button"
                data-board-dock-row=""
                data-board-action="dock-row"
                data-board-kind={win.kind}
                data-board-title={title}
                data-board-status={status}
                onClick={() => {
                  // The active row only raises the window while the view is on
                  // it; a view that moved away is brought back instead.
                  if (active) actions.revealWindow(win.id)
                  else actions.centerOnWindow(win.id)
                }}
                onDoubleClick={() => { setDraft(win.customTitle ?? '') }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setMenu(menuPlacement(event.currentTarget, boundary()))
                }}
                className={clsx(css.windowButton, active && css.active)}
                aria-label={t('rail.statusLabel', { title, status: t(WINDOW_STATUS_KEY[status]) })}
              >
                {windowGlyph(win.kind)}
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

export function SessionRail({ useStore, actions, t, useWindowSession, useCloneList, openClone }: SessionRailProps) {
  // The dock reads its own order (A6): raising a window reorders the paint
  // stack, never the icons.
  const dockOrder = useStore(s => s.dockOrder)
  const windows = useStore(s => s.windows)
  const activeWindowId = useStore(s => s.activeWindowId)
  const clones = useCloneList(roster => roster.clones)
  const [addMenu, setAddMenu] = useState<MenuPlacement | null>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const boundary = useBoardPopoverBoundary()

  const openAgent = () => {
    openBoardWindow(actions, 'agent', nextWindowOrdinal(windows))
  }

  const addMenuItems: readonly MenuEntry[] = ADD_MENU_KINDS.map(kind => ({
    id: kind,
    label: t(ADD_MENU_LABEL[kind]),
    icon: windowGlyph(kind),
  }))

  // The dock is screen-space chrome: its tooltips and menus portal into the
  // board's popover layer at scale 1, outside the dock's own centring
  // transform (a containing block for fixed offspring until then).
  const dock = (
    <div data-board-layer="dock" data-board-chrome="" className={css.rail}>
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
          />
        )
      })}

      <div className={css.divider} />

      <Tooltip label={t('rail.addAgent')} side="right" delayMs={300}>
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

      <Tooltip label={t('rail.resetView')} side="right" delayMs={300}>
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
      {clones.length > 0 && (
        <>
          <div className={css.divider} />
          {clones.map(clone => (
            <Tooltip key={clone.id} label={`${clone.name} · ${clone.role}`} side="right" delayMs={300}>
              <button
                type="button"
                className={css.cloneButton}
                data-board-clone-row={clone.id}
                aria-label={t('rail.openClone', { name: clone.name })}
                onClick={() => { openClone(clone.id) }}
              >
                <IconAgentPresetOutline16 />
              </button>
            </Tooltip>
          ))}
        </>
      )}
    </div>
  )
  return <BoardPopoverProvider useStore={useStore}>{dock}</BoardPopoverProvider>
}
