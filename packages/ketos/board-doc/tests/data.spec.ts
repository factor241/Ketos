// Element identity and the common data rules: distinct UUIDs the guard
// accepts, one validation branch per kind, and the shared byte budget.
import { describe, expect, it } from 'vitest'
import { isElementId, mintElementId, validateElementData } from '../src/data.ts'
import type { BoardElementKind, BoardLimits } from '../src/types.ts'

const LIMITS: BoardLimits = { elementBytesMax: 262_144, noteTextMax: 20_000 }

/** One note whose data passes the kind's exact rules. */
const NOTE = { text: 'hello', font: 'sans', size: 'm', scale: 1 } as const

describe('element identity', () => {
  it('mints distinct element ids the guard accepts', () => {
    const first = mintElementId()
    const second = mintElementId()
    expect(isElementId(first)).toBe(true)
    expect(isElementId(second)).toBe(true)
    expect(first).not.toBe(second)
    expect(isElementId('not-a-uuid')).toBe(false)
    expect(isElementId(7)).toBe(false)
  })
})

describe('element data validation', () => {
  it('accepts every kind and rejects an unknown one', () => {
    expect(validateElementData('note', NOTE, LIMITS)).toBeNull()
    expect(validateElementData('stroke', { a: 1 }, LIMITS)).toBeNull()
    expect(validateElementData('todo', { a: 1 }, LIMITS)).toBeNull()
    const bogus: string = 'doodle'
    expect(() => validateElementData(bogus as BoardElementKind, {}, LIMITS)).toThrow(/unreachable variant/u)
  })

  it('refuses data that is not a JSON object and data over the byte budget', () => {
    expect(validateElementData('note', [] as never, LIMITS)).toBe('data must be a JSON object')
    expect(validateElementData('todo', { text: 'x'.repeat(20) }, { elementBytesMax: 10, noteTextMax: 20_000 }))
      .toMatch(/exceeds 10 bytes/u)
  })
})
