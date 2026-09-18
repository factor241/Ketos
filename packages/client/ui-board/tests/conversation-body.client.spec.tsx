// @vitest-environment jsdom
/**
 * Window conversation body: the session lifecycle copy, the lane states and
 * rows, the composer's send/stop/steer paths, and the scroll behavior. The
 * component renders from injected props only — the bridge's observables stay
 * behind the keyed hook, which the props stub supplies directly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ConversationBody, type ConversationBodyProps } from '../src/client/window/ConversationBody.tsx'
import type { BoardWindowSessionState, BoardWindowState, WindowId } from '../src/client/contract/slots.ts'
import { chatSnapshot, t } from './fixtures.client.ts'
import type { ChatSnapshot, ConversationNode } from '@deepseek-ai/dsh-client-ui-chat/client'

afterEach(() => { cleanup() })

const CARD: BoardWindowState = {
  id: 'a1' as WindowId,
  kind: 'agent',
  bodyKind: 'conversation',
  ordinal: 1,
  x: 0,
  y: 0,
  width: 552,
  height: 648,
  zIndex: 10,
}

const USER_NODE: ConversationNode = {
  kind: 'user',
  seq: 1,
  time: 0,
  content: [{ type: 'text', text: 'привет' }],
  source: undefined,
}

const ASSISTANT_NODE: ConversationNode = {
  kind: 'assistant',
  seq: 2,
  time: 0,
  turn: 1,
  step: 1,
  blocks: [{ kind: 'text', text: 'Привет! Чем помочь?' }],
}

const TOOL_NODE: ConversationNode = {
  kind: 'tool-result',
  seq: 3,
  time: 0,
  callId: 'call-1',
  call: { name: 'bash', argsRaw: '{}' },
  callTime: 0,
  content: [],
  isError: false,
  subCalls: [],
}

/** A tool result whose call row was truncated out of the loaded window. */
const ORPHAN_TOOL_NODE: ConversationNode = {
  kind: 'tool-result',
  seq: 4,
  time: 0,
  callId: 'call-orphan',
  call: null,
  callTime: null,
  content: [],
  isError: false,
  subCalls: [],
}

/** Props stub: the keyed session hook answers with the supplied state. */
function bodyProps(
  session: BoardWindowSessionState | undefined,
  overrides: Partial<Record<string, unknown>> = {},
): ConversationBodyProps {
  return {
    window: CARD,
    t,
    // The body and its composer read the window modes and the intent queue
    // from the store; the stub answers every selector they ask for.
    useStore: (selector: (state: {
      fullscreenWindowId: null
      panelWindowId: null
      composerIntents: readonly never[]
    }) => unknown) =>
      selector({ fullscreenWindowId: null, panelWindowId: null, composerIntents: [] }),
    actions: { consumeComposerIntent: vi.fn() },
    useWindowSession: () => session,
    ensureWindowSession: vi.fn(),
    sendPrompt: vi.fn(),
    cancelPrompt: vi.fn(),
    loadOlderTurns: vi.fn(),
    selectAgentPreset: vi.fn(),
    selectPermission: vi.fn(),
    selectModel: vi.fn(),
    exitPlanMode: vi.fn(),
    runCommand: vi.fn(),
    executeCommand: vi.fn(),
    uploadFile: vi.fn(),
    updateQueueItem: vi.fn(),
    goalAction: vi.fn(),
    loadMentions: () => Promise.resolve([]),
    ...overrides,
  } as unknown as ConversationBodyProps
}

/** One ready-session state over the supplied chat snapshot. */
function ready(chat: ChatSnapshot | undefined, running = false): BoardWindowSessionState {
  return {
    status: 'ready',
    running,
    blank: true,
    hasMore: false,
    loadingOlder: false,
    runningCalls: [],
    presets: [],
    permissions: [],
    plan: false,
    queue: [],
    todos: [],
    model: { efforts: [], groups: [], loading: false },
    commands: [],
    chat,
  }
}

/** Give one lane element controllable scroll geometry for behavior assertions. */
function laneGeometry(lane: Element, initialHeight: number): { setHeight: (value: number) => void } {
  let height = initialHeight
  Object.defineProperty(lane, 'scrollHeight', { configurable: true, get: () => height })
  Object.defineProperty(lane, 'clientHeight', { configurable: true, get: () => 0 })
  Object.defineProperty(lane, 'scrollTop', { configurable: true, writable: true, value: 0 })
  return { setHeight: (value: number) => { height = value } }
}

describe('ConversationBody', () => {
  it('creates the window session on mount', () => {
    const ensureWindowSession = vi.fn()
    render(<ConversationBody {...bodyProps(undefined, { ensureWindowSession })} />)
    expect(ensureWindowSession).toHaveBeenCalledWith('a1')
  })

  it('shows the creation state before the session exists', () => {
    const { getByText, container } = render(
      <ConversationBody {...bodyProps({ ...ready(undefined), status: 'pending' })} />,
    )
    expect(getByText('Creating the session…')).not.toBeNull()
    expect(container.querySelector('button[aria-label="Send"]')).not.toBeNull()
  })

  it('shows the session creation failure', () => {
    const { getByText } = render(
      <ConversationBody {...bodyProps({ ...ready(undefined), status: 'error', error: 'boom' })} />,
    )
    expect(getByText(/Could not create the session/)).not.toBeNull()
    expect(getByText(/boom/)).not.toBeNull()
  })

  it('renders the lane rows and the streaming partial', () => {
    const chat = chatSnapshot(
      [USER_NODE, ASSISTANT_NODE, TOOL_NODE],
      { turn: 1, step: 2, blocks: [{ kind: 'text', text: 'Печатаю…' }] },
    )
    const { getByText } = render(<ConversationBody {...bodyProps(ready(chat))} />)
    expect(getByText('привет')).not.toBeNull()
    expect(getByText('Привет! Чем помочь?')).not.toBeNull()
    expect(getByText('bash')).not.toBeNull()
    expect(getByText('Печатаю…')).not.toBeNull()
  })

  it('shows the turn failure with its server text', () => {
    const state: BoardWindowSessionState = { ...ready(chatSnapshot([USER_NODE])), turnError: 'provider exploded' }
    const { getByText, container } = render(<ConversationBody {...bodyProps(state)} />)
    expect(getByText(/Turn failed/)).not.toBeNull()
    expect(getByText(/provider exploded/)).not.toBeNull()
    expect(container.querySelector('[data-board-lane-state="turn-error"]')).not.toBeNull()
  })

  it('shows the refused prompt with its server text', () => {
    const state: BoardWindowSessionState = { ...ready(chatSnapshot()), promptError: 'session/busy: refused' }
    const { getByText, container } = render(<ConversationBody {...bodyProps(state)} />)
    expect(getByText(/The message was not sent/)).not.toBeNull()
    expect(container.querySelector('[data-board-lane-state="prompt-error"]')).not.toBeNull()
  })

  it('renders a running tool call with its marker and the running state line', () => {
    const state: BoardWindowSessionState = {
      ...ready(chatSnapshot([USER_NODE]), true),
      runningCalls: [{ id: 'call-9', name: 'bash' }],
    }
    const { getByText, container } = render(<ConversationBody {...bodyProps(state)} />)
    expect(getByText('bash')).not.toBeNull()
    expect(getByText('running')).not.toBeNull()
    expect(container.querySelector('[data-board-tool="running"]')).not.toBeNull()
    expect(container.querySelector('[data-board-lane-state="running"]')).not.toBeNull()
  })

  it('marks the empty, creating, and creation-failure lane states', () => {
    const empty = render(<ConversationBody {...bodyProps(ready(chatSnapshot()))} />)
    expect(empty.container.querySelector('[data-board-lane-state="empty"]')).not.toBeNull()
    empty.unmount()

    const creating = render(<ConversationBody {...bodyProps({ ...ready(undefined), status: 'pending' })} />)
    expect(creating.container.querySelector('[data-board-lane-state="creating"]')).not.toBeNull()
    creating.unmount()

    const failed = render(<ConversationBody {...bodyProps({ ...ready(undefined), status: 'error', error: 'boom' })} />)
    expect(failed.container.querySelector('[data-board-lane-state="creation-error"]')).not.toBeNull()
  })

  it('marks a failed tool result with its localized note', () => {
    const failed: ConversationNode = { ...TOOL_NODE, isError: true }
    const { getByText, container } = render(<ConversationBody {...bodyProps(ready(chatSnapshot([failed])))} />)
    expect(getByText('bash')).not.toBeNull()
    expect(getByText('failed')).not.toBeNull()
    expect(container.querySelector('[data-board-tool="failed"]')).not.toBeNull()
  })

  it('marks an unavailable tool result and repeats the earlier turns', () => {
    const loadOlderTurns = vi.fn()
    const state: BoardWindowSessionState = { ...ready(chatSnapshot([ORPHAN_TOOL_NODE])), hasMore: true }
    const { getByText, container } = render(
      <ConversationBody {...bodyProps(state, { loadOlderTurns })} />,
    )
    expect(getByText('result unavailable')).not.toBeNull()
    fireEvent.click(getByText('Request again'))
    expect(loadOlderTurns).toHaveBeenCalledWith('a1')
    expect(container.querySelector('[data-board-tool="done"]')).not.toBeNull()
  })

  it('offers no repeat for an unavailable result when no earlier page remains', () => {
    const state: BoardWindowSessionState = { ...ready(chatSnapshot([ORPHAN_TOOL_NODE])), hasMore: false }
    const { getByText, queryByText } = render(<ConversationBody {...bodyProps(state)} />)
    expect(getByText('result unavailable')).not.toBeNull()
    expect(queryByText('Request again')).toBeNull()
  })

  it('sends the draft on submit and clears it', () => {
    const sendPrompt = vi.fn()
    const { container } = render(
      <ConversationBody {...bodyProps(ready(chatSnapshot()), { sendPrompt })} />,
    )
    const input = container.querySelector<HTMLTextAreaElement>('textarea')
    if (input === null) throw new Error('missing composer textarea')
    expect((container.querySelector('button[aria-label="Send"]') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(input, { target: { value: '  сделай отчёт  ' } })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    expect(sendPrompt).toHaveBeenCalledWith('a1', 'сделай отчёт', 'queue', [], [])
    expect(input.value).toBe('')
  })

  it('steers the running turn on the accelerated gesture and cancels through Stop', () => {
    const sendPrompt = vi.fn()
    const cancelPrompt = vi.fn()
    const { container } = render(
      <ConversationBody {...bodyProps(ready(chatSnapshot(), true), { sendPrompt, cancelPrompt })} />,
    )
    const stop = container.querySelector('button[aria-label="Stop"]')
    expect(stop).not.toBeNull()
    fireEvent.click(stop as Element)
    expect(cancelPrompt).toHaveBeenCalledWith('a1')

    const input = container.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'стоп-кран' } })
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
    expect(sendPrompt).toHaveBeenCalledWith('a1', 'стоп-кран', 'steer', [], [])
  })

  it('keeps Shift+Enter as a newline and ignores empty drafts', () => {
    const sendPrompt = vi.fn()
    const { container } = render(
      <ConversationBody {...bodyProps(ready(chatSnapshot()), { sendPrompt })} />,
    )
    const input = container.querySelector('textarea') as HTMLTextAreaElement

    fireEvent.change(input, { target: { value: 'строка' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(sendPrompt).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(sendPrompt).not.toHaveBeenCalled()
  })

  it('keeps the voice control disabled when the engine has no recognition API', () => {
    const { container } = render(<ConversationBody {...bodyProps(ready(chatSnapshot()))} />)
    const mic = container.querySelector('button[aria-label="Start dictation"]')
    expect(mic).not.toBeNull()
    // jsdom exposes no SpeechRecognition: the control must not pretend to listen.
    expect((mic as HTMLButtonElement).disabled).toBe(true)
    expect(mic?.getAttribute('aria-pressed')).toBe('false')
  })

  it('renders the permission menu through the body portal, not inside the window', () => {
    const state: BoardWindowSessionState = {
      ...ready(chatSnapshot()),
      permission: 'workspace-write',
      permissions: [{ id: 'read-only', dangerous: false }, { id: 'workspace-write', dangerous: false }],
    }
    const { container } = render(<ConversationBody {...bodyProps(state)} />)
    expect(document.querySelector('[role="menu"]')).toBeNull()

    fireEvent.click(container.querySelector('button[aria-label="Permission preset"]') as Element)
    const list = document.querySelector('[role="menu"]')
    expect(list).not.toBeNull()
    // Portal: the list lives outside the composer subtree.
    expect(container.contains(list)).toBe(false)
  })

  it('offers the load-older and jump-to-latest affordances', () => {
    const loadOlderTurns = vi.fn()
    const chat = chatSnapshot([USER_NODE])
    const state: BoardWindowSessionState = { ...ready(chat), hasMore: true }
    const { getByText, container } = render(<ConversationBody {...bodyProps(state, { loadOlderTurns })} />)
    fireEvent.click(getByText('Load earlier turns'))
    expect(loadOlderTurns).toHaveBeenCalledWith('a1')

    // The lane tail holds no fullscreen control; the window header owns it.
    expect(container.querySelector('button[aria-label="Open fullscreen"]')).toBeNull()
  })

  it('disables the load-older control while a page is in flight', () => {
    const state: BoardWindowSessionState = { ...ready(chatSnapshot([USER_NODE])), hasMore: true, loadingOlder: true }
    const { getByText } = render(<ConversationBody {...bodyProps(state)} />)
    const control = getByText('Loading earlier turns…') as HTMLButtonElement
    expect(control.disabled).toBe(true)
  })

  it('follows the tail while the reader stays there and stops when they scroll away', () => {
    const first = ready(chatSnapshot([USER_NODE]))
    const { container, rerender } = render(<ConversationBody {...bodyProps(first)} />)
    const lane = container.querySelector('[data-board-lane]') as HTMLElement
    const geometry = laneGeometry(lane, 1000)
    lane.scrollTop = 1000

    // The reader is at the tail: new content keeps the view pinned.
    geometry.setHeight(1200)
    rerender(<ConversationBody {...bodyProps(ready(chatSnapshot([USER_NODE, ASSISTANT_NODE])))} />)
    expect(lane.scrollTop).toBe(1200)

    // Scrolling away stops the follow: the growing lane leaves the offset alone.
    lane.scrollTop = 100
    fireEvent.scroll(lane)
    geometry.setHeight(1600)
    rerender(<ConversationBody {...bodyProps(ready(chatSnapshot([USER_NODE, ASSISTANT_NODE, TOOL_NODE])))} />)
    expect(lane.scrollTop).toBe(100)

    // The jump control returns and re-pins the view.
    fireEvent.click(container.querySelector('button[aria-label="Jump to the latest"]') as Element)
    expect(lane.scrollTop).toBe(1600)
  })

  it('keeps the reader position when earlier turns are prepended', () => {
    const loadOlderTurns = vi.fn()
    const state: BoardWindowSessionState = { ...ready(chatSnapshot([ASSISTANT_NODE])), hasMore: true }
    const { container, rerender } = render(<ConversationBody {...bodyProps(state, { loadOlderTurns })} />)
    const lane = container.querySelector('[data-board-lane]') as HTMLElement
    const geometry = laneGeometry(lane, 1000)
    lane.scrollTop = 400

    fireEvent.click(container.querySelector('[data-board-action="lane-load-older"]') as Element)
    expect(loadOlderTurns).toHaveBeenCalledWith('a1')

    // Channel republishes for loadingOlder and running calls arrive without new
    // transcript rows; they must not consume the anchor before the page lands.
    rerender(<ConversationBody {...bodyProps({ ...state, loadingOlder: true, runningCalls: [{ id: 'c1', name: 'bash' }] }, { loadOlderTurns })} />)

    // A streamed chunk grows the lane *below* the reader: the same leading row
    // means nothing was prepended, so the anchor must survive this too.
    geometry.setHeight(1100)
    const streamed: BoardWindowSessionState = {
      ...state,
      chat: chatSnapshot([ASSISTANT_NODE], { turn: 1, step: 2, blocks: [{ kind: 'text', text: 'Печатаю…' }] }),
    }
    rerender(<ConversationBody {...bodyProps(streamed, { loadOlderTurns })} />)
    expect(lane.scrollTop).toBe(400)

    // The prepended page grows the lane above the reader: the offset shifts by
    // the added height instead of jumping to the end.
    geometry.setHeight(1300)
    const grown: BoardWindowSessionState = { ...state, chat: chatSnapshot([USER_NODE, ASSISTANT_NODE]) }
    rerender(<ConversationBody {...bodyProps(grown, { loadOlderTurns })} />)
    expect(lane.scrollTop).toBe(700)
  })

  it('shows the permission and plan chips and switches the permission preset', () => {
    const selectPermission = vi.fn()
    const state: BoardWindowSessionState = {
      ...ready(chatSnapshot()),
      permission: 'workspace-write',
      permissions: [
        { id: 'read-only', dangerous: false },
        { id: 'workspace-write', dangerous: false },
      ],
    }
    const { getByText, container } = render(
      <ConversationBody {...bodyProps(state, { selectPermission })} />,
    )
    expect(getByText('Workspace Write')).not.toBeNull()

    fireEvent.click(container.querySelector('button[aria-label="Permission preset"]') as Element)
    fireEvent.click(getByText('Read Only'))
    expect(selectPermission).toHaveBeenCalledWith('a1', 'read-only')
  })

  it('offers the context figures and the queue strip', () => {
    const state: BoardWindowSessionState = {
      ...ready(chatSnapshot()),
      context: { percent: 42, usedTokens: 42_000, window: 100_000 },
      queue: [{ id: 'q1', preview: 'Позже поправь отчёт' }],
    }
    const { getByText, getAllByText } = render(<ConversationBody {...bodyProps(state)} />)
    expect(getByText('42%')).not.toBeNull()
    expect(getByText('1 queued messages')).not.toBeNull()
    expect(getAllByText('Позже поправь отчёт').length).toBeGreaterThan(0)
  })
})
