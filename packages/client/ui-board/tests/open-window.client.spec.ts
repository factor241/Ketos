// @vitest-environment jsdom
/** The board's own window templates: the dock and omnibar open windows through one helper. */
import { describe, expect, it, vi } from 'vitest'
import { openBoardWindow, type BoardActions } from '../src/client/open-window.ts'
import type { OpenWindowSpec } from '../src/client/store.ts'

/** Recorded action face: the helper writes through the store's `openWindow`. */
function recorder() {
  const openWindow = vi.fn<(spec: OpenWindowSpec) => void>()
  return { openWindow, actions: { openWindow } as unknown as BoardActions }
}

describe('openBoardWindow', () => {
  it('opens the template with a fresh id, its ordinal, and its geometry', () => {
    const { openWindow, actions } = recorder()
    openBoardWindow(actions, 'agent', 1)

    expect(openWindow).toHaveBeenCalledOnce()
    const spec = openWindow.mock.calls[0]?.[0]
    expect(spec).toMatchObject({
      kind: 'agent',
      bodyKind: 'conversation',
      width: 552,
      height: 648,
      ordinal: 1,
    })
    expect(spec?.id).toMatch(/^agent-/)
  })

  it('mints a distinct id per window', () => {
    const { openWindow, actions } = recorder()
    openBoardWindow(actions, 'agent', 1)
    openBoardWindow(actions, 'agent', 2)

    const [first, second] = openWindow.mock.calls.map(call => call[0])
    expect(first?.id).not.toBe(second?.id)
    expect(first).toMatchObject({ kind: 'agent', bodyKind: 'conversation', width: 552, height: 648 })
    expect(first).not.toHaveProperty('status')
    expect(first).not.toHaveProperty('statusText')
  })
})
