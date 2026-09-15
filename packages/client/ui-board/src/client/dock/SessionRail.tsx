/**
 * Left floating rail for active sessions/windows OpenSwarm-style.
 */
import { useState } from 'react'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'
import { openBoardWindow } from '../open-window.ts'
import css from './SessionRail.module.css'

export type SessionRailProps =
  PropsRuntime<'board.dock'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>

/** Glyphs of the rail controls; they are icons, not copy. */
const TOOL_GLYPH = '🛠'
const CONNECTORS_GLYPH = '⚙'
const RESET_GLYPH = '⌖'

export function SessionRail({ useStore, actions, t }: SessionRailProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const windowOrder = useStore(s => s.windowOrder)
  const windows = useStore(s => s.windows)
  const activeWindowId = useStore(s => s.activeWindowId)

  const openAgent = () => {
    openBoardWindow(actions, 'agent', t('canvas.agentTitle', { n: windowOrder.length + 1 }), {
      status: 'idle',
      statusText: t('canvas.agentStatusOnline'),
    })
  }

  const openConnectors = () => {
    openBoardWindow(actions, 'connectors', t('canvas.connectorsTitle'))
  }

  return (
    <div data-board-layer="dock" className={css.rail}>
      {windowOrder.map((id) => {
        const win = windows[id as string]
        if (!win) return null
        const isActive = id === activeWindowId
        const isHovered = hoveredId === id
        const isAgent = win.kind === 'agent'

        return (
          <div
            key={id}
            className={css.row}
            onMouseEnter={() => { setHoveredId(id) }}
            onMouseLeave={() => { setHoveredId(null) }}
          >
            <button
              onClick={() => { actions.centerOnWindow(id) }}
              className={clsx(css.windowButton, isActive && css.active)}
              title={win.title}
            >
              {isAgent ? t('rail.agentBadge') : TOOL_GLYPH}
            </button>

            {isHovered && (
              <div className={css.tooltip}>
                {win.title}
              </div>
            )}
          </div>
        )
      })}

      <div className={css.divider} />

      <button
        onClick={openAgent}
        className={css.addButton}
        title={t('rail.addAgent')}
      >
        +
      </button>

      <button
        onClick={openConnectors}
        className={css.control}
        title={t('rail.addConnectors')}
      >
        {CONNECTORS_GLYPH}
      </button>

      <button
        onClick={() => {
          actions.setPan(0, 0)
          actions.setZoom(1)
        }}
        className={css.control}
        title={t('rail.resetView')}
      >
        {RESET_GLYPH}
      </button>
    </div>
  )
}
