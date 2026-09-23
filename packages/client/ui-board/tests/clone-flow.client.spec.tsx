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
import type { CloneDto, CloneId, CloneSessionBinding, CloneTaskDto, MemoryDto, TaskId } from '@ketos/clone-core/types'
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
  skills: [{
    name: 'weekly-report',
    description: 'Собирает недельный отчёт',
    instructions: 'Возьми цифры из трекера',
  }],
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

/** The route stub's state: the stored clones, their bindings, their memory, and every recorded operation. */
interface CloneServer {
  readonly clones: CloneDto[]
  readonly bindings: CloneSessionBinding[]
  readonly memories: MemoryDto[]
  readonly tasks: CloneTaskDto[]
  readonly calls: CloneCall[]
  /** Operation the stub refuses, so a failure path can be exercised. */
  refuse?: string
  /** Whether the memory stub refuses a search with `ketos/invalid`. */
  refuseMemorySearch?: boolean
  /** One tasks operation the stub refuses with a stable code. */
  taskRefuse?: { readonly op: string; readonly status: number; readonly error: string }
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
  const server: CloneServer = { clones: [...initial], bindings: [], memories: [], tasks: [], calls: [] }
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
    if (String(input) === '/api/ketos.memory') return memoryAnswer(server, init)
    if (String(input) === '/api/ketos.tasks') return taskAnswer(server, init)
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

/**
 * Answer one `/api/ketos.memory` request from the stub's memory store.
 * @param server - the stub's state.
 * @param init - the request's init, carrying the body.
 * @returns the route's answer.
 */
function memoryAnswer(server: CloneServer, init?: RequestInit): Response {
  const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>
  const op = String(body['op'])
  server.calls.push({ op: `memory:${op}`, body })
  switch (op) {
    case 'list':
      return Response.json({
        ok: true,
        memories: server.memories.filter(memory => body['status'] === undefined || memory.status === body['status']),
      })
    case 'search':
      if (server.refuseMemorySearch === true) {
        return Response.json({ ok: false, error: 'ketos/invalid' }, { status: 400 })
      }
      return Response.json({
        ok: true,
        memories: server.memories.filter(memory => memory.content.includes(String(body['query']))),
      })
    case 'update': {
      const index = server.memories.findIndex(memory => memory.id === body['id'])
      if (index === -1) return Response.json({ ok: false, error: 'ketos/memory-not-found' }, { status: 404 })
      const updated = { ...server.memories[index] as MemoryDto, ...body['patch'] as object } as MemoryDto
      server.memories[index] = updated
      return Response.json({ ok: true, memory: updated })
    }
    case 'delete': {
      const index = server.memories.findIndex(memory => memory.id === body['id'])
      if (index === -1) return Response.json({ ok: false, error: 'ketos/memory-not-found' }, { status: 404 })
      server.memories.splice(index, 1)
      return Response.json({ ok: true, id: body['id'] })
    }
    default:
      return Response.json({ ok: false, error: 'ketos/invalid' }, { status: 400 })
  }
}

/**
 * Answer one `/api/ketos.tasks` request from the stub's task store.
 * @param server - the stub's state.
 * @param init - the request's init, carrying the body.
 * @returns the route's answer.
 */
function taskAnswer(server: CloneServer, init?: RequestInit): Response {
  const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>
  const op = String(body['op'])
  server.calls.push({ op: `task:${op}`, body })
  if (server.taskRefuse?.op === op) {
    return Response.json({ ok: false, error: server.taskRefuse.error }, { status: server.taskRefuse.status })
  }
  switch (op) {
    case 'list':
      return Response.json({
        ok: true,
        tasks: server.tasks.filter(task => body['cloneId'] === undefined || task.cloneId === body['cloneId']),
      })
    case 'create': {
      const created: CloneTaskDto = {
        id: `task-${String(server.tasks.length + 1)}` as TaskId,
        cloneId: body['cloneId'] as CloneId,
        sessionId: null,
        objective: String(body['objective']),
        status: 'pending',
        resultSummary: null,
        maxRounds: 8,
        createdAt: '2026-09-21T10:00:00.000Z',
        updatedAt: '2026-09-21T10:00:00.000Z',
      }
      server.tasks.unshift(created)
      return Response.json({ ok: true, task: created })
    }
    case 'start': {
      const index = server.tasks.findIndex(task => task.id === body['id'])
      if (index === -1) return Response.json({ ok: false, error: 'ketos/task-not-found' }, { status: 404 })
      const started = { ...server.tasks[index] as CloneTaskDto, sessionId: String(body['sessionId']), status: 'running' as const }
      server.tasks[index] = started
      return Response.json({ ok: true, task: started })
    }
    case 'cancel': {
      const index = server.tasks.findIndex(task => task.id === body['id'])
      if (index === -1) return Response.json({ ok: false, error: 'ketos/task-not-found' }, { status: 404 })
      const cancelled = { ...server.tasks[index] as CloneTaskDto, status: 'cancelled' as const }
      server.tasks[index] = cancelled
      return Response.json({ ok: true, task: cancelled })
    }
    default:
      return Response.json({ ok: false, error: 'ketos/invalid' }, { status: 400 })
  }
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
  const taskWindow = () => Object.values(store.getSnapshot().windows).find(window => window.kind === 'tasks')
  const field = (name: string): HTMLElement | null => panel.container.querySelector(`[data-board-clone="${name}"]`)
  return { runtime: prepared.runtime, board, panel, store, windowsOfKind, cloneWindow, taskWindow, field, prompt }
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

  it('reports a refused start before a session is created or bound', async () => {
    const server = stubCloneRoute([CLONE])
    let created = 0
    const { panel, field, windowsOfKind } = await mounted({
      createSession: async () => {
        created += 1
        return `session-${String(created)}` as SessionId
      },
    })
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
    expect(created).toBe(0)
    expect(server.calls.some(call => call.op === 'bindSession')).toBe(false)
    expect(windowsOfKind('agent')).toBe(0)
    expect(server.clones[0]?.status).toBe('draft')
  })

  it('rolls the status back when the binding is refused', async () => {
    const server = stubCloneRoute([CLONE])
    const { panel, field } = await mounted()
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    await waitFor(() => { expect(field('interview')).not.toBeNull() })

    server.refuse = 'bindSession'
    act(() => {
      fireEvent.click(field('interview') as Element)
    })
    // The status the gesture wrote is given back, so the clone does not stay
    // interviewing without a session.
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-notice="failed"]')).not.toBeNull() })
    expect(server.clones[0]?.status).toBe('draft')
    expect(server.calls.filter(call => call.op === 'update')).toHaveLength(2)
  })

  it('presents the interview in the clone window instead of opening a stray chat', async () => {
    stubCloneRoute([CLONE])
    const { runtime, panel, cloneWindow, field, windowsOfKind } = await mounted({
      sessionSummary: { displayTitle: 'Интервью' },
    })
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    await waitFor(() => { expect(field('interview')).not.toBeNull() })
    act(() => {
      fireEvent.click(field('interview') as Element)
    })
    await waitFor(() => { expect(cloneWindow()?.bodyKind).toBe('conversation') })
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-tab="profile"]') as Element)
    })
    await waitFor(() => { expect(field('name')).not.toBeNull() })

    // Picking the window's own interview from the chats panel must show it in
    // this window rather than minting an empty agent window on the way.
    fireEvent.click(panel.container.querySelector('[data-board-action="window-chats"]') as Element)
    await runtime.flush()
    const ungrouped = panel.view.queryByText('Ungrouped')
    if (ungrouped !== null) {
      fireEvent.click(ungrouped)
      await runtime.flush()
    }
    fireEvent.click(panel.view.getByText('Интервью'))
    await runtime.flush()
    await runtime.flush()
    expect(cloneWindow()?.bodyKind).toBe('conversation')
    expect(windowsOfKind('agent')).toBe(0)
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

  it('saves a skill authored in the editor as an object in the patch', async () => {
    const server = stubCloneRoute([CLONE])
    const { panel, field } = await mounted()
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    // The stored skill crossed the route as an object and renders as a row.
    await waitFor(() => {
      expect(panel.container.querySelector('[data-board-clone-skill-row="weekly-report"]')).not.toBeNull()
    })

    act(() => { fireEvent.click(field('skill-add') as Element) })
    const skillField = (name: string): HTMLInputElement =>
      document.querySelector(`[data-board-clone-skill="${name}"]`) as HTMLInputElement
    fireEvent.change(skillField('name'), { target: { value: 'client-brief' } })
    fireEvent.change(skillField('description'), { target: { value: 'Готовит бриф по клиенту' } })
    fireEvent.change(skillField('instructions'), { target: { value: 'Собери факты из памяти клона' } })
    act(() => {
      fireEvent.click(document.querySelector('[data-board-clone-action="skill-save"]') as Element)
    })
    await waitFor(() => {
      expect(panel.container.querySelector('[data-board-clone-skill-row="client-brief"]')).not.toBeNull()
    })

    fireEvent.click(field('save') as Element)
    await waitFor(() => { expect(server.calls.some(call => call.op === 'update')).toBe(true) })
    expect(bodyOf(server, 'update')).toMatchObject({
      op: 'update',
      id: 'clone-1',
      patch: {
        skills: [
          { name: 'weekly-report', description: 'Собирает недельный отчёт', instructions: 'Возьми цифры из трекера' },
          { name: 'client-brief', description: 'Готовит бриф по клиенту', instructions: 'Собери факты из памяти клона' },
        ],
      },
    })
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

  it('opens the clone memory tab and lists, edits, and deletes through the memory route', async () => {
    const server = stubCloneRoute([CLONE])
    server.memories.push({
      id: 'mem-1' as MemoryDto['id'],
      cloneId: 'clone-1' as CloneId,
      content: 'Любит короткие письма',
      tags: ['стиль'],
      sourceSessionId: 'session-1',
      status: 'active',
      createdAt: '2026-09-21T00:00:00.000Z',
      updatedAt: '2026-09-21T00:00:00.000Z',
    })
    const { panel, cloneWindow } = await mounted()
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    const tab = (): Element | null => panel.container.querySelector('[data-board-clone-tab="memory"]')
    await waitFor(() => { expect(tab()).not.toBeNull() })
    act(() => { fireEvent.click(tab() as Element) })
    expect(cloneWindow()?.bodyKind).toBe('clone-memory')

    // The list is the clone's own memory, read through `/api/ketos.memory`.
    await waitFor(() => { expect(panel.container.querySelector('[data-board-memory="mem-1"]')).not.toBeNull() })
    expect(panel.container.textContent).toContain('Любит короткие письма')

    // The person's edit reaches the route and the re-read shows the new text.
    act(() => { fireEvent.click(panel.container.querySelector('[data-board-memory="edit"]') as Element) })
    fireEvent.change(panel.container.querySelector('[data-board-memory="content"]') as HTMLTextAreaElement, {
      target: { value: 'Любит короткие письма и точные цифры' },
    })
    act(() => { fireEvent.click(panel.container.querySelector('[data-board-memory="save"]') as Element) })
    await waitFor(() => { expect(panel.container.textContent).toContain('Любит короткие письма и точные цифры') })
    expect(bodyOf(server, 'memory:update')).toMatchObject({ id: 'mem-1' })

    // The search gesture reaches the route with its query and status filter.
    fireEvent.change(panel.container.querySelector('[data-board-memory="search"]') as HTMLInputElement, {
      target: { value: 'точные' },
    })
    act(() => { fireEvent.click(panel.container.querySelector('[data-board-memory="search-submit"]') as Element) })
    await waitFor(() => { expect(bodyOf(server, 'memory:search')).toBeDefined() })
    expect(bodyOf(server, 'memory:search')).toMatchObject({
      op: 'search',
      cloneId: 'clone-1',
      query: 'точные',
      status: 'active',
    })
    expect(panel.container.textContent).toContain('Любит короткие письма и точные цифры')

    // Clearing the search returns to the listing before the deletion.
    act(() => { fireEvent.click(panel.container.querySelector('[data-board-memory="search-clear"]') as Element) })
    await waitFor(() => { expect(panel.container.querySelector('[data-board-memory="search-clear"]')).toBeNull() })

    // The confirmed delete removes the memory and the listing falls back to empty.
    act(() => { fireEvent.click(panel.container.querySelector('[data-board-memory="delete"]') as Element) })
    act(() => { fireEvent.click(panel.container.querySelector('[data-board-memory="delete.confirm"]') as Element) })
    await waitFor(() => { expect(panel.container.textContent).toContain('Nothing in this status.') })
    expect(server.memories).toEqual([])
  })

  it('reports a refused memory search instead of an empty memory', async () => {
    const server = stubCloneRoute([CLONE])
    server.refuseMemorySearch = true
    const { panel } = await mounted()
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-tab="memory"]')).not.toBeNull() })
    act(() => { fireEvent.click(panel.container.querySelector('[data-board-clone-tab="memory"]') as Element) })
    await waitFor(() => { expect(panel.container.querySelector('[data-board-memory-list]')).not.toBeNull() })

    fireEvent.change(panel.container.querySelector('[data-board-memory="search"]') as HTMLInputElement, {
      target: { value: 'навык' },
    })
    act(() => { fireEvent.click(panel.container.querySelector('[data-board-memory="search-submit"]') as Element) })
    await waitFor(() => {
      expect(panel.container.querySelector('[data-board-memory-notice="refused"]')).not.toBeNull()
    })
    expect(panel.container.querySelector('[data-board-memory-empty]')).toBeNull()
    expect(bodyOf(server, 'memory:search')).toMatchObject({ query: 'навык' })
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

describe('clone autopilot', () => {
  it('starts an autonomous task and shows it in a tasks window scoped to the clone', async () => {
    const server = stubCloneRoute([{ ...CLONE, status: 'ready' }])
    const { panel, taskWindow, field } = await mounted()
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    await waitFor(() => { expect(field('autopilot')).not.toBeNull() })

    fireEvent.change(field('autopilot-objective') as Element, { target: { value: 'Собрать недельный отчёт' } })
    act(() => { fireEvent.click(field('autopilot') as Element) })

    // The gesture stores the task first and then starts it on a fresh session.
    await waitFor(() => { expect(server.calls.some(call => call.op === 'task:start')).toBe(true) })
    expect(bodyOf(server, 'task:create')).toMatchObject({
      op: 'create',
      cloneId: 'clone-1',
      objective: 'Собрать недельный отчёт',
    })
    expect(bodyOf(server, 'task:start')).toMatchObject({ op: 'start', id: 'task-1', sessionId: 'session-1' })
    expect(server.tasks[0]?.status).toBe('running')
    expect(server.tasks[0]?.sessionId).toBe('session-1')

    // The task appears where it runs: a tasks window scoped to this clone.
    await waitFor(() => { expect(taskWindow()?.cloneId).toBe('clone-1') })
    await waitFor(() => { expect(panel.container.querySelector('[data-board-tasks="task-1"]')).not.toBeNull() })
    expect(panel.container.textContent).toContain('Собрать недельный отчёт')
    expect(panel.container.querySelector('[data-board-clone-notice="autopilot-started"]')?.textContent)
      .toContain('The task started.')
  })

  it('reports an agent-not-live refusal over the Autopilot form', async () => {
    const server = stubCloneRoute([{ ...CLONE, status: 'ready' }])
    server.taskRefuse = { op: 'start', status: 409, error: 'ketos/agent-not-live' }
    const { panel, taskWindow, field } = await mounted()
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    await waitFor(() => { expect(field('autopilot')).not.toBeNull() })

    fireEvent.change(field('autopilot-objective') as Element, { target: { value: 'Собрать отчёт' } })
    act(() => { fireEvent.click(field('autopilot') as Element) })

    await waitFor(() => {
      expect(panel.container.querySelector('[data-board-clone-notice="autopilot-agent-not-live"]')).not.toBeNull()
    })
    expect(panel.container.textContent).toContain('The session has no live agent, so the task cannot start.')
    // A refused start shows no tasks window and leaves the typed objective.
    expect(taskWindow()).toBeUndefined()
    expect((field('autopilot-objective') as HTMLInputElement).value).toBe('Собрать отчёт')
    expect(server.tasks[0]?.status).toBe('pending')
  })

  it('refuses Autopilot for a clone that is not ready without storing a task', async () => {
    const server = stubCloneRoute([CLONE])
    const { panel, field } = await mounted()
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    await waitFor(() => { expect(field('autopilot')).not.toBeNull() })

    fireEvent.change(field('autopilot-objective') as Element, { target: { value: 'Собрать отчёт' } })
    expect((field('autopilot') as HTMLButtonElement).disabled).toBe(false)
    act(() => { fireEvent.click(field('autopilot') as Element) })

    await waitFor(() => {
      expect(panel.container.querySelector('[data-board-clone-notice="autopilot-not-ready"]')).not.toBeNull()
    })
    // The refusal happens before a task is stored: no mutating task op ran.
    expect(server.calls.some(call => ['task:create', 'task:start', 'task:cancel'].includes(call.op))).toBe(false)
  })

  it('disables the Autopilot action until an objective is typed', async () => {
    stubCloneRoute([{ ...CLONE, status: 'ready' }])
    const { panel, field } = await mounted()
    await waitFor(() => { expect(panel.container.querySelector('[data-board-clone-row="clone-1"]')).not.toBeNull() })
    act(() => {
      fireEvent.click(panel.container.querySelector('[data-board-clone-row="clone-1"]') as Element)
    })
    await waitFor(() => { expect(field('autopilot')).not.toBeNull() })
    expect((field('autopilot') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(field('autopilot-objective') as Element, { target: { value: '   ' } })
    expect((field('autopilot') as HTMLButtonElement).disabled).toBe(true)
  })
})
