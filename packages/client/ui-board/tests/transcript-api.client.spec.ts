// @vitest-environment jsdom
/**
 * Transcript API: the request body and route, the decoded message list with
 * its per-field refusals, and every failure status collapsing to the stable
 * code the foreign chat card names.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTranscript, isTranscriptResponse, TRANSCRIPT_PATH } from '../src/client/transcript-api.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Stub fetch with one handler recording the requests. */
function stubFetch(handler: (request: Request) => Response | Promise<Response>): Request[] {
  const requests: Request[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
    const request = new Request(input as never, init)
    requests.push(request)
    return await handler(request)
  }))
  return requests
}

/** One complete answer. */
function answer(): Record<string, unknown> {
  return {
    messages: [
      { role: 'user', text: 'Hello', at: '2026-10-09T10:00:00.000Z' },
      { role: 'agent', text: 'Hi\nthere', at: '2026-10-09T10:00:05.000Z' },
    ],
  }
}

describe('isTranscriptResponse', () => {
  it('accepts a complete answer, an empty list, and refuses every malformed field', () => {
    expect(isTranscriptResponse(answer())).toBe(true)
    expect(isTranscriptResponse({ messages: [] })).toBe(true)
    for (const bad of [
      null,
      'x',
      {},
      { messages: 'x' },
      { messages: [null] },
      { messages: [{ role: 'system', text: 'x', at: '2026-10-09T10:00:00.000Z' }] },
      { messages: [{ role: 'user', text: 1, at: '2026-10-09T10:00:00.000Z' }] },
      { messages: [{ role: 'user', text: 'x', at: 5 }] },
      { messages: [{ role: 'user', text: 'x', at: 'yesterday' }] },
    ]) expect(isTranscriptResponse(bad)).toBe(false)
  })
})

describe('fetchTranscript', () => {
  it('posts the window id to the mount-relative route and decodes the messages', async () => {
    const requests = stubFetch(() => Response.json(answer()))
    const outcome = await fetchTranscript('agent-1-remote')
    expect(outcome).toEqual({ ok: true, messages: answer()['messages'] })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.method).toBe('POST')
    expect(new URL(requests[0]?.url ?? '').pathname).toBe(TRANSCRIPT_PATH)
    expect(requests[0]?.headers.get('content-type')).toBe('application/json')
    expect(await requests[0]?.json()).toEqual({ windowId: 'agent-1-remote' })
  })

  it('passes the abort signal to the request', async () => {
    const seen: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit): Promise<Response> => {
      if (init?.signal) seen.push(init.signal)
      return Response.json(answer())
    }))
    const controller = new AbortController()
    await fetchTranscript('w', controller.signal)
    expect(seen).toHaveLength(1)
  })

  it.each([
    [403, 'ketos/transcript-closed'],
    [404, 'ketos/window-not-found'],
    [503, 'ketos/peer-offline'],
    [504, 'ketos/peer-timeout'],
  ] as const)('maps %i with its stable body code to %s', async (status, code) => {
    stubFetch(() => Response.json({ ok: false, error: code }, { status }))
    expect(await fetchTranscript('w')).toEqual({ ok: false, code })
  })

  it('collapses an unknown body code, a bodyless failure, and a server error to the generic code', async () => {
    stubFetch(() => Response.json({ ok: false, error: 'ketos/other' }, { status: 403 }))
    expect(await fetchTranscript('w')).toEqual({ ok: false, code: 'ketos/unreachable' })
    stubFetch(() => new Response(null, { status: 404 }))
    expect(await fetchTranscript('w')).toEqual({ ok: false, code: 'ketos/unreachable' })
    stubFetch(() => new Response('boom', { status: 500 }))
    expect(await fetchTranscript('w')).toEqual({ ok: false, code: 'ketos/unreachable' })
  })

  it('does not trust a stable code carried by a status that does not match it', async () => {
    stubFetch(() => Response.json({ ok: false, error: 'ketos/transcript-closed' }, { status: 500 }))
    expect(await fetchTranscript('w')).toEqual({ ok: false, code: 'ketos/unreachable' })
  })

  it('reports a malformed success body and a transport failure as generic', async () => {
    stubFetch(() => Response.json({ messages: [{ role: 'user' }] }))
    expect(await fetchTranscript('w')).toEqual({ ok: false, code: 'ketos/unreachable' })
    stubFetch(() => new Response('not json', { status: 200 }))
    expect(await fetchTranscript('w')).toEqual({ ok: false, code: 'ketos/unreachable' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network') }))
    expect(await fetchTranscript('w')).toEqual({ ok: false, code: 'ketos/unreachable' })
  })
})
