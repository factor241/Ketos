---
description: "The Ketos peer channel host package: the iroh node with a stored key, the framed message channel behind ctx.ketosPeer, the one-time invitation code and the known-peer file, the participant record each Ketos publishes, and the /api/ketos.peer.* Fetch routes."
kind: "package-reference"
---

# @ketos/peer

English | [中文](README.zh.md)

## Summary

`@ketos/peer` owns the channel that lets two Ketos instances on different computers work as one team: an iroh node with a key at `$DSH_HOME/peer.key`, a framed message channel, a one-time `ketos1.…` invitation code, the known-peer file `$DSH_HOME/peers.json`, and each side's participant record in the board document. Other packages reach it through `ctx.ketosPeer`; the browser through `/api/ketos.peer.*`. The node starts lazily, and the shipped web profile keeps the row disabled, so a machine without the stand never loads the native module.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The stand mounts the package through its own overlay (`docker/stand/stand.patch.yml`); the shipped `web` profile keeps the row disabled and supplies only the environment seam:

```yaml
- id: ketos-peer
  name: '@ketos/peer'
  disabled: true
  config:
    name: !!js process.env.KETOS_PARTICIPANT_NAME ?? ''
    relayUrls: !!js (process.env.KETOS_RELAY_URLS ?? '').split(',').filter(Boolean)
    keyPath: !!js dshHomePath('peer.key')
    peersPath: !!js dshHomePath('peers.json')
```

| Field | Default | Meaning |
|---|---|---|
| `name` | required | Participant name this Ketos publishes (1–64 characters). |
| `relayUrls` | required | Relay URLs of the team's private iroh relay; at least one. Public n0 relays are never used. |
| `keyPath` | required | Stored 32-byte node key; the parent directory is created owner-only, the file `0600`. |
| `peersPath` | required | Known-peer file; written atomically `0600`. |
| `maxFrameBytes` | `16777216` | Largest accepted frame body (1 KiB–64 MiB). |
| `onlineTimeoutMs` | `15000` | How long `invite()` waits for a relay address (1000–120000). |
| `connectTimeoutMs` | `10000` | Dial, stream, and handshake step bound; also the default request timeout (1000–120000). |
| `reconnectMinMs` | `1000` | First reconnection pause (100–60000). |
| `reconnectMaxMs` | `30000` | Reconnection pause ceiling (100–600000). |
| `inviteTtlMs` | `3600000` | Lifetime of one invitation secret (60000–86400000). |
| `stateRefreshMs` | `1000` | Poll interval the state route publishes (250–60000). |
| `bindAddr` | absent | Local bind address; absent binds every interface on an ephemeral port. |

The service is the host-side seam other Ketos packages use:

| Member | Answer |
|---|---|
| `peers(): PeerState[]` | Every known peer with `peerId`, `selfId`, `name`, `color`, and `link: 'online' \| 'connecting' \| 'lost'` |
| `send(peerId, type, payload)` | One frame to a connected peer; rejects while no channel is open |
| `request(peerId, type, payload, { timeoutMs })` | One request envelope; the answer resolves, a timeout or remote error rejects |
| `handle(type, handler): () => void` | Registers a handler; every handler of a type runs, the first one's value answers a request. Consumers own the unsubscribe through `ctx.effect` |
| `invite(): Promise<string>` | One `ketos1.<ticket>.<secret>` code after the relay address exists; a previous unused secret is replaced |
| `connect(code): Promise<{ peerId }>` | Dials the code's ticket, completes the handshake, and records the peer |
| `state(): Promise<PeerStateResponse>` | The local record, every peer, and `refreshMs` |
| `nodeId(): Promise<KetosPeerId>` | The local iroh identity derived from the stored key |
| `startIfKnownPeers(): Promise<void>` | Starts the node only when `peers.json` names someone |
| `close(): Promise<void>` | Closes the node, its channels, and every reconnect attempt |

The browser polls one route and writes through two:

| Route | Method | Body | Answer |
|---|---|---|---|
| `/api/ketos.peer.state` | `GET` | — | `{ self, peers, refreshMs }` |
| `/api/ketos.peer.invite` | `GET` | — | `{ invite }` |
| `/api/ketos.peer.connect` | `POST` | `{ invite }` | `{ peerId }` |

A refusal answers `{ ok: false, error }` with `ketos/invalid` (400), `ketos/peer-self` (409), `ketos/invite-used` (409), `ketos/peer-unreachable` (504), or `ketos/peer-offline` (503); anything else is an empty 500. The route call starts the node, so a process that never polls it never binds.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Node and key

The first start reads `keyPath`; a missing file is generated once with `SecretKey.generate()` and written with the exclusive-create flag at mode `0600` inside a `0700` directory, and a file of any length other than 32 bytes refuses to load instead of silently minting a new identity. The endpoint is built with `presetMinimal`, the peer ALPN `ketos/peer/1`, `RelayMode.customFromUrls(relayUrls)`, and the stored key, so the node's `EndpointId` is stable across restarts and reachable only through the team's relay.

### Frames

One connection carries one bidirectional QUIC stream; every message is `[u32 BE length][u8 code][JSON body]`. The code table reserves `1 hello`, `2 bye`, `3 board.sv`, `4 board.update`, `5 chat.transcript.request`, `6 chat.transcript.response`, and `7 syncthing.device`; stages 33–35 merge their payloads into `PeerFrameTypeMap` through declaration merging and register handlers, and a reserved frame without a handler is ignored with one log line. A body over `maxFrameBytes`, a body that is not JSON, an unknown code, or a truncated frame closes the connection with code `2n` and never throws past the read loop.

Requests and responses share the same frame type: a request body is `{ requestId, request }`, an answer `{ requestId, response }` or `{ requestId, error }`. The asking side owns the `requestId` and its timeout; an unanswered request times out on that side.

### Handshake and known peers

The dialing side opens the stream and writes `hello` first — the receiving side's `acceptBi` resolves only after those first bytes. `hello` is `{ v: 1, selfId, name, color, invite? }`, validated at the wire boundary (version, bounds, palette color, no unknown fields). The receiver admits the connection when the peer is already in `peers.json`, or when the `hello` carries the one-time secret of its pending invitation; an unknown node without a valid secret is closed with code `1n` and one `peer.refused` log line that carries no data. Both sides then record each other: the dialing side stores the peer's ticket, the accepting side stores the record without a ticket and waits for the peer's redial.

### Invitation code

`invite()` waits for the relay address (`online()` bounded by `onlineTimeoutMs`) and refuses to mint a ticket without one, so a code always names a relay-reachable node. The code is `ketos1.<endpoint ticket>.<base32 secret>`; the secret is 16 random bytes, single-use, in memory only, and valid for `inviteTtlMs`. A leaked ticket alone therefore admits nobody.

### Participants and colors

At start the node publishes its own record into the board document (`putOwnParticipant`) with the first free palette color among the document's participants and the known peers' colors, and sends that record in `hello`. When a peer reports the same color, the rule is deterministic: the participant with the larger board `selfId` (string comparison) rewrites its own record to the next free color and announces a new `hello`; the other side keeps its record untouched. Every participant writes only the record keyed by its own `selfId`, so two Ketos instances never overwrite each other's name or color.

### Reconnection

The dialing side owns reconnection: when a link closes it retries the saved ticket with pauses from `reconnectMinMs` to `reconnectMaxMs`, doubling with ±20% jitter, and the peer state shows `lost` between attempts and `connecting` during one. A successful reconnect emits `ketos-peer/connected` again, which stage 33 uses to catch up; plugin disposal cancels every pending attempt.

### Laziness and the native ban

`src/iroh-transport.ts` is the only module that dynamically imports `@number0/iroh`; everything above it — framing, handshake, invitation, participants, reconnection — is tested over the in-memory transport. The pinned iroh-js `1.1.0` aborts the Node process on any `watch*` call and never resolves the native `stopped` read, so both are banned by `tests/native-surface.spec.ts`, which scans the sources; address changes are observed through the relay `online()` wait and the connection's `closed()` promise instead.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `name`/`inject`/`Config`/`apply` and the eager start when peers are known |
| [`src/types.ts`](src/types.ts) | The branded `KetosPeerId`, the peer state and error codes; the module browser code imports type-only |
| [`src/transport.ts`](src/transport.ts) | The transport seam: streams, connections, bind/dial/accept |
| [`src/iroh-transport.ts`](src/iroh-transport.ts) | The only `@number0/iroh` consumer: builder, endpoint, streams, close codes |
| [`src/memory-transport.ts`](src/memory-transport.ts) | The in-process transport pair tests and the protocol specs drive |
| [`src/key-file.ts`](src/key-file.ts) | Owner-only key load or generation with the 32-byte rule |
| [`src/peers-file.ts`](src/peers-file.ts) | The known-peer file: atomic write and boundary validation |
| [`src/invite.ts`](src/invite.ts) | Invitation formatting, parsing, and the base32 secret |
| [`src/frame.ts`](src/frame.ts) | The frame header, code table, envelope, and `hello` validation |
| [`src/link.ts`](src/link.ts) | One connection's write queue, read loop, request correlation, and close handling |
| [`src/color.ts`](src/color.ts) | The palette rules: first free, next free, validity |
| [`src/service.ts`](src/service.ts) | The `ctx.ketosPeer` service, events, known peers, participants, and reconnection |
| [`src/routes.ts`](src/routes.ts) | The three Fetch routes and their error codes |
| — | No runtime invariant companion is published: the state, known-peer, and framing relations are covered by the package specs with the memory transport, and no independently observable in-process relation is left to publish. |

</details>

<a id="further-exploration"></a>
## Further Exploration

- [`packages/ketos/README.md`](../README.md) — the Ketos package group.
- [`@ketos/board-doc`](../board-doc/README.md) — the participant map this package writes and the document stage 33 synchronizes over the channel.
- [`docker/relay/README.md`](../../../docker/relay/README.md) — the private iroh relay and Syncthing relay the deployment runs.
- [`docker/stand/README.md`](../../../docker/stand/README.md) — the two-computer stand that enables this row.

<a id="model-experience"></a>
## Model Experience

None, as the peer channel is transport state: peer identities, invitation codes, frame bodies, and participant colors reach the browser and other host packages, never a model request, prompt section, tool schema, or session event. Stages 33–35 own whatever becomes model-visible on top of the channel.

#### KV Cache effect

No effect; the package changes view and transport state rather than model context.

## Known Limitations and Deferred Work

- The shipped web profile disables the row: without `KETOS_PARTICIPANT_NAME` and `KETOS_RELAY_URLS` the node has no identity or transport, and the board's participants menu shows the "not configured" hint.
- Only two Ketos instances are in scope; the palette rule and known-peer list carry more, but no stage exercises a third node.
- One invitation secret is pending at a time, and it is memory-only: restarting the inviting Ketos invalidates an unused code.
- The accepting side stores no ticket, so asymmetric reconnection relies on the dialing side's retry; after both sides restart, the side that dialed originally reconnects from its saved ticket.
- There are no per-person rights: any known peer's frames are accepted, which is deliberate until after the demo.
- `@number0/iroh` ships no `darwin-x64` build, so an Intel Mac runs Ketos with the peer channel only inside the Docker stand.
- The `watch*` ban is a workaround for iroh-js `1.1.0`; it lifts when the pinned version is raised past the crash and the gate is updated with it.

<a id="dev-note"></a>
### Dev Note

Run the package suite with:

```sh
pnpm exec vitest run packages/ketos/peer --coverage --coverage.include='packages/ketos/peer/src/**/*.ts'
```

The protocol specs run over the in-memory transport; only the transport suite and the Loader composition suite load the native module. Inspect a node's durable state with `cat $DSH_HOME/peers.json` and `stat -f '%Sp' $DSH_HOME/peer.key`.
