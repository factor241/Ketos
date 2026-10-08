/**
 * The palette of board participants, shared by the host's color assignment
 * and the color-collision rule. The numbers are the tokens the board's 22
 * CSS variables key off (`data-board-owner-color`), so both sides of the
 * channel resolve the same number to the same color.
 * @module @ketos/peer/color
 */

import { PEER_COLOR_MAX, PEER_COLOR_MIN } from './frame.ts'

/**
 * Whether a value is a palette color.
 * @param value - decoded value.
 * @returns true for an integer from 1 to 10.
 */
export function isPeerColor(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= PEER_COLOR_MIN && value <= PEER_COLOR_MAX
}

/**
 * The first palette color no known participant occupies.
 * @param taken - colors already assigned to other participants.
 * @returns the lowest free color, or 1 when the palette is exhausted.
 */
export function firstFreeColor(taken: Iterable<number>): number {
  const used = new Set(taken)
  for (let color = PEER_COLOR_MIN; color <= PEER_COLOR_MAX; color += 1) {
    if (!used.has(color)) return color
  }
  return PEER_COLOR_MIN
}

/**
 * The next free palette color after the current one, wrapping once. Both
 * sides of a color collision run this deterministic rule; only the
 * participant with the larger board selfId calls it.
 * @param taken - colors already assigned to other participants.
 * @param current - the color to move away from.
 * @returns the next free color, or `current` when the palette is exhausted.
 */
export function nextFreeColor(taken: Iterable<number>, current: number): number {
  const used = new Set(taken)
  for (let step = 1; step <= PEER_COLOR_MAX; step += 1) {
    const color = ((current - PEER_COLOR_MIN + step) % PEER_COLOR_MAX) + PEER_COLOR_MIN
    if (!used.has(color)) return color
  }
  return current
}
