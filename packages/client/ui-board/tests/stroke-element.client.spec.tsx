// @vitest-environment jsdom
/**
 * Stroke body: the deterministic owner-colored path built from stored data,
 * the pen-driven paint options, memoization across board pans, the pointer
 * contract of the hit paths, and the neutral fallback for unreadable data.
 */
import { createElement } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { getStroke } from 'perfect-freehand'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type {
  BoardDocId, BoardElement, BoardRevision, BoardSnapshot, ElementId, OwnerId, StrokeData,
} from '@ketos/board-doc/types'
import { StrokeElement } from '../src/client/elements/StrokeElement.tsx'
import { strokeAxisPath, strokeToSvgPath, svgPathFromOutline } from '../src/client/stroke-path.ts'
import { createBoardStore, type BoardState } from '../src/client/store.ts'
import { BOARD_ZOOM_MIN } from '../src/board-settings.ts'
import { createBoardBench, t } from './fixtures.client.ts'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'

// `spy: true` keeps the real implementation and records every call, so the
// memoization assertion observes the actual paint pass.
vi.mock('perfect-freehand', { spy: true })

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

beforeEach(() => {
  vi.mocked(getStroke).mockClear()
})

type BoardInstance = ReturnType<ReturnType<typeof createBoardStore>['create']>

const ID_A = brandString<ElementId>('00000000-0000-4000-8000-0000000000a1')
const ID_B = brandString<ElementId>('00000000-0000-4000-8000-0000000000a2')
const DOC_A = brandString<BoardDocId>('00000000-0000-4000-8000-0000000000d1')
const SELF = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e1')

/** Points one stroke's data carries. */
const POINTS: Array<[number, number, number]> = [[4, 4, 0.5], [50, 20, 0.5], [104, 4, 0.5]]

/** Stroke data every test renders. */
const STROKE_DATA = { points: POINTS, width: 'm' as const, pen: false }

/** One stroke element at a chosen position. */
function element(id: ElementId = ID_A, overrides: Partial<BoardElement> = {}): BoardElement {
  return {
    id,
    kind: 'stroke',
    ownerId: SELF,
    x: 0,
    y: 0,
    w: 108,
    h: 24,
    z: 1,
    data: STROKE_DATA,
    createdAt: 10,
    updatedAt: 20,
    ...overrides,
  }
}

/** One snapshot with test overrides. */
function snapshot(elements: readonly BoardElement[]): BoardSnapshot {
  return {
    docId: DOC_A,
    selfId: SELF,
    revision: brandNumber<BoardRevision>(1),
    elements,
    participants: [{ id: SELF, name: 'Kirill', color: 1, updatedAt: 1 }],
    windows: [],
    limits: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 },
  }
}

/** Direct-render props for the stroke body. */
function elementProps(instance: BoardInstance, stroke: BoardElement): never {
  return {
    element: stroke,
    selected: true,
    editable: true,
    useStore: (selector: (value: BoardState) => unknown): unknown => selector(instance.getSnapshot()),
    t,
  } as never
}

describe('stroke path', () => {
  it('builds the same path from the same data and memoizes it by reference', () => {
    const data: StrokeData = { points: [[0, 0, 0.5], [10, 10, 0.5]], width: 's', pen: false }
    const first = strokeToSvgPath(data)
    expect(first).toBe(strokeToSvgPath(data))
    expect(vi.mocked(getStroke)).toHaveBeenCalledTimes(1)
    expect(first.startsWith('M ')).toBe(true)
    expect(first.endsWith(' Z')).toBe(true)
  })

  it('feeds the pen flag into simulatePressure and differs by pen', () => {
    const mouse: StrokeData = { points: [[0, 0, 0.5], [10, 10, 0.5]], width: 'm', pen: false }
    const pen: StrokeData = { points: [[0, 0, 0.5], [10, 10, 0.5]], width: 'm', pen: true }
    const mousePath = strokeToSvgPath(mouse)
    const penPath = strokeToSvgPath(pen)
    expect(vi.mocked(getStroke).mock.calls[0]?.[1]).toMatchObject({ simulatePressure: true, size: 8, last: true })
    expect(vi.mocked(getStroke).mock.calls[1]?.[1]).toMatchObject({ simulatePressure: false, size: 8, last: true })
    expect(mousePath).not.toBe(penPath)
  })

  it('draws the same relative data identically at different element positions', () => {
    const instance = createBoardStore().create()
    instance.actions.applyBoardSnapshot(snapshot([element(ID_A), element(ID_B, { x: 500, y: 300 })]))
    const { container } = render(createElement('div', null,
      createElement(StrokeElement, elementProps(instance, element(ID_A))),
      createElement(StrokeElement, elementProps(instance, element(ID_B, { x: 500, y: 300 }))),
    ))
    const paths = [...container.querySelectorAll('[data-board-stroke-outline]')]
    expect(paths).toHaveLength(2)
    expect(paths[0]?.getAttribute('d')).toBe(paths[1]?.getAttribute('d'))
  })

  it('draws an empty outline path and a polyline axis', () => {
    expect(svgPathFromOutline([])).toBe('')
    expect(strokeAxisPath([[1, 2, 0], [3, 4, 0]])).toBe('M1 2 L3 4')
  })
})

describe('stroke body', () => {
  /** A store instance that already adopted the snapshot's limits and selfId. */
  function mountedInstance(): BoardInstance {
    const instance = createBoardStore().create()
    instance.actions.applyBoardSnapshot(snapshot([element()]))
    return instance
  }

  it('renders the owner-colored path and the pointer contract of the hit paths', () => {
    const instance = mountedInstance()
    const { container } = render(createElement(StrokeElement, elementProps(instance, element())))
    const svg = container.querySelector('svg[data-board-stroke]')
    expect(svg?.getAttribute('pointer-events')).toBe('none')
    expect(svg?.getAttribute('aria-label')).toBe('Drawing of Kirill')
    const outline = container.querySelector('[data-board-stroke-outline]')
    expect(outline?.getAttribute('fill')).toBe('var(--board-owner-edge)')
    expect(outline?.getAttribute('pointer-events')).toBe('visibleFill')
    const axis = container.querySelector('[data-board-stroke-axis]')
    expect(axis?.getAttribute('pointer-events')).toBe('stroke')
    expect(axis?.getAttribute('stroke')).toBe('transparent')
    expect(axis?.getAttribute('d')).toBe('M4 4 L50 20 L104 4')
  })

  it('scales the invisible hit axis with the zoom', () => {
    const instance = mountedInstance()
    instance.actions.setZoom(BOARD_ZOOM_MIN)
    const { container } = render(createElement(StrokeElement, elementProps(instance, element())))
    const axis = container.querySelector('[data-board-stroke-axis]')
    expect(axis?.getAttribute('stroke-width')).toBe(String(12 / BOARD_ZOOM_MIN))
  })

  it('falls back to the neutral body for data that fails the decoder', () => {
    const instance = mountedInstance()
    const broken = element(ID_A, { data: { points: [[0, 0, 0.5]], width: 'm', pen: false } })
    const { container } = render(createElement(StrokeElement, elementProps(instance, broken)))
    expect(container.querySelector('[data-board-element-neutral]')?.getAttribute('data-board-element-neutral')).toBe('stroke')
    expect(container.querySelector('svg[data-board-stroke]')).toBeNull()
  })
})

describe('stroke body through the assembled board', () => {
  it('does not recompute the path when the board pans or zooms', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    await prepared.mountBoard()
    const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
    const store = prepared.runtime.storeOf('board.dock') as BoardInstance
    prepared.boardDoc.publish(snapshot([element()]))
    await waitFor(() => {
      expect(panel.container.querySelector('[data-board-stroke-outline]')).not.toBeNull()
    })
    const callsAfterMount = vi.mocked(getStroke).mock.calls.length
    expect(callsAfterMount).toBeGreaterThanOrEqual(1)
    act(() => {
      store.actions.setPan(120, -40)
      store.actions.setZoom(1.5)
    })
    await prepared.runtime.flush()
    expect(panel.container.querySelector('[data-board-stroke-outline]')).not.toBeNull()
    expect(vi.mocked(getStroke).mock.calls.length).toBe(callsAfterMount)
  })
})
