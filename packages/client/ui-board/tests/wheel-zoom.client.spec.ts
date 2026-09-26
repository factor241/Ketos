// @vitest-environment jsdom
/** Wheel decisions and zoom math, table-driven over the target × modifier × mode × fullscreen axes. */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  classifyBoardWheel, resolveBoardWheel, wheelPanDelta, wheelZoomFactor,
  type BoardWheelEvent,
} from '../src/client/wheel-zoom.ts'

/** The board fixture every classification row picks its target from. */
function boardFixture(): void {
  document.body.innerHTML = `
    <nav aria-label="Global panels"><button class="sidebar-button">panel</button></nav>
    <div id="board" data-surface="board">
      <div data-surface="canvas" data-board-layer="canvas">
        <div data-surface="canvas-layer">
          <div data-board-window="agent">
            <div class="lane"><textarea class="lane-input"></textarea></div>
            <div data-board-panel-rail=""><button class="rail-button">rail</button></div>
          </div>
          <div data-board-panel="beside"><div class="panel-rows">rows</div></div>
        </div>
      </div>
      <div data-board-layer="dock"><button class="dock-button">add</button></div>
      <div data-board-layer="omnibar"><button class="omnibar-button">send</button></div>
      <div data-board-minimap=""></div>
      <div role="menu"><div role="menuitem" class="menu-row">row</div></div>
    </div>
  `
}

/** Resolve one fixture selector; a miss fails at the call site. */
function targetAt(selector: string): Element {
  const found = document.querySelector(selector)
  if (found === null) throw new Error(`missing wheel target ${selector}`)
  return found
}

/** Wheel fields with every axis at its neutral value. */
function wheelEvent(overrides: Partial<BoardWheelEvent> = {}): BoardWheelEvent {
  return { ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 0, deltaMode: 0, shiftKey: false, ...overrides }
}

describe('classifyBoardWheel', () => {
  beforeEach(boardFixture)

  const insideBoard = [
    ['the canvas', '[data-surface="canvas"]'],
    ['the canvas layer', '[data-surface="canvas-layer"]'],
    ['the board root', '#board'],
    ['a window frame', '[data-board-window]'],
    ['a window lane', '.lane-input'],
    ['a collapsed chats rail', '[data-board-panel-rail]'],
    ['the open chats panel', '.panel-rows'],
    ['the dock', '.dock-button'],
    ['the omnibar', '.omnibar-button'],
    ['the minimap', '[data-board-minimap]'],
    ['a scrollable menu', '.menu-row'],
  ] as const

  it('zooms for ctrl/meta anywhere inside the board, scrolling surfaces included (П-01)', () => {
    for (const [label, selector] of insideBoard) {
      for (const modifier of [{ ctrlKey: true }, { metaKey: true }] as const) {
        for (const mode of ['pan', 'zoom'] as const) {
          expect(classifyBoardWheel(wheelEvent(modifier), targetAt(selector), mode), `${label} · ${JSON.stringify(modifier)} · ${mode}`)
            .toBe('zoom')
        }
      }
    }
  })

  it('stays native for a plain wheel over a lane, the chats panel, or a menu', () => {
    for (const selector of ['.lane-input', '[data-board-panel-rail]', '.panel-rows', '.menu-row']) {
      for (const mode of ['pan', 'zoom'] as const) {
        expect(classifyBoardWheel(wheelEvent(), targetAt(selector), mode), `${selector} · ${mode}`).toBe('native')
      }
    }
  })

  it('pans the canvas and the floating chrome in pan mode and zooms them in zoom mode', () => {
    for (const selector of ['[data-surface="canvas"]', '[data-surface="canvas-layer"]', '.dock-button', '.omnibar-button', '[data-board-minimap]', '#board']) {
      for (const mode of ['pan', 'zoom'] as const) {
        expect(classifyBoardWheel(wheelEvent(), targetAt(selector), mode), `${selector} · ${mode}`).toBe(mode)
      }
    }
  })

  it('takes nothing outside the board', () => {
    for (const target of [targetAt('.sidebar-button'), targetAt('nav'), document, null]) {
      expect(classifyBoardWheel(wheelEvent({ ctrlKey: true }), target, 'pan')).toBe('native')
      expect(classifyBoardWheel(wheelEvent(), target, 'zoom')).toBe('native')
    }
  })
})

describe('resolveBoardWheel', () => {
  beforeEach(boardFixture)

  const rows = [
    {
      name: 'ctrl over a window zooms and is prevented (П-01)',
      selector: '[data-board-window]', event: { ctrlKey: true }, mode: 'pan', fullscreen: false,
      expected: { classification: 'zoom', preventDefault: true, apply: true },
    },
    {
      name: 'ctrl over a window in fullscreen is prevented but does not zoom',
      selector: '[data-board-window]', event: { ctrlKey: true }, mode: 'zoom', fullscreen: true,
      expected: { classification: 'zoom', preventDefault: true, apply: false },
    },
    {
      name: 'ctrl over the chats panel is prevented in fullscreen too',
      selector: '.panel-rows', event: { metaKey: true }, mode: 'pan', fullscreen: true,
      expected: { classification: 'zoom', preventDefault: true, apply: false },
    },
    {
      name: 'a plain wheel over the canvas pans in pan mode',
      selector: '[data-surface="canvas"]', event: {}, mode: 'pan', fullscreen: false,
      expected: { classification: 'pan', preventDefault: true, apply: true },
    },
    {
      name: 'a plain wheel over the dock zooms in zoom mode',
      selector: '.dock-button', event: {}, mode: 'zoom', fullscreen: false,
      expected: { classification: 'zoom', preventDefault: true, apply: true },
    },
    {
      name: 'a plain wheel over a lane keeps the lane scrolling',
      selector: '.lane-input', event: {}, mode: 'pan', fullscreen: false,
      expected: { classification: 'native', preventDefault: false, apply: false },
    },
    {
      name: 'ctrl outside the board stays native',
      selector: '.sidebar-button', event: { ctrlKey: true }, mode: 'pan', fullscreen: false,
      expected: { classification: 'native', preventDefault: false, apply: false },
    },
  ] as const

  it('resolves the fullscreen and preventDefault rules', () => {
    for (const row of rows) {
      expect(
        resolveBoardWheel(wheelEvent(row.event), targetAt(row.selector), row.mode, row.fullscreen),
        row.name,
      ).toEqual(row.expected)
    }
  })
})

describe('wheelPanDelta', () => {
  it('keeps both axes without shift and swaps them with shift', () => {
    expect(wheelPanDelta({ deltaX: 12, deltaY: 30, shiftKey: false })).toEqual({ x: 12, y: 30 })
    expect(wheelPanDelta({ deltaX: 0, deltaY: 30, shiftKey: true })).toEqual({ x: 30, y: 0 })
    expect(wheelPanDelta({ deltaX: 12, deltaY: 30, shiftKey: true })).toEqual({ x: 30, y: 12 })
  })
})

describe('wheelZoomFactor', () => {
  const k = 0.0023

  it('is proportional in pixel mode', () => {
    expect(wheelZoomFactor({ deltaY: -40, deltaMode: 0 }, 900, k)).toBeCloseTo(Math.exp(40 * k))
    expect(wheelZoomFactor({ deltaY: 0, deltaMode: 0 }, 900, k)).toBe(1)
  })

  it('clamps one event to ±50px', () => {
    expect(wheelZoomFactor({ deltaY: -1_000, deltaMode: 0 }, 900, k)).toBeCloseTo(Math.exp(50 * k))
    expect(wheelZoomFactor({ deltaY: 1_000, deltaMode: 0 }, 900, k)).toBeCloseTo(Math.exp(-50 * k))
  })

  it('normalizes line and page deltas', () => {
    expect(wheelZoomFactor({ deltaY: -2, deltaMode: 1 }, 900, k)).toBeCloseTo(Math.exp(32 * k))
    // A page is the board height: 1 page × 20px height stays unclamped.
    expect(wheelZoomFactor({ deltaY: -1, deltaMode: 2 }, 20, k)).toBeCloseTo(Math.exp(20 * k))
    expect(wheelZoomFactor({ deltaY: -1, deltaMode: 2 }, 900, k)).toBeCloseTo(Math.exp(50 * k))
  })

  it('treats an unknown delta unit as pixels', () => {
    expect(wheelZoomFactor({ deltaY: -10, deltaMode: 7 }, 900, k)).toBeCloseTo(Math.exp(10 * k))
  })
})
