// The framed link: reading and writing frames at the stream boundary, the
// read loop's refusal of malformed bytes, message and request dispatch over
// two connected links, request correlation and timeout, and close handling
// from the link, the connection, and the transport.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  PEER_FRAME_CODES, PEER_FRAME_HEADER_BYTES, encodePeerFrame, type PeerHelloPayload,
} from '../src/frame.ts'
import {
  PEER_LINK_BYE_GRACE_MS, PEER_LINK_PROTOCOL_CLOSE_CODE, PEER_LINK_SYNC_TOO_LARGE_CLOSE_CODE, PEER_UNHANDLED, PeerLink,
  PeerRequestTimeoutError, readPeerFrame, writePeerFrame,
} from '../src/link.ts'
import { createMemoryStreamPair, createMemoryTransports, type MemoryTransportPair } from '../src/memory-transport.ts'
import type { PeerConnection, PeerStream } from '../src/transport.ts'
import type { KetosPeerId } from '../src/types.ts'

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

/** A PeerConnection whose close and settle the spec controls directly. */
class StubConnection implements PeerConnection {
  readonly peerId = brandString<KetosPeerId>('stub-peer')
  readonly closeCalls: { readonly code: bigint; readonly reason: string }[] = []
  closeError: Error | undefined
  closedError: Error | undefined
  private reason: string | undefined
  private readonly waiters = new Set<(reason: string) => void>()

  /** {@inheritDoc PeerConnection.closed} */
  closed(): Promise<string> {
    if (this.closedError !== undefined) return Promise.reject(this.closedError)
    if (this.reason !== undefined) return Promise.resolve(this.reason)
    return new Promise((resolve) => { this.waiters.add(resolve) })
  }

  /** {@inheritDoc PeerConnection.close} */
  close(code: bigint, reason: string): void {
    this.closeCalls.push({ code, reason })
    if (this.closeError !== undefined) throw this.closeError
    this.settle(`closed locally: ${reason} (code ${code.toString()})`)
  }

  /** {@inheritDoc PeerConnection.openStream} */
  openStream(): Promise<PeerStream> {
    return Promise.reject(new Error('stub connection has no streams'))
  }

  /** {@inheritDoc PeerConnection.acceptStream} */
  acceptStream(): Promise<PeerStream> {
    return Promise.reject(new Error('stub connection has no streams'))
  }

  /** End the connection as a dropped network link would. */
  settle(reason: string): void {
    if (this.reason !== undefined) return
    this.reason = reason
    for (const resolve of [...this.waiters]) resolve(reason)
    this.waiters.clear()
  }
}

/** One link under test with its log line and hello sinks. */
interface LinkHarness {
  readonly link: PeerLink
  readonly logs: string[]
  readonly hellos: PeerHelloPayload[]
}

/** Link inputs a spec can override. */
interface LinkOverrides {
  readonly maxFrameBytes?: number
  readonly peerId?: KetosPeerId
}

/** The raw link, its stub connection, and the writer end of its stream. */
interface RawLink {
  readonly harness: LinkHarness
  readonly connection: StubConnection
  readonly writer: PeerStream
}

/**
 * Build one link over an already connected stream.
 * @param connection - the connection whose close state feeds the link.
 * @param stream - the link's single stream.
 * @param overrides - frame bound and remote identity.
 * @returns the link plus its recorded log lines and hellos.
 */
function createLink(connection: PeerConnection, stream: PeerStream, overrides: LinkOverrides = {}): LinkHarness {
  const logs: string[] = []
  const hellos: PeerHelloPayload[] = []
  const link = new PeerLink(connection, stream, {
    peerId: overrides.peerId ?? connection.peerId,
    maxFrameBytes: overrides.maxFrameBytes ?? 1024,
    logger: (message) => { logs.push(message) },
    onHello: (hello) => { hellos.push(hello) },
  })
  return { link, logs, hellos }
}

/**
 * Build one link over a raw memory stream pair.
 * @param overrides - frame bound and remote identity.
 * @returns the link, its stub connection, and the writer end of its stream.
 */
function createRawLink(overrides: LinkOverrides = {}): RawLink {
  const [stream, writer] = createMemoryStreamPair()
  const connection = new StubConnection()
  const harness = createLink(connection, stream, overrides)
  cleanups.push(() => {
    connection.settle('test cleanup')
    void writer.finish()
  })
  return { harness, connection, writer }
}

/**
 * Build two links over one dialed in-memory connection.
 * @param maxFrameBytes - frame bound both links accept.
 * @returns both links and the transport pair for dropping the connection.
 */
async function createLinkPair(maxFrameBytes = 1024): Promise<{ a: LinkHarness; b: LinkHarness; pair: MemoryTransportPair }> {
  const pair = createMemoryTransports()
  await pair.a.bind()
  await pair.b.bind()
  const connectionA = await pair.a.dial(pair.b.invitationTicket())
  const connectionB = await (await pair.b.accept()).complete()
  const streamA = await connectionA.openStream()
  const streamB = await connectionB.acceptStream()
  const a = createLink(connectionA, streamA, { maxFrameBytes })
  const b = createLink(connectionB, streamB, { maxFrameBytes })
  cleanups.push(() => {
    pair.dropConnections()
    void streamA.finish()
    void streamB.finish()
  })
  return { a, b, pair }
}

/**
 * Encode one wire frame with a raw, possibly non-JSON body.
 * @param code - frame code.
 * @param body - body text.
 * @returns the encoded frame.
 */
function rawFrame(code: number, body: string): Uint8Array {
  const bodyBytes = new TextEncoder().encode(body)
  const frame = new Uint8Array(PEER_FRAME_HEADER_BYTES + bodyBytes.byteLength)
  new DataView(frame.buffer).setUint32(0, bodyBytes.byteLength)
  frame[4] = code
  frame.set(bodyBytes, PEER_FRAME_HEADER_BYTES)
  return frame
}

/** Let queued microtasks and timers run one round. */
async function flush(): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
}

describe('peer frame reading', () => {
  it('round-trips a frame through a memory stream pair', async () => {
    const [reader, writer] = createMemoryStreamPair()
    await writePeerFrame(writer, PEER_FRAME_CODES.hello, { v: 1 })
    await expect(readPeerFrame(reader, 64)).resolves.toEqual({ code: PEER_FRAME_CODES.hello, payload: { v: 1 } })
  })

  it('refuses a body longer than the frame bound', async () => {
    const [reader, writer] = createMemoryStreamPair()
    await writer.write(encodePeerFrame(PEER_FRAME_CODES.hello, 'x'.repeat(32)))
    await expect(readPeerFrame(reader, 32)).rejects.toThrow(/exceeds 32 bytes/u)
  })

  it('reads a zero-length body and refuses it as non-JSON', async () => {
    const [reader, writer] = createMemoryStreamPair()
    const header = new Uint8Array(PEER_FRAME_HEADER_BYTES)
    header[4] = PEER_FRAME_CODES.hello
    await writer.write(header)
    await expect(readPeerFrame(reader, 64)).rejects.toThrow(/not JSON/u)
  })

  it('reads a binary body as its bytes and refuses an empty one', async () => {
    const [reader, writer] = createMemoryStreamPair()
    const bytes = new Uint8Array([9, 8, 7])
    await writePeerFrame(writer, PEER_FRAME_CODES['board.sv'], bytes)
    await expect(readPeerFrame(reader, 64)).resolves.toEqual({ code: PEER_FRAME_CODES['board.sv'], payload: bytes })

    const [emptyReader, emptyWriter] = createMemoryStreamPair()
    const header = new Uint8Array(PEER_FRAME_HEADER_BYTES)
    header[4] = PEER_FRAME_CODES['board.sv']
    await emptyWriter.write(header)
    await expect(readPeerFrame(emptyReader, 64)).rejects.toThrow(/must not be empty/u)
  })
})

describe('peer link lifecycle', () => {
  it('reports the remote peer id and unsubscribes a frame listener', async () => {
    const { harness, writer } = createRawLink()
    expect(String(harness.link.peerId)).toBe('stub-peer')
    const seen: unknown[] = []
    const unsubscribe = harness.link.onFrame((_code, payload) => { seen.push(payload); return PEER_UNHANDLED })
    unsubscribe()
    harness.link.start()
    await writer.write(encodePeerFrame(5, { n: 1 }))
    await vi.waitFor(() => { expect(harness.logs).toHaveLength(1) })
    expect(harness.logs[0]).toContain('frame chat.transcript.request has no handler')
    expect(seen).toEqual([])
  })

  it('sends bye and rejects later sends and requests once closed', async () => {
    const { harness, connection, writer } = createRawLink()
    await harness.link.close('done')
    expect(connection.closeCalls).toEqual([{ code: 0n, reason: 'done' }])
    await expect(readPeerFrame(writer, 64)).resolves.toEqual({ code: PEER_FRAME_CODES.bye, payload: { reason: 'done' } })
    await expect(harness.link.send(5, { n: 1 })).rejects.toThrow(/closed/u)
    await expect(harness.link.request(5, { n: 1 }, 50)).rejects.toThrow(/closed/u)
    await expect(harness.link.closed()).resolves.toContain('closed locally: done')
    await harness.link.close('again')
    expect(connection.closeCalls).toHaveLength(1)
  })

  it('settles closed() when the connection ends outside the link', async () => {
    const { harness, connection } = createRawLink()
    const closed = harness.link.closed()
    connection.settle('network down')
    await expect(closed).resolves.toBe('network down')
  })

  it('settles with the transport failure when the close promise rejects', async () => {
    const [stream] = createMemoryStreamPair()
    const connection = new StubConnection()
    connection.closedError = new Error('boom')
    const harness = createLink(connection, stream)
    await expect(harness.link.closed()).resolves.toBe('connection closed: Error: boom')
  })

  it('rejects an in-flight request when the connection ends', async () => {
    const { harness, connection } = createRawLink()
    const pending = harness.link.request(5, { n: 1 }, 1000)
    connection.settle('dropped')
    await expect(pending).rejects.toThrow(/closed before the response: dropped/u)
    await expect(pending).rejects.not.toBeInstanceOf(PeerRequestTimeoutError)
  })

  it('carries an application close code when one is given', async () => {
    const { harness, connection } = createRawLink()
    await harness.link.close('too large', PEER_LINK_SYNC_TOO_LARGE_CLOSE_CODE)
    expect(connection.closeCalls).toEqual([{ code: PEER_LINK_SYNC_TOO_LARGE_CLOSE_CODE, reason: 'too large' }])
  })

  it('lets the connection close win over a concurrent read failure', async () => {
    const { harness, connection, writer } = createRawLink()
    harness.link.start()
    connection.settle('lost')
    await writer.finish()
    await flush()
    expect(harness.logs).toEqual([])
    expect(connection.closeCalls).toEqual([])
  })

  it('ignores a handler answer that fails after the link closed', async () => {
    const { a, b } = await createLinkPair()
    let completed = false
    b.link.onFrame(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 20) })
      completed = true
      return { ok: true }
    })
    a.link.start()
    b.link.start()
    const pending = a.link.request(5, { n: 1 }, 500)
    await a.link.close('done')
    await expect(pending).rejects.toThrow(/closed before the response/u)
    await new Promise((resolve) => { setTimeout(resolve, 40) })
    // The request handler finished after the bye; its response write failed on
    // the closed link and the dispatch reported nothing.
    expect(completed).toBe(true)
    expect(b.logs).toEqual([])
  })

  it('logs a failed connection close and still settles', async () => {
    const { harness, connection } = createRawLink()
    connection.closeError = new Error('close refused')
    await harness.link.close('done')
    expect(harness.logs.some(line => line.includes('close failed: Error: close refused'))).toBe(true)
    await expect(harness.link.closed()).resolves.toContain('closed locally: done')
  })
})

describe('peer link protocol refusals', () => {
  it('closes with the protocol code on a truncated header', async () => {
    const { harness, connection, writer } = createRawLink()
    harness.link.start()
    await writer.write(new Uint8Array(3))
    await writer.finish()
    await expect(harness.link.closed()).resolves.toContain('protocol error')
    expect(connection.closeCalls).toEqual([{ code: PEER_LINK_PROTOCOL_CLOSE_CODE, reason: 'protocol error' }])
    expect(harness.logs[0]).toContain('closing after')
  })

  it('closes with the protocol code on a body over the frame bound', async () => {
    const { harness, connection, writer } = createRawLink({ maxFrameBytes: 32 })
    harness.link.start()
    await writer.write(rawFrame(PEER_FRAME_CODES.hello, 'x'.repeat(64)))
    await expect(harness.link.closed()).resolves.toContain('protocol error')
    expect(connection.closeCalls[0]?.code).toBe(PEER_LINK_PROTOCOL_CLOSE_CODE)
  })

  it('closes with the protocol code on a non-JSON body', async () => {
    const { harness, writer } = createRawLink()
    harness.link.start()
    await writer.write(rawFrame(PEER_FRAME_CODES.hello, 'not json'))
    await expect(harness.link.closed()).resolves.toContain('protocol error')
    expect(harness.logs[0]).toContain('frame body is not JSON')
  })

  it('closes with the protocol code on a JSON body of a binary frame code', async () => {
    const { harness, connection, writer } = createRawLink()
    const seen: unknown[] = []
    harness.link.onFrame((_code, payload) => { seen.push(payload); return undefined })
    harness.link.start()
    await writer.write(rawFrame(PEER_FRAME_CODES['board.update'], '{"0":1,"1":2}'))
    await vi.waitFor(() => {
      expect(connection.closeCalls).toEqual([{ code: PEER_LINK_PROTOCOL_CLOSE_CODE, reason: 'protocol error' }])
    })
    expect(seen).toEqual([])
    expect(harness.logs[0]).toContain('must not be JSON')
  })

  it('closes with the protocol code on an unknown frame code and stays usable', async () => {
    const { harness, connection, writer } = createRawLink()
    harness.link.start()
    await writer.write(encodePeerFrame(9, { n: 1 }))
    await expect(harness.link.closed()).resolves.toContain('protocol error')
    expect(connection.closeCalls).toEqual([{ code: PEER_LINK_PROTOCOL_CLOSE_CODE, reason: 'protocol error' }])
    expect(harness.logs[0]).toContain('unknown frame code 9')

    const next = createRawLink()
    next.harness.link.start()
    await next.writer.write(encodePeerFrame(PEER_FRAME_CODES.bye, { reason: 'later' }))
    await expect(next.harness.link.closed()).resolves.toBe('bye: later')
  })

  it('closes with the protocol code when onHello throws a non-Error', async () => {
    const [stream, writer] = createMemoryStreamPair()
    const connection = new StubConnection()
    const logs: string[] = []
    const link = new PeerLink(connection, stream, {
      peerId: connection.peerId,
      maxFrameBytes: 1024,
      logger: (message) => { logs.push(message) },
      onHello: () => { throw 'bad hello' },
    })
    cleanups.push(() => {
      connection.settle('test cleanup')
      void writer.finish()
    })
    link.start()
    await writer.write(encodePeerFrame(PEER_FRAME_CODES.hello, { v: 2, selfId: 'owner-b', name: 'Юрист', color: 2 }))
    await expect(link.closed()).resolves.toContain('protocol error')
    expect(logs[0]).toContain('closing after bad hello')
  })

  it('closes with the protocol code when the stream fails with a non-Error', async () => {
    const [base] = createMemoryStreamPair()
    const stream: PeerStream = {
      write: bytes => base.write(bytes),
      readExact: () => { throw 'socket gone' },
      finish: () => base.finish(),
    }
    const connection = new StubConnection()
    const harness = createLink(connection, stream)
    harness.link.start()
    await expect(harness.link.closed()).resolves.toContain('protocol error')
    expect(harness.logs[0]).toContain('closing after socket gone')
  })

  it('logs a throwing message listener and keeps the connection alive', async () => {
    const { harness, connection, writer } = createRawLink()
    const seen: unknown[] = []
    harness.link.onFrame(() => { throw 'plain failure' })
    harness.link.onFrame((_code, payload) => { seen.push(payload); return undefined })
    harness.link.start()
    await writer.write(encodePeerFrame(5, { n: 1 }))
    await vi.waitFor(() => { expect(harness.logs.some(line => line.includes('handler failed: plain failure'))).toBe(true) })
    expect(seen).toEqual([{ n: 1 }])
    expect(connection.closeCalls).toEqual([])

    // The channel still dispatches the next frame.
    await writer.write(encodePeerFrame(5, { n: 2 }))
    await vi.waitFor(() => { expect(seen).toEqual([{ n: 1 }, { n: 2 }]) })
    expect(connection.closeCalls).toEqual([])
  })

  it('contains a later listener failure once the connection is gone', async () => {
    const { harness, connection, writer } = createRawLink()
    harness.link.onFrame(() => { connection.close(0n, 'gone') })
    harness.link.onFrame(() => { throw new Error('late failure') })
    harness.link.start()
    await writer.write(encodePeerFrame(5, { n: 1 }))
    await flush()
    expect(harness.logs.some(line => line.includes('handler failed: Error: late failure'))).toBe(true)
    expect(connection.closeCalls).toEqual([{ code: 0n, reason: 'gone' }])
    await expect(harness.link.closed()).resolves.toContain('closed locally: gone')
  })
})

describe('peer link frame dispatch', () => {
  it('delivers a plain message to every listener and records an unhandled one', async () => {
    const { harness, writer } = createRawLink()
    const seen: { code: number; payload: unknown }[] = []
    harness.link.onFrame((code, payload) => { seen.push({ code, payload }); return PEER_UNHANDLED })
    harness.link.start()
    await writer.write(encodePeerFrame(5, { n: 7 }))
    await vi.waitFor(() => { expect(harness.logs).toHaveLength(1) })
    expect(seen).toEqual([{ code: 5, payload: { n: 7 } }])
    expect(harness.logs[0]).toContain('frame chat.transcript.request has no handler')
  })

  it('ignores a reserved frame when no listener is registered', async () => {
    const { harness, writer } = createRawLink()
    harness.link.start()
    await writer.write(encodePeerFrame(6, { n: 1 }))
    await vi.waitFor(() => { expect(harness.logs).toHaveLength(1) })
    expect(harness.logs[0]).toContain('frame chat.transcript.response has no handler')
  })

  it('passes a hello sent after the handshake to the onHello callback', async () => {
    const { harness, writer } = createRawLink()
    harness.link.start()
    await writer.write(encodePeerFrame(PEER_FRAME_CODES.hello, { v: 2, selfId: 'owner-b', name: 'Юрист', color: 2 }))
    await vi.waitFor(() => { expect(harness.hellos).toHaveLength(1) })
    expect(harness.hellos[0]).toEqual({ v: 2, selfId: 'owner-b', name: 'Юрист', color: 2 })
  })

  it('settles on bye and closes the connection without a protocol code', async () => {
    const { harness, connection, writer } = createRawLink()
    harness.link.start()
    await writer.write(encodePeerFrame(PEER_FRAME_CODES.bye, { reason: 'later' }))
    await expect(harness.link.closed()).resolves.toBe('bye: later')
    expect(connection.closeCalls).toEqual([{ code: 0n, reason: 'bye' }])
  })
})

describe('peer link over a dialed memory connection', () => {
  it('carries a message, an answered request, and a void response as null', async () => {
    const { a, b } = await createLinkPair()
    const seen: unknown[] = []
    b.link.onFrame((code, payload, context) => {
      if (context.requestId === undefined) { seen.push({ code, payload }); return undefined }
      return code === 5 ? { echo: payload } : undefined
    })
    a.link.start()
    b.link.start()
    await a.link.send(5, { n: 1 })
    await vi.waitFor(() => { expect(seen).toEqual([{ code: 5, payload: { n: 1 } }]) })
    await expect(a.link.request(5, { n: 2 }, 500)).resolves.toEqual({ echo: { n: 2 } })
    await expect(a.link.request(6, { n: 3 }, 500)).resolves.toBeNull()
  })

  it('rejects a request with the error envelope of a throwing handler', async () => {
    const first = await createLinkPair()
    first.b.link.onFrame(() => { throw new Error('handler exploded') })
    first.a.link.start()
    first.b.link.start()
    await expect(first.a.link.request(5, { n: 1 }, 500)).rejects.toThrow('handler exploded')

    const second = await createLinkPair()
    second.b.link.onFrame(() => { throw 'not an Error' })
    second.a.link.start()
    second.b.link.start()
    await expect(second.a.link.request(5, { n: 1 }, 500)).rejects.toThrow('not an Error')
  })

  it('times out a request the peer never answers', async () => {
    const { a, b } = await createLinkPair()
    a.link.start()
    b.link.start()
    const outcome = a.link.request(6, { n: 1 }, 30)
    await expect(outcome).rejects.toThrow(/timed out after 30 ms/u)
    await expect(outcome).rejects.toBeInstanceOf(PeerRequestTimeoutError)
  })

  it('ignores a response for an unknown request and one on the wrong frame type', async () => {
    const { a, b } = await createLinkPair()
    b.link.onFrame((_code, _payload, context) => {
      if (context.requestId === undefined) return PEER_UNHANDLED
      void b.link.send(6, { requestId: context.requestId, response: 'late' })
      return PEER_UNHANDLED
    })
    a.link.start()
    b.link.start()
    await b.link.send(5, { requestId: 'missing', response: 1 })
    await vi.waitFor(() => {
      expect(a.logs.some(line => line.includes('response for unknown request ignored'))).toBe(true)
    })
    await expect(a.link.request(5, { n: 1 }, 60)).rejects.toThrow(/timed out/u)
    expect(a.logs.some(line => line.includes('response on the wrong frame type ignored'))).toBe(true)
  })
})

describe('peer link write queue', () => {
  it('keeps the queue usable after one write fails', async () => {
    const [base, writer] = createMemoryStreamPair()
    let writes = 0
    const stream: PeerStream = {
      write: async (chunk) => {
        writes += 1
        if (writes === 1) throw new Error('write refused')
        await base.write(chunk)
      },
      readExact: length => base.readExact(length),
      finish: () => base.finish(),
    }
    const connection = new StubConnection()
    const harness = createLink(connection, stream)
    await expect(harness.link.send(5, { n: 1 })).rejects.toThrow('write refused')
    await harness.link.send(5, { n: 2 })
    await expect(readPeerFrame(writer, 64)).resolves.toEqual({ code: 5, payload: { n: 2 } })
  })

  it('rejects a payload the frame encoder refuses', async () => {
    const { harness } = createRawLink()
    const circular: Record<string, unknown> = {}
    circular.self = circular
    await expect(harness.link.send(5, circular)).rejects.toThrow(TypeError)
    await expect(harness.link.request(5, circular, 50)).rejects.toThrow(TypeError)

    const hostile = { toJSON: (): never => { throw 'bad payload' } }
    await expect(harness.link.send(5, hostile)).rejects.toThrow('bad payload')
    await expect(harness.link.request(5, hostile, 50)).rejects.toThrow('bad payload')
  })

  it('normalizes a non-Error write rejection for a waiting request', async () => {
    const [base] = createMemoryStreamPair()
    const stream: PeerStream = {
      write: () => { throw 'wire gone' },
      readExact: length => base.readExact(length),
      finish: () => base.finish(),
    }
    const connection = new StubConnection()
    const harness = createLink(connection, stream)
    await expect(harness.link.request(5, { n: 1 }, 50)).rejects.toThrow('wire gone')
  })

  it('closes even when the bye frame cannot be written', async () => {
    const [base] = createMemoryStreamPair()
    const stream: PeerStream = {
      write: () => Promise.reject(new Error('write refused')),
      readExact: length => base.readExact(length),
      finish: () => base.finish(),
    }
    const connection = new StubConnection()
    const harness = createLink(connection, stream)
    await harness.link.close('done')
    expect(connection.closeCalls).toEqual([{ code: 0n, reason: 'done' }])
  })

  it('closes the connection shortly after close() while a write to a stalled peer never completes', async () => {
    vi.useFakeTimers()
    cleanups.push(() => { vi.useRealTimers() })
    const [base] = createMemoryStreamPair()
    const stream: PeerStream = {
      write: () => new Promise<void>(() => undefined),
      readExact: length => base.readExact(length),
      finish: () => base.finish(),
    }
    const connection = new StubConnection()
    const harness = createLink(connection, stream)
    const stalled = harness.link.send(5, { n: 1 })
    stalled.catch(() => undefined)
    let closed = false
    const closing = harness.link.close('done', PEER_LINK_SYNC_TOO_LARGE_CLOSE_CODE).then(() => { closed = true })
    await vi.advanceTimersByTimeAsync(PEER_LINK_BYE_GRACE_MS - 1)
    expect(closed).toBe(false)
    expect(connection.closeCalls).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await closing
    expect(connection.closeCalls).toEqual([{ code: PEER_LINK_SYNC_TOO_LARGE_CLOSE_CODE, reason: 'done' }])
    await expect(harness.link.closed()).resolves.toContain('closed locally: done')
  })

  it('logs a best-effort send failure instead of rejecting', async () => {
    const [base] = createMemoryStreamPair()
    const stream: PeerStream = {
      write: () => Promise.reject(new Error('write refused')),
      readExact: length => base.readExact(length),
      finish: () => base.finish(),
    }
    const connection = new StubConnection()
    const harness = createLink(connection, stream)
    harness.link.trySend(5, { n: 1 })
    await vi.waitFor(() => {
      expect(harness.logs.some(line => line.includes('send failed'))).toBe(true)
    })
  })
})

describe('peer link binary frames and bounds', () => {
  it('carries raw bytes between two links without an envelope', async () => {
    const { a, b } = await createLinkPair()
    const seen: unknown[] = []
    b.link.onFrame((_code, payload) => { seen.push(payload); return undefined })
    a.link.start()
    b.link.start()
    const bytes = new Uint8Array([1, 2, 3])
    await a.link.send(PEER_FRAME_CODES['board.update'], bytes)
    await vi.waitFor(() => { expect(seen).toEqual([bytes]) })
    expect(a.logs).toEqual([])
  })

  it('refuses a JSON payload on a binary code without breaking the link', async () => {
    const { a, b } = await createLinkPair()
    const seen: unknown[] = []
    b.link.onFrame((_code, payload) => { seen.push(payload); return undefined })
    a.link.start()
    b.link.start()
    await expect(a.link.send(PEER_FRAME_CODES['board.update'], { n: 1 })).rejects.toThrow(/Uint8Array/u)
    expect(seen).toEqual([])
    await a.link.send(PEER_FRAME_CODES['board.update'], new Uint8Array([5]))
    await vi.waitFor(() => { expect(seen).toEqual([new Uint8Array([5])]) })
    expect(a.logs).toEqual([])
  })

  it('refuses a body over the frame bound before writing it', async () => {
    const { harness, writer } = createRawLink({ maxFrameBytes: 8 })
    await expect(harness.link.send(5, 'x'.repeat(32))).rejects.toThrow(/exceeds 8 bytes/u)
    await harness.link.send(5, { n: 1 })
    await expect(readPeerFrame(writer, 64)).resolves.toEqual({ code: 5, payload: { n: 1 } })
  })
})
