// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import { MIN_WINDOW_SIZE, clampWindowSize, createBoardStore, nextWindowOrdinal, snapPosition, type BoardStoreInstance } from '../src/client/store.ts'
import { DEMO_SELF_ID, canManageWindow, type OwnerId } from '../src/client/owners.ts'
import type { BoardDocId, BoardRevision } from '@ketos/board-doc/types'
import type { BoardLayoutDocument } from '../src/board-settings.ts'
import type { CloneId } from '@ketos/clone-core/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BoardWindowState, WindowId } from '../src/client/contract/slots.ts'

/** Identity the window-owner specs adopt before opening windows. */
const SELF = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e1')

/**
 * Adopt one document snapshot, so the acting identity is known.
 * @param actions - the board action face.
 */
function adoptSelf(actions: BoardStoreInstance['actions']): void {
  actions.applyBoardSnapshot({
    docId: brandString<BoardDocId>('00000000-0000-4000-8000-0000000000d1'),
    selfId: SELF,
    revision: brandNumber<BoardRevision>(1),
    elements: [],
    participants: [{ id: SELF, name: 'Kirill', color: 1, updatedAt: 1 }],
    limits: { elementBytesMax: 1024, noteTextMax: 1024, strokePointsMax: 2, todoItemsMax: 1 },
  })
}

/** A window state literal with the fields a placement test does not vary. */
function makeWindow(overrides: Partial<BoardWindowState> & Pick<BoardWindowState, 'id'>): BoardWindowState {
  return {
    kind: 'agent',
    bodyKind: 'conversation',
    ordinal: 1,
    ownerId: DEMO_SELF_ID,
    access: { mode: 'owner', people: [] },
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
    dockOrder: [],
    cloneOrder: [],
    activeWindowId: '',
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

  it('zooms by a factor around the pointer, keeping the world point under the cursor', () => {
    const { store, actions } = createBoardStore().create()
    actions.setPan(100, 100)

    // The world point under (200, 200): (200 - 100) / 1 = 100.
    actions.zoomBy(1.1, 200, 200)
    const snap = store.getSnapshot()
    expect(snap.zoom).toBeCloseTo(1.1)
    // T_new = P - (P - T_old) * (S_new / S_old) = 200 - (200 - 100) * 1.1 = 90
    expect(snap.panX).toBeCloseTo(90)
    expect(snap.panY).toBeCloseTo(90)
    expect((200 - snap.panX) / snap.zoom).toBeCloseTo(100)

    // A factor of one is a no-op, pan included.
    actions.zoomBy(1, 200, 200)
    expect(store.getSnapshot().panX).toBeCloseTo(90)
    expect(store.getSnapshot().zoom).toBeCloseTo(1.1)
  })

  it('is monotone and symmetric, and keeps pan when the clamp holds the zoom', () => {
    const { store, actions } = createBoardStore().create()
    actions.setPan(100, 100)

    // A larger factor never yields a smaller zoom, in either direction.
    let previous = store.getSnapshot().zoom
    for (const factor of [1.1, 1.25, 1.5, 1 / 1.1, 1 / 1.25, 1 / 1.5]) {
      actions.zoomBy(factor, 200, 200)
      const current = store.getSnapshot().zoom
      expect(current).not.toBe(previous)
      previous = current
    }

    // A factor and its reciprocal return the exact view they started from.
    actions.setPan(100, 100)
    actions.setZoom(1)
    actions.zoomBy(1.25, 200, 200)
    actions.zoomBy(1 / 1.25, 200, 200)
    expect(store.getSnapshot().zoom).toBeCloseTo(1)
    expect(store.getSnapshot().panX).toBeCloseTo(100)

    // At a clamp the zoom cannot move, so the pan must stay untouched.
    for (const [limit, factor] of [[0.2, 0.5], [2, 2]] as const) {
      actions.setZoom(limit)
      actions.setPan(100, 100)
      actions.zoomBy(factor, 200, 200)
      expect(store.getSnapshot().zoom).toBe(limit)
      expect(store.getSnapshot().panX).toBe(100)
    }
  })

  it('pans by a screen-pixel delta and resets the view to pan 0 and zoom 1', () => {
    const { store, actions } = createBoardStore().create()
    actions.setPan(150, -80)
    actions.panBy(40, 2)
    expect(store.getSnapshot().panX).toBe(110)
    expect(store.getSnapshot().panY).toBe(-82)

    actions.setZoom(1.5)
    actions.panBy(-10, 5)
    actions.resetView()
    expect(store.getSnapshot().panX).toBe(0)
    expect(store.getSnapshot().panY).toBe(0)
    expect(store.getSnapshot().zoom).toBe(1)
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
    // The insert fills the panel defaults the literal omits.
    expect(store.getSnapshot().windows['win-1']).toEqual({
      ...win,
      leftPanelOpen: false,
      leftPanelWidth: 260,
      rightPanelOpen: false,
      rightPanelWidth: 360,
    })
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
    // Centered at zoom 1 with no pan: (1000/2 - 408/2, 800/2 - 480/2)
    expect(snap.windows['open-1']?.x).toBe(296)
    expect(snap.windows['open-1']?.y).toBe(160)
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
    // Floored to 408x480 and centred under the view transform: the world
    // point under the viewport centre is ((500 + 200) / 2, (400 + 100) / 2),
    // so x = 350 - 204 = 146 and y = 250 - 240 = 10.
    expect(snap.windows['open-2']?.x).toBe(146)
    expect(snap.windows['open-2']?.y).toBe(10)
  })

  it('clamps every insertion into the window band, whatever z the caller passes', () => {
    const { store, actions } = createBoardStore().create()
    // A restored layout or a test caller can pass any z; the store owns the band.
    actions.addWindow(makeWindow({ id: 'w1' as WindowId, zIndex: 1000 }))
    expect(store.getSnapshot().windows['w1']?.zIndex).toBe(99)
    actions.addWindow(makeWindow({ id: 'w2' as WindowId, zIndex: -5 }))
    expect(store.getSnapshot().windows['w2']?.zIndex).toBe(10)
  })

  it('resizes windows with 24px snap and the minimum layout as the floor', () => {
    const { store, actions } = createBoardStore().create()
    actions.addWindow(makeWindow({ id: 'win-1' as WindowId }))

    // The floor is the minimum working layout (decision R-5).
    expect(MIN_WINDOW_SIZE).toEqual({ width: 408, height: 480 })
    actions.resizeWindow('win-1' as WindowId, 100, 50, false)
    expect(store.getSnapshot().windows['win-1']?.width).toBe(MIN_WINDOW_SIZE.width)
    expect(store.getSnapshot().windows['win-1']?.height).toBe(MIN_WINDOW_SIZE.height)

    // Snapping never lands below the floor either (a snapped 456 is raised).
    actions.resizeWindow('win-1' as WindowId, 485, 460, true)
    expect(store.getSnapshot().windows['win-1']?.width).toBe(480)
    expect(store.getSnapshot().windows['win-1']?.height).toBe(480)

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
    expect(clampWindowSize(100, 100, true)).toEqual({ width: 408, height: 480 })
    expect(clampWindowSize(100, 100, false)).toEqual({ width: 408, height: 480 })
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

  it('shows all windows at zoom 1 with an empty board and centres a fitting box', () => {
    const { store, actions } = createBoardStore().create()
    actions.setViewport(1000, 800)
    actions.setZoom(0.5)
    actions.setPan(123, 456)

    actions.resetView()
    expect(store.getSnapshot()).toMatchObject({ panX: 0, panY: 0, zoom: 1 })

    // A fitting board returns to zoom 1 (never above it), with the box's
    // centre on the safe area's centre whatever the previous zoom was.
    actions.addWindow(makeWindow({ id: 'w1' as WindowId, x: 100, y: 100, width: 400, height: 300 }))
    actions.setZoom(0.5)
    actions.resetView()
    expect(store.getSnapshot()).toMatchObject({ panX: 200, panY: 150, zoom: 1 })
    actions.setZoom(2)
    actions.resetView()
    expect(store.getSnapshot()).toMatchObject({ panX: 200, panY: 150, zoom: 1 })
  })

  it('fits a large board and open panels into the safe area', () => {
    const { store, actions } = createBoardStore().create()
    actions.setViewport(1000, 800)
    actions.addWindow(makeWindow({ id: 'w1' as WindowId, x: 0, y: 0, width: 2000, height: 1600 }))
    actions.resetView()
    expect(store.getSnapshot()).toMatchObject({ panX: 0, panY: 0, zoom: 0.5 })

    // The panel extends the box sideways: the whole window + panel is centred.
    const panelled = createBoardStore().create()
    panelled.actions.setViewport(1000, 800)
    panelled.actions.addWindow(makeWindow({ id: 'w1' as WindowId, x: 100, y: 100, width: 300, height: 300 }))
    panelled.actions.setWindowPanel('w1' as WindowId, 'left', true)
    panelled.actions.resetView()
    expect(panelled.store.getSnapshot()).toMatchObject({ panX: 380, panY: 150, zoom: 1 })
  })

  it('reduces the zoom when centring a window taller than the safe area', () => {
    const { store, actions } = createBoardStore().create()
    actions.setViewport(1000, 800)
    actions.addWindow(makeWindow({ id: 'w1' as WindowId, x: 0, y: 0, width: 400, height: 1600 }))
    actions.centerOnWindow('w1' as WindowId)
    expect(store.getSnapshot()).toMatchObject({ panX: 400, panY: 0, zoom: 0.5 })

    // Centring never magnifies a window that already fits.
    const small = createBoardStore().create()
    small.actions.setViewport(1000, 800)
    small.actions.addWindow(makeWindow({ id: 'w1' as WindowId, x: 0, y: 0, width: 100, height: 100 }))
    small.actions.setZoom(0.5)
    small.actions.centerOnWindow('w1' as WindowId)
    expect(small.store.getSnapshot().zoom).toBe(0.5)
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

  it('places and centres windows inside the safe area the chrome leaves (Т1.15)', () => {
    const { store, actions } = createBoardStore().create()
    actions.setViewport(1000, 800)
    actions.publishChromeInset('dock', 'bottom', 120)
    actions.publishChromeInset('rail', 'left', 80)
    actions.publishChromeInset('panel', 'right', 40)
    actions.openWindow({
      id: 'w1' as WindowId, kind: 'agent', bodyKind: 'conversation', ordinal: 1, width: 400, height: 300,
    })
    // Floored to 408×480 and centred in the safe rect x 80..960, y 0..680.
    const opened = store.getSnapshot().windows['w1'] as BoardWindowState
    expect(opened.x).toBe(316)
    expect(opened.y).toBe(100)

    // Centring puts the window's centre on the safe area's centre, not the
    // viewport's (the dock keeps its strip free).
    actions.moveWindow('w1' as WindowId, 0, 1000, false)
    actions.centerOnWindow('w1' as WindowId)
    const snapshot = store.getSnapshot()
    const centred = snapshot.windows['w1'] as BoardWindowState
    const screenCentreX = snapshot.panX + (centred.x + centred.width / 2) * snapshot.zoom
    const screenCentreY = snapshot.panY + (centred.y + centred.height / 2) * snapshot.zoom
    expect(screenCentreX).toBeCloseTo((80 + 960) / 2, 6)
    expect(screenCentreY).toBeCloseTo((0 + 680) / 2, 6)
  })

  it('keeps the dock order independent of focus and maintains it on open and close', () => {
    const { store, actions } = createBoardStore().create()
    actions.addWindow(makeWindow({ id: 'w1' as WindowId, ordinal: 1 }))
    actions.addWindow(makeWindow({ id: 'w2' as WindowId, ordinal: 2 }))
    actions.addWindow(makeWindow({ id: 'w3' as WindowId, ordinal: 3 }))
    expect(store.getSnapshot().dockOrder).toEqual(['w1', 'w2', 'w3'])

    // Raising a window reorders the paint stack, not the dock (A6).
    actions.focusWindow('w1' as WindowId)
    expect(store.getSnapshot().windowOrder).toEqual(['w2', 'w3', 'w1'])
    expect(store.getSnapshot().dockOrder).toEqual(['w1', 'w2', 'w3'])

    // Reordering moves the icon before the target, or to the end with null.
    actions.reorderDock('w3' as WindowId, 'w1' as WindowId)
    expect(store.getSnapshot().dockOrder).toEqual(['w3', 'w1', 'w2'])
    actions.reorderDock('w3' as WindowId, null)
    expect(store.getSnapshot().dockOrder).toEqual(['w1', 'w2', 'w3'])

    // Closing drops the icon; the paint order and the dock stay in step.
    actions.closeWindow('w2' as WindowId)
    expect(store.getSnapshot().dockOrder).toEqual(['w1', 'w3'])

    actions.reorderClones('c1' as CloneId, null)
    actions.reorderClones('c2' as CloneId, 'c1' as CloneId)
    expect(store.getSnapshot().cloneOrder).toEqual(['c2', 'c1'])
  })

  it('keeps window drafts in memory, dedupes their chips, and drops them on close', () => {
    const { store, actions } = createBoardStore().create()
    actions.addWindow(makeWindow({ id: 'w1' as WindowId }))
    actions.addWindow(makeWindow({ id: 'w2' as WindowId }))

    actions.setDraftText('w1' as WindowId, 'hello')
    actions.appendDraftText('w1' as WindowId, 'world')
    expect(store.getSnapshot().drafts['w1']?.text).toBe('hello\n\nworld')
    // An empty draft takes the appended paragraph verbatim.
    actions.appendDraftText('w2' as WindowId, 'first')
    expect(store.getSnapshot().drafts['w2']?.text).toBe('first')

    const image = { id: 'img-1', name: 'a.png', mediaType: 'image/png', data: 'AA', preview: 'data:image/png;base64,AA' }
    actions.addDraftImages('w1' as WindowId, [image, image])
    expect(store.getSnapshot().drafts['w1']?.images).toHaveLength(1)

    const source = new File([new Uint8Array(1)], 'a.txt', { type: 'text/plain' })
    actions.addDraftFiles('w1' as WindowId, [{ record: { id: 'f1', name: 'a.txt', status: 'uploading' }, source }])
    actions.updateDraftFile('w1' as WindowId, 'f1', { status: 'ready', receiptId: 'r1', error: undefined })
    const file = store.getSnapshot().drafts['w1']?.files[0]
    expect(file?.record).toMatchObject({ status: 'ready', receiptId: 'r1' })
    expect(file?.record.error).toBeUndefined()
    // The retained source is the same File the composer staged.
    expect(file?.source).toBe(source)

    actions.removeDraftItem('w1' as WindowId, 'image', 'img-1')
    expect(store.getSnapshot().drafts['w1']?.images).toEqual([])

    // Closing a window drops its draft; the other window's stays.
    actions.closeWindow('w1' as WindowId)
    expect(store.getSnapshot().drafts['w1']).toBeUndefined()
    expect(store.getSnapshot().drafts['w2']?.text).toBe('first')
    actions.clearDraft('w2' as WindowId)
    expect(store.getSnapshot().drafts).toEqual({})
  })

  it('tracks the expanded window and drops it with the window (Т2.1)', () => {
    const { actions, store } = createBoardStore().create()
    expect(store.getSnapshot().expandedWindowId).toBeNull()

    actions.addWindow(makeWindow({ id: 'w1' as WindowId }))
    actions.setExpandedWindow('w1' as WindowId)
    expect(store.getSnapshot().expandedWindowId).toBe('w1')

    // An unknown id never arms the return rules, and null clears explicitly.
    actions.setExpandedWindow('missing' as WindowId)
    expect(store.getSnapshot().expandedWindowId).toBe('w1')
    actions.setExpandedWindow(null)
    expect(store.getSnapshot().expandedWindowId).toBeNull()

    // Closing the expanded window forgets it with the rest of its state.
    actions.setExpandedWindow('w1' as WindowId)
    actions.closeWindow('w1' as WindowId)
    expect(store.getSnapshot().expandedWindowId).toBeNull()
  })
})

describe('window owner and access', () => {
  /** Open one agent window owned by the acting participant. */
  function openAgent(actions: BoardStoreInstance['actions'], id: string): void {
    actions.openWindow({
      id: id as WindowId,
      kind: 'agent',
      bodyKind: 'conversation',
      ordinal: 1,
      width: 400,
      height: 480,
    })
  }

  it('opens a new window as the current participant with owner-only access', () => {
    const { store, actions } = createBoardStore().create()
    adoptSelf(actions)
    openAgent(actions, 'w1')

    const win = store.getSnapshot().windows['w1'] as BoardWindowState
    expect(win.ownerId).toBe(SELF)
    expect(win.access).toEqual({ mode: 'owner', people: [] })
    expect(canManageWindow(store.getSnapshot(), win)).toBe(true)
  })

  it('opens a window under the legacy placeholder before the first snapshot, unmanageable until then', () => {
    const { store, actions } = createBoardStore().create()
    openAgent(actions, 'w1')

    const win = store.getSnapshot().windows['w1'] as BoardWindowState
    expect(win.ownerId).toBe(DEMO_SELF_ID)
    expect(canManageWindow(store.getSnapshot(), win)).toBe(false)

    // The first snapshot renames the placeholder to the real identity.
    adoptSelf(actions)
    const adopted = store.getSnapshot().windows['w1'] as BoardWindowState
    expect(adopted.ownerId).toBe(SELF)
    expect(canManageWindow(store.getSnapshot(), adopted)).toBe(true)
  })

  it('reopens a window under the owner and access a spec carries', () => {
    const { store, actions } = createBoardStore().create()
    const people = [brandString<OwnerId>('real-2')]
    actions.openWindow({
      id: 'w1' as WindowId,
      kind: 'agent',
      bodyKind: 'conversation',
      ordinal: 1,
      width: 400,
      height: 480,
      ownerId: brandString<OwnerId>('real-1'),
      access: { mode: 'selected', people },
    })
    // The insert copies the caller's list, so a later mutation cannot leak in.
    people.push(brandString<OwnerId>('real-3'))

    const win = store.getSnapshot().windows['w1'] as BoardWindowState
    expect(win.ownerId).toBe('real-1')
    expect(win.access).toEqual({ mode: 'selected', people: ['real-2'] })
  })

  it('transfers a window to another participant and locks the previous owner out', () => {
    const { store, actions } = createBoardStore().create()
    adoptSelf(actions)
    openAgent(actions, 'w1')
    const finance = brandString<OwnerId>('demo-finance')
    const legal = brandString<OwnerId>('demo-legal')
    actions.setWindowAccess('w1' as WindowId, { mode: 'selected', people: [finance, legal] })

    // The current owner cannot transfer to itself, and a malformed id is refused.
    actions.transferWindow('w1' as WindowId, SELF)
    actions.transferWindow('w1' as WindowId, 'bad\nid' as OwnerId)
    expect((store.getSnapshot().windows['w1'] as BoardWindowState).ownerId).toBe(SELF)

    actions.transferWindow('w1' as WindowId, finance)
    const transferred = store.getSnapshot().windows['w1'] as BoardWindowState
    expect(transferred.ownerId).toBe(finance)
    // The new owner leaves the selected list; the mode and the other person stay.
    expect(transferred.access).toEqual({ mode: 'selected', people: [legal] })
    expect(canManageWindow(store.getSnapshot(), transferred)).toBe(false)

    // The previous owner can neither transfer again nor change the access.
    actions.transferWindow('w1' as WindowId, legal)
    actions.setWindowAccess('w1' as WindowId, { mode: 'all', people: [] })
    expect(store.getSnapshot().windows['w1']).toEqual(transferred)
  })

  it('switches the three access modes and keeps the selected people across them', () => {
    const { store, actions } = createBoardStore().create()
    adoptSelf(actions)
    openAgent(actions, 'w1')
    const people = [brandString<OwnerId>('demo-finance'), brandString<OwnerId>('demo-legal')]
    const access = (): BoardWindowState['access'] =>
      (store.getSnapshot().windows['w1'] as BoardWindowState).access

    actions.setWindowAccess('w1' as WindowId, { mode: 'selected', people })
    expect(access()).toEqual({ mode: 'selected', people })
    actions.setWindowAccess('w1' as WindowId, { mode: 'all', people })
    expect(access()).toEqual({ mode: 'all', people })
    actions.setWindowAccess('w1' as WindowId, { mode: 'owner', people })
    expect(access()).toEqual({ mode: 'owner', people })
    actions.setWindowAccess('w1' as WindowId, { mode: 'selected', people })
    expect(access()).toEqual({ mode: 'selected', people })

    // The repair drops duplicates, the owner, and malformed ids like a stored list.
    actions.setWindowAccess('w1' as WindowId, {
      mode: 'selected',
      people: [SELF, people[0] as OwnerId, people[0] as OwnerId, 'bad\nid' as OwnerId],
    })
    expect(access()).toEqual({ mode: 'selected', people: [people[0]] })
  })

  it('ignores transfer and access changes for missing windows and windows owned by others', () => {
    const { store, actions } = createBoardStore().create()
    const before = store.getSnapshot()
    actions.transferWindow('missing' as WindowId, brandString<OwnerId>('demo-finance'))
    actions.setWindowAccess('missing' as WindowId, { mode: 'all', people: [] })
    expect(store.getSnapshot()).toStrictEqual(before)

    adoptSelf(actions)
    openAgent(actions, 'w1')
    actions.transferWindow('w1' as WindowId, brandString<OwnerId>('demo-finance'))
    const foreign = store.getSnapshot()
    actions.transferWindow('w1' as WindowId, brandString<OwnerId>('demo-legal'))
    actions.setWindowAccess('w1' as WindowId, { mode: 'all', people: [] })
    expect(store.getSnapshot()).toStrictEqual(foreign)
  })
})

describe('right panel state', () => {
  const session = 's1' as SessionId

  it('opens, dedupes, activates, and closes one session\'s tabs', () => {
    const { actions, store } = createBoardStore().create()

    actions.openRightTab(session, { id: 'home', kind: 'home' })
    expect(store.getSnapshot().rightPanels['s1']).toEqual({
      tabs: [{ id: 'home', kind: 'home' }],
      activeTabId: 'home',
      files: {},
    })
    // A tab id already open is activated, not duplicated.
    actions.openRightTab(session, { id: 'home', kind: 'home' })
    actions.openRightTab(session, { id: 'files', kind: 'files' })
    actions.openRightTab(session, { id: 'viewer:/work/a.md', kind: 'viewer', path: '/work/a.md' })
    actions.openRightTab(session, { id: 'viewer:/work/b.md', kind: 'viewer', path: '/work/b.md' })
    expect(store.getSnapshot().rightPanels['s1']?.tabs.map(tab => tab.id)).toEqual([
      'home', 'files', 'viewer:/work/a.md', 'viewer:/work/b.md',
    ])

    actions.activateRightTab(session, 'home')
    expect(store.getSnapshot().rightPanels['s1']?.activeTabId).toBe('home')
    // An unknown tab and an unknown session are ignored.
    actions.activateRightTab(session, 'missing')
    expect(store.getSnapshot().rightPanels['s1']?.activeTabId).toBe('home')
    actions.activateRightTab('s2' as SessionId, 'home')
    expect(store.getSnapshot().rightPanels['s2']).toBeUndefined()

    // Closing the active tab activates its previous neighbour.
    actions.activateRightTab(session, 'viewer:/work/b.md')
    actions.closeRightTab(session, 'viewer:/work/b.md')
    expect(store.getSnapshot().rightPanels['s1']?.activeTabId).toBe('viewer:/work/a.md')

    // Closing the active first tab falls to the new first one.
    actions.activateRightTab(session, 'home')
    actions.closeRightTab(session, 'home')
    expect(store.getSnapshot().rightPanels['s1']?.activeTabId).toBe('files')

    // Closing a non-active tab leaves the active one alone; unknown ids and
    // sessions write nothing.
    actions.closeRightTab(session, 'viewer:/work/a.md')
    expect(store.getSnapshot().rightPanels['s1']?.activeTabId).toBe('files')
    actions.closeRightTab(session, 'missing')
    actions.closeRightTab('s2' as SessionId, 'home')
    expect(store.getSnapshot().rightPanels['s1']?.tabs.map(tab => tab.id)).toEqual(['files'])

    // The last close leaves the session bucket empty and inactive.
    actions.closeRightTab(session, 'files')
    expect(store.getSnapshot().rightPanels['s1']).toEqual({ tabs: [], activeTabId: null, files: {} })
  })

  it('keeps one files tree per files tab and ignores writers without a bucket', () => {
    const { actions, store } = createBoardStore().create()

    // Every writer is a no-op until a bucket exists.
    actions.filesLoading(session, 'files', '/root')
    actions.filesLoaded(session, 'files', '/root', { entries: [], truncated: false })
    actions.filesFailed(session, 'files', '/root', 'code', 'message')
    actions.filesToggle(session, 'files', '/root')
    actions.filesReset(session, 'files')
    expect(store.getSnapshot().rightPanels).toEqual({})

    // Start seeds the root as expanded and is idempotent.
    actions.filesStart(session, 'files', '/root')
    actions.filesStart(session, 'files', '/other')
    expect(store.getSnapshot().rightPanels['s1']?.files['files']).toEqual({
      root: '/root', levels: {}, expanded: ['/root'],
    })

    actions.filesToggle(session, 'files', '/root/sub')
    expect(store.getSnapshot().rightPanels['s1']?.files['files']?.expanded).toEqual(['/root', '/root/sub'])
    actions.filesToggle(session, 'files', '/root/sub')
    expect(store.getSnapshot().rightPanels['s1']?.files['files']?.expanded).toEqual(['/root'])

    actions.filesLoading(session, 'files', '/root')
    expect(store.getSnapshot().rightPanels['s1']?.files['files']?.levels['/root']).toEqual({ kind: 'loading' })
    actions.filesLoaded(session, 'files', '/root', {
      entries: [{ name: 'a.txt', type: 'file' }], truncated: true,
    })
    expect(store.getSnapshot().rightPanels['s1']?.files['files']?.levels['/root']).toEqual({
      kind: 'ready', entries: [{ name: 'a.txt', type: 'file' }], truncated: true,
    })
    actions.filesFailed(session, 'files', '/root/sub', 'workspace-file/not-found', 'missing')
    expect(store.getSnapshot().rightPanels['s1']?.files['files']?.levels['/root/sub']).toEqual({
      kind: 'failed', code: 'workspace-file/not-found', message: 'missing',
    })

    actions.filesReset(session, 'files')
    expect(store.getSnapshot().rightPanels['s1']?.files['files']?.levels).toEqual({})

    // Closing the tab takes its tree with it.
    actions.openRightTab(session, { id: 'files', kind: 'files' })
    actions.closeRightTab(session, 'files')
    expect(store.getSnapshot().rightPanels['s1']?.files['files']).toBeUndefined()
  })
})
