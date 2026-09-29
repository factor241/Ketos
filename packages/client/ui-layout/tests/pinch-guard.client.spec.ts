// @vitest-environment jsdom
/** Page pinch-zoom guard: blocked outside the board, delegated inside it. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installPagePinchGuard } from '../src/client/pinch-guard.ts'

let root: HTMLElement
/** Disposers of the guards installed by one test; the document outlives them. */
let disposers: Array<() => void>

/** Install the guard on the fixture root and remember its disposer. */
function install(block: boolean): () => void {
  const dispose = installPagePinchGuard(root, block)
  disposers.push(dispose)
  return dispose
}

beforeEach(() => {
  disposers = []
  document.body.innerHTML = `
    <div id="app">
      <nav class="sidebar"><span class="label">panel</span></nav>
      <div data-surface="board"><div data-board-window="agent"></div></div>
    </div>
  `
  root = document.querySelector('#app') as HTMLElement
})

afterEach(() => {
  for (const dispose of disposers) dispose()
})

/** Resolve one fixture element; a miss fails at the call site. */
function element(selector: string): Element {
  const found = root.querySelector(selector)
  if (found === null) throw new Error(`missing fixture element ${selector}`)
  return found
}

/** Dispatch a ctrl+wheel event and report whether the guard prevented it. */
function wheel(target: EventTarget, ctrlKey: boolean): boolean {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey, deltaY: -100 })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

/** Dispatch one Safari gesture event and report whether the guard prevented it. */
function gesture(target: EventTarget, type: 'gesturestart' | 'gesturechange' | 'gestureend'): boolean {
  const event = new Event(type, { bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

describe('installPagePinchGuard', () => {
  it('blocks ctrl+wheel and gestures outside the board and delegates inside it', () => {
    install(true)

    expect(wheel(element('.sidebar'), true)).toBe(true)
    expect(wheel(element('.sidebar'), false)).toBe(false)
    expect(wheel(element('[data-surface="board"]'), true)).toBe(false)

    for (const type of ['gesturestart', 'gesturechange', 'gestureend'] as const) {
      expect(gesture(element('.sidebar'), type), type).toBe(true)
      expect(gesture(element('[data-surface="board"]'), type), type).toBe(false)
    }
  })

  it('blocks an event whose target is not an element', () => {
    install(true)
    const text = element('.sidebar').appendChild(document.createTextNode('panel'))
    expect(wheel(text, true)).toBe(true)
  })

  it('blocks a pinch over a portal mounted in document.body (П-37)', () => {
    install(true)
    // Menus, tooltips, and dialogs portal into document.body, outside the
    // shell frame's subtree: the guard must still see their events.
    const portal = document.body.appendChild(document.createElement('div'))
    portal.innerHTML = '<div role="menu"><span class="item">row</span></div>'
    expect(wheel(portal, true)).toBe(true)
    expect(gesture(portal, 'gesturestart')).toBe(true)
    // A board-owned popover rides the board root and keeps its own pinch.
    const boardPortal = element('[data-surface="board"]').appendChild(document.createElement('div'))
    expect(wheel(boardPortal, true)).toBe(false)
  })

  it('installs nothing when blocking is off and removes every listener on dispose', () => {
    const disabled = install(false)
    expect(wheel(element('.sidebar'), true)).toBe(false)
    disabled()

    const dispose = install(true)
    expect(wheel(element('.sidebar'), true)).toBe(true)
    dispose()
    expect(wheel(element('.sidebar'), true)).toBe(false)
    expect(gesture(element('.sidebar'), 'gesturestart')).toBe(false)
  })
})
