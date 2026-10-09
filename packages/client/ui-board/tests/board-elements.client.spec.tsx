// @vitest-environment jsdom
/**
 * Element layer: paint order (kind rank, z, id), the neutral body fallback for
 * a kind without a registered occupant, culling against the visible world
 * rectangle, the layer-before-windows DOM order, and the minimap's element
 * rectangles in their owner colors.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { BoardDocId, BoardElement, BoardRevision, ElementId, OwnerId, WindowId } from '@ketos/board-doc/types'
import { Minimap } from '../src/client/canvas/Minimap.tsx'
import { DashboardCanvas } from '../src/client/canvas/DashboardCanvas.tsx'
import { BoardElementLayer, type BoardElementLayerProps } from '../src/client/elements/BoardElementLayer.tsx'
import { DEMO_SELF_ID } from '../src/client/owners.ts'
import { createBoardStore, type BoardState } from '../src/client/store.ts'
import { en, type BoardKey, type BoardTranslate } from '../src/client/locale.ts'

afterEach(() => { cleanup() })

const DOC = brandString<BoardDocId>('00000000-0000-4000-8000-0000000000d1')
const SELF = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e1')
const NOTE_A = brandString<ElementId>('00000000-0000-4000-8000-0000000000a1')
const NOTE_B = brandString<ElementId>('00000000-0000-4000-8000-0000000000a2')
const STROKE = brandString<ElementId>('00000000-0000-4000-8000-0000000000a3')
const TODO = brandString<ElementId>('00000000-0000-4000-8000-0000000000a4')
const FAR = brandString<ElementId>('00000000-0000-4000-8000-0000000000a5')

/** English-bound locale seat for the direct component renders. */
const t: BoardTranslate = key => en[key as BoardKey]

/** One element with test overrides. */
function element(id: ElementId, overrides: Partial<BoardElement> = {}): BoardElement {
  return {
    id,
    kind: 'note',
    ownerId: DEMO_SELF_ID,
    x: 0,
    y: 0,
    w: 100,
    h: 80,
    z: 1,
    data: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

/** One board state with test overrides. */
function state(overrides: Partial<BoardState> = {}): BoardState {
  return {
    ...createBoardStore().create().getSnapshot(),
    viewportWidth: 1000,
    viewportHeight: 800,
    boardDocId: DOC,
    selfId: SELF,
    boardParticipants: [{ id: SELF, name: 'Kirill', color: 1, updatedAt: 1 }],
    boardElementsRevision: brandNumber<BoardRevision>(1),
    ...overrides,
  }
}

/**
 * Layer props over a fixed state; the slot seat renders the fallback, standing
 * in for the slot machinery a body registration would drive.
 * @param board - the state to read.
 * @returns the props.
 */
function layerProps(board: BoardState): BoardElementLayerProps {
  const instance = createBoardStore().create()
  return {
    useStore: <S,>(selector: (value: BoardState) => S): S => selector(board),
    actions: instance.actions,
    renderSlot: (_name, _owner, opts) => opts?.fallback ?? null,
    t,
    createElement: vi.fn(),
    moveElement: vi.fn(),
    resizeElement: vi.fn(),
    removeElement: vi.fn(),
    patchElement: vi.fn(() => Promise.resolve(true)),
    eraseStrokes: vi.fn(),
  }
}

describe('element layer paint order', () => {
  it('orders strokes under everything, then by z, then by id', () => {
    const board = state({
      boardElements: {
        [NOTE_A as string]: element(NOTE_A, { z: 9 }),
        [NOTE_B as string]: element(NOTE_B, { z: 2 }),
        [STROKE as string]: element(STROKE, { kind: 'stroke', z: 5 }),
        [TODO as string]: element(TODO, { kind: 'todo', z: 3 }),
      },
    })
    const { container } = render(<BoardElementLayer {...layerProps(board)} />)
    const ids = [...container.querySelectorAll('[data-board-element-id]')]
      .map(node => node.getAttribute('data-board-element-id'))
    expect(ids).toEqual([STROKE, NOTE_B, TODO, NOTE_A])
  })

  it('renders the neutral body for a kind without a registered occupant', () => {
    const board = state({ boardElements: { [STROKE as string]: element(STROKE, { kind: 'stroke' }) } })
    const { container } = render(<BoardElementLayer {...layerProps(board)} />)
    const neutral = container.querySelector('[data-board-element-neutral]')
    expect(neutral?.getAttribute('data-board-element-neutral')).toBe('stroke')
    expect(neutral?.textContent).toBe('Board element')
  })
})

describe('element layer culling', () => {
  it('skips elements outside the visible world rectangle and keeps the margin', () => {
    const board = state({
      boardElements: {
        [NOTE_A as string]: element(NOTE_A, { x: 100, y: 100 }),
        [FAR as string]: element(FAR, { x: 5_000, y: 5_000 }),
      },
    })
    const { container } = render(<BoardElementLayer {...layerProps(board)} />)
    expect(container.querySelector(`[data-board-element-id="${NOTE_A}"]`)).not.toBeNull()
    expect(container.querySelector(`[data-board-element-id="${FAR}"]`)).toBeNull()
  })

  it('keeps an element just past the viewport inside the culling margin', () => {
    // viewport 1000 wide, culling margin 480: x = 1400 still renders, x = 1500 not.
    const board = state({
      boardElements: {
        [NOTE_A as string]: element(NOTE_A, { x: 1_400, y: 0 }),
        [FAR as string]: element(FAR, { x: 1_500, y: 0 }),
      },
    })
    const { container } = render(<BoardElementLayer {...layerProps(board)} />)
    expect(container.querySelector(`[data-board-element-id="${NOTE_A}"]`)).not.toBeNull()
    expect(container.querySelector(`[data-board-element-id="${FAR}"]`)).toBeNull()
  })
})

describe('element layer editing note', () => {
  it('keeps the note being edited rendered after it left the culling rectangle', () => {
    const board = state({
      editingBoardElementId: NOTE_A,
      boardElements: {
        [NOTE_A as string]: element(NOTE_A, { x: 5_000, y: 5_000 }),
        [FAR as string]: element(FAR, { x: 5_000, y: 5_000 }),
      },
    })
    const { container } = render(<BoardElementLayer {...layerProps(board)} />)
    expect(container.querySelector(`[data-board-element-id="${NOTE_A}"]`)).not.toBeNull()
    expect(container.querySelector(`[data-board-element-id="${FAR}"]`)).toBeNull()
  })
})

describe('canvas layer order', () => {
  it('renders the element layer before the window layer', () => {
    const board = state({ boardElements: { [NOTE_A as string]: element(NOTE_A) } })
    const calls: string[] = []
    const renderSlot = vi.fn((name: string) => {
      calls.push(name)
      return createElement('span', { 'data-testid': name })
    })
    const instance = createBoardStore().create()
    const { container } = render(createElement(DashboardCanvas, {
      useStore: (selector: (value: BoardState) => unknown): unknown => selector(board),
      actions: instance.actions,
      renderSlot,
    } as never))
    expect(calls).toEqual(['board.elements', 'board.foreign.windows', 'board.windows'])
    const surface = container.querySelector('[data-surface="canvas-layer"]')
    const markers = [...(surface?.children ?? [])].map(child => child.getAttribute('data-testid'))
    expect(markers).toEqual(['board.elements', 'board.foreign.windows', 'board.windows'])
  })
})

describe('minimap elements', () => {
  it('projects elements in their owner color and covers them with the world frame', () => {
    const board = state({
      boardElements: {
        [NOTE_A as string]: element(NOTE_A, { ownerId: SELF, x: 5_000, y: 5_000, w: 100, h: 100 }),
      },
    })
    const instance = createBoardStore().create()
    const props = {
      useStore: (selector: (value: BoardState) => unknown): unknown => selector(board),
      actions: instance.actions,
      t,
    } as never
    const { container } = render(createElement(Minimap, props))
    const rect = container.querySelector('[data-board-element-rect]')
    expect(rect?.getAttribute('data-board-element-rect')).toBe('note')
    expect(rect?.getAttribute('data-board-owner-color')).toBe('1')
    // The world frame covers the far element, so its projection stays inside
    // the minimap box.
    const x = Number(rect?.getAttribute('x'))
    const y = Number(rect?.getAttribute('y'))
    expect(x).toBeGreaterThanOrEqual(0)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(x).toBeLessThanOrEqual(200)
    expect(y).toBeLessThanOrEqual(140)
  })

  it('projects a foreign window record in its owner color', () => {
    const board = state({
      windowRecords: {
        'agent-remote': {
          id: 'agent-remote' as WindowId,
          hostId: brandString<OwnerId>('owner-remote'),
          ownerId: brandString<OwnerId>('owner-remote'),
          kind: 'agent',
          bodyKind: 'conversation',
          title: null,
          ordinal: 1,
          x: 200,
          y: 200,
          w: 300,
          h: 200,
          z: 10,
          access: { mode: 'owner', people: [] },
          status: 'idle',
          updatedAt: 1,
        },
      },
    })
    const instance = createBoardStore().create()
    const props = {
      useStore: (selector: (value: BoardState) => unknown): unknown => selector(board),
      actions: instance.actions,
      t,
    } as never
    const { container } = render(createElement(Minimap, props))
    const rect = container.querySelector('[data-board-foreign-rect]')
    expect(rect?.getAttribute('data-board-foreign-rect')).toBe('agent')
    // The roster does not know the record's owner, so the neutral color stands.
    expect(rect?.getAttribute('data-board-owner-color')).toBe('unknown')
  })
})
