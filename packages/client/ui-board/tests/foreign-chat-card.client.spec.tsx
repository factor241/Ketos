// @vitest-environment jsdom
/**
 * Foreign chat card: the read-only card a foreign agent window shows in place
 * of the placeholder. Covers the record facts and their live age, the absence
 * of any input or owner control, the general card of other kinds, and the
 * transcript lifecycle: success, every failure caption, refresh, collapse,
 * stale answers, and the reset when the record changes.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type {
  BoardDocId, BoardRevision, BoardSnapshot, BoardWindowRecord, OwnerId, WindowId, WindowSessionId,
} from '@ketos/board-doc/types'
import type { TranscriptMessage } from '@ketos/peer/types'
import { ForeignChatCard } from '../src/client/window/ForeignChatCard.tsx'
import { ForeignWindowLayer } from '../src/client/window/ForeignWindowLayer.tsx'
import { AGE_REFRESH_MS } from '../src/client/use-age-clock.ts'
import { createBoardStore, type BoardState } from '../src/client/store.ts'
import { en, zh, type BoardKey, type BoardTranslate } from '../src/client/locale.ts'
import type { BoardTranscriptOutcome } from '../src/client/contract/slots.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const DOC = brandString<BoardDocId>('00000000-0000-4000-8000-0000000000d1')
const SELF = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e1')
const OTHER = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e2')
const WINDOW_A = brandString<WindowId>('agent-1-remote')
const WINDOW_B = brandString<WindowId>('agent-2-remote')
const SESSION = brandString<WindowSessionId>('session-1')

/** English-bound locale seat with parameter interpolation. */
function translator(dictionary: Record<BoardKey, string>): BoardTranslate {
  return (key, params) => {
    let text = dictionary[key as BoardKey]
    for (const [name, value] of Object.entries(params ?? {})) {
      text = text.replace(`{${name}}`, String(value))
    }
    return text
  }
}

const t = translator(en)

/** One snapshot with the bench's participants and no windows. */
function snapshot(): BoardSnapshot {
  return {
    docId: DOC,
    selfId: SELF,
    revision: brandNumber<BoardRevision>(1),
    elements: [],
    participants: [
      { id: SELF, name: 'Kirill', color: 1, updatedAt: 1 },
      { id: OTHER, name: 'Юрист', color: 3, updatedAt: 1 },
    ],
    windows: [],
    limits: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 },
  }
}

/** One stored window record of the other Ketos with a session. */
function record(overrides: Partial<BoardWindowRecord> = {}): BoardWindowRecord {
  return {
    id: WINDOW_A,
    hostId: OTHER,
    ownerId: OTHER,
    kind: 'agent',
    bodyKind: 'conversation',
    title: 'Ревью',
    ordinal: 1,
    x: 24,
    y: 24,
    w: 552,
    h: 648,
    z: 10,
    access: { mode: 'owner', people: [] },
    status: 'ready',
    updatedAt: Date.now() - 5 * 60_000,
    sessionId: SESSION,
    ...overrides,
  }
}

/** One stored window record without a session. */
function sessionless(overrides: Partial<BoardWindowRecord> = {}): BoardWindowRecord {
  const { sessionId: _session, ...rest } = record(overrides)
  return rest
}

type BoardInstance = ReturnType<ReturnType<typeof createBoardStore>['create']>

/** One board instance that adopted the snapshot and the supplied records. */
function instanceWith(records: readonly BoardWindowRecord[]): BoardInstance {
  const instance = createBoardStore().create()
  instance.actions.applyBoardSnapshot(snapshot())
  publish(instance, 2, records)
  return instance
}

/** Publish records through one patch. */
function publish(instance: BoardInstance, revision: number, records: readonly BoardWindowRecord[]): void {
  instance.actions.applyBoardPatch({
    revision: brandNumber<BoardRevision>(revision),
    upserts: [],
    removes: [],
    windows: { upserts: records, removes: [] },
  })
}

/** Reactive store seat that follows changes the way the board's hook does. */
function reactiveUseStore(instance: BoardInstance) {
  return <S,>(selector: (value: BoardState) => S, eq: (a: S, b: S) => boolean = Object.is): S => {
    const last = useRef<{ value: S } | undefined>(undefined)
    return useSyncExternalStore(
      listener => instance.subscribe(listener),
      () => {
        const next = selector(instance.getSnapshot())
        if (last.current !== undefined && eq(last.current.value, next)) return last.current.value
        last.current = { value: next }
        return next
      },
    )
  }
}

type FetchTranscript = (windowId: string, signal?: AbortSignal) => Promise<BoardTranscriptOutcome>

/** One transcript answer. */
const MESSAGES: readonly TranscriptMessage[] = [
  { role: 'user', text: 'Check the contract', at: '2026-10-09T10:00:00.000Z' },
  { role: 'agent', text: 'Line one\nLine two <b>not bold</b>', at: '2026-10-09T10:00:05.000Z' },
]

/** A pending read the test settles by hand. */
interface PendingRead {
  readonly windowId: string
  readonly signal: AbortSignal | undefined
  resolve: (outcome: BoardTranscriptOutcome) => void
}

/** A fetch seat whose reads wait for the test, recorded in order. */
function pendingFetch(): { fetchTranscript: FetchTranscript; reads: PendingRead[] } {
  const reads: PendingRead[] = []
  const fetchTranscript: FetchTranscript = (windowId, signal) => new Promise((settle) => {
    reads.push({ windowId, signal, resolve: settle })
  })
  return { fetchTranscript, reads }
}

/** A fetch seat that answers immediately. */
function answering(outcome: BoardTranscriptOutcome): FetchTranscript {
  return async () => await Promise.resolve(outcome)
}

/**
 * Card element over one record.
 * @param instance - the board instance.
 * @param windowRecord - the record the card renders.
 * @param fetchTranscript - the transcript seat.
 * @param translate - the board translator, English by default.
 * @returns the element.
 */
function card(
  instance: BoardInstance,
  windowRecord: BoardWindowRecord,
  fetchTranscript: FetchTranscript,
  translate: BoardTranslate = t,
): ReactNode {
  return createElement(ForeignChatCard, {
    record: windowRecord,
    t: translate,
    useStore: reactiveUseStore(instance),
    actions: instance.actions,
    fetchTranscript,
  } as never)
}

/** Layer that renders the chat card for agent records, as the board registration does. */
function layer(instance: BoardInstance, fetchTranscript: FetchTranscript): ReactNode {
  const useStore = reactiveUseStore(instance)
  const renderSlot = (_name: string, owner: unknown): unknown =>
    createElement(ForeignChatCard, {
      ...(owner as { record: BoardWindowRecord }), t, useStore, actions: instance.actions, fetchTranscript,
    } as never)
  return createElement(ForeignWindowLayer, { useStore, actions: instance.actions, renderSlot, t } as never)
}

/** Flush the pending microtasks of a settled read. */
async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve() })
}

describe('foreign chat card facts', () => {
  it('shows the owner and the age of the last change', () => {
    const instance = instanceWith([record()])
    const view = render(card(instance, record(), answering({ ok: true, messages: [] })))
    expect(view.container.querySelector('[data-board-foreign-owner]')?.textContent).toBe('Owner: Юрист')
    expect(view.container.querySelector('[data-board-foreign-updated]')?.textContent).toBe('Updated 5m')
  })

  it('renders the age of a record stamped at the largest safe integer and at zero', () => {
    for (const [updatedAt, label] of [[Number.MAX_SAFE_INTEGER, /^Updated now$/], [0, /^Updated \d+y$/]] as const) {
      const stamped = record({ updatedAt })
      const instance = instanceWith([stamped])
      const view = render(card(instance, stamped, answering({ ok: true, messages: [] })))
      expect(view.container.querySelector('[data-board-foreign-updated]')?.textContent).toMatch(label)
      cleanup()
    }
  })

  it('draws title and status once, in the frame header', () => {
    const instance = instanceWith([record()])
    const view = render(layer(instance, answering({ ok: true, messages: [] })))
    expect(view.container.querySelectorAll('[data-board-foreign-title]')).toHaveLength(1)
    expect(view.container.querySelectorAll('[data-board-foreign-status]')).toHaveLength(1)
    expect(view.container.querySelector('[data-board-foreign-status]')?.textContent).toBe('Idle')
  })

  it('offers no input, no editable text, and no owner control', () => {
    const instance = instanceWith([record()])
    const view = render(layer(instance, answering({ ok: true, messages: [...MESSAGES] })))
    const frame = view.container.querySelector('[data-board-foreign-window]') as HTMLElement
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    expect(frame.querySelector('input, textarea, select, [contenteditable], [role="textbox"]')).toBeNull()
    expect(frame.querySelector('[data-board-bezel] button')).toBeNull()
    expect(frame.querySelector('[role="menu"], [data-board-action^="bezel"], [data-board-handle]')).toBeNull()
    const labels = [...frame.querySelectorAll('button')].map(button => button.textContent)
    expect(labels).toEqual(['Hide transcript', 'Refresh'])
  })

  it('shows the new status label and age after a patch of the record', () => {
    const instance = instanceWith([record({ status: 'ready' })])
    const view = render(layer(instance, answering({ ok: true, messages: [] })))
    expect(view.container.querySelector('[data-board-foreign-status]')?.textContent).toBe('Idle')
    act(() => {
      publish(instance, 3, [record({ status: 'running', updatedAt: Date.now() })])
    })
    expect(view.container.querySelector('[data-board-foreign-status]')?.textContent).toBe('Running')
    expect(view.container.querySelector('[data-board-foreign-updated]')?.textContent).toBe('Updated now')
  })
})

describe('foreign chat card age clock', () => {
  beforeEach(() => { vi.useFakeTimers({ now: new Date('2026-10-09T12:00:00.000Z') }) })

  it('recomputes the age every refresh period', () => {
    const start = Date.now()
    const instance = instanceWith([record({ updatedAt: start })])
    const view = render(card(instance, record({ updatedAt: start }), answering({ ok: true, messages: [] })))
    const updated = (): string | null | undefined =>
      view.container.querySelector('[data-board-foreign-updated]')?.textContent
    expect(updated()).toBe('Updated now')
    act(() => { vi.advanceTimersByTime(AGE_REFRESH_MS * 2) })
    expect(updated()).toBe('Updated 1m')
    act(() => { vi.advanceTimersByTime(AGE_REFRESH_MS * 8) })
    expect(updated()).toBe('Updated 5m')
  })

  it('refreshes the ages of the listed messages on the same clock', async () => {
    const instance = instanceWith([record()])
    const at = new Date(Date.now()).toISOString()
    const view = render(card(instance, record(), answering({ ok: true, messages: [{ role: 'user', text: 'Hi', at }] })))
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    await act(async () => { await Promise.resolve() })
    const age = (): string | null | undefined => view.container.querySelector('time')?.textContent
    expect(age()).toBe('now')
    act(() => { vi.advanceTimersByTime(AGE_REFRESH_MS * 4) })
    expect(age()).toBe('2m')
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the interval on unmount', () => {
    const instance = instanceWith([record()])
    const view = render(card(instance, record(), answering({ ok: true, messages: [] })))
    expect(vi.getTimerCount()).toBe(1)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('runs one interval for each card on the board', () => {
    const instance = instanceWith([record(), record({ id: WINDOW_B, ordinal: 2, x: 700 })])
    render(layer(instance, answering({ ok: true, messages: [] })))
    expect(vi.getTimerCount()).toBe(2)
  })
})

describe('general foreign window card', () => {
  it('names the computer and the window kind of a record without a chat card', () => {
    const instance = instanceWith([sessionless({ kind: 'tasks', bodyKind: 'tasks', title: 'Мои задачи' })])
    const renderSlot = (_name: string, _owner: unknown, opts: { fallback?: unknown }): unknown => opts.fallback
    const useStore = reactiveUseStore(instance)
    const view = render(createElement(ForeignWindowLayer, {
      useStore, actions: instance.actions, renderSlot, t,
    } as never))
    const body = view.container.querySelector('[data-board-foreign-card="window"]') as HTMLElement
    expect(body.textContent).toContain('Window on computer Юрист')
    expect(body.textContent).toContain('Tasks')
    expect(body.querySelector('button, input, textarea')).toBeNull()
  })

  it('does not repeat the kind label when it is the window title', () => {
    const instance = instanceWith([sessionless({ kind: 'tasks', bodyKind: 'tasks', title: null })])
    const renderSlot = (_name: string, _owner: unknown, opts: { fallback?: unknown }): unknown => opts.fallback
    const useStore = reactiveUseStore(instance)
    const view = render(createElement(ForeignWindowLayer, {
      useStore, actions: instance.actions, renderSlot, t,
    } as never))
    const body = view.container.querySelector('[data-board-foreign-card="window"]') as HTMLElement
    expect(body.querySelector('[data-board-foreign-kind]')).toBeNull()
  })
})

describe('foreign transcript', () => {
  it('offers no transcript for a record without a session', () => {
    const noSession = sessionless()
    const instance = instanceWith([noSession])
    const view = render(card(instance, noSession, answering({ ok: true, messages: [] })))
    expect(view.container.querySelector('button')).toBeNull()
  })

  it('loads, lists the messages as plain text with their roles, and keeps the wheel native', async () => {
    const instance = instanceWith([record()])
    const { fetchTranscript, reads } = pendingFetch()
    const view = render(card(instance, record(), fetchTranscript))

    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    expect(reads).toHaveLength(1)
    expect(reads[0]?.windowId).toBe(WINDOW_A)
    expect(view.container.textContent).toContain('Loading…')
    expect(screen.getByRole('button', { name: 'Refresh' }).getAttribute('aria-disabled')).toBe('true')

    reads[0]?.resolve({ ok: true, messages: MESSAGES })
    await settle()

    const list = screen.getByRole('list', { name: 'Window transcript' })
    expect(list.getAttribute('data-board-wheel')).toBe('native')
    const items = [...list.querySelectorAll('[data-board-transcript-message]')]
    expect(items.map(item => item.getAttribute('data-board-transcript-message'))).toEqual(['user', 'agent'])
    expect(items[0]?.textContent).toContain('User')
    expect(items[0]?.textContent).toContain('Check the contract')
    expect(items[1]?.textContent).toContain('Agent')
    const text = items[1]?.querySelector('[data-board-transcript-text]') as HTMLElement
    expect(text.textContent).toBe('Line one\nLine two <b>not bold</b>')
    expect(text.querySelector('b')).toBeNull()
    expect(list.querySelector('input, textarea, button, [contenteditable]')).toBeNull()
    expect(view.container.textContent).not.toContain('Loading…')
  })

  it('styles the message text for line breaks and long words, and bounds the list and the frame body', () => {
    const css = readFileSync(resolve('packages/client/ui-board/src/client/window/ForeignChatCard.module.css'), 'utf8')
    expect(css).toMatch(/\.text\s*\{[^}]*white-space:\s*pre-wrap/)
    expect(css).toMatch(/\.text\s*\{[^}]*overflow-wrap:\s*anywhere/)
    expect(css).toMatch(/\.list\s*\{[^}]*min-height:\s*calc\(/)
    const frame = readFileSync(resolve('packages/client/ui-board/src/client/window/ForeignWindowFrame.module.css'), 'utf8')
    expect(frame).toMatch(/\.body\s*\{[^}]*overflow:\s*hidden/)
  })

  it('opts only the controls, the live region, and the list back into pointer events', () => {
    // The frame passes no pointer events and the property inherits, so a
    // wrapper that opted in would swallow presses meant for the canvas.
    const css = readFileSync(resolve('packages/client/ui-board/src/client/window/ForeignChatCard.module.css'), 'utf8')
    const blocks = [...css.replaceAll(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)]
    const selectors = blocks
      .filter(([, , body]) => /pointer-events:\s*auto/.test(body ?? ''))
      .map(([, selector]) => selector?.trim())
    expect(selectors.sort()).toEqual(['.actions > button', '.list', '.status'])
  })

  it('keeps one live region that is present before the read and changes its text', async () => {
    const instance = instanceWith([record()])
    const { fetchTranscript, reads } = pendingFetch()
    const view = render(card(instance, record(), fetchTranscript))
    const region = view.container.querySelector('[role="status"]') as HTMLElement
    expect(region.textContent).toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    expect(view.container.querySelector('[role="status"]')).toBe(region)
    expect(region.textContent).toBe('Loading…')
    reads[0]?.resolve({ ok: false, code: 'ketos/peer-offline' })
    await settle()
    expect(view.container.querySelector('[role="status"]')).toBe(region)
    expect(region.textContent).toBe('Owner is offline')
    expect(view.container.querySelectorAll('[role="status"]')).toHaveLength(1)
  })

  it('keeps Refresh focusable while it loads and ignores its clicks', async () => {
    const instance = instanceWith([record()])
    const { fetchTranscript, reads } = pendingFetch()
    render(card(instance, record(), fetchTranscript))
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    expect(refresh.getAttribute('aria-disabled')).toBe('true')
    expect(refresh).toHaveProperty('disabled', false)
    refresh.focus()
    fireEvent.click(refresh)
    expect(reads).toHaveLength(1)
    expect(document.activeElement).toBe(refresh)

    reads[0]?.resolve({ ok: true, messages: MESSAGES })
    await settle()
    expect(refresh.getAttribute('aria-disabled')).toBe('false')
    fireEvent.click(refresh)
    expect(reads).toHaveLength(2)
  })

  it('lets the browser pick the direction of each message', async () => {
    const instance = instanceWith([record()])
    const view = render(card(instance, record(), answering({ ok: true, messages: [...MESSAGES] })))
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    await settle()
    const texts = [...view.container.querySelectorAll('[data-board-transcript-text]')]
    expect(texts).toHaveLength(2)
    for (const text of texts) expect(text.getAttribute('dir')).toBe('auto')
  })

  it('says so when the transcript has no messages', async () => {
    const instance = instanceWith([record()])
    const view = render(card(instance, record(), answering({ ok: true, messages: [] })))
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    await settle()
    expect(view.container.textContent).toContain('No messages yet')
    expect(view.container.querySelector('[data-board-transcript-message]')).toBeNull()
  })

  it.each([
    ['ketos/transcript-closed', 'Transcript closed by the owner'],
    ['ketos/peer-offline', 'Owner is offline'],
    ['ketos/peer-timeout', 'The owner did not answer in time'],
    ['ketos/window-not-found', 'The window no longer exists'],
    ['ketos/unreachable', 'Could not load the transcript'],
  ] as const)('names %s with its own caption', async (code, caption) => {
    const instance = instanceWith([record()])
    const view = render(card(instance, record(), answering({ ok: false, code })))
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    await settle()
    const notice = view.container.querySelector('[data-board-transcript-failure]') as HTMLElement
    expect(notice.textContent).toBe(caption)
    expect(notice.getAttribute('data-board-transcript-failure')).toBe(code)
    expect(notice.getAttribute('role')).toBe('status')
    expect(view.container.querySelectorAll('[role="status"]')).toHaveLength(1)
  })

  it('reads again on refresh and keeps the messages while it loads', async () => {
    const instance = instanceWith([record()])
    const { fetchTranscript, reads } = pendingFetch()
    const view = render(card(instance, record(), fetchTranscript))
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    reads[0]?.resolve({ ok: true, messages: MESSAGES })
    await settle()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(reads).toHaveLength(2)
    expect(view.container.querySelectorAll('[data-board-transcript-message]')).toHaveLength(2)
    reads[1]?.resolve({ ok: true, messages: [MESSAGES[0] as TranscriptMessage] })
    await settle()
    expect(view.container.querySelectorAll('[data-board-transcript-message]')).toHaveLength(1)
  })

  it('keeps the messages beside the caption when a refresh fails, except after the owner closed it', async () => {
    const instance = instanceWith([record()])
    const { fetchTranscript, reads } = pendingFetch()
    const view = render(card(instance, record(), fetchTranscript))
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    reads[0]?.resolve({ ok: true, messages: MESSAGES })
    await settle()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    reads[1]?.resolve({ ok: false, code: 'ketos/peer-offline' })
    await settle()
    expect(view.container.querySelector('[data-board-transcript-failure]')?.textContent).toBe('Owner is offline')
    expect(view.container.querySelectorAll('[data-board-transcript-message]')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    reads[2]?.resolve({ ok: false, code: 'ketos/transcript-closed' })
    await settle()
    expect(view.container.querySelector('[data-board-transcript-failure]')?.textContent)
      .toBe('Transcript closed by the owner')
    expect(view.container.querySelector('[data-board-transcript-message]')).toBeNull()
  })

  it('collapses on hide and reads again on the next show', async () => {
    const instance = instanceWith([record()])
    const { fetchTranscript, reads } = pendingFetch()
    const view = render(card(instance, record(), fetchTranscript))
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    reads[0]?.resolve({ ok: true, messages: MESSAGES })
    await settle()

    fireEvent.click(screen.getByRole('button', { name: 'Hide transcript' }))
    expect(view.container.querySelector('[role="list"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    expect(reads).toHaveLength(2)
  })

  it('marks the toggle expanded while the transcript is open', async () => {
    const instance = instanceWith([record()])
    render(card(instance, record(), answering({ ok: true, messages: [] })))
    const toggle = screen.getByRole('button', { name: 'Show transcript' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    await settle()
    expect(screen.getByRole('button', { name: 'Hide transcript' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('ignores the answer of a read that a hide and a new show replaced', async () => {
    const instance = instanceWith([record()])
    const { fetchTranscript, reads } = pendingFetch()
    const view = render(card(instance, record(), fetchTranscript))
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide transcript' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    expect(reads).toHaveLength(2)
    expect(reads[0]?.signal?.aborted).toBe(true)

    reads[1]?.resolve({ ok: true, messages: [MESSAGES[1] as TranscriptMessage] })
    await settle()
    reads[0]?.resolve({ ok: true, messages: [MESSAGES[0] as TranscriptMessage] })
    await settle()
    const roles = [...view.container.querySelectorAll('[data-board-transcript-message]')]
      .map(item => item.getAttribute('data-board-transcript-message'))
    expect(roles).toEqual(['agent'])
  })

  it('aborts an unfinished read on unmount and does not set state afterwards', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const instance = instanceWith([record()])
    const { fetchTranscript, reads } = pendingFetch()
    const view = render(card(instance, record(), fetchTranscript))
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    view.unmount()
    expect(reads[0]?.signal?.aborted).toBe(true)
    reads[0]?.resolve({ ok: true, messages: MESSAGES })
    await settle()
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('resets to the collapsed state and drops a late answer when the record changes', async () => {
    const first = record()
    const second = record({ id: WINDOW_B, ordinal: 2, title: 'Другое', sessionId: brandString<WindowSessionId>('session-2') })
    const instance = instanceWith([first, second])
    const { fetchTranscript, reads } = pendingFetch()
    const view = render(card(instance, first, fetchTranscript))
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    reads[0]?.resolve({ ok: true, messages: MESSAGES })
    await settle()
    expect(view.container.querySelectorAll('[data-board-transcript-message]')).toHaveLength(2)

    view.rerender(card(instance, second, fetchTranscript) as never)
    expect(view.container.querySelector('[data-board-transcript-message]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show transcript' })).not.toBeNull()

    // A read still running for the first record must not touch the second
    // record's own read, whichever order the answers arrive in.
    view.rerender(card(instance, first, fetchTranscript) as never)
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    const stale = reads[1] as PendingRead
    view.rerender(card(instance, second, fetchTranscript) as never)
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    const own = reads[2] as PendingRead
    expect(stale.signal?.aborted).toBe(true)
    stale.resolve({ ok: true, messages: [MESSAGES[0] as TranscriptMessage] })
    await settle()
    expect(view.container.querySelector('[data-board-transcript-message]')).toBeNull()
    expect(view.container.querySelector('[role="status"]')?.textContent).toBe('Loading…')

    own.resolve({ ok: true, messages: [MESSAGES[1] as TranscriptMessage] })
    await settle()
    const roles = [...view.container.querySelectorAll('[data-board-transcript-message]')]
      .map(item => item.getAttribute('data-board-transcript-message'))
    expect(roles).toEqual(['agent'])
  })

  it('collapses when the record loses its session', async () => {
    const instance = instanceWith([record()])
    const view = render(card(instance, record(), answering({ ok: true, messages: MESSAGES })))
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    await settle()
    view.rerender(card(instance, sessionless(), answering({ ok: true, messages: [] })) as never)
    expect(view.container.querySelector('button')).toBeNull()
    expect(view.container.querySelector('[role="list"]')).toBeNull()
  })
})

describe('foreign transcript scroll position', () => {
  /** Stub the scroll geometry jsdom lacks, restoring it after the test. */
  function stubScrollHeight(height: () => number): () => void {
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')
    Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, get: height })
    return () => {
      if (original === undefined) Reflect.deleteProperty(Element.prototype, 'scrollHeight')
      else Object.defineProperty(Element.prototype, 'scrollHeight', original)
    }
  }

  it('opens at the newest message and follows a refresh that changes the list', async () => {
    let height = 480
    const restore = stubScrollHeight(() => height)
    try {
      const instance = instanceWith([record()])
      const { fetchTranscript, reads } = pendingFetch()
      render(card(instance, record(), fetchTranscript))
      fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
      reads[0]?.resolve({ ok: true, messages: MESSAGES })
      await settle()
      const list = screen.getByRole('list', { name: 'Window transcript' })
      expect(list.scrollTop).toBe(480)

      height = 900
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
      reads[1]?.resolve({ ok: true, messages: [...MESSAGES, { role: 'user', text: 'More', at: '2026-10-09T10:01:00.000Z' }] })
      await settle()
      expect(screen.getByRole('list', { name: 'Window transcript' }).scrollTop).toBe(900)
    } finally {
      restore()
    }
  })

  it('does not move the list when only the age clock re-renders it', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-09T12:00:00.000Z') })
    const restore = stubScrollHeight(() => 480)
    try {
      const instance = instanceWith([record()])
      render(card(instance, record(), answering({ ok: true, messages: [...MESSAGES] })))
      fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
      await act(async () => { await Promise.resolve() })
      const list = screen.getByRole('list', { name: 'Window transcript' })
      list.scrollTop = 120
      act(() => { vi.advanceTimersByTime(AGE_REFRESH_MS) })
      expect(list.scrollTop).toBe(120)
    } finally {
      restore()
    }
  })
})

describe('foreign transcript refresh control', () => {
  it('styles the busy Refresh as unavailable, since aria-disabled does not match :disabled', () => {
    // jsdom applies no stylesheet, so the rule is pinned in the source.
    const css = readFileSync(resolve('packages/client/ui-board/src/client/window/ForeignChatCard.module.css'), 'utf8')
    expect(css).toMatch(/\.actions > button\[aria-disabled='true'\]\s*\{[^}]*opacity:/)
    expect(css).toMatch(/\.actions > button\[aria-disabled='true'\]\s*\{[^}]*cursor:\s*not-allowed/)
  })
})

describe('foreign card culling', () => {
  it('unmounts an open transcript when the window is panned out of view and reopens it collapsed', async () => {
    const instance = instanceWith([record()])
    const view = render(layer(instance, answering({ ok: true, messages: [...MESSAGES] })))
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }))
    await settle()
    expect(view.container.querySelector('[data-board-transcript-message]')).not.toBeNull()

    act(() => { instance.actions.setPan(-1_000_000, 0) })
    expect(view.container.querySelector('[data-board-foreign-card]')).toBeNull()

    act(() => { instance.actions.setPan(0, 0) })
    expect(view.container.querySelector('[data-board-transcript-message]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show transcript' }).getAttribute('aria-expanded')).toBe('false')
  })
})

describe('foreign chat card copy', () => {
  it('renders the owner, the age, and the transcript copy from the zh dictionary', async () => {
    const instance = instanceWith([record({ updatedAt: Date.now() - 5 * 60_000 })])
    const fiveMinutesOld = record({ updatedAt: Date.now() - 5 * 60_000 })
    const view = render(card(instance, fiveMinutesOld, answering({ ok: true, messages: [...MESSAGES] }), translator(zh)))
    expect(view.container.querySelector('[data-board-foreign-owner]')?.textContent).toBe('所有者：Юрист')
    expect(view.container.querySelector('[data-board-foreign-updated]')?.textContent).toBe('最近更改：5分钟')
    fireEvent.click(screen.getByRole('button', { name: '显示对话记录' }))
    await settle()
    const list = screen.getByRole('list', { name: '窗口对话记录' })
    expect(list.textContent).toContain('用户')
    expect(list.textContent).toContain('代理')
    expect(screen.getByRole('button', { name: '刷新' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '隐藏对话记录' })).not.toBeNull()
  })

  it('takes every visible string from the translator, so another locale needs no component change', async () => {
    // A pseudo-locale marks each dictionary string; Russian and any later
    // pack are checked the same way against the key set in their own package.
    const marked: Record<BoardKey, string> = Object.fromEntries(
      Object.entries(en).map(([key, value]) => [key, `«${value}»`]),
    ) as Record<BoardKey, string>
    const instance = instanceWith([record()])
    const view = render(card(instance, record(), answering({ ok: false, code: 'ketos/peer-offline' }), translator(marked)))
    fireEvent.click(screen.getByRole('button', { name: '«Show transcript»' }))
    await settle()
    let text = view.container.textContent ?? ''
    for (let previous = ''; previous !== text;) {
      previous = text
      text = text.replaceAll(/«[^«»]*»/g, '')
    }
    text = text.replaceAll('Юрист', '')
    expect(text.trim()).toBe('')
    expect(view.container.querySelector('[role="status"]')?.textContent).toBe('«Owner is offline»')
  })
})
