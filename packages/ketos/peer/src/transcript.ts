/**
 * The owner side of a foreign chat window's transcript: the
 * `chat.transcript.request` handler and the wire vocabulary both sides share.
 *
 * The Ketos that hosts a chat window decides alone whether the asking peer may
 * read it. The decision uses only this Ketos's own window record in the board
 * document and the identity the asking peer declared in its `hello`; nothing
 * in the request body can widen it. The request id travels in the channel's
 * request envelope, so the body carries the window id only, and the answer
 * rides the same frame code.
 * @module @ketos/peer/transcript
 */

import type { Context } from '@deepseek-ai/cordis'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { BoardSnapshot, BoardWindowRecord, OwnerId } from '@ketos/board-doc/types'
import { isWindowId } from '@ketos/board-doc/windows'
import { persistenceLogSource, readTranscript, type TranscriptLimits } from './transcript-read.ts'
import type { KetosPeerId, PeerState, TranscriptMessage } from './types.ts'

/** Largest `transcriptMaxMessages` an owner may configure. */
export const TRANSCRIPT_MESSAGES_MAX = 200

/** Largest `transcriptMaxMessageChars` an owner may configure. */
export const TRANSCRIPT_MESSAGE_CHARS_MAX = 100_000

/** Bytes the JSON encoding of one UTF-16 code unit can take at most (a `\uXXXX` escape). */
export const TRANSCRIPT_BYTES_PER_UNIT = 6

/** Bytes one transcript message adds beside its text: the response wrapper, the role, the time, and the punctuation. */
export const TRANSCRIPT_MESSAGE_OVERHEAD_BYTES = 256

/**
 * Bytes kept free in a frame beside the transcript response for the channel's
 * request envelope (`{ requestId, response }`), so a response within
 * `transcriptMaxBytes` always fits `maxFrameBytes`.
 */
export const TRANSCRIPT_ENVELOPE_RESERVE_BYTES = 1024

/** Body of a `chat.transcript.request` frame. */
export interface TranscriptWireRequest {
  /** The board window whose transcript the sender asks for. */
  readonly windowId: string
}

/** Why the owner Ketos did not answer with messages. */
export type TranscriptFailureReason = 'not-found' | 'closed' | 'unavailable'

/**
 * The owner Ketos's answer to a `chat.transcript.request`. `not-found` means
 * the window is not a chat window this Ketos hosts, `closed` that its access
 * does not admit the asker, and `unavailable` that the owner could not read
 * the session log; none of them carries free text.
 */
export type TranscriptWireResponse =
  | { readonly ok: true; readonly messages: readonly TranscriptMessage[] }
  | { readonly ok: false; readonly reason: TranscriptFailureReason }

declare module './frame.ts' {
  interface PeerFrameTypeMap {
    'chat.transcript.request': TranscriptWireRequest
    'chat.transcript.response': TranscriptWireResponse
  }
}

/** The members of the peer node the transcript handler uses; `KetosPeerService` provides them. */
export interface TranscriptPeer {
  /**
   * Register the handler for transcript requests.
   * @param type - the frame type.
   * @param handler - receives the request body and the sending peer.
   * @returns the unsubscribe function.
   */
  handle(type: 'chat.transcript.request', handler: (payload: unknown, from: KetosPeerId) => unknown): () => void
  /**
   * Every known peer with the identity it declared.
   * @returns the peers' ids and board participant ids.
   */
  peers(): readonly Pick<PeerState, 'peerId' | 'selfId'>[]
}

/** The part of the board document service the transcript handler reads. */
export interface TranscriptBoard {
  /**
   * Read the current document.
   * @returns this Ketos's identity and every window record.
   */
  snapshot(): Promise<Pick<BoardSnapshot, 'selfId' | 'windows'>>
}

/** Owner-side limits and log sink of the transcript handler. */
export interface TranscriptOptions extends TranscriptLimits {
  /** Receives one line per answer that could not be produced. */
  readonly logger: (message: string) => void
}

/** The answers that carry no messages. */
const NOT_FOUND = { ok: false, reason: 'not-found' } as const
const CLOSED = { ok: false, reason: 'closed' } as const
const UNAVAILABLE = { ok: false, reason: 'unavailable' } as const

/**
 * Validate a decoded request body at the wire boundary.
 * @param payload - the decoded `chat.transcript.request` body.
 * @returns the window id, or undefined unless the body is an object whose only field is a valid window id.
 */
export function parseTranscriptRequest(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined
  const source = payload as Record<string, unknown>
  const keys = Object.keys(source)
  if (keys.length !== 1 || keys[0] !== 'windowId') return undefined
  return isWindowId(source.windowId) ? source.windowId : undefined
}

/**
 * Validate one message of a transcript answer.
 * @param value - a decoded message.
 * @returns the message, or undefined when it is not exactly a role, a bounded text, and an ISO time.
 */
function parseTranscriptMessage(value: unknown): TranscriptMessage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  if (Object.keys(source).length !== 3) return undefined
  const { role, text, at } = source
  if (role !== 'user' && role !== 'agent') return undefined
  if (typeof text !== 'string' || text.length > TRANSCRIPT_MESSAGE_CHARS_MAX) return undefined
  if (typeof at !== 'string') return undefined
  const time = new Date(at)
  if (Number.isNaN(time.getTime()) || time.toISOString() !== at) return undefined
  return { role, text, at }
}

/**
 * Validate a decoded answer at the wire boundary. The peer's answer is data,
 * not a typed value: anything that is not exactly one of the forms below is
 * refused as a whole.
 * @param body - the decoded response body of a `chat.transcript.request`.
 * @returns the typed answer, or undefined when the body is malformed.
 */
export function parseTranscriptWireResponse(body: unknown): TranscriptWireResponse | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const source = body as Record<string, unknown>
  const keys = Object.keys(source)
  if (keys.length !== 2) return undefined
  if (source.ok === false) {
    const { reason } = source
    return reason === 'not-found' || reason === 'closed' || reason === 'unavailable' ? { ok: false, reason } : undefined
  }
  if (source.ok !== true || !Array.isArray(source.messages)) return undefined
  const rows: readonly unknown[] = source.messages
  if (rows.length > TRANSCRIPT_MESSAGES_MAX) return undefined
  const messages: TranscriptMessage[] = []
  for (const row of rows) {
    const message = parseTranscriptMessage(row)
    if (message === undefined) return undefined
    messages.push(message)
  }
  return { ok: true, messages }
}

/**
 * Whether a window's access admits a requester.
 * @param record - the window record of this Ketos.
 * @param requester - the board participant id the asking peer declared.
 * @returns whether the requester may read the transcript.
 */
function admits(record: BoardWindowRecord, requester: OwnerId): boolean {
  const { mode, people } = record.access
  switch (mode) {
    case 'all':
      return true
    case 'owner':
      return requester === record.ownerId
    case 'selected':
      // The client omits the owner from `people`, so the owner is admitted by identity.
      return requester === record.ownerId || people.includes(requester)
    default:
      return assertNever(mode)
  }
}

/**
 * Answer transcript requests for the chat windows this Ketos hosts. The
 * handler is an effect of the calling fiber, so disposing the plugin
 * withdraws it.
 * @param ctx - context carrying the optional session services.
 * @param peer - the peer node whose frames the handler serves.
 * @param board - the board document the window records come from.
 * @param options - answer limits and log sink.
 */
export function registerTranscript(
  ctx: Context,
  peer: TranscriptPeer,
  board: TranscriptBoard,
  options: TranscriptOptions,
): void {
  const answer = async (payload: unknown, from: KetosPeerId): Promise<TranscriptWireResponse> => {
    // A body that names no valid window addresses nothing; answering like an
    // unknown window keeps the reply free of the sender's own text.
    const windowId = parseTranscriptRequest(payload)
    if (windowId === undefined) return NOT_FOUND
    try {
      const { selfId, windows } = await board.snapshot()
      const record = windows.find(window => window.id === windowId)
      if (record === undefined || record.hostId !== selfId || record.kind !== 'agent' || record.sessionId === undefined) {
        return NOT_FOUND
      }
      const requester = peer.peers().find(state => state.peerId === from)
      if (requester === undefined || !admits(record, requester.selfId)) return CLOSED
      const source = persistenceLogSource(ctx)
      if (source === undefined) {
        options.logger(`ketos-peer: transcript of window ${windowId} unavailable: no session persistence service`)
        return UNAVAILABLE
      }
      return { ok: true, messages: await readTranscript(source, record.sessionId, options) }
    } catch (error: unknown) {
      options.logger(`ketos-peer: transcript of window ${windowId} unavailable: ${String(error)}`)
      return UNAVAILABLE
    }
  }
  ctx.effect(() => peer.handle('chat.transcript.request', answer), 'ketos-peer: transcript handler')
}
