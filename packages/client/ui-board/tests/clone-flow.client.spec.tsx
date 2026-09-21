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
import { createBoardBench, type BoardBenchOptions } from './fixtures.client.ts'

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

/** The route stub's state: the stored clones and every recorded operation. */
interface CloneServer {
  readonly clones: CloneDto[]
  readonly calls: CloneCall[]
}

/** The decoded request body of one recorded call. */
function bodyOf(server: CloneServer, op: string): Record<string, unknown> {
  const call = server.calls.find(entry => entry.op === op)
  if (call === undefined) throw new Error(`no ${op} call was recorded`)
  return call.body
}

/**
 * Stub the clone route with a small clone store, so a save re-reads what it
 * wrote and a conflict can be provoked.
 * @param initial - clones the roster starts with.
 * @returns the stub's state.
 */
function stubCloneRoute(initial: readonly CloneDto[]): CloneServer {
  const server: CloneServer = { clones: [...initial], calls: [] }
  vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET'
    if (method === 'GET') return Response.json({ ok: true, clones: server.clones })
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>
    const op = String(body['op'])
    server.calls.push({ op, body })
    switch (op) {
      case 'list':
        return Response.json({ ok: true, clones: server.clones })
      case 'create': {
        const created: CloneDto = {
          ...CLONE,
          id: `clone-${String(server.clones.length + 1)}` as CloneId,
          name: String(body['name']),
          role: String(body['role']),
        }
        server.clones.unshift(created)
        return Response.json({ ok: true, clone: created })
      }
      case 'update': {
        const index = server.clones.findIndex(entry => entry.id === String(body['id']))
        if (index === -1) return Response.json({ ok: false, error: 'ketos/clone-not-found' }, { status: 404 })
        const current = server.clones[index] as CloneDto
        if (current.revision !== body['revision']) {
          return Response.json({ ok: false, error: 'ketos/clone-conflict' }, { status: 409 })
        }
        const updated = { ...current, ...body['patch'] as object, revision: current.revision + 1 } as CloneDto
        server.clones[index] = updated
        return Response.json({ ok: true, clone: updated })
      }
      case 'delete': {
        const index = server.clones.findIndex(entry => entry.id === String(body['id']))
        if (index === -1) return Response.json({ ok: false, error: 'ketos/clone-not-found' }, { status: 404 })
        server.clones.splice(index, 1)
        return Response.json({ ok: true, id: body['id'] })
      }
      case 'bindSession':
        return Response.json({
          ok: true,
          binding: {
            sessionId: body['sessionId'],
            cloneId: body['cloneId'],
            role: 'main',
            createdAt: '2026-09-21T00:00:00.000Z',
          },
        })
      default:
        return Response.json({ ok: true, sessions: [] })
    }
  }))
  return server
}

/** Mount the board, render its panel, and hand the runtime pieces to the test. */
async function mounted(options: Omit<BoardBenchOptions, 'session'> = {}) {
  const prepared = await createBoardBench({
    session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) },
    ...options,
  })
  runtimes.add(prepared.runtime)
  const board = await prepared.mountBoard()
  const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
  const store = prepared.runtime.storeOf('board.dock') as BoardInstance
  const windowsOfKind = (kind: string): number =>
    Object.values(store.getSnapshot().windows).filter(window => window.kind === kind).length
  const field = (name: string): HTMLElement | null => panel.container.querySelector(`[data-board-clone="${name}"]`)
  return { runtime: prepared.runtime, board, panel, store, windowsOfKind, field }
}

describe('clone roster in the board chrome', () => {
  it('lists the stored clones in the dock and opens the editor window on a row click', async () => {
    stubCloneRoute([CLONE])
    const { panel, store, windowsOfKind, field } = await mounted()
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })

    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    const cloneWindow = Object.values(store.getSnapshot().windows).find(window => window.kind === 'clone')
    expect(cloneWindow?.cloneId).toBe('clone-1')
    await waitFor(() => { expect(field('name')).not.toBeNull() })
    // The frame and the dock both name the window after the clone it edits.
    expect(panel.container.querySelector('[data-board-action="window-rename"]')?.getAttribute('data-board-title')).toBe('Анна')
    expect(panel.container.querySelector('[data-board-kind="clone"]')?.getAttribute('data-board-title')).toBe('Анна')
    // Opening the same clone again focuses the window that already edits it.
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    expect(windowsOfKind('clone')).toBe(1)
  })

  it('creates a clone from the Action Menu and opens its editor', async () => {
    const server = stubCloneRoute([])
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
    await waitFor(() => { expect(server.calls.some(call => call.op === 'create')).toBe(true) })
    const cloneWindow = Object.values(store.getSnapshot().windows).find(window => window.kind === 'clone')
    expect(server.clones).toHaveLength(1)
    expect(cloneWindow?.cloneId).toBe(server.clones[0]?.id)
  })

  it('saves an edited clone and re-reads it from the route', async () => {
    const server = stubCloneRoute([CLONE])
    const { panel, windowsOfKind, field } = await mounted()
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    await waitFor(() => { expect(field('name')).not.toBeNull() })

    fireEvent.change(field('name') as Element, { target: { value: 'Анна П.' } })
    fireEvent.click(field('save') as Element)
    await waitFor(() => { expect(server.calls.some(call => call.op === 'update')).toBe(true) })
    expect(bodyOf(server, 'update')).toMatchObject({
      op: 'update',
      id: 'clone-1',
      revision: 1,
      patch: { name: 'Анна П.' },
    })
    // The re-read record carries the new revision, so the editor stops at the
    // revision the route now holds instead of saving over it later.
    await waitFor(() => {
      expect(panel.container.querySelector('[data-board-clone-revision="2"]')).not.toBeNull()
    })
    expect(windowsOfKind('clone')).toBe(1)
  })
})

describe('clone sessions', () => {
  it('creates a session for the clone, binds it, and lists it in the editor', async () => {
    const server = stubCloneRoute([CLONE])
    const { panel, windowsOfKind, field } = await mounted()
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })

    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    await waitFor(() => { expect(field('session')).not.toBeNull() })

    act(() => {
      fireEvent.click(field('session') as Element)
    })
    await waitFor(() => {
      expect(server.calls.find(call => call.op === 'bindSession')?.body).toMatchObject({
        cloneId: 'clone-1',
        sessionId: 'session-1',
      })
    })
    // The session opened in a chat window of its own and stays bound to the clone.
    expect(windowsOfKind('agent')).toBe(1)
    await waitFor(() => {
      expect(server.calls.filter(call => call.op === 'listSessions').length).toBeGreaterThan(1)
    })
  })

  it('applies the clone preferred model to the created session', async () => {
    const select = vi.fn(async () => {})
    stubCloneRoute([{ ...CLONE, preferredModel: 'deepseek/deepseek-reasoner' }])
    const { panel, field } = await mounted({ modelDirectory: { select } })
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    await waitFor(() => { expect(field('session')).not.toBeNull() })
    act(() => {
      fireEvent.click(field('session') as Element)
    })
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({ provider: 'deepseek', model: 'deepseek-reasoner' })
    })
  })

  it('sends a prompt from a clone window into a chat window of its own', async () => {
    stubCloneRoute([CLONE])
    const { panel, store, windowsOfKind } = await mounted()
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-editor]')).not.toBeNull() })

    const input = panel.container.querySelector('[data-board-action="omnibar-input"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'привет' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    // The clone window edits a card: the prompt opens a chat window instead of
    // binding a session the clone window could never show.
    await waitFor(() => { expect(windowsOfKind('agent')).toBe(1) })
    expect(panel.container.querySelector('[data-board-clone-editor]')).not.toBeNull()
    expect(Object.values(store.getSnapshot().windows).find(window => window.kind === 'clone')?.bodyKind).toBe('clone')
  })
})
