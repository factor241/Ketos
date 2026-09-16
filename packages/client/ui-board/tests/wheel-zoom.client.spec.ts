// @vitest-environment jsdom
/** Wheel priority: which board surface owns a wheel event. */
import { describe, expect, it } from 'vitest'
import { wheelZoomsBoard } from '../src/client/canvas/wheel-zoom.ts'

describe('wheelZoomsBoard', () => {
  it('takes events from the canvas and from the floating chrome', () => {
    document.body.innerHTML = `
      <div data-surface="board">
        <div data-surface="canvas"></div>
        <div data-board-layer="dock"><button>Add</button></div>
      </div>
    `
    const board = document.querySelector('[data-surface="board"]') as HTMLElement
    expect(wheelZoomsBoard(board)).toBe(true)
    expect(wheelZoomsBoard(document.querySelector('[data-surface="canvas"]'))).toBe(true)
    expect(wheelZoomsBoard(document.querySelector('[data-board-layer="dock"] button'))).toBe(true)
  })

  it('leaves wheel events to a window lane and to an open chats panel', () => {
    document.body.innerHTML = `
      <div data-surface="board">
        <div data-board-window="agent"><div class="lane">text</div></div>
        <div data-board-panel="beside"><div class="rows">rows</div></div>
      </div>
    `
    expect(wheelZoomsBoard(document.querySelector('[data-board-window] .lane'))).toBe(false)
    expect(wheelZoomsBoard(document.querySelector('[data-board-panel] .rows'))).toBe(false)
  })

  it('takes nothing outside the board', () => {
    document.body.innerHTML = '<div class="app">elsewhere</div>'
    expect(wheelZoomsBoard(document.querySelector('.app'))).toBe(false)
    expect(wheelZoomsBoard(null)).toBe(false)
    expect(wheelZoomsBoard(document)).toBe(false)
  })
})
