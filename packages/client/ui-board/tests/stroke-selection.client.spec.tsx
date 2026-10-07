// @vitest-environment jsdom
/**
 * Stroke selection through the common element frame: the highlighted path
 * selects, the frame offers no resize handle, a drag commits one patch without
 * rewriting the points, Delete removes the owner's stroke, and a foreign
 * stroke selects but never moves or deletes.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
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

const DOC = brandString<BoardDocId>('00000000-0000-4000-8000-0000000000d4')
const SELF = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e4')
const FOREIGN = brandString<OwnerId>('demo-legal')
const STROKE = brandString<ElementId>('00000000-0000-4000-8000-0000000000c3')

/** One horizontal stroke; its box starts on the 24-unit grid. */
function stroke(overrides: Partial<BoardElement> = {}): BoardElement {
  return {
    id: STROKE,
    kind: 'stroke',
    ownerId: SELF,
    x: 96,
    y: 96,
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

/** Bench with the board mounted and one snapshot published. */
async function selectionBench(elements: readonly BoardElement[]): Promise<{
  runtime: SlotTestRuntime
  panel: { container: HTMLElement }
  store: BoardInstance
  boardDoc: BoardBench['boardDoc']
  frame: HTMLElement
  path: Element
  boardRoot: HTMLElement
}> {
  const prepared = await createBoardBench()
  runtimes.add(prepared.runtime)
  await prepared.mountBoard()
  const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
  const instance = prepared.runtime.storeOf('board.dock') as BoardInstance
  prepared.boardDoc.publish(snapshot(elements))
  await prepared.runtime.flush()
  const frame = panel.container.querySelector(`[data-board-element-id="${STROKE}"]`) as HTMLElement
  const path = frame.querySelector('[data-board-stroke-outline]') as Element
  const boardRoot = panel.container.querySelector('[data-surface="board"]') as HTMLElement
  return { runtime: prepared.runtime, panel, store: instance, boardDoc: prepared.boardDoc, frame, path, boardRoot }
}

describe('stroke selection', () => {
  it('selects through the path and offers no resize handle', async () => {
    const { runtime, store: instance, frame, path } = await selectionBench([stroke()])
    fireEvent.pointerDown(path, { pointerId: 1, clientX: 150, clientY: 146, button: 0 })
    await runtime.flush()
    expect(instance.getSnapshot().selectedBoardElementId).toBe(STROKE)
    expect(frame.querySelector('[data-board-element-handle]')).toBeNull()
  })

  it('moves the stroke with one patch that keeps its points', async () => {
    const { boardDoc, frame, path } = await selectionBench([stroke()])
    fireEvent.pointerDown(path, { pointerId: 1, clientX: 150, clientY: 146, button: 0 })
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 190, clientY: 146 })
    fireEvent.pointerUp(frame, { pointerId: 1 })
    await waitFor(() => { expect(boardDoc.ops).toHaveLength(1) })
    expect(boardDoc.ops[0]?.[0]).toEqual({ op: 'patch', id: STROKE, x: 144, y: 96 })
  })

  it('deletes the owner’s selected stroke with Delete', async () => {
    const { runtime, boardDoc, boardRoot, path } = await selectionBench([stroke()])
    fireEvent.pointerDown(path, { pointerId: 1, clientX: 150, clientY: 146, button: 0 })
    await runtime.flush()
    fireEvent.pointerEnter(boardRoot)
    fireEvent.keyDown(document, { key: 'Delete' })
    await waitFor(() => { expect(boardDoc.ops).toHaveLength(1) })
    expect(boardDoc.ops[0]?.[0]).toEqual({ op: 'remove', id: STROKE })
  })

  it('selects a foreign stroke but never moves or deletes it', async () => {
    const { runtime, store: instance, boardDoc, frame, path, boardRoot } = await selectionBench([
      stroke({ ownerId: FOREIGN }),
    ])
    fireEvent.pointerDown(path, { pointerId: 1, clientX: 150, clientY: 146, button: 0 })
    await runtime.flush()
    expect(instance.getSnapshot().selectedBoardElementId).toBe(STROKE)
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 190, clientY: 146 })
    fireEvent.pointerUp(frame, { pointerId: 1 })
    await runtime.flush()
    expect(boardDoc.ops).toHaveLength(0)

    fireEvent.pointerEnter(boardRoot)
    fireEvent.keyDown(document, { key: 'Delete' })
    await runtime.flush()
    expect(boardDoc.ops).toHaveLength(0)
    expect(Object.values(instance.getSnapshot().boardElements)).toHaveLength(1)
  })
})
