/**
 * Chats panel geometry: the open panel is a resizable column beside its window
 * (the width clamps to a readable range and a share of the window), the
 * collapsed rail hugs the frame's edge, fullscreen docks the panel, and a
 * window covering the canvas keeps the panel inside its own left edge.
 */
import { describe, expect, it } from 'vitest'
import {
  PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, PANEL_RAIL_HEIGHT, PANEL_RAIL_WIDTH,
  dockedPanelRect, panelPresentation, panelWidthFor, railRect, windowedPanelRect,
} from '../src/client/window/panel-geometry.ts'
import type { BoardWindowState, WindowId } from '../src/client/contract/slots.ts'

const WINDOW: BoardWindowState = {
  id: 'agent-1' as WindowId,
  kind: 'agent',
  bodyKind: 'conversation',
  title: 'Agent',
  x: 500,
  y: 200,
  width: 800,
  height: 700,
  zIndex: 10,
}

const VIEW = { left: 0, right: 2000 }

describe('panelWidthFor', () => {
  it('keeps the requested width inside the readable range and the window share', () => {
    expect(panelWidthFor(800, 300)).toBe(300)
    // Below the floor and above the cap.
    expect(panelWidthFor(800, 100)).toBe(PANEL_MIN_WIDTH)
    expect(panelWidthFor(2000, 999)).toBe(PANEL_MAX_WIDTH)
    // A narrow window caps the width at 45% of its own, never below the floor.
    expect(panelWidthFor(600, 400)).toBe(270)
    expect(panelWidthFor(400, 400)).toBe(PANEL_MIN_WIDTH)
  })
})

describe('windowedPanelRect', () => {
  it('places the panel flush beside the frame at the window height', () => {
    const rect = windowedPanelRect(WINDOW, VIEW, 320)
    expect(rect).toEqual({ left: WINDOW.x - 320, top: WINDOW.y, width: 320, height: WINDOW.height })
  })

  it('takes the right edge when the left side leaves the visible panel', () => {
    const rect = windowedPanelRect({ ...WINDOW, x: 40 }, VIEW, 320)
    expect(rect.left).toBe(40 + WINDOW.width)
    expect(panelPresentation({ ...WINDOW, x: 40 }, VIEW, 320)).toEqual({ kind: 'beside', side: 'right' })
  })

  it('rides inside the window when neither side has room', () => {
    const covered = { ...WINDOW, x: 0, width: 2000 }
    expect(panelPresentation(covered, VIEW, 320)).toEqual({ kind: 'overlay' })
    expect(windowedPanelRect(covered, VIEW, 320)).toEqual({ left: 0, top: WINDOW.y, width: 320, height: WINDOW.height })
  })
})

describe('railRect', () => {
  it('centres the compact rail on the frame edge it opens from', () => {
    expect(railRect(WINDOW, 'left')).toEqual({
      left: WINDOW.x - PANEL_RAIL_WIDTH,
      top: WINDOW.y + (WINDOW.height - PANEL_RAIL_HEIGHT) / 2,
      width: PANEL_RAIL_WIDTH,
      height: PANEL_RAIL_HEIGHT,
    })
    expect(railRect(WINDOW, 'right').left).toBe(WINDOW.x + WINDOW.width)
  })
})

describe('dockedPanelRect', () => {
  it('docks to the board panel edge at full height', () => {
    expect(dockedPanelRect(1000, 800, 320)).toEqual({ left: 0, top: 0, width: 320, height: 800 })
    // Never wider than the panel it docks into.
    expect(dockedPanelRect(300, 800, 420).width).toBe(300)
  })
})
