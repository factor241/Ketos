/**
 * Incremental eraser pass: the parts it reports after every batch of samples
 * equal one `eraseStroke` over the whole path, strokes whose box the path never
 * reaches are not erased point by point, path samples closer than a quarter of
 * the radius are dropped, and the last pointer position still reaches the
 * result.
 */
import { describe, expect, it, vi } from 'vitest'
import type { StrokePathPoint, StrokePoint } from '@ketos/board-doc/types'
import { eraseStroke } from '@ketos/board-doc/data'
import { EraserPass, type EraserTarget } from '../src/client/eraser-pass.ts'

const eraseSpy = vi.hoisted(() => ({ calls: 0 }))
vi.mock('@ketos/board-doc/data', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ketos/board-doc/data')>()
  return {
    ...original,
    eraseStroke: (...args: Parameters<typeof original.eraseStroke>) => {
      eraseSpy.calls += 1
      return original.eraseStroke(...args)
    },
  }
})

/** Deterministic pseudo-random generator, so a failure reproduces. */
function random(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

/**
 * One wavy stroke target of `count` points across the world rectangle.
 * @param id - target id.
 * @param x - left edge.
 * @param y - top edge.
 * @param count - point count.
 * @returns the target.
 */
function target(id: string, x: number, y: number, count: number): EraserTarget {
  const points: StrokePoint[] = []
  for (let i = 0; i < count; i += 1) points.push([x + i * 5, y + 20 + Math.sin(i / 4) * 15, 0.5])
  return { id, box: { x, y, w: (count - 1) * 5, h: 40 }, points }
}

/** A path of `steps` samples, `gap` apart along a diagonal sweep that wiggles. */
function sweep(steps: number, gap: number, rand: () => number): StrokePathPoint[] {
  const path: StrokePathPoint[] = []
  for (let i = 0; i < steps; i += 1) path.push([i * gap, 20 + Math.sin(i / 3) * 25 + rand()])
  return path
}

const RADIUS = 12

describe('EraserPass equivalence with one erasure over the full path', () => {
  it('reports the same parts after every batch of samples', () => {
    const rand = random(7)
    const targets = [target('a', 0, 0, 80), target('b', 100, 10, 60)]
    // Gaps of one radius: no sample is thinned away.
    const path = sweep(60, RADIUS, rand)
    const pass = new EraserPass(targets)
    let added = 0
    for (const batch of [1, 3, 10, 1, 25, 20]) {
      for (const point of path.slice(added, added + batch)) pass.add(point[0], point[1], RADIUS)
      added += batch
      const touched = new Map(pass.touched(RADIUS).map(entry => [entry.target.id, entry.parts]))
      for (const candidate of targets) {
        const expected = eraseStroke(candidate.points, path.slice(0, added), RADIUS)
        const unchanged = expected.length === 1 && expected[0]?.length === candidate.points.length
        expect(touched.get(candidate.id), `${candidate.id} after ${String(added)} samples`).toEqual(unchanged ? undefined : expected)
      }
    }
  })

  it('treats a single sample like a click: a hole around the point', () => {
    const only = target('a', 0, 0, 40)
    const pass = new EraserPass([only])
    const onStroke = only.points[20] as StrokePoint
    pass.add(onStroke[0], onStroke[1], RADIUS)
    const expected = eraseStroke(only.points, [[onStroke[0], onStroke[1]]], RADIUS)
    expect(expected).toHaveLength(2)
    expect(pass.touched(RADIUS).map(entry => entry.parts)).toEqual([expected])
  })
})

describe('EraserPass pre-filter and thinning', () => {
  it('does not erase point by point a stroke the path never reaches', () => {
    const far = target('far', 5000, 5000, 200)
    const near = target('near', 0, 0, 20)
    const pass = new EraserPass([far, near])
    eraseSpy.calls = 0
    for (const [x, y] of sweep(30, RADIUS, random(3))) pass.add(x, y, RADIUS)
    const touched = pass.touched(RADIUS)
    expect(touched.map(entry => entry.target.id)).toEqual(['near'])
    // Every erase call belongs to the near stroke's parts, none to the far one.
    expect(eraseSpy.calls).toBeGreaterThan(0)
    const callsBeforeFar = eraseSpy.calls
    const lonely = new EraserPass([far])
    for (const [x, y] of sweep(30, RADIUS, random(3))) lonely.add(x, y, RADIUS)
    lonely.touched(RADIUS)
    expect(eraseSpy.calls).toBe(callsBeforeFar)
  })

  it('applies only new samples at each batch', () => {
    const only = target('a', 0, 0, 120)
    const pass = new EraserPass([only])
    const path = sweep(80, RADIUS, random(5))
    for (const [x, y] of path.slice(0, 40)) pass.add(x, y, RADIUS)
    pass.touched(RADIUS)
    eraseSpy.calls = 0
    // No new sample: nothing to apply.
    pass.touched(RADIUS)
    expect(eraseSpy.calls).toBe(0)
  })

  it('drops samples closer than a quarter of the radius to the last kept one', () => {
    const only = target('a', 0, 0, 40)
    const pass = new EraserPass([only])
    const gap = RADIUS / 20
    for (let i = 0; i <= 200; i += 1) pass.add(i * gap, 20, RADIUS)
    // 200 samples span 10 radii; one kept sample per quarter radius at most.
    expect(pass.path.length).toBeLessThanOrEqual(Math.ceil((200 * gap) / (RADIUS / 4)) + 1)
    expect(pass.path.length).toBeGreaterThan(10)
    expect(pass.path[0]).toEqual([0, 20])
  })

  it('keeps the last pointer position when the pass finishes', () => {
    const only = target('a', 0, 0, 40)
    const pass = new EraserPass([only])
    pass.add(0, 20, RADIUS)
    pass.add(1, 20, RADIUS)
    pass.add(2, 20, RADIUS)
    expect(pass.path).toEqual([[0, 20]])
    pass.finish()
    expect(pass.path).toEqual([[0, 20], [2, 20]])
    // A last sample that was kept already adds nothing.
    pass.finish()
    expect(pass.path).toEqual([[0, 20], [2, 20]])
  })
})
