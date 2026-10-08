# Agent Note: The Ketos peer channel

Status: implemented

English | [中文](2026-10-06-ketos-peer-channel.zh.md)

## Problem

The 16 October demonstration runs two Ketos instances on two computers in different networks and presents them as one team: they must find each other through infrastructure the team controls, exchange messages reliably, show each other as real participants instead of the client-side demo roster, and recover a dropped channel without a new invitation. Stages 33–35 build document synchronization, foreign chat cards, and a shared Syncthing folder on top of this channel, so its service surface, frame codes, and event names had to be designed once, now.

## Decision

**One iroh node per Ketos behind `ctx.ketosPeer`.** `@ketos/peer` binds an iroh endpoint with a 32-byte key stored at `$DSH_HOME/peer.key` (owner-only, stable `EndpointId` across restarts), the peer ALPN `ketos/peer/1`, and `RelayMode.customFromUrls` over the team's private relay. Public n0 relays and discovery are never used; the deployment runs its own `iroh-relay` (Let's Encrypt via `<ip-with-dashes>.sslip.io`, fallback `nip.io` or `--dev`) in `docker/relay/`. The node starts lazily — on the first route call, or at plugin start when `peers.json` already names someone — so a developer machine that never composes the stand never loads the native module.

**Framing and extension belong to the channel; payloads to its consumers.** One connection carries one bidirectional QUIC stream; every message is `[u32 BE length][u8 code][JSON body]`. The code table reserves `1 hello`, `2 bye`, `3 board.sv`, `4 board.update`, `5 chat.transcript.request`, `6 chat.transcript.response`, and `7 syncthing.device`; stages 33–35 merge their payloads into `PeerFrameTypeMap` through declaration merging and register handlers with `ctx.effect`. A frame over `maxFrameBytes`, a non-JSON body, an unknown code, or a truncated frame closes the connection with code `2n` without throwing past the read loop. Requests and responses share one envelope (`{ requestId, request }` / `{ requestId, response | error }`), with the timeout on the asking side.

**The invitation code admits exactly one unknown node.** `invite()` waits for the relay address and mints `ketos1.<endpoint ticket>.<base32 secret>`; the 16-byte secret is single-use, memory-only, and valid for `inviteTtlMs`. The dialer writes `hello` first (the receiver's `acceptBi` resolves only after those bytes) with its participant record and, for an unknown node, the secret. A node already stored in `peers.json` is admitted without a secret; an unknown node with a wrong or absent secret is closed with code `1n` and one `peer.refused` log line. The dialing side stores the peer's ticket and owns reconnection (pauses from `reconnectMinMs` to `reconnectMaxMs`, doubling with ±20% jitter); the accepting side stores the record without a ticket and waits for the redial.

**Participants are document records, one writer each.** `@ketos/board-doc` gained a `participants` `Y.Map` keyed by `OwnerId`; `putOwnParticipant` writes only the record its own `selfId` keys, so stage 33's synchronization cannot make two instances overwrite each other. The color is the first free palette number among the document's participants and the known peers; on a collision the participant with the larger board `selfId` (string comparison) rewrites its own record to the next free color and announces a new `hello`, while the other side keeps its record untouched. The browser roster unions the document records with the peer channel's state, so both boards show two real participants before document synchronization exists.

**The profile row is disabled; the stand enables it.** The shipped `web` profile carries `ketos-peer` with `disabled: true` and only the environment seam (`KETOS_PARTICIPANT_NAME`, `KETOS_RELAY_URLS`), because identity and relay exist only on the stand; `docker/stand/stand.patch.yml` enables the same row with the deployment's values. The client polls `/api/ketos.peer.state` only while the board surface is rendered and its tab is visible, and stops after an unavailable (404) answer, so a deployment without the plugin produces no background 404 traffic.

**iroh-js 1.1.0 forbids `watch*` and `stopped()`.** The pinned version aborts the Node process on any `watch*` call and never resolves `SendStream.stopped()`; both are banned by `tests/native-surface.spec.ts`, which scans the sources, and address changes are observed through the relay `online()` wait and the connection's `closed()` promise instead. The ban lifts when the pinned version is raised past the crash and the gate is updated with it.

**The stand's Syncthing is pinned and private.** Debian's 1.19.2 predates relay tokens and joined public relays; the image now installs the official 2.1.5 archive, verified by sha256 per architecture, and `syncthing-bootstrap.mjs` edits the generated `config.xml` before the first run — global and local announce off, NAT off, crash reporting off, no STUN, no auto-upgrade, `listenAddresses` = the team's `strelaysrv` URL and `tcp://0.0.0.0:22000`, GUI API key from `STGUIAPIKEY`. A template drift or a missing relay fails loud.

## Alternatives considered

- **Public iroh relays and discovery.** Rejected: the demonstration must not depend on n0 infrastructure, and a private relay also makes the address stable and auditable.
- **A hand-rolled TCP/TLS channel.** Rejected: NAT traversal, QUIC multiplexing, connection migration, and endpoint identity are exactly the hard parts iroh already provides; the transport seam keeps the rest of the channel testable without it.
- **Per-person rights and a signed participant list.** Rejected for the demo: any known peer's frames are accepted, and the channel protects against outsiders, not against a known peer; rights arrive after the demonstration.
- **A separate client plugin package for the participants menu.** Rejected: the menu is board chrome; it lives in `packages/client/ui-board` beside the dock, and the peer API is a plain route client like `board-doc-api.ts`.
- **Starting the poll at plugin load.** Rejected: a deployment without the peer plugin would issue one 404 per second forever; the board surface reports its own mount, and an unavailable answer stops the loop.

## Consequences

The channel is reachable only through the team's relay: if the VPS is down, no peer connection exists, and `invite()` answers 503 `ketos/peer-offline` until the relay address exists. `peers.json` is the only durable state besides the key, so a deleted file loses the known peers and requires a new invitation code. The accepting side cannot redial, so after both sides restart the originally dialing side reconnects from its ticket. The native module ships no `darwin-x64` build, so an Intel Mac runs the channel only inside the Docker stand. The frame table reserves codes before their consumers exist; a reserved frame without a handler is ignored with one log line, which keeps a mixed-version pair from crashing.

## Testing

`packages/ketos/peer/tests` covers the protocol over the in-memory transport (frames, handshake, refusals, known peers, participants and the color rule, request timeouts, reconnection with fake timers and cancellation) and the transport itself on two loopback iroh endpoints; the Loader composition suite boots the real plugin, proves the stable `EndpointId` through the key file, and rejects a wrong-length key. Coverage is 100% per file. `packages/ketos/board-doc/tests/participants.spec.ts` covers the participant map and record validation at 100%. The client suites cover the peer API decoders, the poll lifecycle, the roster union, and the participants popover; the live stand check connected both boards in 0.08 s through the VPS relay and restored the link 2.8 s after restarting one container.

## Related

- [`@ketos/peer` README](../../../../packages/ketos/peer/README.md) — the package contract, config, service surface, and frame table.
- [The board document and its element model](2026-10-06-ketos-board-element-document.md) — the document whose `participants` map this channel writes.
- [`docker/relay/README.md`](../../../../docker/relay/README.md) — the private relays the deployment runs.
- [`docker/stand/README.md`](../../../../docker/stand/README.md) — the two-computer stand and its pinned Syncthing.
