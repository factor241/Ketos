/**
 * Ketos peer channel host package: one iroh node with a stored key behind
 * `ctx.ketosPeer`, the framed message channel consumers of stages 33–35
 * extend, the one-time invitation code and the known-peer file that admit a
 * second Ketos, the participant record each side publishes, the
 * `/api/ketos.peer.state`, `/api/ketos.peer.invite`,
 * `/api/ketos.peer.connect`, and `/api/ketos.peer.forget` Fetch routes the
 * board's participants menu uses, the foreign chat window transcript: the
 * `chat.transcript.request` handler that answers the other Ketos and the
 * `/api/ketos.peer.transcript` route that asks it, and, with the optional
 * `syncthing` section, the link of both Ketoses' Syncthing devices to one
 * shared folder with its state on the peer state route.
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
import { readSyncthingApiKey, registerSyncthing, type SyncthingFeature } from './syncthing.ts'
import { resolveSyncthingSettings, type SyncthingConfig } from './syncthing-config.ts'
import {
  TRANSCRIPT_BYTES_PER_UNIT, TRANSCRIPT_ENVELOPE_RESERVE_BYTES, TRANSCRIPT_MESSAGES_MAX, TRANSCRIPT_MESSAGE_CHARS_MAX,
  TRANSCRIPT_MESSAGE_OVERHEAD_BYTES, registerTranscript,
} from './transcript.ts'

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
  /**
   * Largest accepted frame body, in bytes (1 KiB–64 MiB). It must be at least
   * `transcriptMaxBytes` plus 1 KiB, so with the default transcript bound it
   * cannot be below 66560.
   */
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
  /** Pause between two `peer.ping` frames on every channel, in milliseconds (500–30000). */
  heartbeatIntervalMs?: number
  /**
   * Longest time a channel may complete no read — a frame header or a body
   * slice of up to 16 KiB — before it closes with reason `heartbeat-timeout`,
   * the peer turns `lost`, and the redial starts, in milliseconds (1000–60000).
   * Must be at least twice `heartbeatIntervalMs`, so the pong to the first
   * ping after the last completed read has at least one interval to arrive.
   */
  heartbeatTimeoutMs?: number
  /** Local address the node binds, when the deployment pins one. */
  bindAddr?: string
  /** Most messages this Ketos returns for a chat window it hosts; the latest ones are kept (1–200). */
  transcriptMaxMessages?: number
  /**
   * Most UTF-16 code units of one returned message's text (1–100000).
   * `transcriptMaxBytes` must be at least this value times 6 plus 256, so the
   * longest message always fits.
   */
  transcriptMaxMessageChars?: number
  /**
   * Most bytes of one transcript response (1 KiB–1 MiB); the oldest messages
   * drop first. At least `transcriptMaxMessageChars` times 6 plus 256 (6 bytes
   * is the widest JSON escape of one UTF-16 unit). With the 1 KiB reserved for
   * the request envelope it must fit this Ketos's `maxFrameBytes`. A receiving
   * Ketos whose own `maxFrameBytes` is smaller than the response closes the link.
   */
  transcriptMaxBytes?: number
  /** How long this Ketos waits for another Ketos to answer a transcript request, in milliseconds (500–60000). */
  transcriptTimeoutMs?: number
  /**
   * The shared Syncthing folder. When present, the two Ketoses exchange their
   * Syncthing device ids over the channel and link the devices and the folder
   * through the local Syncthing REST API; when absent, the feature is off.
   */
  syncthing?: SyncthingConfig
}

/** Schemastery schema of the `syncthing` section's fields. */
const SyncthingFields: z<SyncthingConfig> = z.object({
  url: z.string().required(),
  apiKeyEnv: z.string().role('credential-ref').required(),
  relayAddress: z.string().required(),
  folderId: z.string().required(),
  folderPath: z.string().required(),
  fsWatcherDelayS: z.number().step(1).min(1).max(3600).default(10),
  statusRefreshMs: z.number().step(1).min(250).max(60_000).default(2000),
  requestTimeoutMs: z.number().step(1).min(100).max(60_000).default(5000),
  retryMs: z.number().step(1).min(100).max(600_000).default(2000),
  kickAfterLostMs: z.number().step(1).min(10_000).max(600_000).default(90_000),
})

/**
 * The `syncthing` section. A bare object schema materializes an absent value
 * as `{}` and would then require its fields; the union wrapper has no
 * default, so an absent section stays absent and the feature stays off.
 */
const SyncthingSection = z.union([SyncthingFields])

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
  heartbeatIntervalMs: z.number().step(1).min(500).max(30_000).default(3000),
  heartbeatTimeoutMs: z.number().step(1).min(1000).max(60_000).default(9000),
  bindAddr: z.string(),
  transcriptMaxMessages: z.number().step(1).min(1).max(TRANSCRIPT_MESSAGES_MAX).default(20),
  transcriptMaxMessageChars: z.number().step(1).min(1).max(TRANSCRIPT_MESSAGE_CHARS_MAX).default(4000),
  transcriptMaxBytes: z.number().step(1).min(1024).max(1_048_576).default(65_536),
  transcriptTimeoutMs: z.number().step(1).min(500).max(60_000).default(5000),
  syncthing: SyncthingSection,
})

/**
 * Own the peer node for the lifetime of the plugin: provide `ctx.ketosPeer`,
 * register its routes, wire board document synchronization, the transcript
 * handler, and, when the `syncthing` section is present, the Syncthing
 * feature, and close the transport when the fiber disposes. An invalid
 * `syncthing` section refuses the plugin; an unset Syncthing key turns off
 * only that feature. When the
 * known-peer file already names someone, the node starts without waiting for a
 * browser so the other side's redial finds an endpoint.
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
  // A transcript response travels in a request envelope; the reserve keeps a
  // response at its bound within the frame bound.
  if ((config.transcriptMaxBytes as number) + TRANSCRIPT_ENVELOPE_RESERVE_BYTES > (config.maxFrameBytes as number)) {
    throw new Error(
      `transcriptMaxBytes (${String(config.transcriptMaxBytes)}) plus ${String(TRANSCRIPT_ENVELOPE_RESERVE_BYTES)} bytes of envelope must not exceed maxFrameBytes (${String(config.maxFrameBytes)})`,
    )
  }
  // `fitBytes` drops a message that cannot fit alone, which a requester could
  // not tell from an empty chat; the bound must hold the longest message.
  const longestMessageBytes = (config.transcriptMaxMessageChars as number) * TRANSCRIPT_BYTES_PER_UNIT + TRANSCRIPT_MESSAGE_OVERHEAD_BYTES
  if (longestMessageBytes > (config.transcriptMaxBytes as number)) {
    throw new Error(
      `transcriptMaxBytes (${String(config.transcriptMaxBytes)}) must be at least ${String(longestMessageBytes)} (transcriptMaxMessageChars ${String(config.transcriptMaxMessageChars)} x ${String(TRANSCRIPT_BYTES_PER_UNIT)} + ${String(TRANSCRIPT_MESSAGE_OVERHEAD_BYTES)}) so the longest message fits`,
    )
  }
  if ((config.reconnectMinMs as number) > (config.reconnectMaxMs as number)) {
    throw new Error(
      `reconnectMinMs (${String(config.reconnectMinMs)}) must not exceed reconnectMaxMs (${String(config.reconnectMaxMs)})`,
    )
  }
  // The first ping after the last completed read leaves within one interval;
  // the rule gives its pong at least one more interval to arrive.
  if ((config.heartbeatTimeoutMs as number) < 2 * (config.heartbeatIntervalMs as number)) {
    throw new Error(
      `heartbeatTimeoutMs (${String(config.heartbeatTimeoutMs)}) must be at least twice heartbeatIntervalMs (${String(config.heartbeatIntervalMs)})`,
    )
  }
  const syncthing = config.syncthing === undefined ? undefined : resolveSyncthingSettings(config.syncthing)
  // The feature needs the service and the service reads the feature's state:
  // the feature is assigned right after the service exists, and the service
  // calls the reader only from route calls, which run after apply returned.
  let feature: SyncthingFeature
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
    heartbeatIntervalMs: config.heartbeatIntervalMs as number,
    heartbeatTimeoutMs: config.heartbeatTimeoutMs as number,
    ...config.bindAddr === undefined ? {} : { bindAddr: config.bindAddr },
    ...syncthing === undefined ? {} : { sharedFolder: () => feature.sharedFolder() },
    logger: (message) => { ctx.logger('ketos-peer').warn(message) },
  })
  ctx.effect(() => () => service.close(), 'ketos-peer: node')
  registerPeerRoutes(ctx, service, {
    board: ctx.ketosBoardDoc,
    timeoutMs: config.transcriptTimeoutMs as number,
  })
  registerTranscript(ctx, service, ctx.ketosBoardDoc, {
    maxMessages: config.transcriptMaxMessages as number,
    maxMessageChars: config.transcriptMaxMessageChars as number,
    maxBytes: config.transcriptMaxBytes as number,
    logger: (message) => { ctx.logger('ketos-peer').warn(message) },
  })
  registerBoardSync(ctx, service, ctx.ketosBoardDoc, {
    maxSyncUpdateBytes: config.maxSyncUpdateBytes as number,
    reconnectMinMs: config.reconnectMinMs as number,
    reconnectMaxMs: config.reconnectMaxMs as number,
    logger: (message) => { ctx.logger('ketos-peer').warn(message) },
  })
  if (syncthing !== undefined) {
    feature = registerSyncthing(ctx, service, syncthing, {
      logger: (message) => { ctx.logger('ketos-peer').warn(message) },
      resolveApiKey: () => readSyncthingApiKey(ctx, syncthing.apiKeyEnv),
    })
    void feature.started.catch((error: unknown) => {
      ctx.logger('ketos-peer').warn(`ketos-peer: syncthing start failed: ${String(error)}`)
    })
  }
  void service.startIfKnownPeers().catch((error: unknown) => {
    ctx.logger('ketos-peer').warn(`ketos-peer: start with known peers failed: ${String(error)}`)
  })
}
