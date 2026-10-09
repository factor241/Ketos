/**
 * Incremental state of one eraser pass over a set of strokes.
 *
 * Erasing is a union of cuts: a stroke point or segment is removed when any
 * piece of the eraser path comes within the radius of it, so erasing the
 * remaining parts piece by piece leaves the same parts as one `eraseStroke`
 * over the whole path. The pass therefore applies only the path samples added
 * since the previous batch, skips strokes whose element box the new piece
 * cannot reach, and keeps a path sample only when it lies at least a quarter of
 * the radius from the previous kept one, which bounds the path length of a
 * long drag without leaving a gap a hole could fall through.
 */
import { eraserPathReachesBox, eraseStroke } from '@ketos/board-doc/data'
import type { StrokePathPoint, StrokePoint, StrokeWorldBox } from '@ketos/board-doc/types'

/** Smallest spacing between kept path samples, as a fraction of the radius. */
export const ERASER_SAMPLE_SPACING = 0.25

/** One stroke the pass may cut. */
export interface EraserTarget {
  /** Caller's identity of the stroke. */
  readonly id: string
  /** World rectangle of the stroke element; every point lies inside it. */
  readonly box: StrokeWorldBox
  /** Absolute world points of the stroke. */
  readonly points: readonly StrokePoint[]
}

/** One stroke the pass changed, with the parts that remain of it. */
export interface EraserTouched<T extends EraserTarget> {
  /** The stroke the parts come from. */
  readonly target: T
  /** Remaining parts, each with at least two points; empty when nothing remains. */
  readonly parts: StrokePoint[][]
}

/** Remaining parts of one stroke while the pass runs. */
interface TargetState<T extends EraserTarget> {
  readonly target: T
  parts: StrokePoint[][]
  changed: boolean
}

/**
 * One eraser pass: collects thinned path samples and reports the parts that
 * remain of every stroke the path has cut.
 */
export class EraserPass<T extends EraserTarget = EraserTarget> {
  private readonly states: Array<TargetState<T>>
  private readonly kept: StrokePathPoint[] = []
  private applied = 0
  private last: StrokePathPoint | null = null

  /**
   * Start a pass with nothing erased.
   * @param targets - the strokes the pass may cut.
   */
  constructor(targets: readonly T[]) {
    this.states = targets.map(target => ({ target, parts: [[...target.points]], changed: false }))
  }

  /** Kept path samples in world units, in pointer order. */
  get path(): readonly StrokePathPoint[] {
    return this.kept
  }

  /**
   * Record one pointer sample; a sample closer than a quarter of the radius to
   * the last kept one waits as the candidate final sample.
   * @param x - world x of the sample.
   * @param y - world y of the sample.
   * @param radius - eraser radius in world units.
   */
  add(x: number, y: number, radius: number): void {
    const sample: StrokePathPoint = [x, y]
    this.last = sample
    const previous = this.kept[this.kept.length - 1]
    if (previous !== undefined && Math.hypot(x - previous[0], y - previous[1]) < radius * ERASER_SAMPLE_SPACING) return
    this.kept.push(sample)
  }

  /**
   * Keep the most recent pointer sample even when thinning dropped it, so the
   * hole reaches where the pointer ended.
   */
  finish(): void {
    const last = this.last
    if (last !== null && this.kept[this.kept.length - 1] !== last) this.kept.push(last)
  }

  /**
   * Apply the samples added since the last call and list every changed stroke.
   * @param radius - eraser radius in world units for the new samples.
   * @returns the strokes the path has cut so far, with their remaining parts.
   */
  touched(radius: number): Array<EraserTouched<T>> {
    if (this.applied < this.kept.length) {
      const piece = this.kept.slice(Math.max(0, this.applied - 1))
      this.applied = this.kept.length
      for (const state of this.states) this.cut(state, piece, radius)
    }
    return this.states
      .filter(state => state.changed)
      .map(state => ({ target: state.target, parts: state.parts }))
  }

  /**
   * Erase the remaining parts of one stroke along one path piece.
   * @param state - the stroke's remaining parts.
   * @param piece - new path samples, led by the last applied one.
   * @param radius - eraser radius in world units.
   */
  private cut(state: TargetState<T>, piece: readonly StrokePathPoint[], radius: number): void {
    if (state.parts.length === 0 || !eraserPathReachesBox(piece, radius, state.target.box)) return
    const next = state.parts.flatMap(part => eraseStroke(part, piece, radius))
    const same = next.length === state.parts.length
      && next.every((part, index) => part.length === state.parts[index]?.length)
    if (same) return
    state.parts = next
    state.changed = true
  }
}
