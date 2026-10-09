// @vitest-environment jsdom
/**
 * Window bezel: the owner color and management attributes, the bezel layer
 * with its owner mark and access indicator, dragging by the bezel background,
 * the simplified mode's edge-only presentation, and clearing the active
 * window from the empty canvas.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent } from '@testing-library/react'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { createBoardStore } from '../src/client/store.ts'
import type { OwnerId } from '../src/client/owners.ts'
import type { WindowId } from '../src/client/contract/slots.ts'
import { createBoardBench } from './fixtures.client.ts'
import frameCss from '../src/client/window/WindowFrame.module.css'

type BoardInstance = ReturnType<ReturnType<typeof createBoardStore>['create']>

const runtimes = new Set<SlotTestRuntime>()

afterEach(async () => {
  try {
    for (const runtime of runtimes) await runtime.dispose()
  } finally {
    runtimes.clear()
    cleanup()
  }
})

beforeAll(() => {
  // jsdom implements no pointer capture; the drag gesture only needs deltas.
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true, writable: true })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { value: () => {}, configurable: true, writable: true })
})

afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  Reflect.deleteProperty(HTMLElement.prototype, 'releasePointerCapture')
})

/** Bench with a live board and the fixture session its windows bind to. */
async function bench() {
  const prepared = await createBoardBench({ session: {} })
  runtimes.add(prepared.runtime)
  await prepared.mountBoard()
  const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
  const store = prepared.runtime.storeOf('board.dock') as BoardInstance
  return { prepared, panel, store }
}

/** One agent-window spec; the store fills placement, owner, and access. */
function windowSpec(
  id: string,
  overrides: Partial<Parameters<BoardInstance['actions']['openWindow']>[0]> = {},
): Parameters<BoardInstance['actions']['openWindow']>[0] {
  return { id: id as WindowId, kind: 'agent', bodyKind: 'conversation', ordinal: 1, width: 552, height: 648, ...overrides }
}

/** One rendered window frame; a miss fails at the call site. */
function frameOf(panel: { container: HTMLElement }, id: string): HTMLElement {
  const frame = panel.container.querySelector(`[data-board-window-id="${id}"]`)
  if (frame === null) throw new Error(`window ${id} is missing`)
  return frame as HTMLElement
}

/** The bezel inside one window frame; a miss fails at the call site. */
function bezelOf(panel: { container: HTMLElement }, id: string): HTMLElement {
  const bezel = frameOf(panel, id).querySelector('[data-board-bezel]')
  if (bezel === null) throw new Error(`bezel of ${id} is missing`)
  return bezel as HTMLElement
}

/** One open menu row by its visible text; a miss fails at the call site. */
function menuRow(text: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find(candidate => candidate.textContent?.trim() === text)
  if (row === undefined) throw new Error(`menu row "${text}" is missing`)
  return row
}

describe('window owner attributes', () => {
  it('marks each window with its owner color and management flag', async () => {
    const { prepared, panel, store } = await bench()
    act(() => {
      store.actions.openWindow(windowSpec('a1'))
      store.actions.openWindow(windowSpec('a2', { ownerId: brandString<OwnerId>('demo-legal') }))
      store.actions.openWindow(windowSpec('a3', { ownerId: brandString<OwnerId>('demo-stranger') }))
    })
    await prepared.runtime.flush()

    expect(frameOf(panel, 'a1').getAttribute('data-board-owner-color')).toBe('1')
    expect(frameOf(panel, 'a2').getAttribute('data-board-owner-color')).toBe('3')
    expect(frameOf(panel, 'a3').getAttribute('data-board-owner-color')).toBe('unknown')
    // Only the acting owner manages a window.
    expect(frameOf(panel, 'a1').hasAttribute('data-board-manageable')).toBe(true)
    expect(frameOf(panel, 'a2').hasAttribute('data-board-manageable')).toBe(false)
  })

  it('keeps the owner color but drops the bezel below the detail threshold', async () => {
    const { prepared, panel, store } = await bench()
    act(() => { store.actions.openWindow(windowSpec('a1')) })
    await prepared.runtime.flush()
    expect(frameOf(panel, 'a1').querySelector('[data-board-bezel]')).not.toBeNull()

    act(() => { store.actions.setZoom(0.3) })
    await prepared.runtime.flush()
    // Simplified mode: the edge stays, the full bezel is not rendered.
    expect(frameOf(panel, 'a1').querySelector('[data-board-bezel]')).toBeNull()
    expect(frameOf(panel, 'a1').getAttribute('data-board-owner-color')).toBe('1')

    act(() => { store.actions.setZoom(1) })
    await prepared.runtime.flush()
    expect(frameOf(panel, 'a1').querySelector('[data-board-bezel]')).not.toBeNull()
  })

  it('writes the panel-open attributes the bezel side rules read', async () => {
    const { prepared, panel, store } = await bench()
    act(() => { store.actions.openWindow(windowSpec('a1')) })
    await prepared.runtime.flush()
    expect(frameOf(panel, 'a1').hasAttribute('data-board-panel-left-open')).toBe(false)

    act(() => { store.actions.setWindowPanel('a1' as WindowId, 'left', true) })
    await prepared.runtime.flush()
    expect(frameOf(panel, 'a1').getAttribute('data-board-panel-left-open')).toBe('')
    expect(frameOf(panel, 'a1').hasAttribute('data-board-panel-right-open')).toBe(false)

    act(() => { store.actions.setWindowPanel('a1' as WindowId, 'left', false) })
    await prepared.runtime.flush()
    expect(frameOf(panel, 'a1').hasAttribute('data-board-panel-left-open')).toBe(false)
  })
})

describe('window bezel content', () => {
  it('shows the owner mark and the owner-only access mode', async () => {
    const { prepared, panel, store } = await bench()
    act(() => { store.actions.openWindow(windowSpec('a1')) })
    await prepared.runtime.flush()

    const bezel = bezelOf(panel, 'a1')
    expect(bezel.textContent).toContain('Kirill')
    expect(bezel.textContent).toContain('Only me')
    // The owner mark and the access indicator; both are menu triggers for the
    // acting owner.
    expect(bezel.querySelectorAll('[data-board-bezel-item]')).toHaveLength(2)
    expect(bezel.querySelector('[aria-label="Access: Only me"]')).not.toBeNull()
  })

  it('stacks up to three selected people with their own colors and a +N remainder', async () => {
    const { prepared, panel, store } = await bench()
    act(() => { store.actions.openWindow(windowSpec('a1')) })
    await prepared.runtime.flush()

    act(() => {
      store.actions.setWindowAccess('a1' as WindowId, {
        mode: 'selected',
        people: ['demo-stranger', 'demo-finance', 'demo-legal', 'demo-analyst', 'remote-1']
          .map(id => brandString<OwnerId>(id)),
      })
    })
    await prepared.runtime.flush()

    const bezel = bezelOf(panel, 'a1')
    const circles = [...bezel.querySelectorAll('[data-board-owner-color]')]
    // The unknown id keeps the neutral slot; the rest take their palette slot.
    expect(circles.map(circle => circle.getAttribute('data-board-owner-color'))).toEqual(['unknown', '2', '3'])
    expect(bezel.textContent).toContain('+2')
    // The accessible name lists every selected person, not only the three circles.
    const named = bezel.querySelector('[aria-label^="Access: Selected people: "]')
    expect(named).not.toBeNull()
    expect(named?.getAttribute('aria-label')?.split(': ')[2]?.split(', ')).toHaveLength(5)
  })

  it('names the mode when the selected list is empty and shows the all-participants mode', async () => {
    const { prepared, panel, store } = await bench()
    act(() => { store.actions.openWindow(windowSpec('a1')) })
    await prepared.runtime.flush()
    const bezel = bezelOf(panel, 'a1')

    act(() => { store.actions.setWindowAccess('a1' as WindowId, { mode: 'selected', people: [] }) })
    await prepared.runtime.flush()
    expect(bezel.textContent).toContain('Selected people')
    expect(bezel.querySelectorAll('[data-board-owner-color]')).toHaveLength(0)

    act(() => { store.actions.setWindowAccess('a1' as WindowId, { mode: 'all', people: [] }) })
    await prepared.runtime.flush()
    expect(bezel.textContent).toContain('Everyone')
    expect(bezel.querySelector('[aria-label="Access: All board participants"]')).not.toBeNull()
  })
})

describe('window bezel management', () => {
  it('transfers the window to another participant and drops both triggers', async () => {
    const { prepared, panel, store } = await bench()
    act(() => { store.actions.openWindow(windowSpec('a1')) })
    await prepared.runtime.flush()

    const trigger = frameOf(panel, 'a1').querySelector('[data-board-action="bezel-owner"]') as HTMLElement
    expect(trigger.getAttribute('aria-label')).toBe('Owner: Kirill')
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    await prepared.runtime.flush()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    // Transfer stays disabled until a participant is picked.
    expect((menuRow('Transfer') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(menuRow('Legal'))
    await prepared.runtime.flush()
    expect((menuRow('Transfer') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(menuRow('Transfer'))
    await prepared.runtime.flush()

    expect(store.store.getSnapshot().windows['a1']?.ownerId).toBe('demo-legal')
    expect(frameOf(panel, 'a1').getAttribute('data-board-owner-color')).toBe('3')
    // The new owner manages nothing here: the bezel shows captions only.
    expect(frameOf(panel, 'a1').querySelector('[data-board-action="bezel-owner"]')).toBeNull()
    expect(frameOf(panel, 'a1').querySelector('[data-board-action="bezel-access"]')).toBeNull()
    expect(bezelOf(panel, 'a1').textContent).toContain('Legal')
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it('switches the three access modes and keeps the selected people through Only me', async () => {
    const { prepared, panel, store } = await bench()
    act(() => { store.actions.openWindow(windowSpec('a1')) })
    await prepared.runtime.flush()

    const accessTrigger = (): HTMLElement =>
      frameOf(panel, 'a1').querySelector('[data-board-action="bezel-access"]') as HTMLElement
    expect(accessTrigger().getAttribute('aria-label')).toBe('Access: Only me')
    expect(accessTrigger().getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(accessTrigger())
    await prepared.runtime.flush()
    expect(accessTrigger().getAttribute('aria-expanded')).toBe('true')
    expect([...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(row => row.textContent))
      .toEqual(['Only me', 'Selected people', 'All board participants'])

    // The people checklist is a submenu; picking a person turns the selected
    // mode on and leaves both cards open for a multi-selection.
    fireEvent.click(menuRow('Selected people'))
    await prepared.runtime.flush()
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(2)
    fireEvent.click(menuRow('Finance'))
    await prepared.runtime.flush()
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(2)
    expect(store.store.getSnapshot().windows['a1']?.access).toEqual({ mode: 'selected', people: ['demo-finance'] })

    // Every mode switch closes the menu and keeps the people list.
    fireEvent.click(menuRow('All board participants'))
    await prepared.runtime.flush()
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(0)
    expect(store.store.getSnapshot().windows['a1']?.access).toEqual({ mode: 'all', people: ['demo-finance'] })
    expect(frameOf(panel, 'a1').textContent).toContain('Everyone')

    fireEvent.click(accessTrigger())
    await prepared.runtime.flush()
    fireEvent.click(menuRow('Only me'))
    await prepared.runtime.flush()
    expect(store.store.getSnapshot().windows['a1']?.access).toEqual({ mode: 'owner', people: ['demo-finance'] })
    expect(frameOf(panel, 'a1').textContent).toContain('Only me')

    // Back to selected: the preserved person stays and the new pick joins it.
    fireEvent.click(accessTrigger())
    await prepared.runtime.flush()
    fireEvent.click(menuRow('Selected people'))
    await prepared.runtime.flush()
    fireEvent.click(menuRow('Legal'))
    await prepared.runtime.flush()
    expect(store.store.getSnapshot().windows['a1']?.access)
      .toEqual({ mode: 'selected', people: ['demo-finance', 'demo-legal'] })
  })

  it('lists a selected person the roster does not know and lets the owner remove them', async () => {
    const { prepared, panel, store } = await bench()
    const stranger = brandString<OwnerId>('demo-stranger')
    act(() => {
      store.actions.openWindow(windowSpec('a1'))
      store.actions.setWindowAccess('a1' as WindowId, { mode: 'selected', people: [stranger] })
    })
    await prepared.runtime.flush()

    fireEvent.click(frameOf(panel, 'a1').querySelector('[data-board-action="bezel-access"]') as HTMLElement)
    await prepared.runtime.flush()
    fireEvent.click(menuRow('Selected people'))
    await prepared.runtime.flush()
    fireEvent.click(menuRow('Unknown participant'))
    await prepared.runtime.flush()
    expect(store.store.getSnapshot().windows['a1']?.access).toEqual({ mode: 'selected', people: [] })
  })

  it('keeps the captions menu-free on a window the acting owner does not manage', async () => {
    const { prepared, panel, store } = await bench()
    act(() => { store.actions.openWindow(windowSpec('a1', { ownerId: brandString<OwnerId>('demo-legal') })) })
    await prepared.runtime.flush()

    const frame = frameOf(panel, 'a1')
    const bezel = bezelOf(panel, 'a1')
    expect(frame.hasAttribute('data-board-manageable')).toBe(false)
    expect(bezel.textContent).toContain('Legal')
    expect(bezel.textContent).toContain('Only me')
    expect(bezel.querySelector('[aria-label="Only me"]')).not.toBeNull()
    expect(bezel.querySelector('[data-board-action="bezel-owner"]')).toBeNull()
    expect(bezel.querySelector('[data-board-action="bezel-access"]')).toBeNull()

    // A caption is no control: clicking it opens nothing.
    fireEvent.click(bezel.querySelector('[data-board-bezel-item]') as Element)
    await prepared.runtime.flush()
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it('offers a window of an owner nobody knows to the acting participant, on this Ketos only', async () => {
    const { prepared, panel, store } = await bench()
    act(() => {
      // A previous identity or a demo id: no record and no peer names it.
      store.actions.openWindow(windowSpec('a1', { ownerId: brandString<OwnerId>('demo-stranger') }))
      store.actions.openWindow(windowSpec('a2', { ownerId: brandString<OwnerId>('demo-legal') }))
    })
    await prepared.runtime.flush()

    expect(bezelOf(panel, 'a1').textContent).toContain('Unknown participant')
    expect(bezelOf(panel, 'a2').querySelector('[data-board-action="bezel-claim"]')).toBeNull()
    const claim = bezelOf(panel, 'a1').querySelector('[data-board-action="bezel-claim"]') as HTMLElement
    expect(claim.textContent).toBe('Take over')

    fireEvent.click(claim)
    await prepared.runtime.flush()
    const selfId = store.store.getSnapshot().selfId
    expect(store.store.getSnapshot().windows['a1']?.ownerId).toBe(selfId)
    expect(frameOf(panel, 'a1').hasAttribute('data-board-manageable')).toBe(true)
    expect(bezelOf(panel, 'a1').querySelector('[data-board-action="bezel-claim"]')).toBeNull()
  })

  it('closes only the access menu on Escape while the window panel stays open', async () => {
    const { prepared, panel, store } = await bench()
    act(() => {
      store.actions.openWindow(windowSpec('a1'))
      store.actions.setWindowPanel('a1' as WindowId, 'left', true)
    })
    await prepared.runtime.flush()
    expect(frameOf(panel, 'a1').hasAttribute('data-board-panel-left-open')).toBe(true)

    fireEvent.click(frameOf(panel, 'a1').querySelector('[data-board-action="bezel-access"]') as HTMLElement)
    await prepared.runtime.flush()
    expect(document.querySelector('[role="menu"]')).not.toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    await prepared.runtime.flush()
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(store.store.getSnapshot().windows['a1']?.leftPanelOpen).toBe(true)
  })
})

describe('window bezel dragging', () => {
  it('drags the window by the bezel background with the zoom correction', async () => {
    const { prepared, panel, store } = await bench()
    act(() => {
      store.actions.openWindow(windowSpec('a1'))
      store.actions.setZoom(0.5)
      store.actions.moveWindow('a1' as WindowId, 240, 240, false)
    })
    await prepared.runtime.flush()

    const bezel = bezelOf(panel, 'a1')
    fireEvent.pointerDown(bezel, { pointerId: 7, clientX: 100, clientY: 100, button: 0 })
    // Shift disables snapping, so the world delta is exactly screen / zoom.
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 120, clientY: 130, shiftKey: true })
    fireEvent.pointerUp(window, { pointerId: 7 })

    expect(store.store.getSnapshot().windows['a1']?.x).toBe(280)
    expect(store.store.getSnapshot().windows['a1']?.y).toBe(300)
  })

  it('does not start a drag from the owner mark', async () => {
    const { prepared, panel, store } = await bench()
    act(() => {
      store.actions.openWindow(windowSpec('a1'))
      store.actions.moveWindow('a1' as WindowId, 240, 240, false)
    })
    await prepared.runtime.flush()

    const badge = bezelOf(panel, 'a1').querySelector('[data-board-bezel-item]') as HTMLElement
    fireEvent.pointerDown(badge, { pointerId: 8, clientX: 100, clientY: 100, button: 0 })
    fireEvent.pointerMove(window, { pointerId: 8, clientX: 200, clientY: 200, shiftKey: true })
    fireEvent.pointerUp(window, { pointerId: 8 })

    expect(store.store.getSnapshot().windows['a1']?.x).toBe(240)
    expect(store.store.getSnapshot().windows['a1']?.y).toBe(240)
  })
})

describe('window selection', () => {
  it('keeps the business accent off the window frame', async () => {
    // Selection is the bezel show rule; the elevation stroke stays the theme
    // border color, and the returned flash keeps its own outline. The stylesheet
    // is read from the repository root, where every supported vitest command runs.
    const frameCssSource = readFileSync(
      resolve('packages/client/ui-board/src/client/window/WindowFrame.module.css'),
      'utf8',
    )
    expect(frameCssSource).not.toMatch(/\.window\.active\s*\{/)
    expect(frameCssSource).not.toContain('--dsw-elevation-stroke-color: var(--dsw-alias-state-business-primary)')

    const { prepared, panel, store } = await bench()
    act(() => { store.actions.openWindow(windowSpec('a1')) })
    await prepared.runtime.flush()
    const frame = frameOf(panel, 'a1')
    const activeClass = frameCss.active
    if (activeClass === undefined) throw new Error('active class missing from the stylesheet')
    // Selection still marks the frame; it only drives the bezel now.
    expect(frame.classList.contains(activeClass)).toBe(true)
    expect(frame.getAttribute('data-board-owner-color')).toBe('1')
  })

  it('clears the active window on a bare canvas click and keeps it on a pan drag', async () => {
    const { prepared, panel, store } = await bench()
    act(() => {
      store.actions.openWindow(windowSpec('a1'))
      store.actions.openWindow(windowSpec('a2'))
    })
    await prepared.runtime.flush()
    expect(store.store.getSnapshot().activeWindowId).toBe('a2')

    const surface = panel.container.querySelector('[data-surface="canvas-layer"]') as Element
    // A press and release without movement is a click on the empty canvas.
    fireEvent.pointerDown(surface, { pointerId: 9, clientX: 10, clientY: 10, button: 0 })
    fireEvent.pointerUp(window, { pointerId: 9 })
    await prepared.runtime.flush()
    expect(store.store.getSnapshot().activeWindowId).toBeNull()

    // A replaced gesture ends as a disposal, not a click; the selection stays.
    act(() => { store.actions.focusWindow('a2' as WindowId) })
    await prepared.runtime.flush()
    fireEvent.pointerDown(surface, { pointerId: 10, clientX: 10, clientY: 10, button: 0 })
    fireEvent.pointerDown(surface, { pointerId: 11, clientX: 10, clientY: 10, button: 0 })
    await prepared.runtime.flush()
    expect(store.store.getSnapshot().activeWindowId).toBe('a2')

    // A real drag pans and is never a click either.
    fireEvent.pointerMove(window, { pointerId: 11, clientX: 40, clientY: 10 })
    fireEvent.pointerUp(window, { pointerId: 11 })
    await prepared.runtime.flush()
    expect(store.store.getSnapshot().activeWindowId).toBe('a2')

    // A cancelled pointer is not a click.
    fireEvent.pointerDown(surface, { pointerId: 12, clientX: 10, clientY: 10, button: 0 })
    fireEvent.pointerCancel(window, { pointerId: 12 })
    await prepared.runtime.flush()
    expect(store.store.getSnapshot().activeWindowId).toBe('a2')
  })
})
