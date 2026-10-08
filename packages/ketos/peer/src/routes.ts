/**
 * The peer routes: `GET /api/ketos.peer.state` reports the local record and
 * every known peer, `GET /api/ketos.peer.invite` mints a one-time invitation
 * code, and `POST /api/ketos.peer.connect` accepts a pasted code. Every
 * failure answers the stable code with its HTTP status.
 * @module @ketos/peer/routes
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { KetosPeerService, PeerServiceError } from './service.ts'
import type { PeerErrorCode } from './types.ts'

/** Path of the peer-state route. */
export const PEER_STATE_PATH = '/api/ketos.peer.state'

/** Path of the invitation route. */
export const PEER_INVITE_PATH = '/api/ketos.peer.invite'

/** Path of the connect route. */
export const PEER_CONNECT_PATH = '/api/ketos.peer.connect'

/** Response header for every answer: peer state is private and never cached. */
const NO_STORE = { 'cache-control': 'no-store' } as const

/** HTTP status of every stable peer error code. */
const STATUS: Readonly<Record<PeerErrorCode, number>> = {
  'ketos/invalid': 400,
  'ketos/peer-self': 409,
  'ketos/invite-used': 409,
  'ketos/peer-unreachable': 504,
  'ketos/peer-offline': 503,
}

/**
 * A successful JSON answer.
 * @param response - the body to send.
 * @returns the response with the private no-store header.
 */
function ok(response: unknown): Response {
  return Response.json(response, { headers: NO_STORE })
}

/**
 * A failed JSON answer with one stable code.
 * @param code - the stable code the browser reads.
 * @returns the response with the code's status.
 */
function fail(code: PeerErrorCode): Response {
  return Response.json({ ok: false, error: code }, { status: STATUS[code], headers: NO_STORE })
}

/**
 * Answer the current peer state. The node starts on this first touch, so a
 * process that never polls the board peer route never binds it.
 * @param service - the peer service.
 * @returns the state, or 503 while the node cannot start.
 */
export async function handlePeerState(service: KetosPeerService): Promise<Response> {
  try {
    return ok(await service.state())
  } catch {
    return fail('ketos/peer-offline')
  }
}

/**
 * Mint one invitation code, waiting for the relay address.
 * @param service - the peer service.
 * @returns `{ invite }`, or 503 while no relay address exists.
 */
export async function handlePeerInvite(service: KetosPeerService): Promise<Response> {
  try {
    return ok({ invite: await service.invite() })
  } catch (error: unknown) {
    if (error instanceof PeerServiceError) return fail(error.code)
    return fail('ketos/peer-offline')
  }
}

/**
 * Connect to the node one invitation code names.
 * @param request - authenticated request carrying `{ invite }`.
 * @param service - the peer service.
 * @returns `{ peerId }`, or the refusal's stable code.
 */
export async function handlePeerConnect(request: Request, service: KetosPeerService): Promise<Response> {
  try {
    let body: unknown
    try {
      body = JSON.parse(await request.text())
    } catch {
      return fail('ketos/invalid')
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return fail('ketos/invalid')
    const source = body as Record<string, unknown>
    for (const key of Object.keys(source)) {
      if (key !== 'invite') return fail('ketos/invalid')
    }
    if (typeof source.invite !== 'string' || source.invite.length === 0) return fail('ketos/invalid')
    const { peerId } = await service.connect(source.invite)
    return ok({ peerId })
  } catch (error: unknown) {
    if (error instanceof PeerServiceError) return fail(error.code)
    return new Response(null, { status: 500, headers: NO_STORE })
  }
}

/**
 * Register all three routes on the connection's authenticated Fetch surface.
 * The registrations are effects of the calling fiber, so disposing the plugin
 * withdraws them.
 * @param ctx - context carrying `connection`.
 * @param service - the peer service.
 */
export function registerPeerRoutes(ctx: Context, service: KetosPeerService): void {
  ctx.connection.fetch.register({
    path: PEER_STATE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: () => handlePeerState(service),
  })
  ctx.connection.fetch.register({
    path: PEER_INVITE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: () => handlePeerInvite(service),
  })
  ctx.connection.fetch.register({
    path: PEER_CONNECT_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: request => handlePeerConnect(request, service),
  })
}
