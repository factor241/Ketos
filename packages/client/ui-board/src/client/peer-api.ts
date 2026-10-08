/**
 * Browser client of the peer routes: the polling state read, the invitation
 * mint, and the connect post.
 *
 * The state read answers `{ self, peers, refreshMs }` while the peer plugin is
 * enabled and 404 when the deployment runs without it; the caller maps a
 * failure to the dock's "peer networking is not configured" mode. Every
 * decoded value is validated before it reaches the store, and every failure
 * collapses to one of the stable codes the participants surface names.
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import type {
  PeerConnectResponse, PeerErrorCode, KetosPeerId, PeerInviteResponse, PeerLinkState, PeerState, PeerStateResponse,
  PeerSelfState,
} from '@ketos/peer/types'
import { isFiniteNumber, isRecord } from './board-doc-api.ts'
import type {
  BoardPeerConnectOutcome, BoardPeerFailureCode, BoardPeerInviteOutcome,
} from './contract/slots.ts'
import { ketosRoute } from './ketos-route.ts'

/** Path of the peer state route on the host. */
export const PEER_STATE_PATH = '/api/ketos.peer.state'

/** Path of the invitation route on the host. */
export const PEER_INVITE_PATH = '/api/ketos.peer.invite'

/** Path of the connect route on the host. */
export const PEER_CONNECT_PATH = '/api/ketos.peer.connect'

/** Outcome of one state poll. */
export type PeerStateOutcome =
  | { readonly ok: true; readonly state: PeerStateResponse }
  | { readonly ok: false; readonly code: BoardPeerFailureCode }

/** Whether a decoded value is a palette color number (1–10). */
function isPaletteColor(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 10
}

/** Whether a decoded value is one of the three link states. */
function isPeerLinkState(value: unknown): value is PeerLinkState {
  return value === 'online' || value === 'connecting' || value === 'lost'
}

/** Whether a decoded value is a complete local participant record. */
function isPeerSelfState(value: unknown): value is PeerSelfState {
  if (!isRecord(value)) return false
  return typeof value['selfId'] === 'string' && value['selfId'] !== ''
    && typeof value['name'] === 'string'
    && isPaletteColor(value['color'])
}

/** Whether a decoded value is a complete known-peer record. */
function isPeerState(value: unknown): value is PeerState {
  if (!isRecord(value)) return false
  return typeof value['peerId'] === 'string' && value['peerId'] !== ''
    && typeof value['selfId'] === 'string' && value['selfId'] !== ''
    && typeof value['name'] === 'string'
    && isPaletteColor(value['color'])
    && isPeerLinkState(value['link'])
}

/**
 * Decode one state answer.
 * @param value - decoded JSON value.
 * @returns whether the value is a complete state answer.
 */
export function isPeerStateResponse(value: unknown): value is PeerStateResponse {
  if (!isRecord(value)) return false
  return isPeerSelfState(value['self'])
    && Array.isArray(value['peers']) && value['peers'].every(isPeerState)
    && isFiniteNumber(value['refreshMs']) && value['refreshMs'] > 0
}

/** Whether a decoded value is a complete invitation answer. */
function isPeerInviteResponse(value: unknown): value is PeerInviteResponse {
  return isRecord(value) && typeof value['invite'] === 'string' && value['invite'] !== ''
}

/** Whether a decoded value is a complete connect answer. */
function isPeerConnectResponse(value: unknown): value is PeerConnectResponse {
  return isRecord(value) && typeof value['peerId'] === 'string' && value['peerId'] !== ''
}

/** Whether a decoded value is one of the host's stable peer codes. */
function isPeerErrorCode(value: unknown): value is PeerErrorCode {
  return value === 'ketos/invalid'
    || value === 'ketos/peer-self'
    || value === 'ketos/invite-used'
    || value === 'ketos/peer-unreachable'
    || value === 'ketos/peer-offline'
}

/**
 * Read one failure's stable code from a response body: the host's peer code
 * when the body names one, the client's unreachable code otherwise.
 * @param response - the failed response.
 * @returns the stable failure code.
 */
async function failureCode(response: Response): Promise<BoardPeerFailureCode> {
  const payload: unknown = await response.json().catch(() => undefined)
  if (isRecord(payload) && isPeerErrorCode(payload['error'])) return payload['error']
  return 'ketos/unreachable'
}

/**
 * Read the peer state. A 404 means the deployment runs without peer
 * networking; any other failure is reported as unreachable.
 * @param signal - aborts the request and its response read.
 * @returns the decoded state, or the stable failure code.
 */
export async function fetchPeerState(signal?: AbortSignal): Promise<PeerStateOutcome> {
  try {
    const response = await fetch(ketosRoute(PEER_STATE_PATH.slice(1)), {
      headers: { accept: 'application/json' },
      ...(signal === undefined ? {} : { signal }),
    })
    if (response.status === 404) return { ok: false, code: 'ketos/peer-unavailable' }
    if (!response.ok) return { ok: false, code: 'ketos/unreachable' }
    const payload: unknown = await response.json()
    if (!isPeerStateResponse(payload)) return { ok: false, code: 'ketos/unreachable' }
    return { ok: true, state: payload }
  } catch {
    return { ok: false, code: 'ketos/unreachable' }
  }
}

/**
 * Mint a one-time invitation code on the host.
 * @returns the code, or the stable failure code.
 */
export async function createInvite(): Promise<BoardPeerInviteOutcome> {
  try {
    const response = await fetch(ketosRoute(PEER_INVITE_PATH.slice(1)), { headers: { accept: 'application/json' } })
    if (!response.ok) return { ok: false, code: await failureCode(response) }
    const payload: unknown = await response.json().catch(() => undefined)
    if (!isPeerInviteResponse(payload)) return { ok: false, code: 'ketos/unreachable' }
    return { ok: true, invite: payload.invite }
  } catch {
    return { ok: false, code: 'ketos/unreachable' }
  }
}

/**
 * Connect the local node to the node one invitation code names.
 * @param invite - the invitation code the other Ketos displayed.
 * @returns the connected peer's id, or the stable failure code.
 */
export async function connectPeer(invite: string): Promise<BoardPeerConnectOutcome> {
  try {
    const response = await fetch(ketosRoute(PEER_CONNECT_PATH.slice(1)), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invite }),
    })
    if (!response.ok) return { ok: false, code: await failureCode(response) }
    const payload: unknown = await response.json().catch(() => undefined)
    if (!isPeerConnectResponse(payload)) return { ok: false, code: 'ketos/unreachable' }
    return { ok: true, peerId: brandString<KetosPeerId>(payload.peerId) }
  } catch {
    return { ok: false, code: 'ketos/unreachable' }
  }
}
