// @vitest-environment jsdom
/**
 * Clone window bar: the Profile/Interview tabs, the live interview status, the
 * review notice a finished interview raises, and the roster re-read after an
 * interview turn settles. The bar renders from injected props only — the
 * window channel and the roster stay behind the hooks the props stub supplies.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { CloneDto, CloneId } from '@ketos/clone-core/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConversationNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { CloneWindowBar, type CloneWindowBarProps } from '../src/client/window/CloneWindowBar.tsx'
import type { BoardWindowSessionState, BoardWindowState, WindowId } from '../src/client/contract/slots.ts'
import { chatSnapshot, sessionState, t } from './fixtures.client.ts'

afterEach(() => { cleanup() })

const CARD: BoardWindowState = {
  id: 'clone-window-1' as WindowId,
  kind: 'clone',
  bodyKind: 'clone',
  cloneId: 'clone-1' as CloneId,
  ordinal: 1,
  x: 0,
  y: 0,
  width: 648,
  height: 768,
  zIndex: 10,
}

const CLONE: CloneDto = {
  id: 'clone-1' as CloneId,
  name: 'Анна',
  role: 'Аналитик',
  description: 'Разбор требований',
  persona: 'Спокойная',
  methodology: 'Сначала факты',
  preferredModel: null,
  skills: [],
  status: 'interviewing',
  revision: 2,
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
}

const USER_NODE: ConversationNode = {
  kind: 'user',
  seq: 1,
  time: 0,
  content: [{ type: 'text', text: 'привет' }],
  source: undefined,
}

const STEERING_NODE: ConversationNode = {
  kind: 'steering',
  messageId: 'm2' as never,
  seq: 2,
  time: 0,
  content: [{ type: 'text', text: 'ещё' }],
  source: undefined,
}

const ASSISTANT_NODE: ConversationNode = {
  kind: 'assistant',
  seq: 3,
  time: 0,
  turn: 1,
  step: 1,
  blocks: [{ kind: 'text', text: 'Слушаю.' }],
}

/** Props stub: the window, the board actions, and the injected clone hooks. */
function barProps(
  session?: BoardWindowSessionState,
  overrides: Partial<Record<string, unknown>> = {},
): CloneWindowBarProps {
  const clones = (overrides['clones'] as readonly CloneDto[] | undefined) ?? [CLONE]
  return {
    window: { ...CARD, ...(overrides['window'] as Partial<BoardWindowState> | undefined) },
    actions: { setWindowBodyKind: vi.fn() },
    t,
    useWindowSession: () => session,
    useCloneList: (selector: (roster: { clones: readonly CloneDto[]; loaded: boolean }) => unknown) =>
      selector({ clones, loaded: true }),
    refreshClones: vi.fn(),
    ...overrides,
  } as unknown as CloneWindowBarProps
}

/** One ready window session over the supplied transcript. */
function session(nodes: readonly ConversationNode[] = []): BoardWindowSessionState {
  return sessionState(chatSnapshot(nodes), { sessionId: 'session-1' as SessionId })
}

/** One tab control by its data attribute. */
function tab(name: 'profile' | 'interview' | 'memory'): HTMLButtonElement {
  return document.querySelector(`[data-board-clone-tab="${name}"]`) as HTMLButtonElement
}

describe('clone window tabs', () => {
  it('switches the body kind through the tabs', () => {
    const setWindowBodyKind = vi.fn()
    const { rerender } = render(<CloneWindowBar {...barProps(session(), { actions: { setWindowBodyKind } })} />)

    expect(tab('profile').getAttribute('aria-selected')).toBe('true')
    fireEvent.click(tab('interview'))
    expect(setWindowBodyKind).toHaveBeenCalledWith(CARD.id, 'conversation')

    rerender(<CloneWindowBar {...barProps(session(), {
      actions: { setWindowBodyKind },
      window: { ...CARD, bodyKind: 'conversation' },
    })} />)
    expect(tab('interview').getAttribute('aria-selected')).toBe('true')
    fireEvent.click(tab('profile'))
    expect(setWindowBodyKind).toHaveBeenLastCalledWith(CARD.id, 'clone')
  })

  it('opens the memory list on the same window through the memory tab', () => {
    const setWindowBodyKind = vi.fn()
    const { rerender } = render(<CloneWindowBar {...barProps(session(), { actions: { setWindowBodyKind } })} />)

    fireEvent.click(tab('memory'))
    expect(setWindowBodyKind).toHaveBeenCalledWith(CARD.id, 'clone-memory')

    rerender(<CloneWindowBar {...barProps(session(), {
      actions: { setWindowBodyKind },
      window: { ...CARD, bodyKind: 'clone-memory' },
    })} />)
    expect(tab('memory').getAttribute('aria-selected')).toBe('true')
    // The memory tab is not the profile tab: the profile pill stays unselected
    // while the window shows the memory list.
    expect(tab('profile').getAttribute('aria-selected')).toBe('false')
  })

  it('disables the interview tab while the window has no session', () => {
    const setWindowBodyKind = vi.fn()
    render(<CloneWindowBar {...barProps(undefined, { actions: { setWindowBodyKind } })} />)

    expect(tab('interview').disabled).toBe(true)
    fireEvent.click(tab('interview'))
    expect(setWindowBodyKind).not.toHaveBeenCalled()
  })
})

describe('clone interview status', () => {
  it('shows the instruction and the exchange count while the clone is interviewing', () => {
    const { container } = render(
      <CloneWindowBar {...barProps(session([USER_NODE, STEERING_NODE, ASSISTANT_NODE, USER_NODE]))} />,
    )

    const strip = container.querySelector('[data-board-clone-interview="active"]')
    expect(strip).not.toBeNull()
    expect(strip?.textContent).toContain('Answer the interview questions; the agent saves the profile at the end.')
    // Only user and steering nodes are exchanges; the assistant reply is not.
    expect(strip?.textContent).toContain('3 exchanges')
  })

  it('stays silent without a session or outside the interviewing status', () => {
    const { container, rerender } = render(<CloneWindowBar {...barProps(undefined)} />)
    expect(container.querySelector('[data-board-clone-interview="active"]')).toBeNull()

    rerender(<CloneWindowBar {...barProps(session(), { clones: [{ ...CLONE, status: 'draft' }] })} />)
    expect(container.querySelector('[data-board-clone-interview="active"]')).toBeNull()
  })

  it('raises the review notice when the clone turns ready and clears it on the profile tab', () => {
    const setWindowBodyKind = vi.fn()
    const { container, rerender } = render(
      <CloneWindowBar {...barProps(session(), { actions: { setWindowBodyKind } })} />,
    )
    expect(container.querySelector('[data-board-clone-interview="done"]')).toBeNull()

    rerender(<CloneWindowBar {...barProps(session(), {
      actions: { setWindowBodyKind },
      clones: [{ ...CLONE, status: 'ready', revision: 3 }],
    })} />)
    const notice = container.querySelector('[data-board-clone-interview="done"]')
    expect(notice).not.toBeNull()
    expect(notice?.textContent).toContain('Interview complete — review and confirm the profile.')

    fireEvent.click(container.querySelector('[data-board-clone-interview="review"]') as Element)
    expect(setWindowBodyKind).toHaveBeenCalledWith(CARD.id, 'clone')
    expect(container.querySelector('[data-board-clone-interview="done"]')).toBeNull()
  })

  it('retires the review notice when the status leaves ready', () => {
    const { container, rerender } = render(<CloneWindowBar {...barProps(session())} />)
    rerender(<CloneWindowBar {...barProps(session(), { clones: [{ ...CLONE, status: 'ready', revision: 3 }] })} />)
    expect(container.querySelector('[data-board-clone-interview="done"]')).not.toBeNull()

    rerender(<CloneWindowBar {...barProps(session(), { clones: [{ ...CLONE, status: 'interviewing' }] })} />)
    expect(container.querySelector('[data-board-clone-interview="done"]')).toBeNull()
  })

  it('re-reads the clone roster when an interview turn settles', () => {
    const refreshClones = vi.fn()
    const { rerender } = render(
      <CloneWindowBar {...barProps(sessionState(chatSnapshot([]), { running: true }), { refreshClones })} />,
    )
    expect(refreshClones).not.toHaveBeenCalled()

    rerender(<CloneWindowBar {...barProps(sessionState(chatSnapshot([]), { running: false }), { refreshClones })} />)
    expect(refreshClones).toHaveBeenCalledTimes(1)
    // A steady idle channel publishes nothing: the roster is re-read on the
    // settling edge, not on every republish.
    rerender(<CloneWindowBar {...barProps(sessionState(chatSnapshot([]), { running: false }), { refreshClones })} />)
    expect(refreshClones).toHaveBeenCalledTimes(1)
  })
})
