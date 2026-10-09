---
description: "The Ketos peer channel host package: the iroh node with a stored key, the framed message channel behind ctx.ketosPeer, the one-time invitation code and the known-peer file, the participant record each Ketos publishes, and the /api/ketos.peer.* Fetch routes."
kind: "package-reference"
---

# @ketos/peer

English | [中文](README.zh.md)

## Summary

`@ketos/peer` owns the channel that lets two Ketos instances on different computers work as one team: an iroh node with a key at `$DSH_HOME/peer.key`, a framed message channel, a one-time `ketos1.…` invitation code, the known-peer file `$DSH_HOME/peers.json`, and each side's participant record in the board document. Other packages reach it through `ctx.ketosPeer`; the browser through `/api/ketos.peer.*`. The channel speaks protocol version 2 (`hello.v` and ALPN `ketos/peer/2`); a build that speaks version 1 cannot connect to it. The node starts lazily, and the shipped web profile keeps the row disabled, so a machine without the stand never loads the native module.

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
| `relayUrls` | required | Relay URLs of the team's private iroh relay; at least one. It is the node's only relay map: public n0 relays are never used. |
| `keyPath` | required | Stored 32-byte node key; the parent directory is created owner-only, the file `0600`. |
| `peersPath` | required | Known-peer file; written atomically `0600`. |
| `maxFrameBytes` | `16777216` | Largest accepted frame body (1 KiB–64 MiB). |
| `maxSyncUpdateBytes` | `15728640` | Largest board synchronization update this Ketos sends (1 KiB–64 MiB; must be less than `maxFrameBytes`). |
| `onlineTimeoutMs` | `15000` | How long `invite()` waits for a relay address (1000–120000). |
| `connectTimeoutMs` | `10000` | Dial, stream, and handshake step bound; also the default request timeout (1000–120000). |
| `reconnectMinMs` | `1000` | First reconnection pause and first board resynchronization pause (100–60000); must not exceed `reconnectMaxMs`, which the plugin checks at load. |
| `reconnectMaxMs` | `20000` | Pause ceiling (100–600000): a jittered pause never exceeds it, and a channel that lived for less than this long counts as a failed attempt. |
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
| `forget(peerId): Promise<void>` | Removes a known peer that has no open channel from `peers.json` and the peer list and cancels its redials; refuses an unknown peer (`ketos/peer-unknown`) and one on a live channel (`ketos/peer-online`) |
| `close(): Promise<void>` | Waits for a start in flight, then closes the node, its channels, and every reconnect attempt |
| `closeSyncTooLarge(peerId)` | Closes one channel because an outgoing synchronization update exceeded the bound; the peer stays known and redials |

The browser polls one route and writes through three:

| Route | Method | Body | Answer |
|---|---|---|---|
| `/api/ketos.peer.state` | `GET` | — | `{ self, peers, refreshMs }` |
| `/api/ketos.peer.invite` | `GET` | — | `{ invite }` |
| `/api/ketos.peer.connect` | `POST` | `{ invite }` | `{ peerId }` |
| `/api/ketos.peer.forget` | `POST` | `{ peerId }` | `{ ok: true }` |

A refusal answers `{ ok: false, error }` with `ketos/invalid` (400), `ketos/peer-self` (409), `ketos/invite-used` (409), `ketos/peer-unreachable` (504), `ketos/peer-offline` (503), `ketos/peer-online` (409, forget of a peer on a live channel), or `ketos/peer-unknown` (404, forget of a peer not in the list); anything else is an empty 500. The route call starts the node, so a process that never polls it never binds.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Node and key

The first start reads `keyPath`; a missing file is generated once with `SecretKey.generate()` and written with the exclusive-create flag at mode `0600` inside a `0700` directory, and a file of any length other than 32 bytes refuses to load instead of silently minting a new identity. The endpoint is built with `presetMinimal`, the peer ALPN `ketos/peer/2`, `RelayMode.customFromUrls(relayUrls)`, and the stored key, so the node's `EndpointId` is stable across restarts. The team's relay is the only relay the node knows: a connection first runs through it, and iroh moves it to a direct path once one is established. The ALPN carries `PEER_PROTOCOL_VERSION`, so a build of another protocol version fails the transport handshake before any frame.

### Frames

One connection carries one bidirectional QUIC stream; every message is `[u32 BE length][u8 code][body]`. The code table reserves `1 hello`, `2 bye`, `3 board.sv`, `4 board.update`, `5 chat.transcript.request`, `6 chat.transcript.response`, and `7 syncthing.device`; stages 34–35 merge their payloads into `PeerFrameTypeMap` through declaration merging and register handlers, and a reserved frame without a handler is ignored with one log line. Codes `3` and `4` carry raw, non-empty `Uint8Array` bodies (the Yjs updates JSON would inflate and never restore); every other body is JSON, and the request/response envelope exists only on JSON codes. `send` encodes and measures a frame before queueing it, so a payload the vocabulary refuses and a body over `maxFrameBytes` fail at the sender instead of breaking the receiver. A binary code whose body is a JSON object or array is refused as well: version 1 sent those frames as JSON, and the receiver rejects them instead of feeding them to Yjs. A malformed body, an unknown code, or a truncated frame closes the connection with code `2n`; a frame handler that throws is logged and the channel stays alive, because one consumer's failure must not cost the connection.

Requests and responses share the same frame type: a request body is `{ requestId, request }`, an answer `{ requestId, response }` or `{ requestId, error }`. The asking side owns the `requestId` and its timeout; an unanswered request times out on that side.

### Handshake and known peers

The dialing side opens the stream and writes `hello` first — the receiving side's `acceptBi` resolves only after those first bytes. `hello` is `{ v: 2, selfId, name, color, invite? }`, validated at the wire boundary (version, bounds, palette color, no unknown fields). The first frame of a connection, in both directions, is read under `PEER_HELLO_MAX_BYTES` (4096 bytes), far below `maxFrameBytes`, so a stranger cannot make the node buffer a large body. The receiver admits the connection when the peer is already in `peers.json`, or when the `hello` carries the one-time secret of its pending invitation; an unknown node without a valid secret is closed with code `1n` and one `peer.refused` log line that carries no data. Both sides then record each other: the dialing side stores the peer's ticket, the accepting side stores the record without a ticket and waits for the peer's redial.

The secret is compared in constant time after its length is checked against the secret's fixed length of 26 characters; a secret of another length counts as wrong. Five wrong secrets burn the pending invitation (log line `peer.invite-burned`) and the next `invite()` starts a new budget.

`transport.accept()` hands out an incoming connection before its transport handshake. Each incoming connection completes that handshake and the `hello` exchange in its own task, so a failure there is logged (`incoming connection failed`, `handshake from … failed`) and closes only that connection; the accept loop ends only when the transport closes.

When a known peer already has a live link, both sides keep the same one connection by one rule. Of two connections with different dialers — both sides dialed at once, which happens when each side holds a ticket — the one dialed by the node with the smaller endpoint id stays. Of two connections with the same dialer, the newer one stays: the accepting side sees a redial only when the dialer's own link is dead, and two racing dials of one node (a pasted code against the reconnect loop) complete in the same order on both ends. A connection that loses before it became a link closes with code `3n` (`duplicate`); a live link that loses closes with code `5n` and reason `replaced` (log line `peer.replaced`), and the consumers see `ketos-peer/disconnected` before the new `ketos-peer/connected`. A reconnect loop stopped because a link attached lets a dial already in flight finish, so the rule, not the timing, decides which connection survives; redial pauses spread over ±20% and, at the ceiling, over its lower 20%, so two redialing sides rarely start together.

### Invitation code

`invite()` waits for the relay address (`online()` bounded by `onlineTimeoutMs`) and refuses to mint a ticket without one, so a code always names a relay-reachable node. The code is `ketos1.<endpoint ticket>.<base32 secret>`; the secret is 16 random bytes, single-use, in memory only, and valid for `inviteTtlMs`. A leaked ticket alone therefore admits nobody.

### Participants and colors

At start the node publishes its own record into the board document (`putOwnParticipant`) with the first free palette color among the document's participants and the known peers' colors, and sends that record in `hello`. When a peer reports the same color, the rule is deterministic: the participant with the larger board `selfId` (string comparison) rewrites its own record to the next free color and announces a new `hello`; the other side keeps its record untouched. Every participant writes only the record keyed by its own `selfId`, so two Ketos instances never overwrite each other's name or color.

### Board synchronization

`src/board-sync.ts` wires the board document into the channel: on every `ketos-peer/connected` — the first connection and every reconnection — the local Ketos sends its state vector (`board.sv`); a received vector is answered with `diffSince(vector)` (`board.update`); a received update is applied through `applyRemote`, and each transaction this Ketos produces is relayed to every connected peer. The document's `peer` origin keeps an applied update from echoing back, so one change is one frame. An update over `maxSyncUpdateBytes` is never sent: the line `board.sync.too-large` goes to the host log and the channel closes with close code `4n`; the peer stays known and redials. When `applyRemote` throws, or returns `{ pending: true }` because Yjs kept structs waiting for an earlier update, this Ketos sends its state vector again after a pause that starts at `reconnectMinMs` and doubles up to `reconnectMaxMs` (log line `board.sync.resync`), so the sender supplies what the document misses instead of the gap lasting until the next reconnection. A clean apply ends a resync scheduled only for such a gap, a failed apply keeps its resync, and a new channel replaces any resync with the full vector exchange.

### Reconnection

The dialing side owns reconnection: when a link closes it retries the saved ticket with pauses from `reconnectMinMs` to `reconnectMaxMs`, doubling with ±20% jitter and never exceeding `reconnectMaxMs`, and the peer state shows `lost` between attempts and `connecting` during one. A channel that lived for less than `reconnectMaxMs` counts as a failed attempt: the next pause doubles from the previous redial's pause (log line `peer.flapping`) and a successful handshake does not reset it, so an exchange that keeps closing the channel, such as an update over the size bound, slows down instead of redialing every `reconnectMinMs`. Only a channel that lived at least `reconnectMaxMs` starts over from `reconnectMinMs`. A successful reconnect emits `ketos-peer/connected` again, which board synchronization uses to catch up; plugin disposal cancels every pending attempt.

`forget(peerId)` cancels the peer's redials, including one in flight, and rewrites `peers.json` without it; an incoming handshake of that peer that began before the call is closed (`forgotten`) instead of bringing the peer back. When the file cannot be written the peer stays known and redials continue. A forgotten peer is admitted again only through a new invitation.

### Laziness and the native ban

A start that fails keeps the transport it created, so the retry the next route call triggers binds the same node instead of leaving one bound iroh node per attempt. Every `await` of the start is followed by a disposal check, and `close()` waits for a start in flight before it closes the transport; a link attach after `close()` is refused. `bind()` of the iroh transport closes an endpoint that finished binding after `close()`.

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
| [`src/link.ts`](src/link.ts) | One connection's write queue, read loop, request correlation, close handling, and the close codes |
| [`src/color.ts`](src/color.ts) | The palette rules: first free, next free, validity |
| [`src/service.ts`](src/service.ts) | The `ctx.ketosPeer` service, events, known peers, participants, and reconnection |
| [`src/board-sync.ts`](src/board-sync.ts) | The board document schedule over the channel: state vectors, updates, the too-large bound, and resynchronization |
| [`src/routes.ts`](src/routes.ts) | The four Fetch routes and their error codes |
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
- A synchronization update over `maxSyncUpdateBytes` is not sent: the channel closes and the peer redials with growing pauses, repeating the exchange. The bound sits far above a normal board (strokes are rounded in stage 30), so only a pathological document reaches it.
- Synchronization accepts every update a connected known peer sends; per-person rights arrive after the demo, so a channel that is not lost is trusted.
- The stage 32 build speaks protocol version 1 and the stage 33 build version 2 (binary board frames, new ALPN); they cannot connect to each other and no fallback exists, so both Ketos instances of a pair run the same build.

<a id="dev-note"></a>
### Dev Note

Run the package suite with:

```sh
pnpm exec vitest run packages/ketos/peer --coverage --coverage.include='packages/ketos/peer/src/**/*.ts'
```

The protocol specs run over the in-memory transport; only the transport suite and the Loader composition suite load the native module. Inspect a node's durable state with `cat $DSH_HOME/peers.json` and `stat -f '%Sp' $DSH_HOME/peer.key`.
