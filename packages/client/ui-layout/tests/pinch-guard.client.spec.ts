// @vitest-environment jsdom
/** Page pinch-zoom guard: blocked outside the board, delegated inside it. */
import { beforeEach, describe, expect, it } from 'vitest'
import { installPagePinchGuard } from '../src/client/pinch-guard.ts'

let root: HTMLElement

beforeEach(() => {
  document.body.innerHTML = `
    <div id="app">
      <nav class="sidebar"><span class="label">panel</span></nav>
      <div data-surface="board"><div data-board-window="agent"></div></div>
    </div>
  `
  root = document.querySelector('#app') as HTMLElement
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
    installPagePinchGuard(root, true)

    expect(wheel(element('.sidebar'), true)).toBe(true)
    expect(wheel(element('.sidebar'), false)).toBe(false)
    expect(wheel(element('[data-surface="board"]'), true)).toBe(false)

    for (const type of ['gesturestart', 'gesturechange', 'gestureend'] as const) {
      expect(gesture(element('.sidebar'), type), type).toBe(true)
      expect(gesture(element('[data-surface="board"]'), type), type).toBe(false)
    }
  })

  it('blocks an event whose target is not an element', () => {
    installPagePinchGuard(root, true)
    const text = element('.sidebar').appendChild(document.createTextNode('panel'))
    expect(wheel(text, true)).toBe(true)
  })

  it('installs nothing when blocking is off and removes every listener on dispose', () => {
    const disabled = installPagePinchGuard(root, false)
    expect(wheel(element('.sidebar'), true)).toBe(false)
    disabled()

    const dispose = installPagePinchGuard(root, true)
    expect(wheel(element('.sidebar'), true)).toBe(true)
    dispose()
    expect(wheel(element('.sidebar'), true)).toBe(false)
    expect(gesture(element('.sidebar'), 'gesturestart')).toBe(false)
  })
})
