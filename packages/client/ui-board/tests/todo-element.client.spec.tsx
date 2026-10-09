// @vitest-environment jsdom
/**
 * Todo body: the host-owned snapshot rendering (progress, done section, add
 * field, refresh, missing banner), the optimistic toggle with rollback, the
 * read-only rendering of a foreign list, and the neutral fallback.
 */
import { createElement } from 'react'
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
      boardParticipants: [{ id: SELF, name: 'Kirill', color: 1, updatedAt: 1 }],
      peerStates: [],
      peerSelf: null,
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

  it('keeps the toggled row element so the focused checkbox survives the move', () => {
    api.setTodoItemDone.mockResolvedValue({ ok: true, elementId: ID, revision: 2 })
    const { container } = renderTodo(element())
    const before = container.querySelector('[data-board-todo-item="kt-1.1"]')
    fireEvent.click(checkboxOf(container, 'kt-1.1'))
    expect(container.querySelector('[data-board-todo-item="kt-1.1"]')).toBe(before)
  })

  it('exposes the list with list items only, the done heading included', () => {
    const { container } = renderTodo(element())
    const list = container.querySelector('[role="list"]') as HTMLElement
    expect([...list.children].map(child => child.getAttribute('role'))).toEqual(['listitem', 'listitem', 'listitem'])
    expect(container.querySelector('[role="presentation"]')).toBeNull()
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

  it('names a changed list when the host refuses the toggle of an item it no longer holds', async () => {
    api.setTodoItemDone.mockResolvedValue({ ok: false, code: 'ketos/invalid' })
    const { container, notice } = renderTodo(element())
    fireEvent.click(checkboxOf(container, 'kt-1.1'))
    await Promise.resolve()
    await Promise.resolve()
    expect(notice).toHaveBeenCalledWith('element.todo.error.stale')
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
      useStore: (selector: (state: unknown) => unknown): unknown => selector({
        boardLimits: LIMITS,
        selfId: SELF,
        boardParticipants: [{ id: SELF, name: 'Kirill', color: 1, updatedAt: 1 }],
        peerStates: [],
        peerSelf: null,
      }),
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

  it('names the host refusals of an added item: list full and invalid title', async () => {
    const cases = [
      { code: 'ketos/limit', key: 'element.todo.full' },
      { code: 'ketos/invalid', key: 'element.todo.error.invalid' },
    ] as const
    for (const { code, key } of cases) {
      api.addTodoItem.mockResolvedValue({ ok: false, code })
      const { container, notice, unmount } = renderTodo(element())
      const input = container.querySelector('form input') as HTMLInputElement
      fireEvent.change(input, { target: { value: 'Сыр' } })
      fireEvent.submit(input.closest('form') as HTMLFormElement)
      await Promise.resolve()
      await Promise.resolve()
      expect(notice, code).toHaveBeenCalledWith(key)
      unmount()
    }
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
        useStore: (selector: (state: unknown) => unknown): unknown => selector({
          boardLimits: LIMITS,
          selfId: SELF,
          boardParticipants: [{ id: SELF, name: 'Kirill', color: 1, updatedAt: 1 }],
          peerStates: [],
          peerSelf: null,
        }),
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

describe('todo row move animation', () => {
  const ROW_HEIGHT = 20
  const offsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop')
  const getRect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')
  /** Screen shift of every box, standing in for the canvas pan. */
  let screenShift = 0

  beforeAll(() => {
    // jsdom lays nothing out: a row's layout offset is its child index in the list.
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-board-todo-item') && this.parentElement !== null
          ? [...this.parentElement.children].indexOf(this) * ROW_HEIGHT
          : 0
      },
    })
    Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: HTMLElement) {
        const top = this.offsetTop + screenShift
        return {
          top, left: screenShift, bottom: top + ROW_HEIGHT, right: screenShift + 100, width: 100, height: ROW_HEIGHT,
          x: screenShift, y: top, toJSON: () => ({}),
        }
      },
    })
  })
  afterAll(() => {
    if (offsetTop !== undefined) Object.defineProperty(HTMLElement.prototype, 'offsetTop', offsetTop)
    if (getRect !== undefined) Object.defineProperty(Element.prototype, 'getBoundingClientRect', getRect)
  })
  beforeEach(() => {
    screenShift = 0
    Reflect.deleteProperty(window, 'matchMedia')
  })

  /** The same element with its position on the board changed. */
  function props(todo: BoardElement): never {
    return {
      element: todo,
      selected: false,
      editable: true,
      useStore: (selector: (state: unknown) => unknown): unknown => selector({
        boardLimits: LIMITS,
        selfId: SELF,
        boardParticipants: [{ id: SELF, name: 'Kirill', color: 1, updatedAt: 1 }],
        peerStates: [],
        peerSelf: null,
      }),
      actions: { setElementNotice: vi.fn() },
      t,
    } as never
  }

  it('moves the toggled row from its old place to the new one', () => {
    api.setTodoItemDone.mockResolvedValue({ ok: true, elementId: ID, revision: 2 })
    const { container } = renderTodo(element())
    fireEvent.click(checkboxOf(container, 'kt-1.1'))
    const row = container.querySelector('[data-board-todo-item="kt-1.1"]') as HTMLElement
    // The row sat at index 0 and now stands below the done heading at index 1.
    expect(row.style.transform).toBe(`translate(0px, ${String(-ROW_HEIGHT)}px)`)
  })

  it('inverts every moved row before one style read and releases them in the next frame', () => {
    api.setTodoItemDone.mockResolvedValue({ ok: true, elementId: ID, revision: 2 })
    const frames: FrameRequestCallback[] = []
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    try {
      const { container } = renderTodo(element({
        data: {
          epicId: 'kt-1',
          title: 'Покупки',
          items: [
            { id: 'kt-1.1', title: 'Молоко', status: 'open' },
            { id: 'kt-1.3', title: 'Сыр', status: 'open' },
            { id: 'kt-1.2', title: 'Хлеб', status: 'closed' },
          ],
          syncedAt: '2026-10-06T12:00:00Z',
        },
      }))
      const list = container.querySelector('[role="list"]') as HTMLElement
      const rowOf = (id: string): HTMLElement => container.querySelector(`[data-board-todo-item="${id}"]`) as HTMLElement
      /** Transforms of both moving rows at each style read of the list. */
      const reads: string[][] = []
      Object.defineProperty(list, 'offsetWidth', {
        configurable: true,
        get: () => {
          reads.push([rowOf('kt-1.1').style.transform, rowOf('kt-1.3').style.transform])
          return 100
        },
      })
      fireEvent.click(checkboxOf(container, 'kt-1.1'))

      // kt-1.1 drops below the done heading and kt-1.3 rises into its place;
      // the last moved row in DOM order is inverted before the style read too.
      expect(reads).toEqual([[`translate(0px, ${String(-2 * ROW_HEIGHT)}px)`, `translate(0px, ${String(ROW_HEIGHT)}px)`]])
      expect(frames).toHaveLength(1)
      frames[0]!(0)
      expect(rowOf('kt-1.1').style.transform).toBe('')
      expect(rowOf('kt-1.3').style.transform).toBe('')
      expect(rowOf('kt-1.3').style.transition).toBe('')
    } finally {
      requestFrame.mockRestore()
    }
  })

  it('does not animate a row when the board pans or the element moves', () => {
    const { container, rerender } = renderTodo(element())
    screenShift = 240
    rerender(createElement(TodoElement, props(element({ x: 500, y: 300 }))))
    for (const row of container.querySelectorAll<HTMLElement>('[data-board-todo-item]')) {
      expect(row.style.transform, row.getAttribute('data-board-todo-item') ?? '').toBe('')
    }
  })

  it('does not animate an item moved by a snapshot the user did not trigger', () => {
    const { container, rerender } = renderTodo(element())
    rerender(createElement(TodoElement, props(element({
      data: {
        epicId: 'kt-1',
        title: 'Покупки',
        items: [
          { id: 'kt-1.1', title: 'Молоко', status: 'closed' },
          { id: 'kt-1.2', title: 'Хлеб', status: 'closed' },
        ],
        syncedAt: '2026-10-06T12:00:01Z',
      },
    }))))
    expect((container.querySelector('[data-board-todo-item="kt-1.1"]') as HTMLElement).style.transform).toBe('')
  })

  it('skips the move at reduced motion', () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce') })) as never
    api.setTodoItemDone.mockResolvedValue({ ok: true, elementId: ID, revision: 2 })
    const { container } = renderTodo(element())
    fireEvent.click(checkboxOf(container, 'kt-1.1'))
    expect((container.querySelector('[data-board-todo-item="kt-1.1"]') as HTMLElement).style.transform).toBe('')
  })
})
