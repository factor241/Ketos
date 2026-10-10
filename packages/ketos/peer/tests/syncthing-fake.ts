// An in-memory stand-in for the Syncthing 2.1.5 REST API, served through the
// client's `fetch` seam. It reproduces the behaviors the linking depends on:
// the `X-API-Key` check, 404 for a missing folder or device, PUT that builds
// from defaults and takes the id from the body, PATCH that merges but replaces
// `devices` whole, folder normalization that drops unknown devices, adds the
// own device, and sorts by id, a remote device's completion of a folder, and
// pausing and resuming a device, which Syncthing stores in the configuration;
// without a device id it applies to every device.
import type { SyncthingFetch } from '../src/syncthing-client.ts'

/** API key the fake accepts. */
export const FAKE_API_KEY = 'fake-api-key-5f1e9c'

/** Relay token the fake's listen address carries; no log or error may contain it. */
export const FAKE_RELAY_TOKEN = 'fake-relay-token-7d3a'

/** Real device ids from the stand image, used as fixtures. */
export const DEVICE_IDS = [
  'WOMZ33X-WKQ2GXR-GJSDYTB-2JGCS6B-E63FEGC-K53B2SY-DZ74KXN-6T4TMAY',
  'RZU325K-XIIM65F-PXA6B7C-3E5RIMA-DPF6N7A-5WRKK6B-J5RMZHC-FMSNSA5',
  'QF33IZ4-UQMXKVM-564AW27-UUNOSES-75EXNCA-QK5JTLB-OZD4UNG-W5JFNAU',
  '6CTVASB-R7PNT7H-JUAQ2WS-MVX3UGO-OFLER7L-C6ZULGV-UESQTMA-OLZOFQE',
  'MFZWI3D-BONSGYC-YLTMRWG-C43ENR5-QXGZDMM-FZWI3DP-BONSGYY-LTMRWAD',
] as const

/** The private relay's id in the fixtures. */
export const RELAY_ID = DEVICE_IDS[4]

/** The relay address as Ketos configures it: no token. */
export const RELAY_ADDRESS = `relay://203.0.113.7:22067/?id=${RELAY_ID}&statusAddr=%3A22070`

/** The same relay as Syncthing listens on it: with the token and the raw query. */
export const RELAY_LISTEN_ADDRESS = `relay://203.0.113.7:22067/?id=${RELAY_ID}&token=${FAKE_RELAY_TOKEN}&statusAddr=:22070`

/** One request the fake received. */
export interface FakeRequest {
  readonly method: string
  /** Path with the query string. */
  readonly path: string
  readonly body?: unknown
  readonly apiKey: string | null
}

/** A JSON object as the fake stores it. */
type Json = Record<string, unknown>

/**
 * A JSON answer.
 * @param body - the body.
 * @returns the response.
 */
function json(body: unknown): Response {
  return Response.json(body)
}

/**
 * A plain-text error answer as Syncthing writes it.
 * @param status - the HTTP status.
 * @param body - the body.
 * @returns the response.
 */
function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } })
}

/** The fake Syncthing instance. */
export class FakeSyncthing {
  apiKey: string = FAKE_API_KEY
  myID: string
  /** When true, every request fails as if nothing listened. */
  down = false
  /** When true, every request waits until its signal aborts. */
  hang = false
  /** While set, every request waits for this promise before it is answered. */
  delay: Promise<void> | undefined
  options: Json = {
    listenAddresses: [RELAY_LISTEN_ADDRESS, 'tcp://0.0.0.0:22000'],
    globalAnnounceEnabled: false,
    localAnnounceEnabled: false,
    relaysEnabled: true,
    natEnabled: false,
    urAccepted: -1,
  }
  readonly devices = new Map<string, Json>()
  readonly folders = new Map<string, Json>()
  readonly connected = new Map<string, string>()
  readonly folderStates = new Map<string, { state: string; needTotalItems: number }>()
  /**
   * Each remote device's view of the shared folders, as `/rest/db/completion`
   * reports it; a device without an entry shares the folder and needs nothing.
   */
  readonly remote = new Map<string, { remoteState: string; needItems: number; needDeletes: number }>()
  readonly requests: FakeRequest[] = []
  /** Answers that replace the fake's own for one `METHOD path`. */
  readonly overrides = new Map<string, () => Response>()

  /**
   * @param myID - the device id this fake reports as its own.
   */
  constructor(myID: string = DEVICE_IDS[0]) {
    this.myID = myID
    this.devices.set(myID, this.defaultDevice({ deviceID: myID, name: 'stand-host' }))
  }

  /** The client seam; arrow so it can be passed unbound. */
  readonly fetch: SyncthingFetch = async (url, init) => {
    const parsed = new URL(url)
    const method = init.method ?? 'GET'
    const headers = new Headers(init.headers)
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    const path = `${parsed.pathname}${parsed.search}`
    this.requests.push({ method, path, ...body === undefined ? {} : { body }, apiKey: headers.get('X-API-Key') })
    if (this.delay !== undefined) await this.delay
    if (this.down) throw new TypeError('fetch failed')
    if (this.hang) {
      return new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) }, { once: true })
      })
    }
    // The refusal echoes the presented key and a relay token, so a client
    // that copied response bodies into its errors would leak both.
    if (headers.get('X-API-Key') !== this.apiKey) {
      return text(403, `Forbidden: key ${String(headers.get('X-API-Key'))} for relay token ${FAKE_RELAY_TOKEN}\n`)
    }
    const override = this.overrides.get(`${method} ${parsed.pathname}`)
    if (override !== undefined) return override()
    return this.route(method, parsed, body)
  }

  /**
   * Requests that change configuration.
   * @returns every request whose method is not GET.
   */
  writes(): FakeRequest[] {
    return this.requests.filter(request => request.method !== 'GET')
  }

  /**
   * The device ids of one folder, as Syncthing stores them.
   * @param folderId - the folder.
   * @returns the ids in stored order, or undefined without the folder.
   */
  folderDevices(folderId: string): string[] | undefined {
    const folder = this.folders.get(folderId)
    if (folder === undefined) return undefined
    return (folder.devices as Array<{ deviceID: string }>).map(device => device.deviceID)
  }

  /**
   * Add a device and a folder that shares it, as a previous linking left them.
   * @param folderId - the folder.
   * @param device - the peer device's id.
   * @param name - the device's name.
   * @param addresses - the device's addresses.
   */
  seedLinked(folderId: string, device: string, name: string, addresses: string[]): void {
    this.devices.set(device, this.defaultDevice({ deviceID: device, name, addresses, autoAcceptFolders: false }))
    this.folders.set(folderId, this.normalizeFolder({
      ...this.defaultFolder(), id: folderId, path: '/workspace/shared', devices: [{ deviceID: device }],
    }))
  }

  private route(method: string, url: URL, body: unknown): Response {
    const segments = url.pathname.split('/').filter(Boolean)
    const id = segments[3] === undefined ? undefined : decodeURIComponent(segments[3])
    const route = `${method} /${segments.slice(0, 3).join('/')}`
    switch (route) {
      case 'GET /rest/system/ping':
        return json({ ping: 'pong' })
      case 'GET /rest/system/status':
        return json({ myID: this.myID, uptime: 12, goroutines: 40 })
      case 'GET /rest/system/connections':
        return json({
          connections: Object.fromEntries([...this.devices.keys()].filter(device => device !== this.myID).map(device => [
            device,
            { connected: this.connected.has(device), type: this.connected.get(device) ?? '', paused: false, address: '' },
          ])),
          total: { inBytesTotal: 0, outBytesTotal: 0 },
        })
      case 'GET /rest/config/options':
        return json(this.options)
      case 'GET /rest/config/devices':
        if (id === undefined) return json([...this.devices.values()])
        return this.devices.has(id) ? json(this.devices.get(id)) : text(404, 'No device with given ID\n')
      case 'PUT /rest/config/devices':
        return this.putDevice(body as Json)
      case 'DELETE /rest/config/devices':
        return this.deleteDevice(id as string)
      case 'GET /rest/config/folders':
        return id !== undefined && this.folders.has(id) ? json(this.folders.get(id)) : text(404, 'No folder with given ID\n')
      case 'PUT /rest/config/folders':
        return this.putFolder(body as Json)
      case 'PATCH /rest/config/folders':
        return this.patchFolder(id as string, body as Json)
      case 'GET /rest/db/status':
        return this.dbStatus(url.searchParams.get('folder') ?? '')
      case 'POST /rest/system/pause':
        return this.setPaused(url.searchParams.get('device') ?? '', true)
      case 'POST /rest/system/resume':
        return this.setPaused(url.searchParams.get('device') ?? '', false)
      case 'GET /rest/db/completion':
        return this.dbCompletion(url.searchParams.get('folder') ?? '', url.searchParams.get('device') ?? '')
      default:
        return text(404, 'not found\n')
    }
  }

  private defaultDevice(fields: Json): Json {
    return {
      deviceID: '', name: '', addresses: ['dynamic'], compression: 'metadata', certName: '', introducer: false,
      skipIntroductionRemovals: false, introducedBy: '', paused: false, allowedNetworks: [], autoAcceptFolders: false,
      maxSendKbps: 0, maxRecvKbps: 0, ignoredFolders: [], maxRequestKiB: 0, untrusted: false, remoteGUIPort: 0,
      numConnections: 0, ...fields,
    }
  }

  private defaultFolder(): Json {
    return {
      id: '', label: '', filesystemType: 'basic', path: '', type: 'sendreceive', devices: [], rescanIntervalS: 3600,
      fsWatcherEnabled: true, fsWatcherDelayS: 10, ignorePerms: false, autoNormalize: true, paused: false,
    }
  }

  private normalizeFolder(folder: Json): Json {
    const ids = new Set((folder.devices as Array<{ deviceID: string }>).map(device => device.deviceID))
    ids.add(this.myID)
    const devices = [...ids].filter(device => this.devices.has(device)).sort()
      .map(deviceID => ({ deviceID, introducedBy: '', encryptionPassword: '' }))
    return { ...folder, devices }
  }

  private putDevice(body: Json): Response {
    const device = this.defaultDevice(body)
    this.devices.set(device.deviceID as string, device)
    return text(200, '')
  }

  private deleteDevice(id: string): Response {
    if (!this.devices.has(id)) return text(404, 'No device with given ID\n')
    this.devices.delete(id)
    for (const [folderId, folder] of this.folders) this.folders.set(folderId, this.normalizeFolder(folder))
    return text(200, '')
  }

  private putFolder(body: Json): Response {
    const folder = this.normalizeFolder({ ...this.defaultFolder(), ...body })
    this.folders.set(folder.id as string, folder)
    return text(200, '')
  }

  private patchFolder(id: string, body: Json): Response {
    const existing = this.folders.get(id)
    if (existing === undefined) return text(404, 'No folder with given ID\n')
    this.folders.set(id, this.normalizeFolder({ ...existing, ...body }))
    return text(200, '')
  }

  private setPaused(device: string, paused: boolean): Response {
    const targets = device === '' ? [...this.devices.keys()] : [device]
    if (!this.devices.has(targets[0] as string)) return text(404, 'not found\n')
    for (const id of targets) this.devices.set(id, { ...this.devices.get(id), paused })
    return text(200, '')
  }

  private dbCompletion(folderId: string, device: string): Response {
    if (!this.folders.has(folderId)) return text(404, 'folder does not exist\n')
    const remote = this.remote.get(device) ?? { remoteState: 'valid', needItems: 0, needDeletes: 0 }
    const done = remote.needItems + remote.needDeletes === 0
    return json({ completion: done ? 100 : 50, globalBytes: 2048, needBytes: done ? 0 : 1024, globalItems: 3, sequence: 7, ...remote })
  }

  private dbStatus(folderId: string): Response {
    if (!this.folders.has(folderId)) return text(404, 'folder does not exist\n')
    const status = this.folderStates.get(folderId) ?? { state: 'idle', needTotalItems: 0 }
    return json({ ...status, needFiles: 0, globalFiles: 3, errors: 0, version: 7 })
  }
}
