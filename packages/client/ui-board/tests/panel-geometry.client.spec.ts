/**
 * Chats panel geometry: the compact strip hides under its window's left edge
 * (about a fifth of the window area), the docked panel takes the board panel's
 * left edge in fullscreen, and both widths stay inside the readable range.
 */
import { describe, expect, it } from 'vitest'
import { dockedPanelRect, panelWidthFor, windowedPanelRect } from '../src/client/window/panel-geometry.ts'
import type { BoardWindowState } from '../src/client/contract/slots.ts'
import type { WindowId } from '../src/client/contract/slots.ts'

const WINDOW: BoardWindowState = {
  id: 'agent-1' as WindowId,
  kind: 'agent',
  bodyKind: 'conversation',
  title: 'Agent',
  x: 300,
  y: 200,
  width: 800,
  height: 700,
  zIndex: 10,
}

describe('panelWidthFor', () => {
  it('takes a share of the space and clamps it to the readable range', () => {
    // 26% of 800 is 208, under the readable floor; 1200 keeps the ratio; 2000 hits the cap.
    expect(panelWidthFor(800)).toBe(220)
    expect(panelWidthFor(1200)).toBe(312)
    expect(panelWidthFor(2000)).toBe(320)
  })
})

const VIEW = { left: 0, right: 2000 }

describe('windowedPanelRect', () => {
  it('tucks most of the panel under the frame and keeps the strip visible', () => {
    const rect = windowedPanelRect(WINDOW, VIEW)
    expect(rect.width).toBe(panelWidthFor(WINDOW.width))
    expect(rect.height).toBeCloseTo(WINDOW.height * 0.92, 5)
    // The right 30% of the panel hides under the frame, so it reads as a layer below.
    expect(rect.left + rect.width * 0.7).toBeCloseTo(WINDOW.x, 5)
    // The panel sits vertically centred on the window.
    expect(rect.top).toBeCloseTo(WINDOW.y + WINDOW.height * 0.04, 5)
  })

  it('flips to the frame right edge when the left side leaves the visible panel', () => {
    const rect = windowedPanelRect({ ...WINDOW, x: 10 }, { left: 0, right: 2000 })
    expect(rect.left).toBeCloseTo(10 + WINDOW.width - rect.width + rect.width * 0.3, 5)
  })
})

describe('dockedPanelRect', () => {
  it('docks to the board panel edge at full height', () => {
    const rect = dockedPanelRect(1000, 800)
    expect(rect).toEqual({ left: 0, top: 0, width: panelWidthFor(1000), height: 800 })
  })
})
