// @vitest-environment jsdom
/**
 * Window conversation body: the session lifecycle copy, the lane states and
 * rows, the composer's send/stop/steer paths, and the scroll behavior. The
 * component renders from injected props only — the bridge's observables stay
 * behind the keyed hook, which the props stub supplies directly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ConversationBody, type ConversationBodyProps } from '../src/client/window/ConversationBody.tsx'
import type { BoardWindowSessionState, BoardWindowState, WindowId } from '../src/client/contract/slots.ts'
import { chatSnapshot, t } from './fixtures.client.ts'
import type { ChatSnapshot, ConversationNode, RunningToolCall } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'

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
  call: { name: 'bash', argsRaw: '{"command":"ls"}' },
  callTime: 0,
  content: [{ type: 'text', text: 'README.md\n[exit code: 0]' }],
  isError: false,
  subCalls: [],
}

const RUNNING_CALL: RunningToolCall = {
  callId: 'call-9',
  name: 'bash',
  argsRaw: '{"command":"sleep 5"}',
  turn: 1,
  step: 1,
  time: 0,
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

/**
 * Props stub: the keyed session hook answers with the supplied state and the
 * root pending-interaction source answers with the supplied map.
 */
function bodyProps(
  session: BoardWindowSessionState | undefined,
  overrides: Partial<Record<string, unknown>> = {},
  pending: SessionPendingInteractionSnapshot = new Map(),
): ConversationBodyProps {
  return {
    window: CARD,
    t,
    useSessionPendingInteraction: (selector: (snapshot: SessionPendingInteractionSnapshot) => unknown) => selector(pending),
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
    sendPrompt: vi.fn(async () => true),
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
    loadQueueImage: vi.fn(async () => ''),
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
    presets: [],
    presetPickerEnabled: true,
    permissions: [],
    plan: false,
    queue: [],
    pending: [],
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

  it('shows the restoring state while a stored binding waits for the session list', () => {
    const { getByText, container } = render(
      <ConversationBody {...bodyProps({ ...ready(undefined), status: 'restoring' })} />,
    )
    expect(getByText('Restoring the session…')).not.toBeNull()
    expect(container.querySelector('[data-board-lane-state="restoring"]')).not.toBeNull()
  })

  it('offers create and choose-chat actions when the bound session is missing', () => {
    const startChat = vi.fn(() => Promise.resolve())
    const openWindowPanel = vi.fn()
    const state: BoardWindowSessionState = {
      ...ready(undefined),
      status: 'missing',
      sessionId: 'gone' as SessionId,
      cwd: '/work/project',
    }
    const { getByText, container } = render(
      <ConversationBody {...bodyProps(state, {
        startChat,
        actions: { consumeComposerIntent: vi.fn(), openWindowPanel },
      })} />,
    )

    expect(getByText('This session no longer exists')).not.toBeNull()
    expect(container.querySelector('[data-board-lane-state="session-missing"]')).not.toBeNull()

    fireEvent.click(getByText('New session'))
    expect(startChat).toHaveBeenCalledWith('a1')

    fireEvent.click(getByText('Choose a chat'))
    expect(openWindowPanel).toHaveBeenCalledWith('a1')
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
    expect(getByText('README.md')).not.toBeNull()
    expect(getByText('Печатаю…')).not.toBeNull()
  })

  it('replaces the streaming partial on completion and clears it on cancel', () => {
    const partial = { turn: 1, step: 2, blocks: [{ kind: 'text' as const, text: 'Печатаю…' }] }
    const streaming: BoardWindowSessionState = {
      ...ready(chatSnapshot([USER_NODE, ASSISTANT_NODE], partial), true),
    }
    const { container, queryByText, rerender } = render(<ConversationBody {...bodyProps(streaming)} />)
    expect(container.querySelector('[data-board-streaming]')?.textContent).toContain('Печатаю…')

    // Completion: the durable assistant row replaces the partial and the turn stops.
    rerender(<ConversationBody {...bodyProps(ready(chatSnapshot([USER_NODE, ASSISTANT_NODE])))} />)
    expect(container.querySelector('[data-board-streaming]')).toBeNull()
    expect(container.querySelectorAll('[data-board-message="assistant"]')).toHaveLength(1)
    expect(container.querySelector('button[aria-label="Stop"]')).toBeNull()

    // Cancellation: the aborted turn drops its partial and the composer returns to sending.
    const cancelled: BoardWindowSessionState = { ...ready(chatSnapshot([USER_NODE], partial), true) }
    rerender(<ConversationBody {...bodyProps(cancelled)} />)
    expect(container.querySelector('[data-board-streaming]')?.textContent).toContain('Печатаю…')
    rerender(<ConversationBody {...bodyProps(ready(chatSnapshot([USER_NODE])))} />)
    expect(container.querySelector('[data-board-streaming]')).toBeNull()
    expect(container.querySelector('[data-board-lane-state="running"]')).toBeNull()
    expect(queryByText('Печатаю…')).toBeNull()
    expect(container.querySelector('button[aria-label="Send"]')).not.toBeNull()
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

  it('renders a running tool call as its running card', () => {
    const state: BoardWindowSessionState = {
      ...ready(chatSnapshot([USER_NODE], null, [RUNNING_CALL]), true),
    }
    const { container } = render(<ConversationBody {...bodyProps(state)} />)
    expect(container.querySelector('[data-board-tool="running"]')).not.toBeNull()
    expect(container.querySelector('[data-board-tool-status="running"]')?.textContent).toContain('running')
    expect(container.querySelector('[data-board-lane-state="running"]')).not.toBeNull()
  })

  it('replaces a running call with its stopped card when the turn is cancelled', () => {
    const runningState: BoardWindowSessionState = {
      ...ready(chatSnapshot([USER_NODE], null, [RUNNING_CALL]), true),
    }
    const { container, rerender } = render(<ConversationBody {...bodyProps(runningState)} />)
    expect(container.querySelector('[data-board-tool="running"]')).not.toBeNull()

    // Cancellation settles the call as an interrupted result; its card turns
    // from the running state into the stopped state without remounting the lane.
    const stopped: ConversationNode = {
      kind: 'tool-result',
      seq: 3,
      time: 1,
      callId: 'call-9',
      call: { name: 'bash', argsRaw: '{"command":"sleep 5"}' },
      callTime: 0,
      content: [],
      isError: true,
      error: { name: 'Interrupted', code: 'interrupted' },
      subCalls: [],
    }
    rerender(<ConversationBody {...bodyProps(ready(chatSnapshot([USER_NODE, stopped])))} />)
    expect(container.querySelector('[data-board-tool-status="stopped"]')).not.toBeNull()
    expect(container.querySelector('[data-board-tool="running"]')).toBeNull()
  })

  it('banners a pending approval, blocks the composer, and navigates to the main panel', () => {
    const openInMainPanel = vi.fn()
    const sessionId = 'session-1' as SessionId
    const pending = new Map([
      [sessionId, { key: 'approval:1', kind: 'approval', sessionId }],
    ]) as unknown as SessionPendingInteractionSnapshot
    const state: BoardWindowSessionState = { ...ready(chatSnapshot()), sessionId }
    const { getByText, container } = render(
      <ConversationBody {...bodyProps(state, { openInMainPanel }, pending)} />,
    )
    expect(getByText('Confirmation required')).not.toBeNull()
    expect(getByText('Composer is blocked: Confirmation required')).not.toBeNull()
    expect(container.querySelector('[data-board-pending="approval"]')).not.toBeNull()
    fireEvent.click(getByText('Open in the main panel'))
    expect(openInMainPanel).toHaveBeenCalledWith('a1')
  })

  it('names each pending kind and leaves the composer free when none is pending', () => {
    const sessionId = 'session-1' as SessionId
    const titles: readonly [string, string][] = [
      ['question', 'Answer required'],
      ['plan-review', 'Plan review required'],
      ['mystery', 'Action required'],
    ]
    for (const [kind, title] of titles) {
      const pending = new Map([
        [sessionId, { key: `${kind}:1`, kind, sessionId }],
      ]) as unknown as SessionPendingInteractionSnapshot
      const state: BoardWindowSessionState = { ...ready(chatSnapshot()), sessionId }
      const rendered = render(<ConversationBody {...bodyProps(state, {}, pending)} />)
      expect(rendered.getByText(title)).not.toBeNull()
      rendered.unmount()
    }

    // A pending interaction of another session never banners this window.
    const other = new Map([
      ['someone-else' as SessionId, { key: 'approval:2', kind: 'approval', sessionId: 'someone-else' as SessionId }],
    ]) as unknown as SessionPendingInteractionSnapshot
    const state: BoardWindowSessionState = { ...ready(chatSnapshot()), sessionId }
    const rendered = render(<ConversationBody {...bodyProps(state, {}, other)} />)
    expect(rendered.queryByText('Confirmation required')).toBeNull()
    expect(rendered.container.querySelector('[data-board-pending]')).toBeNull()
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

  it('marks a failed tool result with its localized note and detail', () => {
    const failed: ConversationNode = {
      ...TOOL_NODE,
      isError: true,
      error: { name: 'ToolError', code: 'ENOENT' },
      content: [{ type: 'text', text: 'no such file' }],
    }
    const { getByText, container } = render(<ConversationBody {...bodyProps(ready(chatSnapshot([failed])))} />)
    expect(getByText('failed')).not.toBeNull()
    expect(getByText('ToolError')).not.toBeNull()
    expect(getByText('no such file')).not.toBeNull()
    expect(container.querySelector('[data-board-tool="failed"]')).not.toBeNull()
    expect(container.querySelector('[data-board-tool-error="ENOENT"]')).not.toBeNull()
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
    const sendPrompt = vi.fn(async () => true)
    const { container } = render(
      <ConversationBody {...bodyProps(ready(chatSnapshot()), { sendPrompt })} />,
    )
    const input = container.querySelector<HTMLTextAreaElement>('textarea')
    if (input === null) throw new Error('missing composer textarea')
    expect((container.querySelector('button[aria-label="Send"]') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(input, { target: { value: '  сделай отчёт  ' } })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    expect(sendPrompt).toHaveBeenCalledWith('a1', 'сделай отчёт', 'queue', [], [], expect.any(AbortSignal))
    expect(input.value).toBe('')
  })

  it('steers the running turn on the accelerated gesture and cancels through Stop', () => {
    const sendPrompt = vi.fn(async () => true)
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
    expect(sendPrompt).toHaveBeenCalledWith('a1', 'стоп-кран', 'steer', [], [], expect.any(AbortSignal))
  })

  it('keeps Shift+Enter as a newline and ignores empty drafts', () => {
    const sendPrompt = vi.fn(async () => true)
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
    rerender(<ConversationBody {...bodyProps({ ...state, loadingOlder: true }, { loadOlderTurns })} />)

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

  it('absorbs the load-earlier affordance leaving the lane after the last page', () => {
    const loadOlderTurns = vi.fn()
    const state: BoardWindowSessionState = { ...ready(chatSnapshot([ASSISTANT_NODE])), hasMore: true }
    const { container, rerender } = render(<ConversationBody {...bodyProps(state, { loadOlderTurns })} />)
    const lane = container.querySelector('[data-board-lane]') as HTMLElement
    const geometry = laneGeometry(lane, 1000)
    lane.scrollTop = 500

    fireEvent.click(container.querySelector('[data-board-action="lane-load-older"]') as Element)
    geometry.setHeight(1400)
    const grown: BoardWindowSessionState = {
      ...state,
      hasMore: false,
      chat: chatSnapshot([USER_NODE, ASSISTANT_NODE]),
    }
    rerender(<ConversationBody {...bodyProps(grown, { loadOlderTurns })} />)
    expect(lane.scrollTop).toBe(900)

    // The exhausted history drops the button above the reader: the shrink moves
    // the scrollbar back by exactly the affordance's height.
    geometry.setHeight(1368)
    rerender(<ConversationBody {...bodyProps(grown, { loadOlderTurns })} />)
    expect(lane.scrollTop).toBe(868)
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
      queue: [{ id: 'q1', preview: 'Позже поправь отчёт', text: 'Позже поправь отчёт', placement: 'queued', attachments: [] }],
    }
    const { getByText, getAllByText } = render(<ConversationBody {...bodyProps(state)} />)
    expect(getByText('42%')).not.toBeNull()
    expect(getByText('1 queued messages')).not.toBeNull()
    expect(getAllByText('Позже поправь отчёт').length).toBeGreaterThan(0)
  })
})

describe('ConversationBody echoes, steering, and turn failures', () => {
  const ECHO: BoardWindowSessionState['pending'][number] = {
    id: 'echo-1',
    placement: 'transcript',
    text: 'отправлено сейчас',
    images: [{ id: 'i1', preview: 'data:image/png;base64,AAAA', name: 'shot.png' }],
    files: ['report.pdf'],
  }

  it('renders a local echo with its attachments and hides it once its durable node arrives', () => {
    const pending: BoardWindowSessionState = { ...ready(chatSnapshot()), pending: [ECHO] }
    const { container, queryByText, rerender } = render(<ConversationBody {...bodyProps(pending)} />)
    expect(container.querySelector('[data-board-submission-echo]')).not.toBeNull()
    expect(queryByText('отправлено сейчас')).not.toBeNull()
    expect(container.querySelector('img[src="data:image/png;base64,AAAA"]')).not.toBeNull()
    expect(container.querySelector('[data-board-submission-echo]')?.textContent).toContain('report.pdf')

    // The durable user/message arrives with the same rpcId: exactly one copy stays.
    const durable: ConversationNode = {
      ...USER_NODE,
      time: 5,
      content: [{ type: 'text', text: 'отправлено сейчас' }],
      source: { kind: 'user', rpcId: 'echo-1' },
    }
    rerender(<ConversationBody {...bodyProps({ ...ready(chatSnapshot([durable])), pending: [ECHO] })} />)
    expect(container.querySelector('[data-board-submission-echo]')).toBeNull()
    expect(container.querySelectorAll('[data-board-message="user"]')).toHaveLength(1)
  })

  it('renders pending steering, queued steering, and durable steering rows in the lane', () => {
    const steeringNode: ConversationNode = {
      kind: 'steering',
      seq: 7,
      time: 0,
      messageId: 'm7' as never,
      content: [{ type: 'text', text: 'durable steering' }],
      source: undefined,
    }
    const state: BoardWindowSessionState = {
      ...ready(chatSnapshot([steeringNode])),
      pending: [{ id: 's1', placement: 'steering', text: 'pending steering', images: [], files: [] }],
      queue: [{ id: 'q9', preview: 'host steering', text: 'host steering', placement: 'steering', attachments: [] }],
    }
    const { getByText } = render(<ConversationBody {...bodyProps(state)} />)

    expect(getByText('pending steering').closest('[data-board-pending-steering]')).not.toBeNull()
    expect(getByText('host steering').closest('[data-board-steering]')).not.toBeNull()
    expect(getByText('durable steering').closest('[data-board-message="steering"]')).not.toBeNull()
  })

  it('renders a durable turn failure as a card with its detail and repeat action', () => {
    const sendPrompt = vi.fn(async () => true)
    const failure: ConversationNode = {
      kind: 'turn-error',
      seq: 5,
      time: 0,
      turn: 1,
      step: 1,
      message: 'provider exploded',
      code: 'PROVIDER_ERROR',
    }
    const state: BoardWindowSessionState = { ...ready(chatSnapshot([USER_NODE, failure])) }
    const { container, getByText, queryByText } = render(
      <ConversationBody {...bodyProps(state, { sendPrompt })} />,
    )

    expect(container.querySelector('[data-board-turn-error="PROVIDER_ERROR"]')).not.toBeNull()
    expect(getByText('provider exploded')).not.toBeNull()
    expect(queryByText('Error code: PROVIDER_ERROR')).toBeNull()

    fireEvent.click(container.querySelector('[data-board-action="turn-error-details"]') as Element)
    expect(getByText('Error code: PROVIDER_ERROR')).not.toBeNull()

    fireEvent.click(container.querySelector('[data-board-action="turn-error-repeat"]') as Element)
    expect(sendPrompt).toHaveBeenCalledWith('a1', 'привет', 'queue')
  })

  it('does not repeat the generic turn failure line under its own card', () => {
    const failure: ConversationNode = {
      kind: 'turn-error',
      seq: 5,
      time: 0,
      turn: 1,
      step: 1,
      message: '',
      code: 'AUTH',
    }
    const covered: BoardWindowSessionState = {
      ...ready(chatSnapshot([USER_NODE, failure])),
      turnError: 'stub authentication refused',
    }
    const first = render(<ConversationBody {...bodyProps(covered)} />)
    expect(first.container.querySelector('[data-board-turn-error]')).not.toBeNull()
    expect(first.container.querySelectorAll('[data-board-lane-state="turn-error"]')).toHaveLength(1)
    first.unmount()

    // An agent failure the transcript does not carry still gets its line.
    const uncovered: BoardWindowSessionState = { ...ready(chatSnapshot([])), turnError: 'background failure' }
    const second = render(<ConversationBody {...bodyProps(uncovered)} />)
    expect(second.getByText(/background failure/)).not.toBeNull()
    expect(second.container.querySelector('[data-board-lane-state="turn-error"]')).not.toBeNull()
  })

  it('localizes the authentication failure and keeps the raw text as detail', () => {
    const failure: ConversationNode = {
      kind: 'turn-error',
      seq: 5,
      time: 0,
      turn: 1,
      step: 1,
      message: 'raw provider text',
      code: 'AUTH',
    }
    const { container, getByText } = render(
      <ConversationBody {...bodyProps(ready(chatSnapshot([failure])))} />,
    )
    expect(getByText('Authentication failed; check the model credentials for this session.')).not.toBeNull()
    fireEvent.click(container.querySelector('[data-board-action="turn-error-details"]') as Element)
    expect(getByText('raw provider text')).not.toBeNull()
    expect(getByText('Error code: AUTH')).not.toBeNull()
  })

  it('never doubles a transcript row whose event repeats in a history page', () => {
    const repeated = [USER_NODE, ASSISTANT_NODE, USER_NODE]
    const { container } = render(<ConversationBody {...bodyProps(ready(chatSnapshot(repeated)))} />)
    expect(container.querySelectorAll('[data-board-message="user"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-board-message="assistant"]')).toHaveLength(1)
  })

  it('keeps committed rows mounted while a chunk streams', () => {
    const { container, rerender } = render(
      <ConversationBody {...bodyProps(ready(chatSnapshot([USER_NODE, ASSISTANT_NODE, TOOL_NODE])))} />,
    )
    const committed = container.querySelector('[data-board-message="assistant"]')
    const settledTool = container.querySelector('[data-board-tool="done"]')
    expect(committed).not.toBeNull()
    expect(settledTool).not.toBeNull()

    const streamed = chatSnapshot(
      [USER_NODE, ASSISTANT_NODE, TOOL_NODE],
      { turn: 1, step: 2, blocks: [{ kind: 'text', text: 'Печатаю…' }] },
    )
    rerender(<ConversationBody {...bodyProps(ready(streamed))} />)
    // The streamed chunk renders beside the unchanged rows, never remounts them.
    expect(container.querySelector('[data-board-message="assistant"]')).toBe(committed)
    expect(container.querySelector('[data-board-tool="done"]')).toBe(settledTool)
    expect(container.querySelectorAll('[data-board-message="assistant"]')).toHaveLength(2)
    expect(container.querySelector('[data-board-streaming]')?.textContent).toContain('Печатаю…')
  })

  it('agrees on the running state across the lane and the composer', () => {
    const running = render(<ConversationBody {...bodyProps(ready(chatSnapshot([USER_NODE]), true))} />)
    expect(running.container.querySelector('[data-board-lane-state="running"]')).not.toBeNull()
    expect(running.container.querySelector('button[aria-label="Stop"]')).not.toBeNull()
    expect(running.container.querySelector('button[aria-label="Send"]')).toBeNull()
    running.unmount()

    const idle = render(<ConversationBody {...bodyProps(ready(chatSnapshot([USER_NODE])))} />)
    expect(idle.container.querySelector('[data-board-lane-state="running"]')).toBeNull()
    expect(idle.container.querySelector('button[aria-label="Send"]')).not.toBeNull()
    expect(idle.container.querySelector('button[aria-label="Stop"]')).toBeNull()
  })
})

describe('ConversationBody streaming scroll', () => {
  it('does not move a reader who scrolled away while a long partial streams', () => {
    const state = ready(chatSnapshot([USER_NODE]))
    const { container, rerender } = render(<ConversationBody {...bodyProps(state)} />)
    const lane = container.querySelector('[data-board-lane]') as HTMLElement
    const geometry = laneGeometry(lane, 1000)
    lane.scrollTop = 120
    fireEvent.scroll(lane)

    // A long code partial grows the lane below the reader: the offset stays put.
    geometry.setHeight(2400)
    const partial = {
      turn: 1,
      step: 1,
      blocks: [{ kind: 'text' as const, text: '```ts\nconst a = 1\n'.repeat(40) }],
    }
    rerender(<ConversationBody {...bodyProps({ ...state, chat: chatSnapshot([USER_NODE], partial) })} />)
    expect(lane.scrollTop).toBe(120)
    expect(container.querySelector('[data-board-streaming]')).not.toBeNull()

    // Jumping to the latest re-pins the tail.
    fireEvent.click(container.querySelector('button[aria-label="Jump to the latest"]') as Element)
    expect(lane.scrollTop).toBe(2400)
  })
})
