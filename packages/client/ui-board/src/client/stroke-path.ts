/**
 * Deterministic SVG path of one stroke. The options are a pure function of the
 * stored data — thickness and the pen flag — so every Ketos renders the same
 * points into the same path, and the result is memoized by the data object so
 * panning and zooming never recompute an unchanged stroke.
 */
import { getStroke } from 'perfect-freehand'
import { STROKE_SIZES } from '@ketos/board-doc/data'
import type { StrokeData, StrokePoint } from '@ketos/board-doc/types'

/** Memoized path of every stroke data object rendered so far. */
const pathByData = new WeakMap<StrokeData, string>()

/**
 * Build the SVG path of one stroke's outline.
 *
 * The quadrant construction follows the `getSvgPathFromStroke` example of the
 * perfect-freehand README (https://github.com/steveruizok/perfect-freehand,
 * MIT license): every outline point starts a quadratic curve through the
 * midpoint to the next point, and the path closes.
 * @param outline - closed outline points `getStroke` answered.
 * @returns the SVG `d` attribute of the filled path.
 */
export function svgPathFromOutline(outline: readonly (readonly [number, number])[]): string {
  if (outline.length === 0) return ''
  const parts: Array<string | number> = ['M', (outline[0] as readonly [number, number])[0], (outline[0] as readonly [number, number])[1], 'Q']
  for (let index = 0; index < outline.length; index += 1) {
    const [x0, y0] = outline[index] as readonly [number, number]
    const [x1, y1] = outline[(index + 1) % outline.length] as readonly [number, number]
    parts.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
  }
  parts.push('Z')
  return parts.join(' ')
}

/**
 * SVG path of one stroke's outline, in the coordinates of the element box.
 * @param data - parsed stroke data.
 * @returns the SVG `d` attribute of the filled path.
 */
export function strokeToSvgPath(data: StrokeData): string {
  const cached = pathByData.get(data)
  if (cached !== undefined) return cached
  const outline = getStroke(
    data.points.map(([x, y, pressure]): [number, number, number] => [x, y, pressure]),
    {
      size: STROKE_SIZES[data.width],
      thinning: 0.5,
      smoothing: 0.5,
      streamline: 0.3,
      simulatePressure: !data.pen,
      last: true,
    },
  )
  const path = svgPathFromOutline(outline)
  pathByData.set(data, path)
  return path
}

/**
 * Polyline through a stroke's points, the invisible hit axis of the element.
 * @param points - relative stroke points.
 * @returns the SVG `d` attribute of the polyline.
 */
export function strokeAxisPath(points: readonly StrokePoint[]): string {
  return points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${String(x)} ${String(y)}`)
    .join(' ')
}
