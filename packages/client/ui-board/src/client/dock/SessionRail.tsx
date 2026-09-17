/**
 * Left floating dock: one row per open window plus the board controls.
 */
import clsx from 'clsx'
import {
  IconAgentPresetOutline16,
  IconBrowseOutline16,
  IconFullscreenOutline16,
  IconPlusOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { WindowKind } from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'
import { openBoardWindow } from '../open-window.ts'
import css from './SessionRail.module.css'

export type SessionRailProps =
  PropsRuntime<'board.dock'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>

/** The dock glyph for one window kind. */
function windowGlyph(kind: WindowKind) {
  return kind === 'agent' || kind === 'clone'
    ? <IconAgentPresetOutline16 />
    : <IconBrowseOutline16 />
}

export function SessionRail({ useStore, actions, t }: SessionRailProps) {
  const windowOrder = useStore(s => s.windowOrder)
  const windows = useStore(s => s.windows)
  const activeWindowId = useStore(s => s.activeWindowId)

  const openAgent = () => {
    openBoardWindow(actions, 'agent', t('canvas.agentTitle', { n: windowOrder.length + 1 }))
  }

  return (
    <div data-board-layer="dock" className={css.rail}>
      {windowOrder.map((id) => {
        const win = windows[id as string]
        if (!win) return null
        const isActive = id === activeWindowId

        return (
          <div key={id} className={css.row}>
            <Tooltip label={win.title} side="right" delayMs={300}>
              <button
                type="button"
                data-board-dock-row=""
                onClick={() => { actions.centerOnWindow(id) }}
                className={clsx(css.windowButton, isActive && css.active)}
                aria-label={win.title}
              >
                {windowGlyph(win.kind)}
              </button>
            </Tooltip>
          </div>
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
