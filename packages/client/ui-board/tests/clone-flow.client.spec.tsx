// @vitest-environment jsdom
/**
 * Clone flow through the assembled board: the `/api/ketos.clones` roster fills
 * the dock and the Action Menu, opening a clone window edits that record, and
 * creating a session for the clone binds the session to it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { CloneDto, CloneId } from '@ketos/clone-core/types'
import { createBoardStore } from '../src/client/store.ts'
import { createBoardBench } from './fixtures.client.ts'

/** The live board store instance the renderer resolves for the board's registrations. */
type BoardInstance = ReturnType<ReturnType<typeof createBoardStore>['create']>

const runtimes = new Set<SlotTestRuntime>()

afterEach(async () => {
  try {
    for (const runtime of runtimes) await runtime.dispose()
  } finally {
    runtimes.clear()
    cleanup()
    vi.unstubAllGlobals()
  }
})

const CLONE: CloneDto = {
  id: 'clone-1' as CloneId,
  name: 'Анна',
  role: 'Аналитик',
  description: 'Разбор требований',
  persona: '',
  methodology: '',
  preferredModel: null,
  skills: [],
  status: 'draft',
  revision: 1,
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
}

/** One recorded clone request. */
interface CloneCall {
  readonly op: string
  readonly body: Record<string, unknown>
}

/**
 * Stub the clone route: the roster read plus every recorded operation.
 * @param clones - clones the roster answers with.
 * @returns the recorded operations, newest last.
 */
function stubCloneRoute(clones: readonly CloneDto[]): CloneCall[] {
  const calls: CloneCall[] = []
  vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET'
    if (method === 'GET') return Response.json({ ok: true, clones })
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>
    const op = String(body['op'])
    calls.push({ op, body })
    switch (op) {
      case 'create':
        return Response.json({ ok: true, clone: { ...CLONE, id: 'clone-2' as CloneId, name: String(body['name']) } })
      case 'bindSession':
        return Response.json({
          ok: true,
          binding: { sessionId: body['sessionId'], cloneId: body['cloneId'], role: 'main', createdAt: '2026-09-21T00:00:00.000Z' },
        })
      default:
        return Response.json({ ok: true, sessions: [] })
    }
  }))
  return calls
}

/** Mount the board, render its panel, and hand the runtime pieces to the test. */
async function mounted() {
  const prepared = await createBoardBench({ session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) } })
  runtimes.add(prepared.runtime)
  const board = await prepared.mountBoard()
  const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
  const store = prepared.runtime.storeOf('board.dock') as BoardInstance
  return { runtime: prepared.runtime, board, panel, store }
}

describe('clone roster in the board chrome', () => {
  it('lists the stored clones in the dock and opens the editor window on a row click', async () => {
    stubCloneRoute([CLONE])
    const { panel, store } = await mounted()
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })

    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    const windows = store.getSnapshot().windows
    const cloneWindow = Object.values(windows).find(window => window.kind === 'clone')
    expect(cloneWindow?.cloneId).toBe('clone-1')
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone="name"]')).not.toBeNull() })
    // The frame names the window after the clone it edits.
    expect(panel.container.querySelector('[data-board-action="window-rename"]')?.getAttribute('data-board-title')).toBe('Анна')
  })

  it('creates a clone from the Action Menu and opens its editor', async () => {
    const calls = stubCloneRoute([])
    const { panel, store } = await mounted()
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-action="omnibar-action-menu"]') as Element)
    })
    const newClone = await waitFor(() => {
      const item = [...panel.container.ownerDocument.querySelectorAll('[role="menuitem"]')]
        .find(node => node.textContent === 'New clone')
      expect(item).toBeDefined()
      return item as Element
    })
    act(() => { fireEvent.click(newClone) })
    await waitFor(() => { expect(calls.some(call => call.op === 'create')).toBe(true) })
    const cloneWindow = Object.values(store.getSnapshot().windows).find(window => window.kind === 'clone')
    expect(cloneWindow?.cloneId).toBe('clone-2')
  })
})

describe('clone sessions', () => {
  it('creates a session for the clone, binds it, and lists it in the editor', async () => {
    const calls = stubCloneRoute([CLONE])
    const { panel, store } = await mounted()
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })

    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone="session"]')).not.toBeNull() })

    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone="session"]') as Element)
    })
    await waitFor(() => {
      expect(calls.find(call => call.op === 'bindSession')?.body).toMatchObject({
        cloneId: 'clone-1',
        sessionId: 'session-1',
      })
    })
    // The session opened in a chat window of its own and stays bound to the clone.
    const windows = store.getSnapshot().windows
    expect(Object.values(windows).some(window => window.kind === 'agent')).toBe(true)
    await waitFor(() => {
      expect(calls.filter(call => call.op === 'listSessions').length).toBeGreaterThan(1)
    })
  })
})
