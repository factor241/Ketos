/**
 * Shared HTTP wire helpers of the exact board routes: the JSON answers with
 * their `no-store` header, the stable error with the status each code maps to,
 * and the body validation primitives the operation parser builds its field
 * decoders from.
 *
 * Validation is manual because these routes are a wire boundary — nothing here
 * trusts the browser, and unknown fields fail loud instead of being dropped.
 * @module @ketos/board-doc/wire
 */

import type { BoardErrorCode } from './types.ts'

/** Response headers for every answer: board data is private and never cached. */
export const NO_STORE = { 'cache-control': 'no-store' } as const

/** HTTP status of every stable board error code. */
const STATUS: Readonly<Record<BoardErrorCode, number>> = {
  'ketos/invalid': 400,
  'ketos/element-not-found': 404,
  'ketos/element-foreign': 409,
  'ketos/element-exists': 409,
  'ketos/element-host-data': 403,
  'ketos/window-foreign': 409,
  'ketos/limit': 409,
}

/** A request or operation the board refuses; the code is what the browser reads. */
export class BoardError extends Error {
  /**
   * @param code - stable error code.
   * @param reason - what the input got wrong; for logs, never for the browser.
   */
  constructor(readonly code: BoardErrorCode, reason: string) {
    super(reason)
    this.name = 'BoardError'
  }
}

/**
 * The HTTP status one stable code answers with.
 * @param code - stable error code.
 * @returns the mapped HTTP status.
 */
export function statusOf(code: BoardErrorCode): number {
  return STATUS[code]
}

/**
 * A successful JSON answer.
 * @param response - the body to send.
 * @returns the response with the private no-store header.
 */
export function ok(response: unknown): Response {
  return Response.json(response, { headers: NO_STORE })
}

/**
 * A failed JSON answer with one stable code.
 * @param code - the stable code the browser reads.
 * @param status - HTTP status; defaults to the status the code maps to.
 * @returns the response with the status and the private header.
 */
export function fail(code: BoardErrorCode, status: number = statusOf(code)): Response {
  return Response.json({ ok: false, error: code }, { status, headers: NO_STORE })
}

/**
 * Narrow a decoded value to a JSON object.
 * @param value - decoded value.
 * @param reason - rejection reason for the log.
 * @returns the value as a plain object.
 */
export function record(value: unknown, reason: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BoardError('ketos/invalid', reason)
  }
  return value as Record<string, unknown>
}

/**
 * Reject any field the operation does not accept.
 * @param source - decoded request body.
 * @param allowed - the fields the operation accepts.
 */
export function rejectUnknownFields(source: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) throw new BoardError('ketos/invalid', `unknown field ${JSON.stringify(key)}`)
  }
}

/**
 * A required finite number inside its bounds.
 * @param source - decoded request body.
 * @param key - field name.
 * @param min - smallest accepted value.
 * @param max - largest accepted value.
 * @returns the validated number.
 */
export function finiteNumber(source: Record<string, unknown>, key: string, min: number, max: number): number {
  const value = source[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BoardError('ketos/invalid', `${key} must be a finite number`)
  }
  if (value < min || value > max) {
    throw new BoardError('ketos/invalid', `${key} must be within [${String(min)}, ${String(max)}]`)
  }
  return value
}

/**
 * An optional finite number inside its bounds; absent stays absent.
 * @param source - decoded request body.
 * @param key - field name.
 * @param min - smallest accepted value.
 * @param max - largest accepted value.
 * @returns the validated number, or undefined when the field is absent.
 */
export function optionalFiniteNumber(
  source: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number | undefined {
  if (source[key] === undefined) return undefined
  return finiteNumber(source, key, min, max)
}
