// The event stream: the snapshot first, one patch per committed batch, the
// heartbeat, every close path (abort, cancel, backlog, disposal), the stream
// budget, and the failure of an unopenable document.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import { BOARD_EVENTS_PATH, registerBoardEvents, type BoardEventsConfig } from '../src/events.ts'
import { KetosBoardDocService, type KetosBoardDocOptions } from '../src/service.ts'
import type { BoardCreateOp, BoardSnapshot, ElementId } from '../src/types.ts'

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

const ID_A = brandString<ElementId>('00000000-0000-4000-8000-000000000001')

/** The deployment limits the fixture mounts. */
const LIMITS = {
  maxOpsPerRequest: 64,
  maxElements: 2000,
  maxWindowRecords: 100,
  elements: { elementBytesMax: 262_144, noteTextMax: 20_000, strokePointsMax: 2000, todoItemsMax: 200 },
} as const

/** The event limits the fixture mounts. */
const EVENTS: BoardEventsConfig = { heartbeatMs: 15_000, maxStreamQueueBytes: 4_194_304, maxStreams: 16 }

/**
 * One create operation.
 * @param id - element id.
 * @returns the create operation.
 */
function createOp(id: ElementId): BoardCreateOp {
  return {
    op: 'create', id, kind: 'note', x: 0, y: 0, w: 10, h: 10,
    data: { text: '', font: 'sans', size: 'm', scale: 1 },
  }
}

/**
 * Store notes with long text, so the snapshot outgrows a small queue bound.
 * @param service - the service to write through.
 * @param count - number of notes.
 * @returns the element ids in creation order.
 */
async function seedNotes(service: KetosBoardDocService, count: number): Promise<ElementId[]> {
  const ids: ElementId[] = []
  for (let index = 0; index < count; index++) {
    const id = brandString<ElementId>(`00000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`)
    ids.push(id)
    await service.apply([{ ...createOp(id), data: { text: 'x'.repeat(200), font: 'sans', size: 'm', scale: 1 } }], 'host')
  }
  return ids
}

/** Fresh temporary directory that the running test owns. */
async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-board-events-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

/** One decoded chunk of a stream, or '' once the stream ended. */
const decoder = new TextDecoder()

/**
 * Read one chunk of a stream, failing the test when nothing arrives in time.
 * @param reader - stream reader.
 * @param timeoutMs - longest wait for a chunk.
 * @returns the decoded chunk, or '' when the stream ended.
 */
async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs = 3000): Promise<string> {
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => { reject(new Error('event stream read timed out')) }, timeoutMs)
    timer.unref()
  })
  const result = await Promise.race([reader.read(), timeout])
  if (result.done) return ''
  return decoder.decode(result.value, { stream: true })
}

interface Fixture {
  readonly service: KetosBoardDocService
  readonly fiber: Fiber
  readonly open: (signal?: AbortSignal) => Promise<Response>
}

/**
 * Mount the event route over a fresh context and service.
 * @param options - database path, event config, and service options to replace.
 * @returns the service, the registering fiber, and the open helper.
 */
async function fixture(options: {
  path?: string
  events?: Partial<BoardEventsConfig>
  service?: Partial<KetosBoardDocOptions>
} = {}): Promise<Fixture> {
  const root = await temporaryDirectory()
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
  const service = new KetosBoardDocService(ctx, {
    path: options.path ?? join(root, 'board.db'),
    limits: { ...LIMITS, elements: { ...LIMITS.elements } },
    journalCompactRows: 500,
    logger: () => {},
    ...options.service,
  })
  cleanups.push(() => service.close())
  const fiber = ctx.plugin({
    inject: ['connection'],
    apply: (scope) => {
      registerBoardEvents(scope, service, { ...EVENTS, ...options.events })
    },
  })
  await fiber
  cleanups.push(() => fiber.dispose())
  const handler = connection.createSharedFetchHandler('/api')
  return {
    service,
    fiber,
    open: (signal?: AbortSignal) => handler.fetch(new Request(
      `http://localhost${BOARD_EVENTS_PATH}`,
      signal === undefined ? {} : { signal },
    )),
  }
}

describe('board event stream', () => {
  it('streams the snapshot, then one patch per committed batch', async () => {
    const { service, open } = await fixture()
    const controller = new AbortController()
    const response = await open(controller.signal)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(response.headers.get('cache-control')).toBe('no-store, no-transform')

    const reader = response.body!.getReader()
    cleanups.push(() => reader.cancel().catch(() => {}))
    const snapshot = await readChunk(reader)
    expect(snapshot).toContain('event: snapshot')
    expect(snapshot).toContain('"revision":0')

    await service.apply([createOp(ID_A)], 'browser')
    const patch = await readChunk(reader)
    expect(patch).toContain('event: patch')
    expect(patch).toContain('"revision":1')
    expect(patch).toContain(ID_A)

    controller.abort()
    expect(await readChunk(reader)).toBe('')
  })

  it('sends a heartbeat while the stream stays open', async () => {
    const { service, open } = await fixture({ events: { heartbeatMs: 5 } })
    // The first call opens board.db; done here, it cannot outlast the 5 ms
    // heartbeat that the stream starts before its snapshot.
    await service.snapshot()
    const controller = new AbortController()
    const reader = (await open(controller.signal)).body!.getReader()
    cleanups.push(() => reader.cancel().catch(() => {}))
    expect(await readChunk(reader)).toContain('event: snapshot')
    expect(await readChunk(reader)).toContain(': ping')
    controller.abort()
    await readChunk(reader)
  })

  it('does not count the snapshot toward the queue bound, however large it is', async () => {
    const { service, open } = await fixture({ events: { maxStreamQueueBytes: 300 } })
    const ids = await seedNotes(service, 3)
    const controller = new AbortController()
    const reader = (await open(controller.signal)).body!.getReader()
    cleanups.push(() => reader.cancel().catch(() => {}))
    // No reader consumes while the snapshot lands; it is larger than the bound.
    await new Promise(resolve => setTimeout(resolve, 50))
    const snapshot = await readChunk(reader)
    expect(snapshot).toContain('event: snapshot')
    expect(snapshot.length).toBeGreaterThan(300)

    await service.apply([{ op: 'remove', id: ids[0]! }], 'browser')
    const patch = await readChunk(reader)
    expect(patch).toContain('event: patch')
    expect(patch).not.toContain('event: overflow')
    controller.abort()
  })

  it('sends an overflow event and closes when the patch backlog passes the queue bound', async () => {
    const lines: string[] = []
    const { service, open } = await fixture({
      events: { maxStreamQueueBytes: 250, logger: (message) => { lines.push(message) } },
    })
    const ids = await seedNotes(service, 4)
    const controller = new AbortController()
    const reader = (await open(controller.signal)).body!.getReader()
    cleanups.push(() => reader.cancel().catch(() => {}))
    // The consumer reads nothing while three patches pile up behind the snapshot.
    await new Promise(resolve => setTimeout(resolve, 50))
    for (const id of ids.slice(0, 3)) await service.apply([{ op: 'remove', id }], 'browser')

    let received = ''
    for (let chunk = await readChunk(reader); chunk !== ''; chunk = await readChunk(reader)) received += chunk
    expect(received.startsWith('event: snapshot')).toBe(true)
    expect(received.endsWith('event: overflow\ndata: {"reason":"queue"}\n\n')).toBe(true)
    expect(received.match(/event: overflow/gu)).toHaveLength(1)
    expect(lines).toEqual([expect.stringMatching(/event stream overflow: .*250 bytes/u)])

    // The stream is gone; the service keeps committing batches.
    await service.apply([{ op: 'remove', id: ids[3]! }], 'browser')
    expect((await service.snapshot()).elements).toEqual([])
    controller.abort()
  })

  it('closes an overflowing stream silently when no logger is configured', async () => {
    const { service, open } = await fixture({ events: { maxStreamQueueBytes: 20, heartbeatMs: 5 } })
    await service.snapshot()
    const reader = (await open()).body!.getReader()
    cleanups.push(() => reader.cancel().catch(() => {}))
    await new Promise(resolve => setTimeout(resolve, 80))
    let received = ''
    for (let chunk = await readChunk(reader); chunk !== ''; chunk = await readChunk(reader)) received += chunk
    expect(received.endsWith('event: overflow\ndata: {"reason":"queue"}\n\n')).toBe(true)
  })

  it('closes a stream aborted while its snapshot is still pending', async () => {
    const { open } = await fixture()
    const controller = new AbortController()
    const reader = (await open(controller.signal)).body!.getReader()
    cleanups.push(() => reader.cancel().catch(() => {}))
    controller.abort()
    expect(await readChunk(reader)).toBe('')
  })

  it('closes immediately when the request arrives already aborted', async () => {
    const { open } = await fixture()
    const controller = new AbortController()
    controller.abort()
    const response = await open(controller.signal)
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    cleanups.push(() => reader.cancel().catch(() => {}))
    expect(await readChunk(reader)).toBe('')
  })

  it('ignores a snapshot that arrives after the stream closed', async () => {
    const { service, open } = await fixture()
    const real = await service.snapshot()
    const gate = Promise.withResolvers<BoardSnapshot>()
    vi.spyOn(service, 'snapshot').mockReturnValue(gate.promise)
    const controller = new AbortController()
    const reader = (await open(controller.signal)).body!.getReader()
    cleanups.push(() => reader.cancel().catch(() => {}))
    controller.abort()
    gate.resolve(real)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(await readChunk(reader)).toBe('')
  })

  it('cleans up when the snapshot fails after the stream closed', async () => {
    const { service, open } = await fixture()
    const gate = Promise.withResolvers<BoardSnapshot>()
    vi.spyOn(service, 'snapshot').mockReturnValue(gate.promise)
    const controller = new AbortController()
    const reader = (await open(controller.signal)).body!.getReader()
    cleanups.push(() => reader.cancel().catch(() => {}))
    controller.abort()
    gate.reject(new Error('late failure'))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(await readChunk(reader)).toBe('')
  })

  it('answers 503 while the stream budget is full', async () => {
    const { open } = await fixture({ events: { maxStreams: 1 } })
    const first = new AbortController()
    const reader = (await open(first.signal)).body!.getReader()
    cleanups.push(() => reader.cancel().catch(() => {}))
    expect(await readChunk(reader)).toContain('event: snapshot')

    const refused = await open()
    expect(refused.status).toBe(503)
    expect(await refused.json()).toMatchObject({ ok: false, error: 'ketos/limit' })

    first.abort()
    expect(await readChunk(reader)).toBe('')
    const third = new AbortController()
    const accepted = await open(third.signal)
    expect(accepted.status).toBe(200)
    third.abort()
  })

  it('closes every open stream when the plugin disposes', async () => {
    const { fiber, open } = await fixture()
    const reader = (await open()).body!.getReader()
    cleanups.push(() => reader.cancel().catch(() => {}))
    expect(await readChunk(reader)).toContain('event: snapshot')
    await fiber.dispose()
    expect(await readChunk(reader)).toBe('')
  })

  it('closes without error when the consumer cancels', async () => {
    const { service, open } = await fixture()
    const reader = (await open()).body!.getReader()
    expect(await readChunk(reader)).toContain('event: snapshot')
    await reader.cancel()
    await service.apply([createOp(ID_A)], 'browser')
    expect((await service.snapshot()).revision).toBe(1)
  })

  it('fails the stream when the document cannot open', async () => {
    const root = await temporaryDirectory()
    const blocker = join(root, 'blocker')
    await writeFile(blocker, 'not a directory')
    const { open } = await fixture({ path: join(blocker, 'board.db') })
    const response = await open()
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    cleanups.push(() => reader.cancel().catch(() => {}))
    await expect(reader.read()).rejects.toThrow()
  })
})
