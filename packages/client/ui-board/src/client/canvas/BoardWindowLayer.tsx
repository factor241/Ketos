/**
 * Window layer: renders every open window through the keyed `board.window`
 * slot, and owns the keyed `board.window.body` declaration whose dispatcher it
 * hands to each frame as an owner prop. The dispatcher is one stable callback
 * so the memoized frames only re-render for their own window; culled and
 * fullscreen-hidden windows stay mounted and hide through their own class.
 *
 * The layer also watches the open set: a window leaving the order hands its id
 * to the session bridge, which drops that window's record and subscriptions
 * while the session itself stays alive.
 */
import { Fragment, useCallback, useEffect, useRef } from 'react'
import type { InjectFace, PropsRenderSlots, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardWindowInjected, BoardWindowState, WindowId } from '../contract/slots.ts'
import type { BoardStoreHandle } from '../store.ts'

export type BoardWindowLayerProps =
  PropsRenderSlots<'board.window' | 'board.window.body' | 'board.window.panel'>
  & PropsStore<BoardStoreHandle>
  & InjectFace<BoardWindowInjected>

export function BoardWindowLayer({ renderSlot, useStore, releaseWindow }: BoardWindowLayerProps) {
  const windowOrder = useStore(s => s.windowOrder)
  const windows = useStore(s => s.windows)
  const openRef = useRef<readonly WindowId[]>([])
  const renderBody = useCallback(
    (window: BoardWindowState) => renderSlot('board.window.body', { window }, { entryKey: window.bodyKind }),
    [renderSlot],
  )

  // The bridge's per-window records follow the open set; a closed window's
  // subscriptions go with it, while its session stays alive and listed.
  useEffect(() => {
    const open = new Set(windowOrder)
    for (const id of openRef.current) {
      if (!open.has(id)) releaseWindow(id)
    }
    openRef.current = [...windowOrder]
  }, [windowOrder, releaseWindow])

  return (
    <>
      {windowOrder.map((id) => {
        const window = windows[id as string]
        if (!window) return null
        return (
          <Fragment key={window.id}>
            {/* The chats panel is a companion under the frame: same layer order,
                earlier in the DOM, so the frame always paints above it. */}
            {renderSlot('board.window.panel', { window }, { entryKey: window.kind })}
            {renderSlot('board.window', { window, renderBody }, { entryKey: window.kind })}
          </Fragment>
        )
      })}
    </>
  )
}
