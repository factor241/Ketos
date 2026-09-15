/**
 * Window layer: renders every open window through the keyed `board.window`
 * slot, and owns the keyed `board.window.body` declaration whose dispatcher it
 * hands to each frame as an owner prop.
 */
import { Fragment } from 'react'
import type { PropsRenderSlots, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardWindowState } from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'

export type BoardWindowLayerProps =
  PropsRenderSlots<'board.window' | 'board.window.body'>
  & PropsStore<BoardStoreHandle>

export function BoardWindowLayer({ renderSlot, useStore }: BoardWindowLayerProps) {
  const windowOrder = useStore(s => s.windowOrder)
  const windows = useStore(s => s.windows)
  const renderBody = (window: BoardWindowState) =>
    renderSlot('board.window.body', { window }, { entryKey: window.bodyKind })

  return (
    <>
      {windowOrder.map((id) => {
        const window = windows[id as string]
        if (!window) return null
        return (
          <Fragment key={window.id}>
            {renderSlot('board.window', { window, renderBody }, { entryKey: window.kind })}
          </Fragment>
        )
      })}
    </>
  )
}
