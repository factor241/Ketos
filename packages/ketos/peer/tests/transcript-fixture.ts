// Session-log events in the shape the persistence handle returns them, shared
// by the transcript specs. The shapes mirror `snapshots/web/present/session.v4.jsonl`:
// a human prompt is a `user/message` whose data is the message itself with
// `source.kind: 'user'`, and an assistant step is an `assistant/message`
// whose data wraps the message beside its stream record.
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {
  BoardWindowAccess, BoardWindowRecord, OwnerId, WindowId, WindowSessionId,
} from '@ketos/board-doc/types'
import type { TranscriptLogEvent, TranscriptLogHandle } from '../src/transcript-read.ts'

/** Content block of a fixture message. */
export type FixtureBlock = Readonly<Record<string, unknown>>

/**
 * A text content block.
 * @param text - the block text.
 * @returns the block.
 */
export function textBlock(text: string): FixtureBlock {
  return { type: 'text', text }
}

/**
 * A human prompt event.
 * @param seq - event sequence number.
 * @param time - event time in milliseconds.
 * @param content - message content blocks, or one text.
 * @param surfaceOp - the event's surface placement; an append unless a test says otherwise.
 * @returns the event.
 */
export function userEvent(
  seq: number,
  time: number,
  content: string | readonly FixtureBlock[],
  surfaceOp: unknown = 'append',
): TranscriptLogEvent {
  const event = {
    type: 'user/message',
    seq,
    time,
    surfaceOp,
    data: {
      id: `message-${String(seq)}`,
      role: 'user',
      content: typeof content === 'string' ? [textBlock(content)] : content,
      source: { kind: 'user', rpcId: 'rpc-1', clientTimeZone: 'UTC' },
    },
  }
  return event
}

/**
 * A synthetic user-role event another producer injected.
 * @param seq - event sequence number.
 * @param time - event time in milliseconds.
 * @param kind - the producer's source kind.
 * @param text - the injected text.
 * @returns the event.
 */
export function injectedEvent(seq: number, time: number, kind: string, text: string): TranscriptLogEvent {
  const event = {
    type: 'user/message',
    seq,
    time,
    surfaceOp: 'append',
    data: { id: `message-${String(seq)}`, role: 'user', content: [textBlock(text)], source: { kind } },
  }
  return event
}

/**
 * An assistant step event.
 * @param seq - event sequence number.
 * @param time - event time in milliseconds.
 * @param content - message content blocks, or one text.
 * @param surfaceOp - the event's surface placement; an append unless a test says otherwise.
 * @returns the event.
 */
export function assistantEvent(
  seq: number,
  time: number,
  content: string | readonly FixtureBlock[],
  surfaceOp: unknown = 'append',
): TranscriptLogEvent {
  const event = {
    type: 'assistant/message',
    seq,
    time,
    surfaceOp,
    data: {
      turn: 1,
      step: seq,
      message: {
        id: `message-${String(seq)}`,
        role: 'assistant',
        content: typeof content === 'string' ? [textBlock(content)] : content,
        source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      },
      stream: [],
    },
  }
  return event
}

/**
 * An event of another type.
 * @param type - the event type.
 * @param seq - event sequence number.
 * @param time - event time in milliseconds.
 * @param data - the event data.
 * @returns the event.
 */
export function otherEvent(type: string, seq: number, time: number, data: unknown): TranscriptLogEvent {
  const event = { type, seq, time, surfaceOp: 'append', data }
  return event
}

/** A read handle over a fixed event list that records how it was used. */
export interface FixtureHandle extends TranscriptLogHandle {
  /** Number of `close()` calls. */
  closed: number
  /** The `[offset, length]` pairs of every read. */
  readonly reads: Array<readonly [number, number]>
}

/**
 * A read handle that serves slices of one event list.
 * @param events - the whole log.
 * @returns the handle.
 */
export function handleOf(events: readonly TranscriptLogEvent[]): FixtureHandle {
  const handle: FixtureHandle = {
    closed: 0,
    reads: [],
    read: async (offset, length) => {
      handle.reads.push([offset, length])
      return { events: events.slice(offset, offset + length) }
    },
    close: async () => { handle.closed += 1 },
  }
  return handle
}

/** Persistence stand-in registered under the real service name. */
export class FakePersistence extends Service {
  readonly opened: Array<readonly [string, string]> = []
  /** Rejection the next `open` throws instead of returning the handle. */
  failure: Error | undefined

  /**
   * @param ctx - context to register in.
   * @param handle - the handle every `open` returns.
   * @param order - shared list recording the call order.
   */
  constructor(ctx: Context, private readonly handle: TranscriptLogHandle, private readonly order: string[] = []) {
    super(ctx, 'sessionPersistence')
  }

  /** The persistence `open` the log source calls. */
  async open(id: string, access: string): Promise<TranscriptLogHandle> {
    this.opened.push([id, access])
    this.order.push('open')
    if (this.failure !== undefined) throw this.failure
    return this.handle
  }
}

/** Live-session store stand-in registered under the real service name. */
export class FakeSessions extends Service {
  readonly flushed: unknown[] = []
  /** Error the next flushes throw; the session stays live. */
  failure: Error | undefined
  /** Whether a flush first removes the session from the store, as a disposal between lookup and flush would. */
  disposeOnFlush = false

  /**
   * @param ctx - context to register in.
   * @param live - ids of the sessions the store holds.
   * @param order - shared list recording the call order.
   */
  constructor(ctx: Context, private readonly live: Set<string>, private readonly order: string[] = []) {
    super(ctx, 'sessions')
  }

  /** The store lookup the log source calls. */
  get(id: string): { id: string } | undefined {
    return this.live.has(id) ? { id } : undefined
  }

  /** The store flush barrier the log source calls. */
  async flush(session: { id: string }): Promise<void> {
    this.flushed.push(session)
    this.order.push('flush')
    if (this.disposeOnFlush) {
      this.live.delete(session.id)
      throw new Error(`session "${session.id}" is not live in this store`)
    }
    if (this.failure !== undefined) throw this.failure
  }
}

/** Board-document stand-in the peer service reads its identity from. */
export class FakeParticipantBoard extends Service {
  /**
   * @param ctx - context to register in.
   * @param self - the board participant id.
   */
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

/**
 * A window record as the board document carries it.
 * @param id - the window id.
 * @param overrides - fields to change.
 * @returns the record of an open chat window hosted by `host-a`.
 */
export function windowRecord(id: string, overrides: Partial<BoardWindowRecord> = {}): BoardWindowRecord {
  return {
    id: brandString<WindowId>(id),
    hostId: brandString<OwnerId>('host-a'),
    ownerId: brandString<OwnerId>('host-a'),
    kind: 'agent',
    bodyKind: 'conversation',
    title: 'Чат',
    ordinal: 1,
    x: 0,
    y: 0,
    w: 400,
    h: 300,
    z: 1,
    access: { mode: 'all', people: [] },
    status: 'idle',
    sessionId: brandString<WindowSessionId>('session-1'),
    updatedAt: 1,
    ...overrides,
  }
}

/**
 * An access value.
 * @param mode - the access mode.
 * @param people - owner ids a `selected` window admits.
 * @returns the access.
 */
export function accessOf(mode: BoardWindowAccess['mode'], people: readonly string[] = []): BoardWindowAccess {
  return { mode, people: people.map(person => brandString<OwnerId>(person)) }
}
