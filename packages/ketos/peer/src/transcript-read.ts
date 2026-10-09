/**
 * Reading a chat transcript out of a stored session log: which events are
 * messages, the three limits on the answer, and the access to the log through
 * `ctx.sessionPersistence`.
 *
 * Only human prompts (`user/message` with `source.kind: 'user'`) and assistant
 * steps (`assistant/message`) contribute, and only their `text` blocks:
 * reasoning, tool calls and results, images, files, injected context, and
 * system or developer messages never leave the Ketos that owns the log.
 * @module @ketos/peer/transcript-read
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import type { WindowSessionId } from '@ketos/board-doc/types'
import type { TranscriptMessage } from './types.ts'

/**
 * Events read per persistence call. It bounds the transcript text this module
 * retains, not the backend's memory: the JSONL backend decodes the whole log
 * for each read, memoised only while the file revision is unchanged.
 */
const READ_SLICE = 500

/** Bytes of the response wrapper `{"ok":true,"messages":[]}` around the message array. */
const RESPONSE_WRAPPER_BYTES = new TextEncoder().encode('{"ok":true,"messages":[]}').byteLength

/** Separator written between two messages of the array. */
const MESSAGE_SEPARATOR_BYTES = 1

/** Paragraph break joined between the text blocks of one message. */
const BLOCK_SEPARATOR = '\n\n'

/** One stored session event as the persistence handle returns it. */
export interface TranscriptLogEvent {
  /** Event type, for example `user/message`. */
  readonly type: string
  /** Time the event was recorded, in milliseconds since the Unix epoch. */
  readonly time: number
  /** Where the event entered the model-visible surface; `'append'` marks original conversation. */
  readonly surfaceOp?: unknown
  /** Type-specific payload; validated here before use. */
  readonly data: unknown
}

/** The members of a persistence read handle the transcript reader uses. */
export interface TranscriptLogHandle {
  /**
   * Read a slice of the validated, contiguous log.
   * @param offset - first event sequence number to include.
   * @param length - maximum number of events to return.
   * @returns the slice; empty at or past the end of the log.
   */
  read(offset: number, length: number): Promise<{ readonly events: readonly TranscriptLogEvent[] }>
  /**
   * Release the handle.
   * @returns a promise settling when the handle is closed.
   */
  close(): Promise<void>
}

/** Where the reader gets a session's log from. */
export interface TranscriptLogSource {
  /**
   * Open one stored session for reading.
   * @param sessionId - the session a chat window shows.
   * @returns a read handle the caller closes.
   */
  open(sessionId: WindowSessionId): Promise<TranscriptLogHandle>
}

/** Owner-side limits of one transcript answer. */
export interface TranscriptLimits {
  /** Most messages returned; the latest ones are kept. */
  readonly maxMessages: number
  /** Most UTF-16 code units of one message's text. */
  readonly maxMessageChars: number
  /** Most bytes of the JSON response `{ ok: true, messages }`. */
  readonly maxBytes: number
}

/**
 * Cut a text to a number of UTF-16 code units without splitting a surrogate pair.
 * @param text - the text to cut.
 * @param maxChars - most code units to keep.
 * @returns the text itself when it fits, otherwise its well-formed prefix.
 */
function cutText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const last = text.charCodeAt(maxChars - 1)
  const isHighSurrogate = last >= 0xd800 && last <= 0xdbff
  return text.slice(0, isHighSurrogate ? maxChars - 1 : maxChars)
}

/**
 * The text of a content array: its `text` blocks joined by a paragraph break.
 * @param content - the message's content, unvalidated.
 * @returns the text, or undefined when the content holds no non-blank text.
 */
function textOf(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  const blocks: readonly unknown[] = content
  const texts: string[] = []
  for (const block of blocks) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
  }
  const joined = texts.join(BLOCK_SEPARATOR)
  return joined.trim() === '' ? undefined : joined
}

/**
 * Whether a value is a plain object.
 * @param value - any decoded value.
 * @returns whether the value can be read by field name.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * The transcript message one event contributes.
 * @param event - one stored event.
 * @param maxChars - per-message text limit.
 * @returns the message, or undefined when the event contributes none.
 */
function messageOf(event: TranscriptLogEvent, maxChars: number): TranscriptMessage | undefined {
  // A replacement copy shadows a range of earlier messages for the model; the
  // human transcript shows the originals that appended to the surface.
  if (event.surfaceOp !== 'append') return undefined
  const { data } = event
  let role: TranscriptMessage['role']
  let content: unknown
  if (event.type === 'user/message') {
    // The event data is the message itself; only a human prompt counts, not
    // the context other producers inject with the same role.
    if (!isRecord(data) || !isRecord(data.source) || data.source.kind !== 'user') return undefined
    role = 'user'
    content = data.content
  } else if (event.type === 'assistant/message') {
    if (!isRecord(data) || !isRecord(data.message)) return undefined
    role = 'agent'
    content = data.message.content
  } else {
    return undefined
  }
  const whole = textOf(content)
  if (whole === undefined) return undefined
  // The cut can leave nothing visible, for example a leading astral character
  // under a limit of one unit.
  const text = cutText(whole, maxChars)
  if (text.trim() === '') return undefined
  const time = new Date(event.time)
  if (Number.isNaN(time.getTime())) return undefined
  return { role, text, at: time.toISOString() }
}

/**
 * Drop the oldest messages until the JSON response `{ ok: true, messages }`
 * fits the byte limit. A single message that does not fit alone is dropped too.
 * @param messages - messages oldest first.
 * @param maxBytes - byte limit of the whole response.
 * @returns the newest messages that fit.
 */
function fitBytes(messages: readonly TranscriptMessage[], maxBytes: number): TranscriptMessage[] {
  const encoder = new TextEncoder()
  const sizes = messages.map(message => encoder.encode(JSON.stringify(message)).byteLength)
  let total = RESPONSE_WRAPPER_BYTES + sizes.reduce((sum, size) => sum + size, 0)
    + MESSAGE_SEPARATOR_BYTES * Math.max(0, messages.length - 1)
  let first = 0
  while (first < messages.length && total > maxBytes) {
    total -= (sizes[first] as number) + (first < messages.length - 1 ? MESSAGE_SEPARATOR_BYTES : 0)
    first += 1
  }
  return messages.slice(first)
}

/**
 * Read the latest messages of one stored session. Each call reads the log
 * from the first event and, for a live session, flushes it first; the owner
 * applies no rate limit to concurrent requests. A session with no stored log
 * yet reads as an empty transcript.
 * @param source - where the log comes from.
 * @param sessionId - the session a chat window shows.
 * @param limits - message count, per-message length, and response size limits.
 * @returns the user and agent messages, oldest first, within every limit.
 */
export async function readTranscript(
  source: TranscriptLogSource,
  sessionId: WindowSessionId,
  limits: TranscriptLimits,
): Promise<TranscriptMessage[]> {
  let handle: TranscriptLogHandle
  try {
    handle = await source.open(sessionId)
  } catch (error: unknown) {
    // A new window's session has no stored log until its first flush; that is
    // an empty transcript, not a failure.
    if (error instanceof SessionPersistenceNotFoundError) return []
    throw error
  }
  try {
    const kept: TranscriptMessage[] = []
    for (let offset = 0;;) {
      const { events } = await handle.read(offset, READ_SLICE)
      if (events.length === 0) break
      offset += events.length
      for (const event of events) {
        const message = messageOf(event, limits.maxMessageChars)
        if (message !== undefined) kept.push(message)
      }
      // Only the latest messages can reach the answer, so older extracted
      // texts are released slice by slice.
      if (kept.length > limits.maxMessages) kept.splice(0, kept.length - limits.maxMessages)
    }
    return fitBytes(kept, limits.maxBytes)
  } finally {
    await handle.close()
  }
}

/**
 * The log source backed by `ctx.sessionPersistence`. A live session is flushed
 * first, so the read observes what the agent already appended; a cold session
 * needs no barrier.
 * @param ctx - the host context.
 * @returns the source, or undefined when the deployment mounts no persistence service.
 */
export function persistenceLogSource(ctx: Context): TranscriptLogSource | undefined {
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) return undefined
  return {
    open: async (sessionId) => {
      const sessions = ctx.get('sessions')
      const live = sessions?.get(sessionId)
      if (sessions !== undefined && live !== undefined) {
        try {
          await sessions.flush(live)
        } catch (error: unknown) {
          // The store rejects a flush for a session that is no longer live; a
          // cold session needs no barrier. A failure while the session is still
          // live is a durability failure and propagates.
          if (sessions.get(sessionId) !== undefined) throw error
        }
      }
      return persistence.open(sessionId, 'read')
    },
  }
}
