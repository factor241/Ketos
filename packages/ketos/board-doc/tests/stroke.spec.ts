// The stroke kind's exact data rules and geometry: the compact relative-point
// format, the point count and element box bounds, box resolution and rounding,
// Ramer–Douglas–Peucker simplification, and segment-to-segment erasure.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  STROKE_SIZES, STROKE_WIDTHS, eraseStroke, mintElementId, parseStrokeData, simplifyStroke, strokeBounds,
  validateElementData,
} from '../src/data.ts'
import type { BoardOpLimits } from '../src/ops.ts'
import { handleBoardOps, type BoardRouteConfig } from '../src/routes.ts'
import { KetosBoardDocService, type KetosBoardDocOptions } from '../src/service.ts'
import type { BoardCreateOp, BoardElementData, ElementId, StrokePathPoint, StrokePoint } from '../src/types.ts'

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

const ID = brandString<ElementId>('00000000-0000-4000-8000-000000000030')

const LIMITS: BoardOpLimits = {
  maxOpsPerRequest: 64,
  maxElements: 2000,
  elements: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000 },
}

/** Element box the route's create operations carry. */
const BOX = { w: 100, h: 100 }

/** Points one valid stroke payload carries. */
const STROKE_POINTS = [[0, 0, 0.5], [10, 10, 0.5], [20, 5, 1]]

/** One complete valid stroke payload inside {@link BOX}. */
const STROKE: BoardElementData = { points: STROKE_POINTS, width: 'm', pen: false }

/** `count` valid relative points that stay inside {@link BOX}. */
function manyPoints(count: number): number[][] {
  return Array.from({ length: count }, (_entry, index) => [index % 100, index % 100, 0.5])
}

/** One malformed payload and what it gets wrong. */
const BAD_STROKES: Array<[string, BoardElementData]> = [
  ['a point count over the bound', { ...STROKE, points: manyPoints(2001) }],
  ['a null pressure (NaN in JSON)', { ...STROKE, points: [[0, 0, null], [10, 10, 0.5]] }],
  ['a point outside the box', { ...STROKE, points: [[0, 0, 0], [101, 0, 0]] }],
  ['a negative coordinate', { ...STROKE, points: [[0, 0, 0], [-1, 0, 0]] }],
  ['an unknown width', { ...STROKE, width: 'xl' }],
  ['an extra field', { ...STROKE, extra: 1 }],
  ['a missing field', { points: STROKE_POINTS, width: 'm' }],
  ['a non-boolean pen', { ...STROKE, pen: 'yes' }],
  ['a non-array points field', { ...STROKE, points: 5 }],
  ['a point that is not a triple', { ...STROKE, points: [[0, 0], [10, 10, 0.5]] }],
  ['a single point', { ...STROKE, points: [[0, 0, 0.5]] }],
]

/** Fresh temporary directory that the running test owns. */
async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-board-stroke-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

/**
 * Mount one document service over a temporary database.
 * @param overrides - service options to replace.
 * @returns the service and the route configuration.
 */
async function mount(overrides: Partial<KetosBoardDocOptions> = {}): Promise<{
  service: KetosBoardDocService
  route: BoardRouteConfig
}> {
  const root = await temporaryDirectory()
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const service = new KetosBoardDocService(ctx, {
    path: join(root, 'board.db'),
    limits: LIMITS,
    journalCompactRows: 500,
    logger: () => {},
    ...overrides,
  })
  cleanups.push(() => service.close())
  return { service, route: { opLimits: LIMITS, maxRequestBytes: 1_048_576 } }
}

/**
 * Post one stroke create operation through the route.
 * @param service - mounted service.
 * @param config - route configuration.
 * @param data - stroke data to send.
 * @returns the route's response.
 */
async function postStroke(
  service: KetosBoardDocService,
  config: BoardRouteConfig,
  data: BoardElementData,
): Promise<Response> {
  const op: BoardCreateOp = {
    op: 'create', id: ID, kind: 'stroke', x: 0, y: 0, w: BOX.w, h: BOX.h, data,
  }
  return await handleBoardOps(new Request('http://localhost/api/ketos.board.ops', {
    method: 'POST',
    body: JSON.stringify({ ops: [op] }),
    headers: { 'content-type': 'application/json' },
  }), service, config)
}

describe('stroke data parsing', () => {
  it('accepts every width and both pen flags', () => {
    for (const width of STROKE_WIDTHS) {
      for (const pen of [true, false]) {
        expect(parseStrokeData({ ...STROKE, width, pen }, LIMITS.elements, BOX)).toEqual({
          points: STROKE.points, width, pen,
        })
      }
    }
  })

  it('accepts points exactly on the box edges and the point-count bound', () => {
    const edge = [[0, 0, 0], [BOX.w, BOX.h, 1]]
    expect(parseStrokeData({ ...STROKE, points: edge }, LIMITS.elements, BOX)?.points).toEqual(edge)
    const exact = manyPoints(LIMITS.elements.strokePointsMax)
    expect(parseStrokeData({ ...STROKE, points: exact }, LIMITS.elements, BOX)?.points).toHaveLength(LIMITS.elements.strokePointsMax)
  })

  it('keeps a full stroke inside the element byte budget', () => {
    const points = manyPoints(LIMITS.elements.strokePointsMax)
    const bytes = new TextEncoder().encode(JSON.stringify({ ...STROKE, points })).length
    expect(bytes).toBeLessThan(LIMITS.elements.elementBytesMax)
    expect(validateElementData('stroke', { ...STROKE, points }, LIMITS.elements, BOX)).toBeNull()
  })

  it('refuses extra fields, a missing field, and non-object values', () => {
    expect(parseStrokeData({ ...STROKE, extra: 1 }, LIMITS.elements, BOX)).toBeNull()
    expect(parseStrokeData({ points: STROKE.points, width: 'm' }, LIMITS.elements, BOX)).toBeNull()
    expect(parseStrokeData([], LIMITS.elements, BOX)).toBeNull()
  })

  it('refuses fields of the wrong JSON type', () => {
    expect(parseStrokeData({ ...STROKE, width: 5 }, LIMITS.elements, BOX)).toBeNull()
    expect(parseStrokeData({ ...STROKE, pen: 'yes' }, LIMITS.elements, BOX)).toBeNull()
    expect(parseStrokeData({ ...STROKE, points: [[0, 0, '0.5'], [1, 1, 0.5]] }, LIMITS.elements, BOX)).toBeNull()
    expect(parseStrokeData({ ...STROKE, points: [[0, 0], [1, 1, 0.5]] }, LIMITS.elements, BOX)).toBeNull()
    expect(parseStrokeData({ ...STROKE, points: [[0, 0, 0], [0, '1', 0]] }, LIMITS.elements, BOX)).toBeNull()
  })

  it('refuses a height coordinate outside the box', () => {
    expect(parseStrokeData({ ...STROKE, points: [[0, 0, 0], [0, 101, 0]] }, LIMITS.elements, BOX)).toBeNull()
  })

  it('refuses stroke data over the element byte budget before parsing the fields', () => {
    expect(validateElementData('stroke', STROKE, { elementBytesMax: 10, noteTextMax: 20_000, strokePointsMax: 2000 }, BOX))
      .toMatch(/exceeds 10 bytes/u)
  })
})

describe('stroke data through the operation route', () => {
  it('accepts a valid stroke', async () => {
    const { service, route } = await mount()
    expect((await postStroke(service, route, STROKE)).status).toBe(200)
    expect((await service.snapshot()).elements[0]?.data).toEqual(STROKE)
  })

  it('answers 400 ketos/invalid for every malformed stroke', async () => {
    const { service, route } = await mount()
    for (const [name, data] of BAD_STROKES) {
      const response = await postStroke(service, route, data)
      expect(response.status, name).toBe(400)
      expect(await response.json(), name).toMatchObject({ ok: false, error: 'ketos/invalid' })
    }
    expect((await service.snapshot()).elements).toEqual([])
  })

  it('refuses a malformed stroke through a host batch with ketos/invalid', async () => {
    const { service } = await mount()
    const op: BoardCreateOp = {
      op: 'create', id: mintElementId(), kind: 'stroke', x: 0, y: 0, w: BOX.w, h: BOX.h,
      data: BAD_STROKES[0]?.[1] ?? {},
    }
    await expect(service.apply([op], 'host')).rejects.toMatchObject({ code: 'ketos/invalid' })
    expect((await service.snapshot()).elements).toEqual([])
  })
})

describe('stroke bounds', () => {
  it('resolves a horizontal line into a box grown by half the thickness', () => {
    const points: StrokePoint[] = [[10, 50, 0.5], [110, 50, 0.5]]
    expect(strokeBounds(points, STROKE_SIZES.m)).toEqual({
      x: 6,
      y: 46,
      w: 108,
      h: 8,
      points: [[4, 4, 0.5], [104, 4, 0.5]],
    })
  })

  it('uses each thickness for the box and keeps the spread', () => {
    const points: StrokePoint[] = [[0, 0, 0], [0, 30, 0]]
    expect(strokeBounds(points, STROKE_SIZES.s)).toEqual({
      x: -2, y: -2, w: 4, h: 34, points: [[2, 2, 0], [2, 32, 0]],
    })
    expect(strokeBounds(points, STROKE_SIZES.l)).toEqual({
      x: -8, y: -8, w: 16, h: 46, points: [[8, 8, 0], [8, 38, 0]],
    })
  })

  it('rounds relative coordinates to 0.1 and pressure to 0.01', () => {
    const points: StrokePoint[] = [[0, 0, 0.1234], [10.04, 5.06, 0.98765]]
    const bounds = strokeBounds(points, STROKE_SIZES.s)
    expect(bounds).toEqual({
      x: -2,
      y: -2,
      w: 14,
      h: 9.1,
      points: [[2, 2, 0.12], [12, 7.1, 0.99]],
    })
  })
})

describe('stroke simplification', () => {
  it('keeps a stroke within the bound while preserving both ends', () => {
    const points: StrokePoint[] = Array.from({ length: 5000 }, (_entry, index) => [
      index,
      Math.sin(index / 100) * 500,
      0.5,
    ])
    const simplified = simplifyStroke(points, 2000)
    expect(simplified.length).toBeLessThanOrEqual(2000)
    expect(simplified[0]).toEqual(points[0])
    expect(simplified[simplified.length - 1]).toEqual(points[points.length - 1])
  })

  it('grows the tolerance until a jagged stroke fits the bound', () => {
    const points: StrokePoint[] = Array.from({ length: 300 }, (_entry, index) => [
      index,
      index % 2 === 0 ? 0 : 500,
      0.5,
    ])
    const simplified = simplifyStroke(points, 2)
    expect(simplified).toEqual([points[0], points[points.length - 1]])
  })

  it('collapses a straight line to its ends', () => {
    const points: StrokePoint[] = Array.from({ length: 3000 }, (_entry, index) => [index, index, 0.5])
    expect(simplifyStroke(points, 100)).toEqual([[0, 0, 0.5], [2999, 2999, 0.5]])
  })

  it('returns a short stroke unchanged', () => {
    const points: StrokePoint[] = [[0, 0, 0.5], [10, 10, 0.5]]
    expect(simplifyStroke(points, 2000)).toEqual(points)
  })
})

describe('stroke erasure', () => {
  it('splits a stroke into two parts when the middle is erased', () => {
    const points: StrokePoint[] = [[0, 0, 0.5], [10, 0, 0.5], [20, 0, 0.5], [30, 0, 0.5], [40, 0, 0.5]]
    const path: StrokePathPoint[] = [[18, -10], [22, 10]]
    expect(eraseStroke(points, path, 5)).toEqual([
      [[0, 0, 0.5], [10, 0, 0.5]],
      [[30, 0, 0.5], [40, 0, 0.5]],
    ])
  })

  it('shortens a stroke when an end is erased', () => {
    const points: StrokePoint[] = [[0, 0, 0.5], [10, 0, 0.5], [20, 0, 0.5], [30, 0, 0.5]]
    const path: StrokePathPoint[] = [[32, -10], [32, 10]]
    expect(eraseStroke(points, path, 5)).toEqual([[[0, 0, 0.5], [10, 0, 0.5], [20, 0, 0.5]]])
  })

  it('breaks a stroke where a sparse eraser path crosses one segment', () => {
    const points: StrokePoint[] = [[0, 0, 0.5], [10, 0, 0.5], [20, 0, 0.5], [30, 0, 0.5]]
    const path: StrokePathPoint[] = [[15, -30], [15, 30]]
    expect(eraseStroke(points, path, 2)).toEqual([
      [[0, 0, 0.5], [10, 0, 0.5]],
      [[20, 0, 0.5], [30, 0, 0.5]],
    ])
  })

  it('drops parts shorter than two points', () => {
    const points: StrokePoint[] = [[0, 0, 0.5], [10, 0, 0.5]]
    const path: StrokePathPoint[] = [[-1, 0], [1, 0]]
    expect(eraseStroke(points, path, 5)).toEqual([])
  })

  it('returns no parts for a single-point stroke with an empty path', () => {
    expect(eraseStroke([[0, 0, 0.5]], [], 5)).toEqual([])
  })

  it('takes the smallest distance across a multi-segment eraser path', () => {
    const points: StrokePoint[] = [[0, 0, 0.5], [10, 0, 0.5]]
    const path: StrokePathPoint[] = [[10, 0], [10, 50], [100, 50]]
    // The first eraser segment crosses the stroke; the later, farther segment
    // must not replace it.
    expect(eraseStroke(points, path, 1)).toEqual([])
  })

  it('keeps a stroke when a parallel path segment runs beside it', () => {
    const points: StrokePoint[] = [[0, 0, 0.5], [10, 0, 0.5]]
    expect(eraseStroke(points, [[0, 5], [10, 5]], 4)).toEqual([points])
  })

  it('clamps an eraser segment whose closest approach lies before it', () => {
    const points: StrokePoint[] = [[0, 0, 0.5], [10, 0, 0.5]]
    expect(eraseStroke(points, [[5, 5], [6, 6]], 1)).toEqual([points])
  })

  it('clamps an eraser segment whose closest approach lies after it', () => {
    const points: StrokePoint[] = [[0, 0, 0.5], [10, 0, 0.5]]
    expect(eraseStroke(points, [[12, 5], [12.5, 4]], 1)).toEqual([points])
  })

  it('keeps the stroke whole for an empty or distant eraser path', () => {
    const points: StrokePoint[] = [[0, 0, 0.5], [10, 0, 0.5]]
    expect(eraseStroke(points, [], 5)).toEqual([points])
    expect(eraseStroke(points, [[100, 100]], 5)).toEqual([points])
  })
})

describe('stroke limits in the snapshot', () => {
  it('publishes strokePointsMax from the deployment configuration', async () => {
    const { service } = await mount({
      limits: { ...LIMITS, elements: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 512 } },
    })
    expect((await service.snapshot()).limits).toEqual({
      elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 512,
    })
  })
})
