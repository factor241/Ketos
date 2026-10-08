// The iroh transport on two real loopback endpoints: binding, the stable key
// identity, the ticket, one dial/accept round trip with a bidirectional
// stream, and the refusal paths around a node that is not bound, has no relay
// address, or is already closed.
import { afterEach, describe, expect, it } from 'vitest'
import { PEER_FRAME_CODES } from '../src/frame.ts'
import { createIrohTransport, generateSecretKey, PEER_ALPN, type IrohTransportOptions } from '../src/iroh-transport.ts'
import { readPeerFrame, writePeerFrame } from '../src/link.ts'
import type { PeerTransport } from '../src/transport.ts'

const transports: PeerTransport[] = []

afterEach(async () => {
  for (const transport of transports.reverse()) await transport.close()
  transports.length = 0
})

/**
 * Create and track one loopback transport.
 * @param options - transport options; the loopback bind and empty relay list
 * are the defaults this suite overrides when it needs them.
 * @returns the transport.
 */
async function loopback(options: Partial<IrohTransportOptions> & { key: Uint8Array }): Promise<PeerTransport> {
  const transport = await createIrohTransport({
    relayUrls: [],
    bindAddr: '127.0.0.1:0',
    ...options,
  })
  transports.push(transport)
  return transport
}

describe('iroh transport', () => {
  it('binds a node whose identity follows its stored key', async () => {
    const key = new Uint8Array(32).fill(7)
    const first = await loopback({ key })
    await first.bind()
    const identity = first.selfId()
    expect(String(identity)).not.toBe('')

    const second = await loopback({ key })
    await second.bind()
    expect(second.selfId()).toBe(identity)

    const generated = await generateSecretKey()
    expect(generated.byteLength).toBe(32)
  })

  it('binds every interface when no bind address is configured', async () => {
    const transport = await createIrohTransport({ relayUrls: [], key: new Uint8Array(32).fill(12) })
    transports.push(transport)
    await transport.bind()
    expect(String(transport.selfId())).not.toBe('')
  })

  it('refuses operations on a node that is not bound or already closed', async () => {
    const unbound = await loopback({ key: new Uint8Array(32).fill(1) })
    expect(() => unbound.selfId()).toThrow(/not bound/u)
    await expect(unbound.online()).rejects.toThrow(/not bound/u)
    expect(() => unbound.invitationTicket()).toThrow(/not bound/u)
    await expect(unbound.dial('endpointabc')).rejects.toThrow()
    await expect(unbound.accept()).rejects.toThrow(/not bound/u)

    const closed = await loopback({ key: new Uint8Array(32).fill(2) })
    await closed.bind()
    await closed.close()
    await closed.close()
    await expect(closed.bind()).rejects.toThrow(/closed/u)
    await expect(closed.accept()).rejects.toThrow(/closed/u)
  })

  it('requires a relay address for a ticket when relays are configured', async () => {
    const transport = await loopback({ key: new Uint8Array(32).fill(3), relayUrls: ['http://127.0.0.1:1'] })
    await transport.bind()
    expect(() => transport.invitationTicket()).toThrow(/relay address/u)
    expect(() => transport.ticketPeerId('not-a-ticket')).toThrow()
  })

  it('resolves online against a configured relay map', async () => {
    const transport = await loopback({ key: new Uint8Array(32).fill(11), relayUrls: ['http://127.0.0.1:1'] })
    await transport.bind()
    const outcome = await Promise.race([
      transport.online().then(() => 'online', () => 'failed'),
      new Promise<string>((resolve) => { setTimeout(() => { resolve('pending') }, 100) }),
    ])
    expect(['pending', 'failed']).toContain(outcome)
  })

  it('dials and accepts one connection with a bidirectional stream', async () => {
    const server = await loopback({ key: new Uint8Array(32).fill(4) })
    const client = await loopback({ key: new Uint8Array(32).fill(5), alpn: PEER_ALPN })
    await server.bind()
    await client.bind()

    const accepted = server.accept()
    const clientConnection = await client.dial(server.invitationTicket())
    const serverConnection = await accepted
    expect(serverConnection.peerId).toBe(client.selfId())
    expect(clientConnection.peerId).toBe(server.selfId())

    const clientStream = await clientConnection.openStream()
    const hello = { v: 1 as const, selfId: 'owner-a', name: 'Кирилл', color: 1 }
    await writePeerFrame(clientStream, PEER_FRAME_CODES.hello, hello)
    const serverStream = await serverConnection.acceptStream()
    await expect(readPeerFrame(serverStream, 1024)).resolves.toEqual({ code: PEER_FRAME_CODES.hello, payload: hello })

    const reply = { v: 1 as const, selfId: 'owner-b', name: 'Юрист', color: 2 }
    await writePeerFrame(serverStream, PEER_FRAME_CODES.hello, reply)
    await expect(readPeerFrame(clientStream, 1024)).resolves.toEqual({ code: PEER_FRAME_CODES.hello, payload: reply })
    await serverStream.finish()

    clientConnection.close(0n, 'done')
    await expect(serverConnection.closed()).resolves.toContain('done')
  })
})
