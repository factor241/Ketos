/**
 * Context-ring figures and states: the conversion the window bridge applies to
 * the `contextPressure` projection stays identical to the conversation meter's
 * `contextOccupancy`, the state ladder follows the 80/95 percent thresholds,
 * and the tooltip renders compact units.
 */
import { describe, expect, it } from 'vitest'
import { contextOccupancy } from '@deepseek-ai/dsh-client-ui-conversation/src/client/context-occupancy.ts'
import {
  compactTokens, contextFigures, contextReading, contextRingState,
} from '../src/client/context-ring.ts'
import { t } from './fixtures.client.ts'

describe('contextFigures', () => {
  it('mirrors the conversation meter occupancy for every pressure combination', () => {
    const pressures: readonly Parameters<typeof contextOccupancy>[0][] = [
      undefined,
      {},
      { pressureTokens: 4_500 },
      { projectedTokens: 4_500, contextWindow: 100_000 },
      { pressureTokens: 4_500, projectedTokens: 4_400, contextWindow: 100_000 },
      { pressureTokens: 80_000, contextWindow: 100_000 },
      { projectedTokens: 950_000, contextWindow: 1_000_000 },
      { projectedTokens: 2_000_000, contextWindow: 1_000_000 },
      { projectedTokens: 0, contextWindow: 100_000 },
      { projectedTokens: 4_500 },
    ]
    for (const pressure of pressures) {
      const reference = contextOccupancy(pressure)
      const figures = contextFigures(pressure)
      if (reference === null) {
        expect(figures).toBeUndefined()
        continue
      }
      expect(figures).toEqual({
        percent: reference.percent,
        usedTokens: reference.usedTokens,
        window: reference.contextWindow,
      })
    }
  })

  it('prefers the surface projection over the provider sample and clamps at 100 percent', () => {
    expect(contextFigures({ pressureTokens: 10, projectedTokens: 20, contextWindow: 100 })).toEqual({
      percent: 20, usedTokens: 20, window: 100,
    })
    expect(contextFigures({ projectedTokens: 250, contextWindow: 100 })?.percent).toBe(100)
  })
})

describe('contextRingState', () => {
  it('ladders empty, normal, warning, and critical at the 80/95 thresholds', () => {
    const state = (percent: number): string => contextRingState({ percent, usedTokens: 1, window: 100 })
    expect(contextRingState(undefined)).toBe('empty')
    expect(state(0)).toBe('normal')
    expect(state(42)).toBe('normal')
    expect(state(80)).toBe('normal')
    expect(state(81)).toBe('warning')
    expect(state(95)).toBe('warning')
    expect(state(96)).toBe('critical')
    expect(state(100)).toBe('critical')
  })
})

describe('ring reading', () => {
  it('shortens token counts with dictionary units', () => {
    expect(compactTokens(999, t)).toBe('999')
    expect(compactTokens(1_000, t)).toBe('1K')
    expect(compactTokens(4_500, t)).toBe('4.5K')
    expect(compactTokens(99_999, t)).toBe('100K')
    expect(compactTokens(999_499, t)).toBe('999K')
    expect(compactTokens(999_999, t)).toBe('1M')
    expect(compactTokens(1_000_000, t)).toBe('1M')
    expect(compactTokens(2_500_000, t)).toBe('2.5M')
  })

  it('renders percent, used, and window in the reading and a dedicated empty text', () => {
    expect(contextReading(undefined, t)).toBe(t('context.empty'))
    expect(contextReading({ percent: 42, usedTokens: 4_200, window: 100_000 }, t)).toBe('42% · 4.2K / 100K')
    expect(contextReading({ percent: 96, usedTokens: 960_000, window: 1_000_000 }, t)).toBe('96% · 960K / 1M')
  })
})
