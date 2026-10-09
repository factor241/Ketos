/**
 * Foreign-window layer: renders every shared window record whose host is
 * another Ketos, in paint order by z and culled to the visible canvas. The
 * layer owns the keyed `board.foreign.window.body` declaration and hands each
 * frame the dispatcher's body for its kind; a kind without an occupant gets the
 * frame's general `ForeignWindowCard`, and `agent` registers `ForeignChatCard`.
 * A frame outside the visible canvas is unmounted, so an open transcript
 * collapses when its window is panned out of view.
 *
 * Own records stay out: the local layout renders them, and the record slice
 * exists so a receiver sees the other Ketos's windows without letting them
 * into `windowOrder`, the dock, or the overview.
 */
import { shallowEqual } from '@deepseek-ai/dsh-client-store'
import type { PropsLocale, PropsRenderSlots, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardWindowRecord } from '@ketos/board-doc/types'
import type { BoardStoreHandle, BoardState } from '../store.ts'
import { isRectVisible } from '../culling.ts'
import { ForeignWindowFrame } from './ForeignWindowFrame.tsx'
import css from './ForeignWindowLayer.module.css'

export type ForeignWindowLayerProps =
  PropsRenderSlots<'board.foreign.window.body'>
  & PropsStore<BoardStoreHandle>
  & PropsLocale<'board'>

/**
 * Every foreign record that intersects the visible canvas, in paint order.
 * Pure over the board snapshot; the caller compares the result by its
 * elements, because each call builds a new array. Before the first snapshot
 * the acting owner is unknown, so no record can be told apart as foreign.
 * @param state - the board state.
 * @returns the ordered visible records.
 */
function visibleForeignRecords(state: BoardState): readonly BoardWindowRecord[] {
  if (state.selfId === null) return []
  return Object.values(state.windowRecords)
    .filter(record => record.hostId !== state.selfId)
    .filter(record => isRectVisible(state, { x: record.x, y: record.y, w: record.w, h: record.h }))
    .sort((left, right) => left.z - right.z || (left.id < right.id ? -1 : 1))
}

/**
 * Render every visible foreign window. The frames are memoized by their
 * record, so a patch that changes one record re-renders that frame only.
 * @param props - the slot renderer, the store seats, and the board translator.
 * @returns the layer with one frame per visible foreign record.
 */
export function ForeignWindowLayer({ renderSlot, useStore, actions, t }: ForeignWindowLayerProps) {
  const records = useStore(visibleForeignRecords, shallowEqual)

  return (
    <div data-board-layer="foreign-windows" className={css.layer}>
      {records.map(record => (
        <ForeignWindowFrame
          key={record.id}
          record={record}
          renderSlot={renderSlot}
          t={t}
          useStore={useStore}
          actions={actions}
        />
      ))}
    </div>
  )
}
