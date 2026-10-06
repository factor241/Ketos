/**
 * The board's event stream: `GET /api/ketos.board.events` answers one
 * `snapshot` event, then one `patch` event per committed batch and a `: ping`
 * heartbeat while the connection lives.
 *
 * Every stream closes when the request aborts or the consumer cancels, when
 * its buffered backlog passes the queue bound (the browser reconnects and
 * re-reads the snapshot), and when the plugin disposes; a request over the
 * stream budget answers 503 before a stream exists.
 * @module @ketos/board-doc/events
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { KetosBoardDocService } from './service.ts'
import { NO_STORE } from './wire.ts'

/** Path of the event-stream route. */
export const BOARD_EVENTS_PATH = '/api/ketos.board.events'

/** Deployment limits of the event stream. */
export interface BoardEventsConfig {
  /** Heartbeat interval, in milliseconds. */
  readonly heartbeatMs: number
  /** Largest buffered backlog before the stream closes itself. */
  readonly maxStreamQueueBytes: number
  /** Largest number of concurrent streams. */
  readonly maxStreams: number
}

/** Headers of every event stream. */
const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store, no-transform',
} as const

/** One open stream's close function, owned by the plugin until it ends. */
type OpenStream = () => void

/**
 * Register the event-stream route. The route and the set of open streams are
 * effects of the calling fiber, so disposing the plugin withdraws the route
 * and closes every stream.
 * @param ctx - context carrying `connection`.
 * @param service - the board document service.
 * @param config - heartbeat, queue, and stream limits.
 */
export function registerBoardEvents(
  ctx: Context,
  service: KetosBoardDocService,
  config: BoardEventsConfig,
): void {
  const active = new Set<OpenStream>()
  ctx.effect(() => () => {
    for (const closeStream of [...active]) closeStream()
  }, 'ketos-board-doc: event streams')
  ctx.connection.fetch.register({
    path: BOARD_EVENTS_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) => {
      if (active.size >= config.maxStreams) {
        return Promise.resolve(Response.json({ ok: false, error: 'ketos/limit' }, { status: 503, headers: NO_STORE }))
      }
      return Promise.resolve(openBoardEvents(request, service, config, active))
    },
  })
}

/**
 * Open one event stream: the snapshot first, then every committed change and
 * the heartbeat until the connection ends.
 * @param request - the stream request; its signal reports client disconnect.
 * @param service - the board document service.
 * @param config - heartbeat, queue, and stream limits.
 * @param active - the set the stream joins until it closes.
 * @returns the streaming response.
 */
function openBoardEvents(
  request: Request,
  service: KetosBoardDocService,
  config: BoardEventsConfig,
  active: Set<OpenStream>,
): Response {
  if (request.signal.aborted) {
    return new Response(new ReadableStream<Uint8Array>({
      start: (streamController) => { streamController.close() },
    }), { headers: SSE_HEADERS })
  }
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let unsubscribe!: () => void
  let timer: NodeJS.Timeout | undefined
  let closed = false
  let queuedBytes = 0

  function cleanup(): void {
    if (closed) return
    closed = true
    unsubscribe()
    clearInterval(timer)
    request.signal.removeEventListener('abort', onAbort)
    active.delete(close)
  }

  function close(): void {
    cleanup()
    try {
      controller.close()
    } catch {
      // The consumer already cancelled the stream; its controller is closed.
    }
  }

  function onAbort(): void {
    close()
  }

  function write(event: string): void {
    if (closed) return
    const bytes = encoder.encode(event)
    queuedBytes += bytes.length
    controller.enqueue(bytes)
    if (queuedBytes > config.maxStreamQueueBytes) close()
  }

  const stream = new ReadableStream<Uint8Array>({
    start: (streamController) => {
      controller = streamController
      request.signal.addEventListener('abort', onAbort)
      unsubscribe = service.subscribe((change) => {
        write(`event: patch\ndata: ${JSON.stringify(change)}\n\n`)
      })
      timer = setInterval(() => { write(': ping\n\n') }, config.heartbeatMs)
      timer.unref()
      void service.snapshot().then(
        (snapshot) => { write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`) },
        (error: unknown) => {
          cleanup()
          controller.error(error)
        },
      )
    },
    pull: () => { queuedBytes = 0 },
    cancel: () => { close() },
  })
  active.add(close)
  return new Response(stream, { headers: SSE_HEADERS })
}
