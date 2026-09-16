// @vitest-environment jsdom
/**
 * Window conversation body: the session lifecycle copy, the lane rows, the
 * composer's send/stop/steer paths, and the navigation affordances. The
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
  title: 'Agent #1',
  x: 0,
  y: 0,
  width: 480,
  height: 560,
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

/** Props stub: the keyed session hook answers with the supplied state. */
function bodyProps(
  session: BoardWindowSessionState | undefined,
  overrides: Partial<Record<string, unknown>> = {},
): ConversationBodyProps {
  return {
    window: CARD,
    t,
    useWindowSession: () => session,
    ensureWindowSession: vi.fn(),
    sendPrompt: vi.fn(),
    cancelPrompt: vi.fn(),
    loadOlderTurns: vi.fn(),
    openInMainPanel: vi.fn(),
    selectAgentPreset: vi.fn(),
    selectPermission: vi.fn(),
    selectModel: vi.fn(),
    exitPlanMode: vi.fn(),
    runCommand: vi.fn(),
    updateQueueItem: vi.fn(),
    goalAction: vi.fn(),
    pickWorkspace: vi.fn(),
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

    expect(sendPrompt).toHaveBeenCalledWith('a1', 'сделай отчёт', 'queue', [])
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
    expect(sendPrompt).toHaveBeenCalledWith('a1', 'стоп-кран', 'steer', [])
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

  it('offers the load-older and main-panel affordances', () => {
    const loadOlderTurns = vi.fn()
    const openInMainPanel = vi.fn()
    const chat = chatSnapshot([USER_NODE])
    const { getByText, container } = render(
      <ConversationBody {...bodyProps(ready(chat), { loadOlderTurns, openInMainPanel })} />,
    )
    fireEvent.click(getByText('Load earlier turns'))
    expect(loadOlderTurns).toHaveBeenCalledWith('a1')

    fireEvent.click(container.querySelector('button[aria-label="Open in the main panel"]') as Element)
    expect(openInMainPanel).toHaveBeenCalledWith('a1')
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
