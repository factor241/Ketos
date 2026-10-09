/**
 * Frame of one foreign window: the record another Ketos published, drawn in
 * world coordinates under its z. The owner bezel carries the publishing
 * participant's fill and mark without menus or drag, the header names the
 * window and its status, and the body is the shared read-only placeholder
 * until a kind registers its own card (stage 34 registers the chat card).
 */
import { memo, useMemo } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRenderSlots, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardWindowRecord } from '@ketos/board-doc/types'
import type { BoardStoreHandle } from '../store.ts'
import type { BoardWindowState } from '../contract/slots.ts'
import type { BoardTranslate } from '../locale.ts'
import { ownerColorAttr, ownerLinkLost, participantLabel, participantOf } from '../owners.ts'
import { WINDOW_STATUS_DOT, WINDOW_STATUS_KEY } from '../window-status.ts'
import { foreignWindowTitle } from '../window-title.ts'
import { WindowBezel } from './WindowBezel.tsx'
import css from './ForeignWindowFrame.module.css'

export interface ForeignWindowFrameProps {
  /** The published record the frame renders. */
  readonly record: BoardWindowRecord
  /** Slot renderer; the frame renders the kind's body card or the placeholder itself. */
  readonly renderSlot: PropsRenderSlots<'board.foreign.window.body'>['renderSlot']
  /** Board namespace translator. */
  readonly t: BoardTranslate
  /** Board store read seat. */
  readonly useStore: PropsStore<BoardStoreHandle>['useStore']
  /** Board action face, threaded to the informational bezel. */
  readonly actions: PropsStore<BoardStoreHandle>['actions']
}

/**
 * Shared placeholder body of a foreign window: names the window and its
 * publishing owner until a kind registers its own card.
 * @param props - the record and the store seats.
 * @returns the placeholder content.
 */
export function ForeignWindowPlaceholder({
  record, t, useStore,
}: Pick<ForeignWindowFrameProps, 'record' | 't' | 'useStore'>) {
  const ownerName = useStore(s => participantLabel(t, participantOf(s, record.ownerId)))
  const title = foreignWindowTitle(t, record)
  return (
    <span data-board-foreign-placeholder="">
      {t('foreign.window.fallback', { kind: title, name: ownerName })}
    </span>
  )
}

/**
 * Render one foreign window. The body renders here, inside the memoized
 * frame, so an unchanged record does not call the slot dispatcher again.
 * @param props - the record, the slot renderer, and the store seats.
 * @returns the world-positioned placeholder frame.
 */
export const ForeignWindowFrame = memo(function ForeignWindowFrame({
  record, renderSlot, t, useStore, actions,
}: ForeignWindowFrameProps) {
  const ownerColor = useStore(s => ownerColorAttr(s, record.ownerId))
  const ownerName = useStore(s => participantLabel(t, participantOf(s, record.ownerId)))
  // The record is as fresh as its host: a lost channel to the publishing
  // Ketos marks the placeholder, a host the peer roster does not know (a
  // deployment without peer networking) does not.
  const stale = useStore(s => ownerLinkLost(s, record.hostId))
  const title = foreignWindowTitle(t, record)
  // The bezel speaks the layout vocabulary; the record is projected onto the
  // fields the informational bezel reads.
  const windowState = useMemo<BoardWindowState>(() => ({
    id: record.id,
    kind: record.kind,
    bodyKind: record.bodyKind,
    ordinal: record.ordinal,
    ownerId: record.ownerId,
    access: { mode: record.access.mode, people: [...record.access.people] },
    x: record.x,
    y: record.y,
    width: record.w,
    height: record.h,
    zIndex: record.z,
  }), [record])

  return (
    <div
      data-board-foreign-window
      data-board-owner-color={ownerColor}
      className={css.window}
      style={{
        left: record.x,
        top: record.y,
        width: record.w,
        height: record.h,
        zIndex: record.z,
      }}
      role="group"
      aria-label={t('foreign.window.aria', { name: ownerName })}
    >
      <WindowBezel
        window={windowState}
        t={t}
        useStore={useStore}
        actions={actions}
        interactive={false}
        staleLabel={stale ? t('peer.stale') : undefined}
        staleHint={stale ? t('peer.stale.hint') : undefined}
      />
      <div className={css.header}>
        <span className={css.title} data-board-foreign-title={title}>{title}</span>
        <span className={css.meta} data-board-foreign-status={record.status}>
          <StateDot state={WINDOW_STATUS_DOT[record.status]} size={10} />
          {t(WINDOW_STATUS_KEY[record.status])}
        </span>
      </div>
      <div className={css.body}>
        {renderSlot('board.foreign.window.body', { record }, {
          entryKey: record.kind,
          fallback: <ForeignWindowPlaceholder record={record} t={t} useStore={useStore} />,
        })}
      </div>
    </div>
  )
})
