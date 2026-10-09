/**
 * The peer routes: `GET /api/ketos.peer.state` reports the local record and
 * every known peer, `GET /api/ketos.peer.invite` mints a one-time invitation
 * code, `POST /api/ketos.peer.connect` accepts a pasted code, and
 * `POST /api/ketos.peer.forget` removes a known peer that has no open
 * channel, and `POST /api/ketos.peer.transcript` asks the Ketos that hosts a
 * foreign chat window for its latest messages. Every failure answers the
 * stable code with its HTTP status.
 * @module @ketos/peer/routes
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { brandString } from '@deepseek-ai/dsh-brand'
import { PeerRequestTimeoutError } from './link.ts'
import { KetosPeerService, PeerServiceError } from './service.ts'
import { parseTranscriptWireResponse, type TranscriptBoard } from './transcript.ts'
import type { KetosPeerId, PeerErrorCode, TranscriptResponse } from './types.ts'

/** Path of the peer-state route. */
export const PEER_STATE_PATH = '/api/ketos.peer.state'

/** Path of the invitation route. */
export const PEER_INVITE_PATH = '/api/ketos.peer.invite'

/** Path of the connect route. */
export const PEER_CONNECT_PATH = '/api/ketos.peer.connect'

/** Path of the forget route. */
export const PEER_FORGET_PATH = '/api/ketos.peer.forget'

/** Path of the foreign-window transcript route. */
export const PEER_TRANSCRIPT_PATH = '/api/ketos.peer.transcript'

/** Response header for every answer: peer state is private and never cached. */
const NO_STORE = { 'cache-control': 'no-store' } as const

/** HTTP status of every stable peer error code. */
const STATUS: Readonly<Record<PeerErrorCode, number>> = {
  'ketos/invalid': 400,
  'ketos/peer-self': 409,
  'ketos/invite-used': 409,
  'ketos/peer-unreachable': 504,
  'ketos/peer-offline': 503,
  'ketos/peer-online': 409,
  'ketos/peer-unknown': 404,
  'ketos/transcript-closed': 403,
  'ketos/window-not-found': 404,
  'ketos/peer-timeout': 504,
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
 * Read a JSON request body that holds exactly one non-empty string field.
 * @param request - authenticated request.
 * @param key - the only accepted field name.
 * @returns the field's value, or undefined when the body is not such an object.
 */
async function readOnlyStringField(request: Request, key: string): Promise<string | undefined> {
  let body: unknown
  try {
    body = JSON.parse(await request.text())
  } catch {
    return undefined
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const source = body as Record<string, unknown>
  for (const name of Object.keys(source)) {
    if (name !== key) return undefined
  }
  const value = source[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
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
    const invite = await readOnlyStringField(request, 'invite')
    if (invite === undefined) return fail('ketos/invalid')
    const { peerId } = await service.connect(invite)
    return ok({ peerId })
  } catch (error: unknown) {
    if (error instanceof PeerServiceError) return fail(error.code)
    return new Response(null, { status: 500, headers: NO_STORE })
  }
}

/**
 * Remove one known peer that has no open channel, so a peer whose other side
 * lost its data stops being redialed.
 * @param request - authenticated request carrying `{ peerId }`.
 * @param service - the peer service.
 * @returns `{ ok: true }`, 409 while the channel is open, or 404 for an unknown peer.
 */
export async function handlePeerForget(request: Request, service: KetosPeerService): Promise<Response> {
  try {
    const rawPeerId = await readOnlyStringField(request, 'peerId')
    if (rawPeerId === undefined) return fail('ketos/invalid')
    const peerId = brandString<KetosPeerId>(rawPeerId)
    await service.forget(peerId)
    return ok({ ok: true })
  } catch (error: unknown) {
    if (error instanceof PeerServiceError) return fail(error.code)
    return new Response(null, { status: 500, headers: NO_STORE })
  }
}

/** The members of the peer service the transcript route uses. */
export type TranscriptRoutePeer = Pick<KetosPeerService, 'peers' | 'request'>

/** Dependencies and bound of the transcript route. */
export interface TranscriptRouteOptions {
  /** The board document the window records come from. */
  readonly board: TranscriptBoard
  /** How long the owner Ketos may take to answer, in milliseconds. */
  readonly timeoutMs: number
}

/**
 * Ask the Ketos that hosts a foreign chat window for its latest messages. The
 * owner alone decides whether this Ketos may read them; the route only finds
 * the window and its owner's open channel and relays the owner's answer. An
 * answer that is not one of the wire forms counts as an unavailable owner.
 * @param request - authenticated request carrying `{ windowId }`.
 * @param service - the peer service.
 * @param options - the board document and the answer timeout.
 * @returns `{ messages }`, 403/404 as the owner answered, 503 while the owner is unreachable or unavailable, or 504 on a timeout.
 */
export async function handlePeerTranscript(
  request: Request,
  service: TranscriptRoutePeer,
  options: TranscriptRouteOptions,
): Promise<Response> {
  try {
    const windowId = await readOnlyStringField(request, 'windowId')
    if (windowId === undefined) return fail('ketos/invalid')
    const { selfId, windows } = await options.board.snapshot()
    const record = windows.find(window => window.id === windowId)
    // Only a window another Ketos hosts has a transcript to ask for.
    if (record === undefined || record.kind !== 'agent' || record.hostId === selfId) return fail('ketos/window-not-found')
    const owner = service.peers().find(state => state.selfId === record.hostId && state.link === 'online')
    if (owner === undefined) return fail('ketos/peer-offline')
    let answer: unknown
    try {
      answer = await service.request(owner.peerId, 'chat.transcript.request', { windowId }, { timeoutMs: options.timeoutMs })
    } catch (error: unknown) {
      return fail(error instanceof PeerRequestTimeoutError ? 'ketos/peer-timeout' : 'ketos/peer-offline')
    }
    const wire = parseTranscriptWireResponse(answer)
    if (wire === undefined) return fail('ketos/peer-offline')
    if (wire.ok) return ok({ messages: wire.messages } satisfies TranscriptResponse)
    if (wire.reason === 'closed') return fail('ketos/transcript-closed')
    return fail(wire.reason === 'not-found' ? 'ketos/window-not-found' : 'ketos/peer-offline')
  } catch {
    return new Response(null, { status: 500, headers: NO_STORE })
  }
}

/**
 * Register all five routes on the connection's authenticated Fetch surface.
 * The registrations are effects of the calling fiber, so disposing the plugin
 * withdraws them.
 * @param ctx - context carrying `connection`.
 * @param service - the peer service.
 * @param transcript - the board document and timeout the transcript route uses.
 */
export function registerPeerRoutes(ctx: Context, service: KetosPeerService, transcript: TranscriptRouteOptions): void {
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
  ctx.connection.fetch.register({
    path: PEER_FORGET_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: request => handlePeerForget(request, service),
  })
  ctx.connection.fetch.register({
    path: PEER_TRANSCRIPT_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: request => handlePeerTranscript(request, service, transcript),
  })
}
