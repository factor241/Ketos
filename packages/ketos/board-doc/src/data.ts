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
  StrokeBounds, StrokeBox, StrokeData, StrokePathPoint, StrokePoint, StrokeWidth,
} from './types.ts'

/** UUID shape every opaque identifier carries. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/** Font families a note accepts, in menu order. */
export const NOTE_FONTS: readonly NoteFont[] = ['sans', 'serif', 'mono']

/** Base text sizes a note accepts, in menu order. */
export const NOTE_SIZES: readonly NoteSize[] = ['s', 'm', 'l']

/** Scales a note accepts; the menu offers exactly these steps. */
export const NOTE_SCALE_STEPS: readonly number[] = [0.5, 0.75, 1, 1.5, 2, 3]

/** Stroke thicknesses a drawing accepts, in menu order. */
export const STROKE_WIDTHS: readonly StrokeWidth[] = ['s', 'm', 'l']

/**
 * World width of each stroke thickness, in world units. The value is a
 * protocol constant, not a deployment setting: the stored `width` selects it
 * identically on every Ketos.
 */
export const STROKE_SIZES: Readonly<Record<StrokeWidth, number>> = { s: 4, m: 8, l: 16 }

/** Fields one note's data carries; any other field is a refusal. */
const NOTE_FIELDS: readonly string[] = ['text', 'font', 'size', 'scale']

/** Fields one stroke's data carries; any other field is a refusal. */
const STROKE_FIELDS: readonly string[] = ['points', 'width', 'pen']

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
 * Parse one stroke's data: exactly the three fields, two to
 * {@link BoardLimits.strokePointsMax} `[x, y, pressure]` triples whose
 * relative coordinates stay inside the element box, a known thickness, and a
 * boolean pen flag.
 * @param value - decoded data value.
 * @param limits - element limits the point count must stay inside.
 * @param box - element world box the relative points must stay inside.
 * @returns the typed stroke data, or null when the value is not a valid stroke.
 */
export function parseStrokeData(value: unknown, limits: BoardLimits, box: StrokeBox): StrokeData | null {
  if (!isElementData(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== STROKE_FIELDS.length || keys.some(key => !STROKE_FIELDS.includes(key))) return null
  const { points, width, pen } = value
  if (!Array.isArray(points)) return null
  if (points.length < 2 || points.length > limits.strokePointsMax) return null
  if (typeof width !== 'string' || !(STROKE_WIDTHS as readonly string[]).includes(width)) return null
  if (typeof pen !== 'boolean') return null
  const parsed: StrokePoint[] = []
  for (const point of points) {
    if (!Array.isArray(point) || point.length !== 3) return null
    const [dx, dy, pressure] = point as unknown[]
    if (typeof dx !== 'number' || !Number.isFinite(dx) || dx < 0 || dx > box.w) return null
    if (typeof dy !== 'number' || !Number.isFinite(dy) || dy < 0 || dy > box.h) return null
    if (typeof pressure !== 'number' || !Number.isFinite(pressure) || pressure < 0 || pressure > 1) return null
    parsed.push([dx, dy, pressure])
  }
  return { points: parsed, width: width as StrokeWidth, pen }
}

/**
 * Round one world coordinate to the stored precision of 0.1 units.
 * @param value - coordinate to round.
 * @returns the rounded coordinate.
 */
function roundCoordinate(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Round one pressure to the stored precision of 0.01.
 * @param value - pressure to round.
 * @returns the rounded pressure.
 */
function roundPressure(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Resolve absolute stroke points into the element box and the relative points
 * stored with it: `(x, y)` is the top-left of the point spread grown by half
 * the thickness on every side, `w`/`h` are the spread plus the full thickness,
 * and every relative coordinate is rounded to 0.1 units and every pressure to
 * 0.01 so a long drawing stays compact.
 * @param points - absolute world points of the stroke, at least one.
 * @param width - stroke thickness in world units.
 * @returns the element box and the relative points.
 */
export function strokeBounds(points: readonly StrokePoint[], width: number): StrokeBounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const half = width / 2
  const x = roundCoordinate(minX - half)
  const y = roundCoordinate(minY - half)
  return {
    x,
    y,
    w: roundCoordinate(maxX - minX + width),
    h: roundCoordinate(maxY - minY + width),
    points: points.map(([px, py, pressure]) => [
      roundCoordinate(px - x),
      roundCoordinate(py - y),
      roundPressure(pressure),
    ]),
  }
}

/**
 * Reduce a stroke to at most `max` points with the Ramer–Douglas–Peucker
 * method: the tolerance starts at 0.1 world units and doubles until the result
 * fits, and the first and last points are always kept.
 * @param points - absolute or relative stroke points, at least one.
 * @param max - largest accepted point count, at least 2.
 * @returns the simplified points.
 */
export function simplifyStroke(points: readonly StrokePoint[], max: number): readonly StrokePoint[] {
  if (points.length <= max) return [...points]
  let tolerance = 0.1
  for (;;) {
    const simplified = simplifyWithTolerance(points, tolerance)
    if (simplified.length <= max) return simplified
    tolerance *= 2
  }
}

/**
 * One Ramer–Douglas–Peucker pass at a fixed tolerance. The recursion is an
 * explicit stack so a jagged stroke of thousands of points cannot overflow it.
 * @param points - points to simplify.
 * @param tolerance - largest deviation a dropped point may carry.
 * @returns the kept points.
 */
function simplifyWithTolerance(points: readonly StrokePoint[], tolerance: number): StrokePoint[] {
  const last = points.length - 1
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[last] = true
  const stack: Array<[number, number]> = [[0, last]]
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number]
    let index = -1
    let farthest = tolerance
    for (let i = start + 1; i < end; i += 1) {
      const distance = pointSegmentDistance(points[i] as StrokePoint, points[start] as StrokePoint, points[end] as StrokePoint)
      if (distance > farthest) {
        farthest = distance
        index = i
      }
    }
    if (index < 0) continue
    keep[index] = true
    stack.push([start, index], [index, end])
  }
  return points.filter((_point, index) => keep[index])
}

/**
 * Erase a stroke along one eraser path: a stroke point closer than `radius` to
 * the path is dropped, and a stroke segment closer than `radius` to any path
 * segment breaks the stroke there, so a fast mouse that skips over the stroke
 * still leaves a gap. Parts shorter than two points are dropped.
 * @param points - stroke points to erase from.
 * @param eraserPath - eraser path points in world units.
 * @param radius - eraser radius in world units.
 * @returns the remaining parts, each with at least two points.
 */
export function eraseStroke(
  points: readonly StrokePoint[],
  eraserPath: readonly StrokePathPoint[],
  radius: number,
): StrokePoint[][] {
  if (eraserPath.length === 0) return points.length < 2 ? [] : [[...points]]
  const parts: StrokePoint[][] = []
  let current: StrokePoint[] = []
  const flush = (): void => {
    if (current.length >= 2) parts.push(current)
    current = []
  }
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i] as StrokePoint
    if (segmentPathDistance(point, point, eraserPath) < radius) {
      flush()
      continue
    }
    if (i > 0 && segmentPathDistance(points[i - 1] as StrokePoint, point, eraserPath) < radius) flush()
    current.push(point)
  }
  flush()
  return parts
}

/**
 * Closest distance between one stroke segment and one eraser path.
 * @param start - segment start point.
 * @param end - segment end point.
 * @param path - eraser path points.
 * @returns the smallest segment-to-segment distance; `0` when they cross.
 */
function segmentPathDistance(
  start: StrokePoint | StrokePathPoint,
  end: StrokePoint | StrokePathPoint,
  path: readonly StrokePathPoint[],
): number {
  if (path.length === 1) {
    const only = path[0] as StrokePathPoint
    return segmentSegmentDistance(start[0], start[1], end[0], end[1], only[0], only[1], only[0], only[1])
  }
  let closest = Infinity
  for (let i = 1; i < path.length; i += 1) {
    const from = path[i - 1] as StrokePathPoint
    const to = path[i] as StrokePathPoint
    const distance = segmentSegmentDistance(start[0], start[1], end[0], end[1], from[0], from[1], to[0], to[1])
    if (distance < closest) closest = distance
  }
  return closest
}

/**
 * Distance from one point to one segment.
 * @param point - the point.
 * @param start - segment start.
 * @param end - segment end.
 * @returns the closest distance.
 */
function pointSegmentDistance(
  point: StrokePoint | StrokePathPoint,
  start: StrokePoint | StrokePathPoint,
  end: StrokePoint | StrokePathPoint,
): number {
  return segmentSegmentDistance(point[0], point[1], point[0], point[1], start[0], start[1], end[0], end[1])
}

/**
 * Closest distance between two 2D segments, following the clamped closest-point
 * construction of Ericson, Real-Time Collision Detection §5.1.9.
 * @param ax - first segment start x.
 * @param ay - first segment start y.
 * @param bx - first segment end x.
 * @param by - first segment end y.
 * @param cx - second segment start x.
 * @param cy - second segment start y.
 * @param dx - second segment end x.
 * @param dy - second segment end y.
 * @returns the closest distance; `0` when the segments cross.
 */
function segmentSegmentDistance(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): number {
  const ux = bx - ax
  const uy = by - ay
  const vx = dx - cx
  const vy = dy - cy
  const wx = ax - cx
  const wy = ay - cy
  const a = ux * ux + uy * uy
  const c = vx * vx + vy * vy
  const f = vx * wx + vy * wy
  const epsilon = 1e-12
  let s = 0
  let t = 0
  if (a <= epsilon && c <= epsilon) {
    // Both segments are single points: their distance is the point distance.
  } else if (a <= epsilon) {
    // The first segment is a point (the both-degenerate case is above):
    // project it onto the second.
    t = Math.min(1, Math.max(0, f / c))
  } else {
    const d = ux * wx + uy * wy
    if (c <= epsilon) {
      // The second segment is a point: project it onto the first.
      s = Math.min(1, Math.max(0, -d / a))
    } else {
      const b = ux * vx + uy * vy
      const denominator = a * c - b * b
      s = denominator === 0 ? 0 : Math.min(1, Math.max(0, (b * f - c * d) / denominator))
      t = (b * s + f) / c
      if (t < 0) {
        t = 0
        s = Math.min(1, Math.max(0, -d / a))
      } else if (t > 1) {
        t = 1
        s = Math.min(1, Math.max(0, (b - d) / a))
      }
    }
  }
  const px = ax + s * ux - (cx + t * vx)
  const py = ay + s * uy - (cy + t * vy)
  return Math.hypot(px, py)
}

/**
 * Validate one kind's data. A note must parse as exact {@link NoteData}, a
 * stroke as exact {@link StrokeData} inside the element box; the todo stage
 * replaces its own branch with the kind's exact rules.
 * @param kind - element kind the data belongs to.
 * @param data - decoded data object.
 * @param limits - element limits the data must stay inside.
 * @param box - element world box stroke points are relative to and must stay inside.
 * @returns a rejection reason, or null when the data is valid.
 */
export function validateElementData(
  kind: BoardElementKind,
  data: BoardElementData,
  limits: BoardLimits,
  box: StrokeBox,
): string | null {
  if (!isElementData(data)) return 'data must be a JSON object'
  switch (kind) {
    case 'note': {
      const common = commonDataReason(data, limits)
      if (common !== null) return common
      return parseNoteData(data, limits) === null ? 'invalid note data' : null
    }
    case 'stroke': {
      const common = commonDataReason(data, limits)
      if (common !== null) return common
      return parseStrokeData(data, limits, box) === null ? 'invalid stroke data' : null
    }
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
