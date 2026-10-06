// @vitest-environment jsdom
/**
 * Note editing: the local draft that stream patches and snapshots never
 * overwrite, the 400 ms debounce and its flush points (exit, pagehide, hidden
 * tab), the Escape and IME handling, the Delete guard inside the field, the
 * store's ownership gate, and Enter opening the selected note.
 */
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type {
  BoardDocId, BoardElement, BoardRevision, BoardSnapshot, ElementId, OwnerId,
} from '@ketos/board-doc/types'
import { NoteElement, NOTE_TEXT_WRITE_DEBOUNCE_MS } from '../src/client/elements/NoteElement.tsx'
import { createBoardStore, type BoardState } from '../src/client/store.ts'
import { en, type BoardKey, type BoardTranslate } from '../src/client/locale.ts'
import { createBoardBench, type BoardBenchOptions } from './fixtures.client.ts'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true, writable: true })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { value: () => {}, configurable: true, writable: true })
})

const runtimes = new Set<SlotTestRuntime>()
afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  for (const runtime of runtimes) await runtime.dispose()
  runtimes.clear()
})

const DOC = brandString<BoardDocId>('00000000-0000-4000-8000-0000000000d1')
const SELF = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e1')
const OTHER = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e2')
const ID_A = brandString<ElementId>('00000000-0000-4000-8000-0000000000a1')

/** English-bound locale seat for the direct renders. */
const t: BoardTranslate = key => en[key as BoardKey]

/** One valid note element with test overrides. */
function element(overrides: Partial<BoardElement> = {}): BoardElement {
  return {
    id: ID_A,
    kind: 'note',
    ownerId: SELF,
    x: 0,
    y: 0,
    w: 240,
    h: 160,
    z: 1,
    data: { text: 'stored', font: 'sans', size: 'm', scale: 1 },
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
    limits: { elementBytesMax: 262_144, noteTextMax: 20_000 },
  }
}

type BoardInstance = ReturnType<ReturnType<typeof createBoardStore>['create']>

/** One board instance carrying the supplied elements. */
function instanceWith(elements: readonly BoardElement[], noteTextMax = 20_000): BoardInstance {
  const instance = createBoardStore().create()
  instance.actions.applyBoardSnapshot({
    ...snapshot(elements),
    limits: { elementBytesMax: 262_144, noteTextMax },
  })
  return instance
}

/**
 * Direct-render props for the note body.
 * @param instance - board instance backing the store seat.
 * @param note - element to render.
 * @param patchElement - injected patch verb stub.
 * @returns the props.
 */
function props(
  instance: BoardInstance,
  note: BoardElement,
  patchElement: ReturnType<typeof vi.fn>,
): never {
  return {
    element: note,
    selected: true,
    editable: true,
    useStore: (selector: (value: BoardState) => unknown): unknown => selector(instance.getSnapshot()),
    actions: instance.actions,
    t,
    patchElement,
  } as never
}

/** Render the note body with its store already in editing mode. */
function renderEditing(noteTextMax = 20_000): {
  instance: BoardInstance
  patchElement: ReturnType<typeof vi.fn>
  view: ReturnType<typeof render>
  editor: () => HTMLTextAreaElement
} {
  const note = element()
  const instance = instanceWith([note], noteTextMax)
  instance.actions.setEditingBoardElement(ID_A)
  const patchElement = vi.fn()
  const view = render(createElement(NoteElement, props(instance, note, patchElement)))
  return {
    instance,
    patchElement,
    view,
    editor: () => view.container.querySelector('[data-board-note-editor]') as HTMLTextAreaElement,
  }
}

describe('note editing draft and debounce', () => {
  it('writes one operation 400 ms after the last of five keystrokes', () => {
    vi.useFakeTimers()
    const { patchElement, editor } = renderEditing()
    const field = editor()
    for (const value of ['a', 'ab', 'abc', 'abcd']) {
      fireEvent.change(field, { target: { value } })
      vi.advanceTimersByTime(60)
    }
    fireEvent.change(editor(), { target: { value: 'abcde' } })
    vi.advanceTimersByTime(NOTE_TEXT_WRITE_DEBOUNCE_MS - 1)
    expect(patchElement).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(patchElement).toHaveBeenCalledTimes(1)
    expect(patchElement).toHaveBeenCalledWith(ID_A, { data: { text: 'abcde' } }, undefined)
  })

  it('flushes the last text once when Escape interrupts the delay', () => {
    vi.useFakeTimers()
    const { instance, patchElement, editor } = renderEditing()
    fireEvent.change(editor(), { target: { value: 'zz' } })
    fireEvent.keyDown(editor(), { key: 'Escape' })
    expect(patchElement).toHaveBeenCalledTimes(1)
    expect(patchElement).toHaveBeenCalledWith(ID_A, { data: { text: 'zz' } }, undefined)
    vi.advanceTimersByTime(NOTE_TEXT_WRITE_DEBOUNCE_MS * 2)
    expect(patchElement).toHaveBeenCalledTimes(1)
    expect(instance.getSnapshot().editingBoardElementId).toBeNull()
  })

  it('keeps the draft and the caret when the stored text changes during the edit', () => {
    vi.useFakeTimers()
    const { instance, patchElement, view, editor } = renderEditing()
    const field = editor()
    fireEvent.change(field, { target: { value: 'abc' } })
    field.selectionStart = 2
    view.rerender(createElement(NoteElement, props(instance, element({ data: { text: 'older', font: 'sans', size: 'm', scale: 1 } }), patchElement)))
    expect(editor().value).toBe('abc')
    expect(editor().selectionStart).toBe(2)
    expect(patchElement).not.toHaveBeenCalled()
  })

  it('keeps the edit when Escape belongs to an IME composition', () => {
    vi.useFakeTimers()
    const { instance, patchElement, editor } = renderEditing()
    fireEvent.change(editor(), { target: { value: 'nihao' } })
    fireEvent.keyDown(editor(), { key: 'Escape', isComposing: true })
    expect(patchElement).not.toHaveBeenCalled()
    expect(instance.getSnapshot().editingBoardElementId).toBe(ID_A)
  })

  it('flushes with keepalive on pagehide and on a hidden tab', () => {
    vi.useFakeTimers()
    const { patchElement, editor } = renderEditing()
    fireEvent.change(editor(), { target: { value: 'bye' } })
    fireEvent(window, new Event('pagehide'))
    expect(patchElement).toHaveBeenCalledWith(ID_A, { data: { text: 'bye' } }, { keepalive: true })
    patchElement.mockClear()
    vi.advanceTimersByTime(NOTE_TEXT_WRITE_DEBOUNCE_MS * 2)
    expect(patchElement).not.toHaveBeenCalled()

    fireEvent.change(editor(), { target: { value: 'bye2' } })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    fireEvent(document, new Event('visibilitychange'))
    expect(patchElement).toHaveBeenCalledWith(ID_A, { data: { text: 'bye2' } }, { keepalive: true })
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  it('caps the editor at the published text bound', () => {
    const { editor } = renderEditing(512)
    expect(editor().maxLength).toBe(512)
  })
})

describe('note editing integration', () => {
  /**
   * Mount the board over one valid note and open its editor.
   * @param options - bench options.
   * @param ownedBySelf - whether the note belongs to the local identity.
   * @returns the bench, panel, store, and the note's id.
   */
  async function mountedNote(options: BoardBenchOptions = {}, ownedBySelf = true) {
    const prepared = await createBoardBench(options)
    runtimes.add(prepared.runtime)
    await prepared.mountBoard()
    const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
    const store = prepared.runtime.storeOf('board.dock') as BoardInstance
    const selfId = prepared.boardDoc.snapshot.selfId
    prepared.boardDoc.publish(snapshot([element({ ownerId: ownedBySelf ? selfId : OTHER })], selfId))
    await waitFor(() => { expect(panel.container.querySelector('[data-board-note]')).not.toBeNull() })
    const boardRoot = panel.container.querySelector('[data-surface="board"]') as HTMLElement
    fireEvent.pointerEnter(boardRoot)
    return { prepared, panel, store, boardRoot }
  }

  it('keeps the note when Backspace is pressed inside its field', async () => {
    const { prepared, panel, store } = await mountedNote()
    fireEvent.doubleClick(panel.container.querySelector('[data-board-note]')!)
    await waitFor(() => { expect(panel.container.querySelector('[data-board-note-editor]')).not.toBeNull() })
    const editor = panel.container.querySelector('[data-board-note-editor]')!
    fireEvent.change(editor, { target: { value: 'edited' } })
    fireEvent.keyDown(editor, { key: 'Backspace' })
    expect(store.getSnapshot().boardElements[ID_A]).toBeDefined()
    expect(prepared.boardDoc.ops.some(batch => batch.some(op => op.op === 'remove'))).toBe(false)
  })

  it('opens the selected note for editing with Enter', async () => {
    const { panel, store } = await mountedNote()
    const frame = panel.container.querySelector(`[data-board-element-id="${ID_A}"]`) as HTMLElement
    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 5, clientY: 5, button: 0 })
    await waitFor(() => { expect(panel.container.querySelector('[data-board-element-id][data-board-element-selected]')).not.toBeNull() })
    fireEvent.keyDown(document.body, { key: 'Enter' })
    await waitFor(() => { expect(store.getSnapshot().editingBoardElementId).toBe(ID_A) })
    await waitFor(() => { expect(panel.container.querySelector('[data-board-note-editor]')).not.toBeNull() })
  })

  it('does not open a foreign note on double click or Enter', async () => {
    const { panel, store } = await mountedNote({}, false)
    fireEvent.doubleClick(panel.container.querySelector('[data-board-note]')!)
    expect(store.getSnapshot().editingBoardElementId).toBeNull()

    const frame = panel.container.querySelector(`[data-board-element-id="${ID_A}"]`) as HTMLElement
    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 5, clientY: 5, button: 0 })
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(store.getSnapshot().editingBoardElementId).toBeNull()
    expect(panel.container.querySelector('[data-board-note-editor]')).toBeNull()
  })
})
