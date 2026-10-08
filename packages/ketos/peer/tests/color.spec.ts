// The participant palette: validity, the lowest free color at start, and the
// deterministic next-color step the collision rule uses.
import { describe, expect, it } from 'vitest'
import { firstFreeColor, isPeerColor, nextFreeColor } from '../src/color.ts'

describe('peer palette', () => {
  it('accepts only integers from 1 to 10', () => {
    expect(isPeerColor(1)).toBe(true)
    expect(isPeerColor(10)).toBe(true)
    expect(isPeerColor(0)).toBe(false)
    expect(isPeerColor(11)).toBe(false)
    expect(isPeerColor(1.5)).toBe(false)
    expect(isPeerColor('1')).toBe(false)
  })

  it('picks the lowest free color and falls back to 1 when exhausted', () => {
    expect(firstFreeColor([])).toBe(1)
    expect(firstFreeColor([1, 3])).toBe(2)
    expect(firstFreeColor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(1)
  })

  it('steps to the next free color, wrapping once', () => {
    expect(nextFreeColor([1], 1)).toBe(2)
    expect(nextFreeColor([9, 10], 8)).toBe(1)
    expect(nextFreeColor([2], 1)).toBe(3)
    expect(nextFreeColor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toBe(4)
  })
})
