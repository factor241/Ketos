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

/**
 * State of the shared Syncthing folder as the browser reads it, from the
 * latest poll of the local Syncthing and the current Ketos channel states:
 *
 * - `unavailable` — the local Syncthing gives no answer: nothing listens, or
 *   a request ran out of time;
 * - `waiting` — the first poll has not completed; the folder is missing or
 *   not running; no other device of the folder is connected; the folder
 *   state is none of `idle`, `error`, or a scanning or transferring state
 *   (`unknown`, for example) while nothing is needed; no connected device of
 *   the folder carries the name `ketos:<peer id>`; the Ketos channel to no
 *   peer of such a device is online, whether the folder syncs or is idle and
 *   although Syncthing may still report the device connected; or no peer
 *   with an online channel has its Syncthing sharing the folder back (its
 *   `remoteState` is not `valid`);
 * - `syncing` — the Ketos channel to the peer of a connected
 *   `ketos:<peer id>` device is online and the folder scans, prepares,
 *   transfers, cleans, starts, or waits to do one of these, or this device
 *   still needs items or deletions; or the folder is idle and every peer with
 *   an online channel whose Syncthing shares the folder back still needs
 *   items or deletions;
 * - `synced` — the folder is idle and needs nothing, and a connected device
 *   named `ketos:<peer id>` belongs to a peer whose Ketos channel is online
 *   and whose Syncthing shares the folder back and needs nothing;
 * - `error` — Syncthing refuses a request (a wrong API key, 401 or 403, or
 *   another error status such as a 5xx), answers without a field this
 *   package reads or with no JSON at all, the API key is no longer set or
 *   can no longer be read, Syncthing's discovery and listening settings
 *   diverge from the stand's private-relay settings, or the folder reports
 *   `error`.
 */
export type SharedFolderState = 'unavailable' | 'waiting' | 'syncing' | 'synced' | 'error'

/** Answer of `GET /api/ketos.peer.state`. */
export interface PeerStateResponse {
  /** The local node's own participant record. */
  readonly self: PeerSelfState
  /** Every known peer with its current link state. */
  readonly peers: readonly PeerState[]
  /** How often the browser should poll this route, in milliseconds. */
  readonly refreshMs: number
  /** State of the shared Syncthing folder; absent when the Syncthing feature is off. */
  readonly sharedFolder?: SharedFolderState
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
  | 'ketos/transcript-closed'
  | 'ketos/window-not-found'
  | 'ketos/peer-timeout'

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

/** One message of a foreign chat window's read-only transcript. */
export interface TranscriptMessage {
  /** Who wrote the message: the human user or the agent. */
  readonly role: 'user' | 'agent'
  /** The message text, already cut to the owner's `transcriptMaxMessageChars`. */
  readonly text: string
  /** ISO-8601 UTC time the session log recorded the message. */
  readonly at: string
}

/** Answer of a successful `POST /api/ketos.peer.transcript`: oldest message first. */
export interface TranscriptResponse {
  /** The window's latest messages within the owner's limits. */
  readonly messages: readonly TranscriptMessage[]
}
