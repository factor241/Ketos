/**
 * Board participants: the single source of owner identities and their colors.
 *
 * Everything the board shows about owners derives from here: the acting owner,
 * the participant roster, a participant resolved by id, and the color
 * attribute a surface renders. The roster is the document's own participant
 * records — every Ketos writes only its record — united with the connected
 * peers the peer state reports by their board `selfId`; the acting owner is
 * the document's `selfId` once the first snapshot arrives, and null before
 * then. Consumers read {@link currentOwnerId}, {@link boardParticipants},
 * {@link participantOf}, and {@link ownerColorAttr} rather than the raw
 * slices.
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OwnerId } from '@ketos/board-doc/types'
import { BOARD_ACCESS_MAX_PEOPLE, BOARD_ACCESS_MODES, type BoardWindowAccessMode } from '../board-settings.ts'
import type { BoardState } from './store.ts'
import type { BoardWindowState, WindowAccess } from './contract/slots.ts'
import type { BoardKey, BoardTranslate } from './locale.ts'

/** Compile-time identity of one board owner; the document's brand owns it. */
export type { OwnerId }

/**
 * Palette slot an owner's color resolves to. The ten values are the complete
 * set of colors the board styles; a participant carries an index, never a
 * literal color.
 */
export type OwnerColorIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

/**
 * One owner presented on the board. The display name comes from either the
 * participant's own `name` (a document record or a connected peer) or a
 * dictionary key (`owner.self` for the acting participant whose name is not
 * known yet); the color is absent when no record named this participant's
 * palette slot, and then renders neutral.
 */
export interface BoardParticipant {
  /** Stable owner identity. */
  readonly id: OwnerId
  /** Dictionary key of the participant's display name. */
  readonly nameKey?: BoardKey
  /** Participant's display name. */
  readonly name?: string
  /** Palette slot this participant's color resolves to; absent renders `unknown`. */
  readonly color?: OwnerColorIndex
}

/**
 * Identity a board layout written before participant records existed stores
 * for the acting participant. {@link adoptSelfId} rewrites it to the
 * document's `selfId`; every other legacy id renders as an unknown
 * participant.
 */
export const DEMO_SELF_ID: OwnerId = brandString<OwnerId>('demo-self')

/**
 * Fixed character limit of an owner id. A format bound of the layout protocol,
 * not a deployment setting: a longer id is not representable anywhere the
 * board stores owners.
 */
export const OWNER_ID_MAX_LENGTH = 64

/** The color attribute value an owner's surface carries. */
export type OwnerColorAttr = `${OwnerColorIndex}` | 'unknown'

/**
 * The board state owner identity reads: the acting identity plus the two
 * roster sources — the document's participant records and the connected
 * peers.
 */
export type OwnerIdentityState =
  Pick<BoardState, 'selfId' | 'boardParticipants' | 'peerStates' | 'peerSelf'>

/** The palette slot of a decoded color number, or undefined outside the palette. */
function colorOf(value: number): OwnerColorIndex | undefined {
  return Number.isInteger(value) && value >= 1 && value <= 10 ? value as OwnerColorIndex : undefined
}

/**
 * Display order of two participants: by name — a participant without a name
 * sorts before named ones — with the id as the deterministic tie-break.
 * @param left - one participant.
 * @param right - the other participant.
 * @returns the comparison result.
 */
function compareParticipants(left: BoardParticipant, right: BoardParticipant): number {
  const leftName = left.name ?? ''
  const rightName = right.name ?? ''
  if (leftName !== rightName) return leftName < rightName ? -1 : 1
  if (left.id === right.id) return 0
  return left.id < right.id ? -1 : 1
}

/**
 * Id of the owner acting on the board: the document's `selfId` once the first
 * snapshot arrived, null before then. A null acting owner manages nothing and
 * owns nothing; the store stamps a legacy placeholder only long enough for
 * the first snapshot to adopt the real identity.
 * @param state - state carrying the local participant.
 * @returns the acting owner's id, or null before the first snapshot.
 */
export function currentOwnerId(state: Pick<BoardState, 'selfId'>): OwnerId | null {
  return state.selfId
}

/**
 * Whether the acting owner manages one window: the window belongs to the
 * current participant. Before the first snapshot the acting identity is
 * unknown, so no window is manageable. Stage 33 adds the condition that the
 * window lives on this machine.
 * @param state - current board state.
 * @param window - window to test.
 * @returns whether the current participant may transfer the window or change its access.
 */
export function canManageWindow(state: BoardState, window: BoardWindowState): boolean {
  const owner = currentOwnerId(state)
  return owner !== null && window.ownerId === owner
}

/**
 * Every participant of the board, in display order: the document's records
 * first, then connected peers the document does not know yet, and always the
 * acting participant — from its document record, its peer self, or as the
 * unnamed "Я" entry on the first palette slot. Duplicate identities collapse
 * by `selfId`; the document record wins over a peer record.
 * @param state - state carrying the local participant and both roster sources.
 * @returns the participant roster, ordered by name.
 */
export function boardParticipants(state: OwnerIdentityState): readonly BoardParticipant[] {
  const roster = new Map<OwnerId, BoardParticipant>()
  for (const record of state.boardParticipants) {
    const color = colorOf(record.color)
    roster.set(record.id, { id: record.id, name: record.name, ...(color === undefined ? {} : { color }) })
  }
  for (const peer of state.peerStates) {
    if (roster.has(peer.selfId)) continue
    const color = colorOf(peer.color)
    roster.set(peer.selfId, { id: peer.selfId, name: peer.name, ...(color === undefined ? {} : { color }) })
  }
  const selfId = state.selfId
  if (selfId !== null && !roster.has(selfId)) {
    const self = state.peerSelf !== null && state.peerSelf.selfId === selfId ? state.peerSelf : null
    // Without a document record or a peer self — a plain deployment running
    // without the peer plugin — the acting participant paints the first slot,
    // exactly as the layout's own participant always did.
    const color = self === null ? 1 : colorOf(self.color)
    const name = self?.name.trim() ?? ''
    roster.set(selfId, name === ''
      ? { id: selfId, nameKey: 'owner.self', ...(color === undefined ? {} : { color }) }
      : { id: selfId, name, ...(color === undefined ? {} : { color }) })
  }
  return [...roster.values()].sort(compareParticipants)
}

/**
 * Adopt the document's local identity: remember it and rewrite every stored
 * owner that still names the never-participant legacy self. A layout written
 * before the document carried participants keeps rendering one participant,
 * and the acting owner manages every window it already owned.
 * @param state - board draft to rewrite.
 * @param selfId - identity of this Ketos from the document snapshot.
 */
export function adoptSelfId(state: BoardState, selfId: OwnerId): void {
  state.selfId = selfId
  for (const window of Object.values(state.windows)) {
    if (window.ownerId === DEMO_SELF_ID) window.ownerId = selfId
    if (window.access.people.includes(DEMO_SELF_ID)) {
      window.access = {
        mode: window.access.mode,
        people: window.access.people.map(person => person === DEMO_SELF_ID ? selfId : person),
      }
    }
  }
}

/**
 * Look one participant up by owner id.
 * @param state - state carrying the local participant and both roster sources.
 * @param id - owner identity to resolve.
 * @returns the participant, or undefined when the board does not know the id.
 */
export function participantOf(state: OwnerIdentityState, id: OwnerId): BoardParticipant | undefined {
  return boardParticipants(state).find(participant => participant.id === id)
}

/**
 * Resolve the color attribute one resolved participant renders.
 * @param participant - participant to resolve, or undefined when the id resolved to nobody.
 * @returns the palette slot as its attribute string, or `'unknown'` for a participant without a color.
 */
export function participantColorAttr(participant: BoardParticipant | undefined): OwnerColorAttr {
  return participant?.color === undefined ? 'unknown' : String(participant.color) as OwnerColorAttr
}

/**
 * Resolve the color attribute one owner's surface renders.
 * @param state - state carrying the local participant and both roster sources.
 * @param id - owner identity to resolve.
 * @returns the palette slot as its attribute string, or `'unknown'` for an id no participant owns or a participant without a color.
 */
export function ownerColorAttr(state: OwnerIdentityState, id: OwnerId): OwnerColorAttr {
  return participantColorAttr(participantOf(state, id))
}

/**
 * Display name of one participant.
 * @param t - board namespace translator.
 * @param participant - participant to label, or undefined when the id resolved to nobody.
 * @returns the participant's name, its dictionary key's text, or the unknown-participant label.
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
 * membership in {@link boardParticipants}, whose roster arrives asynchronously,
 * and never keeps the owner in the list.
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
