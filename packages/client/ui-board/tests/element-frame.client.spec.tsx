// @vitest-environment jsdom
/**
 * Element frame: single selection, drag with the 5 px threshold and one
 * operation per gesture, zoom-corrected deltas, the descriptor's resize floor,
 * the foreign element without handles or movement, the Delete guards, and the
 * screen-space selection bar above the element at any zoom.
 */
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type {
  BoardDocId, BoardElement, BoardRevision, BoardSnapshot, ElementId, OwnerId,
} from '@ketos/board-doc/types'
import { ElementSelectionBar } from '../src/client/ElementSelectionBar.tsx'
import { BoardElementLayer } from '../src/client/elements/BoardElementLayer.tsx'
import { createBoardStore, type BoardState } from '../src/client/store.ts'
import { en, type BoardKey, type BoardTranslate } from '../src/client/locale.ts'
import { createBoardBench, type BoardBenchOptions } from './fixtures.client.ts'
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

const DOC = brandString<BoardDocId>('00000000-0000-4000-8000-0000000000d1')
const SELF = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e1')
const OTHER = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e2')
const ID_A = brandString<ElementId>('00000000-0000-4000-8000-0000000000a1')
const ID_B = brandString<ElementId>('00000000-0000-4000-8000-0000000000a2')

/** English-bound locale seat for the direct component renders. */
const t: BoardTranslate = key => en[key as BoardKey]

/** One element with test overrides. */
function element(id: ElementId, overrides: Partial<BoardElement> = {}): BoardElement {
  return {
    id,
    kind: 'note',
    ownerId: SELF,
    x: 0,
    y: 0,
    w: 240,
    h: 160,
    z: 1,
    data: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

/** One snapshot with test overrides. */
function snapshot(elements: readonly BoardElement[], selfId: OwnerId = SELF): BoardSnapshot {
  return {
    docId: DOC,
    selfId,
    revision: brandNumber<BoardRevision>(1),
    elements,
    participants: [],
    limits: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 },
  }
}

type BoardInstance = ReturnType<ReturnType<typeof createBoardStore>['create']>

/** One board instance carrying the supplied elements. */
function instanceWith(elements: readonly BoardElement[]): BoardInstance {
  const instance = createBoardStore().create()
  instance.actions.applyBoardSnapshot(snapshot(elements))
  return instance
}

/**
 * Layer props over one instance; the store seat reads the live snapshot so
 * store-driven selection and previews render.
 * @param instance - the board instance.
 * @param overrides - injected element verbs to replace.
 * @returns the props.
 */
function layerProps(instance: BoardInstance, overrides: Partial<{
  moveElement: (id: ElementId, x: number, y: number) => void
  resizeElement: (id: ElementId, width: number, height: number) => void
}> = {}): never {
  return {
    useStore: (selector: (value: BoardState) => unknown): unknown => selector(instance.getSnapshot()),
    actions: instance.actions,
    renderSlot: (_name: string, _owner: unknown, opts: { fallback?: unknown } | undefined) => opts?.fallback ?? null,
    t,
    moveElement: overrides.moveElement ?? vi.fn(),
    resizeElement: overrides.resizeElement ?? vi.fn(),
    removeElement: vi.fn(),
  } as never
}

describe('element frame selection and drag', () => {
  it('selects one element at a time', () => {
    const instance = instanceWith([element(ID_A), element(ID_B, { x: 300 })])
    const view = render(createElement(BoardElementLayer, layerProps(instance)))
    const frames = [...view.container.querySelectorAll('[data-board-element-id]')]
    fireEvent.pointerDown(frames[0]!, { pointerId: 1, clientX: 10, clientY: 10, button: 0 })
    expect(instance.getSnapshot().selectedBoardElementId).toBe(ID_A)
    fireEvent.pointerDown(frames[1]!, { pointerId: 2, clientX: 310, clientY: 10, button: 0 })
    expect(instance.getSnapshot().selectedBoardElementId).toBe(ID_B)
    // The direct render has no store subscription; re-render to see the store.
    view.rerender(createElement(BoardElementLayer, layerProps(instance)))
    expect(view.container.querySelector(`[data-board-element-id="${ID_B}"]`)?.getAttribute('data-board-element-selected')).toBe('')
    expect(view.container.querySelector(`[data-board-element-id="${ID_A}"]`)?.getAttribute('data-board-element-selected')).toBeNull()
  })

  it('commits one move on pointerup and none for a click without travel', () => {
    const moveElement = vi.fn()
    const instance = instanceWith([element(ID_A)])
    const { container } = render(createElement(BoardElementLayer, layerProps(instance, { moveElement })))
    const frame = container.querySelector(`[data-board-element-id="${ID_A}"]`)!

    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 100, clientY: 100, button: 0 })
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 103, clientY: 102 })
    fireEvent.pointerUp(frame, { pointerId: 1 })
    expect(moveElement).not.toHaveBeenCalled()

    fireEvent.pointerDown(frame, { pointerId: 2, clientX: 100, clientY: 100, button: 0 })
    fireEvent.pointerMove(frame, { pointerId: 2, clientX: 140, clientY: 140 })
    fireEvent.pointerUp(frame, { pointerId: 2 })
    expect(moveElement).toHaveBeenCalledTimes(1)
    // Grid snap without Alt: 40 world units round to 48.
    expect(moveElement).toHaveBeenCalledWith(ID_A, 48, 48)
  })

  it('divides the pointer delta by the zoom and skips the grid while Alt is held', () => {
    const moveElement = vi.fn()
    const instance = instanceWith([element(ID_A)])
    instance.actions.setZoom(0.5)
    const { container } = render(createElement(BoardElementLayer, layerProps(instance, { moveElement })))
    const frame = container.querySelector(`[data-board-element-id="${ID_A}"]`)!
    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 0, clientY: 0, button: 0 })
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 40, clientY: 20, altKey: true })
    fireEvent.pointerUp(frame, { pointerId: 1 })
    expect(moveElement).toHaveBeenCalledWith(ID_A, 80, 40)
  })

  it('resizes from the corner down to the kind minimum', () => {
    const resizeElement = vi.fn()
    const instance = instanceWith([element(ID_A, { w: 100, h: 70 })])
    const { container } = render(createElement(BoardElementLayer, layerProps(instance, { resizeElement })))
    const handle = container.querySelector(`[data-board-element-id="${ID_A}"] [data-board-element-handle="se"]`)!
    fireEvent.pointerDown(handle, { pointerId: 3, clientX: 100, clientY: 100, button: 0 })
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: -400, clientY: -400 })
    fireEvent.pointerUp(handle, { pointerId: 3 })
    expect(resizeElement).toHaveBeenCalledTimes(1)
    // The note floor is 120×80.
    expect(resizeElement).toHaveBeenCalledWith(ID_A, 120, 80)
  })

  it('selects a foreign element but offers no handle and no move', () => {
    const moveElement = vi.fn()
    const instance = instanceWith([element(ID_A, { ownerId: OTHER })])
    const { container } = render(createElement(BoardElementLayer, layerProps(instance, { moveElement })))
    const frame = container.querySelector(`[data-board-element-id="${ID_A}"]`)!
    expect(frame.getAttribute('data-board-element-editable')).toBeNull()
    expect(frame.querySelector('[data-board-element-handle]')).toBeNull()
    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 0, clientY: 0, button: 0 })
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerUp(frame, { pointerId: 1 })
    expect(moveElement).not.toHaveBeenCalled()
    expect(instance.getSnapshot().selectedBoardElementId).toBe(ID_A)
  })
})

describe('element selection bar', () => {
  it('stands above the element at zoom 0.2 and 2', () => {
    for (const zoom of [0.2, 2]) {
      const instance = instanceWith([element(ID_A, { x: 100, y: 50 })])
      instance.actions.setZoom(zoom)
      instance.actions.selectBoardElement(ID_A)
      const { container, unmount } = render(createElement(ElementSelectionBar, {
        useStore: (selector: (value: BoardState) => unknown): unknown => selector(instance.getSnapshot()),
        actions: instance.actions,
        t,
        renderToolbar: () => createElement('span', { 'data-testid': 'toolbar' }),
      } as never))
      const bar = container.querySelector('[data-board-element-bar]')
      expect(bar, `zoom ${String(zoom)}`).not.toBeNull()
      const top = Number.parseFloat((bar as HTMLElement).style.top)
      const left = Number.parseFloat((bar as HTMLElement).style.left)
      expect(left).toBeCloseTo(100 * zoom, 5)
      expect(top).toBeLessThan(50 * zoom)
      unmount()
    }
  })
})

describe('element delete guards', () => {
  /**
   * Mount the board with one element owned by the bench's local identity.
   * @param options - bench options.
   * @returns the panel, the store, and the document double.
   */
  async function mounted(options: BoardBenchOptions = {}) {
    const prepared = await createBoardBench(options)
    runtimes.add(prepared.runtime)
    await prepared.mountBoard()
    const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
    const store = prepared.runtime.storeOf('board.dock') as BoardInstance
    const selfId = prepared.boardDoc.snapshot.selfId
    prepared.boardDoc.publish(snapshot([element(ID_A, { ownerId: selfId })], selfId))
    await waitFor(() => { expect(panel.container.querySelector(`[data-board-element-id="${ID_A}"]`)).not.toBeNull() })
    const boardRoot = panel.container.querySelector('[data-surface="board"]') as HTMLElement
    // jsdom fires no pointerenter; the board root tracks the pointer this way.
    fireEvent.pointerEnter(boardRoot)
    const frame = panel.container.querySelector(`[data-board-element-id="${ID_A}"]`) as HTMLElement
    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 5, clientY: 5, button: 0 })
    // The Delete handler reads the rendered selection; wait until the board
    // re-rendered with the selected element before sending the key.
    await waitFor(() => {
      expect(panel.container.querySelector(`[data-board-element-id="${ID_A}"][data-board-element-selected]`)).not.toBeNull()
    })
    return { prepared, panel, store, frame }
  }

  it('deletes the selected own element on Delete and posts one remove', async () => {
    const { prepared, store } = await mounted()
    fireEvent.keyDown(document.body, { key: 'Delete' })
    await waitFor(() => { expect(store.getSnapshot().boardElements[ID_A]).toBeUndefined() })
    await waitFor(() => {
      expect(prepared.boardDoc.ops.some(batch => batch.some(op => op.op === 'remove' && op.id === ID_A))).toBe(true)
    })
  })

  it('keeps the element when a window input or an element textarea holds focus', async () => {
    const { panel, store, frame } = await mounted()
    const windowBox = document.createElement('div')
    windowBox.setAttribute('data-board-window', '')
    const windowInput = document.createElement('input')
    windowBox.append(windowInput)
    panel.container.append(windowBox)
    const textarea = document.createElement('textarea')
    frame.append(textarea)

    fireEvent.keyDown(windowInput, { key: 'Delete' })
    fireEvent.keyDown(textarea, { key: 'Delete' })
    expect(store.getSnapshot().boardElements[ID_A]).toBeDefined()
  })

  it('keeps the element when a window surface or an open menu holds focus', async () => {
    const { panel, store } = await mounted()
    const windowBox = document.createElement('div')
    windowBox.setAttribute('data-board-window', '')
    const windowSurface = document.createElement('div')
    windowBox.append(windowSurface)
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    const menuItem = document.createElement('div')
    menu.append(menuItem)
    panel.container.append(windowBox, menu)

    fireEvent.keyDown(windowSurface, { key: 'Delete' })
    fireEvent.keyDown(menuItem, { key: 'Delete' })
    expect(store.getSnapshot().boardElements[ID_A]).toBeDefined()
  })

  it('keeps a foreign element and stands down while the inspector selects', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    await prepared.mountBoard()
    const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
    const store = prepared.runtime.storeOf('board.dock') as BoardInstance
    prepared.boardDoc.publish(snapshot([element(ID_A, { ownerId: OTHER })]))
    await waitFor(() => { expect(panel.container.querySelector(`[data-board-element-id="${ID_A}"]`)).not.toBeNull() })
    const frame = panel.container.querySelector(`[data-board-element-id="${ID_A}"]`) as HTMLElement
    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 5, clientY: 5, button: 0 })
    fireEvent.keyDown(document.body, { key: 'Backspace' })
    expect(store.getSnapshot().boardElements[ID_A]).toBeDefined()

    store.actions.setSelectingElement(true)
    fireEvent.keyDown(document.body, { key: 'Delete' })
    expect(store.getSnapshot().boardElements[ID_A]).toBeDefined()
  })
})
