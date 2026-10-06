/**
 * Access indicator of one window bezel: who besides the owner may work with
 * the window.
 *
 * With {@link AccessIndicatorProps.onTriggerClick} the indicator is a button
 * that opens the owner's access menu; without it the indicator is the
 * informational caption a participant without management rights sees.
 * `owner` shows the person glyph and «Only me», `all` the group glyph and
 * «Everyone», and `selected` a stack of up to three person circles with a
 * tooltip that names every selected person. Either form carries
 * `data-board-bezel-item`, so the window drag ignores it.
 */
import { IconUserOutlineRegular, IconUsersOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BoardWindowAccessMode } from '../../board-settings.ts'
import {
  participantInitial, participantLabel, type BoardParticipant, type OwnerColorAttr, type OwnerId,
} from '../owners.ts'
import type { BoardKey, BoardTranslate } from '../locale.ts'
import css from './WindowBezel.module.css'

/** Number of selected-person circles shown before the `+N` remainder. */
export const ACCESS_AVATAR_LIMIT = 3

/** Dictionary key naming each access mode in trigger labels and menu rows. */
const ACCESS_MODE_KEY = {
  owner: 'bezel.access.owner',
  selected: 'bezel.access.selected',
  all: 'bezel.access.all',
} as const satisfies Record<BoardWindowAccessMode, BoardKey>

/** One selected person as the access indicator renders it. */
export interface AccessPerson {
  /** Palette attribute the person's circle takes. */
  readonly color: OwnerColorAttr
  /** Localized person name, or the unknown-participant label. */
  readonly label: string
}

/**
 * Resolve one window's selected people into the records the indicator renders.
 * An id the roster does not know keeps the neutral unknown color and label.
 * @param t - board namespace translator.
 * @param participants - board participant roster.
 * @param people - selected owner ids, in the owner's order.
 * @returns one record per id, in the same order.
 */
export function accessPeople(
  t: BoardTranslate,
  participants: readonly BoardParticipant[],
  people: readonly OwnerId[],
): AccessPerson[] {
  return people.map((id) => {
    const participant = participants.find(candidate => candidate.id === id)
    return {
      color: participant === undefined ? 'unknown' : String(participant.color) as OwnerColorAttr,
      label: participantLabel(t, participant),
    }
  })
}

export interface AccessIndicatorProps {
  /** Access mode the window stores. */
  readonly mode: BoardWindowAccessMode
  /** Selected people, in the owner's order; the owner is not among them. */
  readonly people: readonly AccessPerson[]
  /** Board namespace translator. */
  readonly t: BoardTranslate
  /** Open the access menu; absent leaves the indicator informational. */
  readonly onTriggerClick?: (() => void) | undefined
  /** Whether the access menu is open (`aria-expanded`). */
  readonly expanded?: boolean | undefined
}

/**
 * Render the window's access mode.
 * @param props - the mode, the selected people, the translator, and the trigger wiring that turns the indicator into a menu button.
 * @returns the indicator at the bezel's right side.
 */
export function AccessIndicator({ mode, people, t, onTriggerClick, expanded = false }: AccessIndicatorProps) {
  const inner = (() => {
    if (mode === 'owner') {
      return (
        <>
          <IconUserOutlineRegular className={css.accessIcon} />
          <span className={css.accessText}>{t('bezel.access.owner')}</span>
        </>
      )
    }
    if (mode === 'all') {
      return (
        <>
          <IconUsersOutlineRegular className={css.accessIcon} />
          <span className={css.accessText}>{t('bezel.access.allShort')}</span>
        </>
      )
    }
    if (people.length === 0) {
      return <span className={css.accessText}>{t('bezel.access.selected')}</span>
    }
    const shown = people.slice(0, ACCESS_AVATAR_LIMIT)
    const rest = people.length - shown.length
    return (
      <Tooltip label={people.map(person => person.label).join(', ')} side="bottom">
        <span className={css.people}>
          {shown.map((person, index) => (
            <span key={index} data-board-owner-color={person.color} className={css.person}>
              {participantInitial(person.label)}
            </span>
          ))}
          {rest > 0 && <span className={css.more}>{t('bezel.access.more', { n: rest })}</span>}
        </span>
      </Tooltip>
    )
  })()
  if (onTriggerClick !== undefined) {
    return (
      <button
        type="button"
        data-board-action="bezel-access"
        data-board-bezel-item
        className={css.access}
        aria-haspopup="menu"
        aria-expanded={expanded}
        aria-label={t('bezel.access.aria', { mode: t(ACCESS_MODE_KEY[mode]) })}
        onClick={onTriggerClick}
      >
        {inner}
      </button>
    )
  }
  return (
    <span data-board-bezel-item role="img" aria-label={t(ACCESS_MODE_KEY[mode])} className={css.access}>
      {inner}
    </span>
  )
}
