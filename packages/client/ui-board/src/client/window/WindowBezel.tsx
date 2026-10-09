/**
 * Owner bezel of one board window: the layer behind the window surface that
 * carries the owner mark and the access indicator.
 *
 * The bezel is a child of the frame, so it moves, resizes, and scales with the
 * window without any board-side synchronization. The managing participant gets
 * the transfer and access menus on the mark and the indicator; everyone else
 * gets the plain captions. Its geometry, fill, and content styles live in
 * `WindowBezel.module.css`; the show/hide and panel-side rules live in
 * `WindowFrame.module.css` because CSS-module class names are hashed per file.
 * The background drags the window through the same hook as the header.
 */
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardStoreHandle } from '../store.ts'
import type { BoardWindowState } from '../contract/slots.ts'
import type { BoardTranslate } from '../locale.ts'
import { boardParticipants, canManageWindow, ownerIsUnknown, participantLabel } from '../owners.ts'
import { accessPeople, AccessIndicator } from './AccessIndicator.tsx'
import { AccessMenu } from './AccessMenu.tsx'
import { OwnerBadge } from './OwnerBadge.tsx'
import { OwnerTransferMenu } from './OwnerTransferMenu.tsx'
import { useWindowDragStart } from './window-drag.ts'
import css from './WindowBezel.module.css'

export interface WindowBezelProps {
  /** The window the bezel belongs to. */
  readonly window: BoardWindowState
  /** Board namespace translator. */
  readonly t: BoardTranslate
  /** Board store read seat; the bezel resolves the roster through it. */
  readonly useStore: PropsStore<BoardStoreHandle>['useStore']
  /** Board action face, for the background drag. */
  readonly actions: PropsStore<BoardStoreHandle>['actions']
  /**
   * Whether the acting participant manages this window: the owner controls and
   * the background drag render. A foreign window passes false and gets the
   * informational bezel without menus or movement.
   */
  readonly interactive?: boolean
  /** Stale-data badge text; absent renders no badge (the owner has a channel). */
  readonly staleLabel?: string | undefined
  /** Tooltip of the stale-data badge. */
  readonly staleHint?: string | undefined
}

/**
 * Render the owner bezel of one window.
 * @param props - the window, the translator, the store seat, the action face, and the interactive flag.
 * @returns the bezel layer that the frame renders under its content.
 */
export function WindowBezel({
  window: cardWindow, t, useStore, actions, interactive = true, staleLabel, staleHint,
}: WindowBezelProps) {
  // The roster arrives through the store: document participant records united
  // with connected peers; an id the roster does not know keeps the neutral
  // unknown color and label.
  const participants = useStore(s => boardParticipants(s))
  const manageable = useStore(s => interactive && canManageWindow(s, cardWindow))
  // A window of this layout whose owner nobody knows can be taken over; a
  // foreign window (not interactive) never can.
  const claimable = useStore(s => interactive && s.windows[cardWindow.id as string] !== undefined
    && ownerIsUnknown(s, cardWindow.ownerId))
  const owner = participants.find(participant => participant.id === cardWindow.ownerId)
  const drag = useWindowDragStart(cardWindow, useStore, actions)
  const handlePointerDown = interactive ? drag : undefined

  return (
    <div
      data-board-bezel
      data-board-bezel-interactive={interactive}
      className={css.bezel}
      onPointerDown={handlePointerDown === undefined ? undefined : handlePointerDown}
    >
      <div className={css.strip}>
        {manageable
          ? (
            <>
              <OwnerTransferMenu window={cardWindow} t={t} useStore={useStore} actions={actions} />
              <AccessMenu window={cardWindow} t={t} useStore={useStore} actions={actions} />
            </>
          )
          : (
            <>
              <OwnerBadge label={participantLabel(t, owner)} />
              {claimable && (
                <button
                  type="button"
                  data-board-action="bezel-claim"
                  data-board-bezel-item
                  className={css.claim}
                  onClick={() => { actions.claimWindow(cardWindow.id) }}
                >
                  {t('bezel.claim')}
                </button>
              )}
              {staleLabel !== undefined && (
                <Tooltip label={staleHint ?? staleLabel} side="bottom">
                  <span data-board-stale="" tabIndex={0} className={css.stale}>{staleLabel}</span>
                </Tooltip>
              )}
              <AccessIndicator
                mode={cardWindow.access.mode}
                people={accessPeople(t, participants, cardWindow.access.people)}
                t={t}
              />
            </>
          )}
      </div>
    </div>
  )
}
