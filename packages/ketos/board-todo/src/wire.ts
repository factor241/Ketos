/**
 * The to-do route's wire helpers: JSON answers, `no-store`, the stable error
 * codes with their statuses, and the body field readers. These routes are a
 * wire boundary, so unknown fields, absent fields, and values outside the
 * accepted vocabulary fail loud with `ketos/invalid`.
 * @module @ketos/board-todo/wire
 */

import { isBeadsIssueId, isElementId } from '@ketos/board-doc/data'
import { BOARD_ELEMENT_COORDINATE_LIMIT } from '@ketos/board-doc/kinds'
import type { BeadsIssueId, ElementId } from '@ketos/board-doc/types'
import type { TodoAnswer, TodoErrorCode } from './types.ts'

/** Answer header that keeps a refusal or a snapshot out of every cache. */
export const NO_STORE = { 'cache-control': 'no-store' } as const

/** HTTP status of every stable error code. */
const STATUS: Readonly<Record<TodoErrorCode, number>> = {
  'ketos/invalid': 400,
  'ketos/element-not-found': 404,
  'ketos/not-owner': 409,
  'ketos/placement-taken': 409,
  'ketos/limit': 409,
  'ketos/beads-failed': 502,
  'ketos/beads-unavailable': 503,
}

/** One refused to-do request with its stable code. */
export class TodoRouteError extends Error {
  constructor(
    /** Stable code the response carries. */
    readonly code: TodoErrorCode,
    reason: string,
  ) {
    super(reason)
    this.name = 'TodoRouteError'
  }
}

/**
 * Answer one successful route call.
 * @param answer - the answer body.
 * @returns the JSON response.
 */
export function ok(answer: TodoAnswer): Response {
  return Response.json(answer, { headers: NO_STORE })
}

/**
 * Answer one refusal; the body carries the code and nothing else.
 * @param code - stable error code.
 * @returns the JSON response with the code's status.
 */
export function fail(code: TodoErrorCode): Response {
  return Response.json({ ok: false, error: code }, { status: STATUS[code], headers: NO_STORE })
}

/**
 * Require one body to be a JSON object.
 * @param value - decoded body.
 * @param reason - message for a refusal.
 * @returns the body as a field record.
 */
export function record(value: unknown, reason: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TodoRouteError('ketos/invalid', reason)
  return value as Record<string, unknown>
}

/**
 * Refuse a body that carries a field outside its action's vocabulary.
 * @param source - decoded body.
 * @param allowed - field names the action accepts.
 */
export function rejectUnknownFields(source: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) throw new TodoRouteError('ketos/invalid', `unknown field ${key}`)
  }
}

/**
 * Read one non-empty title inside the deployment's length bound.
 * @param source - decoded body.
 * @param key - field name.
 * @param maxChars - largest accepted length in UTF-16 code units.
 * @returns the trimmed title.
 */
export function title(source: Record<string, unknown>, key: string, maxChars: number): string {
  const value = source[key]
  if (typeof value !== 'string') throw new TodoRouteError('ketos/invalid', `${key} must be a string`)
  const trimmed = value.trim()
  if (trimmed === '') throw new TodoRouteError('ketos/invalid', `${key} must not be empty`)
  if (trimmed.length > maxChars) throw new TodoRouteError('ketos/invalid', `${key} is longer than ${String(maxChars)} characters`)
  return trimmed
}

/**
 * Read one finite world coordinate inside the board's coordinate bound.
 * @param source - decoded body.
 * @param key - field name.
 * @returns the coordinate.
 */
export function coordinate(source: Record<string, unknown>, key: string): number {
  const value = source[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > BOARD_ELEMENT_COORDINATE_LIMIT) {
    throw new TodoRouteError('ketos/invalid', `${key} must be a finite coordinate`)
  }
  return value
}

/**
 * Read one boolean field.
 * @param source - decoded body.
 * @param key - field name.
 * @returns the boolean.
 */
export function boolean(source: Record<string, unknown>, key: string): boolean {
  const value = source[key]
  if (typeof value !== 'boolean') throw new TodoRouteError('ketos/invalid', `${key} must be a boolean`)
  return value
}

/**
 * Read one board element id.
 * @param source - decoded body.
 * @param key - field name.
 * @returns the branded element id.
 */
export function elementId(source: Record<string, unknown>, key: string): ElementId {
  const value = source[key]
  if (!isElementId(value)) throw new TodoRouteError('ketos/invalid', `${key} must be an element id`)
  return value
}

/**
 * Read one Beads issue id.
 * @param source - decoded body.
 * @param key - field name.
 * @returns the branded issue id.
 */
export function issueId(source: Record<string, unknown>, key: string): BeadsIssueId {
  const value = source[key]
  if (!isBeadsIssueId(value)) throw new TodoRouteError('ketos/invalid', `${key} must be a Beads issue id`)
  return value
}
