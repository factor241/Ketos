/**
 * The transport seam of the peer channel: the byte-stream, connection, and
 * endpoint interfaces the service drives. The iroh implementation lives in
 * `iroh-transport.ts`; tests use the in-memory implementation, so every piece
 * above this seam — framing, handshake, invitations, reconnection — runs
 * without a network or the native module.
 * @module @ketos/peer/transport
 */

import type { KetosPeerId } from './types.ts'

/** One bidirectional byte stream of a peer connection. */
export interface PeerStream {
  /**
   * Append bytes to the stream. Calls are serialized by the link's write
   * queue; the returned promise settles when the transport accepted them.
   * @param bytes - the bytes to write.
   */
  write(bytes: Uint8Array): Promise<void>
  /**
   * Read exactly the given number of bytes, waiting for the writer.
   * @param length - how many bytes to read.
   * @returns the bytes, or a rejection when the stream ends early.
   */
  readExact(length: number): Promise<Uint8Array>
  /** Finish the outgoing half of the stream. */
  finish(): Promise<void>
}

/** One open connection to a remote peer node. */
export interface PeerConnection {
  /** Identity of the remote node. */
  readonly peerId: KetosPeerId
  /**
   * Open the connection's single bidirectional stream. Only the dialing side
   * calls this.
   * @returns the stream.
   */
  openStream(): Promise<PeerStream>
  /**
   * Wait for the stream the dialing side opened. The receiving side's wait
   * settles once the first bytes arrive, which is why the dialer writes its
   * `hello` frame first.
   * @returns the stream.
   */
  acceptStream(): Promise<PeerStream>
  /**
   * A promise that settles with the transport's close reason when the
   * connection ends, from either side or a network failure.
   * @returns the close reason.
   */
  closed(): Promise<string>
  /**
   * Close the connection with an application code and reason.
   * @param code - application close code.
   * @param reason - short reason text, never carrying user data.
   */
  close(code: bigint, reason: string): void
}

/**
 * One side of the peer transport: a bound node identity plus the dial and
 * accept halves of the connection flow.
 */
export interface PeerTransport {
  /**
   * This node's own identity.
   * @returns the local peer id.
   */
  selfId(): KetosPeerId
  /** Bind the node so it can dial and accept. */
  bind(): Promise<void>
  /**
   * Wait until the node has a usable home relay address, then resolve. A
   * transport with no relays configured resolves once bound.
   */
  online(): Promise<void>
  /**
   * The invitation ticket of this node, addressable by another Ketos. Only
   * valid after {@link PeerTransport.online}; an implementation rejects when
   * the address carries no relay URL.
   * @returns the ticket string.
   */
  invitationTicket(): string
  /**
   * The remote identity one ticket addresses, without dialing it.
   * @param ticket - the ticket string.
   * @returns the peer id the ticket names.
   */
  ticketPeerId(ticket: string): KetosPeerId
  /**
   * Open one connection to the node a ticket names.
   * @param ticket - the remote node's ticket string.
   * @returns the open connection.
   */
  dial(ticket: string): Promise<PeerConnection>
  /**
   * Wait for the next incoming connection.
   * @returns the accepted connection.
   */
  accept(): Promise<PeerConnection>
  /** Close the node and every connection it holds. */
  close(): Promise<void>
}
