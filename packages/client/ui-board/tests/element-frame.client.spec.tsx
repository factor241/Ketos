// @vitest-environment jsdom
/**
 * Element frame: single selection, drag with the 5 px threshold and one
 * operation per gesture, zoom-corrected deltas, the descriptor's resize floor,
 * the foreign element without handles or movement, the Delete guards, and the
 * screen-space selection bar above the element at any zoom.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type {
  BoardDocId, BoardElement, BoardRevision, BoardSnapshot, ElementId, OwnerId,
} from '@ketos/board-doc/types'
import type { KetosPeerId } from '@ketos/peer/types'
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
    windows: [],
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
  renderSlot: (name: string, owner: unknown, opts: { fallback?: unknown } | undefined) => unknown
}> = {}): never {
  return {
    useStore: (selector: (value: BoardState) => unknown): unknown => selector(instance.getSnapshot()),
    actions: instance.actions,
    renderSlot: overrides.renderSlot
      ?? ((_name: string, _owner: unknown, opts: { fallback?: unknown } | undefined) => opts?.fallback ?? null),
    t,
    moveElement: overrides.moveElement ?? vi.fn(),
    resizeElement: overrides.resizeElement ?? vi.fn(),
    removeElement: vi.fn(),
  } as never
}

describe('element stale marks', () => {
  it('marks a foreign element whose owner lost its channel and leaves others alone', () => {
    const instance = instanceWith([element(ID_A, { ownerId: OTHER }), element(ID_B)])
    const peerState = (link: 'online' | 'lost'): never => ({
      self: { selfId: SELF, name: 'Kirill', color: 1 },
      peers: [{ peerId: 'peer-1' as KetosPeerId, selfId: OTHER, name: 'Юрист', color: 2, link }],
      refreshMs: 1000,
    }) as never

    instance.actions.applyPeerState(peerState('lost'))
    const lost = render(createElement(BoardElementLayer, layerProps(instance)))
    const marked = [...lost.container.querySelectorAll('[data-board-element-id]')]
      .filter(frame => frame.querySelector('[data-board-stale]') !== null)
    expect(marked.map(frame => frame.getAttribute('data-board-element-id'))).toEqual([ID_A])
    cleanup()

    instance.actions.applyPeerState(peerState('online'))
    const online = render(createElement(BoardElementLayer, layerProps(instance)))
    expect(online.container.querySelector('[data-board-stale]')).toBeNull()
    cleanup()

    // A deployment without peer networking knows no peer: no marks.
    const alone = instanceWith([element(ID_A, { ownerId: OTHER })])
    const unknown = render(createElement(BoardElementLayer, layerProps(alone)))
    expect(unknown.container.querySelector('[data-board-stale]')).toBeNull()
  })
})

describe('element stale badge reachability', () => {
  it('takes pointer events so its tooltip opens on hover', () => {
    const css = readFileSync(resolve('packages/client/ui-board/src/client/elements/ElementFrame.module.css'), 'utf8')
    const rule = /\.stale\s*\{([^}]*)\}/.exec(css)
    expect(rule?.[1]).toMatch(/pointer-events:\s*auto/)
  })
})

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

  it('starts a resize only from the left button', () => {
    const resizeElement = vi.fn()
    const instance = instanceWith([element(ID_A, { w: 240, h: 160 })])
    const { container } = render(createElement(BoardElementLayer, layerProps(instance, { resizeElement })))
    const handle = container.querySelector(`[data-board-element-id="${ID_A}"] [data-board-element-handle="se"]`)!
    // A secondary press opens the context menu, which swallows its pointerup.
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100, button: 2 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300, clientY: 300 })
    fireEvent.pointerUp(handle, { pointerId: 1, button: 0 })
    expect(resizeElement).not.toHaveBeenCalled()
  })

  it('cancels a resize without an operation when the pointer capture is lost or the pointer is cancelled', () => {
    const resizeElement = vi.fn()
    const instance = instanceWith([element(ID_A, { w: 240, h: 160 })])
    const { container } = render(createElement(BoardElementLayer, layerProps(instance, { resizeElement })))
    const frame = container.querySelector(`[data-board-element-id="${ID_A}"]`) as HTMLElement
    const handle = frame.querySelector('[data-board-element-handle="se"]')!
    for (const end of ['lostPointerCapture', 'pointerCancel'] as const) {
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100, button: 0 })
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 196, clientY: 196 })
      expect(frame.style.width, end).toBe('336px')
      fireEvent[end](frame, { pointerId: 1 })
      expect(frame.style.width, end).toBe('240px')
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300, clientY: 300 })
      fireEvent.pointerUp(handle, { pointerId: 1 })
      expect(frame.style.width, end).toBe('240px')
    }
    expect(resizeElement).not.toHaveBeenCalled()
  })

  it('measures the 5 px drag threshold in screen pixels at any zoom', () => {
    const moveElement = vi.fn()
    const instance = instanceWith([element(ID_A)])
    instance.actions.setZoom(0.25)
    const { container, rerender } = render(createElement(BoardElementLayer, layerProps(instance, { moveElement })))
    const frame = container.querySelector(`[data-board-element-id="${ID_A}"]`)!
    // 3 screen pixels at zoom 0.25 are 12 world units: still a click.
    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 0, clientY: 0, button: 0 })
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 3, clientY: 0, altKey: true })
    fireEvent.pointerUp(frame, { pointerId: 1 })
    expect(moveElement).not.toHaveBeenCalled()

    // 6 screen pixels at zoom 2 are 3 world units: a drag.
    instance.actions.setZoom(2)
    rerender(createElement(BoardElementLayer, layerProps(instance, { moveElement })))
    fireEvent.pointerDown(frame, { pointerId: 2, clientX: 0, clientY: 0, button: 0 })
    fireEvent.pointerMove(frame, { pointerId: 2, clientX: 6, clientY: 0, altKey: true })
    fireEvent.pointerUp(frame, { pointerId: 2 })
    expect(moveElement).toHaveBeenCalledTimes(1)
    expect(moveElement).toHaveBeenCalledWith(ID_A, 3, 0)
  })

  it('starts a move only from the left button', () => {
    const moveElement = vi.fn()
    const instance = instanceWith([element(ID_A)])
    const { container } = render(createElement(BoardElementLayer, layerProps(instance, { moveElement })))
    const frame = container.querySelector(`[data-board-element-id="${ID_A}"]`)!
    for (const button of [1, 2]) {
      fireEvent.pointerDown(frame, { pointerId: button, clientX: 0, clientY: 0, button })
      fireEvent.pointerMove(frame, { pointerId: button, clientX: 100, clientY: 100 })
      fireEvent.pointerUp(frame, { pointerId: button })
    }
    expect(moveElement).not.toHaveBeenCalled()
  })

  it('does not drag the element while the press lands in a text editor inside it', () => {
    const moveElement = vi.fn()
    const instance = instanceWith([element(ID_A)])
    const { container } = render(createElement(BoardElementLayer, layerProps(instance, {
      moveElement,
      renderSlot: () => createElement('textarea', { 'data-testid': 'inner-editor' }),
    })))
    const editor = container.querySelector('[data-testid="inner-editor"]')!
    fireEvent.pointerDown(editor, { pointerId: 1, clientX: 0, clientY: 0, button: 0 })
    fireEvent.pointerMove(editor, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerUp(editor, { pointerId: 1 })
    expect(moveElement).not.toHaveBeenCalled()
    expect(instance.getSnapshot().selectedBoardElementId).toBe(ID_A)
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

describe('element frame keyboard access', () => {
  it('puts the frame and its resize corner in the tab order and selects the element on frame focus', () => {
    const instance = instanceWith([element(ID_A), element(ID_B, { x: 300, ownerId: OTHER })])
    const { container } = render(createElement(BoardElementLayer, layerProps(instance)))
    const own = container.querySelector(`[data-board-element-id="${ID_A}"]`) as HTMLElement
    const foreign = container.querySelector(`[data-board-element-id="${ID_B}"]`) as HTMLElement
    expect(own.getAttribute('tabindex')).toBe('0')
    expect(foreign.getAttribute('tabindex')).toBe('0')
    expect(own.querySelector('[data-board-element-handle]')?.getAttribute('tabindex')).toBe('0')

    fireEvent.focus(foreign)
    expect(instance.getSnapshot().selectedBoardElementId).toBe(ID_B)
    fireEvent.focus(own)
    expect(instance.getSnapshot().selectedBoardElementId).toBe(ID_A)
  })

  it('resizes from the focused corner by one grid step per arrow key down to the kind minimum', () => {
    const resizeElement = vi.fn()
    const instance = instanceWith([element(ID_A, { w: 144, h: 96 })])
    const { container } = render(createElement(BoardElementLayer, layerProps(instance, { resizeElement })))
    const handle = container.querySelector(`[data-board-element-id="${ID_A}"] [data-board-element-handle="se"]`)!
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(resizeElement).toHaveBeenLastCalledWith(ID_A, 168, 96)
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(resizeElement).toHaveBeenLastCalledWith(ID_A, 144, 120)
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    // 144 − 24 = 120 and 96 − 24 = 72 → the note floor of 120×80 clamps the height.
    expect(resizeElement).toHaveBeenNthCalledWith(3, ID_A, 120, 96)
    expect(resizeElement).toHaveBeenNthCalledWith(4, ID_A, 144, 80)
    fireEvent.keyDown(handle, { key: 'Enter' })
    expect(resizeElement).toHaveBeenCalledTimes(4)
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

  it('keeps the element when a button or a button role holds focus', async () => {
    const { panel, store } = await mounted()
    const button = document.createElement('button')
    const roleButton = document.createElement('div')
    roleButton.setAttribute('role', 'button')
    const nested = document.createElement('span')
    button.append(nested)
    panel.container.append(button, roleButton)

    for (const target of [button, nested, roleButton]) {
      fireEvent.keyDown(target, { key: 'Delete' })
      fireEvent.keyDown(target, { key: 'Backspace' })
    }
    expect(store.getSnapshot().boardElements[ID_A]).toBeDefined()
  })

  it('leaves Space to a focused button so the keyboard still opens its menu', async () => {
    const { panel } = await mounted()
    const button = document.createElement('button')
    panel.container.append(button)
    // fireEvent returns false when a listener called preventDefault.
    expect(fireEvent.keyDown(button, { key: ' ', code: 'Space' })).toBe(true)
    expect(fireEvent.keyDown(document.body, { key: ' ', code: 'Space' })).toBe(false)
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
