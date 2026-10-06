/**
 * Browser-safe element identity and data validation: the shared UUID minting,
 * the element-id guard both the wire and the client use, the JSON-object check,
 * and the per-kind data rules the later element stages extend.
 *
 * The module carries no host dependency, so the browser imports it directly.
 * @module @ketos/board-doc/data
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type {
  BoardElementData, BoardElementKind, BoardLimits, ElementId, NoteData, NoteFont, NoteSize,
} from './types.ts'

/** UUID shape every opaque identifier carries. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/** Font families a note accepts, in menu order. */
export const NOTE_FONTS: readonly NoteFont[] = ['sans', 'serif', 'mono']

/** Base text sizes a note accepts, in menu order. */
export const NOTE_SIZES: readonly NoteSize[] = ['s', 'm', 'l']

/** Scales a note accepts; the menu offers exactly these steps. */
export const NOTE_SCALE_STEPS: readonly number[] = [0.5, 0.75, 1, 1.5, 2, 3]

/** Fields one note's data carries; any other field is a refusal. */
const NOTE_FIELDS: readonly string[] = ['text', 'font', 'size', 'scale']

/**
 * Mint one UUIDv4 string from the Web Crypto generator, which exists on every
 * supported Node runtime and in the browser.
 * @returns the canonical hyphenated UUID.
 */
export function mintUuid(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const view = new DataView(bytes.buffer)
  view.setUint8(6, (view.getUint8(6) & 0x0f) | 0x40)
  view.setUint8(8, (view.getUint8(8) & 0x3f) | 0x80)
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Mint the identity of one new element.
 * @returns a fresh element id.
 */
export function mintElementId(): ElementId {
  return brandString<ElementId>(mintUuid())
}

/**
 * Whether a decoded value is an element id.
 * @param value - decoded value.
 * @returns true when the value carries the UUID shape.
 */
export function isElementId(value: unknown): value is ElementId {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/**
 * Whether a decoded value is a plain JSON object, the only shape element data
 * may carry at the top level.
 * @param value - decoded value.
 * @returns true when the value is a non-null, non-array object.
 */
export function isElementData(value: unknown): value is BoardElementData {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse one note's data: exactly the four fields, a text inside the published
 * bound, a known font and size, and a scale from {@link NOTE_SCALE_STEPS}.
 * @param value - decoded data value.
 * @param limits - element limits the text must stay inside.
 * @returns the typed note data, or null when the value is not a valid note.
 */
export function parseNoteData(value: unknown, limits: BoardLimits): NoteData | null {
  if (!isElementData(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== NOTE_FIELDS.length || keys.some(key => !NOTE_FIELDS.includes(key))) return null
  const { text, font, size, scale } = value
  if (typeof text !== 'string' || text.length > limits.noteTextMax) return null
  if (typeof font !== 'string' || !(NOTE_FONTS as readonly string[]).includes(font)) return null
  if (typeof size !== 'string' || !(NOTE_SIZES as readonly string[]).includes(size)) return null
  if (typeof scale !== 'number' || !NOTE_SCALE_STEPS.includes(scale)) return null
  return { text, font: font as NoteFont, size: size as NoteSize, scale }
}

/**
 * Validate one kind's data. A note must parse as exact {@link NoteData}; the
 * stroke and todo stages replace their own branches with the kind's exact rules.
 * @param kind - element kind the data belongs to.
 * @param data - decoded data object.
 * @param limits - element limits the data must stay inside.
 * @returns a rejection reason, or null when the data is valid.
 */
export function validateElementData(kind: BoardElementKind, data: BoardElementData, limits: BoardLimits): string | null {
  if (!isElementData(data)) return 'data must be a JSON object'
  switch (kind) {
    case 'note': {
      const common = commonDataReason(data, limits)
      if (common !== null) return common
      return parseNoteData(data, limits) === null ? 'invalid note data' : null
    }
    case 'stroke':
      return commonDataReason(data, limits)
    case 'todo':
      return commonDataReason(data, limits)
    default:
      return assertNever(kind)
  }
}

/**
 * The check every kind's data shares: the serialized data stays inside the
 * element byte budget.
 * @param data - decoded data object.
 * @param limits - element limits the data must stay inside.
 * @returns a rejection reason, or null when the data is valid.
 */
function commonDataReason(data: BoardElementData, limits: BoardLimits): string | null {
  const bytes = new TextEncoder().encode(JSON.stringify(data)).length
  if (bytes > limits.elementBytesMax) return `data exceeds ${String(limits.elementBytesMax)} bytes`
  return null
}
