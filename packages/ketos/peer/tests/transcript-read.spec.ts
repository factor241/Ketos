// Reading a chat transcript out of a session log: which events count as
// messages, the three limits, and the live-session flush before the read.
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WindowSessionId } from '@ketos/board-doc/types'
import {
  persistenceLogSource, readTranscript, type TranscriptLimits, type TranscriptLogHandle,
} from '../src/transcript-read.ts'
import {
  FakePersistence, FakeSessions, assistantEvent, handleOf, injectedEvent, otherEvent, textBlock, userEvent,
} from './transcript-fixture.ts'

const SESSION = brandString<WindowSessionId>('session-1')
const LIMITS: TranscriptLimits = { maxMessages: 20, maxMessageChars: 4000, maxBytes: 65_536 }

/**
 * Read a transcript over a fixed event list.
 * @param events - the log.
 * @param limits - limit overrides.
 * @returns the messages and the handle that served them.
 */
async function read(
  events: Parameters<typeof handleOf>[0],
  limits: Partial<TranscriptLimits> = {},
): Promise<{ messages: Awaited<ReturnType<typeof readTranscript>>; handle: ReturnType<typeof handleOf> }> {
  const handle = handleOf(events)
  const messages = await readTranscript({ open: async () => handle }, SESSION, { ...LIMITS, ...limits })
  return { messages, handle }
}

describe('readTranscript', () => {
  it('returns user and assistant messages oldest first with ISO times', async () => {
    const { messages, handle } = await read([
      userEvent(1, Date.UTC(2026, 9, 8, 10, 0, 0), 'Привет'),
      assistantEvent(2, Date.UTC(2026, 9, 8, 10, 0, 5), 'Здравствуйте'),
    ])
    expect(messages).toEqual([
      { role: 'user', text: 'Привет', at: '2026-10-08T10:00:00.000Z' },
      { role: 'agent', text: 'Здравствуйте', at: '2026-10-08T10:00:05.000Z' },
    ])
    expect(handle.closed).toBe(1)
  })

  it('takes only text of human prompts and assistant steps', async () => {
    const { messages } = await read([
      injectedEvent(1, 1000, 'runtime-context', 'Current runtime context snapshot'),
      injectedEvent(2, 2000, 'schedule', 'Scheduled reminder'),
      userEvent(3, 3000, [
        textBlock('first'),
        { type: 'image', attachment: { attachmentId: 'secret-image', mediaType: 'image/png' } },
        { type: 'file', attachment: { attachmentId: 'sha256:abc', name: 'notes.txt' } },
        textBlock('second'),
      ]),
      assistantEvent(4, 4000, [
        { type: 'reasoning', text: 'private thinking' },
        { type: 'tool-call', id: 'call-1', name: 'bash', arguments: '{"command":"cat ~/.ssh/id_rsa"}' },
      ]),
      otherEvent('tool/result', 5, 5000, { message: { role: 'tool', content: [textBlock('TOOL OUTPUT')] } }),
      otherEvent('developer/message', 6, 6000, { message: { role: 'developer', content: [textBlock('dev')] } }),
      otherEvent('system/message', 7, 7000, { message: { role: 'system', content: [textBlock('system prompt')] } }),
      assistantEvent(8, 8000, [{ type: 'reasoning', text: 'more thinking' }, textBlock('answer'), textBlock('tail')]),
      assistantEvent(9, 9000, [textBlock('   \n')]),
      userEvent(10, 10_000, ''),
    ])
    expect(messages).toEqual([
      { role: 'user', text: 'first\n\nsecond', at: new Date(3000).toISOString() },
      { role: 'agent', text: 'answer\n\ntail', at: new Date(8000).toISOString() },
    ])
    expect(JSON.stringify(messages)).not.toMatch(/thinking|TOOL OUTPUT|secret-image|id_rsa|system prompt|notes\.txt|runtime/u)
  })

  it('counts only events that appended to the surface, not replacement copies', async () => {
    const replace = { op: 'replace', startSeq: 1, endSeq: 4 }
    const { messages } = await read([
      userEvent(1, 1000, 'original question'),
      assistantEvent(2, 2000, 'original answer'),
      userEvent(3, 3000, 'compacted copy of the question', replace),
      assistantEvent(4, 4000, 'compacted copy of the answer', replace),
      userEvent(5, 5000, 'event without a surface marker', null),
      assistantEvent(6, 6000, 'unknown marker', 'prepend'),
    ])
    expect(messages.map(message => message.text)).toEqual(['original question', 'original answer'])
  })

  it('skips a message whose text is empty after the cut', async () => {
    const rocket = '\u{1F680}'
    const { messages } = await read([
      userEvent(1, 1000, `${rocket}x`),
      userEvent(2, 2000, '   x'),
      userEvent(3, 3000, 'ok'),
    ], { maxMessageChars: 1 })
    // The pair does not fit one unit and cuts to nothing; the blank prefix cuts to a space.
    expect(messages.map(message => message.text)).toEqual(['o'])
    const kept = await read([userEvent(1, 1000, '  x'), userEvent(2, 2000, 'abc')], { maxMessageChars: 2 })
    expect(kept.messages.map(message => message.text)).toEqual(['ab'])
  })

  it('skips events whose data is not a message with text content', async () => {
    const { messages } = await read([
      otherEvent('user/message', 1, 1000, null),
      otherEvent('user/message', 2, 2000, 'text'),
      otherEvent('user/message', 3, 3000, { source: { kind: 'user' }, content: 'not an array' }),
      otherEvent('user/message', 4, 4000, { source: null, content: [textBlock('no source')] }),
      otherEvent('user/message', 5, 5000, { source: 'user', content: [textBlock('string source')] }),
      otherEvent('user/message', 6, 6000, { source: { kind: 'user' }, content: [null, 'text', { type: 'text' }, { type: 'text', text: 7 }] }),
      otherEvent('assistant/message', 7, 7000, null),
      otherEvent('assistant/message', 8, 8000, { message: null }),
      otherEvent('assistant/message', 9, 9000, { message: { content: 'text' } }),
      assistantEvent(10, 1e20, 'unrepresentable time'),
      assistantEvent(11, Number.NaN, 'not a time'),
      userEvent(12, 12_000, 'ok'),
    ])
    expect(messages).toEqual([{ role: 'user', text: 'ok', at: new Date(12_000).toISOString() }])
  })

  it('keeps the latest messages when the log holds more than the limit', async () => {
    const events = Array.from({ length: 30 }, (_unused, index) => userEvent(index, 1000 + index, `message ${String(index)}`))
    const { messages } = await read(events, { maxMessages: 5 })
    expect(messages.map(message => message.text)).toEqual(
      ['message 25', 'message 26', 'message 27', 'message 28', 'message 29'],
    )
  })

  it('reads a long log in slices and keeps memory to the latest messages', async () => {
    const events = Array.from({ length: 1200 }, (_unused, index) =>
      (index % 3 === 0 ? userEvent : assistantEvent)(index, 1000 + index, `message ${String(index)}`))
    const { messages, handle } = await read(events, { maxMessages: 3 })
    expect(messages.map(message => message.text)).toEqual(['message 1197', 'message 1198', 'message 1199'])
    // Three full slices, then the empty slice that ends the log.
    expect(handle.reads.map(([offset]) => offset)).toEqual([0, 500, 1000, 1200])
  })

  it('cuts each text to the character limit without splitting a surrogate pair', async () => {
    const rocket = '\u{1F680}'
    const { messages } = await read([
      userEvent(1, 1000, `ab${rocket}cd`),
      userEvent(2, 2000, `abc${rocket}d`),
      userEvent(3, 3000, 'abcd'),
      userEvent(4, 4000, 'abc'),
    ], { maxMessageChars: 3 })
    // The first cut would fall inside the pair, so it ends before the pair.
    expect(messages.map(message => message.text)).toEqual(['ab', 'abc', 'abc', 'abc'])
    for (const message of messages) expect(message.text.isWellFormed()).toBe(true)
  })

  it('keeps a pair that ends exactly at the character limit', async () => {
    const rocket = '\u{1F680}'
    const { messages } = await read([userEvent(1, 1000, `a${rocket}z`)], { maxMessageChars: 3 })
    expect(messages[0]?.text).toBe(`a${rocket}`)
  })

  it('drops the oldest messages until the response fits the byte limit', async () => {
    const events = [
      userEvent(1, 1000, 'a'.repeat(100)),
      assistantEvent(2, 2000, 'b'.repeat(100)),
      userEvent(3, 3000, 'c'.repeat(100)),
    ]
    const wire = [
      { role: 'user', text: 'a'.repeat(100), at: new Date(1000).toISOString() },
      { role: 'agent', text: 'b'.repeat(100), at: new Date(2000).toISOString() },
      { role: 'user', text: 'c'.repeat(100), at: new Date(3000).toISOString() },
    ]
    const size = (count: number): number => new TextEncoder()
      .encode(JSON.stringify({ ok: true, messages: wire.slice(3 - count) })).byteLength
    expect(size(3)).toBeGreaterThan(size(2))
    const all = await read(events, { maxBytes: size(3) })
    expect(all.messages).toHaveLength(3)
    const two = await read(events, { maxBytes: size(3) - 1 })
    expect(two.messages.map(message => message.text[0])).toEqual(['b', 'c'])
    const one = await read(events, { maxBytes: size(2) - 1 })
    expect(one.messages.map(message => message.text[0])).toEqual(['c'])
    const none = await read(events, { maxBytes: size(1) - 1 })
    expect(none.messages).toEqual([])
  })

  it('counts multibyte text and JSON escapes in the byte limit', async () => {
    const events = [userEvent(1, 1000, 'я'.repeat(50)), userEvent(2, 2000, '"'.repeat(50))]
    const { messages } = await read(events, { maxBytes: 200 })
    // 50 Cyrillic letters are 100 bytes and 50 quotes escape to 100 bytes, so
    // two messages do not fit under 200 bytes; counting characters would keep both.
    expect(messages).toHaveLength(1)
    expect(messages[0]?.text).toBe('"'.repeat(50))
  })

  it('closes the handle and rethrows when a read fails', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const handle: TranscriptLogHandle = { read: vi.fn().mockRejectedValue(new Error('disk gone')), close }
    await expect(readTranscript({ open: async () => handle }, SESSION, LIMITS)).rejects.toThrow('disk gone')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('reads a session that is not stored yet as an empty transcript', async () => {
    const open = vi.fn().mockRejectedValue(new SessionPersistenceNotFoundError(SESSION))
    await expect(readTranscript({ open }, SESSION, LIMITS)).resolves.toEqual([])
  })

  it('does not open a handle it cannot close when open itself fails', async () => {
    await expect(readTranscript({ open: () => Promise.reject(new Error('no such session')) }, SESSION, LIMITS))
      .rejects.toThrow('no such session')
  })
})

describe('persistenceLogSource', () => {
  it('is absent while no persistence service is mounted', () => {
    expect(persistenceLogSource(new Context())).toBeUndefined()
  })

  it('opens a read handle without a live-session store', async () => {
    const ctx = new Context()
    const order: string[] = []
    const handle = handleOf([])
    const persistence = new FakePersistence(ctx, handle, order)
    const source = persistenceLogSource(ctx)
    expect(await source?.open(SESSION)).toBe(handle)
    expect(persistence.opened).toEqual([['session-1', 'read']])
    expect(order).toEqual(['open'])
  })

  it('flushes a live session before it opens the read handle', async () => {
    const ctx = new Context()
    const order: string[] = []
    const handle = handleOf([])
    new FakePersistence(ctx, handle, order)
    const sessions = new FakeSessions(ctx, new Set(['session-1']), order)
    await persistenceLogSource(ctx)?.open(SESSION)
    expect(sessions.flushed).toEqual([{ id: 'session-1' }])
    expect(order).toEqual(['flush', 'open'])
  })

  it('skips the flush for a session that is not live', async () => {
    const ctx = new Context()
    const order: string[] = []
    new FakePersistence(ctx, handleOf([]), order)
    const sessions = new FakeSessions(ctx, new Set(), order)
    await persistenceLogSource(ctx)?.open(SESSION)
    expect(sessions.flushed).toEqual([])
    expect(order).toEqual(['open'])
  })

  it('reads cold when the session left the store between the lookup and the flush', async () => {
    const ctx = new Context()
    const order: string[] = []
    const handle = handleOf([])
    new FakePersistence(ctx, handle, order)
    const sessions = new FakeSessions(ctx, new Set(['session-1']), order)
    sessions.disposeOnFlush = true
    expect(await persistenceLogSource(ctx)?.open(SESSION)).toBe(handle)
    expect(order).toEqual(['flush', 'open'])
  })

  it('fails when a durability listener rejects while the session is still live', async () => {
    const ctx = new Context()
    const order: string[] = []
    const persistence = new FakePersistence(ctx, handleOf([]), order)
    const sessions = new FakeSessions(ctx, new Set(['session-1']), order)
    sessions.failure = new Error('checkpoint listener failed')
    await expect(persistenceLogSource(ctx)?.open(SESSION)).rejects.toThrow('checkpoint listener failed')
    expect(persistence.opened).toEqual([])
  })
})
