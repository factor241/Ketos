// @vitest-environment jsdom
/**
 * Peer API: the state poll, the invitation mint, and the connect post — every
 * decoded field with its refusal, and every failure collapsing to a stable
 * code the participants surface names.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OwnerId } from '@ketos/board-doc/types'
import type { KetosPeerId } from '@ketos/peer/types'
import {
  connectPeer, createInvite, fetchPeerState, isPeerStateResponse,
  PEER_CONNECT_PATH, PEER_INVITE_PATH, PEER_STATE_PATH,
} from '../src/client/peer-api.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const SELF = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e1')
const REMOTE = brandString<OwnerId>('00000000-0000-4000-8000-0000000000e2')
const PEER = brandString<KetosPeerId>('peer-one')

/** One complete state answer with test overrides. */
function state(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    self: { selfId: SELF, name: 'Kirill', color: 1 },
    peers: [{ peerId: PEER, selfId: REMOTE, name: 'Remote', color: 5, link: 'online' }],
    refreshMs: 1000,
    ...overrides,
  }
}

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

describe('isPeerStateResponse', () => {
  it('accepts a complete answer and refuses every malformed field', () => {
    expect(isPeerStateResponse(state())).toBe(true)
    for (const bad of [
      null,
      { ...state(), self: undefined },
      { ...state(), self: { selfId: '', name: 'x', color: 1 } },
      { ...state(), self: { selfId: SELF, name: 'x', color: 0 } },
      { ...state(), self: { selfId: SELF, name: 'x', color: 11 } },
      { ...state(), peers: 'x' },
      { ...state(), peers: [{ peerId: '', selfId: REMOTE, name: 'x', color: 1, link: 'online' }] },
      { ...state(), peers: [{ peerId: PEER, selfId: REMOTE, name: 'x', color: 1, link: 'away' }] },
      { ...state(), refreshMs: 0 },
      { ...state(), refreshMs: Number.NaN },
    ]) expect(isPeerStateResponse(bad)).toBe(false)
  })
})

describe('fetchPeerState', () => {
  it('reads and decodes the state from the mount-relative route', async () => {
    const requests = stubFetch(() => Response.json(state()))
    const outcome = await fetchPeerState()
    expect(outcome).toEqual({ ok: true, state: state() })
    expect(requests).toHaveLength(1)
    expect(new URL(requests[0]?.url ?? '').pathname).toBe(PEER_STATE_PATH)
  })

  it('reports a 404 as the not-configured code', async () => {
    stubFetch(() => new Response(null, { status: 404 }))
    expect(await fetchPeerState()).toEqual({ ok: false, code: 'ketos/peer-unavailable' })
  })

  it('reports another status, a body outside the protocol, and a transport failure as unreachable', async () => {
    stubFetch(() => new Response(null, { status: 500 }))
    expect(await fetchPeerState()).toEqual({ ok: false, code: 'ketos/unreachable' })

    stubFetch(() => Response.json({ self: {} }))
    expect(await fetchPeerState()).toEqual({ ok: false, code: 'ketos/unreachable' })

    stubFetch(() => { throw new Error('offline') })
    expect(await fetchPeerState()).toEqual({ ok: false, code: 'ketos/unreachable' })
  })
})

describe('createInvite', () => {
  it('reads the invitation code', async () => {
    const requests = stubFetch(() => Response.json({ invite: 'ketos1.abc' }))
    expect(await createInvite()).toEqual({ ok: true, invite: 'ketos1.abc' })
    expect(new URL(requests[0]?.url ?? '').pathname).toBe(PEER_INVITE_PATH)
  })

  it('maps the host peer code and refuses a body outside the protocol', async () => {
    stubFetch(() => Response.json({ ok: false, error: 'ketos/peer-offline' }, { status: 503 }))
    expect(await createInvite()).toEqual({ ok: false, code: 'ketos/peer-offline' })

    stubFetch(() => Response.json({ ok: false, error: 'ketos/something' }, { status: 500 }))
    expect(await createInvite()).toEqual({ ok: false, code: 'ketos/unreachable' })

    stubFetch(() => Response.json({ invite: '' }))
    expect(await createInvite()).toEqual({ ok: false, code: 'ketos/unreachable' })

    stubFetch(() => Response.json(null))
    expect(await createInvite()).toEqual({ ok: false, code: 'ketos/unreachable' })
  })
})

describe('connectPeer', () => {
  it('posts the code and returns the connected peer id', async () => {
    const requests = stubFetch(() => Response.json({ peerId: PEER }))
    expect(await connectPeer('ketos1.abc')).toEqual({ ok: true, peerId: PEER })
    expect(new URL(requests[0]?.url ?? '').pathname).toBe(PEER_CONNECT_PATH)
    expect(requests[0]?.method).toBe('POST')
    expect(await requests[0]?.json()).toEqual({ invite: 'ketos1.abc' })
  })

  it('keeps every stable host refusal code', async () => {
    const refusals: ReadonlyArray<{ status: number; error: string }> = [
      { status: 400, error: 'ketos/invalid' },
      { status: 409, error: 'ketos/peer-self' },
      { status: 409, error: 'ketos/invite-used' },
      { status: 504, error: 'ketos/peer-unreachable' },
      { status: 503, error: 'ketos/peer-offline' },
    ]
    for (const refusal of refusals) {
      stubFetch(() => Response.json({ ok: false, error: refusal.error }, { status: refusal.status }))
      expect(await connectPeer('ketos1.abc')).toEqual({ ok: false, code: refusal.error })
    }
  })

  it('reports a transport failure, a non-JSON refusal, and a malformed answer as unreachable', async () => {
    stubFetch(() => { throw new Error('offline') })
    expect(await connectPeer('ketos1.abc')).toEqual({ ok: false, code: 'ketos/unreachable' })

    stubFetch(() => new Response('not json', { status: 500 }))
    expect(await connectPeer('ketos1.abc')).toEqual({ ok: false, code: 'ketos/unreachable' })

    stubFetch(() => new Response('not json', { status: 200 }))
    expect(await connectPeer('ketos1.abc')).toEqual({ ok: false, code: 'ketos/unreachable' })

    stubFetch(() => Response.json({ peerId: '' }))
    expect(await connectPeer('ketos1.abc')).toEqual({ ok: false, code: 'ketos/unreachable' })
  })
})
