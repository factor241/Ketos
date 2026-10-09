// @vitest-environment jsdom
/**
 * Foreign chat card inside the mounted board: the board-level keyboard and
 * pointer handlers must leave the card's transcript controls and list alone,
 * so a key or a press there never deletes, edits, draws, erases, or pans.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type {
  BoardDocId, BoardElement, BoardOp, BoardRevision, BoardSnapshot, BoardWindowRecord, ElementId, OwnerId, WindowId,
  WindowSessionId,
} from '@ketos/board-doc/types'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { createBoardStore } from '../src/client/store.ts'
import { createBoardBench, createBoardDocDouble } from './fixtures.client.ts'

beforeAll(() => {
  // jsdom implements no pointer capture; the gestures only need their deltas.
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true, writable: true })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { value: () => {}, configurable: true, writable: true })
})

const runtimes = new Set<SlotTestRuntime>()
afterEach(async () => {
  cleanup()
  for (const runtime of runtimes) await runtime.dispose()
  runtimes.clear()
})
afterAll(() => { runtimes.clear() })

type BoardInstance = ReturnType<ReturnType<typeof createBoardStore>['create']>

const DOC = brandString<BoardDocId>('00000000-0000-4000-8000-0000000000d3')
const SELF = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e1')
const OTHER = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e2')
const NOTE = brandString<ElementId>('00000000-0000-4000-8000-0000000000a1')
const STROKE = brandString<ElementId>('00000000-0000-4000-8000-0000000000a2')

/** The own note the tests select. */
const note: BoardElement = {
  id: NOTE, kind: 'note', ownerId: SELF, x: 0, y: 0, w: 240, h: 160, z: 1, data: {}, createdAt: 1, updatedAt: 1,
}

/** An own stroke under the foreign card, for the eraser. */
const stroke: BoardElement = {
  id: STROKE,
  kind: 'stroke',
  ownerId: SELF,
  x: 20,
  y: 20,
  w: 200,
  h: 20,
  z: 1,
  data: { points: [[0, 10, 0.5], [200, 10, 0.5]], width: 'm', pen: false },
  createdAt: 1,
  updatedAt: 1,
}

/** A foreign agent window with a session. */
const foreign: BoardWindowRecord = {
  id: brandString<WindowId>('agent-1-remote'),
  hostId: OTHER,
  ownerId: OTHER,
  kind: 'agent',
  bodyKind: 'conversation',
  title: 'Ревью',
  ordinal: 1,
  x: 24,
  y: 24,
  w: 552,
  h: 648,
  z: 10,
  access: { mode: 'owner', people: [] },
  status: 'ready',
  updatedAt: Date.now(),
  sessionId: brandString<WindowSessionId>('session-1'),
}

/** Snapshot with the own element, the foreign window, and both participants. */
function snapshot(elements: readonly BoardElement[]): BoardSnapshot {
  return {
    docId: DOC,
    selfId: SELF,
    revision: brandNumber<BoardRevision>(1),
    elements,
    participants: [
      { id: SELF, name: 'Kirill', color: 1, updatedAt: 1 },
      { id: OTHER, name: 'Юрист', color: 3, updatedAt: 1 },
    ],
    windows: [foreign],
    limits: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 },
  }
}

/** Transcript route answer; every other route reaches the board double first. */
const transcriptFetch: typeof fetch = async () => Response.json({
  messages: [{ role: 'agent', text: 'Hello', at: '2026-10-09T10:00:00.000Z' }],
})

/**
 * Mount the board with the elements and the foreign card, optionally arm a tool.
 * @param elements - own elements on the board.
 * @param tool - the drawing tool to arm, if any.
 * @returns the panel, the store, and the recorded operations.
 */
async function mounted(elements: readonly BoardElement[], tool?: 'brush' | 'eraser') {
  const boardDoc = createBoardDocDouble(undefined, transcriptFetch)
  const prepared = await createBoardBench({ boardDoc })
  runtimes.add(prepared.runtime)
  await prepared.mountBoard()
  const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
  const store = prepared.runtime.storeOf('board.dock') as BoardInstance
  boardDoc.publish(snapshot(elements))
  await waitFor(() => { expect(panel.container.querySelector('[data-board-foreign-card="agent"]')).not.toBeNull() })
  if (tool !== undefined) {
    act(() => { store.actions.setTool(tool) })
    await prepared.runtime.flush()
  }
  return { prepared, panel, store, boardDoc }
}

/** Operations of one kind the document double recorded. */
function ops(boardDoc: { readonly ops: readonly (readonly BoardOp[])[] }, kind: BoardOp['op']): readonly BoardOp[] {
  return boardDoc.ops.flat().filter(op => op.op === kind)
}

/** One primary-button mouse sample. */
function sample(x: number, y: number) {
  return { pointerId: 1, clientX: x, clientY: y, pointerType: 'mouse', button: 0, isPrimary: true }
}

describe('foreign card keyboard', () => {
  /** Select the own note, then open the transcript. */
  async function selectedWithTranscript() {
    const context = await mounted([note])
    const boardRoot = context.panel.container.querySelector('[data-surface="board"]') as HTMLElement
    fireEvent.pointerEnter(boardRoot)
    const frame = context.panel.container.querySelector(`[data-board-element-id="${NOTE}"]`) as HTMLElement
    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 5, clientY: 5, button: 0 })
    await waitFor(() => {
      expect(context.panel.container.querySelector(`[data-board-element-id="${NOTE}"][data-board-element-selected]`)).not.toBeNull()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    const list = await screen.findByRole('list', { name: 'Window transcript' })
    return { ...context, list }
  }

  it('keeps the selected own element when Delete or Backspace reaches the transcript list', async () => {
    const { store, list } = await selectedWithTranscript()
    fireEvent.keyDown(list, { key: 'Backspace' })
    fireEvent.keyDown(list, { key: 'Delete' })
    expect(store.getSnapshot().boardElements[NOTE]).toBeDefined()
  })

  it('does not open the selected own note for editing when Enter reaches the list or Refresh', async () => {
    const { store, list } = await selectedWithTranscript()
    fireEvent.keyDown(list, { key: 'Enter' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Refresh' }), { key: 'Enter' })
    expect(store.getSnapshot().editingBoardElementId).toBeNull()
  })

  it('still arms panning for Space on a focused element inside a local window', async () => {
    const { panel } = await selectedWithTranscript()
    const localWindow = document.createElement('div')
    localWindow.setAttribute('data-board-window', '')
    const focusable = document.createElement('div')
    focusable.tabIndex = 0
    localWindow.append(focusable)
    panel.container.append(localWindow)
    // fireEvent returns false when a listener called preventDefault.
    expect(fireEvent.keyDown(focusable, { key: ' ', code: 'Space' })).toBe(false)
  })

  it('leaves Space on the focused list to the list', async () => {
    const { list } = await selectedWithTranscript()
    // fireEvent returns false when a listener called preventDefault.
    expect(fireEvent.keyDown(list, { key: ' ', code: 'Space' })).toBe(true)
  })
})

describe('foreign card pointer with a drawing tool armed', () => {
  it('draws nothing when the brush presses on the transcript controls or the list', async () => {
    const { prepared, boardDoc } = await mounted([], 'brush')
    const show = screen.getByRole('button', { name: 'Show transcript' })
    fireEvent.pointerDown(show, sample(100, 100))
    fireEvent.pointerMove(show, sample(160, 140))
    fireEvent.pointerUp(show, { pointerId: 1 })
    fireEvent.click(show)
    const list = await screen.findByRole('list', { name: 'Window transcript' })
    for (const target of [list, screen.getByRole('button', { name: 'Refresh' })]) {
      fireEvent.pointerDown(target, sample(100, 100))
      fireEvent.pointerMove(target, sample(160, 140))
      fireEvent.pointerUp(target, { pointerId: 1 })
    }
    await prepared.runtime.flush()
    expect(ops(boardDoc, 'create')).toHaveLength(0)
  })

  it('erases nothing when the eraser presses and sweeps over the transcript controls', async () => {
    const { prepared, boardDoc } = await mounted([stroke], 'eraser')
    const show = screen.getByRole('button', { name: 'Show transcript' })
    fireEvent.pointerDown(show, sample(30, 30))
    fireEvent.pointerMove(show, sample(200, 30))
    fireEvent.pointerUp(show, { pointerId: 1 })
    await prepared.runtime.flush()
    expect(ops(boardDoc, 'remove')).toHaveLength(0)
    expect(ops(boardDoc, 'create')).toHaveLength(0)
  })

  it('still lets the brush draw from the canvas outside the card', async () => {
    const { boardDoc, panel } = await mounted([], 'brush')
    const canvas = panel.container.querySelector('[data-surface="canvas"]') as HTMLElement
    fireEvent.pointerDown(canvas, sample(900, 500))
    fireEvent.pointerMove(canvas, sample(940, 520))
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    await waitFor(() => { expect(ops(boardDoc, 'create')).toHaveLength(1) })
  })
})

describe('foreign card pointer with the select tool', () => {
  it('regression control: a select-tool press on a transcript control does not pan, with or without the window guard', async () => {
    const { prepared, store } = await mounted([])
    const show = screen.getByRole('button', { name: 'Show transcript' })
    fireEvent.pointerDown(show, sample(100, 100))
    fireEvent.pointerMove(show, sample(180, 160))
    fireEvent.pointerUp(show, { pointerId: 1 })
    await prepared.runtime.flush()
    expect(store.getSnapshot().panX).toBe(0)
    expect(store.getSnapshot().panY).toBe(0)
  })
})
