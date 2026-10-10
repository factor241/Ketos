/**
 * The Syncthing feature of the peer plugin: it reads the Syncthing API key
 * once at start, stays off with one host log line when the key is not set,
 * and otherwise creates the REST client, links the devices over the peer
 * channel (`syncthing-link`), and keeps the shared-folder state of the peer
 * state route (`syncthing-state`), whose first poll checks Syncthing's
 * discovery and listening settings against the private-relay settings
 * without writing. The client reads the key again before every request, as
 * the credentials seam requires, so a changed key reaches the next request
 * and a key removed later turns the state to `error`.
 *
 * A missing key turns off only this feature: the peer channel and board
 * synchronization keep working. This is a deliberate exception to failing
 * loud on misconfiguration; invalid values of the section itself still refuse
 * the plugin at load (`resolveSyncthingSettings`).
 * @module @ketos/peer/syncthing
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { SyncthingClient, type SyncthingFetch } from './syncthing-client.ts'
import type { SyncthingSettings } from './syncthing-config.ts'
import { registerSyncthingLink, type SyncthingLinkPeer } from './syncthing-link.ts'
import { SyncthingMonitor } from './syncthing-state.ts'
import type { PeerState, SharedFolderState } from './types.ts'

/** The members of the peer node the feature uses; `KetosPeerService` provides them. */
export interface SyncthingPeer extends SyncthingLinkPeer {
  /**
   * Every known peer with its current link state, from memory.
   * @returns the peer states.
   */
  peers(): readonly PeerState[]
}

/** One registered Syncthing feature. */
export interface SyncthingFeature {
  /**
   * The latest shared-folder state, from memory; the plugin passes it to the
   * peer node as its `sharedFolder` reader.
   * @returns the state, or undefined until the key was read and while the feature stays off.
   */
  readonly sharedFolder: () => SharedFolderState | undefined
  /** Resolves true once the feature is on and its first poll ran, false when it stays off. */
  readonly started: Promise<boolean>
}

/** Inputs of the feature beside its settings. */
export interface SyncthingFeatureOptions {
  /** Receives one line per feature act and anomaly; never a key, token, or address. */
  readonly logger: (message: string) => void
  /** Reads the API key; resolves undefined when it is not set. Runs at start and before every request. */
  readonly resolveApiKey: () => Promise<string | undefined>
  /** Replaces the REST client's global `fetch` in tests; the global one when absent. */
  readonly fetch?: SyncthingFetch
}

/**
 * Read the Syncthing API key the way the model providers' ambient lookup
 * reads a named variable: through the credentials service when the
 * composition has one, and from the launch environment when there is no such
 * service or it has no value. The caller reads it once per operation and
 * keeps no copy.
 * @param ctx - the plugin's context.
 * @param name - the environment variable that names the key.
 * @returns the key, or undefined when it is not set or empty.
 */
export async function readSyncthingApiKey(ctx: Context, name: string): Promise<string | undefined> {
  const hit = await ctx.get('credentials')?.resolve(credentialRef(name))
  const value = hit?.value ?? launchEnvironmentOf(ctx).get(name)?.value
  return value === undefined || value === '' ? undefined : value
}

/**
 * Check that the key is set and create the REST client, or report why the feature stays off.
 * @param settings - the resolved section.
 * @param options - log sink, key lookup, and the optional test transport.
 * @param lifetime - ends every request when the plugin disposes.
 * @returns the client, or undefined when the feature stays off.
 */
async function openClient(
  settings: SyncthingSettings,
  options: SyncthingFeatureOptions,
  lifetime: AbortSignal,
): Promise<SyncthingClient | undefined> {
  let apiKey: string | undefined
  try {
    apiKey = await options.resolveApiKey()
  } catch {
    // The reader's error text may quote what the credential store holds, so
    // the line names only the variable, like the client's per-request failure.
    options.logger(`ketos-peer: syncthing.disabled: ${settings.apiKeyEnv} could not be read; the shared folder stays off`)
    return undefined
  }
  if (apiKey === undefined) {
    options.logger(`ketos-peer: syncthing.disabled: ${settings.apiKeyEnv} is not set; the shared folder stays off`)
    return undefined
  }
  if (lifetime.aborted) return undefined
  return new SyncthingClient({
    url: settings.url,
    readApiKey: options.resolveApiKey,
    requestTimeoutMs: settings.requestTimeoutMs,
    signal: lifetime,
    fetch: options.fetch,
  })
}

/**
 * Start the Syncthing feature as part of the calling fiber: the linking over
 * the channel registers at once and waits for the key; once the key is read,
 * the first state poll — which includes the settings check — runs, then the
 * poll loop. Disposing the fiber ends every request, retry, poll, and handler
 * of the feature.
 * @param ctx - the plugin's context.
 * @param peer - the peer node the device ids travel over and whose link states the state follows.
 * @param settings - the resolved `syncthing` section.
 * @param options - log sink, key lookup, and the optional test transport.
 * @returns the feature's shared-folder state reader and its start.
 */
export function registerSyncthing(
  ctx: Context,
  peer: SyncthingPeer,
  settings: SyncthingSettings,
  options: SyncthingFeatureOptions,
): SyncthingFeature {
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort() }, 'ketos-peer: syncthing lifetime')
  // The reader exists before the key is read, so it reports nothing until the monitor exists.
  const feature: { monitor?: SyncthingMonitor } = {}
  const client = openClient(settings, options, lifetime.signal)
  registerSyncthingLink(ctx, peer, client, {
    relayAddress: settings.relayAddress,
    folderId: settings.folderId,
    folderPath: settings.folderPath,
    fsWatcherDelayS: settings.fsWatcherDelayS,
    retryMs: settings.retryMs,
    kickAfterLostMs: settings.kickAfterLostMs,
    logger: options.logger,
  })
  const start = async (): Promise<boolean> => {
    const rest = await client
    if (rest === undefined) return false
    const monitor = new SyncthingMonitor(rest, {
      folderId: settings.folderId,
      relayAddress: settings.relayAddress,
      statusRefreshMs: settings.statusRefreshMs,
      logger: options.logger,
      peerOnline: peerId => peer.peers().some(state => state.peerId === peerId && state.link === 'online'),
    })
    feature.monitor = monitor
    await monitor.poll(lifetime.signal)
    void monitor.run(lifetime.signal)
    return true
  }
  return { sharedFolder: () => feature.monitor?.state(), started: start() }
}
