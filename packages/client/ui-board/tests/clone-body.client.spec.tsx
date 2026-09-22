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
import type { CloneDto, CloneId, CloneSkill } from '@ketos/clone-core/types'
import { METHODOLOGY_TEMPLATE } from '@ketos/clone-core/methodology'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createBoardStore } from '../src/client/store.ts'
import { CLONE_LIMITS } from '../src/client/clone-draft.ts'
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

const REPORT_SKILL: CloneSkill = {
  name: 'weekly-report',
  description: 'Собирает недельный отчёт',
  instructions: 'Возьми цифры из трекера',
}

const DRAFT_SKILL: CloneSkill = {
  name: 'draft-skill',
  description: '',
  instructions: 'Пока без описания',
}

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

/** The skill modal's field control by its data attribute. */
function skillField(name: string): HTMLInputElement {
  return document.querySelector(`[data-board-clone-skill="${name}"]`) as HTMLInputElement
}

/** The skills row-menu trigger of one draft skill. */
function skillMenuButton(name: string): HTMLElement {
  return document.querySelector(
    `[data-board-clone-skill-row="${name}"] [data-board-clone-action="skill-menu"]`,
  ) as HTMLElement
}

/** Click the skill modal's save action. */
function saveSkill(): void {
  fireEvent.click(document.querySelector('[data-board-clone-action="skill-save"]') as HTMLElement)
}

/** One methodology structure chip by its heading. */
function methodologyChip(heading: string): HTMLElement {
  return document.querySelector(`[data-board-clone-methodology-section="${heading}"]`) as HTMLElement
}

/** Click one skill row-menu action by its localized label. */
async function clickSkillMenuAction(label: string): Promise<void> {
  fireEvent.click(await screen.findByRole('menuitem', { name: label }))
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
      skills: [],
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

describe('clone methodology structure', () => {
  it('marks the live methodology sections and lists the gaps', async () => {
    const methodology = '## Принципы\n## Порядок работы\nСначала факты'
    render(<CloneBody {...cloneProps({ clones: [{ ...CLONE, methodology }] })} />)
    await waitFor(() => { expect(value('methodology')).toBe(methodology) })

    expect(methodologyChip('Принципы').getAttribute('data-state')).toBe('empty')
    expect(methodologyChip('Принципы').textContent).toContain('empty')
    expect(methodologyChip('Порядок работы').getAttribute('data-state')).toBe('filled')
    expect(methodologyChip('Критерии качества').getAttribute('data-state')).toBe('missing')
    expect(methodologyChip('Критерии качества').textContent).toContain('missing')
    expect(methodologyChip('Чего не делать').getAttribute('data-state')).toBe('missing')
    expect(document.querySelector('[data-board-clone="methodology-gaps"]')?.textContent)
      .toBe('Not filled: Принципы, Критерии качества, Чего не делать')
    expect(field('methodology-template')).toBeNull()

    fireEvent.change(field('methodology'), { target: { value: '## Принципы\nСначала факты\n## Порядок работы\nСначала факты' } })
    expect(methodologyChip('Принципы').getAttribute('data-state')).toBe('filled')
    expect(document.querySelector('[data-board-clone="methodology-gaps"]')?.textContent)
      .toBe('Not filled: Критерии качества, Чего не делать')
  })

  it('offers the template only on a blank methodology and inserts it through the draft', async () => {
    render(<CloneBody {...cloneProps({ clones: [{ ...CLONE, methodology: '## Принципы\nЧто-то' }] })} />)
    await waitFor(() => { expect(value('methodology')).toBe('## Принципы\nЧто-то') })
    expect(field('methodology-template')).toBeNull()

    fireEvent.change(field('methodology'), { target: { value: '' } })
    fireEvent.click(field('methodology-template'))
    expect(value('methodology')).toBe(METHODOLOGY_TEMPLATE)
    expect(methodologyChip('Принципы').getAttribute('data-state')).toBe('empty')
    expect(methodologyChip('Критерии качества').getAttribute('data-state')).toBe('empty')
  })
})

describe('clone skills', () => {
  it('lists the stored skills and flags one without a description', async () => {
    render(<CloneBody {...cloneProps({ clones: [{ ...CLONE, skills: [REPORT_SKILL, DRAFT_SKILL] }] })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    expect(document.querySelector('[data-board-clone="skills"]')?.textContent).not.toContain('No skills yet.')

    const report = document.querySelector('[data-board-clone-skill-row="weekly-report"]') as HTMLElement
    expect(report.textContent).toContain('weekly-report')
    expect(report.textContent).toContain('Собирает недельный отчёт')
    expect(report.querySelector('[data-board-clone="skill-incomplete"]')).toBeNull()

    const draft = document.querySelector('[data-board-clone-skill-row="draft-skill"]') as HTMLElement
    expect(draft.querySelector('[data-board-clone="skill-incomplete"]')?.textContent)
      .toBe('A skill without a description stays out of the model catalog')
  })

  it('adds a skill through the modal and sends the skill object in the patch', async () => {
    const saveClone = vi.fn(async () => 'saved' as const)
    render(<CloneBody {...cloneProps({ saveClone })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })
    expect(document.querySelector('[data-board-clone="skills"]')?.textContent).toContain('No skills yet.')

    fireEvent.click(field('skill-add'))
    expect(skillField('name').getAttribute('maxlength')).toBe('64')
    expect(skillField('description').getAttribute('maxlength')).toBe('500')
    expect(skillField('instructions').getAttribute('maxlength')).toBe('20000')
    fireEvent.change(skillField('name'), { target: { value: 'weekly-report' } })
    fireEvent.change(skillField('description'), { target: { value: 'Собирает недельный отчёт' } })
    fireEvent.change(skillField('instructions'), { target: { value: 'Возьми цифры из трекера' } })
    saveSkill()
    await waitFor(() => {
      expect(document.querySelector('[data-board-clone-skill-row="weekly-report"]')).not.toBeNull()
    })
    expect(document.querySelector('[data-board-clone-skill="name"]')).toBeNull()

    fireEvent.click(field('save'))
    await waitFor(() => { expect(saveClone).toHaveBeenCalledTimes(1) })
    expect(saveClone).toHaveBeenCalledWith('clone-1', expect.objectContaining({
      skills: [{ name: 'weekly-report', description: 'Собирает недельный отчёт', instructions: 'Возьми цифры из трекера' }],
    }), 3)
  })

  it('edits a skill through the row menu and sends the new description', async () => {
    const saveClone = vi.fn(async () => 'saved' as const)
    render(<CloneBody {...cloneProps({ saveClone, clones: [{ ...CLONE, skills: [REPORT_SKILL] }] })} />)
    await waitFor(() => { expect(document.querySelector('[data-board-clone-skill-row="weekly-report"]')).not.toBeNull() })

    fireEvent.click(skillMenuButton('weekly-report'))
    await clickSkillMenuAction('Edit')
    expect(skillField('name').value).toBe('weekly-report')
    expect(skillField('description').value).toBe('Собирает недельный отчёт')
    fireEvent.change(skillField('description'), { target: { value: 'Собирает отчёт за неделю' } })
    saveSkill()
    await waitFor(() => {
      expect(document.querySelector('[data-board-clone-skill-row="weekly-report"]')?.textContent)
        .toContain('Собирает отчёт за неделю')
    })

    fireEvent.click(field('save'))
    await waitFor(() => { expect(saveClone).toHaveBeenCalledTimes(1) })
    expect(saveClone).toHaveBeenCalledWith('clone-1', expect.objectContaining({
      skills: [{
        name: 'weekly-report',
        description: 'Собирает отчёт за неделю',
        instructions: 'Возьми цифры из трекера',
      }],
    }), 3)
  })

  it('refuses a duplicate skill name without adding a row', async () => {
    render(<CloneBody {...cloneProps({ clones: [{ ...CLONE, skills: [REPORT_SKILL] }] })} />)
    await waitFor(() => { expect(document.querySelector('[data-board-clone-skill-row="weekly-report"]')).not.toBeNull() })

    fireEvent.click(field('skill-add'))
    fireEvent.change(skillField('name'), { target: { value: 'weekly-report' } })
    saveSkill()
    await waitFor(() => {
      expect(document.querySelector('[data-board-clone="skill-error"]')?.textContent)
        .toBe('A skill with this name already exists')
    })
    expect(document.querySelectorAll('[data-board-clone-skill-row]')).toHaveLength(1)
    expect(skillField('name')).not.toBeNull()
    // Editing the name retires the refusal instead of leaving stale text.
    fireEvent.change(skillField('name'), { target: { value: 'weekly-digest' } })
    expect(document.querySelector('[data-board-clone="skill-error"]')).toBeNull()
  })

  it('refuses a blank or non-kebab skill name', async () => {
    render(<CloneBody {...cloneProps()} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })

    fireEvent.click(field('skill-add'))
    saveSkill()
    await waitFor(() => {
      expect(document.querySelector('[data-board-clone="skill-error"]')?.textContent)
        .toBe('Name: lowercase letters, digits, and hyphens')
    })
    fireEvent.change(skillField('name'), { target: { value: 'Weekly Report' } })
    saveSkill()
    await waitFor(() => {
      expect(document.querySelector('[data-board-clone="skill-error"]')?.textContent)
        .toBe('Name: lowercase letters, digits, and hyphens')
    })
    expect(document.querySelector('[data-board-clone-skill-row]')).toBeNull()
    expect(skillField('name')).not.toBeNull()
  })

  it('refuses a name past the stored length bound', async () => {
    render(<CloneBody {...cloneProps()} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })

    fireEvent.click(field('skill-add'))
    fireEvent.change(skillField('name'), { target: { value: 'a'.repeat(CLONE_LIMITS.skillName + 1) } })
    saveSkill()
    await waitFor(() => {
      expect(document.querySelector('[data-board-clone="skill-error"]')?.textContent)
        .toBe('Name: lowercase letters, digits, and hyphens')
    })
    expect(document.querySelector('[data-board-clone-skill-row]')).toBeNull()
  })

  it('refuses an addition past the skill-count limit', async () => {
    const skills = Array.from({ length: CLONE_LIMITS.skillCount }, (_unused, index) => ({
      name: `skill-${String(index)}`,
      description: 'Описание',
      instructions: 'Инструкции',
    }))
    render(<CloneBody {...cloneProps({ clones: [{ ...CLONE, skills }] })} />)
    await waitFor(() => {
      expect(document.querySelectorAll('[data-board-clone-skill-row]')).toHaveLength(CLONE_LIMITS.skillCount)
    })

    fireEvent.click(field('skill-add'))
    fireEvent.change(skillField('name'), { target: { value: 'extra-skill' } })
    saveSkill()
    await waitFor(() => {
      expect(document.querySelector('[data-board-clone="skill-error"]')?.textContent).toBe('At most 100 skills')
    })
    expect(document.querySelectorAll('[data-board-clone-skill-row]')).toHaveLength(CLONE_LIMITS.skillCount)
    expect(document.querySelector('[data-board-clone-skill-row="extra-skill"]')).toBeNull()
    expect(skillField('name')).not.toBeNull()
  })

  it('warns about a stored skill the host will refuse or leave unregistered', async () => {
    const legacy: CloneSkill = { name: 'Проверка контрагента', description: 'Разбор', instructions: '' }
    const duplicate: CloneSkill = { name: 'sql', description: 'Первый', instructions: '' }
    const duplicateAgain: CloneSkill = { name: 'sql', description: 'Второй', instructions: '' }
    const overlong: CloneSkill = { name: 'a'.repeat(CLONE_LIMITS.skillName + 1), description: 'Длинное', instructions: '' }
    render(<CloneBody {...cloneProps({
      clones: [{ ...CLONE, skills: [legacy, duplicate, duplicateAgain, overlong] }],
    })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })

    const bad = document.querySelector('[data-board-clone-skill-row="Проверка контрагента"]') as HTMLElement
    expect(bad.querySelector('[data-board-clone="skill-invalid"]')?.textContent)
      .toBe('Name: lowercase letters, digits, and hyphens')
    const rows = document.querySelectorAll('[data-board-clone-skill-row="sql"]')
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.querySelector('[data-board-clone="skill-invalid"]')?.textContent)
        .toBe('A skill with this name already exists')
    }
    const long = document.querySelector(`[data-board-clone-skill-row="${'a'.repeat(CLONE_LIMITS.skillName + 1)}"]`) as HTMLElement
    expect(long.querySelector('[data-board-clone="skill-invalid"]')?.textContent)
      .toBe('Name: lowercase letters, digits, and hyphens')
  })

  it('trims a stored padded name in the draft so its own save marks nothing', async () => {
    const padded: CloneSkill = { name: ' sql ', description: 'Разбор', instructions: '' }
    const instance = createBoardStore().create()
    const saveClone = vi.fn(async () => 'saved' as const)
    const { rerender } = render(<CloneBody {...cloneProps({ instance, saveClone, clones: [{ ...CLONE, skills: [padded] }] })} />)
    await waitFor(() => {
      expect(document.querySelector('[data-board-clone-skill-row="sql"]')).not.toBeNull()
    })

    fireEvent.click(field('save'))
    await waitFor(() => { expect(saveClone).toHaveBeenCalledTimes(1) })
    expect(saveClone).toHaveBeenCalledWith('clone-1', expect.objectContaining({
      skills: [{ name: 'sql', description: 'Разбор', instructions: '' }],
    }), 3)

    // The roster read returns the trimmed name the route stored; the user's own
    // save must not look like an agent revision.
    rerender(<CloneBody {...cloneProps({
      instance,
      saveClone,
      clones: [{ ...CLONE, skills: [{ ...padded, name: 'sql' }], revision: 4 }],
    })} />)
    expect(document.querySelectorAll('[data-board-clone-agent-field]')).toHaveLength(0)
    expect(document.querySelector('[data-board-clone-notice="agent"]')).toBeNull()
  })

  it('renames one of two duplicate stored skills without touching the other', async () => {
    const first: CloneSkill = { name: 'sql', description: 'Первый', instructions: '' }
    const second: CloneSkill = { name: 'sql', description: 'Второй', instructions: '' }
    render(<CloneBody {...cloneProps({ clones: [{ ...CLONE, skills: [first, second] }] })} />)
    await waitFor(() => { expect(document.querySelectorAll('[data-board-clone-skill-row="sql"]')).toHaveLength(2) })

    const trigger = document.querySelectorAll('[data-board-clone-skill-row="sql"] [data-board-clone-action="skill-menu"]')[0] as HTMLElement
    fireEvent.click(trigger)
    await clickSkillMenuAction('Edit')
    fireEvent.change(skillField('name'), { target: { value: 'sql-two' } })
    saveSkill()
    await waitFor(() => { expect(document.querySelector('[data-board-clone-skill-row="sql-two"]')).not.toBeNull() })
    expect(document.querySelectorAll('[data-board-clone-skill-row="sql"]')).toHaveLength(1)
    expect(document.querySelector('[data-board-clone-skill-row="sql"]')?.textContent).toContain('Второй')
  })

  it('resolves a row action against the live list a newer revision replaced', async () => {
    const instance = createBoardStore().create()
    const { rerender } = render(<CloneBody {...cloneProps({ instance, clones: [{ ...CLONE, skills: [REPORT_SKILL] }] })} />)
    await waitFor(() => { expect(document.querySelector('[data-board-clone-skill-row="weekly-report"]')).not.toBeNull() })

    fireEvent.click(skillMenuButton('weekly-report'))
    // The agent's revision lands while the menu is open: the row the menu was
    // opened on is gone, so the action must not hit whatever took its place.
    rerender(<CloneBody {...cloneProps({
      instance,
      clones: [{ ...CLONE, skills: [DRAFT_SKILL], revision: 4 }],
    })} />)
    await waitFor(() => { expect(document.querySelector('[data-board-clone-skill-row="draft-skill"]')).not.toBeNull() })
    await clickSkillMenuAction('Delete')
    expect(document.querySelector('[data-board-clone-skill-row="draft-skill"]')).not.toBeNull()
  })

  it('deletes a skill through the row menu and the next save reflects it', async () => {
    const saveClone = vi.fn(async () => 'saved' as const)
    render(<CloneBody {...cloneProps({ saveClone, clones: [{ ...CLONE, skills: [REPORT_SKILL, DRAFT_SKILL] }] })} />)
    await waitFor(() => { expect(document.querySelector('[data-board-clone-skill-row="weekly-report"]')).not.toBeNull() })

    fireEvent.click(skillMenuButton('weekly-report'))
    await clickSkillMenuAction('Delete')
    await waitFor(() => { expect(document.querySelector('[data-board-clone-skill-row="weekly-report"]')).toBeNull() })
    expect(document.querySelector('[data-board-clone-skill-row="draft-skill"]')).not.toBeNull()

    fireEvent.click(field('save'))
    await waitFor(() => { expect(saveClone).toHaveBeenCalledTimes(1) })
    expect(saveClone).toHaveBeenCalledWith('clone-1', expect.objectContaining({
      skills: [DRAFT_SKILL],
    }), 3)
  })

  it('shows when the record was last updated beside its revision', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-23T06:00:00.000Z'))
    try {
      render(<CloneBody {...cloneProps()} />)
      await waitFor(() => { expect(value('name')).toBe('Анна') })
      // The fixture was updated 2026-09-21T00:00:00Z, two days before "now".
      expect(document.querySelector('[data-board-clone-updated]')?.textContent).toBe('Updated 2d')
    } finally {
      now.mockRestore()
    }
  })

  it('adopts the agent\'s skills with a clean draft and marks the field', async () => {
    const instance = createBoardStore().create()
    const { rerender } = render(<CloneBody {...cloneProps({ instance })} />)
    await waitFor(() => { expect(value('name')).toBe('Анна') })

    rerender(<CloneBody {...cloneProps({
      instance,
      clones: [{ ...CLONE, skills: [REPORT_SKILL], revision: 4 }],
    })} />)
    await waitFor(() => {
      expect(document.querySelector('[data-board-clone-skill-row="weekly-report"]')?.textContent)
        .toContain('Собирает недельный отчёт')
    })
    expect(document.querySelector('[data-board-clone-agent-field="skills"]')).not.toBeNull()
    expect(document.querySelector('[data-board-clone-notice="agent"]')).toBeNull()
  })

  it('keeps edited skills over the agent\'s stored revision and applies it on request', async () => {
    const instance = createBoardStore().create()
    const { rerender } = render(<CloneBody {...cloneProps({ instance, clones: [{ ...CLONE, skills: [DRAFT_SKILL] }] })} />)
    await waitFor(() => { expect(document.querySelector('[data-board-clone-skill-row="draft-skill"]')).not.toBeNull() })
    fireEvent.click(skillMenuButton('draft-skill'))
    await clickSkillMenuAction('Edit')
    fireEvent.change(skillField('description'), { target: { value: 'Моё описание' } })
    saveSkill()
    await waitFor(() => {
      expect(document.querySelector('[data-board-clone-skill-row="draft-skill"]')?.textContent)
        .toContain('Моё описание')
    })

    rerender(<CloneBody {...cloneProps({
      instance,
      clones: [{ ...CLONE, skills: [REPORT_SKILL], revision: 4 }],
    })} />)
    await waitFor(() => { expect(document.querySelector('[data-board-clone-notice="agent"]')).not.toBeNull() })
    // The typed description survives and the agent's list waits as a pending revision.
    expect(document.querySelector('[data-board-clone-skill-row="draft-skill"]')?.textContent)
      .toContain('Моё описание')
    expect(document.querySelector('[data-board-clone-skill-row="weekly-report"]')).toBeNull()
    expect(document.querySelector('[data-board-clone-agent-field="skills"]')).not.toBeNull()

    fireEvent.click(field('apply-agent'))
    await waitFor(() => {
      expect(document.querySelector('[data-board-clone-skill-row="weekly-report"]')).not.toBeNull()
    })
    expect(document.querySelector('[data-board-clone-skill-row="draft-skill"]')).toBeNull()
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
