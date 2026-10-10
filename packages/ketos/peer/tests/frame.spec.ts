// The frame vocabulary: the header shape, JSON body round trip, the reserved
// code table, the envelope classification, the per-code body bound, and the
// boundary validation of `hello`, `bye`, and the heartbeat frames.
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OwnerId } from '@ketos/board-doc/types'
import {
  PEER_FRAME_CODES, PEER_FRAME_HEADER_BYTES, PEER_HEARTBEAT_MAX_BYTES, PEER_PROTOCOL_VERSION, PeerFrameError,
  classifyPeerPayload, encodePeerFrame, frameCodeFor, frameNameFor, parseByePayload, parseHeartbeatPayload,
  parseHelloPayload, parsePeerFrameHeader, parsePeerFramePayload, peerFrameBodyLimit,
} from '../src/frame.ts'

// A consumer of a later stage merges its type into the map; a name without a
// reserved code must still refuse to encode.
declare module '../src/frame.ts' {
  interface PeerFrameTypeMap {
    'test.unreserved': { readonly n: number }
  }
}

const owner = brandString<OwnerId>('owner-a')

describe('peer frame encoding', () => {
  it('round-trips a payload through the length-prefixed frame', () => {
    const frame = encodePeerFrame(PEER_FRAME_CODES.hello, { a: 1 })
    expect(frame.byteLength).toBe(PEER_FRAME_HEADER_BYTES + 7)
    const header = frame.subarray(0, PEER_FRAME_HEADER_BYTES)
    expect(parsePeerFrameHeader(header)).toEqual({ length: 7, code: 1 })
    expect(parsePeerFramePayload(1, frame.subarray(PEER_FRAME_HEADER_BYTES))).toEqual({ a: 1 })
  })

  it('round-trips a binary body verbatim and refuses a JSON or empty one', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const frame = encodePeerFrame(PEER_FRAME_CODES['board.update'], bytes)
    expect(parsePeerFrameHeader(frame.subarray(0, PEER_FRAME_HEADER_BYTES)))
      .toEqual({ length: 4, code: PEER_FRAME_CODES['board.update'] })
    expect(parsePeerFramePayload(PEER_FRAME_CODES['board.update'], frame.subarray(PEER_FRAME_HEADER_BYTES)))
      .toEqual(bytes)
    expect(() => encodePeerFrame(PEER_FRAME_CODES['board.sv'], { requestId: 'r1' })).toThrow(/must be a Uint8Array/u)
    expect(() => encodePeerFrame(PEER_FRAME_CODES['board.sv'], new Uint8Array(0))).toThrow(/must not be empty/u)
    expect(() => parsePeerFramePayload(PEER_FRAME_CODES['board.sv'], new Uint8Array(0))).toThrow(/must not be empty/u)
  })

  it('refuses a JSON object or array as a binary body', () => {
    const text = (value: string): Uint8Array => new TextEncoder().encode(value)
    for (const code of [PEER_FRAME_CODES['board.sv'], PEER_FRAME_CODES['board.update']]) {
      expect(() => parsePeerFramePayload(code, text('{"0":1,"1":2}'))).toThrow(/must not be JSON/u)
      expect(() => parsePeerFramePayload(code, text('[1,2]'))).toThrow(/must not be JSON/u)
    }
    // Bytes that only start like JSON, and scalars, are ordinary update bytes.
    expect(parsePeerFramePayload(PEER_FRAME_CODES['board.update'], text('{nope'))).toEqual(text('{nope'))
    expect(parsePeerFramePayload(PEER_FRAME_CODES['board.update'], text('5'))).toEqual(text('5'))
  })

  it('speaks protocol version 3', () => {
    expect(PEER_PROTOCOL_VERSION).toBe(3)
  })

  it('writes the length big-endian', () => {
    const frame = encodePeerFrame(1, 'x'.repeat(300))
    expect([...frame.subarray(0, 4)]).toEqual([0, 0, 1, 46])
  })

  it('refuses a header of the wrong size and a non-JSON body', () => {
    expect(() => parsePeerFrameHeader(new Uint8Array(4))).toThrow(PeerFrameError)
    expect(() => parsePeerFramePayload(PEER_FRAME_CODES.hello, new TextEncoder().encode('not json'))).toThrow(/not JSON/u)
  })

  it('reserves the consumer codes 3 to 7 and the heartbeat codes 8 and 9', () => {
    expect(frameCodeFor('hello')).toBe(1)
    expect(frameCodeFor('bye')).toBe(2)
    expect(frameNameFor(3)).toBe('board.sv')
    expect(frameNameFor(4)).toBe('board.update')
    expect(frameNameFor(5)).toBe('chat.transcript.request')
    expect(frameNameFor(6)).toBe('chat.transcript.response')
    expect(frameNameFor(7)).toBe('syncthing.device')
    expect(frameCodeFor('peer.ping')).toBe(8)
    expect(frameCodeFor('peer.pong')).toBe(9)
    expect(frameNameFor(10)).toBeUndefined()
    expect((PEER_FRAME_CODES as Readonly<Record<string, number>>)['board.sv']).toBe(3)
  })

  it('bounds a heartbeat body far below the frame bound and leaves every other code at it', () => {
    expect(PEER_HEARTBEAT_MAX_BYTES).toBe(16)
    expect(peerFrameBodyLimit(PEER_FRAME_CODES['peer.ping'], 1_000_000)).toBe(16)
    expect(peerFrameBodyLimit(PEER_FRAME_CODES['peer.pong'], 1_000_000)).toBe(16)
    expect(peerFrameBodyLimit(PEER_FRAME_CODES['peer.ping'], 8)).toBe(8)
    expect(peerFrameBodyLimit(PEER_FRAME_CODES['board.update'], 1_000_000)).toBe(1_000_000)
    expect(peerFrameBodyLimit(PEER_FRAME_CODES.hello, 4096)).toBe(4096)
  })

  it('refuses a merged frame type without a reserved code', () => {
    expect(() => frameCodeFor('test.unreserved')).toThrow(/unknown frame type/u)
  })
})

describe('peer envelope classification', () => {
  it('treats plain payloads as messages', () => {
    expect(classifyPeerPayload({ x: 1 })).toEqual({ kind: 'message' })
    expect(classifyPeerPayload(null)).toEqual({ kind: 'message' })
    expect(classifyPeerPayload({ requestId: 5 })).toEqual({ kind: 'message' })
  })

  it('classifies request, response, and error envelopes', () => {
    expect(classifyPeerPayload({ requestId: 'r1', request: { a: 1 } }))
      .toEqual({ kind: 'request', requestId: 'r1', body: { a: 1 } })
    expect(classifyPeerPayload({ requestId: 'r1', response: 7 }))
      .toEqual({ kind: 'response', requestId: 'r1', body: 7 })
    expect(classifyPeerPayload({ requestId: 'r1', error: 'nope' }))
      .toEqual({ kind: 'error', requestId: 'r1', message: 'nope' })
  })

  it('refuses an envelope with two markers or a non-string error', () => {
    expect(() => classifyPeerPayload({ requestId: 'r1', request: 1, response: 2 })).toThrow(PeerFrameError)
    expect(() => classifyPeerPayload({ requestId: 'r1', error: 5 })).toThrow(/must be a string/u)
  })
})

describe('hello and bye validation', () => {
  it('accepts a minimal hello and one with an invite', () => {
    expect(parseHelloPayload({ v: 3, selfId: 'owner-a', name: 'Kirill', color: 3 }))
      .toEqual({ v: 3, selfId: owner, name: 'Kirill', color: 3 })
    expect(parseHelloPayload({ v: 3, selfId: 'owner-a', name: 'Kirill', color: 3, invite: 'secret' }))
      .toEqual({ v: 3, selfId: 'owner-a', name: 'Kirill', color: 3, invite: 'secret' })
  })

  it('refuses a hello of protocol version 2 or 1', () => {
    expect(() => parseHelloPayload({ v: 2, selfId: 'owner-a', name: 'Kirill', color: 3 })).toThrow(/hello version must be 3/u)
    expect(() => parseHelloPayload({ v: 1, selfId: 'owner-a', name: 'Kirill', color: 3 })).toThrow(/hello version must be 3/u)
  })

  it('refuses malformed hello payloads', () => {
    const cases: unknown[] = [
      null,
      [],
      { v: 2, selfId: 'owner-a', name: 'n', color: 1 },
      { v: 99, selfId: 'owner-a', name: 'n', color: 1 },
      { v: 3, selfId: '', name: 'n', color: 1 },
      { v: 3, selfId: 'a'.repeat(65), name: 'n', color: 1 },
      { v: 3, selfId: 'a', name: '', color: 1 },
      { v: 3, selfId: 'a', name: 'n', color: 0 },
      { v: 3, selfId: 'a', name: 'n', color: 1.5 },
      { v: 3, selfId: 'a', name: 'n', color: 11 },
      { v: 3, selfId: 'a', name: 'n', color: 1, invite: '' },
      { v: 3, selfId: 'a', name: 'n', color: 1, extra: true },
    ]
    for (const value of cases) expect(() => parseHelloPayload(value)).toThrow(PeerFrameError)
  })

  it('validates bye payloads', () => {
    expect(parseByePayload({ reason: 'done' })).toEqual({ reason: 'done' })
    expect(() => parseByePayload({})).toThrow(PeerFrameError)
    expect(() => parseByePayload([1])).toThrow(PeerFrameError)
  })

  it('accepts only the empty JSON object as a heartbeat body', () => {
    expect(parseHeartbeatPayload({})).toEqual({})
    for (const value of [null, [], 'ping', 1, { seq: 1 }, { requestId: 'r1', request: {} }]) {
      expect(() => parseHeartbeatPayload(value)).toThrow(/heartbeat body must be an empty JSON object/u)
    }
  })
})

describe('peer frame type extensions in specs', () => {
  it('never merge a name this package reserves for a later stage into PeerFrameTypeMap', async () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const reserved = Object.keys(PEER_FRAME_CODES)
    const violations: string[] = []
    for (const entry of await readdir(here)) {
      if (!entry.endsWith('.ts')) continue
      const text = await readFile(join(here, entry), 'utf8')
      for (const block of text.matchAll(/interface PeerFrameTypeMap\s*\{([^}]*)\}/gu)) {
        for (const name of reserved) {
          if ((block[1] as string).includes(`'${name}'`)) violations.push(`${entry}: ${name}`)
        }
      }
    }
    expect(violations).toEqual([])
  })
})
