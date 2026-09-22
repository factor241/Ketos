/**
 * Shared HTTP wire helpers of the exact Ketos routes: the JSON answers with
 * their `no-store` header, and the body validation primitives the domain
 * routes build their field decoders from.
 *
 * Validation is manual because these routes are a wire boundary — nothing here
 * trusts the browser, and unknown fields fail loud instead of being dropped.
 * @module @ketos/clone-core/wire
 */

import { CLONE_SKILL_NAME } from './repository.ts'
import type { CloneErrorCode, CloneSkill, MemoryErrorCode } from './types.ts'

/** Response headers for every answer: clone data is private and never cached. */
export const NO_STORE = { 'cache-control': 'no-store' } as const

/** A request body the route refuses; mapped to 400 `ketos/invalid`. */
export class InvalidBody extends Error {
  /**
   * @param reason - what the request got wrong; for tests and logs, never for the browser.
   */
  constructor(reason: string) {
    super(`invalid request: ${reason}`)
    this.name = 'InvalidBody'
  }
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
 * @param status - HTTP status.
 * @param error - the stable code the browser reads.
 * @returns the response with the private no-store header.
 */
export function fail(status: number, error: CloneErrorCode | MemoryErrorCode): Response {
  return Response.json({ ok: false, error }, { status, headers: NO_STORE })
}

/**
 * Narrow a decoded value to a JSON object.
 * @param value - decoded value.
 * @param reason - rejection reason for the log.
 * @returns the value as a plain object.
 */
export function record(value: unknown, reason: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InvalidBody(reason)
  return value as Record<string, unknown>
}

/**
 * Reject any field the operation does not accept.
 * @param source - decoded request body.
 * @param allowed - the fields the operation accepts.
 */
export function rejectUnknownFields(source: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) throw new InvalidBody(`unknown field ${JSON.stringify(key)}`)
  }
}

/**
 * Required non-empty text, trimmed of surrounding whitespace.
 * @param source - decoded request body.
 * @param key - field name.
 * @param max - longest accepted value.
 * @returns the trimmed value.
 */
export function requiredText(source: Record<string, unknown>, key: string, max: number): string {
  const value = source[key]
  if (typeof value !== 'string') throw new InvalidBody(`${key} must be a string`)
  const trimmed = value.trim()
  if (trimmed === '') throw new InvalidBody(`${key} must not be empty`)
  if (trimmed.length > max) throw new InvalidBody(`${key} exceeds ${String(max)} characters`)
  return trimmed
}

/**
 * Optional text; absent stays absent, and the stored value keeps its own whitespace.
 * @param source - decoded request body.
 * @param key - field name.
 * @param max - longest accepted value.
 * @returns the value, or undefined when the field is absent.
 */
export function optionalText(source: Record<string, unknown>, key: string, max: number): string | undefined {
  const value = source[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new InvalidBody(`${key} must be a string`)
  if (value.length > max) throw new InvalidBody(`${key} exceeds ${String(max)} characters`)
  return value
}

/**
 * An optional bounded array of bounded strings.
 * @param source - decoded request body.
 * @param key - field name.
 * @param maxCount - longest accepted array.
 * @param maxEntry - longest accepted entry.
 * @returns the array, or undefined when the field is absent.
 */
export function optionalStringList(
  source: Record<string, unknown>,
  key: string,
  maxCount: number,
  maxEntry: number,
): string[] | undefined {
  const value = source[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new InvalidBody(`${key} must be an array`)
  if (value.length > maxCount) throw new InvalidBody(`${key} exceeds ${String(maxCount)} entries`)
  return value.map((entry: unknown): string => {
    if (typeof entry !== 'string') throw new InvalidBody(`${key} must hold strings`)
    if (entry.length > maxEntry) {
      throw new InvalidBody(`an entry of ${key} exceeds ${String(maxEntry)} characters`)
    }
    return entry
  })
}

/** Fields one wire skill carries; anything else inside it is a typo. */
const SKILL_FIELDS = ['name', 'description', 'instructions'] as const

/**
 * An optional bounded array of skill objects. Each entry carries exactly the
 * fields a stored skill has: a kebab-case name inside the registry's grammar, a
 * short description, and the instructions loaded on invocation. An absent
 * description or instruction body stays an empty string, because a draft may
 * name a skill before authoring it; a duplicate name is refused, because two
 * entries would be two identities for one registry skill.
 * @param source - decoded request body.
 * @param key - field name.
 * @param limits - longest accepted entry count and the per-field character bounds.
 * @returns the skills, or undefined when the field is absent.
 */
export function optionalSkillList(
  source: Record<string, unknown>,
  key: string,
  limits: {
    readonly skillCount: number
    readonly skillName: number
    readonly skillDescription: number
    readonly skillInstructions: number
  },
): CloneSkill[] | undefined {
  const value = source[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new InvalidBody(`${key} must be an array`)
  if (value.length > limits.skillCount) throw new InvalidBody(`${key} exceeds ${String(limits.skillCount)} entries`)
  const names = new Set<string>()
  return value.map((entry: unknown): CloneSkill => {
    const skill = record(entry, `${key} must hold skill objects`)
    rejectUnknownFields(skill, SKILL_FIELDS)
    const name = requiredText(skill, 'name', limits.skillName)
    if (!CLONE_SKILL_NAME.test(name)) {
      throw new InvalidBody(`skill name ${JSON.stringify(name)} is not kebab-case`)
    }
    if (names.has(name)) throw new InvalidBody(`skill name ${JSON.stringify(name)} is duplicated`)
    names.add(name)
    return {
      name,
      description: optionalText(skill, 'description', limits.skillDescription) ?? '',
      instructions: optionalText(skill, 'instructions', limits.skillInstructions) ?? '',
    }
  })
}
