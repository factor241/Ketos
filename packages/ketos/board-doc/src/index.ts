/**
 * Ketos board document host package: the `board.db` journal over the Yjs
 * document the board's elements live in. It owns the local participant
 * identity (`selfId`) and the document identity (`docId`), the element
 * envelope and its atomic operation batches, the `ctx.ketosBoardDoc` service
 * other Ketos packages read and write, and the `/api/ketos.board`,
 * `/api/ketos.board.ops`, and `/api/ketos.board.events` Fetch routes the
 * browser uses.
 *
 * The database opens on the first request, so a process that never touches the
 * board never imports `node:sqlite` or `yjs`, and startup output stays quiet.
 * @module @ketos/board-doc
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerBoardEvents } from './events.ts'
import { registerBoardRoutes } from './routes.ts'
import { KetosBoardDocService } from './service.ts'

/** Loader entry name of the plugin. */
export const name = 'ketos-board-doc'

/** Services the plugin needs at its root: the authenticated Fetch surface. */
export const inject = ['connection']

/** Deployment configuration of the board document. */
export interface Config {
  /**
   * Path of the board document database file. The shipped web profile passes
   * `dshHomePath('board.db')`; the parent directory is created owner-only
   * before the file is opened.
   */
  path: string
  /** Largest serialized size, in bytes, of one stored element (1 KiB–16 MiB). */
  maxElementBytes?: number
  /** Largest note text, in UTF-16 code units (1–1000000). */
  noteTextMax?: number
  /** Largest number of points one stroke may carry (2–100000). */
  strokePointsMax?: number
  /** Largest number of items one to-do list may carry (1–10000). */
  todoItemsMax?: number
  /** Largest number of elements the document holds (1–100000). */
  maxElements?: number
  /** Largest number of operations one request may batch (1–1024). */
  maxOpsPerRequest?: number
  /** Largest accepted operation-request body, in bytes (1 KiB–64 MiB). */
  maxRequestBytes?: number
  /** Journal rows after which the store compacts to one update row (1–100000). */
  journalCompactRows?: number
  /** Event-stream heartbeat interval, in milliseconds (1000–300000). */
  heartbeatMs?: number
  /** Largest buffered event-stream backlog, in bytes (16 KiB–256 MiB). */
  maxStreamQueueBytes?: number
  /** Largest number of concurrent event streams (1–1024). */
  maxStreams?: number
}

/** Schemastery configuration of the board document; only the path is required. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  maxElementBytes: z.number().step(1).min(1024).max(16_777_216).default(262_144),
  noteTextMax: z.number().step(1).min(1).max(1_000_000).default(20_000),
  strokePointsMax: z.number().step(1).min(2).max(100_000).default(2000),
  todoItemsMax: z.number().step(1).min(1).max(10_000).default(200),
  maxElements: z.number().step(1).min(1).max(100_000).default(2000),
  maxOpsPerRequest: z.number().step(1).min(1).max(1024).default(64),
  maxRequestBytes: z.number().step(1).min(1024).max(67_108_864).default(1_048_576),
  journalCompactRows: z.number().step(1).min(1).max(100_000).default(500),
  heartbeatMs: z.number().step(1).min(1000).max(300_000).default(15_000),
  maxStreamQueueBytes: z.number().step(1).min(16_384).max(268_435_456).default(4_194_304),
  maxStreams: z.number().step(1).min(1).max(1024).default(16),
})

/**
 * Own the board document for the lifetime of the plugin: provide
 * `ctx.ketosBoardDoc`, keep its database, document, and journal open, and
 * close every resource when the fiber disposes. Registration order matters at
 * disposal: the routes the next sub-stage adds are withdrawn before this
 * effect closes the document.
 * @param ctx - host context carrying `connection`.
 * @param config - deployment's database path and document limits.
 */
export function apply(ctx: Context, config: Config): void {
  // Schemastery materializes the field defaults before Cordis calls apply.
  const limits = {
    maxOpsPerRequest: config.maxOpsPerRequest as number,
    maxElements: config.maxElements as number,
    elements: {
      elementBytesMax: config.maxElementBytes as number,
      noteTextMax: config.noteTextMax as number,
      strokePointsMax: config.strokePointsMax as number,
      todoItemsMax: config.todoItemsMax as number,
    },
  }
  const service = new KetosBoardDocService(ctx, {
    path: config.path,
    limits,
    journalCompactRows: config.journalCompactRows as number,
    logger: (message) => { ctx.logger('ketos-board-doc').warn(message) },
  })
  ctx.effect(() => () => service.close(), 'ketos-board-doc: board document')
  registerBoardRoutes(ctx, service, {
    opLimits: limits,
    maxRequestBytes: config.maxRequestBytes as number,
  })
  registerBoardEvents(ctx, service, {
    heartbeatMs: config.heartbeatMs as number,
    maxStreamQueueBytes: config.maxStreamQueueBytes as number,
    maxStreams: config.maxStreams as number,
  })
}
