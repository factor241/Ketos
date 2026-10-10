// The optional `syncthing` section of the peer configuration: defaults and
// bounds through the schema, the load-time checks that refuse an unusable
// value without echoing it, the relay address comparison that ignores the
// token and the query's encoding, and the settings check against the stand's
// private-relay settings.
import { describe, expect, it } from 'vitest'
import * as Peer from '@ketos/peer'
import {
  relayAddressKey, resolveSyncthingSettings, syncthingSettingsDivergence, type SyncthingConfig,
} from '../src/syncthing-config.ts'
import type { SyncthingOptions } from '../src/syncthing-client.ts'
import { FAKE_RELAY_TOKEN, RELAY_ADDRESS, RELAY_ID, RELAY_LISTEN_ADDRESS } from './syncthing-fake.ts'

const BASE = { name: 'Кирилл', relayUrls: ['http://127.0.0.1:1'], keyPath: 'peer.key', peersPath: 'peers.json' }

/** The section as the stand row writes it. */
const STAND: SyncthingConfig = {
  url: 'http://127.0.0.1:8384',
  apiKeyEnv: 'STGUIAPIKEY',
  relayAddress: RELAY_ADDRESS,
  folderId: 'ketos-shared',
  folderPath: '/workspace/shared',
  fsWatcherDelayS: 1,
}

/** Settings that match the stand bootstrap exactly. */
const MATCHING: SyncthingOptions = {
  globalAnnounceEnabled: false,
  localAnnounceEnabled: false,
  natEnabled: false,
  relaysEnabled: true,
  listenAddresses: [RELAY_LISTEN_ADDRESS, 'tcp://0.0.0.0:22000'],
}

/**
 * The message of the error one section is refused with.
 * @param section - the section to resolve.
 * @returns the error message.
 */
function refusal(section: SyncthingConfig): string {
  try {
    resolveSyncthingSettings(section)
  } catch (error: unknown) {
    return (error as Error).message
  }
  throw new Error('expected the section to be refused')
}

describe('syncthing configuration section', () => {
  it('stays absent when the row names no section', () => {
    expect(Peer.Config(BASE).syncthing).toBeUndefined()
  })

  it('defaults the optional bounds and keeps the stand values', () => {
    const config = Peer.Config({ ...BASE, syncthing: STAND })
    expect(config.syncthing).toEqual({ ...STAND, statusRefreshMs: 2000, requestTimeoutMs: 5000, retryMs: 2000, kickAfterLostMs: 90_000 })
    const { fsWatcherDelayS: _delay, ...bareSection } = STAND
    const bare = Peer.Config({ ...BASE, syncthing: bareSection })
    expect(bare.syncthing?.fsWatcherDelayS).toBe(10)
  })

  it('bounds the numbers and requires the identity fields', () => {
    const accepted: Array<Partial<SyncthingConfig>> = [
      { fsWatcherDelayS: 1 }, { fsWatcherDelayS: 3600 },
      { statusRefreshMs: 250 }, { statusRefreshMs: 60_000 },
      { requestTimeoutMs: 100 }, { requestTimeoutMs: 60_000 },
      { retryMs: 100 }, { retryMs: 600_000 },
      { kickAfterLostMs: 10_000 }, { kickAfterLostMs: 600_000 },
    ]
    for (const override of accepted) expect(() => Peer.Config({ ...BASE, syncthing: { ...STAND, ...override } })).not.toThrow()
    const refused: Array<Partial<SyncthingConfig>> = [
      { fsWatcherDelayS: 0 }, { fsWatcherDelayS: 3601 }, { fsWatcherDelayS: 1.5 },
      { statusRefreshMs: 249 }, { statusRefreshMs: 60_001 }, { statusRefreshMs: 1000.5 },
      { requestTimeoutMs: 99 }, { requestTimeoutMs: 60_001 }, { requestTimeoutMs: 1000.5 },
      { retryMs: 99 }, { retryMs: 600_001 }, { retryMs: 1000.5 },
      { kickAfterLostMs: 9999 }, { kickAfterLostMs: 600_001 }, { kickAfterLostMs: 90_000.5 },
    ]
    for (const override of refused) expect(() => Peer.Config({ ...BASE, syncthing: { ...STAND, ...override } })).toThrow()
    for (const key of ['url', 'apiKeyEnv', 'relayAddress', 'folderId', 'folderPath'] as const) {
      const { [key]: _omitted, ...rest } = STAND
      expect(() => Peer.Config({ ...BASE, syncthing: rest as SyncthingConfig })).toThrow()
    }
  })

  it('resolves the stand row into complete settings', () => {
    expect(resolveSyncthingSettings({
      ...STAND, url: 'http://127.0.0.1:8384/', statusRefreshMs: 1000, requestTimeoutMs: 800, retryMs: 300, kickAfterLostMs: 120_000,
    }))
      .toEqual({
        url: 'http://127.0.0.1:8384',
        apiKeyEnv: 'STGUIAPIKEY',
        relayAddress: RELAY_ADDRESS,
        folderId: 'ketos-shared',
        folderPath: '/workspace/shared',
        fsWatcherDelayS: 1,
        statusRefreshMs: 1000,
        requestTimeoutMs: 800,
        retryMs: 300,
        kickAfterLostMs: 120_000,
      })
  })

  it('refuses a relay address that is empty, carries the token, or is not relay://…?id=…, without echoing it', () => {
    const cases: Array<[string, RegExp]> = [
      ['', /relayAddress is empty/u],
      [RELAY_LISTEN_ADDRESS, /must not carry the relay token/u],
      [`relay://203.0.113.7:22067/?token=${FAKE_RELAY_TOKEN}`, /must not carry the relay token/u],
      [`relay://203.0.113.7:22067/token=${FAKE_RELAY_TOKEN}?id=${RELAY_ID}`, /must not carry the relay token/u],
      [`tcp://203.0.113.7:22067/?id=${RELAY_ID}`, /must be a relay:\/\/ URL/u],
      ['not a url', /must be a relay:\/\/ URL/u],
      ['relay:///?id=x', /must be a relay:\/\/ URL/u],
      ['relay://203.0.113.7:22067/', /must carry \?id=/u],
      ['relay://203.0.113.7:22067/?id=', /must carry \?id=/u],
    ]
    for (const [relayAddress, pattern] of cases) {
      const message = refusal({ ...STAND, relayAddress })
      expect(message).toMatch(pattern)
      expect(message).not.toContain(FAKE_RELAY_TOKEN)
      if (relayAddress !== '') expect(message).not.toContain(relayAddress)
      expect(message).not.toContain('203.0.113.7')
    }
  })

  it('refuses a REST URL that would send the key in clear text off this host', () => {
    expect(refusal({ ...STAND, url: 'http://192.168.1.5:8384' })).toMatch(/http:\/\/ only for a loopback host/u)
    expect(refusal({ ...STAND, url: 'ftp://127.0.0.1:8384' })).toMatch(/http:\/\/ or https:\/\/ URL/u)
    expect(refusal({ ...STAND, url: 'not a url' })).toMatch(/http:\/\/ or https:\/\/ URL/u)
    for (const url of ['http://127.0.0.1:8384/?secret-query=1', 'http://127.0.0.1:8384/#secret-fragment', 'http://127.0.0.1:8384?']) {
      const message = refusal({ ...STAND, url })
      expect(message).toMatch(/without a query or fragment/u)
      expect(message).not.toContain('secret-')
    }
    const withCredentials = refusal({ ...STAND, url: 'https://user:secret-pass@sync.example:8384' })
    expect(withCredentials).toMatch(/without a user name or password/u)
    expect(withCredentials).not.toContain('secret-pass')
    for (const url of ['http://localhost:8384', 'http://[::1]:8384', 'http://127.0.0.2:8384', 'https://sync.example:8384']) {
      expect(() => resolveSyncthingSettings({ ...STAND, url })).not.toThrow()
    }
  })

  it('refuses an environment name, folder id, or folder path Syncthing could not use', () => {
    expect(refusal({ ...STAND, apiKeyEnv: 'STGUI-APIKEY' })).toMatch(/apiKeyEnv must name an environment variable/u)
    expect(refusal({ ...STAND, folderId: 'a/b' })).toMatch(/folderId must be/u)
    expect(refusal({ ...STAND, folderId: '' })).toMatch(/folderId must be/u)
    expect(refusal({ ...STAND, folderPath: 'workspace/shared' })).toMatch(/folderPath must be an absolute path/u)
  })

  it('compares relay addresses without the token and regardless of query order and encoding', () => {
    const key = relayAddressKey(RELAY_ADDRESS)
    expect(key).toBeDefined()
    expect(relayAddressKey(RELAY_LISTEN_ADDRESS)).toBe(key)
    expect(relayAddressKey(`relay://203.0.113.7:22067/?statusAddr=:22070&token=t&id=${RELAY_ID}`)).toBe(key)
    expect(relayAddressKey(`relay://203.0.113.7:22067?id=${RELAY_ID}&statusAddr=%3A22070`)).toBe(key)
    expect(relayAddressKey(`relay://203.0.113.8:22067/?id=${RELAY_ID}&statusAddr=%3A22070`)).not.toBe(key)
    expect(relayAddressKey(`relay://203.0.113.7:22068/?id=${RELAY_ID}&statusAddr=%3A22070`)).not.toBe(key)
    expect(relayAddressKey('relay://203.0.113.7:22067/?id=OTHER&statusAddr=%3A22070')).not.toBe(key)
    expect(relayAddressKey('tcp://0.0.0.0:22000')).toBeUndefined()
    expect(relayAddressKey('default')).toBeUndefined()
  })

  it('finds no divergence in the stand bootstrap settings', () => {
    expect(syncthingSettingsDivergence(MATCHING, RELAY_ADDRESS)).toEqual([])
  })

  it('names every setting that leaves the private relay', () => {
    expect(syncthingSettingsDivergence({
      ...MATCHING, globalAnnounceEnabled: true, localAnnounceEnabled: true, natEnabled: true, relaysEnabled: false,
    }, RELAY_ADDRESS)).toEqual(['globalAnnounceEnabled', 'localAnnounceEnabled', 'natEnabled', 'relaysEnabled'])
    expect(syncthingSettingsDivergence({ ...MATCHING, listenAddresses: ['tcp://0.0.0.0:22000'] }, RELAY_ADDRESS))
      .toEqual(['listenAddresses'])
    expect(syncthingSettingsDivergence({ ...MATCHING, listenAddresses: [RELAY_LISTEN_ADDRESS, 'default'] }, RELAY_ADDRESS))
      .toEqual(['listenAddresses'])
    expect(syncthingSettingsDivergence({
      ...MATCHING, listenAddresses: [RELAY_LISTEN_ADDRESS, 'dynamic+https://relays.syncthing.net/endpoint'],
    }, RELAY_ADDRESS)).toEqual(['listenAddresses'])
    // An address that is no relay URL matches no listen address, not every non-relay one.
    expect(syncthingSettingsDivergence({ ...MATCHING, listenAddresses: ['tcp://0.0.0.0:22000'] }, 'not a relay'))
      .toEqual(['listenAddresses'])
  })
})
