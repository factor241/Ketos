/**
 * React entry views for the Spatial Board slot registrations.
 */
import clsx from 'clsx'
import type { PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from './store.ts'
import { ElementSelectionOverlay } from './ElementSelectionOverlay.tsx'
import css from './BoardViews.module.css'

/** Props of the board main-panel body: the child render share, the store share, and the locale seat. */
export type BoardRootProps =
  PropsRuntime<'main'>
  & PropsRenderSlots<'board.canvas' | 'board.dock' | 'board.omnibar' | 'board.minimap'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>

export function BoardRoot({ renderSlot, useStore, actions, t }: BoardRootProps) {
  const selecting = useStore(s => s.isSelectingElement)
  return (
    <div data-surface="board" className={clsx(css.root, 'board-canvas')}>
      {renderSlot('board.canvas', {})}
      {renderSlot('board.dock', {})}
      {renderSlot('board.omnibar', {})}
      {renderSlot('board.minimap', {})}
      <ElementSelectionOverlay
        t={t}
        active={selecting}
        onCancel={() => { actions.setSelectingElement(false) }}
      />
    </div>
  )
}

export function BoardIcon({ size, active }: PropsRuntime<'sidebar.panellist'>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={clsx(css.icon, active && css.active)}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  )
}
