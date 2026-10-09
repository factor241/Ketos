// The peer routes at the wire boundary: the status each refusal answers,
// the body validation of connect, and the lazy start behind state.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import type { BoardWindowRecord, OwnerId } from '@ketos/board-doc/types'
import { formatInvite } from '../src/invite.ts'
import { createMemoryTransports } from '../src/memory-transport.ts'
import {
  PEER_CONNECT_PATH, PEER_FORGET_PATH, PEER_INVITE_PATH, PEER_STATE_PATH, PEER_TRANSCRIPT_PATH, handlePeerConnect,
  handlePeerForget, handlePeerInvite, handlePeerState, handlePeerTranscript, registerPeerRoutes,
} from '../src/routes.ts'
import { KetosPeerService, type KetosPeerOptions } from '../src/service.ts'
import { registerTranscript } from '../src/transcript.ts'
import type { PeerConnection, PeerIncoming, PeerTransport } from '../src/transport.ts'
import type { KetosPeerId } from '../src/types.ts'
import {
  FakePersistence, accessOf, assistantEvent, handleOf, userEvent, windowRecord,
} from './transcript-fixture.ts'

/** Board-document stand-in the peer service reads and writes. */
class FakeBoardDoc extends Service {
  constructor(ctx: Context, private readonly self: string) {
    super(ctx, 'ketosBoardDoc')
  }

  /** {@inheritDoc KetosBoardDocService.selfId} */
  async selfId(): Promise<OwnerId> {
    return brandString<OwnerId>(this.self)
  }

  /** {@inheritDoc KetosBoardDocService.participants} */
  async participants(): Promise<never[]> {
    return []
  }

  /** {@inheritDoc KetosBoardDocService.putOwnParticipant} */
  async putOwnParticipant(): Promise<void> {}
}

/** Connection stand-in that records routes and exposes their handlers. */
class RecordingConnection extends Service {
  readonly routes = new Map<string, ConnectionFetchRoute>()

  constructor(ctx: Context) {
    super(ctx, 'connection')
  }

  get fetch() {
    const owner = this.ctx
    return {
      register: (route: ConnectionFetchRoute) => owner.effect(() => {
        this.routes.set(route.path, route)
        return async () => { this.routes.delete(route.path) }
      }, `recording-connection: ${route.path}`),
    }
  }
}

/** A transport whose configured step fails, to drive error branches. */
class FailingTransport implements PeerTransport {
  onlineError: Error | undefined
  bindError: Error | undefined
  readonly id = brandString<KetosPeerId>('stub-self')

  /** {@inheritDoc PeerTransport.selfId} */
  selfId(): KetosPeerId { return this.id }
  /** {@inheritDoc PeerTransport.bind} */
  async bind(): Promise<void> {
    if (this.bindError !== undefined) throw this.bindError
  }
  /** {@inheritDoc PeerTransport.online} */
  async online(): Promise<void> {
    if (this.onlineError !== undefined) throw this.onlineError
  }
  /** {@inheritDoc PeerTransport.invitationTicket} */
  invitationTicket(): string { return 'memory:<stub>' }
  /** {@inheritDoc PeerTransport.ticketPeerId} */
  ticketPeerId(): KetosPeerId { return brandString<KetosPeerId>('stub-peer') }
  /** {@inheritDoc PeerTransport.dial} */
  dial(): Promise<PeerConnection> { return Promise.reject(new Error('stub dial')) }
  /** {@inheritDoc PeerTransport.accept} */
  accept(): Promise<PeerIncoming> { return Promise.reject(new Error('stub accept')) }
  /** {@inheritDoc PeerTransport.close} */
  async close(): Promise<void> {}
}

/** One route harness: services, recorded routes, and cleanup. */
interface RouteHarness {
  readonly left: KetosPeerService
  readonly right: KetosPeerService
  readonly rightRoutes: Map<string, ConnectionFetchRoute>
  readonly leftTransport: PeerTransport
  readonly rightTransport: PeerTransport
  /** Window records both stand-in boards serve; edit to change what either side sees. */
  readonly windows: BoardWindowRecord[]
  /** The right side's board snapshot failure, when set. */
  boardFailure: Error | undefined
  /** The persistence stand-in of the left (owning) side. */
  readonly persistence: FakePersistence
  close(): Promise<void>
}

/** Options of {@link createRouteHarness}. */
interface RouteHarnessOptions {
  /** Window records both boards serve. */
  readonly windows?: readonly BoardWindowRecord[]
  /** Whether the left side answers transcript requests; false leaves them unanswered. */
  readonly ownerAnswers?: boolean
  /** The right side's transcript request timeout, in milliseconds. */
  readonly timeoutMs?: number
}

let cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups = []
  vi.restoreAllMocks()
})

/**
 * Build one service with its own context, board, and temporary paths.
 * @param transport - the transport the service must use.
 * @param self - the board participant id.
 * @param name - the participant name.
 * @returns the service and a dispose helper.
 */
async function createService(
  transport: PeerTransport,
  self: string,
  name: string,
): Promise<{ service: KetosPeerService; ctx: Context; close(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-peer-routes-'))
  const ctx = new Context()
  new FakeBoardDoc(ctx, self)
  const options: KetosPeerOptions = {
    name,
    relayUrls: [],
    keyPath: join(root, 'peer.key'),
    peersPath: join(root, 'peers.json'),
    maxFrameBytes: 1_000_000,
    onlineTimeoutMs: 200,
    connectTimeoutMs: 200,
    reconnectMinMs: 50,
    reconnectMaxMs: 200,
    inviteTtlMs: 60_000,
    stateRefreshMs: 1000,
    logger: () => undefined,
    transport,
  }
  const service = new KetosPeerService(ctx, options)
  const close = async (): Promise<void> => {
    await service.close()
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
  cleanups.push(close)
  return { service, ctx, close }
}

/**
 * Build two services over one memory pair, with the routes registered on the
 * right side.
 * @returns the harness.
 */
async function createRouteHarness(options: RouteHarnessOptions = {}): Promise<RouteHarness> {
  const pair = createMemoryTransports()
  const left = await createService(pair.a, 'owner-a', 'Кирилл')
  const right = await createService(pair.b, 'owner-b', 'Юрист')
  const rightCtx = new Context()
  const connection = new RecordingConnection(rightCtx)
  const windows = [...options.windows ?? []]
  const persistence = new FakePersistence(left.ctx, handleOf([
    userEvent(1, 1000, 'вопрос'), assistantEvent(2, 2000, 'ответ'),
  ]))
  if (options.ownerAnswers !== false) {
    registerTranscript(left.ctx, left.service, {
      snapshot: async () => ({ selfId: brandString<OwnerId>('owner-a'), windows }),
    }, { maxMessages: 20, maxMessageChars: 4000, maxBytes: 65_536, logger: () => undefined })
  }
  const harness: RouteHarness = {
    left: left.service,
    right: right.service,
    rightRoutes: connection.routes,
    leftTransport: pair.a,
    rightTransport: pair.b,
    windows,
    boardFailure: undefined,
    persistence,
    close: async () => {
      await rightCtx.fiber.dispose()
      await left.close()
      await right.close()
    },
  }
  registerPeerRoutes(rightCtx, right.service, {
    board: {
      snapshot: async () => {
        if (harness.boardFailure !== undefined) throw harness.boardFailure
        return { selfId: brandString<OwnerId>('owner-b'), windows }
      },
    },
    timeoutMs: options.timeoutMs ?? 1000,
  })
  cleanups.push(() => harness.close())
  return harness
}

/**
 * Connect the harness's two services and wait for both links.
 * @param harness - the harness to connect.
 */
async function connectHarness(harness: RouteHarness): Promise<void> {
  await harness.right.connect(await harness.left.invite())
  await vi.waitFor(() => { expect(harness.left.peers()[0]?.link).toBe('online') })
  await vi.waitFor(() => { expect(harness.right.peers()[0]?.link).toBe('online') })
}

/**
 * Invoke one registered route's handler.
 * @param routes - the recorded routes.
 * @param path - route path.
 * @param request - optional request.
 * @returns the handler's response.
 */
async function callRoute(
  routes: Map<string, ConnectionFetchRoute>,
  path: string,
  request?: Request,
): Promise<Response> {
  const route = routes.get(path)
  if (route === undefined) throw new Error(`route ${path} is not registered`)
  return route.fetch(request ?? new Request(`http://localhost${path}`))
}

describe('peer state route', () => {
  it('answers the started node state and starts lazily', async () => {
    const harness = await createRouteHarness()
    const response = await callRoute(harness.rightRoutes, PEER_STATE_PATH)
    expect(response.status).toBe(200)
    const body = await response.json() as { self: { selfId: string }; peers: unknown[]; refreshMs: number }
    expect(body.self.selfId).toBe('owner-b')
    expect(body.peers).toEqual([])
    expect(body.refreshMs).toBe(1000)
    expect(harness.right.peers()).toEqual([])
  })

  it('answers 503 when the node cannot start', async () => {
    const transport = new FailingTransport()
    transport.bindError = new Error('bind failed')
    const harness = await createService(transport, 'owner-a', 'Кирилл')
    const response = await handlePeerState(harness.service)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'ketos/peer-offline' })
  })
})

describe('peer invite route', () => {
  it('answers an invitation code', async () => {
    const harness = await createRouteHarness()
    const response = await callRoute(harness.rightRoutes, PEER_INVITE_PATH)
    expect(response.status).toBe(200)
    const body = await response.json() as { invite: string }
    expect(body.invite.startsWith('ketos1.')).toBe(true)
  })

  it('answers 503 while no relay address exists and on an unexpected failure', async () => {
    const transport = new FailingTransport()
    transport.onlineError = new Error('relay down')
    const harness = await createService(transport, 'owner-a', 'Кирилл')
    await expect((await handlePeerInvite(harness.service)).json())
      .resolves.toEqual({ ok: false, error: 'ketos/peer-offline' })

    const harness2 = await createRouteHarness()
    vi.spyOn(harness2.right, 'invite').mockRejectedValue(new Error('unexpected'))
    await expect((await handlePeerInvite(harness2.right)).json())
      .resolves.toEqual({ ok: false, error: 'ketos/peer-offline' })
  })
})

describe('peer connect route', () => {
  it('connects with a valid code and answers the peer id', async () => {
    const harness = await createRouteHarness()
    const code = await harness.left.invite()
    const response = await callRoute(harness.rightRoutes, PEER_CONNECT_PATH, new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ invite: code }),
    }))
    expect(response.status).toBe(200)
    const body = await response.json() as { peerId: string }
    expect(body.peerId).toBe(String(harness.leftTransport.selfId()))
    await vi.waitFor(async () => {
      expect((await callRoute(harness.rightRoutes, PEER_STATE_PATH).then(r => r.json())) as { peers: unknown[] })
        .toMatchObject({ peers: [{ link: 'online' }] })
    })
  })

  it('refuses malformed bodies with 400', async () => {
    const harness = await createRouteHarness()
    const cases: Request[] = [
      new Request('http://localhost', { method: 'POST', body: 'not json' }),
      new Request('http://localhost', { method: 'POST', body: JSON.stringify([1]) }),
      new Request('http://localhost', { method: 'POST', body: JSON.stringify({}) }),
      new Request('http://localhost', { method: 'POST', body: JSON.stringify({ invite: '' }) }),
      new Request('http://localhost', { method: 'POST', body: JSON.stringify({ invite: 'x', extra: 1 }) }),
    ]
    for (const request of cases) {
      const response = await handlePeerConnect(request, harness.right)
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ ok: false, error: 'ketos/invalid' })
    }
    const unknownCode = await handlePeerConnect(new Request('http://localhost', {
      method: 'POST', body: JSON.stringify({ invite: 'nonsense' }),
    }), harness.right)
    await expect(unknownCode.json()).resolves.toEqual({ ok: false, error: 'ketos/invalid' })
  })

  it('maps self, used, and unreachable refusals', async () => {
    const harness = await createRouteHarness()
    const own = await harness.right.invite()
    await expect(handlePeerConnect(new Request('http://localhost', {
      method: 'POST', body: JSON.stringify({ invite: own }),
    }), harness.right).then(async response => [response.status, await response.json()] as const))
      .resolves.toEqual([409, { ok: false, error: 'ketos/peer-self' }])

    const code = await harness.left.invite()
    const connect = async (): Promise<readonly [number, unknown]> => {
      const response = await handlePeerConnect(new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ invite: code }),
      }), harness.right)
      return [response.status, await response.json()] as const
    }
    await expect(connect()).resolves.toEqual([200, { peerId: String(harness.leftTransport.selfId()) }])
    // The link is already open, so the same code answers as already used.
    await expect(connect()).resolves.toEqual([409, { ok: false, error: 'ketos/invite-used' }])

    const dialer = new FailingTransport()
    const dead = await createService(dialer, 'owner-c', 'Аналитик')
    const other = await createRouteHarness()
    const otherCode = await other.left.invite()
    const response = await handlePeerConnect(new Request('http://localhost', {
      method: 'POST', body: JSON.stringify({ invite: otherCode }),
    }), dead.service)
    expect(response.status).toBe(504)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'ketos/peer-unreachable' })
  })

  it('answers 500 for an unexpected service failure', async () => {
    const harness = await createRouteHarness()
    vi.spyOn(harness.right, 'connect').mockRejectedValue(new Error('boom'))
    const response = await handlePeerConnect(new Request('http://localhost', {
      method: 'POST', body: JSON.stringify({ invite: formatInvite('memory:<x>', 'abcdefghijklmnopqrstuvwxyz') }),
    }), harness.right)
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('')
  })

  it('registers every route on the connection surface', async () => {
    const harness = await createRouteHarness()
    expect([...harness.rightRoutes.keys()].sort())
      .toEqual([PEER_CONNECT_PATH, PEER_FORGET_PATH, PEER_INVITE_PATH, PEER_STATE_PATH, PEER_TRANSCRIPT_PATH].sort())
    expect(harness.rightRoutes.get(PEER_FORGET_PATH)?.methods).toEqual(['POST'])
    expect(harness.rightRoutes.get(PEER_TRANSCRIPT_PATH)?.methods).toEqual(['POST'])
  })
})

describe('peer forget route', () => {
  /**
   * A forget request.
   * @param body - the raw request body.
   * @returns the request.
   */
  function forgetRequest(body: string): Request {
    return new Request('http://localhost', { method: 'POST', body })
  }

  it('forgets a lost peer and answers ok', async () => {
    const harness = await createRouteHarness()
    const code = await harness.left.invite()
    await harness.right.connect(code)
    await vi.waitFor(() => { expect(harness.right.peers()[0]?.link).toBe('online') })
    const peerId = harness.right.peers()[0]?.peerId as KetosPeerId

    const online = await callRoute(harness.rightRoutes, PEER_FORGET_PATH, forgetRequest(JSON.stringify({ peerId })))
    expect(online.status).toBe(409)
    await expect(online.json()).resolves.toEqual({ ok: false, error: 'ketos/peer-online' })

    await harness.left.close()
    await vi.waitFor(() => { expect(harness.right.peers()[0]?.link).not.toBe('online') })
    const response = await callRoute(harness.rightRoutes, PEER_FORGET_PATH, forgetRequest(JSON.stringify({ peerId })))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(harness.right.peers()).toEqual([])
  })

  it('answers 404 for an unknown peer', async () => {
    const harness = await createRouteHarness()
    const response = await handlePeerForget(forgetRequest(JSON.stringify({ peerId: 'nobody' })), harness.right)
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'ketos/peer-unknown' })
  })

  it('refuses malformed bodies with 400', async () => {
    const harness = await createRouteHarness()
    const cases = ['not json', JSON.stringify([1]), JSON.stringify({}), JSON.stringify({ peerId: '' }),
      JSON.stringify({ peerId: 7 }), JSON.stringify({ peerId: 'x', extra: 1 })]
    for (const body of cases) {
      const response = await handlePeerForget(forgetRequest(body), harness.right)
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ ok: false, error: 'ketos/invalid' })
    }
  })

  it('answers 500 for an unexpected service failure', async () => {
    const harness = await createRouteHarness()
    vi.spyOn(harness.right, 'forget').mockRejectedValue(new Error('boom'))
    const response = await handlePeerForget(forgetRequest(JSON.stringify({ peerId: 'x' })), harness.right)
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('')
  })
})

describe('peer transcript route', () => {
  /**
   * A window the left Ketos hosts, as the right Ketos sees it.
   * @param id - window id.
   * @param overrides - fields to change.
   * @returns the record.
   */
  function hostedByLeft(id: string, overrides: Partial<BoardWindowRecord> = {}): BoardWindowRecord {
    return windowRecord(id, {
      hostId: brandString<OwnerId>('owner-a'), ownerId: brandString<OwnerId>('owner-a'), ...overrides,
    })
  }

  /**
   * A transcript request.
   * @param body - the raw request body.
   * @returns the request.
   */
  function transcriptRequest(body: string): Request {
    return new Request('http://localhost', { method: 'POST', body })
  }

  /**
   * Call the registered route for one window.
   * @param harness - the harness.
   * @param windowId - the window to read.
   * @returns the status and the JSON body.
   */
  async function ask(harness: RouteHarness, windowId: string): Promise<{ status: number; body: unknown; headers: Headers }> {
    const response = await callRoute(harness.rightRoutes, PEER_TRANSCRIPT_PATH, transcriptRequest(JSON.stringify({ windowId })))
    return { status: response.status, body: await response.json(), headers: response.headers }
  }

  it('answers the messages of a foreign chat window the owner opens to everyone', async () => {
    const harness = await createRouteHarness({ windows: [hostedByLeft('w1', { access: accessOf('all') })] })
    await connectHarness(harness)
    const request = vi.spyOn(harness.right, 'request')
    const answer = await ask(harness, 'w1')
    expect(answer.status).toBe(200)
    expect(answer.headers.get('cache-control')).toBe('no-store')
    expect(answer.body).toEqual({
      messages: [
        { role: 'user', text: 'вопрос', at: new Date(1000).toISOString() },
        { role: 'agent', text: 'ответ', at: new Date(2000).toISOString() },
      ],
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(
      harness.right.peers()[0]?.peerId, 'chat.transcript.request', { windowId: 'w1' }, { timeoutMs: 1000 },
    )
  })

  it('refuses a malformed body with 400', async () => {
    const harness = await createRouteHarness({ windows: [hostedByLeft('w1')] })
    await connectHarness(harness)
    const bodies = ['not json', JSON.stringify([1]), JSON.stringify({}), JSON.stringify({ windowId: '' }),
      JSON.stringify({ windowId: 7 }), JSON.stringify({ windowId: 'w1', selfId: 'owner-x' })]
    for (const body of bodies) {
      const response = await handlePeerTranscript(transcriptRequest(body), harness.right, {
        board: { snapshot: async () => ({ selfId: brandString<OwnerId>('owner-b'), windows: harness.windows }) },
        timeoutMs: 1000,
      })
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ ok: false, error: 'ketos/invalid' })
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  })

  it('answers 404 for a window the board does not hold or this Ketos hosts itself', async () => {
    const harness = await createRouteHarness({
      windows: [
        hostedByLeft('own', { hostId: brandString<OwnerId>('owner-b') }),
        hostedByLeft('settings', { kind: 'settings', bodyKind: 'settings' }),
      ],
    })
    await connectHarness(harness)
    for (const id of ['absent', 'own', 'settings']) {
      await expect(ask(harness, id)).resolves.toMatchObject({
        status: 404, body: { ok: false, error: 'ketos/window-not-found' },
      })
    }
    expect(harness.persistence.opened).toEqual([])
  })

  it('maps the owner refusals: closed to 403, not-found to 404, unavailable to 503', async () => {
    const harness = await createRouteHarness({
      windows: [hostedByLeft('closed', { access: accessOf('owner') }), hostedByLeft('open')],
    })
    await connectHarness(harness)
    await expect(ask(harness, 'closed')).resolves.toMatchObject({
      status: 403, body: { ok: false, error: 'ketos/transcript-closed' },
    })
    // The owner no longer holds the window its peer still shows.
    harness.windows.push(hostedByLeft('stale'))
    const request = vi.spyOn(harness.right, 'request')
    request.mockResolvedValueOnce({ ok: false, reason: 'not-found' })
    await expect(ask(harness, 'stale')).resolves.toMatchObject({
      status: 404, body: { ok: false, error: 'ketos/window-not-found' },
    })
    request.mockRestore()
    harness.persistence.failure = new Error('EACCES: /Users/owner/.ketos/sessions/x.jsonl')
    const unavailable = await ask(harness, 'open')
    expect(unavailable).toMatchObject({ status: 503, body: { ok: false, error: 'ketos/peer-offline' } })
    expect(JSON.stringify(unavailable.body)).not.toContain('/Users')
  })

  it('answers 503 while no online peer is the window owner', async () => {
    const harness = await createRouteHarness({ windows: [hostedByLeft('w1'), hostedByLeft('lone', { hostId: brandString<OwnerId>('owner-z') })] })
    // No channel yet: the owner's peer is unknown to this Ketos.
    await expect(ask(harness, 'w1')).resolves.toMatchObject({ status: 503, body: { ok: false, error: 'ketos/peer-offline' } })
    await connectHarness(harness)
    // A window of a host that is not a known peer.
    await expect(ask(harness, 'lone')).resolves.toMatchObject({ status: 503, body: { ok: false, error: 'ketos/peer-offline' } })
    await harness.left.close()
    await vi.waitFor(() => { expect(harness.right.peers()[0]?.link).not.toBe('online') })
    await expect(ask(harness, 'w1')).resolves.toMatchObject({ status: 503, body: { ok: false, error: 'ketos/peer-offline' } })
  })

  it('uses the online record when several peer records share the owner identity', async () => {
    const harness = await createRouteHarness({ windows: [hostedByLeft('w1')] })
    await connectHarness(harness)
    const live = harness.right.peers()[0]
    if (live === undefined) throw new Error('no peer')
    vi.spyOn(harness.right, 'peers').mockReturnValue([
      { ...live, peerId: brandString<KetosPeerId>('stale-record'), link: 'lost' },
      { ...live, peerId: brandString<KetosPeerId>('connecting-record'), link: 'connecting' },
      live,
    ])
    await expect(ask(harness, 'w1')).resolves.toMatchObject({ status: 200 })
  })

  it('answers 504 when the owner does not answer in time', async () => {
    const harness = await createRouteHarness({ windows: [hostedByLeft('w1')], ownerAnswers: false, timeoutMs: 80 })
    await connectHarness(harness)
    await expect(ask(harness, 'w1')).resolves.toMatchObject({
      status: 504, body: { ok: false, error: 'ketos/peer-timeout' },
    })
  })

  it('answers 503 when the request fails for another reason or the answer is malformed', async () => {
    const harness = await createRouteHarness({ windows: [hostedByLeft('w1')] })
    await connectHarness(harness)
    const request = vi.spyOn(harness.right, 'request')
    for (const outcome of [
      () => request.mockRejectedValueOnce(new Error('peer link closed before the response: dropped')),
      () => request.mockRejectedValueOnce('not an Error'),
      () => request.mockResolvedValueOnce({ ok: true, messages: 'none' }),
      () => request.mockResolvedValueOnce({ ok: true, messages: [{ role: 'system', text: 'x', at: 'now' }] }),
      () => request.mockResolvedValueOnce(null),
    ]) {
      outcome()
      await expect(ask(harness, 'w1')).resolves.toMatchObject({
        status: 503, body: { ok: false, error: 'ketos/peer-offline' },
      })
    }
  })

  it('answers 500 without a body when the board cannot be read', async () => {
    const harness = await createRouteHarness({ windows: [hostedByLeft('w1')] })
    harness.boardFailure = new Error('board closed')
    const response = await callRoute(harness.rightRoutes, PEER_TRANSCRIPT_PATH, transcriptRequest(JSON.stringify({ windowId: 'w1' })))
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
