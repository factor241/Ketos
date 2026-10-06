/**
 * Owner mark of one window bezel: the owner's color as a circle carrying the
 * first character of the owner's name, with the full name beside it.
 *
 * With {@link OwnerBadgeProps.onTriggerClick} the mark is a button that opens
 * the owner transfer menu; without it the mark is the informational caption a
 * participant without management rights sees. Either form carries
 * `data-board-bezel-item`, so the window drag ignores it.
 */
import { participantInitial } from '../owners.ts'
import css from './WindowBezel.module.css'

export interface OwnerBadgeProps {
  /** Localized owner name, or the unknown-participant label. */
  readonly label: string
  /** Open the owner transfer menu; absent leaves the badge informational. */
  readonly onTriggerClick?: (() => void) | undefined
  /** Whether the transfer menu is open (`aria-expanded`). */
  readonly expanded?: boolean | undefined
  /** Accessible name of the trigger; carries the owner's name. */
  readonly triggerLabel?: string | undefined
}

/**
 * Render the owner's color mark and name.
 * @param props - the owner's resolved label, or the trigger wiring that turns the mark into a menu button.
 * @returns the badge at the bezel's left side.
 */
export function OwnerBadge({ label, onTriggerClick, expanded = false, triggerLabel }: OwnerBadgeProps) {
  const content = (
    <>
      <span aria-hidden="true" className={css.ownerAvatar}>{participantInitial(label)}</span>
      <span className={css.ownerName}>{label}</span>
    </>
  )
  if (onTriggerClick === undefined) {
    return <span data-board-bezel-item className={css.ownerBadge}>{content}</span>
  }
  return (
    <button
      type="button"
      data-board-action="bezel-owner"
      data-board-bezel-item
      className={css.ownerBadge}
      aria-haspopup="menu"
      aria-expanded={expanded}
      aria-label={triggerLabel}
      onClick={onTriggerClick}
    >
      {content}
    </button>
  )
}
