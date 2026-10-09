// The in-memory transport: the raw stream pair, the bind/dial/accept
// lifecycle, ticket resolution, queued and waiting accepts on both the
// transport and a connection, and the close paths that release waiters.
import { describe, expect, it } from 'vitest'
import { createMemoryStreamPair, createMemoryTransports } from '../src/memory-transport.ts'
import type { PeerConnection, PeerTransport } from '../src/transport.ts'

/**
 * Encode text for a stream assertion.
 * @param text - the text to encode.
 * @returns its UTF-8 bytes.
 */
function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/**
 * Accept the next incoming connection and complete its handshake.
 * @param transport - the receiving endpoint.
 * @returns the open connection.
 */
async function acceptConnection(transport: PeerTransport): Promise<PeerConnection> {
  return (await transport.accept()).complete()
}

describe('memory stream pair', () => {
  it('round-trips bytes in both directions', async () => {
    const [a, b] = createMemoryStreamPair()
    await a.write(bytes('ping'))
    await expect(b.readExact(4)).resolves.toEqual(bytes('ping'))
    await b.write(bytes('pong'))
    await expect(a.readExact(4)).resolves.toEqual(bytes('pong'))
  })

  it('waits for a split write and joins chunks', async () => {
    const [a, b] = createMemoryStreamPair()
    const read = b.readExact(4)
    await a.write(bytes('pi'))
    await a.write(bytes('ng'))
    await expect(read).resolves.toEqual(bytes('ping'))
  })

  it('splits one buffered chunk across reads', async () => {
    const [a, b] = createMemoryStreamPair()
    await a.write(bytes('pingpong'))
    await expect(b.readExact(4)).resolves.toEqual(bytes('ping'))
    await expect(b.readExact(4)).resolves.toEqual(bytes('pong'))
  })

  it('treats an empty write as a no-op and ends the readable half with finish', async () => {
    const [a, b] = createMemoryStreamPair()
    await a.write(new Uint8Array(0))
    await a.finish()
    await expect(b.readExact(2)).rejects.toThrow(/ended before 2 bytes/u)
  })

  it('fails a waiting read when the writer finishes without data', async () => {
    const [a, b] = createMemoryStreamPair()
    const read = b.readExact(3)
    await a.finish()
    await expect(read).rejects.toThrow(/ended before 3 bytes/u)
  })

  it('refuses a write after finish', async () => {
    const [a] = createMemoryStreamPair()
    await a.finish()
    await expect(a.write(bytes('x'))).rejects.toThrow(/already finished/u)
  })
})

describe('memory endpoint lifecycle', () => {
  it('requires bind before online and the invitation ticket', async () => {
    const { a, b } = createMemoryTransports()
    expect(String(a.selfId())).toMatch(/^memory-a-/u)
    expect(String(b.selfId())).toMatch(/^memory-b-/u)
    await expect(a.online()).rejects.toThrow(/not bound/u)
    expect(() => a.invitationTicket()).toThrow(/not bound/u)
    await a.bind()
    await b.bind()
    await a.online()
    expect(a.invitationTicket()).toMatch(/^memory:<a-/u)
    expect(b.invitationTicket()).toMatch(/^memory:<b-/u)
    expect(a.invitationTicket()).not.toBe(b.invitationTicket())
  })

  it('resolves its own ticket, the peer ticket, and refuses an unknown one', async () => {
    const { a, b } = createMemoryTransports()
    await a.bind()
    await b.bind()
    expect(a.ticketPeerId(a.invitationTicket())).toBe(a.selfId())
    expect(a.ticketPeerId(b.invitationTicket())).toBe(b.selfId())
    expect(() => a.ticketPeerId('memory:<nobody>')).toThrow(/unknown peer ticket/u)
  })

  it('refuses dial with an unknown ticket and every use of a closed endpoint', async () => {
    const { a, b } = createMemoryTransports()
    await a.bind()
    await b.bind()
    await expect(a.dial('memory:<nobody>')).rejects.toThrow(/unknown peer ticket/u)
    await a.close()
    await expect(a.dial(b.invitationTicket())).rejects.toThrow(/closed/u)
    await expect(a.accept()).rejects.toThrow(/closed/u)
    await expect(a.bind()).rejects.toThrow(/closed/u)
    await a.close()
  })

  it('rejects a waiting accept when the endpoint closes', async () => {
    const { a } = createMemoryTransports()
    await a.bind()
    const pending = a.accept()
    await a.close()
    await expect(pending).rejects.toThrow(/closed/u)
  })

  it('hands a dialed connection to a waiting accept and queues one for a later accept', async () => {
    const pair = createMemoryTransports()
    await pair.a.bind()
    await pair.b.bind()

    const waiting = pair.b.accept()
    const dialer = await pair.a.dial(pair.b.invitationTicket())
    const accepted = await (await waiting).complete()
    expect(accepted.peerId).toBe(pair.a.selfId())
    expect(dialer.peerId).toBe(pair.b.selfId())

    const second = await pair.a.dial(pair.b.invitationTicket())
    const queued = await acceptConnection(pair.b)
    expect(queued.peerId).toBe(pair.a.selfId())

    second.close(0n, 'done')
    dialer.close(0n, 'done')
    queued.close(0n, 'done')
    accepted.close(0n, 'done')
    await pair.a.close()
    await pair.b.close()
  })

  it('drops open connections on both ends without closing the endpoints', async () => {
    const pair = createMemoryTransports()
    await pair.a.bind()
    await pair.b.bind()
    const connectionA = await pair.a.dial(pair.b.invitationTicket())
    const connectionB = await acceptConnection(pair.b)

    pair.dropConnections()
    await expect(connectionA.closed()).resolves.toBe('transport closed')
    await expect(connectionB.closed()).resolves.toContain('transport closed')

    const redialed = await pair.a.dial(pair.b.invitationTicket())
    await expect(pair.b.accept()).resolves.toBeDefined()
    redialed.close(0n, 'done')
    await pair.a.close()
    await pair.b.close()
  })

  it('closes every connection when the endpoint closes', async () => {
    const pair = createMemoryTransports()
    await pair.a.bind()
    await pair.b.bind()
    const connectionA = await pair.a.dial(pair.b.invitationTicket())
    const connectionB = await acceptConnection(pair.b)

    await pair.b.close()
    await expect(connectionB.closed()).resolves.toBe('transport closed')
    await expect(connectionA.closed()).resolves.toContain('closed by peer')
    await pair.a.close()
  })
})

describe('memory connection streams', () => {
  it('queues a stream opened before acceptStream and resolves a waiting one', async () => {
    const pair = createMemoryTransports()
    await pair.a.bind()
    await pair.b.bind()
    const dialer = await pair.a.dial(pair.b.invitationTicket())
    const acceptor = await acceptConnection(pair.b)

    const first = await dialer.openStream()
    const acceptedFirst = await acceptor.acceptStream()
    await first.write(bytes('one'))
    await expect(acceptedFirst.readExact(3)).resolves.toEqual(bytes('one'))

    const waiting = acceptor.acceptStream()
    const second = await dialer.openStream()
    const acceptedSecond = await waiting
    await second.write(bytes('two'))
    await expect(acceptedSecond.readExact(3)).resolves.toEqual(bytes('two'))
    await pair.a.close()
  })

  it('rejects a waiting stream and later opens when the connection ends', async () => {
    const pair = createMemoryTransports()
    await pair.a.bind()
    await pair.b.bind()
    const dialer = await pair.a.dial(pair.b.invitationTicket())
    const acceptor = await acceptConnection(pair.b)

    const streamWait = acceptor.acceptStream()
    const closed = acceptor.closed()
    dialer.close(1n, 'done')
    await expect(streamWait).rejects.toThrow(/closed by peer/u)
    await expect(closed).resolves.toContain('closed by peer')
    await expect(acceptor.openStream()).rejects.toThrow(/closed/u)
    await expect(acceptor.acceptStream()).rejects.toThrow(/closed/u)
    await expect(acceptor.closed()).resolves.toContain('closed by peer')
  })
})
