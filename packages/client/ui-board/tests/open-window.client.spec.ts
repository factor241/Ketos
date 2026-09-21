// @vitest-environment jsdom
/** The board's own window templates: the dock and omnibar open windows through one helper. */
import { describe, expect, it, vi } from 'vitest'
import type { CloneId } from '@ketos/clone-core/types'
import type { WindowId } from '../src/client/contract/slots.ts'
import { openBoardWindow, resolveChatWindow, type BoardActions } from '../src/client/open-window.ts'
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

  it('opens a clone window editing the named clone', () => {
    const { openWindow, actions } = recorder()
    openBoardWindow(actions, 'clone', 1, { cloneId: 'clone-1' as CloneId })

    const spec = openWindow.mock.calls[0]?.[0]
    expect(spec).toMatchObject({
      kind: 'clone',
      bodyKind: 'clone',
      cloneId: 'clone-1',
      width: 648,
      height: 768,
      ordinal: 1,
    })
    expect(spec?.id).toMatch(/^clone-/)
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

describe('resolveChatWindow', () => {
  it('addresses the active chat window and leaves a clone window alone', () => {
    const { openWindow, actions } = recorder()
    const conversation = { id: 'agent-1', kind: 'agent', bodyKind: 'conversation' }
    const clone = { id: 'clone-1', kind: 'clone', bodyKind: 'clone' }

    expect(resolveChatWindow(actions, { 'agent-1': { ...conversation } as never }, 'agent-1' as WindowId))
      .toBe('agent-1')
    // A clone window edits a card: a chat gesture opens a chat window instead
    // of binding a session the clone window could never show.
    expect(resolveChatWindow(actions, { 'clone-1': { ...clone } as never }, 'clone-1' as WindowId))
      .toMatch(/^agent-/)
    expect(openWindow).toHaveBeenCalledOnce()
    expect(openWindow.mock.calls[0]?.[0]).toMatchObject({ kind: 'agent', bodyKind: 'conversation' })
  })
})
