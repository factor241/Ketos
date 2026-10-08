/**
 * The peer channel's frame vocabulary: the `[u32 BE length][u8 code][data]`
 * wire shape, the code table with the reserved consumer types, the `hello`
 * and `bye` payloads, the request/response envelope, and the boundary
 * validation that refuses a `hello` no Ketos should accept.
 * @module @ketos/peer/frame
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { OwnerId } from '@ketos/board-doc/types'

/** Bytes of one frame header: a big-endian u32 length plus the u8 code. */
export const PEER_FRAME_HEADER_BYTES = 5

/**
 * Every frame code this channel reserves, by type name. Codes 3–7 belong to
 * the consumers of stages 33–35 and are listed here so one build's channel
 * recognizes them; a frame of a reserved type without a registered handler is
 * ignored with a log line.
 */
export const PEER_FRAME_CODES = {
  hello: 1,
  bye: 2,
  'board.sv': 3,
  'board.update': 4,
  'chat.transcript.request': 5,
  'chat.transcript.response': 6,
  'syncthing.device': 7,
} as const

/** Name of one reserved frame type. */
export type PeerFrameName = keyof typeof PEER_FRAME_CODES

/** The `hello` frame: the dialer's introduction, answered by the receiver. */
export interface PeerHelloPayload {
  /** Protocol version of the channel; this build speaks 1. */
  readonly v: 1
  /** The sender's board participant id. */
  readonly selfId: OwnerId
  /** The sender's participant name. */
  readonly name: string
  /** The sender's palette color, 1–10. */
  readonly color: number
  /**
   * Present when the dialer arrived through a `ketos1.…` invitation code: the
   * one-time secret the receiver consumes to admit an unknown node.
   */
  readonly invite?: string
}

/** The `bye` frame: a regular close with a short reason. */
export interface PeerByePayload {
  /** Short reason text; never carries user data. */
  readonly reason: string
}

/**
 * Frame payloads by type name. Consumers of stages 33–35 merge their own
 * entries through declaration merging; `send` and `request` accept exactly
 * the names this map knows.
 */
export interface PeerFrameTypeMap {
  hello: PeerHelloPayload
  bye: PeerByePayload
}

/** Name of one frame type this build can send. */
export type PeerFrameType = keyof PeerFrameTypeMap

/** A wire frame this channel refuses to process. */
export class PeerFrameError extends Error {
  /**
   * @param reason - what the frame got wrong.
   */
  constructor(reason: string) {
    super(reason)
    this.name = 'PeerFrameError'
  }
}

/** One classified frame payload. */
export type PeerEnvelope =
  | { readonly kind: 'message' }
  | { readonly kind: 'request'; readonly requestId: string; readonly body: unknown }
  | { readonly kind: 'response'; readonly requestId: string; readonly body: unknown }
  | { readonly kind: 'error'; readonly requestId: string; readonly message: string }

/**
 * The code one named frame type carries.
 * @param type - frame type name.
 * @returns the wire code.
 */
export function frameCodeFor(type: PeerFrameType): number {
  const code = (PEER_FRAME_CODES as Readonly<Record<string, number>>)[type]
  if (code === undefined) throw new PeerFrameError(`unknown frame type ${JSON.stringify(type)}`)
  return code
}

/**
 * The reserved name one wire code carries.
 * @param code - wire code.
 * @returns the name, or undefined for a code this build does not reserve.
 */
export function frameNameFor(code: number): PeerFrameName | undefined {
  for (const [name, value] of Object.entries(PEER_FRAME_CODES)) {
    if (value === code) return name as PeerFrameName
  }
  return undefined
}

/**
 * Encode one frame: a big-endian u32 length, the u8 code, then the JSON body.
 * @param code - wire code.
 * @param payload - JSON-serializable payload.
 * @returns the encoded frame.
 */
export function encodePeerFrame(code: number, payload: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(payload))
  const frame = new Uint8Array(PEER_FRAME_HEADER_BYTES + body.byteLength)
  new DataView(frame.buffer).setUint32(0, body.byteLength)
  frame[4] = code
  frame.set(body, PEER_FRAME_HEADER_BYTES)
  return frame
}

/**
 * Parse one frame header.
 * @param header - exactly {@link PEER_FRAME_HEADER_BYTES} bytes.
 * @returns the body length and the wire code.
 */
export function parsePeerFrameHeader(header: Uint8Array): { length: number; code: number } {
  if (header.byteLength !== PEER_FRAME_HEADER_BYTES) {
    throw new PeerFrameError(`frame header must be ${String(PEER_FRAME_HEADER_BYTES)} bytes`)
  }
  return {
    length: new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(0),
    code: header[4] as number,
  }
}

/**
 * Parse one frame body as JSON.
 * @param bytes - the body of exactly the header's declared length.
 * @returns the decoded JSON value.
 */
export function parsePeerFramePayload(bytes: Uint8Array): unknown {
  const text = new TextDecoder().decode(bytes)
  try {
    return JSON.parse(text)
  } catch {
    throw new PeerFrameError('frame body is not JSON')
  }
}

/**
 * Classify one decoded payload as a plain message or a request/response
 * envelope. Only an object with a string `requestId` and exactly one of the
 * `request`/`response`/`error` markers is an envelope; anything else is a
 * plain message payload.
 * @param payload - decoded frame payload.
 * @returns the classification.
 */
export function classifyPeerPayload(payload: unknown): PeerEnvelope {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return { kind: 'message' }
  const source = payload as Record<string, unknown>
  if (typeof source.requestId !== 'string' || source.requestId === '') return { kind: 'message' }
  const markers = (['request', 'response', 'error'] as const).filter(marker => Object.hasOwn(source, marker))
  if (markers.length !== 1) throw new PeerFrameError('envelope must carry exactly one of request, response, error')
  const id = source.requestId
  const marker = markers[0] as 'request' | 'response' | 'error'
  if (marker === 'request') return { kind: 'request', requestId: id, body: source.request }
  if (marker === 'response') return { kind: 'response', requestId: id, body: source.response }
  if (typeof source.error !== 'string') throw new PeerFrameError('envelope error must be a string')
  return { kind: 'error', requestId: id, message: source.error }
}

/** Fields one `hello` payload may carry; any other field refuses it. */
const HELLO_FIELDS: readonly string[] = ['v', 'selfId', 'name', 'color', 'invite']

/** Largest participant name and owner id accepted in a `hello`. */
export const PEER_NAME_MAX = 64

/** Smallest color of the palette. */
export const PEER_COLOR_MIN = 1

/** Largest color of the palette. */
export const PEER_COLOR_MAX = 10

/**
 * Validate one decoded `hello` payload at the wire boundary.
 * @param payload - decoded frame payload.
 * @returns the typed `hello`.
 */
export function parseHelloPayload(payload: unknown): PeerHelloPayload {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new PeerFrameError('hello must be a JSON object')
  }
  const source = payload as Record<string, unknown>
  for (const key of Object.keys(source)) {
    if (!HELLO_FIELDS.includes(key)) throw new PeerFrameError(`hello carries unknown field ${JSON.stringify(key)}`)
  }
  if (source.v !== 1) throw new PeerFrameError('hello version must be 1')
  if (typeof source.selfId !== 'string' || source.selfId.length === 0 || source.selfId.length > PEER_NAME_MAX) {
    throw new PeerFrameError('hello selfId must be a non-empty string of at most 64 characters')
  }
  if (typeof source.name !== 'string' || source.name.length === 0 || source.name.length > PEER_NAME_MAX) {
    throw new PeerFrameError('hello name must be a non-empty string of at most 64 characters')
  }
  if (
    typeof source.color !== 'number'
    || !Number.isInteger(source.color)
    || source.color < PEER_COLOR_MIN
    || source.color > PEER_COLOR_MAX
  ) {
    throw new PeerFrameError('hello color must be an integer from 1 to 10')
  }
  if (source.invite !== undefined && (typeof source.invite !== 'string' || source.invite.length === 0)) {
    throw new PeerFrameError('hello invite must be a non-empty string when present')
  }
  return {
    v: 1,
    selfId: brandString<OwnerId>(source.selfId),
    name: source.name,
    color: source.color,
    ...source.invite === undefined ? {} : { invite: source.invite },
  }
}

/**
 * Validate one decoded `bye` payload at the wire boundary.
 * @param payload - decoded frame payload.
 * @returns the typed `bye`.
 */
export function parseByePayload(payload: unknown): PeerByePayload {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new PeerFrameError('bye must be a JSON object')
  }
  const source = payload as Record<string, unknown>
  if (typeof source.reason !== 'string') throw new PeerFrameError('bye reason must be a string')
  return { reason: source.reason }
}
