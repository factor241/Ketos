// @vitest-environment jsdom
/**
 * Clone flow through the assembled board: the `/api/ketos.clones` roster fills
 * the dock and the Action Menu, opening a clone window edits that record, and
 * starting the interview marks the clone, binds the session with the interview
 * role, and presents that session inside the clone window.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { CloneDto, CloneId, CloneSessionBinding } from '@ketos/clone-core/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
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

/** The route stub's state: the stored clones, their bindings, and every recorded operation. */
interface CloneServer {
  readonly clones: CloneDto[]
  readonly bindings: CloneSessionBinding[]
  readonly calls: CloneCall[]
  /** Operation the stub refuses, so a failure path can be exercised. */
  refuse?: string
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
  const server: CloneServer = { clones: [...initial], bindings: [], calls: [] }
  vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET'
    if (method === 'GET') return Response.json({ ok: true, clones: server.clones })
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>
    const op = String(body['op'])
    server.calls.push({ op, body })
    if (server.refuse === op) return Response.json({ ok: false, error: 'ketos/invalid' }, { status: 400 })
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
      case 'bindSession': {
        // The host stores the requested role; the stub mirrors that so a later
        // listSessions answer reports what the client actually asked for.
        const binding: CloneSessionBinding = {
          sessionId: body['sessionId'] as SessionId,
          cloneId: body['cloneId'] as CloneId,
          role: (body['role'] ?? 'main') as CloneSessionBinding['role'],
          createdAt: '2026-09-21T00:00:00.000Z',
        }
        server.bindings.push(binding)
        return Response.json({ ok: true, binding })
      }
      case 'listSessions':
        return Response.json({
          ok: true,
          sessions: server.bindings.filter(binding => binding.cloneId === body['cloneId']),
        })
      default:
        return Response.json({ ok: true, sessions: [] })
    }
  }))
  return server
}

/** Mount the board, render its panel, and hand the runtime pieces to the test. */
async function mounted(options: Omit<BoardBenchOptions, 'session'> = {}) {
  const prompt = vi.fn(async () => ({ ok: true as const, value: { accepted: true } }))
  const prepared = await createBoardBench({ session: { prompt }, ...options })
  runtimes.add(prepared.runtime)
  const board = await prepared.mountBoard()
  const panel = prepared.runtime.renderSlot('main', {}, { entryKey: 'board' })
  const store = prepared.runtime.storeOf('board.dock') as BoardInstance
  const windowsOfKind = (kind: string): number =>
    Object.values(store.getSnapshot().windows).filter(window => window.kind === kind).length
  const cloneWindow = () => Object.values(store.getSnapshot().windows).find(window => window.kind === 'clone')
  const field = (name: string): HTMLElement | null => panel.container.querySelector(`[data-board-clone="${name}"]`)
  return { runtime: prepared.runtime, board, panel, store, windowsOfKind, cloneWindow, field, prompt }
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

  it('names the clone window after the clone, not after its interview session', async () => {
    stubCloneRoute([CLONE])
    // The interview session gets the bench's title the moment the window binds
    // it; the window that edits the record must keep the record's name.
    const { panel, cloneWindow, field } = await mounted({ sessionSummary: { displayTitle: 'Я старший аналитик да' } })
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })

    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    await waitFor(() => { expect(field('interview')).not.toBeNull() })
    act(() => {
      fireEvent.click(field('interview') as Element)
    })
    // The window owns the titled session now, and still shows the clone's name.
    await waitFor(() => { expect(cloneWindow()?.bodyKind).toBe('conversation') })
    expect(panel.container.querySelector('[data-board-action="window-rename"]')?.getAttribute('data-board-title')).toBe('Анна')
    expect(panel.container.querySelector('[data-board-kind="clone"]')?.getAttribute('data-board-title')).toBe('Анна')
  })

  it('treats the interview the user started as its own gesture, never as an agent revision', async () => {
    stubCloneRoute([CLONE])
    const { panel, field } = await mounted()
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    await waitFor(() => { expect(field('interview')).not.toBeNull() })
    act(() => {
      fireEvent.click(field('interview') as Element)
    })
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-interview="active"]')).not.toBeNull() })

    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-tab="profile"]') as Element)
    })
    await waitFor(() => { expect(field('name')).not.toBeNull() })
    // The status the start gesture wrote is not something the agent changed.
    expect(panel.container.querySelector('[data-board-clone-agent-field="status"]')).toBeNull()
    expect(panel.container.querySelector('[data-board-clone-notice="agent"]')).toBeNull()
  })

  it('reports a refused start without creating a session or binding one', async () => {
    const server = stubCloneRoute([CLONE])
    const { panel, field, windowsOfKind } = await mounted()
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    await waitFor(() => { expect(field('interview')).not.toBeNull() })

    server.refuse = 'update'
    act(() => {
      fireEvent.click(field('interview') as Element)
    })
    // The status write is the first step: a refusal leaves no session behind.
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-notice="failed"]')).not.toBeNull() })
    expect(server.calls.some(call => call.op === 'bindSession')).toBe(false)
    expect(windowsOfKind('agent')).toBe(0)
    expect(server.clones[0]?.status).toBe('draft')
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

describe('clone interview', () => {
  it('starts the interview from the clone window and presents the session inside it', async () => {
    const server = stubCloneRoute([CLONE])
    const { panel, windowsOfKind, cloneWindow, field } = await mounted()
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })

    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    await waitFor(() => { expect(field('interview')).not.toBeNull() })

    act(() => {
      fireEvent.click(field('interview') as Element)
    })
    await waitFor(() => { expect(server.calls.some(call => call.op === 'bindSession')).toBe(true) })
    // The clone is `interviewing` before the session is bound, so the host
    // composes the interview mode into the agent that owns this session.
    expect(bodyOf(server, 'update')).toMatchObject({
      op: 'update',
      id: 'clone-1',
      patch: { status: 'interviewing' },
    })
    expect(bodyOf(server, 'bindSession')).toMatchObject({
      cloneId: 'clone-1',
      sessionId: 'session-1',
      role: 'interview',
    })
    // The interview runs in the clone window's own conversation body: no extra
    // chat window opens for it.
    await waitFor(() => { expect(cloneWindow()?.bodyKind).toBe('conversation') })
    expect(windowsOfKind('agent')).toBe(0)
    await waitFor(() => {
      expect(panel.container.querySelector('[data-board-clone-interview="active"]')).not.toBeNull()
    })
    expect(panel.container.querySelector('[data-board-clone-interview="active"]')?.textContent)
      .toContain('Answer the interview questions; the agent saves the profile at the end.')
  })

  it('lists the bound interview session in the editor', async () => {
    const server = stubCloneRoute([CLONE])
    const { panel, cloneWindow, field } = await mounted()
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    await waitFor(() => { expect(field('interview')).not.toBeNull() })
    act(() => {
      fireEvent.click(field('interview') as Element)
    })
    await waitFor(() => { expect(cloneWindow()?.bodyKind).toBe('conversation') })
    // Back on the profile tab the editor lists the binding the interview wrote.
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-tab="profile"]') as Element)
    })
    await waitFor(() => {
      expect(panel.container.querySelector('[data-board-clone-session="session-1"]')).not.toBeNull()
    })
    expect(server.bindings).toHaveLength(1)
  })

  it('applies the clone preferred model to the interview session', async () => {
    const select = vi.fn(async () => {})
    stubCloneRoute([{ ...CLONE, preferredModel: 'deepseek/deepseek-reasoner' }])
    const { panel, field } = await mounted({ modelDirectory: { select } })
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    await waitFor(() => { expect(field('interview')).not.toBeNull() })
    act(() => {
      fireEvent.click(field('interview') as Element)
    })
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({ provider: 'deepseek', model: 'deepseek-reasoner' })
    })
  })

  it('sends a prompt from a clone window on the profile body into a chat window of its own', async () => {
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

  it('sends a prompt into the clone window once it presents the interview', async () => {
    stubCloneRoute([CLONE])
    const { panel, store, windowsOfKind, cloneWindow, field, prompt } = await mounted()
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    await waitFor(() => { expect(field('interview')).not.toBeNull() })
    act(() => {
      fireEvent.click(field('interview') as Element)
    })
    await waitFor(() => { expect(cloneWindow()?.bodyKind).toBe('conversation') })

    const input = panel.container.querySelector('[data-board-action="omnibar-input"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'привет' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    // The interviewing clone window is a conversation: the prompt lands in its
    // own session instead of opening a second window for it.
    await waitFor(() => { expect(prompt).toHaveBeenCalled() })
    expect(windowsOfKind('agent')).toBe(0)
    expect(store.getSnapshot().activeWindowId).toBe(cloneWindow()?.id)
  })
})
