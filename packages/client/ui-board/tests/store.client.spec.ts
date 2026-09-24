// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { MIN_WINDOW_SIZE, clampWindowSize, createBoardStore, nextWindowOrdinal, snapPosition } from '../src/client/store.ts'
import { PANEL_DEFAULT_WIDTH, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from '../src/client/window/panel-geometry.ts'
import type { BoardLayoutDocument } from '../src/board-settings.ts'
import type { CloneId } from '@ketos/clone-core/types'
import type { BoardWindowState, WindowId } from '../src/client/contract/slots.ts'

/** A window state literal with the fields a placement test does not vary. */
function makeWindow(overrides: Partial<BoardWindowState> & Pick<BoardWindowState, 'id'>): BoardWindowState {
  return {
    kind: 'agent',
    bodyKind: 'conversation',
    ordinal: 1,
    x: 0,
    y: 0,
    width: 400,
    height: 500,
    zIndex: 10,
    ...overrides,
  }
}

/** One empty layout document, for the hydrate cleanup cases. */
function emptyLayout(): BoardLayoutDocument {
  return {
    version: 1,
    panX: 0,
    panY: 0,
    zoom: 1,
    windows: [],
    windowOrder: [],
    activeWindowId: '',
    panelWindowId: '',
    panelCollapsed: true,
    panelWidth: PANEL_DEFAULT_WIDTH,
    panelGroupBy: 'workspace',
    panelOrderBy: 'updated',
    defaultPreset: '',
  }
}

describe('clone editor drafts', () => {
  const draft = {
    draft: { name: 'Анна', role: 'Аналитик', description: '', persona: '', methodology: '', skills: [], preferredModel: null, status: 'draft' as const },
    base: { name: 'Анна', role: 'Аналитик', description: '', persona: '', methodology: '', skills: [], preferredModel: null, status: 'draft' as const },
    revision: 1,
    agentFields: [],
  }

  it('keeps a draft while its window lives and drops it when the window closes', () => {
    const { actions, store } = createBoardStore().create()
    actions.addWindow(makeWindow({ id: 'w1' as WindowId, kind: 'clone', bodyKind: 'clone', cloneId: 'clone-1' as CloneId }))
    actions.setCloneEdit('w1' as WindowId, 'clone-1' as CloneId, draft)
    expect(store.getSnapshot().cloneEdits['clone-1']).toBeDefined()

    // A write that arrives after the window closed must not resurrect it.
    actions.setCloneEdit('missing' as WindowId, 'clone-2' as CloneId, draft)
    expect(store.getSnapshot().cloneEdits['clone-2']).toBeUndefined()

    actions.setCloneEdit('w1' as WindowId, 'clone-1' as CloneId, undefined)
    expect(store.getSnapshot().cloneEdits['clone-1']).toBeUndefined()

    actions.setCloneEdit('w1' as WindowId, 'clone-1' as CloneId, draft)
    actions.closeWindow('w1' as WindowId)
    expect(store.getSnapshot().cloneEdits['clone-1']).toBeUndefined()
  })

  it('keeps a clone draft when a tasks window for the same clone closes', () => {
    const { actions, store } = createBoardStore().create()
    actions.addWindow(makeWindow({ id: 'c1' as WindowId, kind: 'clone', bodyKind: 'clone', cloneId: 'clone-1' as CloneId }))
    actions.addWindow(makeWindow({
      id: 't1' as WindowId,
      kind: 'tasks',
      bodyKind: 'tasks',
      cloneId: 'clone-1' as CloneId,
      ordinal: 2,
    }))
    actions.setCloneEdit('c1' as WindowId, 'clone-1' as CloneId, draft)

    actions.closeWindow('t1' as WindowId)

    // A tasks window carries the clone id but edits no draft: closing it must
    // leave the open editor's unsaved record alone.
    expect(store.getSnapshot().cloneEdits['clone-1']).toBeDefined()
  })

  it('drops the view state of every window an adopted layout removes', () => {
    const { actions, store } = createBoardStore().create()
    actions.addWindow(makeWindow({ id: 'c1' as WindowId, kind: 'clone', bodyKind: 'clone', cloneId: 'clone-1' as CloneId }))
    actions.setCloneEdit('c1' as WindowId, 'clone-1' as CloneId, draft)
    actions.pushComposerIntent('c1' as WindowId, { text: 'chip' })

    actions.hydrate(emptyLayout())

    // A window the adopted document drops takes its draft and its queued
    // command with it, exactly as closing it would.
    expect(store.getSnapshot().cloneEdits['clone-1']).toBeUndefined()
    expect(store.getSnapshot().composerIntents).toEqual([])
  })
})

describe('nextWindowOrdinal', () => {
  it('never recycles an ordinal the open stack still shows', () => {
    const { actions, store } = createBoardStore().create()
    actions.addWindow(makeWindow({ id: 'w1' as WindowId, ordinal: 1 }))
    actions.addWindow(makeWindow({ id: 'w2' as WindowId, ordinal: 2 }))
    expect(nextWindowOrdinal(store.getSnapshot().windows)).toBe(3)

    // Closing the first window leaves ordinal 2 in the stack.
    actions.closeWindow('w1' as WindowId)
    expect(nextWindowOrdinal(store.getSnapshot().windows)).toBe(3)
  })
})

describe('createBoardStore', () => {
  it('initializes with default pan, zoom, viewport, and empty windows', () => {
    const { store } = createBoardStore().create()
    const snapshot = store.getSnapshot()
    expect(snapshot.panX).toBe(0)
    expect(snapshot.panY).toBe(0)
    expect(snapshot.zoom).toBe(1)
    expect(snapshot.viewportWidth).toBe(1920)
    expect(snapshot.viewportHeight).toBe(1080)
    expect(snapshot.windows).toEqual({})
    expect(snapshot.windowOrder).toEqual([])
    expect(snapshot.activeWindowId).toBeNull()
    expect(snapshot.isSelectingElement).toBe(false)
  })

  it('updates pan and clamps zoom to [0.2, 2.0]', () => {
    const { store, actions } = createBoardStore().create()
    actions.setPan(150, -80)
    expect(store.getSnapshot().panX).toBe(150)
    expect(store.getSnapshot().panY).toBe(-80)

    actions.setZoom(0.05)
    expect(store.getSnapshot().zoom).toBe(0.2)

    actions.setZoom(3.5)
    expect(store.getSnapshot().zoom).toBe(2.0)

    actions.setZoom(1.25)
    expect(store.getSnapshot().zoom).toBe(1.25)
  })

  it('zooms toward pointer preserving cursor focus', () => {
    const { store, actions } = createBoardStore().create()
    actions.setPan(100, 100)
    actions.setZoom(1.0)

    // Zoom in toward pointer at (200, 200)
    actions.zoomTowardPointer(-1, 200, 200)
    const snap = store.getSnapshot()
    expect(snap.zoom).toBeCloseTo(1.1)
    // T_new = P - (P - T_old) * (S_new / S_old) = 200 - (200 - 100) * 1.1 = 90
    expect(snap.panX).toBeCloseTo(90)
    expect(snap.panY).toBeCloseTo(90)
  })

  it('zooms out toward the pointer and keeps pan when the clamp holds the zoom', () => {
    const { store, actions } = createBoardStore().create()
    actions.setPan(100, 100)
    actions.zoomTowardPointer(1, 200, 200)
    expect(store.getSnapshot().zoom).toBeCloseTo(0.9)
    // T_new = P - (P - T_old) * (S_new / S_old) = 200 - (200 - 100) * 0.9
    expect(store.getSnapshot().panX).toBeCloseTo(110)

    // At the lower clamp the zoom cannot move, so the pan must stay untouched.
    actions.setZoom(0.2)
    actions.setPan(100, 100)
    actions.zoomTowardPointer(1, 200, 200)
    expect(store.getSnapshot().zoom).toBe(0.2)
    expect(store.getSnapshot().panX).toBe(100)
  })

  it('records the viewport the canvas layer measures', () => {
    const { store, actions } = createBoardStore().create()
    actions.setViewport(1280, 720)
    expect(store.getSnapshot().viewportWidth).toBe(1280)
    expect(store.getSnapshot().viewportHeight).toBe(720)
  })

  it('adds, moves, and snaps windows to 24px grid', () => {
    const { store, actions } = createBoardStore().create()
    const win = makeWindow({ id: 'win-1' as WindowId, x: 100, y: 100 })

    actions.addWindow(win)
    expect(store.getSnapshot().windows['win-1']).toEqual(win)
    expect(store.getSnapshot().activeWindowId).toBe('win-1')

    // Move with snap: 125 rounds to 120 (24*5), 133 rounds to 144 (24*6)
    actions.moveWindow('win-1' as WindowId, 125, 133, true)
    expect(store.getSnapshot().windows['win-1']?.x).toBe(120)
    expect(store.getSnapshot().windows['win-1']?.y).toBe(144)

    // Move without snap (Shift held)
    actions.moveWindow('win-1' as WindowId, 125, 133, false)
    expect(store.getSnapshot().windows['win-1']?.x).toBe(125)
    expect(store.getSnapshot().windows['win-1']?.y).toBe(133)
  })

  it('openWindow centers the window in the viewport, floors its size, and stacks it on top', () => {
    const { store, actions } = createBoardStore().create()
    actions.setViewport(1000, 800)

    // A tool-sized request still opens at the floor: every kind shares it.
    actions.openWindow({
      id: 'open-1' as WindowId,
      kind: 'connectors',
      bodyKind: 'connectors',
      ordinal: 1,
      width: 400,
      height: 200,
    })

    const snap = store.getSnapshot()
    expect(snap.windows['open-1']?.width).toBe(MIN_WINDOW_SIZE.width)
    expect(snap.windows['open-1']?.height).toBe(MIN_WINDOW_SIZE.height)
    // Centered at zoom 1 with no pan: (1000/2 - 552/2, 800/2 - 648/2)
    expect(snap.windows['open-1']?.x).toBe(224)
    expect(snap.windows['open-1']?.y).toBe(76)
    expect(snap.windows['open-1']?.zIndex).toBe(10)
    expect(snap.activeWindowId).toBe('open-1')
    expect(snap.windowOrder).toEqual(['open-1'])
  })

  it('openWindow places against the current pan and zoom', () => {
    const { store, actions } = createBoardStore().create()
    actions.setViewport(1000, 800)
    actions.setPan(-200, -100)
    actions.setZoom(2)

    actions.openWindow({
      id: 'open-2' as WindowId,
      kind: 'agent',
      bodyKind: 'conversation',
      ordinal: 1,
      width: 400,
      height: 400,
    })

    const snap = store.getSnapshot()
    // Floored to 552x648: x = (200 + 1000/2 - 276) / 2, y = (100 + 800/2 - 324) / 2
    expect(snap.windows['open-2']?.x).toBe(212)
    expect(snap.windows['open-2']?.y).toBe(88)
  })

  it('clamps every insertion into the window band, whatever z the caller passes', () => {
    const { store, actions } = createBoardStore().create()
    // A restored layout or a test caller can pass any z; the store owns the band.
    actions.addWindow(makeWindow({ id: 'w1' as WindowId, zIndex: 1000 }))
    expect(store.getSnapshot().windows['w1']?.zIndex).toBe(99)
    actions.addWindow(makeWindow({ id: 'w2' as WindowId, zIndex: -5 }))
    expect(store.getSnapshot().windows['w2']?.zIndex).toBe(10)
  })

  it('resizes windows with 24px snap and the default chat size as the floor', () => {
    const { store, actions } = createBoardStore().create()
    actions.addWindow(makeWindow({ id: 'win-1' as WindowId }))

    // The floor is the size the window is created with, not a smaller guess.
    expect(MIN_WINDOW_SIZE).toEqual({ width: 552, height: 648 })
    actions.resizeWindow('win-1' as WindowId, 100, 50, false)
    expect(store.getSnapshot().windows['win-1']?.width).toBe(MIN_WINDOW_SIZE.width)
    expect(store.getSnapshot().windows['win-1']?.height).toBe(MIN_WINDOW_SIZE.height)

    // Snapping never lands below the floor either (24 * 23 = 552 < 648).
    actions.resizeWindow('win-1' as WindowId, 485, 552, true)
    expect(store.getSnapshot().windows['win-1']?.width).toBe(552)
    expect(store.getSnapshot().windows['win-1']?.height).toBe(648)

    // Growth is unbounded.
    actions.resizeWindow('win-1' as WindowId, 1000, 900, false)
    expect(store.getSnapshot().windows['win-1']?.width).toBe(1000)
    expect(store.getSnapshot().windows['win-1']?.height).toBe(900)
  })

  it('rounds positions and sizes to the grid only when snapping is on', () => {
    expect(snapPosition(125, true)).toBe(120)
    expect(snapPosition(125, false)).toBe(125)
    expect(snapPosition(-13, true)).toBe(-24)
    expect(clampWindowSize(1000, 900, true)).toEqual({ width: 1008, height: 912 })
    expect(clampWindowSize(100, 100, true)).toEqual({ width: 552, height: 648 })
    expect(clampWindowSize(100, 100, false)).toEqual({ width: 552, height: 648 })
  })

  it('switches the body kind of one window and ignores unknown ids', () => {
    const { store, actions } = createBoardStore().create()
    actions.addWindow(makeWindow({ id: 'w1' as WindowId }))

    actions.setWindowBodyKind('w1' as WindowId, 'settings')
    expect(store.getSnapshot().windows['w1']?.bodyKind).toBe('settings')

    actions.setWindowBodyKind('missing' as WindowId, 'clone-memory')
    expect(store.getSnapshot().windows['w1']?.bodyKind).toBe('settings')
  })

  it('manages window focus and z-index ordering', () => {
    const { store, actions } = createBoardStore().create()
    const win1 = makeWindow({ id: 'w1' as WindowId, customTitle: '1', x: 0, y: 0, width: 400, height: 400 })
    const win2 = makeWindow({ id: 'w2' as WindowId, kind: 'connectors', bodyKind: 'connectors', customTitle: '2', x: 50, y: 50, width: 400, height: 400, zIndex: 11 })

    actions.addWindow(win1)
    actions.addWindow(win2)
    expect(store.getSnapshot().activeWindowId).toBe('w2')

    const untouched = store.getSnapshot().windows['w2']
    // Focus win1: only the raised window moves in the z band.
    actions.focusWindow('w1' as WindowId)
    const snap = store.getSnapshot()
    // The other window keeps its state identity, so its frame bails out of re-rendering.
    expect(snap.windows['w2']).toBe(untouched)
    expect(snap.activeWindowId).toBe('w1')
    expect(snap.windowOrder).toEqual(['w2', 'w1'])
    expect(snap.windows['w1']?.zIndex).toBeGreaterThan(snap.windows['w2']?.zIndex ?? 0)
    expect(snap.windows['w2']?.zIndex).toBe(11)

    // Raising the window that is already on top changes nothing.
    const top = snap.windows['w1']?.zIndex
    actions.focusWindow('w1' as WindowId)
    expect(store.getSnapshot().windows['w1']?.zIndex).toBe(top)

    // Close win1
    actions.closeWindow('w1' as WindowId)
    const closedSnap = store.getSnapshot()
    expect(closedSnap.windows['w1']).toBeUndefined()
    expect(closedSnap.activeWindowId).toBe('w2')
  })

  it('fills one window fullscreen without touching its stored rectangle', () => {
    const { store, actions } = createBoardStore().create()
    const win = makeWindow({ id: 'w1' as WindowId, x: 96, y: 120, width: 600, height: 720, zIndex: 10 })
    actions.addWindow(win)
    actions.addWindow(makeWindow({ id: 'w2' as WindowId, kind: 'connectors', bodyKind: 'connectors', customTitle: '2' }))
    expect(store.getSnapshot().fullscreenWindowId).toBeNull()

    actions.setWindowFullscreen('w1' as WindowId)
    const snap = store.getSnapshot()
    expect(snap.fullscreenWindowId).toBe('w1')
    // Both the rectangle and the size stay authoritative for the exit path.
    expect(snap.windows['w1']?.x).toBe(96)
    expect(snap.windows['w1']?.y).toBe(120)
    expect(snap.windows['w1']?.width).toBe(600)
    expect(snap.windows['w1']?.height).toBe(720)

    actions.exitFullscreen()
    expect(store.getSnapshot().fullscreenWindowId).toBeNull()
    expect(store.getSnapshot().windows['w1']?.width).toBe(600)

    // Closing the fullscreen window leaves the mode with it.
    actions.setWindowFullscreen('w1' as WindowId)
    actions.closeWindow('w1' as WindowId)
    expect(store.getSnapshot().fullscreenWindowId).toBeNull()

    // Unknown ids are ignored, like every other window operation.
    actions.setWindowFullscreen('missing' as WindowId)
    expect(store.getSnapshot().fullscreenWindowId).toBeNull()
  })

  it('opens one chats panel at a time and clears it with its window', () => {
    const { store, actions } = createBoardStore().create()
    actions.addWindow(makeWindow({ id: 'w1' as WindowId }))
    actions.addWindow(makeWindow({ id: 'w2' as WindowId, kind: 'connectors', bodyKind: 'connectors', customTitle: '2' }))
    expect(store.getSnapshot().panelWindowId).toBeNull()

    actions.openWindowPanel('w1' as WindowId)
    expect(store.getSnapshot().panelWindowId).toBe('w1')
    // Only one panel is open at a time.
    actions.openWindowPanel('w2' as WindowId)
    expect(store.getSnapshot().panelWindowId).toBe('w2')

    actions.closeWindowPanel()
    expect(store.getSnapshot().panelWindowId).toBeNull()

    actions.openWindowPanel('w1' as WindowId)
    actions.closeWindow('w1' as WindowId)
    expect(store.getSnapshot().panelWindowId).toBeNull()

    actions.openWindowPanel('missing' as WindowId)
    expect(store.getSnapshot().panelWindowId).toBeNull()
  })

  it('opens the chats panel expanded, keeps its width in range, and collapses it', () => {
    const { store, actions } = createBoardStore().create()
    actions.addWindow(makeWindow({ id: 'w1' as WindowId }))
    expect(store.getSnapshot().panelCollapsed).toBe(true)
    expect(store.getSnapshot().panelWidth).toBe(PANEL_DEFAULT_WIDTH)

    actions.openWindowPanel('w1' as WindowId)
    expect(store.getSnapshot().panelCollapsed).toBe(false)

    // The dragged width never leaves the readable range.
    actions.setPanelWidth(PANEL_MAX_WIDTH + 200)
    expect(store.getSnapshot().panelWidth).toBe(PANEL_MAX_WIDTH)
    actions.setPanelWidth(PANEL_MIN_WIDTH - 200)
    expect(store.getSnapshot().panelWidth).toBe(PANEL_MIN_WIDTH)

    actions.setPanelCollapsed(true)
    expect(store.getSnapshot().panelCollapsed).toBe(true)
    actions.openWindowPanel('w1' as WindowId)
    expect(store.getSnapshot().panelCollapsed).toBe(false)
    actions.closeWindowPanel()
    expect(store.getSnapshot().panelCollapsed).toBe(true)
  })

  it('centers the viewport on a window and raises it', () => {
    const { store, actions } = createBoardStore().create()
    actions.setViewport(1000, 800)
    actions.addWindow(makeWindow({ id: 'w1' as WindowId, x: 400, y: 200, width: 400, height: 400 }))

    actions.centerOnWindow('w1' as WindowId)

    const snap = store.getSnapshot()
    // Window center (600, 400) lands at the viewport center (500, 400): pan -100, 0.
    expect(snap.panX).toBe(-100)
    expect(snap.panY).toBe(0)
    expect(snap.activeWindowId).toBe('w1')

    actions.centerOnWindow('missing' as WindowId)
    expect(store.getSnapshot().panX).toBe(-100)
  })

  it('ignores window operations for unknown ids', () => {
    const { store, actions } = createBoardStore().create()
    const before = store.getSnapshot()

    actions.moveWindow('missing' as WindowId, 10, 10, false)
    actions.resizeWindow('missing' as WindowId, 10, 10, false)
    actions.closeWindow('missing' as WindowId)
    actions.focusWindow('missing' as WindowId)

    expect(store.getSnapshot()).toStrictEqual(before)
  })

  it('keeps the active window when a different window closes', () => {
    const { store, actions } = createBoardStore().create()
    actions.addWindow(makeWindow({ id: 'w1' as WindowId }))
    actions.addWindow(makeWindow({ id: 'w2' as WindowId }))

    actions.closeWindow('w1' as WindowId)
    expect(store.getSnapshot().activeWindowId).toBe('w2')
    expect(store.getSnapshot().windowOrder).toEqual(['w2'])
  })

  it('keeps more than 90 windows inside the z band below the floating chrome', () => {
    const { store, actions } = createBoardStore().create()
    for (let index = 0; index < 95; index += 1) {
      actions.addWindow(makeWindow({ id: `w${String(index)}` as WindowId }))
    }
    // Every window starts in the band, and repeated raises renormalize the
    // band instead of walking past the chrome and overlay above it.
    for (let index = 0; index < 95; index += 1) {
      actions.focusWindow(`w${String(index)}` as WindowId)
    }
    const snap = store.getSnapshot()
    const zs = Object.values(snap.windows).map(win => win.zIndex)
    expect(Math.max(...zs)).toBeLessThan(100)
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(10)
    // The focused window is the last in paint order and carries the band top.
    expect(snap.activeWindowId).toBe('w94')
    expect(snap.windows['w94']?.zIndex).toBe(Math.max(...zs))
    expect(snap.windowOrder.at(-1)).toBe('w94')
  })

  it('toggles spatial element selection state', () => {
    const { store, actions } = createBoardStore().create()
    actions.setSelectingElement(true)
    expect(store.getSnapshot().isSelectingElement).toBe(true)
    actions.setSelectingElement(false)
    expect(store.getSnapshot().isSelectingElement).toBe(false)
  })

  it('arms and clears the return highlight for an existing window only', () => {
    const { store, actions } = createBoardStore().create()
    actions.addWindow(makeWindow({ id: 'w1' as WindowId }))

    actions.expectReturnWindow('w1' as WindowId)
    expect(store.getSnapshot().returnWindowId).toBe('w1')
    // A window the board no longer holds cannot be returned to.
    actions.expectReturnWindow('gone' as WindowId)
    expect(store.getSnapshot().returnWindowId).toBe('w1')
    actions.clearReturnWindow()
    expect(store.getSnapshot().returnWindowId).toBeNull()

    actions.setHighlightWindow('w1' as WindowId)
    expect(store.getSnapshot().highlightWindowId).toBe('w1')
    // A stale id never highlights, and null always clears.
    actions.setHighlightWindow('gone' as WindowId)
    expect(store.getSnapshot().highlightWindowId).toBeNull()
    actions.setHighlightWindow('w1' as WindowId)
    actions.setHighlightWindow(null)
    expect(store.getSnapshot().highlightWindowId).toBeNull()
  })

  it('queues, consumes, and drops composer intents with their window', () => {
    const { store, actions } = createBoardStore().create()
    actions.addWindow(makeWindow({ id: 'w1' as WindowId }))
    actions.addWindow(makeWindow({ id: 'w2' as WindowId }))

    actions.pushComposerIntent('w1' as WindowId, { text: 'chip one' })
    actions.pushComposerIntent('w2' as WindowId, { pickFiles: true })
    const queued = store.getSnapshot().composerIntents
    expect(queued).toHaveLength(2)
    expect(queued[0]?.id).toBe(1)
    expect(queued[1]?.id).toBe(2)
    expect(queued[1]?.pickFiles).toBe(true)

    // Consuming removes exactly the addressed command.
    actions.consumeComposerIntent(queued[0]?.id ?? 0)
    expect(store.getSnapshot().composerIntents).toEqual([
      expect.objectContaining({ windowId: 'w2', pickFiles: true }),
    ])

    // Closing a window drops its pending command; the other window's stays.
    actions.pushComposerIntent('w1' as WindowId, { text: 'chip two' })
    actions.closeWindow('w1' as WindowId)
    expect(store.getSnapshot().composerIntents).toEqual([
      expect.objectContaining({ windowId: 'w2' }),
    ])
  })
})
