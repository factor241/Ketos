/**
 * The board's snapshot and operation routes: `GET /api/ketos.board` answers
 * the full state, `POST /api/ketos.board.ops` applies one atomic batch, and
 * every failure answers the stable code with its HTTP status.
 * @module @ketos/board-doc/routes
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { parseBoardOps, type BoardOpLimits } from './ops.ts'
import type { KetosBoardDocService } from './service.ts'
import { BoardError, fail, NO_STORE, ok } from './wire.ts'

/** Path of the snapshot route. */
export const BOARD_PATH = '/api/ketos.board'

/** Path of the operation route. */
export const BOARD_OPS_PATH = '/api/ketos.board.ops'

/** Deployment limits the routes enforce. */
export interface BoardRouteConfig {
  /** Operation and element limits the parser uses. */
  readonly opLimits: BoardOpLimits
  /** Largest accepted request body, in bytes. */
  readonly maxRequestBytes: number
}

/**
 * Answer the current document state.
 * @param service - the board document service.
 * @returns the snapshot, or an empty 500 when the document cannot open.
 */
export async function handleBoardSnapshot(service: KetosBoardDocService): Promise<Response> {
  try {
    return ok(await service.snapshot())
  } catch {
    return new Response(null, { status: 500, headers: NO_STORE })
  }
}

/**
 * Apply one operation batch. A body over the request bound answers 413, a
 * malformed body or batch answers 400, a missing element 404, an ownership or
 * budget conflict 409, and anything else an empty 500.
 * @param request - authenticated request from the shared API channel.
 * @param service - the board document service.
 * @param config - route limits.
 * @returns the answer for the browser.
 */
export async function handleBoardOps(
  request: Request,
  service: KetosBoardDocService,
  config: BoardRouteConfig,
): Promise<Response> {
  try {
    const text = await request.text()
    if (new TextEncoder().encode(text).length > config.maxRequestBytes) {
      return fail('ketos/invalid', 413)
    }
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new BoardError('ketos/invalid', 'body must be JSON')
    }
    const ops = parseBoardOps(body, config.opLimits)
    const { revision } = await service.apply(ops, 'browser')
    return ok({ ok: true, revision })
  } catch (error: unknown) {
    if (error instanceof BoardError) return fail(error.code)
    return new Response(null, { status: 500, headers: NO_STORE })
  }
}

/**
 * Register both routes on the connection's authenticated Fetch surface. The
 * registrations are effects of the calling fiber, so disposing the plugin
 * withdraws them.
 * @param ctx - context carrying `connection`.
 * @param service - the board document service.
 * @param config - route limits.
 */
export function registerBoardRoutes(
  ctx: Context,
  service: KetosBoardDocService,
  config: BoardRouteConfig,
): void {
  ctx.connection.fetch.register({
    path: BOARD_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: () => handleBoardSnapshot(service),
  })
  ctx.connection.fetch.register({
    path: BOARD_OPS_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: request => handleBoardOps(request, service, config),
  })
}
