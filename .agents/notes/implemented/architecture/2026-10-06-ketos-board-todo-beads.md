# Agent Note: To-do lists on Beads

Status: implemented

English | [中文](2026-10-06-ketos-board-todo-beads.zh.md)

## Problem

The 16 October demo needs to-do lists as board elements whose items really live in Beads: created from chat and the `+` catalog, toggled on the board with the item's state changing in the database, and readable from `bd` on the command line. The board document (stage 28) already stores elements, and stage 33 will copy it to a second Ketos, so storage, ownership, and animation had to be designed around a host-owned snapshot without giving the browser direct access to the database or to the `bd` binary.

## Decision

**Each list is one Beads epic in the Ketos-owned database.** `@ketos/board-todo` points `bd` at `$DSH_HOME/beads/.beads` through `BEADS_DIR`, never at the repository's task database; the element stores the epic id, the title, the re-read items, and the sync time, and each item's status is the Beads status.

**The owner's host is the only writer, through the CLI.** The host resolves the configured `bd` executable once through `ctx.subprocess`, creates the directory owner-only, serializes calls through a queue (the embedded Dolt engine refuses concurrent writers), retries the reported `exclusive lock` up to three times, and spawns without a shell so a title cannot become a flag. Before the first operation it requires `bd version --json` to report a supported 1.x release at or above 1.2.2 and runs `bd init --prefix … --quiet --skip-hooks --skip-agents --non-interactive --init-if-missing`, so the Ketos database is created without touching any git repository.

`bd serve` and a Go SDK were rejected. `bd serve` would add a long-lived server, a port, and a version-negotiated wire protocol to a product that needs five operations; a Go binding would add cgo and SQLite linkage to the Node process for the same five. The CLI is a stable, documented boundary whose answers the wrapper validates as `schema_version: 1` envelopes and whose failures (missing executable, non-zero exit, malformed JSON, unsupported version) map to distinct typed errors.

**Telemetry is off in every call and in the stand image.** Each child environment carries `BD_DISABLE_METRICS=1`, `DO_NOT_TRACK=1`, `BD_JSON_ENVELOPE=1`, `BD_NON_INTERACTIVE=1`, `NO_COLOR=1`, `GIT_TERMINAL_PROMPT=0`, and a fixed `beads.role` git identity; the stand Dockerfile sets `BD_DISABLE_METRICS=1` and `DO_NOT_TRACK=1` image-wide and pins `bd` 1.3.1 by sha256 per architecture. Rule Р-3 keeps analytics and telemetry off in Ketos profiles, and a spec asserts the child environment of every spawned call.

**The element carries the snapshot; the browser never talks to Beads.** The `/api/ketos.board.todo` route verifies the body, refuses a foreign element before any `bd` call, runs the operation, re-reads the items with `bd list --parent … --all --limit 0 --json`, and writes `{ epicId, title, items, syncedAt, missing?, pendingPlacement? }` back through `ctx.ketosBoardDoc.apply(…, 'host')`. The browser sees the same element stream as every other kind, and stage 33 copies the snapshot to the second Ketos, which renders the list read-only. A list whose epic `bd show` no longer finds keeps its items and carries `missing: true`; a list created from chat carries `pendingPlacement` until the first visible tab places it, and a per-element queue makes two tabs produce one placement (the loser gets 409).

**Patches delete data keys with `null`.** Nothing else could clear `pendingPlacement` or `missing`: the document merges data per key, so a board-doc patch now treats a `null` value as removal. The rule is documented on the operation type and covered by the ops suite.

**No recorded-session snapshot.** `/todo` records only the existing log-only `command/run` and `command/done` events, which never enter a model request; `SessionEventMap` and the model request are unchanged, and the host composition test asserts the route and command registration instead of a session replay.

## Alternatives considered

- **Put the Beads database in the repository's `.beads`.** Rejected: that directory is the development task database shared by every worktree; product data lives under `$DSH_HOME`.
- **Use `bd reopen` for reopening items.** Rejected: `bd reopen` on an already-open item answers exit 0 with an empty non-JSON stdout; `bd update --status closed|open` is idempotent in both directions.
- **Let the browser call Beads itself.** Rejected: the owner check, the snapshot, and the stream already live on one host route; a second write path would duplicate them and expose the database.
- **Store the items as the document's own list.** Rejected: the requirement is that `bd` and the board show the same items, and a snapshot written only after a `bd` re-read is what makes that checkable.
- **Animate the move with an animation library.** Rejected: stable React keys within one list container plus a FLIP transform in a layout effect, with transition tokens and `prefers-reduced-motion` disabling motion, covers the requirement without a dependency.

## Consequences

List correctness depends on the host reaching `bd`: a missing or unsupported executable answers 503 with a localized message, a failed command answers 502 while stderr stays in the host journal, and every change costs one or more process starts (about 0.2 s per call in the stand, 0.7 s on the development Mac with `bd` 1.2.2). The snapshot is a cache in the document: a tab that dies between the `bd` write and the snapshot write leaves the next refresh to re-read the truth, and the board never invents item state of its own.

## Testing

`packages/ketos/board-todo/tests` covers the wrapper (argv, environment, queue, version gate, lock retry, both recorded releases, typed errors) and the route (every action, ownership, the item limit, missing epics, the placement race, error mapping) at 100% per-file coverage; the optional real-`bd` spec self-skips without an executable. `packages/ketos/board-doc/tests/todo.spec.ts` covers the snapshot format, `packages/client/ui-board/tests` covers the API decoders, the placement watcher, the body (progress, optimistic toggle with rollback, done section, add and refresh, foreign read-only), and the dock popover, and the assembled board is covered by the web e2e and snapshot-replay lanes.

## Related

- [`@ketos/board-todo` README](../../../../packages/ketos/board-todo/README.md) — the package contract, config, routes, and source map.
- [The board document and its element model](2026-10-06-ketos-board-element-document.md) — the storage and ownership model the snapshot writes through.
- [Board strokes](2026-10-06-ketos-board-strokes.md) — the previous element stage whose body and animation rules this one extends.
- [Beads](https://github.com/gastownhall/beads) — the issue tracker `bd` belongs to.
