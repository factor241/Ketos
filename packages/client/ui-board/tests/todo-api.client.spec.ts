// @vitest-environment jsdom
// The to-do HTTP client: the request each operation posts, the success
// decoder, and the failure decoder that turns any unknown answer into
// `ketos/unreachable`.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { BeadsIssueId, ElementId } from '@ketos/board-doc/types'
import {
  addTodoItem, createTodoList, placeTodoList, refreshTodoList, setTodoItemDone, TODO_PATH,
} from '../src/client/todo-api.ts'

const ID = brandString<ElementId>('00000000-0000-4000-8000-0000000000a1')
const ITEM = brandString<BeadsIssueId>('kt-1.1')

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

/**
 * Install one fetch answer and return the mock.
 * @param response - answer builder.
 * @returns the fetch mock.
 */
function stubFetch(response: () => Response | Promise<Response>): ReturnType<typeof vi.fn> {
  const mock = vi.fn(response)
  globalThis.fetch = mock as typeof fetch
  return mock
}

/** The decoded JSON body of the last fetch call. */
function lastBody(mock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = mock.mock.calls.at(-1)?.[1] as RequestInit
  return JSON.parse(init.body as string) as Record<string, unknown>
}

describe('to-do client operations', () => {
  it('creates a list through the route and decodes the answer', async () => {
    const mock = stubFetch(() => Response.json({ ok: true, elementId: ID, revision: 4 }))
    const outcome = await createTodoList('Покупки', 120, -40)
    expect(outcome).toEqual({ ok: true, elementId: ID, revision: 4 })
    const url = mock.mock.calls[0]?.[0] as URL
    expect(url.pathname.endsWith(TODO_PATH)).toBe(true)
    expect(lastBody(mock)).toEqual({ action: 'create', title: 'Покупки', x: 120, y: -40 })
  })

  it('posts each operation with its own action body', async () => {
    const mock = stubFetch(() => Response.json({ ok: true, elementId: ID, revision: 1 }))
    await addTodoItem(ID, 'Молоко')
    expect(lastBody(mock)).toEqual({ action: 'addItem', elementId: ID, title: 'Молоко' })
    await setTodoItemDone(ID, ITEM, true)
    expect(lastBody(mock)).toEqual({ action: 'setDone', elementId: ID, itemId: ITEM, done: true })
    await refreshTodoList(ID)
    expect(lastBody(mock)).toEqual({ action: 'refresh', elementId: ID })
    await placeTodoList(ID, 1, 2)
    expect(lastBody(mock)).toEqual({ action: 'place', elementId: ID, x: 1, y: 2 })
  })

  it('decodes a known failure code', async () => {
    stubFetch(() => Response.json({ ok: false, error: 'ketos/beads-unavailable' }, { status: 503 }))
    await expect(createTodoList('x', 0, 0)).resolves.toEqual({ ok: false, code: 'ketos/beads-unavailable' })
  })

  it('reads an unknown code, a non-object body, and non-JSON as unreachable', async () => {
    stubFetch(() => Response.json({ ok: false, error: 'ketos/surprise' }))
    await expect(createTodoList('x', 0, 0)).resolves.toEqual({ ok: false, code: 'ketos/unreachable' })
    stubFetch(() => Response.json([1, 2, 3]))
    await expect(createTodoList('x', 0, 0)).resolves.toEqual({ ok: false, code: 'ketos/unreachable' })
    stubFetch(() => new Response('not json', { status: 200 }))
    await expect(createTodoList('x', 0, 0)).resolves.toEqual({ ok: false, code: 'ketos/unreachable' })
  })

  it('reads an incomplete success answer as unreachable', async () => {
    stubFetch(() => Response.json({ ok: true, elementId: ID }))
    await expect(createTodoList('x', 0, 0)).resolves.toEqual({ ok: false, code: 'ketos/unreachable' })
    stubFetch(() => Response.json({ ok: true, elementId: 7, revision: 1 }))
    await expect(createTodoList('x', 0, 0)).resolves.toEqual({ ok: false, code: 'ketos/unreachable' })
  })

  it('reads a rejected fetch as unreachable', async () => {
    stubFetch(() => Promise.reject(new Error('offline')))
    await expect(createTodoList('x', 0, 0)).resolves.toEqual({ ok: false, code: 'ketos/unreachable' })
  })
})
