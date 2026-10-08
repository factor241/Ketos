// @vitest-environment jsdom
/**
 * Brush drawing: one create operation per stroke, none for a cancel or a
 * click, world-point translation under pan and zoom, points sampled with the
 * live view so a mid-stroke zoom cannot shift them, and the live draft.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { BoardDocId, BoardElement, BoardRevision, BoardSnapshot, OwnerId } from '@ketos/board-doc/types'
import type { BoardOp } from '@ketos/board-doc/types'
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

const DOC = brandString<BoardDocId>('00000000-0000-4000-8000-0000000000d2')
const SELF = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e2')

/** One empty snapshot that publishes the stroke limits. */
function snapshot(): BoardSnapshot {
  return {
    docId: DOC,
    selfId: SELF,
    revision: brandNumber<BoardRevision>(1),
    elements: [] as readonly BoardElement[],
    participants: [],
    limits: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 },
  }
}

/** Bench with the board mounted, the tool armed, and one snapshot published. */
async function drawingBench(): Promise<{
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
  prepared.boardDoc.publish(snapshot())
  await prepared.runtime.flush()
  act(() => { instance.actions.setTool('brush') })
  await prepared.runtime.flush()
  const canvas = panel.container.querySelector('[data-surface="canvas"]') as HTMLElement
  return { runtime: prepared.runtime, panel, store: instance, boardDoc: prepared.boardDoc, canvas }
}

/** The create operations one bench recorded. */
function creates(boardDoc: BoardBench['boardDoc']): readonly BoardOp[] {
  return boardDoc.ops.flat().filter(op => op.op === 'create')
}

/** One mouse sample of the drawing gesture. */
function sample(x: number, y: number, pointerId = 1): {
  pointerId: number
  clientX: number
  clientY: number
  pointerType: string
  button: number
  isPrimary: boolean
} {
  return { pointerId, clientX: x, clientY: y, pointerType: 'mouse', button: 0, isPrimary: true }
}

describe('brush drawing', () => {
  it('commits exactly one stroke operation with the translated points', async () => {
    const { runtime, boardDoc, canvas } = await drawingBench()
    fireEvent.pointerDown(canvas, sample(100, 100))
    fireEvent.pointerMove(canvas, sample(140, 120))
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    await waitFor(() => { expect(creates(boardDoc)).toHaveLength(1) })
    expect(creates(boardDoc)[0]).toMatchObject({
      op: 'create',
      kind: 'stroke',
      x: 96,
      y: 96,
      w: 48,
      h: 28,
      data: { points: [[4, 4, 0.5], [44, 24, 0.5]], width: 'm', pen: false },
    })
    await runtime.flush()
  })

  it('commits nothing on pointercancel or on a click without movement', async () => {
    const { runtime, boardDoc, canvas } = await drawingBench()
    fireEvent.pointerDown(canvas, sample(100, 100))
    fireEvent.pointerMove(canvas, sample(160, 160))
    fireEvent.pointerCancel(canvas, { pointerId: 1 })
    await runtime.flush()
    expect(creates(boardDoc)).toHaveLength(0)

    fireEvent.pointerDown(canvas, sample(100, 100, 2))
    fireEvent.pointerUp(canvas, { pointerId: 2 })
    await runtime.flush()
    expect(creates(boardDoc)).toHaveLength(0)
  })

  it('translates points through the current pan and zoom', async () => {
    const { runtime, store: instance, boardDoc, canvas } = await drawingBench()
    act(() => {
      instance.actions.setPan(10, 20)
      instance.actions.setZoom(2)
    })
    await runtime.flush()
    fireEvent.pointerDown(canvas, sample(100, 100))
    fireEvent.pointerMove(canvas, sample(140, 100))
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    await waitFor(() => { expect(creates(boardDoc)).toHaveLength(1) })
    expect(creates(boardDoc)[0]).toMatchObject({
      x: 41,
      y: 36,
      w: 28,
      h: 8,
      data: { points: [[4, 4, 0.5], [24, 4, 0.5]] },
    })
  })

  it('keeps the points already drawn when the view zooms mid-stroke', async () => {
    const { runtime, store: instance, boardDoc, canvas } = await drawingBench()
    fireEvent.pointerDown(canvas, sample(100, 100))
    fireEvent.pointerMove(canvas, sample(120, 100))
    // A wheel zoom anchors on the pointer, so the world point under it stays.
    act(() => { instance.actions.zoomBy(2, 120, 100) })
    await runtime.flush()
    fireEvent.pointerMove(canvas, sample(140, 140))
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    await waitFor(() => { expect(creates(boardDoc)).toHaveLength(1) })
    expect(creates(boardDoc)[0]).toMatchObject({
      x: 96,
      y: 96,
      w: 38,
      h: 28,
      data: { points: [[4, 4, 0.5], [24, 4, 0.5], [34, 24, 0.5]], width: 'm', pen: false },
    })
  })

  it('shows the live draft while drawing and clears it on pointerup', async () => {
    const { runtime, panel, canvas } = await drawingBench()
    fireEvent.pointerDown(canvas, sample(100, 100))
    fireEvent.pointerMove(canvas, sample(140, 120))
    await waitFor(() => {
      expect(panel.container.querySelector('[data-board-stroke-draft]')).not.toBeNull()
    })
    const draft = panel.container.querySelector('[data-board-stroke-draft]')
    expect(draft?.getAttribute('data-board-owner-color')).not.toBeNull()
    expect(draft?.querySelector('path')?.getAttribute('d')).toContain('M ')
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    await runtime.flush()
    await waitFor(() => {
      expect(panel.container.querySelector('[data-board-stroke-draft]')).toBeNull()
    })
  })
})
