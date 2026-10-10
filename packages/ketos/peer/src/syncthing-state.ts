/**
 * The state of the shared Syncthing folder that `GET /api/ketos.peer.state`
 * reports. A poll every `statusRefreshMs` reads the local Syncthing and keeps
 * the latest result, so the route answers without a request of its own:
 *
 * - `unavailable` — Syncthing does not answer;
 * - `error` — Syncthing refuses a request (a wrong key included) or answers
 *   malformed JSON, the API key is no longer set, its discovery and listening
 *   settings diverge from the private-relay settings, or the folder reports
 *   `error`;
 * - `waiting` — the folder is missing or not running, no peer device of the
 *   folder is connected, the folder state is neither idle, nor `error`, nor a
 *   scanning or transferring state (`unknown`, say) with nothing needed, no
 *   connected device of the folder carries a Ketos peer name, the Ketos
 *   channel to no peer of a connected device is online — whether the folder
 *   syncs or is idle — or no such peer with an online channel shares the
 *   folder back;
 * - `syncing` — the folder scans, waits, prepares, transfers, cleans, or
 *   starts, or still needs items, while the Ketos channel to the peer of a
 *   connected device is online; or it is idle and every peer with an online
 *   channel that shares the folder back still needs items or deletions;
 * - `synced` — the folder is `idle`, needs nothing, and a connected device of
 *   the folder carries the name `ketos:<peer id>` of a peer whose Ketos
 *   channel is online and whose Syncthing shares the folder back (its
 *   `remoteState` is `valid`) and needs nothing.
 *
 * Whether a peer shares the folder back and what it still needs come from
 * `/rest/db/completion` for its device: this Syncthing's view of the peer's
 * cluster configuration and index, read on every poll of an idle folder.
 *
 * Syncthing notices a lost connection much later than the channel's
 * heartbeat, so the channel decides: the Ketos channel condition is read again
 * on every {@link SyncthingMonitor.state} call, from memory, so `syncing` and
 * `synced` turn `waiting` as soon as the channel is lost, without waiting for
 * the next poll; `unavailable` and `error` do not depend on the channel.
 *
 * Before the first poll completes the state is `waiting`. The settings are
 * read once per Syncthing run: at the first answer and again after Syncthing
 * stopped answering. A log line appears only when the condition a poll reports
 * changes, and the flips between `syncing` and `synced` log nothing.
 * @module @ketos/peer/syncthing-state
 */

import { setTimeout as sleep } from 'node:timers/promises'
import { SyncthingError, type SyncthingClient } from './syncthing-client.ts'
import { syncthingSettingsDivergence } from './syncthing-config.ts'
import type { SyncthingDeviceId } from './syncthing-device-id.ts'
import { peerOfDeviceName } from './syncthing-link.ts'
import type { KetosPeerId, SharedFolderState } from './types.ts'

/** The REST calls one poll makes. */
export type SyncthingStateClient = Pick<
  SyncthingClient,
  'ping' | 'getOptions' | 'getFolder' | 'folderStatus' | 'connections' | 'listDevices' | 'remoteCompletion'
>

/** Deployment inputs of the monitor. */
export interface SyncthingMonitorOptions {
  /** Id of the shared folder. */
  readonly folderId: string
  /** The private relay address the settings check expects among the listen addresses. */
  readonly relayAddress: string
  /** Pause between two polls, in milliseconds. */
  readonly statusRefreshMs: number
  /** Receives one line per change of the reported condition; never a key, token, or address. */
  readonly logger: (message: string) => void
  /**
   * Whether the Ketos channel to one peer is online. It runs on every state
   * read, so it must answer from memory.
   */
  readonly peerOnline: (peerId: KetosPeerId) => boolean
}

/** Folder states during which Syncthing scans, transfers, or prepares to. */
const SYNCING_STATES: ReadonlySet<string> = new Set([
  'scanning', 'scan-waiting', 'syncing', 'sync-waiting', 'sync-preparing', 'cleaning', 'clean-waiting', 'starting',
])

/** The view of the folder of one peer whose folder device Syncthing reports connected. */
interface PeerFolder {
  /** The peer the device's name `ketos:<peer id>` names. */
  readonly peerId: KetosPeerId
  /** Whether the peer's Syncthing shares the folder back: its `remoteState` is `valid`. */
  readonly sharesBack: boolean
  /** Items and deletions the peer's device still needs. */
  readonly need: number
}

/** One poll's result. */
interface Reading {
  /** The state Syncthing's answers give, before the Ketos channel condition. */
  readonly state: SharedFolderState
  /** The line that describes the condition, or undefined for one that is not logged. */
  readonly line: string | undefined
  /** For `syncing` and `synced`: the peers whose folder devices Syncthing reports connected; empty for every other state. */
  readonly peers: readonly KetosPeerId[]
  /** For `synced`: each of those peers' view of the folder; empty for every other state. */
  readonly remote: readonly PeerFolder[]
}

/**
 * The reading of a failed request: no answer means Syncthing is unavailable;
 * a refused or malformed answer and a missing key are errors.
 * @param error - what the client threw.
 * @returns the reading.
 */
function failure(error: unknown): Reading {
  if (error instanceof SyncthingError && error.kind === 'no-answer') {
    return { state: 'unavailable', line: `ketos-peer: syncthing.unavailable: ${String(error)}`, peers: [], remote: [] }
  }
  return { state: 'error', line: `ketos-peer: syncthing.error: ${String(error)}`, peers: [], remote: [] }
}

/**
 * A `waiting` reading.
 * @param reason - why the folder waits.
 * @returns the reading.
 */
function waiting(reason: string): Reading {
  return { state: 'waiting', line: `ketos-peer: syncthing.waiting: ${reason}`, peers: [], remote: [] }
}

/** Polls the local Syncthing and keeps the latest shared-folder state. */
export class SyncthingMonitor {
  private readonly client: SyncthingStateClient
  private readonly options: SyncthingMonitorOptions
  /** The latest poll's reading; `waiting` until the first poll completes. */
  private latest: Reading = { state: 'waiting', line: undefined, peers: [], remote: [] }
  private lastLine: string | undefined
  /** Names of the diverging settings of the running Syncthing; undefined until read. */
  private divergence: readonly string[] | undefined

  /**
   * @param client - the REST client.
   * @param options - folder, relay, interval, log sink, and the Ketos channel condition.
   */
  constructor(client: SyncthingStateClient, options: SyncthingMonitorOptions) {
    this.client = client
    this.options = options
  }

  /**
   * The latest polled state with the current Ketos channel condition; no request.
   * @returns the state, `waiting` before the first poll completes.
   */
  state(): SharedFolderState {
    return this.withChannel(this.latest).state
  }

  /**
   * Read Syncthing once and keep the result. Never rejects.
   * @param signal - the feature's lifetime; a poll it ended changes nothing and logs nothing.
   * @returns the state after the poll.
   */
  async poll(signal: AbortSignal): Promise<SharedFolderState> {
    const reading = await this.read()
    if (signal.aborted) return this.state()
    this.latest = reading
    const shown = this.withChannel(reading)
    if (shown.line !== undefined && shown.line !== this.lastLine) {
      this.lastLine = shown.line
      this.options.logger(shown.line)
    }
    return shown.state
  }

  /**
   * Apply the Ketos channel condition: a `syncing` or `synced` reading turns
   * `waiting` while the channel to no peer of a connected device is online. A
   * `synced` reading stays `synced` only while one such peer with an online
   * channel shares the folder back and needs nothing; one that shares the
   * folder back but still needs something makes the reading `syncing`.
   * @param reading - a poll's reading.
   * @returns the reading to report.
   */
  private withChannel(reading: Reading): Reading {
    if (reading.state !== 'syncing' && reading.state !== 'synced') return reading
    if (!reading.peers.some(peerId => this.options.peerOnline(peerId))) {
      return waiting('no Ketos channel to the peer of a connected device is online')
    }
    if (reading.state === 'syncing') return reading
    const online = reading.remote.filter(peer => this.options.peerOnline(peer.peerId))
    if (online.some(peer => peer.sharesBack && peer.need === 0)) return reading
    if (online.some(peer => peer.sharesBack)) return { state: 'syncing', line: undefined, peers: reading.peers, remote: [] }
    return waiting('no peer with an online Ketos channel shares the folder back yet')
  }

  /**
   * Poll every `statusRefreshMs` until the signal aborts; the first poll runs after one pause.
   * @param signal - the feature's lifetime.
   * @returns a promise settling when the loop stopped.
   */
  async run(signal: AbortSignal): Promise<void> {
    for (;;) {
      try {
        await sleep(this.options.statusRefreshMs, undefined, { signal, ref: false })
      } catch {
        // The pause ends early only through the abort, which ends the loop.
        return
      }
      await this.poll(signal)
    }
  }

  private async read(): Promise<Reading> {
    try {
      await this.client.ping()
    } catch (error: unknown) {
      // The next answer may come from a restarted Syncthing with other settings.
      this.divergence = undefined
      return failure(error)
    }
    try {
      this.divergence ??= syncthingSettingsDivergence(await this.client.getOptions(), this.options.relayAddress)
      if (this.divergence.length > 0) {
        return {
          state: 'error',
          line: `ketos-peer: syncthing.settings-diverge: not the private-relay settings: ${this.divergence.join(', ')}`,
          peers: [],
          remote: [],
        }
      }
      const folder = await this.client.getFolder(this.options.folderId)
      if (folder === undefined) return waiting('no shared folder yet')
      const status = await this.client.folderStatus(this.options.folderId)
      if (status === undefined) return waiting('the shared folder is not running yet')
      if (status.state === 'error') {
        return { state: 'error', line: 'ketos-peer: syncthing.error: the shared folder reports an error', peers: [], remote: [] }
      }
      const connections = await this.client.connections()
      // The connection list never names the own device, so any connected
      // device of the folder is a peer's.
      const connected = folder.devices.filter(device => connections.get(device)?.connected === true)
      if (connected.length === 0) return waiting('the peer device is not connected')
      const syncing = SYNCING_STATES.has(status.state) || status.needTotalItems > 0
      if (!syncing && status.state !== 'idle') return waiting(`folder state ${status.state}`)
      const devices = await this.peersOf(connected)
      if (devices.length === 0) return waiting('no connected device of the folder carries a Ketos peer name')
      const peers = devices.map(device => device.peerId)
      if (syncing) return { state: 'syncing', line: undefined, peers, remote: [] }
      const remote: PeerFolder[] = []
      for (const { peerId, deviceId } of devices) {
        const completion = await this.client.remoteCompletion(this.options.folderId, deviceId)
        if (completion === undefined) return waiting('the shared folder is not running yet')
        remote.push({ peerId, sharesBack: completion.remoteState === 'valid', need: completion.needItems + completion.needDeletes })
      }
      return { state: 'synced', line: 'ketos-peer: syncthing.synced', peers, remote }
    } catch (error: unknown) {
      return failure(error)
    }
  }

  /**
   * The peers whose devices are among the connected devices, by the device
   * name the linking gives: `ketos:<peer id>`.
   * @param connected - the folder's devices Syncthing reports connected.
   * @returns each peer with its device; a device with another name contributes none.
   */
  private async peersOf(
    connected: readonly SyncthingDeviceId[],
  ): Promise<Array<{ readonly peerId: KetosPeerId; readonly deviceId: SyncthingDeviceId }>> {
    return (await this.client.listDevices())
      .filter(device => connected.includes(device.deviceID))
      .flatMap((device) => {
        const peerId = peerOfDeviceName(device.name)
        return peerId === undefined ? [] : [{ peerId, deviceId: device.deviceID }]
      })
  }
}
