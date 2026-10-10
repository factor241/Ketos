---
description: "The Ketos peer channel host package: the iroh node with a stored key, the framed message channel behind ctx.ketosPeer, the one-time invitation code and the known-peer file, the participant record each Ketos publishes, the read-only transcript of a foreign chat window, the optional link of both Ketoses' Syncthing devices to one shared folder, and the /api/ketos.peer.* Fetch routes."
kind: "package-reference"
---

# @ketos/peer

English | [中文](README.zh.md)

## Summary

`@ketos/peer` owns the channel that lets two Ketos instances on different computers work as one team: an iroh node with a key at `$DSH_HOME/peer.key`, a framed message channel, a one-time `ketos1.…` invitation code, the known-peer file `$DSH_HOME/peers.json`, each side's participant record in the board document, the read-only transcript of the other Ketos's chat windows, and, optionally, one shared Syncthing folder linked over the channel. Other packages reach it through `ctx.ketosPeer`; the browser through `/api/ketos.peer.*`. The node starts lazily, and the shipped web profile keeps the row disabled, so a machine without the stand never loads the native module.

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
| `maxFrameBytes` | `16777216` | Largest accepted frame body (1 KiB–64 MiB). It must be at least `transcriptMaxBytes` plus 1024, so it cannot be below 66560 while `transcriptMaxBytes` keeps its default. |
| `maxSyncUpdateBytes` | `15728640` | Largest board synchronization update this Ketos sends (1 KiB–64 MiB; must be less than `maxFrameBytes`). |
| `onlineTimeoutMs` | `15000` | How long `invite()` waits for a relay address (1000–120000). |
| `connectTimeoutMs` | `10000` | Dial, stream, and handshake step bound; also the default request timeout (1000–120000). |
| `reconnectMinMs` | `1000` | First reconnection pause and first board resynchronization pause (100–60000); must not exceed `reconnectMaxMs`, which the plugin checks at load. |
| `reconnectMaxMs` | `20000` | Pause ceiling (100–600000): a jittered pause never exceeds it, and a channel that lived for less than this long counts as a failed attempt. |
| `inviteTtlMs` | `3600000` | Lifetime of one invitation secret (60000–86400000). |
| `stateRefreshMs` | `1000` | Poll interval the state route publishes (250–60000). |
| `heartbeatIntervalMs` | `3000` | Pause between two `peer.ping` frames on every channel (500–30000). |
| `heartbeatTimeoutMs` | `9000` | Longest time a channel may complete no read (a frame header or a 16 KiB body slice) before it closes with reason `heartbeat-timeout`, the peer shows `lost`, and the redial starts (1000–60000); at least twice `heartbeatIntervalMs`, which the plugin checks at load. |
| `bindAddr` | absent | Local bind address; absent binds every interface on an ephemeral port. |
| `transcriptMaxMessages` | `20` | Most messages this Ketos returns for a chat window it hosts; the latest ones are kept (1–200). |
| `transcriptMaxMessageChars` | `4000` | Most UTF-16 code units of one returned message's text (1–100000). `transcriptMaxBytes` must be at least this value × 6 + 256. |
| `transcriptMaxBytes` | `65536` | Most bytes of one transcript response; the oldest messages drop first (1024–1048576). It must be at least `transcriptMaxMessageChars` × 6 + 256, and with 1024 bytes reserved for the request envelope it must fit `maxFrameBytes`; the plugin checks both at load. |
| `transcriptTimeoutMs` | `5000` | How long this Ketos waits for the other Ketos to answer a transcript request (500–60000). |
| `syncthing` | absent | The shared Syncthing folder, described below; absent turns the feature off. |

The stand row adds a `syncthing` section like this one; its `relayAddress` is `KETOS_SYNCTHING_RELAY` with the `token` parameter removed:

```yaml
    syncthing:
      url: http://127.0.0.1:8384
      apiKeyEnv: STGUIAPIKEY
      relayAddress: relay://203.0.113.7:22067/?id=<relay device id>
      folderId: ketos-shared
      folderPath: /workspace/shared
      fsWatcherDelayS: 1
```

| Field | Default | Meaning |
|---|---|---|
| `syncthing.url` | required | Base URL of the local Syncthing REST API; `http://` only for a loopback host, since the API key travels in a request header, and no user name, password, query, or fragment. |
| `syncthing.apiKeyEnv` | required | Environment variable that holds the Syncthing API key, a credential reference read through the credentials service when the composition has one and from the launch environment when there is no such service or it has no value; the key is read again before every Syncthing request. When it is not set at start, only the Syncthing feature stays off, with one `syncthing.disabled` log line; the channel and board synchronization keep working. |
| `syncthing.relayAddress` | required | The private Syncthing relay as `relay://host:port/?id=<relay device id>`, without the `token` parameter; every peer device is dialed only there. |
| `syncthing.folderId` | required | Id of the shared folder: 1–64 letters, digits, `.`, `_`, or `-`, starting with a letter or digit. |
| `syncthing.folderPath` | required | Absolute directory of the shared folder on the Syncthing host. |
| `syncthing.fsWatcherDelayS` | `10` | Seconds Syncthing's watcher collects changes before a scan (1–3600). |
| `syncthing.statusRefreshMs` | `2000` | Interval of the shared-folder state poll (250–60000). |
| `syncthing.requestTimeoutMs` | `5000` | Budget of one Syncthing request, reading the answer included (100–60000). |
| `syncthing.retryMs` | `2000` | Pause before a linking step retries after Syncthing gave no answer, timed out, or answered with a server error (100–600000). |
| `syncthing.kickAfterLostMs` | `90000` | Shortest channel loss after which the next connection restarts Syncthing's connection to the peer device (10000–600000). Shorter outages leave Syncthing's relay connection alone: it survives them, and each restart spends one of the few immediate redials Syncthing allows per device. |

An invalid value of the section, including an empty `relayAddress` or one that carries `token`, refuses the plugin at load; the error names the field and the rule and never the value, so a relay token or a URL password does not reach the log.

The service is the host-side seam other Ketos packages use:

| Member | Answer |
|---|---|
| `peers(): PeerState[]` | Every known peer with `peerId`, `selfId`, `name`, `color`, and `link: 'online' \| 'connecting' \| 'lost'` |
| `send(peerId, type, payload)` | One frame to a connected peer; rejects while no channel is open |
| `request(peerId, type, payload, { timeoutMs })` | One request envelope; the answer resolves, a timeout (`PeerRequestTimeoutError`), a closed channel, or a remote error rejects |
| `handle(type, handler): () => void` | Registers a handler; every handler of a type runs, the first one's value answers a request. Consumers own the unsubscribe through `ctx.effect` |
| `invite(): Promise<string>` | One `ketos1.<ticket>.<secret>` code after the relay address exists; a previous unused secret is replaced |
| `connect(code): Promise<{ peerId }>` | Dials the code's ticket, completes the handshake, and records the peer |
| `state(): Promise<PeerStateResponse>` | The local record, every peer, `refreshMs`, and `sharedFolder` while the Syncthing feature reports one |
| `nodeId(): Promise<KetosPeerId>` | The local iroh identity derived from the stored key |
| `startIfKnownPeers(): Promise<void>` | Starts the node only when `peers.json` names someone |
| `forget(peerId): Promise<void>` | Removes a known peer that has no open channel from `peers.json` and the peer list, cancels its redials, and then emits `ketos-peer/forgotten`; refuses an unknown peer (`ketos/peer-unknown`) and one on a live channel (`ketos/peer-online`) |
| `close(): Promise<void>` | Waits for a start in flight, then closes the node, its channels, and every reconnect attempt |
| `closeSyncTooLarge(peerId)` | Closes one channel because an outgoing synchronization update exceeded the bound; the peer stays known and redials |

The browser polls one route, writes through three, and reads a foreign transcript through one:

| Route | Method | Body | Answer |
|---|---|---|---|
| `/api/ketos.peer.state` | `GET` | — | `{ self, peers, refreshMs, sharedFolder? }`; `sharedFolder` is `unavailable`, `waiting`, `syncing`, `synced`, or `error`, absent while the Syncthing feature is off |
| `/api/ketos.peer.invite` | `GET` | — | `{ invite }` |
| `/api/ketos.peer.connect` | `POST` | `{ invite }` | `{ peerId }` |
| `/api/ketos.peer.forget` | `POST` | `{ peerId }` | `{ ok: true }` |
| `/api/ketos.peer.transcript` | `POST` | `{ windowId }` | `{ messages: { role: 'user' \| 'agent', text, at }[] }`, oldest first |

A refusal answers `{ ok: false, error }` with `ketos/invalid` (400), `ketos/peer-self` (409), `ketos/invite-used` (409), `ketos/peer-unreachable` (504), `ketos/peer-offline` (503), `ketos/peer-online` (409, forget of a peer on a live channel), `ketos/peer-unknown` (404, forget of a peer not in the list), `ketos/transcript-closed` (403, the owner's access does not admit this Ketos), `ketos/window-not-found` (404, no such foreign chat window or the owner no longer hosts it), or `ketos/peer-timeout` (504, the owner did not answer within `transcriptTimeoutMs`); anything else is an empty 500. The transcript route also answers `ketos/peer-offline` when the owner has no online channel, could not read its session log, or sent an answer that is not one of the wire forms. The route call starts the node, so a process that never polls it never binds.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Node and key

The first start reads `keyPath`; a missing file is generated once with `SecretKey.generate()` and written with the exclusive-create flag at mode `0600` inside a `0700` directory, and a file of any length other than 32 bytes refuses to load instead of silently minting a new identity. The endpoint is built with `presetMinimal`, the peer ALPN `ketos/peer/3`, `RelayMode.customFromUrls(relayUrls)`, and the stored key, so the node's `EndpointId` is stable across restarts. The team's relay is the only relay the node knows: a connection first runs through it, and iroh moves it to a direct path once one is established. The ALPN carries `PEER_PROTOCOL_VERSION`, so a build of another protocol version fails the transport handshake before any frame.

### Frames

One connection carries one bidirectional QUIC stream; every message is `[u32 BE length][u8 code][body]`. The code table reserves `1 hello`, `2 bye`, `3 board.sv`, `4 board.update`, `5 chat.transcript.request`, `6 chat.transcript.response`, `7 syncthing.device`, `8 peer.ping`, and `9 peer.pong`; consumers merge their payloads into `PeerFrameTypeMap` through declaration merging and register handlers, and a reserved frame without a handler is ignored with one log line. The link itself consumes `hello`, `bye`, `peer.ping`, and `peer.pong`; no handler receives them. A transcript answer travels in the response envelope on code `5`, so code `6` carries no frame. Codes `3` and `4` carry raw, non-empty `Uint8Array` bodies (the Yjs updates JSON would inflate and never restore); every other body is JSON, and the request/response envelope exists only on JSON codes. `send` encodes and measures a frame before queueing it, so a payload the vocabulary refuses and a body over `maxFrameBytes` fail at the sender instead of breaking the receiver. A binary code whose body is a JSON object or array is refused as well: version 1 sent those frames as JSON, and the receiver rejects them instead of feeding them to Yjs. A malformed body, an unknown code, or a truncated frame closes the connection with code `2n`; a frame handler that throws is logged and the channel stays alive, because one consumer's failure must not cost the connection.

Requests and responses share the same frame type: a request body is `{ requestId, request }`, an answer `{ requestId, response }` or `{ requestId, error }`. The asking side owns the `requestId` and its timeout; an unanswered request times out on that side.

### Handshake and known peers

The dialing side opens the stream and writes `hello` first — the receiving side's `acceptBi` resolves only after those first bytes. `hello` is `{ v: 3, selfId, name, color, invite? }`, validated at the wire boundary (version, bounds, palette color, no unknown fields). The first frame of a connection, in both directions, is read under `PEER_HELLO_MAX_BYTES` (4096 bytes), far below `maxFrameBytes`, so a stranger cannot make the node buffer a large body. The receiver admits the connection when the peer is already in `peers.json`, or when the `hello` carries the one-time secret of its pending invitation; an unknown node without a valid secret is closed with code `1n` and one `peer.refused` log line that carries no data. Both sides then record each other: the dialing side stores the peer's ticket, the accepting side stores the record without a ticket and waits for the peer's redial.

The secret is compared in constant time after its length is checked against the secret's fixed length of 26 characters; a secret of another length counts as wrong. Five wrong secrets burn the pending invitation (log line `peer.invite-burned`) and the next `invite()` starts a new budget.

`transport.accept()` hands out an incoming connection before its transport handshake. Each incoming connection completes that handshake and the `hello` exchange in its own task, so a failure there is logged (`incoming connection failed`, `handshake from … failed`) and closes only that connection; the accept loop ends only when the transport closes.

When a known peer already has a live link, both sides keep the same one connection by one rule. Of two connections with different dialers — both sides dialed at once, which happens when each side holds a ticket — the one dialed by the node with the smaller endpoint id stays. Of two connections with the same dialer, the newer one stays: the accepting side sees a redial only when the dialer's own link is dead, and two racing dials of one node (a pasted code against the reconnect loop) complete in the same order on both ends. A connection that loses before it became a link closes with code `3n` (`duplicate`); a live link that loses closes with code `5n` and reason `replaced` (log line `peer.replaced`), and the consumers see `ketos-peer/disconnected` before the new `ketos-peer/connected`. A reconnect loop stopped because a link attached lets a dial already in flight finish, so the rule, not the timing, decides which connection survives; redial pauses spread over ±20% and, at the ceiling, over its lower 20%, so two redialing sides rarely start together.

### Invitation code

`invite()` waits for the relay address (`online()` bounded by `onlineTimeoutMs`) and refuses to mint a ticket without one, so a code always names a relay-reachable node. The code is `ketos1.<endpoint ticket>.<base32 secret>`; the secret is 16 random bytes, single-use, in memory only, and valid for `inviteTtlMs`. A leaked ticket alone therefore admits nobody.

### Participants and colors

At start the node publishes its own record into the board document (`putOwnParticipant`) with the first free palette color among the document's participants and the known peers' colors, and sends that record in `hello`. When a peer reports the same color, the rule is deterministic: the participant with the larger board `selfId` (string comparison) rewrites its own record to the next free color and announces a new `hello`; the other side keeps its record untouched. Every participant writes only the record keyed by its own `selfId`, so two Ketos instances never overwrite each other's name or color.

### Board synchronization

`src/board-sync.ts` wires the board document into the channel: on every `ketos-peer/connected` — the first connection and every reconnection — the local Ketos sends its state vector (`board.sv`); a received vector is answered with `diffSince(vector)` (`board.update`); a received update is applied through `applyRemote`, and each transaction this Ketos produces is relayed to every connected peer. The document's `peer` origin keeps an applied update from echoing back, so one change is one frame. An update over `maxSyncUpdateBytes` is never sent: the line `board.sync.too-large` goes to the host log and the channel closes with close code `4n`; the peer stays known and redials. When `applyRemote` throws, or returns `{ pending: true }` because Yjs kept structs waiting for an earlier update, this Ketos sends its state vector again after a pause that starts at `reconnectMinMs` and doubles up to `reconnectMaxMs` (log line `board.sync.resync`), so the sender supplies what the document misses instead of the gap lasting until the next reconnection. A clean apply ends a resync scheduled only for such a gap, a failed apply keeps its resync, and a new channel replaces any resync with the full vector exchange.

### Foreign chat transcripts

A Ketos shows another Ketos's chat window as a card, and its user can ask for the window's latest messages. The asking Ketos finds the window record in its board document and sends `chat.transcript.request` with `{ windowId }` to the online peer whose `selfId` equals the record's `hostId` (`POST /api/ketos.peer.transcript`). It accepts only a window of `kind: 'agent'` that another Ketos hosts. A request that fails for any reason except the timeout, such as a closed channel or an error the owner raised, answers `ketos/peer-offline`; a request the owner leaves unanswered for `transcriptTimeoutMs` answers `ketos/peer-timeout`. The answer is checked against the wire forms below; a malformed one counts as an unavailable owner, and a malformed message refuses the whole answer.

The owning Ketos alone decides, in `src/transcript.ts`. It reads its own window record from the board document and answers `{ ok: false, reason: 'not-found' }` unless the record has `hostId` equal to the local `selfId`, `kind: 'agent'`, and a `sessionId`. The requester is the known peer behind the channel the frame arrived on, identified by the `selfId` that peer declared in its `hello`; the request body names the window and nothing else, and any other field makes it malformed, which answers `not-found`. Access follows the record: `all` admits every known peer, `owner` admits the peer whose `selfId` equals the record's `ownerId`, and `selected` admits the record's `ownerId` and the peers whose `selfId` appears in `access.people`, because the client omits the owner from that list; otherwise the answer is `{ ok: false, reason: 'closed' }`. The record is read again on every request, so closing a window stops the answers at once.

`src/transcript-read.ts` reads the session through `ctx.sessionPersistence` with a read handle, flushing a live session first, in slices of 500 events. The slices bound the transcript text the package retains, not the backend's memory: the JSONL backend decodes the whole log for each read, memoised only while the file revision is unchanged, every request flushes a live session, and concurrent requests from a paired peer are not rate-limited. A session with no stored log yet, such as a new window, answers `{ ok: true, messages: [] }`. Only `user/message` events whose `source.kind` is `user` and `assistant/message` events contribute, and only those that appended to the surface (the replacement copies compaction writes are skipped), and only their `text` blocks, joined by a blank line; reasoning, tool calls and results, images, files, context other producers inject, and system or developer messages never leave the owning Ketos. The answer holds at most `transcriptMaxMessages` of the latest messages, each text cut to `transcriptMaxMessageChars` code units without splitting a surrogate pair, and the oldest messages drop until the JSON of `{ ok: true, messages }` fits `transcriptMaxBytes`; a message whose text is empty after the cut is skipped. The load check on `transcriptMaxBytes` (6 bytes is the widest JSON escape of one UTF-16 unit, 256 covers the wrapper, role, and time) guarantees the longest message fits, so an oversized newest message never empties the transcript. A session that left the live store between the lookup and the flush is read cold. A session service that is not mounted, a failed read of an existing log, or a failed board read answers `{ ok: false, reason: 'unavailable' }` with no text from the error; the host log keeps one line with the window id and the error. The optional session services are resolved with `ctx.get` on each request, so the shipped web profile loads the row without them.

### Shared Syncthing folder

`src/syncthing.ts` starts the feature when the `syncthing` section is present. It reads the API key that `apiKeyEnv` names; without it at start the feature stays off with exactly one `syncthing.disabled` line, sends no Syncthing request, and leaves `sharedFolder` out of the peer state. Otherwise it creates the client of `src/syncthing-client.ts`: every request reads the key again, as the credentials service requires, so a changed key reaches the next request; it carries the key in `X-API-Key`, ends after `requestTimeoutMs` or at plugin disposal, and validates the fields this package reads while accepting any other field of Syncthing's answer. A failure is a `SyncthingError` that names the method, the path, the HTTP status (`0` when no answer arrived or nothing was sent), and its kind — `no-answer`, `refused`, `invalid`, or `no-key` — never the key or a response body; only `no-answer` and a `refused` server error (5xx) are transient.

Linking in `src/syncthing-link.ts` uses frame `7 syncthing.device`, whose JSON body is exactly `{ deviceId }`. The id must be canonical (`src/syncthing-device-id.ts`): eight dash-separated groups of seven `A–Z2–7` characters whose 14th, 28th, 42nd, and 56th characters are Luhn mod 32 check characters over the base32 alphabet, and whose last data character, the 55th, is `A` or `Q`, because its four low bits are padding. Lowercase, the typo-repaired digits `0`, `1`, `8`, the 52-character form, and set padding bits, which Syncthing itself accepts, are refused; an invalid frame or this Syncthing's own id is dropped with one `syncthing.device-invalid` line. On every `ketos-peer/connected` each side reads its own `myID` and sends it. A received id is applied in one queue: first the device `ketos:<peer id>` with `addresses: [relayAddress]`, `autoAcceptFolders: false`, and `paused: false`, as a complete PUT body because Syncthing resets the fields a PUT omits; then the folder, created with a complete body (`type: 'sendreceive'`, the watcher on with `fsWatcherDelayS`, the peer's device) when it is missing and otherwise patched with the merged device list. Devices compare by name, addresses, and folder acceptance, and folder device lists as sets without the own device, so a matching configuration writes nothing: the exchange at every reconnection is an idempotent re-check, and after a container restart Syncthing's own configuration on its volume keeps the link. A device named `ketos:<peer id>` under another id, left behind when the peer's Syncthing volume was wiped, leaves the folder and the configuration (`syncthing.device-replaced`), so the device list does not grow; a second participant joins the folder without displacing the first. While Syncthing gives no answer, times out, or answers with a server error, and after any failure that is not a `SyncthingError`, such as a frame the channel could not send, sending and applying retry every `retryMs` with one `syncthing.retry` line per step. Any other `SyncthingError`, such as a refused key (401, 403), a malformed answer, or a key that is no longer set, stops the step with one `syncthing.link-stopped` line until the channel connects again. The peer's disconnection or plugin disposal stops both steps, and a newer id from the same peer replaces one not applied yet; an application that waited in the queue checks this when its turn comes and then writes nothing. A link that wrote something logs `syncthing.linked`. When the channel was lost for at least `kickAfterLostMs` before it connected again, the first application of that connection whose peer device is already configured under the same id then restarts Syncthing's connection to it: `POST /rest/system/pause?device=<id>`, then `POST /rest/system/resume?device=<id>` even when the pause failed, logged as `syncthing.reconnected`. After such an outage the relay session is gone, yet Syncthing can keep the dead connection counted as connected for more than a minute; the pause closes it and the resume dials the device at once. The loss is measured on the wall clock from `ketos-peer/disconnected` to the next `ketos-peer/connected`. A shorter outage, a first connection, and a connection without a preceding loss get no restart, because Syncthing's connection survives short outages and Syncthing force-redials a device at most three times within 2 minutes before it holds off for 5 minutes. A first linking and a replaced device get no restart either, since Syncthing dials a new device by itself, and a frame the peer sends again on the same channel gets none. Syncthing stores the pause in its configuration, so a failed pause or resume fails the application step and a retry restarts again. Every application also resumes the peer device with one `POST /rest/system/resume?device=<id>` when Syncthing reports it paused although it otherwise matches (`syncthing.device-resumed`), with no restart, since the resume dials the device at once; a device left paused by a failed resume or by a restart a stopped Ketos interrupted is therefore resumed at the next connection, and a device that is not paused costs no request. When a peer is forgotten (`ketos-peer/forgotten`), every device named `ketos:<peer id>` other than the own device leaves the folder and then the configuration, in the same queue and with the same retries, and `syncthing.unlinked` reports the count; a refused removal stops with one `syncthing.link-stopped` line and leaves the device configured, and a device id the same peer sends again after a new invitation ends a removal that has not run yet. While the feature is off, forgetting a peer sends no Syncthing request.

`src/syncthing-state.ts` polls Syncthing every `statusRefreshMs` and keeps the result, so the state route reads `sharedFolder` from memory; it is `waiting` until the first poll completes. The first poll after Syncthing answers, at feature start and again after Syncthing stopped answering, compares `/rest/config/options` with what `docker/stand/syncthing-bootstrap.mjs` writes, with reads only: global and local announcements and NAT traversal off, relays on, the private relay among the listen addresses (compared as URLs without `token`, the query decoded and unordered), and no `default` or `dynamic+` listen address, which would join the public relay pool. The state is `unavailable` when Syncthing does not answer; `error` when it refuses a request or answers malformed JSON, when the API key is no longer set, when the settings diverge (`syncthing.settings-diverge` names the settings, never an address), or when the folder reports `error`; `waiting` when the folder is missing or not running, no device of the folder is connected, the folder state is `unknown`, or any other state that is not `idle`, `error`, or a scanning or transferring state, while nothing is needed, no connected device of the folder carries a valid `ketos:<peer id>` name, the Ketos channel to no peer of a connected device is online, whether the folder syncs or is idle, or no peer with an online channel has its Syncthing sharing the folder back; `syncing` while the folder scans, waits, prepares, transfers, cleans, or starts, or still needs items or deletions, and the Ketos channel to the peer of a connected device is online, and while it is idle but every peer with an online channel whose Syncthing shares the folder back still needs items or deletions; and `synced` when it is `idle`, needs nothing, and a connected device of the folder carries the name `ketos:<peer id>` of a peer whose Ketos channel is `online` and whose Syncthing shares the folder back and needs nothing. For each such device, `/rest/db/completion?folder=<id>&device=<device id>` gives this Syncthing's view of the peer: `remoteState` is `valid` once the peer's cluster configuration shares the folder and runs it, and `needItems` plus `needDeletes` count what the peer still needs according to the index it sent. Syncthing notices a lost connection much later than the channel's heartbeat, so every state route call reads the channel condition from the service's link states, and `syncing` and `synced` turn `waiting` the moment the channel is lost, without a Syncthing request; `unavailable` and `error` do not depend on the channel. A log line appears only when the reported condition changes; the flips between `syncing` and `synced` log nothing.

### Heartbeat

iroh-js `1.1.0` offers no idle-timeout or keep-alive setting, so without more a broken path is noticed only by QUIC's idle timeout after about 30 seconds. Every link therefore runs a heartbeat from its start until it closes: it sends `peer.ping` every `heartbeatIntervalMs`, whatever else it sends, and answers every received `peer.ping` with `peer.pong`; both bodies are exactly `{}`, and a header that declares a body of more than 16 bytes for either code closes the connection with `2n` before the body is read. Every completed read restarts the `heartbeatTimeoutMs` countdown: a frame header, and each body slice of up to 16 KiB. Board traffic therefore keeps a channel open, and a large update keeps it open while each 16 KiB slice arrives within the timeout, which needs about 14.6 kbit/s with the defaults; the bytes of an unfinished slice do not count. When the countdown expires, the link decides one event-loop turn later, after Node delivered the bytes that arrived while the event loop was blocked: a read completed in that turn restarts the countdown; otherwise the link logs one `peer.heartbeat-timeout <peer>` line and closes with code `6n` and reason `heartbeat-timeout`. The peer turns `lost`, `ketos-peer/disconnected` fires, and the dialing side redials as after any other loss. Because every ping is answered, each side's detection depends only on its own two values: with the defaults the board shows the peer as not connected at most `heartbeatTimeoutMs` plus one `stateRefreshMs` poll after the last completed read. The link's two timers end with the link, and a link that closed before `start()` arms none.

### Reconnection

The dialing side owns reconnection: when a link closes it retries the saved ticket with pauses from `reconnectMinMs` to `reconnectMaxMs`, doubling with ±20% jitter and never exceeding `reconnectMaxMs`, and the peer state shows `lost` between attempts and `connecting` during one. A channel that lived for less than `reconnectMaxMs` counts as a failed attempt: the next pause doubles from the previous redial's pause (log line `peer.flapping`) and a successful handshake does not reset it, so an exchange that keeps closing the channel, such as an update over the size bound, slows down instead of redialing every `reconnectMinMs`. Only a channel that lived at least `reconnectMaxMs` starts over from `reconnectMinMs`. A successful reconnect emits `ketos-peer/connected` again, which board synchronization uses to catch up; plugin disposal cancels every pending attempt. The `connectTimeoutMs` bound of a dial does not cancel the transport's dial, so a connection that completes after the bound gave up is closed at once with code `0n` and reason `dial timed out` instead of waiting for the other side's handshake timeout.

`forget(peerId)` cancels the peer's redials, including one in flight, and rewrites `peers.json` without it; an incoming handshake of that peer that began before the call is closed (`forgotten`) instead of bringing the peer back. Once the file is written, `ketos-peer/forgotten` fires, and the Syncthing feature removes the peer's device. When the file cannot be written the peer stays known, redials continue, and no event fires. A forgotten peer is admitted again only through a new invitation.

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
| [`src/frame.ts`](src/frame.ts) | The frame header, code table, per-code body bound, envelope, and `hello` and heartbeat validation |
| [`src/link.ts`](src/link.ts) | One connection's write queue, read loop, request correlation, heartbeat, close handling, and the close codes |
| [`src/color.ts`](src/color.ts) | The palette rules: first free, next free, validity |
| [`src/service.ts`](src/service.ts) | The `ctx.ketosPeer` service, events, known peers, participants, and reconnection |
| [`src/board-sync.ts`](src/board-sync.ts) | The board document schedule over the channel: state vectors, updates, the too-large bound, and resynchronization |
| [`src/transcript.ts`](src/transcript.ts) | The `chat.transcript.*` frame types, the owner-side handler with its access decision, and the wire validation both sides share |
| [`src/transcript-read.ts`](src/transcript-read.ts) | Reading the latest messages out of a stored session and the three limits on them |
| [`src/syncthing.ts`](src/syncthing.ts) | The Syncthing feature: API key lookup, the off state, and the wiring of the client, the linking, and the state |
| [`src/syncthing-config.ts`](src/syncthing-config.ts) | The `syncthing` section, its load checks, the relay address comparison, and the settings check |
| [`src/syncthing-client.ts`](src/syncthing-client.ts) | The Syncthing REST client and `SyncthingError` |
| [`src/syncthing-device-id.ts`](src/syncthing-device-id.ts) | Canonical device ids and their Luhn mod 32 check characters |
| [`src/syncthing-link.ts`](src/syncthing-link.ts) | The `syncthing.device` frame, the device names, and the device and folder linking |
| [`src/syncthing-state.ts`](src/syncthing-state.ts) | The shared-folder state poll and its Ketos channel condition |
| [`src/routes.ts`](src/routes.ts) | The five Fetch routes and their error codes |
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

None, as the peer channel is transport state: peer identities, invitation codes, frame bodies, participant colors, and the transcript text of a foreign chat window reach the browser and other host packages, never a model request, prompt section, tool schema, or session event. Packages built on the channel own whatever becomes model-visible.

#### KV Cache effect

No effect; the package changes view and transport state rather than model context.

## Known Limitations and Deferred Work

- The shipped web profile disables the row: without `KETOS_PARTICIPANT_NAME` and `KETOS_RELAY_URLS` the node has no identity or transport, and the board's participants menu shows the "not configured" hint.
- Only two Ketos instances are in scope; the palette rule and known-peer list carry more, but no stage exercises a third node.
- One invitation secret is pending at a time, and it is memory-only: restarting the inviting Ketos invalidates an unused code.
- The accepting side stores no ticket, so asymmetric reconnection relies on the dialing side's retry; after both sides restart, the side that dialed originally reconnects from its saved ticket.
- Frames from any known peer are accepted; the only per-person rule is the chat transcript access, and it decides by the `selfId` the peer declared in its `hello`. The channel does not authenticate that declaration and a paired node can change it, so a known peer could claim another participant's id, and the transcript route accepts an answer from any online peer that claims the owner's `selfId`. The line trusts its peers until after the demo.
- The window record the transcript decision reads belongs to the synchronized board document, which trusts the other Ketos to write it (`applyRemote` does not enforce a single writer), so a malicious paired Ketos could rewrite another Ketos's window access or `sessionId` and read its transcript. Hardening both identity and record ownership is deferred until after the demo.
- A transcript holds only the latest `transcriptMaxMessages` text messages of a chat. Tool calls and results, attachments, and reasoning are never included, and a message longer than `transcriptMaxMessageChars` is cut without a marker.
- The owner reads the session log from the first event on every transcript request, keeps no cache, flushes a live session each time, and applies no rate limit, so requests against a very long session cost a pass over its log each; the JSONL backend's own memoisation holds only while the file revision is unchanged.
- A `transcriptMaxBytes` larger than the receiving Ketos's `maxFrameBytes` closes the link when the answer arrives, because the receiver refuses the frame; only the owner's own `maxFrameBytes` is checked at load.
- `@number0/iroh` ships no `darwin-x64` build, so an Intel Mac runs Ketos with the peer channel only inside the Docker stand.
- The `watch*` ban is a workaround for iroh-js `1.1.0`; it lifts when the pinned version is raised past the crash and the gate is updated with it.
- A synchronization update over `maxSyncUpdateBytes` is not sent: the channel closes and the peer redials with growing pauses, repeating the exchange. The bound sits far above a normal board (strokes are rounded in stage 30), so only a pathological document reaches it.
- Synchronization accepts every update a connected known peer sends; per-person rights arrive after the demo, so a channel that is not lost is trusted.
- The Syncthing GUI has no password until after the demo; the stand publishes it on `127.0.0.1` only ([stand README](../../../docker/stand/README.md)).
- One shared folder only: the section names one `folderId`, and every linked peer device joins it.
- A known peer's device id is applied as sent, so a paired Ketos can add any Syncthing device of its choice to the shared folder; the channel's trust in its peers covers this until after the demo.
- Diverging Syncthing settings make the state `error` but do not stop the linking: peer devices are dialed only at the private relay, while Syncthing's own discovery stays as configured until the operator fixes it.
- The previous device of a peer is found by its name `ketos:<peer id>`; a device renamed in the Syncthing GUI is no longer replaced when the peer's id changes nor removed when the peer is forgotten, and the shared-folder state no longer reaches `synced`.
- A Ketos that returns with a new identity after all of its volumes were wiped is a new peer: the device of its previous identity stays in the shared folder until that previous peer is forgotten.
- Outages of at least `kickAfterLostMs` are handled by restarting Syncthing's connection to the peer device when the Ketos channel connects again. A Syncthing relay connection that dies while the channel stays up, or during a shorter outage, stays counted as connected until Syncthing notices the loss itself: it sends a protocol ping at most every 90 s and closes a connection that has received nothing for 300 s, a check it runs every 150 s, unless the relay or TCP connection fails earlier. Only after that close does Syncthing redial the device through the relay, at most once a minute on the stand (`relayReconnectIntervalM=1`); until then the folder shows `syncing` or `synced` from Syncthing's view.
- A `ketos:<peer id>` device paused in the Syncthing GUI is resumed at the peer's next channel connection, so the GUI cannot keep a linked peer paused; forgetting the peer removes its device instead.
- `synced` reflects the indexes this Syncthing has received: right after a connection, before the peer's index arrives, a side that has nothing to send may show `synced` for a moment although the peer holds files it has not announced yet.
- A linking step that Syncthing refused, for example for a wrong API key, does not retry: once the key is fixed, the shared-folder state recovers at the next poll, but the devices are linked only at the next connection of the channel.
- The stage 32 build speaks protocol version 1, the stage 33 and 34 builds version 2 (binary board frames), and the stage 35 build version 3 (heartbeat frames); every version has its own ALPN, builds of different versions cannot connect and no fallback exists, so both Ketos instances of a pair are updated together.
- A large frame keeps a channel open only while each 16 KiB slice of its body arrives within `heartbeatTimeoutMs`: on a path slower than about 14.6 kbit/s with the defaults, the channel closes with `heartbeat-timeout` during the transfer, and the redial repeats the exchange.
- The heartbeat bounds detection, not recovery: after the network returns, the dialing side's next dial waits for the pause in progress, up to `reconnectMaxMs`, and a dial in flight may first run into `connectTimeoutMs`, so with the defaults both sides may take up to about 10 + 20 seconds plus the dial itself to show `online` again.

<a id="dev-note"></a>
### Dev Note

Run the package suite with:

```sh
pnpm exec vitest run packages/ketos/peer --coverage --coverage.include='packages/ketos/peer/src/**/*.ts'
```

The protocol specs run over the in-memory transport; only the transport suite and the Loader composition suite load the native module. Inspect a node's durable state with `cat $DSH_HOME/peers.json` and `stat -f '%Sp' $DSH_HOME/peer.key`.
