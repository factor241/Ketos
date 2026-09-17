/**
 * Left floating dock: one row per open window plus the board controls. Each row
 * shows the window's resolved name (the user's name, else the chat title, else
 * the kind template) and renames the window in place on a double click.
 */
import { useState } from 'react'
import clsx from 'clsx'
import {
  IconAgentPresetOutline16,
  IconBrowseOutline16,
  IconFullscreenOutline16,
  IconPlusOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardWindowInjected, BoardWindowState, WindowKind } from '../contract/slots.ts'
import type { BoardTranslate } from '../locale.ts'
import { nextWindowOrdinal, type BoardStoreHandle } from '../store.ts'
import { openBoardWindow, type BoardActions } from '../open-window.ts'
import { windowTitle } from '../window/window-title.ts'
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

interface DockRowProps {
  readonly window: BoardWindowState
  readonly active: boolean
  readonly actions: BoardActions
  readonly t: BoardTranslate
  readonly useWindowSession: InjectFace<BoardWindowInjected>['useWindowSession']
}

/** One window row: name tooltip, center-on-click, in-place rename on double click. */
function DockRow({ window: win, active, actions, t, useWindowSession }: DockRowProps) {
  const session = useWindowSession(win.id)
  const title = windowTitle(t, win, session?.displayTitle)
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (value: string): void => {
    actions.setWindowCustomTitle(win.id, value)
    setDraft(null)
  }

  return (
    <div className={css.row}>
      {draft === null
        ? (
          <Tooltip label={title} side="right" delayMs={300}>
            <button
              type="button"
              data-board-dock-row=""
              data-board-action="dock-rename"
              data-board-title={title}
              onClick={() => { actions.centerOnWindow(win.id) }}
              onDoubleClick={() => { setDraft(win.customTitle ?? '') }}
              className={clsx(css.windowButton, active && css.active)}
              aria-label={title}
            >
              {windowGlyph(win.kind)}
            </button>
          </Tooltip>
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

export function SessionRail({ useStore, actions, t, useWindowSession }: SessionRailProps) {
  const windowOrder = useStore(s => s.windowOrder)
  const windows = useStore(s => s.windows)
  const activeWindowId = useStore(s => s.activeWindowId)

  const openAgent = () => {
    openBoardWindow(actions, 'agent', nextWindowOrdinal(windows))
  }

  return (
    <div data-board-layer="dock" className={css.rail}>
      {windowOrder.map((id) => {
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
          />
        )
      })}

      <div className={css.divider} />

      <Tooltip label={t('rail.addAgent')} side="right" delayMs={300}>
        <button
          type="button"
          data-board-action="dock-add-agent"
          onClick={openAgent}
          className={css.addButton}
          aria-label={t('rail.addAgent')}
        >
          <IconPlusOutline16 />
        </button>
      </Tooltip>

      <Tooltip label={t('rail.resetView')} side="right" delayMs={300}>
        <button
          type="button"
          data-board-action="dock-reset-view"
          onClick={() => {
            actions.setPan(0, 0)
            actions.setZoom(1)
          }}
          className={css.control}
          aria-label={t('rail.resetView')}
        >
          <IconFullscreenOutline16 />
        </button>
      </Tooltip>
    </div>
  )
}
