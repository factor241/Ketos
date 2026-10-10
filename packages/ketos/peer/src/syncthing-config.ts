/**
 * The optional `syncthing` section of the peer configuration: its fields, the
 * load-time checks that refuse an unusable value, the resolution into
 * complete settings, and the check of Syncthing's own discovery and listening
 * settings against the stand's private-relay settings.
 *
 * Errors name the field and the rule, never the value: a relay address may
 * carry the relay token, and a URL may carry a password.
 * @module @ketos/peer/syncthing-config
 */

import { isAbsolute } from 'node:path'
import { isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type { SyncthingOptions } from './syncthing-client.ts'

/** Deployment configuration of the shared Syncthing folder. */
export interface SyncthingConfig {
  /**
   * Base URL of the local Syncthing REST API, such as `http://127.0.0.1:8384`.
   * `http://` is accepted only for a loopback host, since the API key travels
   * in a request header; the URL must not carry a user name, a password, a
   * query, or a fragment, since request paths are appended to it.
   */
  url: string
  /**
   * Name of the environment variable that holds the Syncthing API key, read
   * through the credentials service when one is present and from the launch
   * environment when there is none or it has no value, again before every
   * Syncthing request. When the variable is not set at start, the Syncthing
   * feature stays off with one host log line and the rest of the plugin works.
   */
  apiKeyEnv: string
  /**
   * The private relay both Syncthing devices dial each other through,
   * `relay://host:port/?id=<relay device id>`, without the `token` parameter:
   * the token admits a listener to the relay and is never needed to dial a peer.
   */
  relayAddress: string
  /** Id of the shared folder: 1–64 letters, digits, `.`, `_`, or `-`, starting with a letter or digit. */
  folderId: string
  /** Absolute directory of the shared folder on the Syncthing host. */
  folderPath: string
  /** Seconds Syncthing's watcher collects changes before it scans (1–3600, default 10, Syncthing's own default). */
  fsWatcherDelayS?: number
  /** How often the shared-folder state is read from Syncthing, in milliseconds (250–60000, default 2000). */
  statusRefreshMs?: number
  /** How long one Syncthing request may take, in milliseconds (100–60000, default 5000). */
  requestTimeoutMs?: number
  /**
   * Pause before a linking step is retried after Syncthing gave no answer,
   * timed out, or answered with a server error, in milliseconds (100–600000,
   * default 2000).
   */
  retryMs?: number
  /**
   * How long the Ketos channel to a peer must have been lost before its next
   * connection restarts Syncthing's connection to the peer's device, in
   * milliseconds (10000–600000, default 90000). Syncthing's relay connections
   * survive shorter outages, and restarting one that still works costs one
   * of the few immediate redials Syncthing allows per device before it holds
   * off for minutes; a longer outage outlasts the relay session, whose dead
   * connection Syncthing may keep counting as connected for more than a
   * minute.
   */
  kickAfterLostMs?: number
}

/** The `syncthing` section with every default applied and every value checked. */
export interface SyncthingSettings {
  /** Base URL of the REST API without a trailing slash. */
  readonly url: string
  /** Name of the environment variable that holds the API key. */
  readonly apiKeyEnv: string
  /** The private relay address without a token. */
  readonly relayAddress: string
  /** Id of the shared folder. */
  readonly folderId: string
  /** Absolute directory of the shared folder. */
  readonly folderPath: string
  /** Seconds the watcher collects changes before a scan. */
  readonly fsWatcherDelayS: number
  /** Interval of the shared-folder state reads, in milliseconds. */
  readonly statusRefreshMs: number
  /** Budget of one request, in milliseconds. */
  readonly requestTimeoutMs: number
  /** Pause before a failed linking step is retried, in milliseconds. */
  readonly retryMs: number
  /** Shortest channel loss after which a reconnection restarts Syncthing's connection to the peer device, in milliseconds. */
  readonly kickAfterLostMs: number
}

/** Folder ids the section accepts; they also travel in a URL path. */
const FOLDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u

/** Host names that never leave this machine. */
const LOOPBACK_HOST = /^(?:localhost|\[::1\]|127(?:\.\d{1,3}){3})$/u

/** Listen addresses that make Syncthing join public relays. */
const PUBLIC_RELAY_LISTEN = /^(?:default$|dynamic\+)/u

/**
 * Refuse the base URL of the REST API unless the key can travel to it safely.
 * @param url - the configured URL.
 * @returns the URL without a trailing slash.
 */
function checkedUrl(url: string): string {
  const parsed = URL.parse(url)
  if (parsed === null || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new Error('syncthing.url must be an http:// or https:// URL')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('syncthing.url must be given without a user name or password')
  }
  // A bare `?` or `#` parses to an empty search or hash, so the text itself is checked.
  if (/[?#]/u.test(url)) {
    throw new Error('syncthing.url must be given without a query or fragment; request paths are appended to it')
  }
  if (parsed.protocol === 'http:' && !LOOPBACK_HOST.test(parsed.hostname)) {
    throw new Error('syncthing.url may use http:// only for a loopback host; the API key would cross the network in clear text')
  }
  return url.replace(/\/+$/u, '')
}

/**
 * Refuse a relay address that is not `relay://host:port/?id=…` or that carries the token.
 * @param address - the configured relay address.
 */
function checkRelayAddress(address: string): void {
  if (address === '') throw new Error('syncthing.relayAddress is empty; set it to relay://host:port/?id=<relay device id>')
  const parsed = URL.parse(address)
  if (address.includes('token=') || parsed?.searchParams.has('token') === true) {
    throw new Error('syncthing.relayAddress must not carry the relay token; only the listening side needs it')
  }
  if (parsed === null || parsed.protocol !== 'relay:' || parsed.hostname === '') {
    throw new Error('syncthing.relayAddress must be a relay:// URL with a host')
  }
  if ((parsed.searchParams.get('id') ?? '') === '') {
    throw new Error('syncthing.relayAddress must carry ?id=<relay device id>')
  }
}

/**
 * Check one section and apply its defaults; the plugin calls this at load,
 * so an unusable value refuses the whole plugin.
 * @param section - the section as the schema resolved it.
 * @returns the complete settings.
 */
export function resolveSyncthingSettings(section: SyncthingConfig): SyncthingSettings {
  const url = checkedUrl(section.url)
  if (!isCredentialRefName(section.apiKeyEnv)) {
    throw new Error('syncthing.apiKeyEnv must name an environment variable: a letter or underscore, then letters, digits, or underscores')
  }
  checkRelayAddress(section.relayAddress)
  if (!FOLDER_ID_PATTERN.test(section.folderId)) {
    throw new Error('syncthing.folderId must be 1-64 letters, digits, ".", "_", or "-", starting with a letter or digit')
  }
  if (!isAbsolute(section.folderPath)) throw new Error('syncthing.folderPath must be an absolute path')
  return {
    url,
    apiKeyEnv: section.apiKeyEnv,
    relayAddress: section.relayAddress,
    folderId: section.folderId,
    folderPath: section.folderPath,
    fsWatcherDelayS: section.fsWatcherDelayS as number,
    statusRefreshMs: section.statusRefreshMs as number,
    requestTimeoutMs: section.requestTimeoutMs as number,
    retryMs: section.retryMs as number,
    kickAfterLostMs: section.kickAfterLostMs as number,
  }
}

/**
 * The comparison key of one relay address: scheme, host, port, path, and the
 * decoded query parameters as a set, with `token` dropped. Syncthing's listen
 * address carries the token and the raw query; the configured address is a
 * re-serialized URL without the token; both yield the same key.
 * @param address - a relay address.
 * @returns the key, or undefined for an address that is not a relay URL with a host.
 */
export function relayAddressKey(address: string): string | undefined {
  const parsed = URL.parse(address)
  if (parsed === null || parsed.protocol !== 'relay:' || parsed.hostname === '') return undefined
  parsed.searchParams.delete('token')
  const params = [...parsed.searchParams].map(([key, value]) => JSON.stringify([key, value])).sort()
  return JSON.stringify([parsed.hostname.toLowerCase(), parsed.port, parsed.pathname === '' ? '/' : parsed.pathname, params])
}

/**
 * Compare Syncthing's discovery and listening settings with what the stand
 * bootstrap writes: no global or local announcements, no NAT traversal,
 * relays on, the private relay among the listen addresses, and no listen
 * address that joins the public relay pool. The comparison reads only.
 * @param options - the settings Syncthing reports.
 * @param relayAddress - the configured private relay address.
 * @returns the names of the diverging settings, empty when all match; never an address.
 */
export function syncthingSettingsDivergence(options: SyncthingOptions, relayAddress: string): readonly string[] {
  const diverging: string[] = []
  if (options.globalAnnounceEnabled) diverging.push('globalAnnounceEnabled')
  if (options.localAnnounceEnabled) diverging.push('localAnnounceEnabled')
  if (options.natEnabled) diverging.push('natEnabled')
  if (!options.relaysEnabled) diverging.push('relaysEnabled')
  const expected = relayAddressKey(relayAddress)
  const listensOnRelay = expected !== undefined && options.listenAddresses.some(address => relayAddressKey(address) === expected)
  const joinsPublicRelays = options.listenAddresses.some(address => PUBLIC_RELAY_LISTEN.test(address))
  if (!listensOnRelay || joinsPublicRelays) diverging.push('listenAddresses')
  return diverging
}
