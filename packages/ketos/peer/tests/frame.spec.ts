// The frame vocabulary: the header shape, JSON body round trip, the reserved
// code table, the envelope classification, and the boundary validation of
// `hello` and `bye`.
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OwnerId } from '@ketos/board-doc/types'
import {
  PEER_FRAME_CODES, PEER_FRAME_HEADER_BYTES, PEER_PROTOCOL_VERSION, PeerFrameError, classifyPeerPayload, encodePeerFrame,
  frameCodeFor, frameNameFor, parseByePayload, parseHelloPayload, parsePeerFrameHeader,
  parsePeerFramePayload,
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

  it('speaks protocol version 2', () => {
    expect(PEER_PROTOCOL_VERSION).toBe(2)
  })

  it('writes the length big-endian', () => {
    const frame = encodePeerFrame(1, 'x'.repeat(300))
    expect([...frame.subarray(0, 4)]).toEqual([0, 0, 1, 46])
  })

  it('refuses a header of the wrong size and a non-JSON body', () => {
    expect(() => parsePeerFrameHeader(new Uint8Array(4))).toThrow(PeerFrameError)
    expect(() => parsePeerFramePayload(PEER_FRAME_CODES.hello, new TextEncoder().encode('not json'))).toThrow(/not JSON/u)
  })

  it('reserves the consumer codes 3 to 7', () => {
    expect(frameCodeFor('hello')).toBe(1)
    expect(frameCodeFor('bye')).toBe(2)
    expect(frameNameFor(3)).toBe('board.sv')
    expect(frameNameFor(4)).toBe('board.update')
    expect(frameNameFor(5)).toBe('chat.transcript.request')
    expect(frameNameFor(6)).toBe('chat.transcript.response')
    expect(frameNameFor(7)).toBe('syncthing.device')
    expect(frameNameFor(9)).toBeUndefined()
    expect((PEER_FRAME_CODES as Readonly<Record<string, number>>)['board.sv']).toBe(3)
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
    expect(parseHelloPayload({ v: 2, selfId: 'owner-a', name: 'Kirill', color: 3 }))
      .toEqual({ v: 2, selfId: owner, name: 'Kirill', color: 3 })
    expect(parseHelloPayload({ v: 2, selfId: 'owner-a', name: 'Kirill', color: 3, invite: 'secret' }))
      .toEqual({ v: 2, selfId: 'owner-a', name: 'Kirill', color: 3, invite: 'secret' })
  })

  it('refuses malformed hello payloads', () => {
    const cases: unknown[] = [
      null,
      [],
      { v: 1, selfId: 'owner-a', name: 'n', color: 1 },
      { v: 99, selfId: 'owner-a', name: 'n', color: 1 },
      { v: 2, selfId: '', name: 'n', color: 1 },
      { v: 2, selfId: 'a'.repeat(65), name: 'n', color: 1 },
      { v: 2, selfId: 'a', name: '', color: 1 },
      { v: 2, selfId: 'a', name: 'n', color: 0 },
      { v: 2, selfId: 'a', name: 'n', color: 1.5 },
      { v: 2, selfId: 'a', name: 'n', color: 11 },
      { v: 2, selfId: 'a', name: 'n', color: 1, invite: '' },
      { v: 2, selfId: 'a', name: 'n', color: 1, extra: true },
    ]
    for (const value of cases) expect(() => parseHelloPayload(value)).toThrow(PeerFrameError)
  })

  it('validates bye payloads', () => {
    expect(parseByePayload({ reason: 'done' })).toEqual({ reason: 'done' })
    expect(() => parseByePayload({})).toThrow(PeerFrameError)
    expect(() => parseByePayload([1])).toThrow(PeerFrameError)
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
