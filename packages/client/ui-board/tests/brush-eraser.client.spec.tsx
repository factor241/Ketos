// @vitest-environment jsdom
/**
 * Eraser: one atomic batch per pass (remove originals plus create the
 * remaining parts), middle erase splitting a stroke in two, edge erase
 * shortening it, foreign strokes untouched, and pointercancel sending nothing.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { BoardDocId, BoardElement, BoardRevision, BoardSnapshot, ElementId, OwnerId } from '@ketos/board-doc/types'
import { createBoardStore } from '../src/client/store.ts'
import { createBoardBench, type BoardBench } from './fixtures.client.ts'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'

beforeAll(() => {
  // jsdom implements no pointer capture; the gesture only needs its deltas.
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true, writable: true })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { value: () => {}, configurable: true, writable: true })
})

const runtimes = new Set<SlotTestRuntime>()
afterEach(async () => {
  cleanup()
  for (const runtime of runtimes) await runtime.dispose()
  runtimes.clear()
})

type BoardInstance = ReturnType<ReturnType<typeof createBoardStore>['create']>

const DOC = brandString<BoardDocId>('00000000-0000-4000-8000-0000000000d3')
const SELF = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e3')
const FOREIGN = brandString<OwnerId>('demo-legal')
const STROKE = brandString<ElementId>('00000000-0000-4000-8000-0000000000c1')

/** One horizontal stroke from x=100 to x=300 at y=150. */
function stroke(overrides: Partial<BoardElement> = {}): BoardElement {
  return {
    id: STROKE,
    kind: 'stroke',
    ownerId: SELF,
    x: 100,
    y: 100,
    w: 208,
    h: 108,
    z: 1,
    data: {
      points: [[0, 50, 0.5], [50, 50, 0.5], [100, 50, 0.5], [150, 50, 0.5], [200, 50, 0.5]],
      width: 'm',
      pen: false,
    },
    createdAt: 10,
    updatedAt: 20,
    ...overrides,
  }
}

/** One snapshot with the given elements. */
function snapshot(elements: readonly BoardElement[]): BoardSnapshot {
  return {
    docId: DOC,
    selfId: SELF,
    revision: brandNumber<BoardRevision>(1),
    elements,
    limits: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000 },
  }
}

/** Bench with the board mounted, the eraser armed, and one snapshot published. */
async function eraserBench(elements: readonly BoardElement[]): Promise<{
  runtime: SlotTestRuntime
  panel: { container: HTMLElement }
  store: BoardInstance
  boardDoc: BoardBench['boardDoc']
  canvas: HTMLElement
}> {
  const prepared = await createBoardBench()
  runtimes.add(prepared.runtime)
  await prepared.mountBoard()
  const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
  const instance = prepared.runtime.storeOf('board.dock') as BoardInstance
  prepared.boardDoc.publish(snapshot(elements))
  await prepared.runtime.flush()
  act(() => { instance.actions.setTool('eraser') })
  await prepared.runtime.flush()
  const canvas = panel.container.querySelector('[data-surface="canvas"]') as HTMLElement
  return { runtime: prepared.runtime, panel, store: instance, boardDoc: prepared.boardDoc, canvas }
}

/** One mouse sample of the eraser pass. */
function sample(x: number, y: number): {
  pointerId: number
  clientX: number
  clientY: number
  pointerType: string
  button: number
  isPrimary: boolean
} {
  return { pointerId: 1, clientX: x, clientY: y, pointerType: 'mouse', button: 0, isPrimary: true }
}

describe('eraser pass', () => {
  it('splits a stroke in two with one batch: remove plus two creates', async () => {
    const { runtime, store: instance, boardDoc, canvas } = await eraserBench([stroke()])
    fireEvent.pointerDown(canvas, sample(200, 80))
    fireEvent.pointerMove(canvas, sample(200, 220))
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    await waitFor(() => { expect(boardDoc.ops).toHaveLength(1) })
    const batch = boardDoc.ops[0] ?? []
    expect(batch.filter(op => op.op === 'remove')).toEqual([{ op: 'remove', id: STROKE }])
    const creates = batch.filter(op => op.op === 'create')
    expect(creates).toHaveLength(2)
    expect(creates[0]).toMatchObject({
      op: 'create', kind: 'stroke', x: 96, y: 146, w: 58, h: 8,
      data: { points: [[4, 4, 0.5], [54, 4, 0.5]], width: 'm', pen: false },
    })
    expect(creates[1]).toMatchObject({
      op: 'create', kind: 'stroke', x: 246, y: 146, w: 58, h: 8,
      data: { points: [[4, 4, 0.5], [54, 4, 0.5]], width: 'm', pen: false },
    })
    await runtime.flush()
    const stored = Object.values(instance.getSnapshot().boardElements)
    expect(stored).toHaveLength(2)
    expect(stored.every(element => element.kind === 'stroke')).toBe(true)
  })

  it('shortens a stroke when an end is erased', async () => {
    const { runtime, store: instance, boardDoc, canvas } = await eraserBench([stroke()])
    fireEvent.pointerDown(canvas, sample(310, 80))
    fireEvent.pointerMove(canvas, sample(310, 220))
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    await waitFor(() => { expect(boardDoc.ops).toHaveLength(1) })
    const batch = boardDoc.ops[0] ?? []
    expect(batch.filter(op => op.op === 'remove')).toHaveLength(1)
    const creates = batch.filter(op => op.op === 'create')
    expect(creates).toHaveLength(1)
    expect(creates[0]).toMatchObject({
      op: 'create', x: 96, y: 146, w: 158, h: 8,
      data: { points: [[4, 4, 0.5], [54, 4, 0.5], [104, 4, 0.5], [154, 4, 0.5]] },
    })
    await runtime.flush()
    expect(Object.values(instance.getSnapshot().boardElements)).toHaveLength(1)
  })

  it('sends nothing for a pass that touches no stroke, a foreign stroke, or a cancel', async () => {
    const { runtime, store: instance, boardDoc, canvas } = await eraserBench([
      stroke({ ownerId: FOREIGN }),
      stroke({ id: brandString<ElementId>('00000000-0000-4000-8000-0000000000c2'), x: 600, y: 600 }),
    ])
    // Over the foreign stroke only.
    fireEvent.pointerDown(canvas, sample(200, 80))
    fireEvent.pointerMove(canvas, sample(200, 220))
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    await runtime.flush()
    expect(boardDoc.ops).toHaveLength(0)

    // Over the owner's stroke, then cancelled.
    fireEvent.pointerDown(canvas, sample(650, 620))
    fireEvent.pointerMove(canvas, sample(650, 680))
    fireEvent.pointerCancel(canvas, { pointerId: 1 })
    await runtime.flush()
    expect(boardDoc.ops).toHaveLength(0)
    expect(Object.values(instance.getSnapshot().boardElements)).toHaveLength(2)
  })

  it('previews the remaining parts and hides the originals while the pass runs', async () => {
    const { runtime, panel, canvas } = await eraserBench([stroke()])
    fireEvent.pointerDown(canvas, sample(200, 80))
    fireEvent.pointerMove(canvas, sample(200, 220))
    await waitFor(() => {
      expect(panel.container.querySelectorAll('[data-board-eraser-preview]').length).toBe(2)
    })
    expect(panel.container.querySelector(`[data-board-element-id="${STROKE}"]`)).toBeNull()
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    await runtime.flush()
    await waitFor(() => {
      expect(panel.container.querySelectorAll('[data-board-eraser-preview]').length).toBe(0)
    })
    expect(panel.container.querySelectorAll('[data-board-element-id]').length).toBe(2)
  })
})
