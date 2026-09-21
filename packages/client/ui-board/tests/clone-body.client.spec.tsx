// @vitest-environment jsdom
/**
 * Clone window body: the editor form reads the window's clone, saves the edited
 * card under the revision it read, reports conflicts, and marks the fields a
 * newer stored revision changed; the interview action hands the window its
 * session, and the bound sessions open their chat window.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { CloneDto, CloneId } from '@ketos/clone-core/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createBoardStore } from '../src/client/store.ts'
import { CloneBody, type CloneBodyProps } from '../src/client/window/CloneBody.tsx'
import type { BoardState } from '../src/client/store.ts'
import type { BoardWindowState, CloneModelOption, WindowId } from '../src/client/contract/slots.ts'
import { chatSnapshot, sessionState, t } from './fixtures.client.ts'

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

/** Props stub: the window owner share, the board store, the roster hook, and the clone actions. */
function cloneProps(overrides: Partial<Record<string, unknown>> = {}): CloneBodyProps {
  const clones = (overrides['clones'] as readonly CloneDto[] | undefined) ?? [CLONE]
  const instance = (overrides['instance'] as ReturnType<ReturnType<typeof createBoardStore>['create']> | undefined)
    ?? createBoardStore().create()
  const card = { ...CARD, ...(overrides['window'] as Partial<BoardWindowState> | undefined) }
  // The store owns the window's draft entry, so the window has to exist there.
  if (instance.getSnapshot().windows[card.id as string] === undefined) instance.actions.addWindow(card)
  return {
    window: card,
    actions: overrides['actions'] ?? instance.actions,
    useStore: <S,>(selector: (state: BoardState) => S): S => useSyncExternalStore(
      onChange => instance.subscribe(onChange),
      () => selector(instance.getSnapshot()),
    ),
    t,
    useCloneList: (selector: (roster: { clones: readonly CloneDto[]; loaded: boolean }) => unknown) =>
      selector({ clones, loaded: overrides['cloneRosterLoaded'] !== false }),
    useWindowSession: () => undefined,
    saveClone: vi.fn(async () => 'saved'),
    deleteClone: vi.fn(async () => 'deleted'),
    loadCloneModels: vi.fn(async () => MODELS),
    loadCloneSessions: vi.fn(async () => []),
    startCloneInterview: vi.fn(async () => 'started'),
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

  it('keeps unsaved edits when the stored revision moves and saves them on the next attempt', async () => {
    const saveClone = vi.fn(async () => 'conflict' as const)
    const instance = createBoardStore().create()
    const { rerender } = render(<CloneBody {...cloneProps({ saveClone, instance })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    fireEvent.change(field('name'), { target: { value: 'Моя правка' } })
    fireEvent.click(field('save'))
    await waitFor(() => { expect(document.querySelector('[data-board-clone-notice="conflict"]')).not.toBeNull() })

    // The other writer's record arrives; the draft must survive it and the
    // next save must apply it over the newer revision.
    rerender(<CloneBody {...cloneProps({ saveClone, instance, clones: [{ ...CLONE, name: 'Чужая правка', revision: 4 }] })} />)
    await waitFor(() => { expect(document.querySelector('[data-board-clone-revision="4"]')).not.toBeNull() })
    expect(value('name')).toBe('Моя правка')
    fireEvent.click(field('save'))
    await waitFor(() => { expect(saveClone).toHaveBeenCalledTimes(2) })
    expect(saveClone).toHaveBeenLastCalledWith('clone-1', expect.objectContaining({ name: 'Моя правка' }), 4)
  })

  it('asks for a fresh confirmation when the record moved under a delete', async () => {
    const deleteClone = vi.fn(async () => 'conflict' as const)
    render(<CloneBody {...cloneProps({ deleteClone })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    fireEvent.click(field('delete'))
    fireEvent.click(field('delete.confirm'))
    await waitFor(() => { expect(document.querySelector('[data-board-clone-notice="delete-conflict"]')).not.toBeNull() })
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
    fireEvent.click(screen.getByText('Interviewing'))
    fireEvent.click(field('save'))
    await waitFor(() => { expect(saveClone).toHaveBeenCalledTimes(1) })
    expect(saveClone).toHaveBeenCalledWith('clone-1', expect.objectContaining({ status: 'interviewing' }), 3)

    fireEvent.click(screen.getByText('Ready'))
    fireEvent.click(field('save'))
    await waitFor(() => { expect(saveClone).toHaveBeenCalledTimes(2) })
    // The accepted save minted revision 4, and the form carries it without
    // waiting for the roster read.
    expect(saveClone).toHaveBeenLastCalledWith('clone-1', expect.objectContaining({ status: 'ready' }), 4)
  })

  it('adopts a clean newer revision and marks exactly the fields that moved', async () => {
    const instance = createBoardStore().create()
    const { rerender } = render(<CloneBody {...cloneProps({ instance })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })

    rerender(<CloneBody {...cloneProps({ instance, clones: [{ ...CLONE, persona: 'Собранная', revision: 4 }] })} />)
    await waitFor(() => { expect(value('persona')).toBe('Собранная') })
    expect(document.querySelector('[data-board-clone-revision="4"]')).not.toBeNull()
    expect(document.querySelector('[data-board-clone-agent-field="persona"]')).not.toBeNull()
    expect(document.querySelectorAll('[data-board-clone-agent-field]')).toHaveLength(1)
    // A clean form needs no adoption step: the values are already in place.
    expect(document.querySelector('[data-board-clone-notice="agent"]')).toBeNull()
  })

  it('keeps a dirty draft, holds the stored revision as pending, and applies it only on request', async () => {
    const instance = createBoardStore().create()
    const { rerender } = render(<CloneBody {...cloneProps({ instance })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    fireEvent.change(field('name'), { target: { value: 'Моя правка' } })

    rerender(<CloneBody {...cloneProps({ instance, clones: [{ ...CLONE, persona: 'Собранная', revision: 4 }] })} />)
    await waitFor(() => { expect(document.querySelector('[data-board-clone-notice="agent"]')).not.toBeNull() })
    // The typed text and the untouched stored value both survive; only the
    // field the agent moved is marked.
    expect(value('name')).toBe('Моя правка')
    expect(value('persona')).toBe('Спокойная')
    expect(document.querySelector('[data-board-clone-agent-field="persona"]')).not.toBeNull()
    expect(document.querySelector('[data-board-clone-agent-field="name"]')).toBeNull()

    fireEvent.click(field('apply-agent'))
    await waitFor(() => { expect(value('persona')).toBe('Собранная') })
    // Applying replaces the whole draft, and the marks stay for the review.
    expect(value('name')).toBe('Анна')
    expect(document.querySelector('[data-board-clone-notice="agent"]')).toBeNull()
    expect(document.querySelector('[data-board-clone-agent-field="persona"]')).not.toBeNull()

    // Editing a marked field takes it over: the mark retires with the edit.
    fireEvent.change(field('persona'), { target: { value: 'Моя персона' } })
    expect(document.querySelector('[data-board-clone-agent-field="persona"]')).toBeNull()
  })

  it('keeps text typed while a save runs and raises no phantom agent revision', async () => {
    const deferred = Promise.withResolvers<'saved'>()
    const saveClone = vi.fn(async () => await deferred.promise)
    const instance = createBoardStore().create()
    const { rerender } = render(<CloneBody {...cloneProps({ saveClone, instance })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    fireEvent.change(field('name'), { target: { value: 'Анна П.' } })
    fireEvent.click(field('save'))
    // The user keeps typing while the route works.
    fireEvent.change(field('description'), { target: { value: 'Пока идёт сохранение' } })
    deferred.resolve('saved')
    await waitFor(() => { expect(saveClone).toHaveBeenCalledTimes(1) })

    // The stored record the accepted save produced is the user's own: it must
    // become the base, not a pending agent revision that discards newer text.
    rerender(<CloneBody {...cloneProps({
      saveClone,
      instance,
      clones: [{ ...CLONE, name: 'Анна П.', revision: 4 }],
    })} />)
    await waitFor(() => { expect(document.querySelector('[data-board-clone-revision="4"]')).not.toBeNull() })
    expect(value('description')).toBe('Пока идёт сохранение')
    expect(document.querySelector('[data-board-clone-notice="agent"]')).toBeNull()
    expect(document.querySelectorAll('[data-board-clone-agent-field]')).toHaveLength(0)
  })

  it('does not mark the user\'s own save as an agent revision', async () => {
    const saveClone = vi.fn(async () => 'saved' as const)
    const instance = createBoardStore().create()
    const { rerender } = render(<CloneBody {...cloneProps({ saveClone, instance })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    fireEvent.change(field('name'), { target: { value: 'Анна П.' } })
    fireEvent.click(field('save'))
    await waitFor(() => { expect(saveClone).toHaveBeenCalledTimes(1) })

    rerender(<CloneBody {...cloneProps({ saveClone, instance, clones: [{ ...CLONE, name: 'Анна П.', revision: 4 }] })} />)
    await waitFor(() => { expect(document.querySelector('[data-board-clone-revision="4"]')).not.toBeNull() })
    expect(document.querySelectorAll('[data-board-clone-agent-field]')).toHaveLength(0)
    expect(document.querySelector('[data-board-clone-notice="agent"]')).toBeNull()
  })

  it('names a clone window whose record left the roster', async () => {
    render(<CloneBody {...cloneProps({ clones: [] })} />)
    await waitFor(() => { expect(document.querySelector('[data-board-clone-missing]')).not.toBeNull() })
    expect(document.querySelector('[data-board-clone-editor]')).toBeNull()
  })

  it('waits for the first roster answer and retries instead of reporting a missing clone', () => {
    const refreshClones = vi.fn()
    render(<CloneBody {...cloneProps({ clones: [], cloneRosterLoaded: false, refreshClones })} />)
    expect(document.querySelector('[data-board-clone-missing]')).toBeNull()
    expect(document.querySelector('[data-board-clone-loading]')).not.toBeNull()
    fireEvent.click(field('retry'))
    expect(refreshClones).toHaveBeenCalledTimes(1)
  })

  it('caps every field at the bounds the route enforces', async () => {
    render(<CloneBody {...cloneProps()} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    expect(field('name').getAttribute('maxlength')).toBe('120')
    expect(field('role').getAttribute('maxlength')).toBe('120')
    expect(field('description').getAttribute('maxlength')).toBe('500')
    expect(field('persona').getAttribute('maxlength')).toBe('20000')
    expect(field('methodology').getAttribute('maxlength')).toBe('20000')
  })
})

describe('clone interview', () => {
  it('starts the interview in this window and reloads the bindings', async () => {
    const startCloneInterview = vi.fn(async () => 'started' as const)
    const loadCloneSessions = vi.fn(async () => [{ sessionId: 'session-1' as SessionId, cloneId: CLONE.id, role: 'interview', createdAt: '2026-09-21T00:00:00.000Z' }])
    render(<CloneBody {...cloneProps({ startCloneInterview, loadCloneSessions })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    expect(field('interview').textContent).toBe('Start interview')
    fireEvent.click(field('interview'))
    await waitFor(() => { expect(startCloneInterview).toHaveBeenCalledWith(CLONE, CARD.id) })
    await waitFor(() => { expect(loadCloneSessions.mock.calls.length).toBeGreaterThan(1) })
    expect(document.querySelector('[data-board-clone-session="session-1"]')).not.toBeNull()
  })

  it('labels the interview action as a restart once a profile exists and reports a refusal', async () => {
    const { unmount } = render(<CloneBody {...cloneProps({ clones: [{ ...CLONE, status: 'ready' }] })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    expect(field('interview').textContent).toBe('Restart interview')
    unmount()

    const startCloneInterview = vi.fn(async () => 'failed' as const)
    render(<CloneBody {...cloneProps({ startCloneInterview })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    fireEvent.click(field('interview'))
    await waitFor(() => { expect(document.querySelector('[data-board-clone-notice="failed"]')).not.toBeNull() })
  })
})

describe('clone bound sessions', () => {
  it('opens a bound session in a window of its own', async () => {
    const openChat = vi.fn()
    const loadCloneSessions = vi.fn(async () => [{ sessionId: 'session-9' as SessionId, cloneId: CLONE.id, role: 'main', createdAt: '2026-09-21T00:00:00.000Z' }])
    render(<CloneBody {...cloneProps({ openChat, loadCloneSessions })} />)
    await waitFor(() => { expect(document.querySelector('[data-board-clone-session="session-9"]')).not.toBeNull() })
    fireEvent.click(document.querySelector('[data-board-clone-session="session-9"]') as HTMLElement)
    expect(openChat).toHaveBeenCalledWith('session-9')
  })

  it('switches to the interview tab for the session this window already shows', async () => {
    const openChat = vi.fn()
    const instance = createBoardStore().create()
    const setWindowBodyKind = vi.spyOn(instance.actions, 'setWindowBodyKind')
    const loadCloneSessions = vi.fn(async () => [{ sessionId: 'session-9' as SessionId, cloneId: CLONE.id, role: 'interview', createdAt: '2026-09-21T00:00:00.000Z' }])
    render(<CloneBody {...cloneProps({
      openChat,
      loadCloneSessions,
      instance,
      useWindowSession: (_key: string, selector?: (state: ReturnType<typeof sessionState>) => unknown) => {
        const state = sessionState(chatSnapshot([]), { sessionId: 'session-9' as SessionId })
        return selector === undefined ? state : selector(state)
      },
    })} />)
    await waitFor(() => { expect(document.querySelector('[data-board-clone-session="session-9"]')).not.toBeNull() })
    fireEvent.click(document.querySelector('[data-board-clone-session="session-9"]') as HTMLElement)
    expect(setWindowBodyKind).toHaveBeenCalledWith(CARD.id, 'conversation')
    expect(openChat).not.toHaveBeenCalled()
  })

  it('keeps the draft and the agent marks across a body switch', async () => {
    // The window unmounts the editor when the user answers in the interview
    // body; the edit state lives in the board store, so the text the user
    // typed and the fields the agent rewrote are still there on return.
    const instance = createBoardStore().create()
    const first = render(<CloneBody {...cloneProps({ instance })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    fireEvent.change(field('name'), { target: { value: 'Анна П.' } })
    first.unmount()

    // While the editor is away, the agent saves a profile: revision 4.
    const saved = { ...CLONE, persona: 'Спокойная и точная', revision: 4 }
    render(<CloneBody {...cloneProps({ instance, clones: [saved] })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна П.') })
    await waitFor(() => { expect(value('persona')).toBe('Спокойная') })
    // The user's text survived and the agent's revision waits for the apply.
    expect(document.querySelector('[data-board-clone-notice="agent"]')).not.toBeNull()
    expect(document.querySelector('[data-board-clone-agent-field="persona"]')).not.toBeNull()
  })
})
