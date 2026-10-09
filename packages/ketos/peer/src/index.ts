/**
 * Ketos peer channel host package: one iroh node with a stored key behind
 * `ctx.ketosPeer`, the framed message channel consumers of stages 33–35
 * extend, the one-time invitation code and the known-peer file that admit a
 * second Ketos, the participant record each side publishes, and the
 * `/api/ketos.peer.state`, `/api/ketos.peer.invite`,
 * `/api/ketos.peer.connect`, and `/api/ketos.peer.forget` Fetch routes the
 * board's participants menu uses.
 *
 * The native module loads lazily on the first node use, and the shipped web
 * profile carries the row disabled, so a developer machine without the stand
 * never loads it.
 * @module @ketos/peer
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerBoardSync } from './board-sync.ts'
import { registerPeerRoutes } from './routes.ts'
import { KetosPeerService } from './service.ts'

/** Loader entry name of the plugin. */
export const name = 'ketos-peer'

/** Services the plugin needs at its root: the Fetch surface and the board document. */
export const inject = ['connection', 'ketosBoardDoc']

/** Deployment configuration of the peer node. */
export interface Config {
  /** Participant name this Ketos publishes to the other side. */
  name: string
  /** Relay URLs of the team's private iroh relay, the node's only relay map; at least one is required. */
  relayUrls: string[]
  /** Path of the stored 32-byte node key; the parent directory is created owner-only. */
  keyPath: string
  /** Path of the known-peer file. */
  peersPath: string
  /** Largest accepted frame body, in bytes (1 KiB–64 MiB). */
  maxFrameBytes?: number
  /**
   * Largest board synchronization update this Ketos sends, in bytes
   * (1 KiB–64 MiB); must be less than `maxFrameBytes`.
   */
  maxSyncUpdateBytes?: number
  /** How long `invite()` waits for a relay address, in milliseconds (1000–120000). */
  onlineTimeoutMs?: number
  /** How long a dial or handshake step may take, in milliseconds (1000–120000). */
  connectTimeoutMs?: number
  /** First reconnection and board resynchronization pause, in milliseconds (100–60000); must not exceed `reconnectMaxMs`. */
  reconnectMinMs?: number
  /**
   * Reconnection pause ceiling, in milliseconds (100–600000, default 20000);
   * a jittered pause never exceeds it, and a link that lived for less than
   * this long counts as a failed attempt. Must be at least `reconnectMinMs`.
   */
  reconnectMaxMs?: number
  /** Lifetime of one invitation secret, in milliseconds (60000–86400000). */
  inviteTtlMs?: number
  /** Poll interval the state route publishes, in milliseconds (250–60000). */
  stateRefreshMs?: number
  /** Local address the node binds, when the deployment pins one. */
  bindAddr?: string
}

/** Schemastery configuration of the peer node; identity and paths are required. */
export const Config: z<Config> = z.object({
  name: z.string().required().min(1).max(64),
  relayUrls: z.array(z.string()).required().min(1),
  keyPath: z.string().required(),
  peersPath: z.string().required(),
  maxFrameBytes: z.number().step(1).min(1024).max(67_108_864).default(16_777_216),
  maxSyncUpdateBytes: z.number().step(1).min(1024).max(67_108_864).default(15_728_640),
  onlineTimeoutMs: z.number().step(1).min(1000).max(120_000).default(15_000),
  connectTimeoutMs: z.number().step(1).min(1000).max(120_000).default(10_000),
  reconnectMinMs: z.number().step(1).min(100).max(60_000).default(1000),
  reconnectMaxMs: z.number().step(1).min(100).max(600_000).default(20_000),
  inviteTtlMs: z.number().step(1).min(60_000).max(86_400_000).default(3_600_000),
  stateRefreshMs: z.number().step(1).min(250).max(60_000).default(1000),
  bindAddr: z.string(),
})

/**
 * Own the peer node for the lifetime of the plugin: provide `ctx.ketosPeer`,
 * register its routes, wire board document synchronization, and close the
 * transport when the fiber disposes. When the known-peer file already names
 * someone, the node starts without waiting for a browser so the other side's
 * redial finds an endpoint.
 * @param ctx - host context carrying `connection` and `ketosBoardDoc`.
 * @param config - deployment's identity, paths, relay, and bounds.
 */
export function apply(ctx: Context, config: Config): void {
  // The synchronization bound must leave room for the frame header: a body the
  // link would refuse at the sender must be caught before an update exists.
  if ((config.maxSyncUpdateBytes as number) >= (config.maxFrameBytes as number)) {
    throw new Error(
      `maxSyncUpdateBytes (${String(config.maxSyncUpdateBytes)}) must be less than maxFrameBytes (${String(config.maxFrameBytes)})`,
    )
  }
  if ((config.reconnectMinMs as number) > (config.reconnectMaxMs as number)) {
    throw new Error(
      `reconnectMinMs (${String(config.reconnectMinMs)}) must not exceed reconnectMaxMs (${String(config.reconnectMaxMs)})`,
    )
  }
  const service = new KetosPeerService(ctx, {
    name: config.name,
    relayUrls: config.relayUrls,
    keyPath: config.keyPath,
    peersPath: config.peersPath,
    maxFrameBytes: config.maxFrameBytes as number,
    onlineTimeoutMs: config.onlineTimeoutMs as number,
    connectTimeoutMs: config.connectTimeoutMs as number,
    reconnectMinMs: config.reconnectMinMs as number,
    reconnectMaxMs: config.reconnectMaxMs as number,
    inviteTtlMs: config.inviteTtlMs as number,
    stateRefreshMs: config.stateRefreshMs as number,
    ...config.bindAddr === undefined ? {} : { bindAddr: config.bindAddr },
    logger: (message) => { ctx.logger('ketos-peer').warn(message) },
  })
  ctx.effect(() => () => service.close(), 'ketos-peer: node')
  registerPeerRoutes(ctx, service)
  registerBoardSync(ctx, service, ctx.ketosBoardDoc, {
    maxSyncUpdateBytes: config.maxSyncUpdateBytes as number,
    reconnectMinMs: config.reconnectMinMs as number,
    reconnectMaxMs: config.reconnectMaxMs as number,
    logger: (message) => { ctx.logger('ketos-peer').warn(message) },
  })
  void service.startIfKnownPeers().catch((error: unknown) => {
    ctx.logger('ketos-peer').warn(`ketos-peer: start with known peers failed: ${String(error)}`)
  })
}
