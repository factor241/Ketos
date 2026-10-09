/**
 * The peer channel's browser-safe vocabulary: the branded identity of one
 * connected Ketos, the link states and peer records `/api/ketos.peer.state`
 * reports, and the stable error codes the peer routes answer with.
 *
 * The module is types only, so the board's browser code imports it without
 * pulling the native iroh module or any host module into the client bundle.
 * @module @ketos/peer/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { OwnerId } from '@ketos/board-doc/types'

/** Identity of one connected Ketos: the hex string of its iroh `EndpointId`. */
export type KetosPeerId = Branded<'KetosPeerId'>

/** Connection state of one known peer as the browser reads it. */
export type PeerLinkState = 'online' | 'connecting' | 'lost'

/** One known peer, whether connected, dialing, or waiting for a retry. */
export interface PeerState {
  /** Identity of the peer's iroh node. */
  readonly peerId: KetosPeerId
  /** The peer's board participant id. */
  readonly selfId: OwnerId
  /** The peer's participant name. */
  readonly name: string
  /** The peer's palette color, 1–10. */
  readonly color: number
  /** Current state of the channel to this peer. */
  readonly link: PeerLinkState
}

/** The local Ketos as the peer state reports it. */
export interface PeerSelfState {
  /** The local board participant id. */
  readonly selfId: OwnerId
  /** The local participant name from configuration. */
  readonly name: string
  /** The local palette color, 1–10. */
  readonly color: number
}

/** Answer of `GET /api/ketos.peer.state`. */
export interface PeerStateResponse {
  /** The local node's own participant record. */
  readonly self: PeerSelfState
  /** Every known peer with its current link state. */
  readonly peers: readonly PeerState[]
  /** How often the browser should poll this route, in milliseconds. */
  readonly refreshMs: number
}

/** Stable error code of the peer routes. */
export type PeerErrorCode =
  | 'ketos/invalid'
  | 'ketos/peer-self'
  | 'ketos/invite-used'
  | 'ketos/peer-unreachable'
  | 'ketos/peer-offline'
  | 'ketos/peer-online'
  | 'ketos/peer-unknown'

/** Answer of a successful `POST /api/ketos.peer.connect`. */
export interface PeerConnectResponse {
  /** Identity of the peer the local node connected to. */
  readonly peerId: KetosPeerId
}

/** Answer of a successful `GET /api/ketos.peer.invite`. */
export interface PeerInviteResponse {
  /** The one-time invitation code to hand to the second Ketos. */
  readonly invite: string
}

/** Answer of a successful `POST /api/ketos.peer.forget`. */
export interface PeerForgetResponse {
  /** Always true; a refusal answers `{ ok: false, error }` instead. */
  readonly ok: true
}
