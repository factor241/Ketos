// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { createBoardStore } from '../src/client/store.ts'
import type { BoardWindowState, WindowId } from '../src/client/contract/slots.ts'

describe('createBoardStore', () => {
  it('initializes with default pan, zoom, and empty windows', () => {
    const { store } = createBoardStore().create()
    const snapshot = store.getSnapshot()
    expect(snapshot.panX).toBe(0)
    expect(snapshot.panY).toBe(0)
    expect(snapshot.zoom).toBe(1)
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

  it('adds, moves, and snaps windows to 24px grid', () => {
    const { store, actions } = createBoardStore().create()
    const win: BoardWindowState = {
      id: 'win-1' as WindowId,
      kind: 'agent',
      title: 'Agent 1',
      x: 100,
      y: 100,
      width: 400,
      height: 500,
      zIndex: 10,
    }

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

  it('resizes windows with 24px snap and minimum bounds', () => {
    const { store, actions } = createBoardStore().create()
    const win: BoardWindowState = {
      id: 'win-1' as WindowId,
      kind: 'agent',
      title: 'Agent 1',
      x: 0,
      y: 0,
      width: 400,
      height: 500,
      zIndex: 10,
    }
    actions.addWindow(win)

    // Resize below minimum bounds (min 320x200)
    actions.resizeWindow('win-1' as WindowId, 100, 50, false)
    expect(store.getSnapshot().windows['win-1']?.width).toBe(320)
    expect(store.getSnapshot().windows['win-1']?.height).toBe(200)

    // Resize with snap
    actions.resizeWindow('win-1' as WindowId, 485, 602, true)
    expect(store.getSnapshot().windows['win-1']?.width).toBe(480) // 24 * 20
    expect(store.getSnapshot().windows['win-1']?.height).toBe(600) // 24 * 25
  })

  it('manages window focus and z-index ordering', () => {
    const { store, actions } = createBoardStore().create()
    const win1: BoardWindowState = { id: 'w1' as WindowId, kind: 'agent', title: '1', x: 0, y: 0, width: 400, height: 400, zIndex: 10 }
    const win2: BoardWindowState = { id: 'w2' as WindowId, kind: 'connectors', title: '2', x: 50, y: 50, width: 400, height: 400, zIndex: 11 }

    actions.addWindow(win1)
    actions.addWindow(win2)
    expect(store.getSnapshot().activeWindowId).toBe('w2')

    // Focus win1
    actions.focusWindow('w1' as WindowId)
    const snap = store.getSnapshot()
    expect(snap.activeWindowId).toBe('w1')
    expect(snap.windowOrder).toEqual(['w2', 'w1'])
    expect(snap.windows['w1']?.zIndex).toBe(11)
    expect(snap.windows['w2']?.zIndex).toBe(10)

    // Close win1
    actions.closeWindow('w1' as WindowId)
    const closedSnap = store.getSnapshot()
    expect(closedSnap.windows['w1']).toBeUndefined()
    expect(closedSnap.activeWindowId).toBe('w2')
  })

  it('toggles spatial element selection state', () => {
    const { store, actions } = createBoardStore().create()
    actions.setSelectingElement(true)
    expect(store.getSnapshot().isSelectingElement).toBe(true)
    actions.setSelectingElement(false)
    expect(store.getSnapshot().isSelectingElement).toBe(false)
  })
})
