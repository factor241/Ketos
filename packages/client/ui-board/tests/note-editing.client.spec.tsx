// @vitest-environment jsdom
/**
 * Note editing: the local draft that stream patches and snapshots never
 * overwrite, the 400 ms debounce and its flush points (exit, pagehide, hidden
 * tab), the Escape and IME handling, the Delete guard inside the field, the
 * store's ownership gate, and Enter opening the selected note.
 */
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
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
    participants: [],
    windows: [],
    limits: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 },
  }
}

type BoardInstance = ReturnType<ReturnType<typeof createBoardStore>['create']>

/** One board instance carrying the supplied elements. */
function instanceWith(elements: readonly BoardElement[], noteTextMax = 20_000): BoardInstance {
  const instance = createBoardStore().create()
  instance.actions.applyBoardSnapshot({
    ...snapshot(elements),
    limits: { elementBytesMax: 262_144, noteTextMax, strokePointsMax: 2000, todoItemsMax: 200 },
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

/** Let the promises of the injected patch verb settle. */
async function settle(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
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
  const patchElement = vi.fn(() => Promise.resolve(true))
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

  it('flushes the last text once when Escape interrupts the delay', async () => {
    vi.useFakeTimers()
    const { instance, patchElement, editor } = renderEditing()
    fireEvent.change(editor(), { target: { value: 'zz' } })
    fireEvent.keyDown(editor(), { key: 'Escape' })
    expect(patchElement).toHaveBeenCalledTimes(1)
    expect(patchElement).toHaveBeenCalledWith(ID_A, { data: { text: 'zz' } }, undefined)
    await settle()
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

describe('note editing refused saves', () => {
  it('keeps the editor and the draft when the host refuses the exit flush, and sends the text again on the next exit', async () => {
    vi.useFakeTimers()
    const { instance, patchElement, editor } = renderEditing()
    patchElement.mockResolvedValueOnce(false)
    fireEvent.change(editor(), { target: { value: 'unsaved' } })
    fireEvent.keyDown(editor(), { key: 'Escape' })
    await settle()
    expect(patchElement).toHaveBeenCalledTimes(1)
    expect(instance.getSnapshot().editingBoardElementId).toBe(ID_A)
    expect(editor().value).toBe('unsaved')

    fireEvent.keyDown(editor(), { key: 'Escape' })
    await settle()
    expect(patchElement).toHaveBeenCalledTimes(2)
    expect(patchElement).toHaveBeenLastCalledWith(ID_A, { data: { text: 'unsaved' } }, undefined)
    expect(instance.getSnapshot().editingBoardElementId).toBeNull()
  })

  it('sends the draft again with the next keystroke after a refused debounced write', async () => {
    vi.useFakeTimers()
    const { patchElement, editor } = renderEditing()
    patchElement.mockResolvedValueOnce(false)
    fireEvent.change(editor(), { target: { value: 'ab' } })
    vi.advanceTimersByTime(NOTE_TEXT_WRITE_DEBOUNCE_MS)
    await settle()
    expect(patchElement).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(NOTE_TEXT_WRITE_DEBOUNCE_MS * 3)
    expect(patchElement).toHaveBeenCalledTimes(1)

    fireEvent.change(editor(), { target: { value: 'abc' } })
    vi.advanceTimersByTime(NOTE_TEXT_WRITE_DEBOUNCE_MS)
    expect(patchElement).toHaveBeenCalledTimes(2)
    expect(patchElement).toHaveBeenLastCalledWith(ID_A, { data: { text: 'abc' } }, undefined)
  })

  it('keeps the editor open when the user typed again while the exit flush was in flight', async () => {
    vi.useFakeTimers()
    const { instance, patchElement, editor } = renderEditing()
    let accept: (saved: boolean) => void = () => {}
    patchElement.mockReturnValueOnce(new Promise<boolean>((resolve) => { accept = resolve }))
    fireEvent.change(editor(), { target: { value: 'one' } })
    fireEvent.keyDown(editor(), { key: 'Escape' })
    fireEvent.change(editor(), { target: { value: 'one two' } })
    accept(true)
    await settle()
    expect(instance.getSnapshot().editingBoardElementId).toBe(ID_A)
    expect(editor().value).toBe('one two')
  })

  it('keeps the editor open until a debounced save in flight is answered, and never sends empty text after its refusal', async () => {
    vi.useFakeTimers()
    const { instance, patchElement, view, editor } = renderEditing()
    let answer: (saved: boolean) => void = () => {}
    patchElement.mockReturnValueOnce(new Promise<boolean>((resolve) => { answer = resolve }))
    fireEvent.change(editor(), { target: { value: 'new text' } })
    vi.advanceTimersByTime(NOTE_TEXT_WRITE_DEBOUNCE_MS)
    expect(patchElement).toHaveBeenCalledTimes(1)

    fireEvent.blur(editor())
    await settle()
    expect(instance.getSnapshot().editingBoardElementId).toBe(ID_A)

    answer(false)
    await settle()
    expect(instance.getSnapshot().editingBoardElementId).toBe(ID_A)
    expect(editor().value).toBe('new text')

    view.unmount()
    await settle()
    const texts = patchElement.mock.calls.map(call => (call[1] as { data: { text: string } }).data.text)
    expect(texts).not.toContain('')
    expect(texts.at(-1)).toBe('new text')
  })

  it('closes the editor once a debounced save in flight is accepted', async () => {
    vi.useFakeTimers()
    const { instance, patchElement, editor } = renderEditing()
    let answer: (saved: boolean) => void = () => {}
    patchElement.mockReturnValueOnce(new Promise<boolean>((resolve) => { answer = resolve }))
    fireEvent.change(editor(), { target: { value: 'kept' } })
    vi.advanceTimersByTime(NOTE_TEXT_WRITE_DEBOUNCE_MS)
    fireEvent.blur(editor())
    await settle()
    expect(instance.getSnapshot().editingBoardElementId).toBe(ID_A)

    answer(true)
    await settle()
    expect(patchElement).toHaveBeenCalledTimes(1)
    expect(instance.getSnapshot().editingBoardElementId).toBeNull()
  })
})

describe('note editing unmount', () => {
  it('writes the pending draft and leaves the editing mode when the body unmounts', () => {
    vi.useFakeTimers()
    const { instance, patchElement, view, editor } = renderEditing()
    fireEvent.change(editor(), { target: { value: 'culled' } })
    view.unmount()
    expect(patchElement).toHaveBeenCalledTimes(1)
    expect(patchElement).toHaveBeenCalledWith(ID_A, { data: { text: 'culled' } }, undefined)
    expect(instance.getSnapshot().editingBoardElementId).toBeNull()
    vi.advanceTimersByTime(NOTE_TEXT_WRITE_DEBOUNCE_MS * 2)
    expect(patchElement).toHaveBeenCalledTimes(1)
  })

  it('leaves the editing mode on unmount without a pending draft', () => {
    const { instance, patchElement, view } = renderEditing()
    view.unmount()
    expect(patchElement).not.toHaveBeenCalled()
    expect(instance.getSnapshot().editingBoardElementId).toBeNull()
  })

  it('does not end the edit of another note when a note that is not edited unmounts', () => {
    const idB = brandString<ElementId>('00000000-0000-4000-8000-0000000000a2')
    const noteA = element()
    const noteB = element({ id: idB })
    const instance = instanceWith([noteA, noteB])
    instance.actions.setEditingBoardElement(idB)
    const view = render(createElement(NoteElement, props(instance, noteA, vi.fn(() => Promise.resolve(true)))))
    view.unmount()
    expect(instance.getSnapshot().editingBoardElementId).toBe(idB)
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

  it('keeps the edit of another note when the previously edited note leaves the view in the same commit', async () => {
    const prepared = await createBoardBench()
    runtimes.add(prepared.runtime)
    await prepared.mountBoard()
    const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
    const store = prepared.runtime.storeOf('board.dock') as BoardInstance
    const selfId = prepared.boardDoc.snapshot.selfId
    const idB = brandString<ElementId>('00000000-0000-4000-8000-0000000000a2')
    act(() => { store.actions.setViewport(1000, 800) })
    prepared.boardDoc.publish(snapshot([
      element({ ownerId: selfId, x: 50_000, y: 50_000 }),
      element({ id: idB, ownerId: selfId }),
    ], selfId))
    await waitFor(() => { expect(panel.container.querySelector(`[data-board-element-id="${idB}"]`)).not.toBeNull() })
    expect(panel.container.querySelector(`[data-board-element-id="${ID_A}"]`)).toBeNull()

    act(() => { store.actions.setEditingBoardElement(ID_A) })
    await waitFor(() => { expect(panel.container.querySelector(`[data-board-element-id="${ID_A}"] [data-board-note-editor]`)).not.toBeNull() })
    act(() => { store.actions.setEditingBoardElement(idB) })
    await prepared.runtime.flush()

    expect(panel.container.querySelector(`[data-board-element-id="${ID_A}"]`)).toBeNull()
    expect(store.getSnapshot().editingBoardElementId).toBe(idB)
    expect(panel.container.querySelector(`[data-board-element-id="${idB}"] [data-board-note-editor]`)).not.toBeNull()
  })

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

  it('does not open the selected note when Enter lands on a button', async () => {
    const { panel, store } = await mountedNote()
    const frame = panel.container.querySelector(`[data-board-element-id="${ID_A}"]`) as HTMLElement
    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 5, clientY: 5, button: 0 })
    await waitFor(() => { expect(panel.container.querySelector('[data-board-element-id][data-board-element-selected]')).not.toBeNull() })
    const button = document.createElement('button')
    panel.container.append(button)
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(store.getSnapshot().editingBoardElementId).toBeNull()
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
