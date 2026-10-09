// The owner side of a foreign chat window's transcript: the access decision
// from the owner's own window record and the requester's peer state, the
// request validation at the wire boundary, and the answer sent back over a
// real peer channel on the in-memory transport.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import { brandString } from '@deepseek-ai/dsh-brand'
import { KetosBoardDocService } from '@ketos/board-doc/src/service.ts'
import type {
  BoardWindowRecord, BoardWindowRecordInput, OwnerId, WindowId, WindowSessionId,
} from '@ketos/board-doc/types'
import { registerBoardSync } from '../src/board-sync.ts'
import { createMemoryTransports } from '../src/memory-transport.ts'
import { KetosPeerService, type KetosPeerOptions } from '../src/service.ts'
import type { PeerTransport } from '../src/transport.ts'
import {
  parseTranscriptRequest, parseTranscriptWireResponse, registerTranscript, type TranscriptBoard,
  type TranscriptOptions, type TranscriptPeer, type TranscriptWireResponse,
} from '../src/transcript.ts'
import type { KetosPeerId } from '../src/types.ts'
import {
  FakeParticipantBoard, FakePersistence, FakeSessions, accessOf, assistantEvent, handleOf, injectedEvent, otherEvent,
  textBlock, userEvent, windowRecord,
} from './transcript-fixture.ts'

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
  vi.restoreAllMocks()
})

const LIMITS = { maxMessages: 20, maxMessageChars: 4000, maxBytes: 65_536 } as const

/** Everything the owner side of one pair needs. */
interface Harness {
  readonly owner: KetosPeerService
  readonly requester: KetosPeerService
  readonly ownerCtx: Context
  readonly board: { windows: BoardWindowRecord[] }
  readonly persistence: FakePersistence | undefined
  readonly logs: string[]
  /** The owner's peer id as the requester knows it. */
  readonly ownerPeerId: KetosPeerId
  ask(payload: unknown): Promise<unknown>
}

/**
 * Build an owner and a requester over one memory pair and connect them. The
 * owner's board is a stand-in whose snapshot serves the given windows.
 * @param options - the windows, the log, and limit overrides.
 * @returns the connected pair.
 */
async function createHarness(options: {
  readonly windows?: readonly BoardWindowRecord[]
  readonly events?: Parameters<typeof handleOf>[0]
  readonly limits?: Partial<TranscriptOptions>
  readonly persistence?: boolean
} = {}): Promise<Harness> {
  const pair = createMemoryTransports()
  const ownerCtx = new Context()
  const requesterCtx = new Context()
  new FakeParticipantBoard(ownerCtx, 'host-a')
  new FakeParticipantBoard(requesterCtx, 'person-b')
  const persistence = options.persistence === false
    ? undefined
    : new FakePersistence(ownerCtx, handleOf(options.events ?? [userEvent(1, 1000, 'вопрос'), assistantEvent(2, 2000, 'ответ')]))
  const roots: string[] = []
  const service = async (ctx: Context, transport: PeerTransport, name: string): Promise<KetosPeerService> => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-peer-transcript-'))
    roots.push(root)
    const peerOptions: KetosPeerOptions = {
      name,
      relayUrls: [],
      keyPath: join(root, 'peer.key'),
      peersPath: join(root, 'peers.json'),
      maxFrameBytes: 1_000_000,
      onlineTimeoutMs: 500,
      connectTimeoutMs: 500,
      reconnectMinMs: 50,
      reconnectMaxMs: 200,
      inviteTtlMs: 60_000,
      stateRefreshMs: 1000,
      logger: () => undefined,
      transport,
    }
    return new KetosPeerService(ctx, peerOptions)
  }
  const owner = await service(ownerCtx, pair.a, 'Кирилл')
  const requester = await service(requesterCtx, pair.b, 'Юрист')
  const board = { windows: [...options.windows ?? []] }
  const logs: string[] = []
  const stand: TranscriptBoard = {
    snapshot: async () => ({ selfId: brandString<OwnerId>('host-a'), windows: board.windows }),
  }
  registerTranscript(ownerCtx, owner, stand, {
    ...LIMITS,
    ...options.limits,
    logger: (message) => { logs.push(message) },
  })
  cleanups.push(async () => {
    await ownerCtx.fiber.dispose()
    await requesterCtx.fiber.dispose()
    await owner.close()
    await requester.close()
    for (const root of roots) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  })
  await requester.connect(await owner.invite())
  await vi.waitFor(() => { expect(owner.peers()[0]?.link).toBe('online') })
  await vi.waitFor(() => { expect(requester.peers()[0]?.link).toBe('online') })
  const ownerPeerId = requester.peers()[0]?.peerId as KetosPeerId
  return {
    owner, requester, ownerCtx, board, persistence, logs, ownerPeerId,
    ask: payload => requester.request(ownerPeerId, 'chat.transcript.request', payload as never, { timeoutMs: 1000 }),
  }
}

/**
 * The persistence stand-in of a harness that mounts one.
 * @param harness - the harness.
 * @returns the stand-in.
 */
function persistenceOf(harness: Harness): FakePersistence {
  if (harness.persistence === undefined) throw new Error('the harness mounts no persistence')
  return harness.persistence
}

/** The two-message transcript the default log yields. */
const DEFAULT_MESSAGES = [
  { role: 'user', text: 'вопрос', at: new Date(1000).toISOString() },
  { role: 'agent', text: 'ответ', at: new Date(2000).toISOString() },
]

describe('transcript request: access', () => {
  it('answers the messages of an open window to any known peer', async () => {
    const harness = await createHarness({ windows: [windowRecord('w1', { access: accessOf('all') })] })
    await expect(harness.ask({ windowId: 'w1' })).resolves.toEqual({ ok: true, messages: DEFAULT_MESSAGES })
    expect(persistenceOf(harness).opened).toEqual([['session-1', 'read']])
  })

  it('refuses a window open to its owner only, unless the requester is that owner', async () => {
    const harness = await createHarness({ windows: [windowRecord('w1', { access: accessOf('owner') })] })
    await expect(harness.ask({ windowId: 'w1' })).resolves.toEqual({ ok: false, reason: 'closed' })
    expect(persistenceOf(harness).opened).toEqual([])

    harness.board.windows[0] = windowRecord('w1', {
      access: accessOf('owner'),
      ownerId: brandString<OwnerId>('person-b'),
    })
    await expect(harness.ask({ windowId: 'w1' })).resolves.toEqual({ ok: true, messages: DEFAULT_MESSAGES })
  })

  it('admits a selected window to the people it names only', async () => {
    const harness = await createHarness({ windows: [windowRecord('w1', { access: accessOf('selected', ['other', 'person-b']) })] })
    await expect(harness.ask({ windowId: 'w1' })).resolves.toEqual({ ok: true, messages: DEFAULT_MESSAGES })

    harness.board.windows[0] = windowRecord('w1', { access: accessOf('selected', ['other']) })
    await expect(harness.ask({ windowId: 'w1' })).resolves.toEqual({ ok: false, reason: 'closed' })

    harness.board.windows[0] = windowRecord('w1', { access: accessOf('selected') })
    await expect(harness.ask({ windowId: 'w1' })).resolves.toEqual({ ok: false, reason: 'closed' })
  })

  it('admits the window owner under selected access even when the people list omits them', async () => {
    // The client strips the owner from `people`; after a transfer the owner is
    // the requester, and a peer who is neither owner nor listed stays out.
    const harness = await createHarness({
      windows: [windowRecord('w1', { ownerId: brandString<OwnerId>('person-b'), access: accessOf('selected') })],
    })
    await expect(harness.ask({ windowId: 'w1' })).resolves.toEqual({ ok: true, messages: DEFAULT_MESSAGES })

    harness.board.windows[0] = windowRecord('w1', { ownerId: brandString<OwnerId>('person-c'), access: accessOf('selected') })
    await expect(harness.ask({ windowId: 'w1' })).resolves.toEqual({ ok: false, reason: 'closed' })
  })

  it('decides per channel: the asking peer is the one behind the channel, not the first peer', async () => {
    const harness = await createHarness({ windows: [windowRecord('w1', { access: accessOf('selected', ['person-b']) })] })
    const real = harness.owner.peers()[0]
    if (real === undefined) throw new Error('no peer')
    const admittedElsewhere = { ...real, peerId: brandString<KetosPeerId>('other-channel-x'), selfId: brandString<OwnerId>('person-b') }
    const notAdmitted = { ...real, peerId: brandString<KetosPeerId>('other-channel-y'), selfId: brandString<OwnerId>('person-y') }
    const peers = vi.spyOn(harness.owner, 'peers')

    // The real channel belongs to person-b (admitted); a decoy listed first is not.
    peers.mockReturnValue([notAdmitted, real])
    await expect(harness.ask({ windowId: 'w1' })).resolves.toEqual({ ok: true, messages: DEFAULT_MESSAGES })

    // The real channel now belongs to someone not admitted; the admitted decoy listed first must not lend its identity.
    peers.mockReturnValue([admittedElsewhere, { ...real, selfId: brandString<OwnerId>('person-y') }])
    await expect(harness.ask({ windowId: 'w1' })).resolves.toEqual({ ok: false, reason: 'closed' })
  })

  it('admits a channel whose identity is shared by several peer records', async () => {
    const harness = await createHarness({ windows: [windowRecord('w1', { access: accessOf('selected', ['person-b']) })] })
    const real = harness.owner.peers()[0]
    if (real === undefined) throw new Error('no peer')
    vi.spyOn(harness.owner, 'peers').mockReturnValue([
      { ...real, peerId: brandString<KetosPeerId>('stale-record'), link: 'lost' },
      real,
    ])
    await expect(harness.ask({ windowId: 'w1' })).resolves.toEqual({ ok: true, messages: DEFAULT_MESSAGES })
    // A record of the same identity does not admit a channel that has a different identity.
    vi.spyOn(harness.owner, 'peers').mockReturnValue([
      { ...real, peerId: brandString<KetosPeerId>('stale-record') },
      { ...real, selfId: brandString<OwnerId>('person-y') },
    ])
    await expect(harness.ask({ windowId: 'w1' })).resolves.toEqual({ ok: false, reason: 'closed' })
  })

  it('reads the access at every request, so a closed window stops answering', async () => {
    const harness = await createHarness({ windows: [windowRecord('w1', { access: accessOf('all') })] })
    await expect(harness.ask({ windowId: 'w1' })).resolves.toMatchObject({ ok: true })
    harness.board.windows[0] = windowRecord('w1', { access: accessOf('owner') })
    await expect(harness.ask({ windowId: 'w1' })).resolves.toEqual({ ok: false, reason: 'closed' })
  })

  it('takes the requester from the peer state of the channel, never from the body', async () => {
    const harness = await createHarness({ windows: [windowRecord('w1', { access: accessOf('selected', ['owner-x']) })] })
    // Claiming an admitted identity in the body changes nothing: the body is refused.
    for (const body of [
      { windowId: 'w1', selfId: 'owner-x' },
      { windowId: 'w1', requester: 'owner-x' },
      { windowId: 'w1', from: 'owner-x' },
    ]) {
      await expect(harness.ask(body)).resolves.toEqual({ ok: false, reason: 'not-found' })
    }
    await expect(harness.ask({ windowId: 'w1' })).resolves.toEqual({ ok: false, reason: 'closed' })
  })

  it('treats a sender that is not a known peer as closed', async () => {
    const harness = await createHarness({ windows: [windowRecord('w1', { access: accessOf('all') })] })
    vi.spyOn(harness.owner, 'peers').mockReturnValue([])
    await expect(harness.ask({ windowId: 'w1' })).resolves.toEqual({ ok: false, reason: 'closed' })
  })

  it('refuses an access mode it does not know instead of opening the window', async () => {
    const harness = await createHarness({
      windows: [windowRecord('w1', { access: { mode: 'everyone' as never, people: [] } })],
    })
    await expect(harness.ask({ windowId: 'w1' })).resolves.toEqual({ ok: false, reason: 'unavailable' })
    expect(harness.logs.join('\n')).toContain('w1')
  })
})

describe('transcript request: which windows answer', () => {
  it('answers not-found for a window of another Ketos, without a session, of another kind, or unknown', async () => {
    const harness = await createHarness({
      windows: [
        windowRecord('foreign', { hostId: brandString<OwnerId>('host-z') }),
        windowRecord('no-session', { sessionId: undefined as never }),
        windowRecord('settings', { kind: 'settings', bodyKind: 'settings' }),
        windowRecord('own'),
      ],
    })
    delete (harness.board.windows[1] as { sessionId?: WindowSessionId }).sessionId
    for (const windowId of ['foreign', 'no-session', 'settings', 'absent']) {
      await expect(harness.ask({ windowId })).resolves.toEqual({ ok: false, reason: 'not-found' })
    }
    expect(persistenceOf(harness).opened).toEqual([])
    await expect(harness.ask({ windowId: 'own' })).resolves.toMatchObject({ ok: true })
  })

  it('answers not-found for a malformed request body', async () => {
    const harness = await createHarness({ windows: [windowRecord('w1')] })
    const bodies: unknown[] = [
      null, 'w1', 7, [], [{ windowId: 'w1' }], {}, { windowId: '' }, { windowId: 7 }, { windowId: null },
      { windowId: 'x'.repeat(65) }, { windowId: 'bad\nid' }, { windowId: 'w1', extra: 1 },
    ]
    for (const body of bodies) {
      await expect(harness.ask(body)).resolves.toEqual({ ok: false, reason: 'not-found' })
    }
    expect(persistenceOf(harness).opened).toEqual([])
  })
})

describe('transcript request: what the answer holds', () => {
  it('never carries tools, attachments, thinking, or injected context', async () => {
    const harness = await createHarness({
      windows: [windowRecord('w1')],
      events: [
        injectedEvent(1, 1000, 'runtime-context', 'RUNTIME CONTEXT'),
        userEvent(2, 2000, [
          textBlock('вопрос'),
          { type: 'image', attachment: { attachmentId: 'IMAGE-ID' } },
          { type: 'file', attachment: { attachmentId: 'FILE-ID', name: 'FILE-NAME' } },
        ]),
        assistantEvent(3, 3000, [
          { type: 'reasoning', text: 'THINKING' },
          { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{"command":"TOOL-ARGS"}' },
        ]),
        otherEvent('tool/result', 4, 4000, { message: { content: [textBlock('TOOL-OUTPUT')] } }),
        assistantEvent(5, 5000, [{ type: 'reasoning', text: 'MORE THINKING' }, textBlock('ответ')]),
      ],
    })
    const answer = await harness.ask({ windowId: 'w1' })
    expect(answer).toEqual({
      ok: true,
      messages: [
        { role: 'user', text: 'вопрос', at: new Date(2000).toISOString() },
        { role: 'agent', text: 'ответ', at: new Date(5000).toISOString() },
      ],
    })
    expect(JSON.stringify(answer)).not.toMatch(/THINKING|TOOL-|IMAGE-ID|FILE-|RUNTIME|attachment/u)
  })

  it('applies the configured count, text length, and byte limits', async () => {
    const events = Array.from({ length: 10 }, (_unused, index) => userEvent(index, 1000 + index, `сообщение номер ${String(index)}`))
    const counted = await createHarness({ windows: [windowRecord('w1')], events, limits: { maxMessages: 2 } })
    await expect(counted.ask({ windowId: 'w1' })).resolves.toMatchObject({
      messages: [{ text: 'сообщение номер 8' }, { text: 'сообщение номер 9' }],
    })

    const cut = await createHarness({ windows: [windowRecord('w1')], events, limits: { maxMessageChars: 4, maxMessages: 1 } })
    await expect(cut.ask({ windowId: 'w1' })).resolves.toMatchObject({ messages: [{ text: 'сооб' }] })

    const small = await createHarness({ windows: [windowRecord('w1')], events, limits: { maxBytes: 240 } })
    const answer = await small.ask({ windowId: 'w1' }) as { messages: unknown[] }
    expect(answer.messages.length).toBeGreaterThan(0)
    expect(answer.messages.length).toBeLessThan(10)
    expect(new TextEncoder().encode(JSON.stringify(answer)).byteLength).toBeLessThanOrEqual(240)
  })

  it('flushes a live session before it reads', async () => {
    const harness = await createHarness({ windows: [windowRecord('w1')] })
    const sessions = new FakeSessions(harness.ownerCtx, new Set(['session-1']))
    await harness.ask({ windowId: 'w1' })
    expect(sessions.flushed).toEqual([{ id: 'session-1' }])
  })
})

describe('transcript request: unavailable', () => {
  it('answers unavailable without a path when the log cannot be read', async () => {
    const harness = await createHarness({ windows: [windowRecord('w1')] })
    persistenceOf(harness).failure = new Error('EACCES: /Users/owner/.ketos/sessions/session-1.jsonl')
    const answer = await harness.ask({ windowId: 'w1' })
    expect(answer).toEqual({ ok: false, reason: 'unavailable' })
    expect(JSON.stringify(answer)).not.toContain('/Users')
    expect(harness.logs).toHaveLength(1)
    expect(harness.logs[0]).toContain('w1')
  })

  it('answers an empty transcript for a session nothing has been written to yet, without a log line', async () => {
    const harness = await createHarness({ windows: [windowRecord('w1')] })
    persistenceOf(harness).failure = new SessionPersistenceNotFoundError(brandString<WindowSessionId>('session-1'))
    await expect(harness.ask({ windowId: 'w1' })).resolves.toEqual({ ok: true, messages: [] })
    expect(harness.logs).toEqual([])
  })

  it('answers unavailable when a read of the log fails midway', async () => {
    const harness = await createHarness({ windows: [windowRecord('w1')] })
    vi.spyOn(persistenceOf(harness), 'open').mockResolvedValue({
      read: () => Promise.reject(new Error('corrupt log at /srv/secret/path')),
      close: async () => undefined,
    })
    await expect(harness.ask({ windowId: 'w1' })).resolves.toEqual({ ok: false, reason: 'unavailable' })
  })

  it('answers unavailable when the deployment mounts no session persistence', async () => {
    const harness = await createHarness({ windows: [windowRecord('w1')], persistence: false })
    await expect(harness.ask({ windowId: 'w1' })).resolves.toEqual({ ok: false, reason: 'unavailable' })
    expect(harness.logs.join('\n')).toContain('persistence')
  })

  it('answers unavailable when the board snapshot fails', async () => {
    const pair = createMemoryTransports()
    const ownerCtx = new Context()
    new FakeParticipantBoard(ownerCtx, 'host-a')
    const root = await mkdtemp(join(tmpdir(), 'dsh-peer-transcript-'))
    cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
    const owner = new KetosPeerService(ownerCtx, {
      name: 'Кирилл', relayUrls: [], keyPath: join(root, 'peer.key'), peersPath: join(root, 'peers.json'),
      maxFrameBytes: 1_000_000, onlineTimeoutMs: 500, connectTimeoutMs: 500, reconnectMinMs: 50,
      reconnectMaxMs: 200, inviteTtlMs: 60_000, stateRefreshMs: 1000, logger: () => undefined, transport: pair.a,
    })
    cleanups.push(() => owner.close())
    const logs: string[] = []
    let handler: ((payload: unknown, from: KetosPeerId) => unknown) | undefined
    const peer: TranscriptPeer = {
      handle: (_type, register) => { handler = register; return () => undefined },
      peers: () => owner.peers(),
    }
    registerTranscript(ownerCtx, peer, { snapshot: () => Promise.reject(new Error('board closed')) }, {
      ...LIMITS, logger: (message) => { logs.push(message) },
    })
    await expect(handler?.({ windowId: 'w1' }, brandString<KetosPeerId>('peer'))).resolves
      .toEqual({ ok: false, reason: 'unavailable' })
    expect(logs.join('\n')).toContain('board closed')
  })
})

describe('transcript handler lifecycle', () => {
  it('registers one handler and withdraws it when the plugin disposes', async () => {
    const ctx = new Context()
    const unsubscribe = vi.fn()
    const handle = vi.fn(() => unsubscribe)
    registerTranscript(ctx, { handle, peers: () => [] }, { snapshot: async () => ({ selfId: brandString<OwnerId>('h'), windows: [] }) }, {
      ...LIMITS, logger: () => undefined,
    })
    expect(handle).toHaveBeenCalledTimes(1)
    expect(handle).toHaveBeenCalledWith('chat.transcript.request', expect.any(Function))
    expect(unsubscribe).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('leaves the request unanswered after disposal', async () => {
    const harness = await createHarness({ windows: [windowRecord('w1')] })
    await harness.ownerCtx.fiber.dispose()
    await expect(harness.requester.request(harness.ownerPeerId, 'chat.transcript.request', { windowId: 'w1' }, { timeoutMs: 100 }))
      .rejects.toThrow(/timed out/u)
  })
})

describe('transcript with real board documents', () => {
  /**
   * One side with a real board document.
   * @param transport - the side's transport.
   * @param name - participant name.
   * @returns the side's context, services, and root.
   */
  async function side(transport: PeerTransport, name: string): Promise<{
    ctx: Context
    board: KetosBoardDocService
    peer: KetosPeerService
  }> {
    const root = await mkdtemp(join(tmpdir(), 'dsh-peer-transcript-real-'))
    cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
    const ctx = new Context()
    const board = new KetosBoardDocService(ctx, {
      path: join(root, 'board.db'),
      limits: {
        maxOpsPerRequest: 64,
        maxElements: 2000,
        maxWindowRecords: 100,
        elements: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 },
      },
      journalCompactRows: 500,
      logger: () => undefined,
    })
    const peer = new KetosPeerService(ctx, {
      name, relayUrls: [], keyPath: join(root, 'peer.key'), peersPath: join(root, 'peers.json'),
      maxFrameBytes: 1_000_000, onlineTimeoutMs: 500, connectTimeoutMs: 500, reconnectMinMs: 50,
      reconnectMaxMs: 200, inviteTtlMs: 60_000, stateRefreshMs: 1000, logger: () => undefined, transport,
    })
    registerBoardSync(ctx, peer, board, {
      maxSyncUpdateBytes: 15_728_640, reconnectMinMs: 50, reconnectMaxMs: 200, logger: () => undefined,
    })
    cleanups.push(() => board.close())
    cleanups.push(() => ctx.fiber.dispose())
    cleanups.push(() => peer.close())
    return { ctx, board, peer }
  }

  /**
   * A publishable window record.
   * @param id - window id.
   * @param ownerId - the managing participant.
   * @param access - who may open it.
   * @returns the record input.
   */
  function input(id: string, ownerId: OwnerId, access: BoardWindowRecordInput['access']): BoardWindowRecordInput {
    return {
      id: brandString<WindowId>(id), ownerId, kind: 'agent', bodyKind: 'conversation', title: null, ordinal: 1,
      x: 0, y: 0, w: 400, h: 300, z: 1, access, status: 'idle', sessionId: brandString<WindowSessionId>('session-1'),
    }
  }

  it('answers the owner Ketos own window and refuses the window the asker itself hosts', async () => {
    const pair = createMemoryTransports()
    const a = await side(pair.a, 'Кирилл')
    const b = await side(pair.b, 'Юрист')
    new FakePersistence(a.ctx, handleOf([userEvent(1, 1000, 'вопрос'), assistantEvent(2, 2000, 'ответ')]))
    registerTranscript(a.ctx, a.peer, a.board, { ...LIMITS, logger: () => undefined })
    const selfA = await a.board.selfId()
    const selfB = await b.board.selfId()
    await a.board.apply([{ op: 'window.put', record: input('from-a', selfA, accessOf('selected', [String(selfB)])) }], 'host')
    await b.board.apply([{ op: 'window.put', record: input('from-b', selfB, accessOf('all')) }], 'host')
    await b.peer.connect(await a.peer.invite())
    await vi.waitFor(async () => {
      expect((await a.board.snapshot()).windows.map(record => record.id).sort()).toEqual(['from-a', 'from-b'])
    })
    const peerA = b.peer.peers()[0]?.peerId as KetosPeerId
    const ask = (windowId: string): Promise<unknown> =>
      b.peer.request(peerA, 'chat.transcript.request', { windowId }, { timeoutMs: 1000 })

    await expect(ask('from-a')).resolves.toEqual({ ok: true, messages: DEFAULT_MESSAGES })
    // The window B hosts reached A through synchronization; A does not host it.
    await expect(ask('from-b')).resolves.toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('wire parsing', () => {
  it('accepts exactly one bounded window id', () => {
    expect(parseTranscriptRequest({ windowId: 'w1' })).toBe('w1')
    expect(parseTranscriptRequest({ windowId: 'w'.repeat(64) })).toBe('w'.repeat(64))
    for (const body of [undefined, null, 'w1', [], {}, { windowId: '' }, { windowId: 'w'.repeat(65) }, { windowId: 'w1', x: 1 }]) {
      expect(parseTranscriptRequest(body)).toBeUndefined()
    }
  })

  it('accepts a well-formed answer and refuses everything else', () => {
    const message = { role: 'user', text: 'привет', at: '2026-10-08T10:00:00.000Z' }
    const good: TranscriptWireResponse[] = [
      { ok: true, messages: [] },
      { ok: true, messages: [message as never, { ...message, role: 'agent' } as never] },
      { ok: false, reason: 'closed' },
      { ok: false, reason: 'not-found' },
      { ok: false, reason: 'unavailable' },
    ]
    for (const body of good) expect(parseTranscriptWireResponse(body)).toEqual(body)

    const bad: unknown[] = [
      undefined, null, 'ok', [], {}, { ok: 'yes' }, { ok: true }, { ok: true, messages: 'none' }, { ok: true, messages: {} },
      { ok: true, messages: [null] }, { ok: true, messages: ['text'] },
      { ok: true, messages: [{ ...message, role: 'system' }] },
      { ok: true, messages: [{ ...message, text: 7 }] },
      { ok: true, messages: [{ ...message, at: 7 }] },
      { ok: true, messages: [{ ...message, at: 'yesterday' }] },
      { ok: true, messages: [{ ...message, extra: true }] },
      { ok: true, messages: [{ role: 'user', text: 'x' }] },
      { ok: true, messages: [{ ...message, text: 'я'.repeat(100_001) }] },
      { ok: true, messages: Array.from({ length: 201 }, () => message) },
      { ok: true, messages: [], extra: 1 },
      { ok: false }, { ok: false, reason: 'busy' }, { ok: false, reason: 'closed', detail: '/Users/x' },
    ]
    for (const body of bad) expect(parseTranscriptWireResponse(body)).toBeUndefined()
  })
})
