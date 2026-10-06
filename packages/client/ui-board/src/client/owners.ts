/**
 * Board participants: the single source of owner identities and their colors.
 *
 * Everything the board shows about owners derives from here: the acting owner,
 * the participant roster, a participant resolved by id, and the color
 * attribute a surface renders. Stages 28 and 32 replace the demo source behind
 * the selectors, so consumers read {@link currentOwnerId},
 * {@link boardParticipants}, {@link participantOf}, and {@link ownerColorAttr}
 * and never import {@link DEMO_TEAM} or {@link DEMO_SELF_ID} themselves.
 */
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { BOARD_ACCESS_MAX_PEOPLE, BOARD_ACCESS_MODES, type BoardWindowAccessMode } from '../board-settings.ts'
import type { BoardState } from './store.ts'
import type { BoardWindowState, WindowAccess } from './contract/slots.ts'
import type { BoardKey, BoardTranslate } from './locale.ts'

/** Compile-time identity of one board owner. */
export type OwnerId = Branded<'OwnerId'>

/**
 * Palette slot an owner's color resolves to. The ten values are the complete
 * set of colors the board styles; a participant carries an index, never a
 * literal color.
 */
export type OwnerColorIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

/**
 * One owner presented on the board. Demo participants carry {@link nameKey};
 * real participants (from stage 32) carry their own {@link name}.
 */
export interface BoardParticipant {
  /** Stable owner identity. */
  readonly id: OwnerId
  /** Dictionary key of the participant's display name. */
  readonly nameKey?: BoardKey
  /** Participant's display name. */
  readonly name?: string
  /** Palette slot this participant's color resolves to. */
  readonly color: OwnerColorIndex
}

/**
 * The acting owner of the demo board. Stage 28 replaces the derivation behind
 * {@link currentOwnerId}; this constant then names the demo record only.
 */
export const DEMO_SELF_ID: OwnerId = brandString<OwnerId>('demo-self')

/**
 * Fixed character limit of an owner id. A format bound of the layout protocol,
 * not a deployment setting: a longer id is not representable anywhere the
 * board stores owners.
 */
export const OWNER_ID_MAX_LENGTH = 64

/**
 * The four demo participants, each on its own palette slot. Stage 32 replaces
 * the roster behind {@link boardParticipants}.
 */
export const DEMO_TEAM: readonly BoardParticipant[] = [
  { id: DEMO_SELF_ID, nameKey: 'owner.demo.self', color: 1 },
  { id: brandString<OwnerId>('demo-finance'), nameKey: 'owner.demo.finance', color: 2 },
  { id: brandString<OwnerId>('demo-legal'), nameKey: 'owner.demo.legal', color: 3 },
  { id: brandString<OwnerId>('demo-analyst'), nameKey: 'owner.demo.analyst', color: 4 },
]

/** The color attribute value an owner's surface carries. */
export type OwnerColorAttr = `${OwnerColorIndex}` | 'unknown'

/**
 * Id of the owner acting on the board.
 * @param _state - current board state; the demo source ignores it, and stage 28 derives the owner from it.
 * @returns the acting owner's id.
 */
export function currentOwnerId(_state: BoardState): OwnerId {
  return DEMO_SELF_ID
}

/**
 * Whether the acting owner manages one window: the window belongs to the
 * current participant. Stage 33 adds the condition that the window lives on
 * this machine.
 * @param state - current board state.
 * @param window - window to test.
 * @returns whether the current participant may transfer the window or change its access.
 */
export function canManageWindow(state: BoardState, window: BoardWindowState): boolean {
  return window.ownerId === currentOwnerId(state)
}

/**
 * Every participant of the board, in display order.
 * @param _state - current board state; the demo source ignores it, and stage 32 derives the roster from it.
 * @returns the participant roster.
 */
export function boardParticipants(_state: BoardState): readonly BoardParticipant[] {
  return DEMO_TEAM
}

/**
 * Look one participant up by owner id.
 * @param state - current board state.
 * @param id - owner identity to resolve.
 * @returns the participant, or undefined when the board does not know the id.
 */
export function participantOf(state: BoardState, id: OwnerId): BoardParticipant | undefined {
  return boardParticipants(state).find(participant => participant.id === id)
}

/**
 * Resolve the color attribute one owner's surface renders.
 * @param state - current board state.
 * @param id - owner identity to resolve.
 * @returns the palette slot as its attribute string, or `'unknown'` for an id no participant owns.
 */
export function ownerColorAttr(state: BoardState, id: OwnerId): OwnerColorAttr {
  const participant = participantOf(state, id)
  return participant === undefined ? 'unknown' : String(participant.color) as OwnerColorAttr
}

/**
 * Display name of one participant.
 * @param t - board namespace translator.
 * @param participant - participant to label, or undefined when the id resolved to nobody.
 * @returns the participant's name, or the unknown-participant label.
 */
export function participantLabel(t: BoardTranslate, participant: BoardParticipant | undefined): string {
  if (participant === undefined) return t('owner.unknown')
  if (participant.nameKey !== undefined) return t(participant.nameKey)
  return participant.name ?? t('owner.unknown')
}

/**
 * Leading character mark of one participant label: the first code point, so a
 * name outside the basic plane still yields a whole character.
 * @param label - resolved participant label.
 * @returns the first code point, or an empty string for an empty label.
 */
export function participantInitial(label: string): string {
  return Array.from(label).slice(0, 1).join('')
}

/**
 * Whether a value is structurally a valid owner id: a non-empty string within
 * {@link OWNER_ID_MAX_LENGTH} characters and free of control characters. The
 * check admits any value at the format boundary; it does not assert that a
 * participant owns the id.
 * @param value - value to test.
 * @returns whether the value is a well-formed owner id.
 */
export function isOwnerIdFormat(value: unknown): value is OwnerId {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= OWNER_ID_MAX_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value)
}

/** Whether a value is a plain record to read access fields from. */
function isAccessRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Repair one stored or incoming access value. The mode is one of
 * {@link BOARD_ACCESS_MODES} or falls back to `'owner'`; the people list keeps
 * only well-formed owner ids, drops duplicates and the owner, and stops at
 * {@link BOARD_ACCESS_MAX_PEOPLE}. The check is format-only: it never asserts
 * membership in {@link boardParticipants}, whose roster arrives asynchronously
 * (stage 32), and never keeps the owner in the list.
 * @param raw - the stored or supplied access value.
 * @param ownerId - the window's owner, removed from the people list.
 * @returns the repaired access value.
 */
export function sanitizeWindowAccess(raw: unknown, ownerId: OwnerId): WindowAccess {
  const record = isAccessRecord(raw) ? raw : {}
  const mode = typeof record.mode === 'string' && (BOARD_ACCESS_MODES as readonly string[]).includes(record.mode)
    ? record.mode as BoardWindowAccessMode
    : 'owner'
  const candidates = Array.isArray(record.people) ? record.people : []
  const people: OwnerId[] = []
  const seen = new Set<OwnerId>()
  for (const candidate of candidates) {
    if (people.length >= BOARD_ACCESS_MAX_PEOPLE) break
    if (!isOwnerIdFormat(candidate)) continue
    const id = brandString<OwnerId>(candidate)
    if (id === ownerId || seen.has(id)) continue
    seen.add(id)
    people.push(id)
  }
  return { mode, people }
}
