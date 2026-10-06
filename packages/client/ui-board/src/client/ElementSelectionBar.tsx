/**
 * Screen-space toolbar of the selected element: it stands above the element in
 * panel pixels (the same projection the handle ring uses), so the kind-owned
 * buttons stay legible at any zoom. Its content is the keyed
 * `board.element.toolbar` slot, hosted at screen scale so a menu opened from
 * it keeps screen coordinates.
 *
 * It lives at the top level beside the handle ring: a top-level file may not
 * import a domain, and the bar composes only shared seats.
 */
import type { ReactNode } from 'react'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardElement } from '@ketos/board-doc/types'
import { BoardPopoverProvider } from './board-popover.tsx'
import { worldToScreen } from './board-coordinates.ts'
import { DEMO_SELF_ID } from './owners.ts'
import type { BoardStoreHandle } from './store.ts'
import css from './ElementSelectionBar.module.css'

/** Screen-pixel gap between the bar and the element's top edge. */
const BAR_OFFSET = 36

export type ElementSelectionBarProps =
  PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>
  & {
    /**
     * Render the selected element's kind toolbar.
     * @param element - the selected element.
     * @param editable - whether the acting participant owns it.
     * @returns the toolbar node.
     */
    readonly renderToolbar: (element: BoardElement, editable: boolean) => ReactNode
  }

export function ElementSelectionBar({ useStore, renderToolbar }: ElementSelectionBarProps) {
  const selectedId = useStore(s => s.selectedBoardElementId)
  const element = useStore(s => selectedId === null ? undefined : s.boardElements[selectedId as string])
  const selfId = useStore(s => s.selfId)
  const panX = useStore(s => s.panX)
  const panY = useStore(s => s.panY)
  const zoom = useStore(s => s.zoom)
  if (element === undefined) return null
  const topLeft = worldToScreen({ panX, panY, zoom }, { x: element.x, y: element.y })
  const editable = element.ownerId === (selfId ?? DEMO_SELF_ID)
  return (
    <BoardPopoverProvider useStore={useStore}>
      <div
        data-board-element-bar=""
        data-board-element-bar-id={element.id}
        className={css.bar}
        style={{ left: topLeft.x, top: topLeft.y - BAR_OFFSET }}
      >
        {renderToolbar(element, editable)}
      </div>
    </BoardPopoverProvider>
  )
}
