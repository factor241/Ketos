# Ketos peer channel

English | [中文](ketos-peer.zh.md)

The Ketos soft fork's transport subsystem: two Ketos instances on different computers find each other through the team's private iroh relay and exchange framed messages as one team. It is outside the upstream Cordis catalog's subsystem ownership; the per-package contracts live in the package READMEs linked below, and this page carries the event reference.

## Ownership

| Owner | Responsibility |
|---|---|
| [@ketos/peer](../../packages/ketos/peer/README.md) | `ctx.ketosPeer`: the iroh node with a stored key, the framed channel, the invitation code, the known-peer file, participant records, and reconnection |
| [@ketos/board-doc](../../packages/ketos/board-doc/README.md) | The board document whose `participants` map each Ketos writes its own record into |
| [docker/relay](../../docker/relay/README.md) | The private iroh relay and Syncthing relay the deployment runs on its VPS |

## Channel

The node binds with a key stored at `$DSH_HOME/peer.key` and the team's relay URLs, so its `EndpointId` is stable and reachable only through that relay. One connection carries one bidirectional stream; messages are `[u32 BE length][u8 code][JSON body]`, with codes for board document synchronization and chat transcripts, and a code reserved for the Syncthing device handshake of a later stage. A frame over the size bound, a non-JSON body, an unknown code, or a truncated frame closes the connection without throwing past the read loop.

The dialing side writes `hello` first; the receiver admits a known peer, or an unknown one whose `hello` carries the one-time secret of its pending `ketos1.…` invitation code. Admitted nodes are stored in `$DSH_HOME/peers.json`, and only the dialing side keeps the peer's ticket, so it owns reconnection with bounded, jittered retries.

## Events

`ketos-peer/connected` fires after a handshake established a usable channel, carrying the peer identity and its participant record; stage 33 uses it to catch up the synchronized document. `ketos-peer/disconnected` fires when that channel ends, before any reconnection attempt.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ketos-peer-events"></a>

### `ketos-peer/*` events

<a id="ketos-peerconnected--emit"></a>

#### `ketos-peer/connected` — emit

A channel to a known peer became usable; late listeners read the state and catch up.

```ts cordis-catalog
/** A channel to a known peer became usable; late listeners read the state and catch up.
 * @param peer - the peer that just connected.
 * @mode emit
 */
'ketos-peer/connected'(peer: PeerConnectedEvent): void
```

Source: [`packages/ketos/peer/src/service.ts`](../../packages/ketos/peer/src/service.ts)

<a id="ketos-peerdisconnected--emit"></a>

#### `ketos-peer/disconnected` — emit

A channel to a known peer ended; reconnection may follow.

```ts cordis-catalog
/** A channel to a known peer ended; reconnection may follow.
 * @param peer - the peer whose channel ended.
 * @mode emit
 */
'ketos-peer/disconnected'(peer: PeerDisconnectedEvent): void
```

Source: [`packages/ketos/peer/src/service.ts`](../../packages/ketos/peer/src/service.ts)
<!-- END GENERATED cordis-surface -->
