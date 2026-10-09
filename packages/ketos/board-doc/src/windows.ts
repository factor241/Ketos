/**
 * Browser-safe window-record validation: the window id shape, the access
 * vocabulary, and the complete-field parsers the operation wire and the
 * document read share. The host stamps `hostId` and `updatedAt`; the client
 * sends the rest and both sides validate identically.
 *
 * The module carries no host dependency, so the browser imports it directly.
 * @module @ketos/board-doc/windows
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import {
  BOARD_ELEMENT_COORDINATE_LIMIT, isBoardWindowBodyKind, isBoardWindowKind, isBoardWindowStatus,
} from './kinds.ts'
import type {
  BoardWindowAccess, BoardWindowAccessMode, BoardWindowRecord, BoardWindowRecordInput, OwnerId,
  WindowId, WindowSessionId,
} from './types.ts'

/** Largest window id and owner id, in UTF-16 code units. */
export const WINDOW_ID_MAX = 64

/** Largest window title, in UTF-16 code units. */
export const WINDOW_TITLE_MAX = 200

/** Largest session id a window record may carry, in UTF-16 code units. */
export const WINDOW_SESSION_ID_MAX = 128

/** Largest number of selected people one window access may carry. */
export const WINDOW_ACCESS_MAX_PEOPLE = 50

/** Access modes a window record may carry. */
export const WINDOW_ACCESS_MODES: readonly BoardWindowAccessMode[] = ['owner', 'selected', 'all']

/** Fields one window record carries; any other field is a refusal. */
const WINDOW_FIELDS: readonly string[] = [
  'id', 'hostId', 'ownerId', 'kind', 'bodyKind', 'title', 'ordinal',
  'x', 'y', 'w', 'h', 'z', 'access', 'status', 'sessionId', 'updatedAt',
]

/** Fields one window access object carries; any other field is a refusal. */
const ACCESS_FIELDS: readonly string[] = ['mode', 'people']

/** One parsed record whose host stamps are still optional. */
interface ParsedWindow {
  readonly id: WindowId
  readonly hostId?: OwnerId
  readonly ownerId: OwnerId
  readonly kind: BoardWindowRecordInput['kind']
  readonly bodyKind: BoardWindowRecordInput['bodyKind']
  readonly title: string | null
  readonly ordinal: number
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly z: number
  readonly access: BoardWindowAccess
  readonly status: BoardWindowRecordInput['status']
  readonly sessionId?: WindowSessionId
  readonly updatedAt?: number
}

/** Whether a decoded value is a plain JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether a decoded value is a well-formed window id: a non-empty string
 * within {@link WINDOW_ID_MAX} characters and free of control characters.
 * @param value - decoded value.
 * @returns whether the value is a window id.
 */
export function isWindowId(value: unknown): value is WindowId {
  return isBoundString(value, WINDOW_ID_MAX)
}

/** Whether a decoded value is a well-formed owner id within the window bounds. */
function isOwnerId(value: unknown): value is OwnerId {
  return isBoundString(value, WINDOW_ID_MAX)
}

/** Whether a decoded value is a well-formed session id. */
function isSessionId(value: unknown): value is WindowSessionId {
  return isBoundString(value, WINDOW_SESSION_ID_MAX)
}

/**
 * Whether a decoded value is a non-empty bounded string without control
 * characters.
 * @param value - decoded value.
 * @param max - largest accepted length.
 * @returns whether the value passes.
 */
function isBoundString(value: unknown, max: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && !/[\u0000-\u001f\u007f]/.test(value)
}

/** Whether a decoded value is a finite number inside the coordinate bounds. */
function isBounded(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

/** Whether a decoded value is a natural number inside the coordinate bounds. */
function isNatural(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= BOARD_ELEMENT_COORDINATE_LIMIT
}

/** Whether a decoded value is an integer timestamp in milliseconds. */
function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * Bring a window title into the form a window record accepts: every control
 * character (U+0000–U+001F, U+007F), which the record validator refuses,
 * becomes a space, and the result is cut at {@link WINDOW_TITLE_MAX} UTF-16
 * code units, the unit the validator counts, stepping back one unit when the
 * cut would separate a surrogate pair. A non-empty result is therefore a valid
 * title; the caller still treats an empty or blank result as no title.
 * @param raw - a title of any length and content.
 * @returns the title without control characters, at most {@link WINDOW_TITLE_MAX} code units long.
 */
export function clampWindowTitle(raw: string): string {
  const title = raw.replace(/[\u0000-\u001f\u007f]/g, ' ')
  if (title.length <= WINDOW_TITLE_MAX) return title
  const last = title.charCodeAt(WINDOW_TITLE_MAX - 1)
  const next = title.charCodeAt(WINDOW_TITLE_MAX)
  const splitsPair = last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
  return title.slice(0, splitsPair ? WINDOW_TITLE_MAX - 1 : WINDOW_TITLE_MAX)
}

/**
 * Whether two stored window records hold the same content, the write time
 * `updatedAt` aside. The host skips a publish that matches the stored record,
 * so a client that republishes an unchanged window causes no journal row and
 * no patch.
 * @param a - one record.
 * @param b - another record.
 * @returns true when every field except `updatedAt` is equal.
 */
export function isSameBoardWindowContent(a: BoardWindowRecord, b: BoardWindowRecord): boolean {
  return a.id === b.id
    && a.hostId === b.hostId
    && a.ownerId === b.ownerId
    && a.kind === b.kind
    && a.bodyKind === b.bodyKind
    && a.title === b.title
    && a.ordinal === b.ordinal
    && a.x === b.x
    && a.y === b.y
    && a.w === b.w
    && a.h === b.h
    && a.z === b.z
    && a.status === b.status
    && a.sessionId === b.sessionId
    && a.access.mode === b.access.mode
    && a.access.people.length === b.access.people.length
    && a.access.people.every((person, index) => person === b.access.people[index])
}

/**
 * Parse one window access value.
 * @param value - decoded value.
 * @returns the access, or null when it is malformed.
 */
export function parseBoardWindowAccess(value: unknown): BoardWindowAccess | null {
  if (!isRecord(value)) return null
  for (const key of Object.keys(value)) {
    if (!ACCESS_FIELDS.includes(key)) return null
  }
  if (typeof value.mode !== 'string' || !(WINDOW_ACCESS_MODES as readonly string[]).includes(value.mode)) return null
  if (!Array.isArray(value.people) || value.people.length > WINDOW_ACCESS_MAX_PEOPLE) return null
  const people: OwnerId[] = []
  for (const person of value.people) {
    if (!isOwnerId(person)) return null
    people.push(brandString<OwnerId>(person))
  }
  return { mode: value.mode as BoardWindowAccessMode, people }
}

/**
 * Parse one record's fields, leaving the host stamps optional.
 * @param value - decoded value.
 * @returns the parsed fields, or null.
 */
function parseWindowFields(value: unknown): ParsedWindow | null {
  if (!isRecord(value)) return null
  for (const key of Object.keys(value)) {
    if (!WINDOW_FIELDS.includes(key)) return null
  }
  if (!isWindowId(value.id)) return null
  if (value.hostId !== undefined && !isOwnerId(value.hostId)) return null
  if (!isOwnerId(value.ownerId)) return null
  if (!isBoardWindowKind(value.kind)) return null
  if (!isBoardWindowBodyKind(value.bodyKind)) return null
  if (value.title !== null && !isBoundString(value.title, WINDOW_TITLE_MAX)) return null
  if (!isNatural(value.ordinal, 1)) return null
  const { x, y, w, h } = value
  if (!isBounded(x, -BOARD_ELEMENT_COORDINATE_LIMIT, BOARD_ELEMENT_COORDINATE_LIMIT)) return null
  if (!isBounded(y, -BOARD_ELEMENT_COORDINATE_LIMIT, BOARD_ELEMENT_COORDINATE_LIMIT)) return null
  if (!isBounded(w, Number.MIN_VALUE, BOARD_ELEMENT_COORDINATE_LIMIT)) return null
  if (!isBounded(h, Number.MIN_VALUE, BOARD_ELEMENT_COORDINATE_LIMIT)) return null
  if (!isNatural(value.z, 0)) return null
  const access = parseBoardWindowAccess(value.access)
  if (access === null) return null
  if (!isBoardWindowStatus(value.status)) return null
  if (value.sessionId !== undefined && !isSessionId(value.sessionId)) return null
  // The write time is milliseconds since the epoch, far outside the
  // coordinate bound a natural check would apply.
  if (value.updatedAt !== undefined && !isTimestamp(value.updatedAt)) return null
  return {
    id: brandString<WindowId>(value.id),
    ...(value.hostId === undefined ? {} : { hostId: brandString<OwnerId>(value.hostId) }),
    ownerId: brandString<OwnerId>(value.ownerId),
    kind: value.kind,
    bodyKind: value.bodyKind,
    title: value.title,
    ordinal: value.ordinal,
    x,
    y,
    w,
    h,
    z: value.z,
    access,
    status: value.status,
    ...(value.sessionId === undefined ? {} : { sessionId: brandString<WindowSessionId>(value.sessionId) }),
    ...(value.updatedAt === undefined ? {} : { updatedAt: value.updatedAt }),
  }
}

/**
 * Parse one window record as a publisher sends it: every field validated, the
 * host stamps (`hostId`, `updatedAt`) optional because the host replaces them.
 * @param value - decoded value.
 * @returns the input record, or null when the value is not a valid record.
 */
export function parseBoardWindowInput(value: unknown): BoardWindowRecordInput | null {
  return parseWindowFields(value)
}

/**
 * Parse one complete stored window record, host stamps included.
 * @param value - decoded value.
 * @returns the record, or null when the value is not a valid record.
 */
export function parseBoardWindowRecord(value: unknown): BoardWindowRecord | null {
  const parsed = parseWindowFields(value)
  if (parsed === null || parsed.hostId === undefined || parsed.updatedAt === undefined) return null
  return { ...parsed, hostId: parsed.hostId, updatedAt: parsed.updatedAt }
}

/**
 * Whether a decoded value is a stored window record this build can read.
 * @param value - decoded value.
 * @returns whether the value is a complete record.
 */
export function isBoardWindowRecord(value: unknown): value is BoardWindowRecord {
  return parseBoardWindowRecord(value) !== null
}
