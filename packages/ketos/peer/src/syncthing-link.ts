/**
 * Linking the two Ketoses' Syncthing devices over the peer channel.
 *
 * When a channel connects, this Ketos sends its own Syncthing device id in a
 * `syncthing.device` frame. A received frame is applied to the local
 * Syncthing: the peer's device first — `ketos:<peer id>`, dialed only at the
 * private relay, never accepting folders by itself — then the shared folder,
 * created with a complete body when it is missing and otherwise patched with
 * the merged device list. A device of the same peer under another id (its
 * Syncthing volume was wiped) leaves the folder and the configuration, so the
 * device list does not grow. Every application runs in one queue, compares
 * the folder's devices as a set without the own device, and writes nothing
 * when the configuration already matches, so each reconnection re-checks the
 * link at the cost of reads only.
 *
 * When the channel to a peer was lost for at least `kickAfterLostMs` before
 * it connects again, the first application of that connection whose peer
 * device is already configured under the same id restarts Syncthing's
 * connection to it: it pauses the device, then resumes it even when the pause
 * failed. After such an outage the relay session is gone, yet Syncthing may
 * keep the dead connection counted as connected for more than a minute; the
 * pause closes it, and the resume dials the device at once. A shorter outage,
 * a first connection, and a connection without a preceding loss get no
 * restart: Syncthing's connection survives short outages, and each restart
 * spends one of the few immediate redials Syncthing allows per device. A
 * first linking and a replaced device need no restart either, because
 * Syncthing dials a new device by itself. The loss is measured on the wall
 * clock from the `ketos-peer/disconnected` event to the next
 * `ketos-peer/connected` event. The restart belongs to the application step:
 * a failed pause or resume fails the step, and a retry restarts again.
 *
 * Every application also resumes the peer device when Syncthing reports it
 * paused although it otherwise matches, with one `POST /rest/system/resume`
 * and no restart, since the resume dials the device at once. A device left
 * paused by a failed resume, by a restart that a stopped Ketos interrupted,
 * or in the Syncthing GUI is therefore resumed at the next application, and
 * a device that is not paused costs no request.
 *
 * Both steps retry every `retryMs` while Syncthing gives no answer, times
 * out, or answers with a server error (5xx) — the two programs start in
 * parallel — and after any failure that is not a `SyncthingError`, such as a
 * frame the channel could not send. Any other `SyncthingError` — a refused
 * key (401, 403), another client error, a malformed answer, or an API key
 * that is no longer set — stops the step with one log line, and the next
 * connection of the channel starts both steps again. A retrying step logs its
 * first failure only. The peer's
 * disconnection and plugin disposal end both steps, and a newer id from the
 * same peer ends the application of the previous one, including an
 * application that still waits in the queue.
 *
 * When a peer is forgotten, every device named `ketos:<peer id>` other than
 * the own device leaves the folder and then the configuration, in the same
 * queue and with the same retries; a refused removal stops with one log line
 * and leaves the device configured. A device id the peer sends again, after a
 * new invitation, ends a removal that has not run yet.
 * @module @ketos/peer/syncthing-link
 */

import { setTimeout as sleep } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import { parsePeerId } from './peers-file.ts'
import { SyncthingError, type SyncthingClient, type SyncthingDevice } from './syncthing-client.ts'
import { parseSyncthingDeviceId, type SyncthingDeviceId } from './syncthing-device-id.ts'
import type { KetosPeerId } from './types.ts'

/** Body of a `syncthing.device` frame: the sender's own Syncthing device id. */
export interface SyncthingDeviceFrame {
  /** The sender's device id in canonical form. */
  readonly deviceId: SyncthingDeviceId
}

declare module './frame.ts' {
  interface PeerFrameTypeMap {
    'syncthing.device': SyncthingDeviceFrame
  }
}

/** The members of the peer node the linking uses; `KetosPeerService` provides them. */
export interface SyncthingLinkPeer {
  /**
   * Register the handler for device frames.
   * @param type - the frame type.
   * @param handler - receives the frame body and the sending peer.
   * @returns the unsubscribe function.
   */
  handle(type: 'syncthing.device', handler: (payload: unknown, from: KetosPeerId) => unknown): () => void
  /**
   * Send one device frame to a connected peer.
   * @param peerId - the receiving peer.
   * @param type - the frame type.
   * @param payload - the frame body.
   * @returns a promise settling when the transport accepted the bytes.
   */
  send(peerId: KetosPeerId, type: 'syncthing.device', payload: SyncthingDeviceFrame): Promise<void>
}

/** The REST calls the linking makes. */
export type SyncthingLinkClient = Pick<
  SyncthingClient,
  | 'systemStatus' | 'listDevices' | 'getDevice' | 'putDevice' | 'deleteDevice' | 'getFolder' | 'putFolder' | 'patchFolder'
  | 'pauseDevice' | 'resumeDevice'
>

/** Deployment inputs of the linking. */
export interface SyncthingLinkOptions {
  /** The private relay address, without a token, every peer device is dialed at. */
  readonly relayAddress: string
  /** Id of the shared folder. */
  readonly folderId: string
  /** Directory of the shared folder, used when the folder is created. */
  readonly folderPath: string
  /** Seconds the watcher of a created folder collects changes before a scan. */
  readonly fsWatcherDelayS: number
  /** Pause before a step that failed transiently is retried, in milliseconds. */
  readonly retryMs: number
  /** Shortest channel loss after which a reconnection restarts Syncthing's connection to the peer device, in milliseconds. */
  readonly kickAfterLostMs: number
  /** Receives one line per link change and anomaly; never a key, token, or address. */
  readonly logger: (message: string) => void
}

/** Prefix of the Syncthing device name the linking gives a peer's device; the peer id follows it. */
const PEER_DEVICE_PREFIX = 'ketos:'

/** What a stopped linking step leaves to the next attempt. */
const LINK_STOPPED = 'the next channel connection tries again'

/** What a stopped removal of a forgotten peer's device leaves behind. */
const UNLINK_STOPPED = 'the device stays configured until it is removed in the Syncthing GUI'

/**
 * The Syncthing device name the linking gives one peer's device.
 * @param peerId - the peer the device belongs to.
 * @returns `ketos:<peer id>`.
 */
export function peerDeviceName(peerId: KetosPeerId): string {
  return `${PEER_DEVICE_PREFIX}${String(peerId)}`
}

/**
 * The peer one Syncthing device name belongs to. The name comes from
 * Syncthing's answer, so the part after the prefix is validated with the
 * known-peer file's peer id rule.
 * @param name - the device name from Syncthing's configuration.
 * @returns the peer id, or undefined for a name the linking does not give or whose peer id is invalid.
 */
export function peerOfDeviceName(name: string): KetosPeerId | undefined {
  return name.startsWith(PEER_DEVICE_PREFIX) ? parsePeerId(name.slice(PEER_DEVICE_PREFIX.length)) : undefined
}

/**
 * Validate a decoded `syncthing.device` body at the wire boundary.
 * @param payload - the decoded frame body.
 * @returns the device id, or undefined unless the body is an object whose only field is a canonical `deviceId`.
 */
export function parseSyncthingDeviceFrame(payload: unknown): SyncthingDeviceId | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined
  const source = payload as Record<string, unknown>
  const keys = Object.keys(source)
  if (keys.length !== 1 || keys[0] !== 'deviceId') return undefined
  return parseSyncthingDeviceId(source.deviceId)
}

/**
 * Shorten one peer id for a log line.
 * @param peerId - the full peer id.
 * @returns its leading characters.
 */
function short(peerId: KetosPeerId): string {
  return String(peerId).slice(0, 12)
}

/**
 * Whether a signal aborted. A call, unlike a property read, keeps an earlier
 * check from narrowing away an abort that happened during an `await`.
 * @param signal - the signal.
 * @returns true after the abort.
 */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/**
 * Whether a stored device already is the device the linking would write,
 * apart from a pause, which a resume clears without a write.
 * @param stored - the device Syncthing has.
 * @param desired - the device the linking writes.
 * @returns true when the name, addresses, and folder acceptance match.
 */
function sameDevice(stored: SyncthingDevice, desired: SyncthingDevice): boolean {
  return stored.name === desired.name
    && stored.autoAcceptFolders === desired.autoAcceptFolders
    && stored.addresses.length === desired.addresses.length
    && stored.addresses.every((address, index) => address === desired.addresses[index])
}

/**
 * Wire the linking into the calling fiber: the frame handler, the connection
 * announcement, and the retries, all ended by disposal.
 * @param ctx - context the peer events are emitted on.
 * @param peer - the peer node to exchange device ids over.
 * @param client - the REST client once the feature is on; undefined while it stays off.
 * @param options - folder, relay, retry pause, and log sink.
 */
export function registerSyncthingLink(
  ctx: Context,
  peer: SyncthingLinkPeer,
  client: Promise<SyncthingLinkClient | undefined>,
  options: SyncthingLinkOptions,
): void {
  const log = options.logger
  const announces = new Map<KetosPeerId, AbortController>()
  const applies = new Map<KetosPeerId, AbortController>()
  /** When the channel to each peer was lost, for the peers whose channel is lost now. */
  const lostAt = new Map<KetosPeerId, number>()
  /** Peers whose channel connected after a long loss and whose next application has not decided on a connection restart yet. */
  const restartDue = new Set<KetosPeerId>()
  let queue: Promise<void> = Promise.resolve()

  /** Run one folder change after every earlier one settled. */
  const serialized = (task: () => Promise<void>): Promise<void> => {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  /** Start a step for one peer, cancelling that peer's previous step of the same kind. */
  const restart = (tasks: Map<KetosPeerId, AbortController>, peerId: KetosPeerId): AbortSignal => {
    tasks.get(peerId)?.abort()
    const controller = new AbortController()
    tasks.set(peerId, controller)
    return controller.signal
  }

  /**
   * Run a step until it succeeds, a Syncthing failure that is not transient
   * stops it with one line that ends with `stopped`, or its signal aborts.
   * Any other failure is retried, and only its first occurrence is logged.
   */
  const retrying = async (
    signal: AbortSignal,
    label: string,
    stopped: string,
    step: (rest: SyncthingLinkClient) => Promise<void>,
  ): Promise<void> => {
    const rest = await client
    if (rest === undefined || isAborted(signal)) return
    let failed = false
    for (;;) {
      try {
        await step(rest)
        return
      } catch (error: unknown) {
        // A step that failed because its channel or the plugin went away is no anomaly.
        if (isAborted(signal)) return
        if (error instanceof SyncthingError && !error.transient) {
          log(`ketos-peer: syncthing.link-stopped: ${label} failed (${String(error)}); ${stopped}`)
          return
        }
        if (!failed) log(`ketos-peer: syncthing.retry: ${label} failed (${String(error)}); retrying every ${String(options.retryMs)} ms`)
        failed = true
      }
      try {
        await sleep(options.retryMs, undefined, { signal, ref: false })
      } catch {
        // The pause ends early only through the abort, which ends the step.
        return
      }
    }
  }

  /** Close Syncthing's connection to a peer device and dial it again: pause the device, then resume it even when the pause failed. */
  const restartConnection = async (rest: SyncthingLinkClient, deviceId: SyncthingDeviceId): Promise<void> => {
    try {
      await rest.pauseDevice(deviceId)
    } finally {
      await rest.resumeDevice(deviceId)
    }
  }

  /**
   * Apply one peer's device id: device first, then the folder, then stale
   * devices, then the connection restart a channel connection asked for.
   */
  const link = async (rest: SyncthingLinkClient, peerId: KetosPeerId, deviceId: SyncthingDeviceId): Promise<void> => {
    const { myID } = await rest.systemStatus()
    if (deviceId === myID) {
      log(`ketos-peer: syncthing.device-invalid from ${short(peerId)}: the own device id`)
      return
    }
    const name = peerDeviceName(peerId)
    const desired: SyncthingDevice = {
      deviceID: deviceId, name, addresses: [options.relayAddress], autoAcceptFolders: false, paused: false,
    }
    const stale = (await rest.listDevices())
      .filter(device => device.name === name && device.deviceID !== deviceId && device.deviceID !== myID)
      .map(device => device.deviceID)
    let wrote = false
    const stored = await rest.getDevice(deviceId)
    // A new or replaced device is dialed by Syncthing itself; only one already configured under this id needs the restart.
    if (stored === undefined || stale.length > 0) restartDue.delete(peerId)
    if (stored !== undefined && sameDevice(stored, desired)) {
      if (stored.paused) {
        await rest.resumeDevice(deviceId)
        // The resume dials the device at once, which is what a restart would achieve.
        restartDue.delete(peerId)
        log(`ketos-peer: syncthing.device-resumed ${short(peerId)}: the peer device was paused`)
      }
    } else {
      await rest.putDevice(desired)
      wrote = true
    }
    const folder = await rest.getFolder(options.folderId)
    if (folder === undefined) {
      await rest.putFolder({
        id: options.folderId,
        path: options.folderPath,
        type: 'sendreceive',
        fsWatcherEnabled: true,
        fsWatcherDelayS: options.fsWatcherDelayS,
        devices: [deviceId],
      })
      wrote = true
    } else {
      const kept = folder.devices.filter(id => !stale.includes(id))
      const merged = kept.includes(deviceId) ? kept : [...kept, deviceId]
      const before = new Set(folder.devices.filter(id => id !== myID))
      const after = new Set(merged.filter(id => id !== myID))
      if (before.size !== after.size || [...after].some(id => !before.has(id))) {
        await rest.patchFolder(options.folderId, { devices: merged })
        wrote = true
      }
    }
    for (const id of stale) await rest.deleteDevice(id)
    if (stale.length > 0) {
      log(`ketos-peer: syncthing.device-replaced ${short(peerId)}: ${String(stale.length)} previous device removed`)
      wrote = true
    }
    if (wrote) log(`ketos-peer: syncthing.linked ${short(peerId)}`)
    if (restartDue.has(peerId)) {
      await restartConnection(rest, deviceId)
      log(`ketos-peer: syncthing.reconnected ${short(peerId)}: paused and resumed the peer device`)
    }
    restartDue.delete(peerId)
  }

  /** Remove a forgotten peer's devices: from the folder first, then from the configuration. */
  const unlink = async (rest: SyncthingLinkClient, peerId: KetosPeerId): Promise<void> => {
    const { myID } = await rest.systemStatus()
    const name = peerDeviceName(peerId)
    const devices = (await rest.listDevices())
      .filter(device => device.name === name && device.deviceID !== myID)
      .map(device => device.deviceID)
    if (devices.length === 0) return
    const folder = await rest.getFolder(options.folderId)
    if (folder !== undefined && folder.devices.some(id => devices.includes(id))) {
      await rest.patchFolder(options.folderId, { devices: folder.devices.filter(id => !devices.includes(id)) })
    }
    for (const id of devices) await rest.deleteDevice(id)
    log(`ketos-peer: syncthing.unlinked ${short(peerId)}: ${String(devices.length)} device removed`)
  }

  const announce = (peerId: KetosPeerId): void => {
    const signal = restart(announces, peerId)
    void retrying(signal, `announcing the device id to ${short(peerId)}`, LINK_STOPPED, async (rest) => {
      const { myID } = await rest.systemStatus()
      await peer.send(peerId, 'syncthing.device', { deviceId: myID })
    })
  }

  const receive = (payload: unknown, from: KetosPeerId): void => {
    const deviceId = parseSyncthingDeviceFrame(payload)
    if (deviceId === undefined) {
      log(`ketos-peer: syncthing.device-invalid from ${short(from)}: not exactly one canonical deviceId`)
      return
    }
    const signal = restart(applies, from)
    void retrying(signal, `linking ${short(from)}`, LINK_STOPPED, rest => serialized(async () => {
      // The peer's disconnection or a newer id may have ended this application while it waited in the queue.
      if (isAborted(signal)) return
      await link(rest, from, deviceId)
    }))
  }

  const forget = async (peerId: KetosPeerId): Promise<void> => {
    const signal = restart(applies, peerId)
    await retrying(signal, `unlinking ${short(peerId)}`, UNLINK_STOPPED, rest => serialized(async () => {
      // A device id the peer sent again after a new invitation ends a removal that waited in the queue.
      if (isAborted(signal)) return
      await unlink(rest, peerId)
    }))
    // A forgotten peer sends no disconnection that would remove the entry.
    if (applies.get(peerId)?.signal === signal) applies.delete(peerId)
  }

  const cancel = (peerId: KetosPeerId): void => {
    restartDue.delete(peerId)
    announces.get(peerId)?.abort()
    announces.delete(peerId)
    applies.get(peerId)?.abort()
    applies.delete(peerId)
  }

  ctx.effect(() => peer.handle('syncthing.device', receive), 'ketos-peer: syncthing device handler')
  ctx.effect(() => ctx.on('ketos-peer/connected', (event) => {
    const since = lostAt.get(event.peerId)
    lostAt.delete(event.peerId)
    if (since !== undefined && Date.now() - since >= options.kickAfterLostMs) restartDue.add(event.peerId)
    announce(event.peerId)
  }), 'ketos-peer: syncthing announcement')
  ctx.effect(() => ctx.on('ketos-peer/disconnected', (event) => {
    cancel(event.peerId)
    lostAt.set(event.peerId, Date.now())
  }), 'ketos-peer: syncthing retry reset')
  ctx.effect(() => ctx.on('ketos-peer/forgotten', (event) => {
    lostAt.delete(event.peerId)
    void forget(event.peerId)
  }), 'ketos-peer: syncthing unlinking')
  ctx.effect(() => () => {
    for (const peerId of new Set([...announces.keys(), ...applies.keys()])) cancel(peerId)
  }, 'ketos-peer: syncthing retries')
}
