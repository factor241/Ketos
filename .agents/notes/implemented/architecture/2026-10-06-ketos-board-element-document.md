# Agent Note: The board document and its element model

Status: implemented

English | [中文](2026-10-06-ketos-board-element-document.zh.md)

## Problem

Board elements — notes, strokes, todo lists, and later shared window records — had no home. Window layout is a per-Ketos settings document that is written whole, so it cannot carry values two Ketos instances must converge on, and every browser tab held its own view: nothing an element changed reached another tab, nothing survived a reload outside the layout, and there was no place to put a participant identity or a change history. The 16 October demo needs the shared foundation for stages 29–31 (notes, brush, todo) and 32–33 (participants and synchronization) without reworking their storage, transport, or merge behavior later.

## Decision

**Elements live in a host document, not in the layout.** A new host package, `@ketos/board-doc`, owns one Yjs document in `$DSH_HOME/board.db`. The window layout stays what it is: a per-Ketos settings document, written whole and never synchronized, because window geometry is machine-local view state while elements are shared data. `@ketos/board-doc` depends on no other `@ketos/*` package; the todo list (31), the peer channel (32), and synchronization (33) depend on it.

**The database is an append-only journal of Yjs updates.** `updates(seq INTEGER PRIMARY KEY AUTOINCREMENT, update BLOB, origin TEXT, at TEXT)` stores one row per committed transaction; loading merges every row through `Y.mergeUpdates` and applies the result with the `load` origin, which the append listener ignores. `revision` is the row's `seq`, so it is monotone across restarts and compactions. When the journal passes `journalCompactRows` rows, one SQL transaction writes `Y.encodeStateAsUpdate(doc)` as a `compact` row and deletes every earlier row, which never decreases the revision. `meta` holds the local `selfId` and `docId`; both are minted on the first open, read afterwards, and a corrupted value fails the open instead of being replaced.

**The document shape is nested maps keyed by element id.** `elements` is a `Y.Map` keyed by `ElementId`; each element is a `Y.Map` with the envelope keys (`kind, ownerId, x, y, w, h, z, createdAt, updatedAt`) and a nested `data` `Y.Map` of kind-owned JSON values. Storing an element as one JSON value loses concurrent edits to different fields; nested maps merge per key, which is what stage 33 needs. The host validates every read and skips an element it cannot decode with one host-log line, because a synchronized document may carry data another Ketos version wrote.

**The browser reads a snapshot and follows server-sent events.** `GET /api/ketos.board` answers the snapshot; `POST /api/ketos.board.ops` applies one atomic batch; `GET /api/ketos.board.events` streams one `snapshot` event, then one `patch` event per committed row and a `: ping` heartbeat. The browser never loads `yjs`: it sees plain JSON and the store applies patches by revision. A Gateway WebSocket stream was rejected because it requires generated descriptors and `ctx.remote` wiring for a payload the board alone reads; polling (like the tasks window) cannot hold the one-second budget at a sane frequency. SSE over an exact Fetch route carries snapshot and patches on one connection; the client closes it in a tab hidden past `elementStreamHiddenCloseMs` to stay inside the HTTP/1.1 per-origin connection budget and reopens it with a fresh snapshot on return.

**Operations are atomic, owner-scoped, and resolved before mutation.** One batch is parsed at the wire boundary (`rejectUnknownFields`, finite bounded numbers, `maxOpsPerRequest`), resolved against a simulated state — the host owns `ownerId = selfId`, `z = max + 1`, and both timestamps — and validated as a complete merged element before anything mutates; only then does one `doc.transact` apply the recorded mutations. A browser batch may only create elements under `selfId` and patch or remove elements it owns (409 `ketos/element-foreign` otherwise); a host batch bypasses that check. Failures answer `ketos/invalid` (400), `ketos/element-not-found` (404), `ketos/element-foreign`/`ketos/element-exists`/`ketos/limit` (409), and a body over `maxRequestBytes` answers 413.

**`selfId` lives in SQLite, never in the document.** Stage 33 synchronizes the whole document between two Ketos instances; a document-local identity would become shared by both. The host reads `selfId` from `meta` and stamps it on every browser-created element, the snapshot carries it, and the client adopts it on the first snapshot (`adoptSelfId` rewrites stored demo-self owners so a restored layout belongs to the acting participant).

**`ctx.ketosBoardDoc` is the host-side seam.** `selfId()`, `docId()`, `snapshot()`, `apply(ops, origin)`, and `subscribe(listener)` are the one read/write point for the routes and for stages 31–34; the service opens the database, document, and journal lazily on first use and closes them with the plugin fiber.

## Alternatives considered

- **Keep elements in the layout document.** Rejected: the layout is written whole, per-Ketos, and never synchronized; two tabs and two Ketos instances could never converge, and element data would be destroyed by every layout capture.
- **Store an element as one JSON value in a `Y.Map`.** Rejected: concurrent edits to different fields of one element overwrite each other; nested `Y.Map`s merge per key.
- **Put `selfId` in the document.** Rejected: synchronization copies the whole document, so both Ketos instances would share one identity and the owner check would compare a shared value.
- **Use the Typert Gateway stream or polling.** Rejected: the Gateway needs generated descriptors and `ctx.remote` wiring for a private payload, and polling cannot hold the one-second visibility budget without wasting requests.
- **Apply operations inside the transaction and roll back on error.** Rejected: Yjs does not roll back a transaction when its callback throws, so a partial batch would stay applied; the batch is resolved and validated against a simulated state first and then applied in one transaction.

## Consequences

Stages 29–31 add element kinds without touching storage or transport: each registers a `board.element.body` occupant and a `board.element.toolbar` occupant, extends `validateElementData` with its own branch, and adds its descriptors to `board-element-kinds.ts`. Stage 32 adds the participant registry behind `owners.ts`, and stage 33 synchronizes the document and registers shared window records on the same envelope. The journal keeps the document crash-safe and compact, at the cost of an update row per committed batch and a compaction that rewrites the journal; the revision stays the monotone `seq`, so a client patch is always ordered. The event stream is the package's first SSE route: it closes on abort, consumer cancel, backlog overflow, and disposal, and the client retries with a growing pause, so a host that is down leaves the element slice stale but the board usable. The browser bundle inlines the browser-safe `./kinds` and `./data` modules (recorded in the client bundle purity allowlist), so the client shares validation without pulling any host module.

## Testing

`packages/ketos/board-doc/tests` covers the storage (owner-only file, identity, journal load/append/compaction, foreign-file refusal), the document and operations (atomicity, every error code, complete-result bounds, owner rules, size boundaries), the service (lazy open, one change per committed row, disposal), the routes and the event stream (every status, snapshot then patch, abort, cancel, backlog, 503, disposal), and the composition through the real Loader; the package holds 100% per-file coverage. `packages/client/ui-board/tests` covers the coordinates, the API decoders and stream behavior, the store slice and selfId adoption, the element layer, the frame gestures, the Delete guards, the selection bar, and the minimap; `apps/web/tests/board-elements.e2e.ts` drives two tabs of one Ketos through the real host.

## Related

- [`@ketos/board-doc` README](../../../../packages/ketos/board-doc/README.md) — the package contract, config, routes, and source map.
- [Board window ownership and access](2026-10-06-ketos-board-window-ownership.md) — the stage-27 note whose `owners.ts` this stage turns into the document's local identity.
- [Board layout persistence](2026-09-18-ketos-board-layout-persistence.md) — the per-Ketos settings document elements deliberately do not use.
- [Board slot composition](2026-09-15-ketos-board-slot-composition.md) — the slot cascade the element layer joins.
