/**
 * The board's element and window kinds and the fixed constants they share: the
 * closed kind lists, the layer rank that orders element kinds below each
 * other, and the coordinate bound the wire rejects beyond.
 *
 * The constants are protocol values, not deployment settings; a new kind joins
 * the matching list and registers its body in the client. The window lists
 * mirror the client's layout vocabulary and are held to it by a parity test.
 * @module @ketos/board-doc/kinds
 */

import type { BoardElementKind, BoardWindowBodyKind, BoardWindowKind, BoardWindowStatus } from './types.ts'

/** Every element kind the document accepts, in declaration order. */
export const BOARD_ELEMENT_KINDS: readonly BoardElementKind[] = ['note', 'stroke', 'todo']

/**
 * Element kinds whose `data` only the host writes: a browser batch may move,
 * resize, restack, and remove such an element but never create it or patch its
 * data. The `todo` list mirrors Beads, so its data comes from `bd` and a
 * browser write would put an epic id in the document that Beads never issued.
 */
export const BOARD_HOST_DATA_KINDS: readonly BoardElementKind[] = ['todo']

/** Every window kind a record may carry, in declaration order. */
export const BOARD_WINDOW_KINDS: readonly BoardWindowKind[] = [
  'agent', 'connectors', 'settings', 'dashboard', 'clone', 'tasks',
]

/** Every window body kind a record may carry, in declaration order. */
export const BOARD_WINDOW_BODY_KINDS: readonly BoardWindowBodyKind[] = [
  'conversation', 'connectors', 'settings', 'dashboard', 'clone', 'clone-memory', 'tasks',
]

/** Every window status a record may carry, in declaration order. */
export const BOARD_WINDOW_STATUSES: readonly BoardWindowStatus[] = ['idle', 'running', 'ready', 'error']

/**
 * Paint rank of each kind: a lower rank draws below a higher one, and elements
 * of one rank order by `z` and then id. Strokes sit under everything so a note
 * placed over a drawing stays readable.
 */
export const BOARD_ELEMENT_LAYER_RANK: Readonly<Record<BoardElementKind, number>> = {
  stroke: 0,
  note: 1,
  todo: 1,
}

/** Largest absolute value a stored coordinate or size may carry. */
export const BOARD_ELEMENT_COORDINATE_LIMIT = 100_000

/**
 * Whether a wire value names a known element kind.
 * @param value - decoded value.
 * @returns true when the value is one of {@link BOARD_ELEMENT_KINDS}.
 */
export function isBoardElementKind(value: unknown): value is BoardElementKind {
  return typeof value === 'string' && (BOARD_ELEMENT_KINDS as readonly string[]).includes(value)
}

/**
 * Whether only the host may create elements of a kind and write their data.
 * @param kind - element kind.
 * @returns true when the kind is one of {@link BOARD_HOST_DATA_KINDS}.
 */
export function isBoardHostDataKind(kind: BoardElementKind): boolean {
  return BOARD_HOST_DATA_KINDS.includes(kind)
}

/**
 * Whether a wire value names a known window kind.
 * @param value - decoded value.
 * @returns true when the value is one of {@link BOARD_WINDOW_KINDS}.
 */
export function isBoardWindowKind(value: unknown): value is BoardWindowKind {
  return typeof value === 'string' && (BOARD_WINDOW_KINDS as readonly string[]).includes(value)
}

/**
 * Whether a wire value names a known window body kind.
 * @param value - decoded value.
 * @returns true when the value is one of {@link BOARD_WINDOW_BODY_KINDS}.
 */
export function isBoardWindowBodyKind(value: unknown): value is BoardWindowBodyKind {
  return typeof value === 'string' && (BOARD_WINDOW_BODY_KINDS as readonly string[]).includes(value)
}

/**
 * Whether a wire value names a known window status.
 * @param value - decoded value.
 * @returns true when the value is one of {@link BOARD_WINDOW_STATUSES}.
 */
export function isBoardWindowStatus(value: unknown): value is BoardWindowStatus {
  return typeof value === 'string' && (BOARD_WINDOW_STATUSES as readonly string[]).includes(value)
}
