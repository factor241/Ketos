// @vitest-environment jsdom
/**
 * Clone window body: the editor form reads the window's clone, saves the edited
 * card under the revision it read, and reports conflicts; the session action
 * creates and binds a session, and the bound sessions open their chat window.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CloneDto, CloneId } from '@ketos/clone-core/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { CloneBody, type CloneBodyProps } from '../src/client/window/CloneBody.tsx'
import type { BoardWindowState, CloneModelOption, WindowId } from '../src/client/contract/slots.ts'
import { t } from './fixtures.client.ts'

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
  preferredModel: 'deepseek/deepseek-chat',
  skills: [],
  status: 'draft',
  revision: 3,
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
}

const MODELS: readonly CloneModelOption[] = [
  { provider: 'deepseek', providerName: 'DeepSeek', model: 'deepseek-chat', name: 'DeepSeek Chat' },
  { provider: 'deepseek', providerName: 'DeepSeek', model: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
]

/** Props stub: the window owner share, the roster hook, and the clone actions. */
function cloneProps(overrides: Partial<Record<string, unknown>> = {}): CloneBodyProps {
  const clones = (overrides['clones'] as readonly CloneDto[] | undefined) ?? [CLONE]
  return {
    window: { ...CARD, ...(overrides['window'] as Partial<BoardWindowState> | undefined) },
    t,
    useCloneList: (selector: (roster: { clones: readonly CloneDto[]; loaded: boolean }) => unknown) =>
      selector({ clones, loaded: overrides['cloneRosterLoaded'] !== false }),
    saveClone: vi.fn(async () => 'saved'),
    deleteClone: vi.fn(async () => 'deleted'),
    loadCloneModels: vi.fn(async () => MODELS),
    loadCloneSessions: vi.fn(async () => []),
    startCloneSession: vi.fn(async () => 'started'),
    openChat: vi.fn(),
    ...overrides,
  } as unknown as CloneBodyProps
}

/** The editor's field control by its data attribute. */
function field(name: string): HTMLElement {
  return document.querySelector(`[data-board-clone="${name}"]`) as HTMLElement
}

/** Current text of one field control. */
function value(name: string): string {
  return (field(name) as HTMLInputElement).value
}

/** Whether one button control is disabled. */
function disabled(name: string): boolean {
  return (field(name) as HTMLButtonElement).disabled
}

describe('clone editor form', () => {
  it('seeds the form from the stored record and saves the edited card under its revision', async () => {
    const saveClone = vi.fn(async () => 'saved' as const)
    render(<CloneBody {...cloneProps({ saveClone })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    expect(value('role')).toBe('Аналитик')
    expect(value('description')).toBe('Разбор требований')
    expect(value('persona')).toBe('Спокойная')
    expect(value('methodology')).toBe('Сначала факты')
    expect(document.querySelector('[data-board-clone-revision="3"]')).not.toBeNull()

    fireEvent.change(field('name'), { target: { value: 'Анна П.' } })
    fireEvent.change(field('persona'), { target: { value: 'Спокойная, точная' } })
    fireEvent.click(field('save'))
    await waitFor(() => { expect(saveClone).toHaveBeenCalledTimes(1) })
    expect(saveClone).toHaveBeenCalledWith('clone-1', {
      name: 'Анна П.',
      role: 'Аналитик',
      description: 'Разбор требований',
      persona: 'Спокойная, точная',
      methodology: 'Сначала факты',
      preferredModel: 'deepseek/deepseek-chat',
      status: 'draft',
    }, 3)
    expect(document.querySelector('[data-board-clone-notice]')).toBeNull()
  })

  it('refuses to save a card without a name or a role', async () => {
    render(<CloneBody {...cloneProps()} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    fireEvent.change(field('name'), { target: { value: '   ' } })
    expect(disabled('save')).toBe(true)
    fireEvent.change(field('name'), { target: { value: 'Анна' } })
    fireEvent.change(field('role'), { target: { value: '' } })
    expect(disabled('save')).toBe(true)
  })

  it('reports a revision conflict and a vanished clone instead of overwriting', async () => {
    const saveClone = vi.fn(async () => 'conflict' as const)
    const { unmount } = render(<CloneBody {...cloneProps({ saveClone })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    fireEvent.click(field('save'))
    await waitFor(() => { expect(document.querySelector('[data-board-clone-notice="conflict"]')).not.toBeNull() })
    unmount()

    const missing = vi.fn(async () => 'missing' as const)
    render(<CloneBody {...cloneProps({ saveClone: missing })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    fireEvent.click(field('save'))
    await waitFor(() => { expect(document.querySelector('[data-board-clone-notice="missing"]')).not.toBeNull() })
  })

  it('deletes only after the confirmation step and reports an unreachable host', async () => {
    const deleteClone = vi.fn(async () => 'deleted' as const)
    render(<CloneBody {...cloneProps({ deleteClone })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    fireEvent.click(field('delete'))
    expect(deleteClone).not.toHaveBeenCalled()
    fireEvent.click(field('delete.confirm'))
    await waitFor(() => { expect(deleteClone).toHaveBeenCalledWith('clone-1', 3) })
    cleanup()

    const failed = vi.fn(async () => 'failed' as const)
    render(<CloneBody {...cloneProps({ deleteClone: failed })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    fireEvent.click(field('delete'))
    fireEvent.click(field('delete.confirm'))
    await waitFor(() => { expect(document.querySelector('[data-board-clone-notice="failed"]')).not.toBeNull() })
  })

  it('picks a preferred model route and clears it back to the deployment default', async () => {
    const saveClone = vi.fn(async () => 'saved' as const)
    render(<CloneBody {...cloneProps({ saveClone, clones: [{ ...CLONE, preferredModel: null }] })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    expect(field('model').textContent).toBe('Deployment default')

    fireEvent.click(field('model'))
    fireEvent.click(await screen.findByText(/DeepSeek Reasoner/))
    expect(field('model').textContent).toBe('DeepSeek Reasoner')

    fireEvent.click(field('save'))
    await waitFor(() => { expect(saveClone).toHaveBeenCalledTimes(1) })
    expect(saveClone).toHaveBeenCalledWith('clone-1', expect.objectContaining({
      preferredModel: 'deepseek/deepseek-reasoner',
    }), 3)
  })

  it('moves the lifecycle status through the pills', async () => {
    const saveClone = vi.fn(async () => 'saved' as const)
    render(<CloneBody {...cloneProps({ saveClone })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    fireEvent.click(screen.getByText('Active'))
    fireEvent.click(field('save'))
    await waitFor(() => { expect(saveClone).toHaveBeenCalledTimes(1) })
    expect(saveClone).toHaveBeenCalledWith('clone-1', expect.objectContaining({ status: 'active' }), 3)
  })

  it('names a clone window whose record left the roster', async () => {
    render(<CloneBody {...cloneProps({ clones: [] })} />)
    await waitFor(() => { expect(document.querySelector('[data-board-clone-missing]')).not.toBeNull() })
    expect(document.querySelector('[data-board-clone-editor]')).toBeNull()
  })

  it('waits for the first roster answer instead of reporting a missing clone', () => {
    render(<CloneBody {...cloneProps({ clones: [], cloneRosterLoaded: false })} />)
    expect(document.querySelector('[data-board-clone-missing]')).toBeNull()
    expect(document.querySelector('[data-board-clone-loading]')).not.toBeNull()
  })
})

describe('clone sessions', () => {
  it('creates a session for the clone and reloads the bindings', async () => {
    const startCloneSession = vi.fn(async () => 'started' as const)
    const loadCloneSessions = vi.fn(async () => [{ sessionId: 'session-1' as SessionId, cloneId: CLONE.id, role: 'main', createdAt: '2026-09-21T00:00:00.000Z' }])
    render(<CloneBody {...cloneProps({ startCloneSession, loadCloneSessions })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    fireEvent.click(field('session'))
    await waitFor(() => { expect(startCloneSession).toHaveBeenCalledWith(CLONE) })
    await waitFor(() => { expect(loadCloneSessions.mock.calls.length).toBeGreaterThan(1) })
    expect(document.querySelector('[data-board-clone-session="session-1"]')).not.toBeNull()
  })

  it('reports a failed session creation and opens a bound session on click', async () => {
    const startCloneSession = vi.fn(async () => 'failed' as const)
    const openChat = vi.fn()
    const loadCloneSessions = vi.fn(async () => [{ sessionId: 'session-9' as SessionId, cloneId: CLONE.id, role: 'main', createdAt: '2026-09-21T00:00:00.000Z' }])
    render(<CloneBody {...cloneProps({ startCloneSession, openChat, loadCloneSessions })} />)
    await waitFor(() => { expect(document.querySelector('[data-board-clone-session="session-9"]')).not.toBeNull() })
    fireEvent.click(field('session'))
    await waitFor(() => { expect(document.querySelector('[data-board-clone-notice="failed"]')).not.toBeNull() })
    fireEvent.click(document.querySelector('[data-board-clone-session="session-9"]') as HTMLElement)
    expect(openChat).toHaveBeenCalledWith('session-9')
  })
})
