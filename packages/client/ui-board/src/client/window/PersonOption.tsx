/**
 * One participant option inside a bezel menu: the participant's palette circle
 * followed by the participant's name. The owner transfer menu and the access
 * menu's people submenu both render their candidates through it, so the rows
 * stay identical.
 */
import { participantLabel, type BoardParticipant } from '../owners.ts'
import type { BoardTranslate } from '../locale.ts'
import css from './WindowBezel.module.css'

export interface PersonOptionProps {
  /** Participant the option names. */
  readonly participant: BoardParticipant
  /** Board namespace translator. */
  readonly t: BoardTranslate
}

/**
 * Render one participant menu option.
 * @param props - the participant and the translator.
 * @returns the color circle and the participant's name.
 */
export function PersonOption({ participant, t }: PersonOptionProps) {
  return (
    <span className={css.personOption}>
      <span aria-hidden="true" data-board-owner-color={String(participant.color)} className={css.personDot} />
      {participantLabel(t, participant)}
    </span>
  )
}
