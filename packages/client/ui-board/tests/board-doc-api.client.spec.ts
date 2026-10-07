// @vitest-environment jsdom
/**
 * Board document API: the snapshot read, the operation post, the stream
 * decoder (comments, multi-line data, malformed payloads), the growing
 * reconnect pause, and the hidden-tab close-and-reopen cycle.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type {
  BoardDocId, BoardElement, BoardPatch, BoardRevision, BoardSnapshot, ElementId, OwnerId,
} from '@ketos/board-doc/types'
import {
  fetchBoardSnapshot, isBoardElement, isBoardPatch, isBoardSnapshot, openBoardEvents, postBoardOps,
  type BoardStreamEvent,
} from '../src/client/board-doc-api.ts'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const DOC = brandString<BoardDocId>('00000000-0000-4000-8000-0000000000d1')
const SELF = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e1')
const ELEMENT_ID = brandString<ElementId>('00000000-0000-4000-8000-0000000000a1')

const ELEMENT: BoardElement = {
  id: ELEMENT_ID,
  kind: 'note',
  ownerId: SELF,
  x: 1,
  y: 2,
  w: 30,
  h: 40,
  z: 1,
  data: { text: 'x' },
  createdAt: 1,
  updatedAt: 2,
}

const SNAPSHOT: BoardSnapshot = {
  docId: DOC,
  selfId: SELF,
  revision: brandNumber<BoardRevision>(1),
  elements: [ELEMENT],
  limits: { elementBytesMax: 1024, noteTextMax: 1024, strokePointsMax: 2000, todoItemsMax: 200 },
}

const PATCH: BoardPatch = {
  revision: brandNumber<BoardRevision>(2),
  upserts: [{ ...ELEMENT, x: 5 }],
  removes: [],
}

/**
 * One streaming response carrying the supplied frames and ending.
 * @param frames - complete SSE frames.
 * @returns the response.
 */
function framesResponse(frames: readonly string[]): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    },
  }), { headers: { 'content-type': 'text/event-stream' } })
}

describe('board document decoders', () => {
  it('accepts complete values and refuses malformed shapes', () => {
    expect(isBoardElement(ELEMENT)).toBe(true)
    for (const bad of [
      null,
      [],
      { ...ELEMENT, kind: 'doodle' },
      { ...ELEMENT, ownerId: '' },
      { ...ELEMENT, w: 0 },
      { ...ELEMENT, h: -1 },
      { ...ELEMENT, data: [] },
      { ...ELEMENT, x: Number.NaN },
      { ...ELEMENT, createdAt: 'now' },
    ]) expect(isBoardElement(bad)).toBe(false)

    expect(isBoardSnapshot(SNAPSHOT)).toBe(true)
    for (const bad of [
      null,
      { ...SNAPSHOT, docId: 'nope' },
      { ...SNAPSHOT, selfId: '' },
      { ...SNAPSHOT, revision: -1 },
      { ...SNAPSHOT, elements: [{}] },
      { ...SNAPSHOT, limits: {} },
    ]) expect(isBoardSnapshot(bad)).toBe(false)

    expect(isBoardPatch(PATCH)).toBe(true)
    for (const bad of [
      null,
      { ...PATCH, revision: Number.NaN },
      { ...PATCH, upserts: 'x' },
      { ...PATCH, removes: ['nope'] },
    ]) expect(isBoardPatch(bad)).toBe(false)
  })
})

describe('board document requests', () => {
  it('reads the snapshot and posts one operation batch', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
      calls.push(`${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`)
      if (new URL(String(input)).pathname.endsWith('.ops')) return Response.json({ ok: true, revision: 2 })
      return Response.json(SNAPSHOT)
    }))
    expect(await fetchBoardSnapshot()).toEqual(SNAPSHOT)
    expect(await postBoardOps([{ op: 'remove', id: ELEMENT_ID }])).toEqual({ ok: true, revision: 2 })
    expect(calls).toEqual(['GET /api/ketos.board', 'POST /api/ketos.board.ops'])
  })

  it('posts a page-lifetime flush with keepalive and a normal batch without it', async () => {
    const inits: RequestInit[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit): Promise<Response> => {
      inits.push(init ?? {})
      return Response.json({ ok: true, revision: 1 })
    }))
    expect(await postBoardOps([{ op: 'remove', id: ELEMENT_ID }], { keepalive: true })).toEqual({ ok: true, revision: 1 })
    expect(inits[0]?.keepalive).toBe(true)
    expect(await postBoardOps([])).toEqual({ ok: true, revision: 1 })
    expect(inits[1]?.keepalive).toBe(false)
  })

  it('reports refused, unreachable, and malformed answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    expect(await fetchBoardSnapshot()).toBeUndefined()
    expect(await postBoardOps([])).toEqual({ ok: false, code: 'ketos/unreachable' })

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: false, error: 'ketos/element-foreign' }, { status: 409 })))
    expect(await postBoardOps([])).toEqual({ ok: false, code: 'ketos/element-foreign' })

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await fetchBoardSnapshot()).toBeUndefined()
    expect(await postBoardOps([])).toEqual({ ok: false, code: 'ketos/unreachable' })

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, revision: 'x' })))
    expect(await postBoardOps([])).toEqual({ ok: false, code: 'ketos/unreachable' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json')))
    expect(await fetchBoardSnapshot()).toBeUndefined()
  })
})

describe('board event stream', () => {
  it('decodes snapshot and patch frames, multi-line data, comments, and malformed payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => framesResponse([
      ': ping\n\n',
      `event: snapshot\ndata: ${JSON.stringify(SNAPSHOT)}\n\n`,
      'event: patch\ndata: {"revision":2,\ndata: "upserts":[],"removes":[]}\n\n',
      'event: patch\ndata: not json\n\n',
      'event: unknown\ndata: {"revision":9}\n\n',
    ])))
    const events: BoardStreamEvent[] = []
    const controller = new AbortController()
    openBoardEvents(controller.signal, (event) => { events.push(event) }, {
      retryMinMs: 60_000,
      retryMaxMs: 60_000,
      hiddenCloseMs: 60_000,
    })
    await vi.waitFor(() => { expect(events).toHaveLength(2) })
    expect(events[0]).toEqual({ type: 'snapshot', snapshot: SNAPSHOT })
    expect(events[1]).toEqual({
      type: 'patch',
      patch: { revision: brandNumber<BoardRevision>(2), upserts: [], removes: [] },
    })
    controller.abort()
  })

  it('reconnects with a growing pause after failures', async () => {
    vi.useFakeTimers()
    const calls: number[] = []
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls.push(Date.now())
      throw new Error('offline')
    }))
    const controller = new AbortController()
    openBoardEvents(controller.signal, () => {}, { retryMinMs: 100, retryMaxMs: 1_000, hiddenCloseMs: 10_000 })
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(99)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(199)
    expect(calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(3)
    controller.abort()
  })

  it('closes the stream of a hidden tab and reopens it on return', async () => {
    vi.useFakeTimers()
    let visibility: DocumentVisibilityState = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    const signals: AbortSignal[] = []
    let connections = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit): Promise<Response> => {
      connections += 1
      const signal = init?.signal ?? new AbortController().signal
      signals.push(signal)
      const encoder = new TextEncoder()
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(SNAPSHOT)}\n\n`))
          signal.addEventListener('abort', () => { controller.close() }, { once: true })
        },
      }), { headers: { 'content-type': 'text/event-stream' } })
    }))
    const events: BoardStreamEvent[] = []
    const controller = new AbortController()
    openBoardEvents(controller.signal, (event) => { events.push(event) }, {
      retryMinMs: 100,
      retryMaxMs: 1_000,
      hiddenCloseMs: 5_000,
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toHaveLength(1)
    expect(connections).toBe(1)

    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(signals[0]?.aborted).toBe(true)

    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(100)
    expect(connections).toBe(2)
    expect(events.length).toBeGreaterThanOrEqual(2)
    controller.abort()
  })

  it('stops without reconnecting when the signal aborts', async () => {
    vi.useFakeTimers()
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      throw new Error('offline')
    }))
    const controller = new AbortController()
    openBoardEvents(controller.signal, () => {}, { retryMinMs: 100, retryMaxMs: 1_000, hiddenCloseMs: 10_000 })
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toBe(1)
    controller.abort()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toBe(1)
  })
})
