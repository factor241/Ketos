// @vitest-environment jsdom
/**
 * Window naming: the header and dock follow the chat title the session list
 * reports, a user rename overrides it, and a template fallback re-localizes
 * when the locale changes instead of freezing the locale it opened in.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent } from '@testing-library/react'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { createBoardStore } from '../src/client/store.ts'
import type { WindowId } from '../src/client/contract/slots.ts'
import { createBoardBench } from './fixtures.client.ts'

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

/** Bench with a live window and the fixture session the window binds to. */
async function bench(options: {
  readonly displayTitle?: string
  readonly failCreate?: boolean
  readonly extraSessions?: readonly { readonly id: string; readonly displayTitle: string }[]
} = {}) {
  const prepared = await createBoardBench({
    session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) },
    ...(options.displayTitle === undefined ? {} : { sessionSummary: { displayTitle: options.displayTitle } }),
    ...(options.extraSessions === undefined ? {} : { extraSessions: options.extraSessions }),
  })
  runtimes.add(prepared.runtime)
  if (options.failCreate === true) {
    prepared.runtime.sessions.stubCreate(async () => { throw new Error('creation refused') })
  }
  const board = await prepared.mountBoard()
  const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
  const store = prepared.runtime.storeOf('board.dock') as BoardInstance
  return { prepared, board, panel, store }
}

/** The header title button's resolved label. */
function headerTitle(panel: { container: HTMLElement }): string | null {
  return panel.container.querySelector('[data-board-action="window-rename"]')?.getAttribute('data-board-title') ?? null
}

describe('window title', () => {
  it('shows the chat title instead of the template name once the session binds', async () => {
    const { prepared, panel, store } = await bench({ displayTitle: 'Chat one' })
    act(() => { store.actions.openWindow({ id: 'a1' as WindowId, kind: 'agent', bodyKind: 'conversation', ordinal: 4, width: 552, height: 648 }) })
    await prepared.runtime.flush()

    expect(headerTitle(panel)).toBe('Chat one')

    const sessionId = prepared.runtime.sessions.list.getSnapshot().ids[0]
    if (sessionId === undefined) throw new Error('missing session id')
    await prepared.runtime.sessions.updateSummary(sessionId, { displayTitle: 'Renamed chat' })
    await prepared.runtime.flush()
    expect(headerTitle(panel)).toBe('Renamed chat')
  })

  it('follows a rebind to another chat through the chats panel', async () => {
    const { prepared, panel, store } = await bench({
      displayTitle: 'Chat one',
      extraSessions: [{ id: 'session-2', displayTitle: 'Chat two' }],
    })
    act(() => { store.actions.openWindow({ id: 'a1' as WindowId, kind: 'agent', bodyKind: 'conversation', ordinal: 4, width: 552, height: 648 }) })
    await prepared.runtime.flush()
    expect(headerTitle(panel)).toBe('Chat one')

    // The real user path: open the window's chats panel, drill into the
    // ungrouped project, and pick the other chat.
    fireEvent.click(panel.container.querySelector('[data-board-action="window-chats"]') as Element)
    await prepared.runtime.flush()
    fireEvent.click(panel.view.getByText('Ungrouped'))
    await prepared.runtime.flush()
    fireEvent.click(panel.view.getByText('Chat two'))
    await prepared.runtime.flush()
    await prepared.runtime.flush()
    expect(headerTitle(panel)).toBe('Chat two')
  })

  it('keeps a user rename over the chat title and clears back to it', async () => {
    const { prepared, panel, store } = await bench({ displayTitle: 'Chat one' })
    act(() => { store.actions.openWindow({ id: 'a1' as WindowId, kind: 'agent', bodyKind: 'conversation', ordinal: 4, width: 552, height: 648 }) })
    await prepared.runtime.flush()

    fireEvent.click(panel.container.querySelector('[data-board-action="window-rename"]') as Element)
    const input = panel.container.querySelector('[data-board-action="window-title-input"]') as HTMLInputElement
    expect(input.value).toBe('')
    fireEvent.change(input, { target: { value: 'Мой агент' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(headerTitle(panel)).toBe('Мой агент')

    const sessionId = prepared.runtime.sessions.list.getSnapshot().ids[0]
    if (sessionId === undefined) throw new Error('missing session id')
    await prepared.runtime.sessions.updateSummary(sessionId, { displayTitle: 'Renamed chat' })
    await prepared.runtime.flush()
    expect(headerTitle(panel)).toBe('Мой агент')

    // An empty name clears the override and the chat title returns.
    fireEvent.click(panel.container.querySelector('[data-board-action="window-rename"]') as Element)
    const again = panel.container.querySelector('[data-board-action="window-title-input"]') as HTMLInputElement
    fireEvent.change(again, { target: { value: '' } })
    fireEvent.keyDown(again, { key: 'Enter' })
    expect(headerTitle(panel)).toBe('Renamed chat')
  })

  it('cancels a header rename on Escape', async () => {
    const { prepared, panel, store } = await bench({ displayTitle: 'Chat one' })
    act(() => { store.actions.openWindow({ id: 'a1' as WindowId, kind: 'agent', bodyKind: 'conversation', ordinal: 4, width: 552, height: 648 }) })
    await prepared.runtime.flush()

    fireEvent.click(panel.container.querySelector('[data-board-action="window-rename"]') as Element)
    const input = panel.container.querySelector('[data-board-action="window-title-input"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Не сохранять' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(headerTitle(panel)).toBe('Chat one')
  })

  it('renames the window from its dock row', async () => {
    const { prepared, panel, store } = await bench({ displayTitle: 'Chat one' })
    act(() => { store.actions.openWindow({ id: 'a1' as WindowId, kind: 'agent', bodyKind: 'conversation', ordinal: 4, width: 552, height: 648 }) })
    await prepared.runtime.flush()

    const row = panel.container.querySelector('[data-board-action="dock-row"]') as Element
    expect(row.getAttribute('data-board-title')).toBe('Chat one')
    fireEvent.doubleClick(row)
    const input = panel.container.querySelector('[data-board-action="dock-title-input"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Док-имя' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(headerTitle(panel)).toBe('Док-имя')
    expect((panel.container.querySelector('[data-board-action="dock-row"]') as Element).getAttribute('data-board-title')).toBe('Док-имя')
  })

  it('re-localizes the template fallback when the locale changes', async () => {
    const { prepared, panel, store } = await bench({ failCreate: true })
    act(() => {
      store.actions.openWindow({ id: 'a1' as WindowId, kind: 'agent', bodyKind: 'conversation', ordinal: 4, width: 552, height: 648 })
      store.actions.openWindow({ id: 't1' as WindowId, kind: 'connectors', bodyKind: 'connectors', ordinal: 1, width: 552, height: 648 })
    })
    await prepared.runtime.flush()
    expect(headerTitle(panel)).toBe('Agent #4')
    // The tool window names itself from its kind, without a session.
    expect(panel.container.querySelector('[data-board-window="connectors"] [data-board-title]')?.getAttribute('data-board-title')).toBe('Connectors')

    prepared.locale.setLocale('zh')
    await prepared.runtime.flush()
    expect(headerTitle(panel)).toBe('代理 #4')
    expect(panel.container.querySelector('[data-board-window="connectors"] [data-board-title]')?.getAttribute('data-board-title')).toBe('连接器')
  })

  it('falls back to the template name when creation fails', async () => {
    const { prepared, panel, store } = await bench({ failCreate: true })
    act(() => { store.actions.openWindow({ id: 'a1' as WindowId, kind: 'agent', bodyKind: 'conversation', ordinal: 2, width: 552, height: 648 }) })
    await prepared.runtime.flush()
    expect(headerTitle(panel)).toBe('Agent #2')
  })
})
