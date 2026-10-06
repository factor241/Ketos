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
import type { BoardElementData, BoardElementKind, BoardLimits, ElementId } from './types.ts'

/** UUID shape every opaque identifier carries. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

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
 * Validate one kind's data. Every kind currently shares the common check — a
 * JSON object whose serialized size stays inside the element budget — and the
 * note, stroke, and todo stages replace their own branch with the kind's exact
 * rules.
 * @param kind - element kind the data belongs to.
 * @param data - decoded data object.
 * @param limits - element limits the data must stay inside.
 * @returns a rejection reason, or null when the data is valid.
 */
export function validateElementData(kind: BoardElementKind, data: BoardElementData, limits: BoardLimits): string | null {
  if (!isElementData(data)) return 'data must be a JSON object'
  switch (kind) {
    case 'note':
      return commonDataReason(data, limits)
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
