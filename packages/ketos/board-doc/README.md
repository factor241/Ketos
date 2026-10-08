---
description: "The Ketos board document host package: the board.db node:sqlite journal over a Yjs document, the local selfId and docId, the element envelope and its atomic operation batches, the ctx.ketosBoardDoc service, and the /api/ketos.board, /api/ketos.board.ops, and /api/ketos.board.events Fetch routes."
kind: "package-reference"
---

# @ketos/board-doc

English | [中文](README.zh.md)

## Summary

`@ketos/board-doc` owns the common model of the board's elements: notes, strokes, todo lists, the participant registry, and (from stage 33) shared window records. One `node:sqlite` database at `$DSH_HOME/board.db` stores a Yjs document as an append-only update journal; the local participant identity `selfId` and the document identity `docId` live in the same database, outside the synchronized document. The package answers the `/api/ketos.board`, `/api/ketos.board.ops`, and `/api/ketos.board.events` Fetch routes, and every other Ketos plugin reaches the same document through the `ctx.ketosBoardDoc` service.

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

The shipped `web` profile mounts the package through the `dsh-web-app` bundle patch, which is the only supported composition:

```yaml
- id: ketos-board-doc
  name: '@ketos/board-doc'
  config:
    path: !!js dshHomePath('board.db')
```

| Field | Default | Meaning |
|---|---|---|
| `path` | required | SQLite database file path, or `:memory:`. The web profile passes `$DSH_HOME/board.db` (`~/.ketos/board.db` for the Ketos CLI). |
| `maxElementBytes` | `262144` | Largest serialized size, in bytes, of one stored element (1 KiB–16 MiB). |
| `noteTextMax` | `20000` | Largest note text, in UTF-16 code units (1–1000000). |
| `strokePointsMax` | `2000` | Largest number of points one stroke may carry (2–100000). |
| `todoItemsMax` | `200` | Largest number of items one to-do list may carry (1–10000). |
| `maxElements` | `2000` | Largest number of elements the document holds (1–100000). |
| `maxOpsPerRequest` | `64` | Largest number of operations one request may batch (1–1024). |
| `maxRequestBytes` | `1048576` | Largest accepted operation-request body, in bytes (1 KiB–64 MiB). |
| `journalCompactRows` | `500` | Journal rows after which the store compacts to one update row (1–100000). |
| `heartbeatMs` | `15000` | Event-stream heartbeat interval, in milliseconds (1000–300000). |
| `maxStreamQueueBytes` | `4194304` | Largest buffered event-stream backlog, in bytes (16 KiB–256 MiB). |
| `maxStreams` | `16` | Largest number of concurrent event streams (1–1024). |

The package has no browser bundle: `packages/client/ui-board` talks to the routes with plain `fetch` and imports the browser-safe `./types` (and, from stage 28.3, `./kinds` and `./data`) modules, so the board keeps its elements inside the existing registrations instead of adding a client plugin row.

The service is the host-side seam for other Ketos packages:

| Member | Answer |
|---|---|
| `selfId(): Promise<OwnerId>` | Identity of this Ketos, kept outside the synchronized document |
| `docId(): Promise<BoardDocId>` | Identity of the document |
| `snapshot(): Promise<BoardSnapshot>` | Every element and participant record at the current revision |
| `apply(ops, origin): Promise<BoardOpsResponse>` | Atomically applies a batch; the new revision comes back |
| `participants(): Promise<BoardParticipantRecord[]>` | Every stored participant record this build can decode |
| `putOwnParticipant({ name, color }): Promise<void>` | Writes the record keyed by this Ketos's `selfId` and announces it with a participant patch |
| `subscribe(listener): () => void` | One `{ revision, upserts, removes, participants? }` per committed journal row; the caller owns the unsubscribe through `ctx.effect` |

A `browser` batch may only create elements under `selfId` and patch or remove elements it owns; a `host` batch bypasses that check. A patch merges `data` by key and removes the keys whose value is `null`, so a host can clear an optional flag without rewriting the whole payload; the kind's rules are then checked against the complete merged data.

The participant registry lives in a second top-level `Y.Map` named `participants`, keyed by `OwnerId`. Each Ketos writes only the record its own `selfId` keys — `{ name, color, updatedAt }` — which is what keeps two Ketos instances from overwriting each other's identity once stage 33 synchronizes the document. `@ketos/peer` owns the color rule and calls `putOwnParticipant`; a snapshot carries every readable record in `participants`, and a participant write emits a patch with `participants.upserts`/`removes` beside its (empty) element lists. A record that does not match this build is skipped with one log line, exactly like an unreadable element.

The `note` kind's data is exactly `{ text, font, size, scale }`: `text` holds up to `noteTextMax` UTF-16 code units (the `maxLength` semantics), `font` is one of `sans`, `serif`, `mono`, `size` is one of `s`, `m`, `l`, and `scale` is one of `0.5`, `0.75`, `1`, `1.5`, `2`, `3`; any extra field, missing field, or value outside those lists refuses the batch with `ketos/invalid`. The element's `w`/`h` are the note's world rectangle and the content draws at `w/scale × h/scale` under `transform: scale(scale)`, so changing the scale patches `w`, `h`, and `data.scale` together.

The `stroke` kind's data is exactly `{ points, width, pen }`: `points` holds two to `strokePointsMax` `[x, y, pressure]` triples whose coordinates are relative to the element's `(x, y)` and stay inside `w`/`h`, `pressure` is in `[0, 1]`, `width` is one of `s`, `m`, `l` (4, 8, or 16 world units), and `pen` records whether a pen drew it; any extra field, missing field, or value outside those bounds refuses the batch. `pen` and `width` are the complete input of the paint options, so every Ketos renders the same points into the same path.

The `todo` kind's data is exactly `{ epicId, title, items, syncedAt, missing?, pendingPlacement? }`: `epicId` and every item `id` are Beads issue ids (`<prefix>-<serial>[.<child>...]`), `title` and `syncedAt` are non-empty strings, `items` holds up to `todoItemsMax` `{ id, title, status }` entries whose `status` is one of `open`, `in_progress`, `blocked`, `deferred`, `closed`, and `missing`/`pendingPlacement` are optional `true` flags; any extra field, missing field, or value outside those rules refuses the batch. The snapshot is host-owned: `@ketos/board-todo` re-reads it from `bd` and writes it back after every change.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Document structure

The Yjs document holds one `Y.Map` named `elements`, keyed by `ElementId`; every element is itself a `Y.Map` with the envelope keys (`kind, ownerId, x, y, w, h, z, createdAt, updatedAt`) and a nested `data` `Y.Map` whose values are plain JSON. Per-key nested maps are what let two participants edit different fields of one element concurrently without one losing the other's change; the element is never stored as a single JSON value. The local `selfId` is deliberately not a document key: stage 33 synchronizes the whole document between two Ketos instances, so a document-local identity would become shared.

### Journal and revisions

Every committed `doc.transact` produces one Yjs update, and the store appends it as one row of `updates(seq INTEGER PRIMARY KEY AUTOINCREMENT, update BLOB, origin TEXT, at TEXT)`. The `revision` the browser reads is that row's `seq`: it is monotone across restarts and compactions, and a batch is one transaction, one update, and one row. Loading merges the stored updates through `Y.mergeUpdates` and applies them with the `load` origin; the update listener ignores `load` and appends every other origin. When the journal passes `journalCompactRows` rows, one SQL transaction writes `Y.encodeStateAsUpdate(doc)` as a `compact` row and deletes every earlier row, so the revision never decreases.

### Identities

The first open creates `selfId` (a UUIDv4 minted on `crypto.getRandomValues`) and `docId` in the `meta` table and keeps them for the life of the database; later opens read them, and a value that is not a UUID is a loud open failure. `board.db` carries its own `application_id` and `user_version`, so opening an unrelated SQLite file fails instead of writing to it, and the file is created `0600` inside a `0700` directory with WAL and a busy wait, like the clone database.

### Routes and error codes

| Route | Method | Body | Answer |
|---|---|---|---|
| `/api/ketos.board` | `GET` | — | `BoardSnapshot` |
| `/api/ketos.board.ops` | `POST` | `{ ops: BoardOp[] }` | `{ ok: true, revision }` |
| `/api/ketos.board.events` | `GET` | — | `text/event-stream`: one `snapshot` event, then `patch` events and `: ping` heartbeats |

A refused batch answers the HTTP status with `{ ok: false, error }`, where the error is one of `ketos/invalid` (400), `ketos/element-not-found` (404), `ketos/element-foreign` and `ketos/element-exists` and `ketos/limit` (409), or an empty 500 body. A body over `maxRequestBytes` answers 413. The event stream closes when the request aborts or its consumer cancels, when the buffered backlog passes `maxStreamQueueBytes` (the browser reconnects and re-reads the snapshot), and a stream over `maxStreams` answers 503; disposal of the plugin closes every open stream.

### Laziness

`node:sqlite` and `yjs` are reached only from modules that `src/index.ts` imports lazily, so a process that never touches the board never loads either library and startup output stays free of Node's SQLite experimental warning and of yjs's `lib0` storage warning.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `name`/`inject`/`Config`/`apply`, the service, and the route registrations |
| [`src/types.ts`](src/types.ts) | The branded identifiers, the element envelope, the snapshot and patch, the operation union, and the error codes; the module browser code imports type-only |
| [`src/kinds.ts`](src/kinds.ts) | The element-kind list, the layer ranks, and the coordinate bound |
| [`src/data.ts`](src/data.ts) | UUID minting and the per-kind data validation the browser shares |
| [`src/db.ts`](src/db.ts) | Owner-only file creation, the open sequence, the local identity, and the shared lazy handle |
| [`src/schema.ts`](src/schema.ts) | Identity and version stamps and the forward-only migration steps |
| [`src/journal.ts`](src/journal.ts) | Loading, appending, compacting, and observing the update journal |
| [`src/doc.ts`](src/doc.ts) | The Yjs document wrapper: element reads, writes, and change decoding |
| [`src/ops.ts`](src/ops.ts) | Operation-body parsing, defaults, owner rules, and the atomic transaction |
| [`src/service.ts`](src/service.ts) | The `ctx.ketosBoardDoc` service definition |
| [`src/routes.ts`](src/routes.ts) | The snapshot and operations Fetch routes and their error codes |
| [`src/events.ts`](src/events.ts) | The `text/event-stream` route: snapshot, patches, heartbeat, and limits |
| [`src/wire.ts`](src/wire.ts) | The shared route helpers: JSON answers, `no-store`, and body validation |
| — | No runtime invariant companion is published: the document's identity checks, journal monotonicity, and route behavior are covered by the package specs, and there is no continuously observable in-process relation to publish. |

</details>

<a id="further-exploration"></a>
## Further Exploration

- [`packages/ketos/README.md`](../README.md) — the Ketos package group.
- [`packages/client/ui-board/README.md`](../../client/ui-board/README.md) — the board consumer: the element layer, its slots, and `board-coordinates.ts`.
- [`@ketos/clone-core`](../clone-core/README.md) — the sibling host package whose database, wire, and route layout this package follows.

<a id="model-experience"></a>
## Model Experience

None, as the board document is user interface state: the snapshot, operations, and stream reach only the browser and the board plugin, never a model request, prompt section, tool schema, or session event.

#### KV Cache effect

No effect; the document changes view state rather than model context.

## Known Limitations and Deferred Work

- The participant registry is written and read locally; the document synchronization that carries the records between two Ketos instances arrives in stage 33, and until then the browser's roster unions the local records with the peer channel's state.
- Window records arrive in stage 33 as a separate `windows` map of the same document, not as elements of the `elements` map.
- On Node ≥ 25 the first board access prints one `lib0` warning, `localStorage is not available because --localstorage-file was not provided`; `yjs` is imported lazily, so the warning appears at that first use rather than at startup, and Node 24 (the Docker stand) prints none.
- The board keeps elements on one layer below every window and selects one element at a time; multi-selection, an interleaved window/element order, and undo history are out of scope.
- The event stream is the package's first SSE route; it relies on the browser closing its connection in a hidden tab to stay inside the HTTP/1.1 per-origin connection budget.

### Dev Note

Inspect the database with `node --experimental-sqlite -e "..."` or any SQLite shell; the journal rows are opaque Yjs updates, so reconstruct state through `doc.snapshot()` rather than by reading the table. Run the package suite with:

```sh
pnpm exec vitest run packages/ketos/board-doc --coverage --coverage.include='packages/ketos/board-doc/src/**/*.ts'
```
