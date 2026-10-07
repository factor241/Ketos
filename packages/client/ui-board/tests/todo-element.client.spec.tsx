// @vitest-environment jsdom
/**
 * Todo body: the host-owned snapshot rendering (progress, done section, add
 * field, refresh, missing banner), the optimistic toggle with rollback, the
 * read-only rendering of a foreign list, and the neutral fallback.
 */
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { BoardElement, ElementId, OwnerId } from '@ketos/board-doc/types'
import { TodoElement } from '../src/client/elements/TodoElement.tsx'
import { en, type BoardKey, type BoardTranslate } from '../src/client/locale.ts'

const api = vi.hoisted(() => ({
  createTodoList: vi.fn(),
  addTodoItem: vi.fn(),
  setTodoItemDone: vi.fn(),
  refreshTodoList: vi.fn(),
  placeTodoList: vi.fn(),
}))
vi.mock('../src/client/todo-api.ts', () => api)

afterEach(() => { cleanup() })
beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset()
})

const ID = brandString<ElementId>('00000000-0000-4000-8000-0000000000c1')
const SELF = brandString<OwnerId>('demo-self')
const LIMITS = { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 }

/** English-bound locale seat for the direct renders. */
const t: BoardTranslate = (key, params) => {
  const template = en[key as BoardKey]
  const values: Record<string, unknown> = params ?? {}
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = values[name]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  })
}

/** One todo element; `overrides.data` replaces the snapshot payload. */
function element(overrides: Partial<BoardElement> = {}): BoardElement {
  return {
    id: ID,
    kind: 'todo',
    ownerId: SELF,
    x: 0,
    y: 0,
    w: 280,
    h: 240,
    z: 1,
    data: {
      epicId: 'kt-1',
      title: 'Покупки',
      items: [
        { id: 'kt-1.1', title: 'Молоко', status: 'open' },
        { id: 'kt-1.2', title: 'Хлеб', status: 'closed' },
      ],
      syncedAt: '2026-10-06T12:00:00Z',
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

interface RenderOptions {
  readonly editable?: boolean
  readonly limits?: typeof LIMITS | null
}

/**
 * Render the body with the direct-render props.
 * @param todo - the element to render.
 * @param options - owner state and published limits.
 * @returns the render result and the notice mock.
 */
function renderTodo(todo: BoardElement, options: RenderOptions = {}) {
  const notice = vi.fn()
  const result = render(createElement(TodoElement, {
    element: todo,
    selected: false,
    editable: options.editable ?? true,
    useStore: (selector: (state: unknown) => unknown): unknown => selector({
      boardLimits: options.limits === undefined ? LIMITS : options.limits,
      selfId: SELF,
    }),
    actions: { setElementNotice: notice },
    t,
  } as never))
  return { ...result, notice }
}

/** The checkbox of one item row. */
function checkboxOf(container: HTMLElement, itemId: string): HTMLInputElement {
  const row = container.querySelector(`[data-board-todo-item="${itemId}"]`) as HTMLElement
  return row.querySelector('input[type="checkbox"]') as HTMLInputElement
}

describe('todo element body', () => {
  it('draws the progress fraction and the done section', () => {
    const { container } = renderTodo(element())
    const bar = container.querySelector('[role="progressbar"]')
    expect(bar?.getAttribute('aria-valuenow')).toBe('50')
    expect(screen.getByText(t('element.todo.progress', { done: 1, total: 2 }))).not.toBeNull()
    const heading = container.querySelector('[data-board-todo-done]') as HTMLElement
    expect(heading.nextElementSibling?.getAttribute('data-board-todo-item')).toBe('kt-1.2')
    expect(container.querySelector('[data-board-todo-item="kt-1.1"]')).not.toBeNull()
  })

  it('shows 0% for an empty list', () => {
    const { container } = renderTodo(element({
      data: { epicId: 'kt-1', title: 'Пусто', items: [], syncedAt: '2026-10-06T12:00:00Z' },
    }))
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('0')
    expect(container.querySelector('[data-board-todo-done]')).toBeNull()
  })

  it('toggles optimistically and reports setDone', async () => {
    api.setTodoItemDone.mockResolvedValue({ ok: true, elementId: ID, revision: 2 })
    const { container } = renderTodo(element())
    const checkbox = checkboxOf(container, 'kt-1.1')
    fireEvent.click(checkbox)

    expect(checkbox.checked).toBe(true)
    expect(api.setTodoItemDone).toHaveBeenCalledWith(ID, 'kt-1.1', true)
    await Promise.resolve()
    expect(api.setTodoItemDone).toHaveBeenCalledTimes(1)
  })

  it('rolls the optimistic state back and notices a refusal', async () => {
    api.setTodoItemDone.mockResolvedValue({ ok: false, code: 'ketos/beads-failed' })
    const { container, notice } = renderTodo(element())
    const checkbox = checkboxOf(container, 'kt-1.1')
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(checkboxOf(container, 'kt-1.1').checked).toBe(false)
    expect(notice).toHaveBeenCalledWith('element.todo.error.failed')
  })

  it('moves an item below the done heading when the snapshot says so', () => {
    const { container, rerender } = renderTodo(element())
    rerender(createElement(TodoElement, {
      element: element({
        data: {
          epicId: 'kt-1',
          title: 'Покупки',
          items: [
            { id: 'kt-1.1', title: 'Молоко', status: 'closed' },
            { id: 'kt-1.2', title: 'Хлеб', status: 'closed' },
          ],
          syncedAt: '2026-10-06T12:00:01Z',
        },
      }),
      selected: false,
      editable: true,
      useStore: (selector: (state: unknown) => unknown): unknown => selector({ boardLimits: LIMITS, selfId: SELF }),
      actions: { setElementNotice: vi.fn() },
      t,
    } as never))
    const heading = container.querySelector('[data-board-todo-done]') as HTMLElement
    expect(heading.nextElementSibling?.getAttribute('data-board-todo-item')).toBe('kt-1.1')
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100')
  })

  it('adds an item from the field and clears it on success', async () => {
    api.addTodoItem.mockResolvedValue({ ok: true, elementId: ID, revision: 3 })
    const { container } = renderTodo(element())
    const input = container.querySelector('form input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  Сыр  ' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    await Promise.resolve()
    await Promise.resolve()

    expect(api.addTodoItem).toHaveBeenCalledWith(ID, 'Сыр')
    expect(input.value).toBe('')
  })

  it('notices a full list, disables the field, and keeps the refresh control', () => {
    const { container } = renderTodo(element(), { limits: { ...LIMITS, todoItemsMax: 2 } })
    const input = container.querySelector('form input') as HTMLInputElement
    expect(input.disabled).toBe(true)
    expect(container.textContent).toContain(t('element.todo.full'))
    expect(container.querySelector('[data-board-todo-action="refresh"]')).not.toBeNull()
  })

  it('refreshes through the host and notices the failure', async () => {
    api.refreshTodoList.mockResolvedValue({ ok: false, code: 'ketos/beads-failed' })
    const { container, notice } = renderTodo(element())
    fireEvent.click(container.querySelector('[data-board-todo-action="refresh"]') as Element)
    await Promise.resolve()
    await Promise.resolve()
    expect(api.refreshTodoList).toHaveBeenCalledWith(ID)
    expect(notice).toHaveBeenCalledWith('element.todo.error.failed')
  })

  it('banners a list whose epic vanished', () => {
    const { container } = renderTodo(element({
      data: {
        epicId: 'kt-1',
        title: 'Покупки',
        items: [{ id: 'kt-1.1', title: 'Молоко', status: 'open' }],
        syncedAt: '2026-10-06T12:00:00Z',
        missing: true,
      },
    }))
    expect(container.textContent).toContain(t('element.todo.missing'))
    expect(container.querySelector('[data-board-todo-item="kt-1.1"]')).not.toBeNull()
  })

  it('renders a foreign list read-only', () => {
    const { container } = renderTodo(element({ ownerId: brandString<OwnerId>('demo-legal') }), { editable: false })
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
    expect(container.querySelector('form')).toBeNull()
    expect(container.querySelector('[data-board-todo-action="refresh"]')).toBeNull()
    expect(container.querySelector('[data-board-todo-item="kt-1.1"]')).not.toBeNull()
  })

  it('keeps the frame gesture out of the checkbox, the refresh, and the add field', () => {
    const frame = vi.fn()
    const { container } = render(createElement(
      'div',
      { onPointerDown: frame },
      createElement(TodoElement, {
        element: element(),
        selected: false,
        editable: true,
        useStore: (selector: (state: unknown) => unknown): unknown => selector({ boardLimits: LIMITS, selfId: SELF }),
        actions: { setElementNotice: vi.fn() },
        t,
      } as never),
    ))
    fireEvent.pointerDown(checkboxOf(container, 'kt-1.1').closest('label') as Element)
    expect(frame).not.toHaveBeenCalled()
    fireEvent.pointerDown(container.querySelector('form input') as Element)
    expect(frame).not.toHaveBeenCalled()
    fireEvent.pointerDown(container.querySelector('[data-board-todo-action="refresh"]') as Element)
    expect(frame).not.toHaveBeenCalled()
    fireEvent.pointerDown(container.querySelector('[data-board-todo-item]') as Element)
    expect(frame).toHaveBeenCalledTimes(1)
  })

  it('falls back to the neutral body for undecodable data and before limits', () => {
    const broken = renderTodo(element({ data: { a: 1 } }))
    expect(broken.container.querySelector('[data-board-element-neutral="todo"]')).not.toBeNull()
    const early = renderTodo(element(), { limits: null })
    expect(early.container.querySelector('[data-board-element-neutral="todo"]')).not.toBeNull()
  })
})
