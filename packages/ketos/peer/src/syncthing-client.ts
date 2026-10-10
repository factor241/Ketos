/**
 * A client of the local Syncthing REST API: every request reads the API key
 * anew, carries it in the `X-API-Key` header, ends after `requestTimeoutMs`
 * or when the client's lifetime ends, and validates the JSON it reads.
 * Syncthing's answers are another program's output, so a parser checks the
 * fields this package uses and accepts any other field; a missing or
 * mistyped field refuses the whole answer. A failure is a
 * {@link SyncthingError} that names the method, the path, the HTTP status,
 * and the kind of failure, and never the key or a response body.
 *
 * Syncthing builds a PUT of a device or folder from its defaults, takes the id
 * from the body, and resets every field the body leaves out; the write
 * methods therefore send the complete object with its id. A PATCH of a folder
 * merges into the stored folder but replaces its `devices` list whole. Pausing
 * and resuming a device change its stored `paused` field; Syncthing closes
 * the connections of a paused device and dials a resumed one at once.
 * @module @ketos/peer/syncthing-client
 */

import { parseSyncthingDeviceId, type SyncthingDeviceId } from './syncthing-device-id.ts'

/** The `fetch` the client sends through; the global one in production. */
export type SyncthingFetch = (url: string, init: RequestInit) => Promise<Response>

/** Connection inputs of one client. */
export interface SyncthingClientOptions {
  /** Base URL of the REST API, such as `http://127.0.0.1:8384`. */
  readonly url: string
  /**
   * Reads the Syncthing API key; resolves undefined while it is not set. It
   * runs before every request, so a changed key reaches the next request;
   * only the request header carries the value.
   */
  readonly readApiKey: () => Promise<string | undefined>
  /** How long one request may take, reading its answer included, in milliseconds. */
  readonly requestTimeoutMs: number
  /** Ends every request in flight and every later one when it aborts. */
  readonly signal: AbortSignal
  /** Replaces the global `fetch` in tests; the global one when absent or undefined. */
  readonly fetch?: SyncthingFetch | undefined
}

/** One Syncthing device as this package configures it. */
export interface SyncthingDevice {
  /** The device id. */
  readonly deviceID: SyncthingDeviceId
  /** The device name; Ketos names a peer's device `ketos:<peer id>`. */
  readonly name: string
  /** Addresses Syncthing dials the device at. */
  readonly addresses: readonly string[]
  /** Whether the device may add folders to this Syncthing by itself. */
  readonly autoAcceptFolders: boolean
  /** Whether the device is paused: Syncthing keeps no connection to it and does not dial it. */
  readonly paused: boolean
}

/** The part of a stored folder the linking reads. */
export interface SyncthingFolder {
  /** The folder id. */
  readonly id: string
  /** Ids of the devices the folder is shared with, the own device included. */
  readonly devices: readonly SyncthingDeviceId[]
}

/** The complete body of a folder the linking creates. */
export interface SyncthingNewFolder {
  /** The folder id. */
  readonly id: string
  /** Directory of the folder on the Syncthing host. */
  readonly path: string
  /** Sync direction; Ketos folders send and receive. */
  readonly type: 'sendreceive'
  /** Whether Syncthing watches the directory for changes. */
  readonly fsWatcherEnabled: boolean
  /** Seconds the watcher collects changes before it scans. */
  readonly fsWatcherDelayS: number
  /** Ids of the devices to share the folder with. */
  readonly devices: readonly SyncthingDeviceId[]
}

/** The discovery and listening settings the settings check reads. */
export interface SyncthingOptions {
  /** Whether Syncthing announces itself to global discovery servers. */
  readonly globalAnnounceEnabled: boolean
  /** Whether Syncthing announces itself on the local network. */
  readonly localAnnounceEnabled: boolean
  /** Whether Syncthing opens ports through NAT-PMP or UPnP. */
  readonly natEnabled: boolean
  /** Whether Syncthing connects through relays. */
  readonly relaysEnabled: boolean
  /** Addresses Syncthing listens on; relay entries may carry a token. */
  readonly listenAddresses: readonly string[]
}

/** The connection state of one remote device. */
export interface SyncthingConnection {
  /** Whether a connection to the device is open. */
  readonly connected: boolean
  /** Connection type, such as `relay-client`; empty while not connected. */
  readonly type: string
}

/** The part of a folder's status the shared-folder state reads. */
export interface SyncthingFolderStatus {
  /** Folder state, such as `idle`, `scanning`, `syncing`, or `error`. */
  readonly state: string
  /** Files, directories, and deletions this device still needs. */
  readonly needTotalItems: number
}

/** The part of a remote device's completion of one folder the shared-folder state reads. */
export interface SyncthingRemoteCompletion {
  /**
   * The folder as the remote device's cluster configuration reports it:
   * `valid` once the remote device shares the folder with this one and runs
   * it; `unknown` before its configuration arrived, `notSharing` or `paused`
   * otherwise.
   */
  readonly remoteState: string
  /** Files, directories, and symlinks the remote device still needs, as this Syncthing counts them. */
  readonly needItems: number
  /** Deletions the remote device still needs, as this Syncthing counts them. */
  readonly needDeletes: number
}

/**
 * Why a Syncthing request failed: `no-answer` — no HTTP answer arrived
 * (Syncthing is not listening, the request timed out, or the client's
 * lifetime ended); `refused` — Syncthing answered with an error status;
 * `invalid` — the answer lacks a field this package reads or is not JSON;
 * `no-key` — the API key is not set or could not be read, so nothing was sent.
 */
export type SyncthingErrorKind = 'no-answer' | 'refused' | 'invalid' | 'no-key'

/** One failed Syncthing request. */
export class SyncthingError extends Error {
  /**
   * Whether the same request may succeed later without a configuration
   * change: true when no answer arrived or Syncthing answered with a server
   * error (5xx), false for a client error such as a refused key (401, 403),
   * a malformed answer, and a missing key.
   */
  readonly transient: boolean

  /**
   * @param method - the HTTP method.
   * @param path - the request path with its query.
   * @param status - the HTTP status, or 0 when no answer arrived or nothing was sent.
   * @param kind - why the request failed.
   * @param reason - what went wrong; never a response body or a secret.
   */
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly kind: SyncthingErrorKind,
    reason: string,
  ) {
    super(`syncthing ${method} ${path}: ${reason}`)
    this.name = 'SyncthingError'
    this.transient = kind === 'no-answer' || (kind === 'refused' && status >= 500)
  }
}

/** One decoded answer. */
interface Answer {
  /** The HTTP status. */
  readonly status: number
  /** The decoded JSON body; undefined for a write. */
  readonly body: unknown
}

/** Marks the absence a lookup reports as `undefined`. */
const MISSING = Symbol('syncthing-missing')

/**
 * Whether a value is a JSON object.
 * @param value - a decoded value.
 * @returns true for a non-null, non-array object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether a value is a count: an integer of at least zero.
 * @param value - a decoded value.
 * @returns true for a non-negative integer.
 */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * Whether a value is an array of strings.
 * @param value - a decoded value.
 * @returns true when every element is a string.
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

/** The REST client. */
export class SyncthingClient {
  private readonly options: SyncthingClientOptions
  private readonly base: string

  /**
   * @param options - base URL, key reader, timeout, lifetime, and the optional test transport.
   */
  constructor(options: SyncthingClientOptions) {
    this.options = options
    this.base = options.url.replace(/\/+$/u, '')
  }

  /**
   * Check that Syncthing answers.
   * @returns a promise settling when `/rest/system/ping` answered `pong`.
   */
  async ping(): Promise<void> {
    const path = '/rest/system/ping'
    const { status, body } = await this.read(path)
    if (!isObject(body) || body.ping !== 'pong') throw this.invalid('GET', path, status, 'ping')
  }

  /**
   * Read the own device id.
   * @returns the canonical id of this Syncthing.
   */
  async systemStatus(): Promise<{ readonly myID: SyncthingDeviceId }> {
    const path = '/rest/system/status'
    const { status, body } = await this.read(path)
    const myID = isObject(body) ? parseSyncthingDeviceId(body.myID) : undefined
    if (myID === undefined) throw this.invalid('GET', path, status, 'myID')
    return { myID }
  }

  /**
   * Read the connection state of every configured remote device.
   * @returns the states by device id; the own device and every key that is
   * not a canonical device id are not listed.
   */
  async connections(): Promise<ReadonlyMap<SyncthingDeviceId, SyncthingConnection>> {
    const path = '/rest/system/connections'
    const { status, body } = await this.read(path)
    if (!isObject(body) || !isObject(body.connections)) throw this.invalid('GET', path, status, 'connections')
    const result = new Map<SyncthingDeviceId, SyncthingConnection>()
    for (const [key, entry] of Object.entries(body.connections)) {
      // Syncthing keys the map by canonical device ids; any other key names
      // no device this package configures, so it does not refuse the answer.
      const device = parseSyncthingDeviceId(key)
      if (device === undefined) continue
      if (!isObject(entry) || typeof entry.connected !== 'boolean' || typeof entry.type !== 'string') {
        throw this.invalid('GET', path, status, 'connections entry')
      }
      result.set(device, { connected: entry.connected, type: entry.type })
    }
    return result
  }

  /**
   * Read every configured device.
   * @returns the devices, the own device included.
   */
  async listDevices(): Promise<readonly SyncthingDevice[]> {
    const path = '/rest/config/devices'
    const { status, body } = await this.read(path)
    if (!Array.isArray(body)) throw this.invalid('GET', path, status, 'device list')
    const rows: readonly unknown[] = body
    return rows.map(row => this.device(row, path, status))
  }

  /**
   * Read one device.
   * @param id - the device id.
   * @returns the device, or undefined when Syncthing has no such device.
   */
  async getDevice(id: SyncthingDeviceId): Promise<SyncthingDevice | undefined> {
    const path = `/rest/config/devices/${encodeURIComponent(id)}`
    const answer = await this.read(path, true)
    if (answer === MISSING) return undefined
    return this.device(answer.body, path, answer.status)
  }

  /**
   * Create or replace one device; fields the body leaves out reset to Syncthing's defaults.
   * @param device - the complete device.
   * @returns a promise settling when Syncthing stored it.
   */
  async putDevice(device: SyncthingDevice): Promise<void> {
    await this.write('PUT', `/rest/config/devices/${encodeURIComponent(device.deviceID)}`, {
      deviceID: device.deviceID,
      name: device.name,
      addresses: device.addresses,
      autoAcceptFolders: device.autoAcceptFolders,
      paused: device.paused,
    })
  }

  /**
   * Pause one device: Syncthing stores `paused: true` and closes its connections.
   * @param id - the device id; the query always names it, since one without a device pauses every device.
   * @returns a promise settling when Syncthing stored the change.
   */
  async pauseDevice(id: SyncthingDeviceId): Promise<void> {
    await this.write('POST', `/rest/system/pause?device=${encodeURIComponent(id)}`)
  }

  /**
   * Resume one device: Syncthing stores `paused: false` and dials the device at once.
   * @param id - the device id.
   * @returns a promise settling when Syncthing stored the change.
   */
  async resumeDevice(id: SyncthingDeviceId): Promise<void> {
    await this.write('POST', `/rest/system/resume?device=${encodeURIComponent(id)}`)
  }

  /**
   * Remove one device; Syncthing also drops it from every folder.
   * @param id - the device id.
   * @returns a promise settling when Syncthing removed it.
   */
  async deleteDevice(id: SyncthingDeviceId): Promise<void> {
    await this.write('DELETE', `/rest/config/devices/${encodeURIComponent(id)}`)
  }

  /**
   * Read one folder.
   * @param id - the folder id.
   * @returns the folder's id and devices, or undefined when Syncthing has no such folder.
   */
  async getFolder(id: string): Promise<SyncthingFolder | undefined> {
    const path = `/rest/config/folders/${encodeURIComponent(id)}`
    const answer = await this.read(path, true)
    if (answer === MISSING) return undefined
    const { status, body } = answer
    if (!isObject(body) || typeof body.id !== 'string' || !Array.isArray(body.devices)) {
      throw this.invalid('GET', path, status, 'folder')
    }
    const entries: readonly unknown[] = body.devices
    const devices = entries.map((entry) => {
      const deviceId = isObject(entry) ? parseSyncthingDeviceId(entry.deviceID) : undefined
      if (deviceId === undefined) throw this.invalid('GET', path, status, 'folder device')
      return deviceId
    })
    return { id: body.id, devices }
  }

  /**
   * Create or replace one folder with a complete body.
   * @param folder - the folder.
   * @returns a promise settling when Syncthing stored it.
   */
  async putFolder(folder: SyncthingNewFolder): Promise<void> {
    await this.write('PUT', `/rest/config/folders/${encodeURIComponent(folder.id)}`, {
      id: folder.id,
      path: folder.path,
      type: folder.type,
      fsWatcherEnabled: folder.fsWatcherEnabled,
      fsWatcherDelayS: folder.fsWatcherDelayS,
      devices: folder.devices.map(deviceID => ({ deviceID })),
    })
  }

  /**
   * Replace the device list of one existing folder.
   * @param id - the folder id.
   * @param patch - the complete new device list.
   * @returns a promise settling when Syncthing stored it.
   */
  async patchFolder(id: string, patch: { readonly devices: readonly SyncthingDeviceId[] }): Promise<void> {
    await this.write('PATCH', `/rest/config/folders/${encodeURIComponent(id)}`, {
      devices: patch.devices.map(deviceID => ({ deviceID })),
    })
  }

  /**
   * Read the discovery and listening settings.
   * @returns the settings the settings check compares.
   */
  async getOptions(): Promise<SyncthingOptions> {
    const path = '/rest/config/options'
    const { status, body } = await this.read(path)
    if (
      !isObject(body)
      || typeof body.globalAnnounceEnabled !== 'boolean'
      || typeof body.localAnnounceEnabled !== 'boolean'
      || typeof body.natEnabled !== 'boolean'
      || typeof body.relaysEnabled !== 'boolean'
      || !isStringArray(body.listenAddresses)
    ) {
      throw this.invalid('GET', path, status, 'options')
    }
    return {
      globalAnnounceEnabled: body.globalAnnounceEnabled,
      localAnnounceEnabled: body.localAnnounceEnabled,
      natEnabled: body.natEnabled,
      relaysEnabled: body.relaysEnabled,
      listenAddresses: body.listenAddresses,
    }
  }

  /**
   * Read the status of one folder.
   * @param id - the folder id.
   * @returns the state and the count of needed items, or undefined when Syncthing runs no such folder.
   */
  async folderStatus(id: string): Promise<SyncthingFolderStatus | undefined> {
    const path = `/rest/db/status?folder=${encodeURIComponent(id)}`
    const answer = await this.read(path, true)
    if (answer === MISSING) return undefined
    const { status, body } = answer
    if (!isObject(body) || typeof body.state !== 'string' || !isCount(body.needTotalItems)) {
      throw this.invalid('GET', path, status, 'folder status')
    }
    return { state: body.state, needTotalItems: body.needTotalItems }
  }

  /**
   * Read how far one remote device is with one folder, from this Syncthing's
   * view of the remote device's index and cluster configuration.
   * @param folderId - the folder id.
   * @param deviceId - the remote device.
   * @returns the remote state and needed counts, or undefined when Syncthing
   * has no such folder or does not run it.
   */
  async remoteCompletion(folderId: string, deviceId: SyncthingDeviceId): Promise<SyncthingRemoteCompletion | undefined> {
    const path = `/rest/db/completion?folder=${encodeURIComponent(folderId)}&device=${encodeURIComponent(deviceId)}`
    const answer = await this.read(path, true)
    if (answer === MISSING) return undefined
    const { status, body } = answer
    if (!isObject(body) || typeof body.remoteState !== 'string' || !isCount(body.needItems) || !isCount(body.needDeletes)) {
      throw this.invalid('GET', path, status, 'remote completion')
    }
    return { remoteState: body.remoteState, needItems: body.needItems, needDeletes: body.needDeletes }
  }

  /**
   * Validate one device record.
   * @param value - the decoded record.
   * @param path - the request path, for the error.
   * @param status - the HTTP status, for the error.
   * @returns the device.
   */
  private device(value: unknown, path: string, status: number): SyncthingDevice {
    const deviceID = isObject(value) ? parseSyncthingDeviceId(value.deviceID) : undefined
    if (
      deviceID === undefined
      || !isObject(value)
      || typeof value.name !== 'string'
      || !isStringArray(value.addresses)
      || typeof value.autoAcceptFolders !== 'boolean'
      || typeof value.paused !== 'boolean'
    ) {
      throw this.invalid('GET', path, status, 'device')
    }
    return { deviceID, name: value.name, addresses: value.addresses, autoAcceptFolders: value.autoAcceptFolders, paused: value.paused }
  }

  /**
   * The error of an answer whose JSON lacks a field this package needs.
   * @param method - the HTTP method.
   * @param path - the request path.
   * @param status - the HTTP status.
   * @param field - what was missing or mistyped.
   * @returns the error.
   */
  private invalid(method: string, path: string, status: number, field: string): SyncthingError {
    return new SyncthingError(method, path, status, 'invalid', `unexpected response: invalid ${field}`)
  }

  private read(path: string): Promise<Answer>
  private read(path: string, missingOk: true): Promise<Answer | typeof MISSING>
  private read(path: string, missingOk = false): Promise<Answer | typeof MISSING> {
    return this.call('GET', path, undefined, missingOk)
  }

  private async write(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<void> {
    await this.call(method, path, body, false)
  }

  /**
   * Read the API key for one request.
   * @param method - the HTTP method, for the error.
   * @param path - the request path, for the error.
   * @returns the key; rejects with a `no-key` {@link SyncthingError} when it is not set or cannot be read.
   */
  private async apiKey(method: string, path: string): Promise<string> {
    let key: string | undefined
    try {
      key = await this.options.readApiKey()
    } catch {
      // The reader's error text may quote what the credential store holds;
      // the reason below names only what happened.
      throw new SyncthingError(method, path, 0, 'no-key', 'the API key could not be read')
    }
    if (key === undefined) throw new SyncthingError(method, path, 0, 'no-key', 'the API key is not set')
    return key
  }

  /**
   * Send one request and decode its answer.
   * @param method - the HTTP method.
   * @param path - the path with its query.
   * @param body - the JSON body of a write.
   * @param missingOk - whether a 404 answers {@link MISSING} instead of failing.
   * @returns the status and the decoded body, or {@link MISSING}.
   */
  private async call(method: string, path: string, body: unknown, missingOk: boolean): Promise<Answer | typeof MISSING> {
    const apiKey = await this.apiKey(method, path)
    if (this.options.signal.aborted) throw new SyncthingError(method, path, 0, 'no-answer', 'cancelled')
    const timeout = new AbortController()
    const timer = setTimeout(() => { timeout.abort() }, this.options.requestTimeoutMs)
    timer.unref()
    const fetchImpl = this.options.fetch ?? ((url: string, init: RequestInit) => fetch(url, init))
    try {
      let response: Response
      let text: string
      try {
        response = await fetchImpl(`${this.base}${path}`, {
          method,
          headers: body === undefined
            ? { 'X-API-Key': apiKey }
            : { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
          ...body === undefined ? {} : { body: JSON.stringify(body) },
          signal: AbortSignal.any([this.options.signal, timeout.signal]),
        })
        // The body is read in every case so the connection is released.
        text = await response.text()
      } catch {
        // The transport's error text may carry the address; the reason below
        // names only what happened.
        throw new SyncthingError(method, path, 0, 'no-answer', this.noAnswerReason(timeout.signal))
      }
      if (response.status === 404 && missingOk) return MISSING
      if (!response.ok) throw new SyncthingError(method, path, response.status, 'refused', `HTTP ${String(response.status)}`)
      if (method !== 'GET') return { status: response.status, body: undefined }
      let decoded: unknown
      try {
        decoded = JSON.parse(text)
      } catch {
        throw new SyncthingError(method, path, response.status, 'invalid', 'unexpected response: not JSON')
      }
      return { status: response.status, body: decoded }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Why a request ended without an answer.
   * @param timeout - the request's own timeout signal.
   * @returns the reason text.
   */
  private noAnswerReason(timeout: AbortSignal): string {
    if (this.options.signal.aborted) return 'cancelled'
    if (timeout.aborted) return `no answer within ${String(this.options.requestTimeoutMs)} ms`
    return 'no answer'
  }
}
