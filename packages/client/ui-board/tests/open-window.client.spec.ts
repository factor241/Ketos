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
  it('opens the template with a fresh id, its title, and the optional status', () => {
    const { openWindow, actions } = recorder()
    openBoardWindow(actions, 'agent', 'Agent #1', { status: 'idle', statusText: 'online' })

    expect(openWindow).toHaveBeenCalledOnce()
    const spec = openWindow.mock.calls[0]?.[0]
    expect(spec).toMatchObject({
      kind: 'agent',
      bodyKind: 'conversation',
      width: 480,
      height: 560,
      title: 'Agent #1',
      status: 'idle',
      statusText: 'online',
    })
    expect(spec?.id).toMatch(/^agent-/)
  })

  it('mints a distinct id per window and omits a status the caller did not pass', () => {
    const { openWindow, actions } = recorder()
    openBoardWindow(actions, 'connectors', 'Tools')
    openBoardWindow(actions, 'connectors', 'Tools')

    const [first, second] = openWindow.mock.calls.map(call => call[0])
    expect(first?.id).not.toBe(second?.id)
    expect(first).toMatchObject({ kind: 'connectors', bodyKind: 'connectors', width: 520, height: 480 })
    expect(first).not.toHaveProperty('status')
    expect(first).not.toHaveProperty('statusText')
  })
})
