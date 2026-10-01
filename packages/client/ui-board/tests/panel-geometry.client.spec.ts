/**
 * Window panel geometry: each of the window's two panels is a resizable column
 * beside its own edge, at the frame's height; an absent field reads as closed
 * or as the side's default width.
 */
import { describe, expect, it } from 'vitest'
import {
  PANEL_LEFT_DEFAULT_WIDTH, PANEL_LEFT_MAX_WIDTH, PANEL_RIGHT_DEFAULT_WIDTH, PANEL_RIGHT_MAX_WIDTH,
} from '../src/board-settings.ts'
import {
  windowPanelOpen, windowPanelRect, windowPanelWidth,
} from '../src/client/window/panel-geometry.ts'
import type { BoardWindowState, WindowId } from '../src/client/contract/slots.ts'

const WINDOW: BoardWindowState = {
  id: 'agent-1' as WindowId,
  kind: 'agent',
  bodyKind: 'conversation',
  ordinal: 1,
  x: 500,
  y: 200,
  width: 800,
  height: 700,
  zIndex: 10,
}

describe('windowPanelOpen', () => {
  it('reads an absent field as closed and an explicit flag as itself', () => {
    expect(windowPanelOpen(WINDOW, 'left')).toBe(false)
    expect(windowPanelOpen(WINDOW, 'right')).toBe(false)
    expect(windowPanelOpen({ ...WINDOW, leftPanelOpen: true }, 'left')).toBe(true)
    expect(windowPanelOpen({ ...WINDOW, rightPanelOpen: true }, 'right')).toBe(true)
  })
})

describe('windowPanelWidth', () => {
  it('falls back to the side default and reads a stored width', () => {
    expect(windowPanelWidth(WINDOW, 'left')).toBe(PANEL_LEFT_DEFAULT_WIDTH)
    expect(windowPanelWidth(WINDOW, 'right')).toBe(PANEL_RIGHT_DEFAULT_WIDTH)
    expect(windowPanelWidth({ ...WINDOW, leftPanelWidth: PANEL_LEFT_MAX_WIDTH }, 'left')).toBe(PANEL_LEFT_MAX_WIDTH)
    expect(windowPanelWidth({ ...WINDOW, rightPanelWidth: PANEL_RIGHT_MAX_WIDTH }, 'right')).toBe(PANEL_RIGHT_MAX_WIDTH)
  })
})

describe('windowPanelRect', () => {
  it('places each panel flush beside its own frame edge at the window height', () => {
    expect(windowPanelRect(WINDOW, 'left')).toEqual({
      left: WINDOW.x - PANEL_LEFT_DEFAULT_WIDTH,
      top: WINDOW.y,
      width: PANEL_LEFT_DEFAULT_WIDTH,
      height: WINDOW.height,
    })
    expect(windowPanelRect(WINDOW, 'right')).toEqual({
      left: WINDOW.x + WINDOW.width,
      top: WINDOW.y,
      width: PANEL_RIGHT_DEFAULT_WIDTH,
      height: WINDOW.height,
    })
  })

  it('uses the stored width on each side independently', () => {
    const sized = { ...WINDOW, leftPanelWidth: 300, rightPanelWidth: 480 }
    expect(windowPanelRect(sized, 'left')).toEqual({ left: WINDOW.x - 300, top: WINDOW.y, width: 300, height: WINDOW.height })
    expect(windowPanelRect(sized, 'right')).toEqual({
      left: WINDOW.x + WINDOW.width,
      top: WINDOW.y,
      width: 480,
      height: WINDOW.height,
    })
  })
})
