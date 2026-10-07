// @vitest-environment jsdom
/**
 * Tool mode: the brush and eraser controls and their exclusivity with the
 * inspector and the note editor, the canvas routing that draws instead of
 * panning, the gestures the tool mode must not break (Space, middle button,
 * Ctrl+wheel), and the tool rung of the Escape ladder.
 */
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { BoardDocId, BoardRevision, OwnerId } from '@ketos/board-doc/types'
import type { WindowId } from '../src/client/contract/slots.ts'
import { createBoardStore, type BoardState, type BoardStoreInstance } from '../src/client/store.ts'
import { BOARD_SETTINGS_VERSION, type BoardLayoutDocument } from '../src/board-settings.ts'
import { DashboardCanvas, type DashboardCanvasProps } from '../src/client/canvas/DashboardCanvas.tsx'
import { createBoardBench, t, type BoardBench } from './fixtures.client.ts'
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

const DOC = brandString<BoardDocId>('00000000-0000-4000-8000-0000000000d1')
const SELF = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e1')

/** A fresh board store instance with the snapshot's identity and limits adopted. */
function store(): BoardStoreInstance {
  const instance = createBoardStore().create()
  instance.actions.applyBoardSnapshot({
    docId: DOC,
    selfId: SELF,
    revision: brandNumber<BoardRevision>(1),
    elements: [],
    limits: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000 },
  })
  return instance
}

/** One stored layout with no windows, for the hydrate check. */
function layout(): BoardLayoutDocument {
  return {
    version: BOARD_SETTINGS_VERSION,
    panX: 0,
    panY: 0,
    zoom: 1,
    windows: [],
    windowOrder: [],
    dockOrder: [],
    cloneOrder: [],
    activeWindowId: '',
    panelGroupBy: 'workspace',
    panelOrderBy: 'updated',
    defaultPreset: '',
  }
}

/** Bench with the board panel mounted. */
async function bench(): Promise<{
  runtime: SlotTestRuntime
  panel: { container: HTMLElement }
  store: BoardInstance
  boardDoc: BoardBench['boardDoc']
}> {
  const prepared = await createBoardBench({ session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) } })
  runtimes.add(prepared.runtime)
  await prepared.mountBoard()
  const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
  const instance = prepared.runtime.storeOf('board.dock') as BoardInstance
  return { runtime: prepared.runtime, panel, store: instance, boardDoc: prepared.boardDoc }
}

/** One window literal the tool tests open. */
function windowState(id: WindowId) {
  return { id, kind: 'agent', bodyKind: 'conversation', ordinal: 1, width: 552, height: 648 } as const
}

describe('tool mode store', () => {
  it('keeps brush, eraser, inspector, and note editing mutually exclusive', () => {
    const instance = store()
    instance.actions.setSelectingElement(true)
    instance.actions.setTool('brush')
    expect(instance.getSnapshot().tool).toBe('brush')
    expect(instance.getSnapshot().isSelectingElement).toBe(false)

    instance.actions.setSelectingElement(true)
    expect(instance.getSnapshot().tool).toBe('select')

    instance.actions.setTool('eraser')
    expect(instance.getSnapshot().editingBoardElementId).toBeNull()
    expect(instance.getSnapshot().tool).toBe('eraser')

    instance.actions.setBrushWidth('l')
    expect(instance.getSnapshot().brushWidth).toBe('l')
  })

  it('leaves the tool and thickness out of the persisted layout', () => {
    const instance = store()
    instance.actions.setTool('brush')
    instance.actions.setBrushWidth('s')
    instance.actions.hydrate(layout())
    expect(instance.getSnapshot().tool).toBe('brush')
    expect(instance.getSnapshot().brushWidth).toBe('s')
  })
})

describe('canvas tool routing', () => {
  /** Direct-render props for the canvas over one instance. */
  function canvasProps(instance: BoardInstance): DashboardCanvasProps {
    return {
      useStore: <S,>(selector: (value: BoardState) => S): S => selector(instance.getSnapshot()),
      actions: instance.actions,
      renderSlot: () => null,
      createElement: vi.fn(),
      moveElement: vi.fn(),
      resizeElement: vi.fn(),
      removeElement: vi.fn(),
      patchElement: vi.fn(),
      eraseStrokes: vi.fn(),
    }
  }

  it('starts a tool gesture instead of a pan while the brush is active', () => {
    const instance = store()
    instance.actions.setTool('brush')
    const setPan = vi.spyOn(instance.actions, 'setPan')
    const view = render(createElement(DashboardCanvas, canvasProps(instance)))
    const canvas = view.container.querySelector('[data-surface="canvas"]') as HTMLElement
    expect(canvas.getAttribute('data-board-tool')).toBe('brush')
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 50, clientY: 50, button: 0, isPrimary: true })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 90, clientY: 90 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    expect(setPan).not.toHaveBeenCalled()
    view.unmount()
  })
})

describe('tool mode through the assembled board', () => {
  it('pans with Space and the middle button and zooms with Ctrl+wheel while the brush is active', async () => {
    const { runtime, panel, store: instance } = await bench()
    act(() => { instance.actions.setTool('brush') })
    await runtime.flush()
    const canvas = panel.container.querySelector('[data-surface="canvas"]') as HTMLElement
    const boardRoot = panel.container.querySelector('[data-surface="board"]') as HTMLElement
    expect(canvas.getAttribute('data-board-tool')).toBe('brush')

    fireEvent.pointerEnter(boardRoot)
    fireEvent.keyDown(window, { code: 'Space' })
    const panBefore = instance.getSnapshot().panX
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 100, clientY: 100, button: 0 })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 160, clientY: 100 })
    await runtime.flush()
    expect(instance.getSnapshot().panX).toBe(panBefore + 60)
    fireEvent.keyUp(window, { code: 'Space' })

    const panYBefore = instance.getSnapshot().panY
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 100, clientY: 100, button: 1 })
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 90, clientY: 120 })
    await runtime.flush()
    expect(instance.getSnapshot().panX).toBe(panBefore + 60 - 10)
    expect(instance.getSnapshot().panY).toBe(panYBefore + 20)

    const zoomBefore = instance.getSnapshot().zoom
    fireEvent.wheel(canvas, { ctrlKey: true, deltaY: -100, clientX: 100, clientY: 100 })
    await runtime.flush()
    expect(instance.getSnapshot().zoom).toBeGreaterThan(zoomBefore)
    expect(instance.getSnapshot().tool).toBe('brush')
  })

  it('leaves the tool on the first Escape and closes the window panel on the second', async () => {
    const { runtime, panel, store: instance } = await bench()
    act(() => { instance.actions.openWindow(windowState('a1' as WindowId)) })
    await runtime.flush()
    act(() => { instance.actions.setWindowPanel('a1' as WindowId, 'right', true) })
    await runtime.flush()
    act(() => { instance.actions.setTool('brush') })
    await runtime.flush()

    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    expect(instance.getSnapshot().tool).toBe('select')
    expect(instance.getSnapshot().windows['a1']?.rightPanelOpen).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    expect(instance.getSnapshot().windows['a1']?.rightPanelOpen).toBe(false)
    expect(panel.container.querySelector('[data-surface="board"]')).not.toBeNull()
  })

  it('toggles brush and eraser from the dock and picks the thickness from its menu', async () => {
    const { runtime, panel, store: instance } = await bench()
    const brush = panel.container.querySelector('[data-board-action="dock-brush"]') as HTMLButtonElement
    const eraser = panel.container.querySelector('[data-board-action="dock-eraser"]') as HTMLButtonElement
    expect(brush.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(brush)
    await runtime.flush()
    expect(instance.getSnapshot().tool).toBe('brush')
    expect(brush.getAttribute('aria-pressed')).toBe('true')
    expect(eraser.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(eraser)
    await runtime.flush()
    expect(instance.getSnapshot().tool).toBe('eraser')
    expect(eraser.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(eraser)
    await runtime.flush()
    expect(instance.getSnapshot().tool).toBe('select')

    fireEvent.click(panel.container.querySelector('[data-board-action="dock-brush-width"]') as Element)
    fireEvent.click(screen.getByRole('menuitem', { name: t('tool.width.s') }))
    await runtime.flush()
    expect(instance.getSnapshot().brushWidth).toBe('s')
  })

  it('turns the inspector off when the brush is enabled', async () => {
    const { runtime, panel, store: instance } = await bench()
    fireEvent.click(panel.container.querySelector('[data-board-action="dock-select-element"]') as Element)
    await runtime.flush()
    expect(instance.getSnapshot().isSelectingElement).toBe(true)
    // The inspector's overlay claims clicks on the board chrome, so the store
    // action is the path the dock button itself runs once a click lands.
    act(() => { instance.actions.setTool('brush') })
    await runtime.flush()
    expect(instance.getSnapshot().tool).toBe('brush')
    expect(instance.getSnapshot().isSelectingElement).toBe(false)
  })
})
