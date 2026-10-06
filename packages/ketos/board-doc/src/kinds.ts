/**
 * The board's element kinds and the fixed constants every kind shares: the
 * closed kind list, the layer rank that orders kinds below each other, and the
 * coordinate bound the wire rejects beyond.
 *
 * The constants are protocol values, not deployment settings; a new kind joins
 * this list and registers its body in the client.
 * @module @ketos/board-doc/kinds
 */

import type { BoardElementKind } from './types.ts'

/** Every element kind the document accepts, in declaration order. */
export const BOARD_ELEMENT_KINDS: readonly BoardElementKind[] = ['note', 'stroke', 'todo']

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
