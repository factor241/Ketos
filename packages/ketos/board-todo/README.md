---
description: "The Ketos board to-do lists host package: one Beads epic per list in the Ketos-owned database under $DSH_HOME/beads, the queued telemetry-free bd CLI wrapper, the /api/ketos.board.todo Fetch route, and the /todo command."
kind: "package-reference"
---

# @ketos/board-todo

English | [中文](README.zh.md)

## Summary

`@ketos/board-todo` owns the board's to-do lists end to end. An element of kind `todo` carries the snapshot of one Beads epic and its child items, and the owner's host is the only writer: `/api/ketos.board.todo` verifies the body, refuses a foreign element before any `bd` call, runs the change through the `bd` CLI against the Ketos-owned Beads database at `$DSH_HOME/beads/.beads`, re-reads the epic's items, and writes the snapshot back through `ctx.ketosBoardDoc`. The `/todo <title>` command creates a list from chat and leaves its placement to the first visible board tab.

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
- id: ketos-board-todo
  name: '@ketos/board-todo'
  config:
    beadsDir: !!js dshHomePath('beads')
    bdCommand: bd
    beadsPrefix: kt
    bdTimeoutMs: 15000
    bdOutputMaxBytes: 1048576
    todoTitleMaxChars: 200
```

| Field | Default | Meaning |
|---|---|---|
| `beadsDir` | required | Directory holding the Ketos Beads database; `bd` works in `<beadsDir>/.beads`. Created owner-only before the first call. |
| `bdCommand` | `bd` | Executable name or absolute path of the Beads CLI. |
| `beadsPrefix` | `kt` | Issue prefix `bd init` gives the Ketos database. |
| `bdTimeoutMs` | `15000` | Largest time one `bd` call may run, in milliseconds (1000–300000). |
| `bdOutputMaxBytes` | `1048576` | Largest stdout one `bd` call may produce, in bytes (1 KiB–64 MiB). |
| `todoTitleMaxChars` | `200` | Largest list or item title, in UTF-16 code units (1–10000). |

The route is the browser's only write path:

| Action | Body | Effect |
|---|---|---|
| `create` | `{ action, title, x, y }` | Creates the epic and one `todo` element at the world position, then writes the first snapshot. |
| `addItem` | `{ action, elementId, title }` | Creates one child issue, then rewrites the snapshot. Refused with `ketos/limit` at `todoItemsMax` items. |
| `setDone` | `{ action, elementId, itemId, done }` | Runs `bd update --status closed\|open`, then rewrites the snapshot; the item must belong to the list. |
| `refresh` | `{ action, elementId }` | Calls `bd show`; a missing epic sets `missing: true` and keeps the items, otherwise the snapshot is re-read. |
| `place` | `{ action, elementId, x, y }` | Only for a list that still carries `pendingPlacement`; the first tab to send it wins, later ones get `ketos/placement-taken`. |

Answers are `{ ok: true, elementId, revision }` or `{ ok: false, error }` with one of `ketos/invalid` (400), `ketos/element-not-found` (404), `ketos/not-owner`, `ketos/placement-taken`, `ketos/limit` (409), `ketos/beads-failed` (502), `ketos/beads-unavailable` (503). The error body never carries `bd` output; stderr stays in the host journal.

The `/todo <title>` command creates a list whose element carries `pendingPlacement: true` at `(0, 0)`; the command answers short English host text, and the board's composer localizes the label and description.

Inspect the database exactly as the board sees it:

```sh
BEADS_DIR="$DSH_HOME/beads/.beads" BD_DISABLE_METRICS=1 bd list --parent <epic> --all --limit 0 --json
```

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### The host is the only writer

Every operation checks the element's owner first: a `todo` element owned by another participant (a snapshot synchronized from another Ketos in stage 33) answers `ketos/not-owner` without a single `bd` call. The route then runs `bd`, re-reads the children with `bd list --parent <epic> --all --limit 0 --json`, and writes the snapshot through the board document. `setDone` additionally requires the item id to be one of the list's stored items, so a browser cannot close an unrelated issue.

### The bd wrapper

`BeadsCli` resolves the executable once, creates the Beads directory owner-only, and serializes every call through a queue, because the embedded Dolt engine refuses concurrent writers. Each child gets a fixed environment (`BEADS_DIR`, `BD_JSON_ENVELOPE`, `BD_DISABLE_METRICS`, `DO_NOT_TRACK`, `BD_NON_INTERACTIVE`, `NO_COLOR`, the `beads.role` git identity, and `GIT_TERMINAL_PROMPT=0`), and every ambient `BEADS_*` or `BD_*` variable the host process carries (such as `BEADS_DB` or `BEADS_DOLT_SERVER_*`) is blanked so the wrapper cannot be redirected to another database. Plugin unload runs `dispose()`: it aborts the running call, rejects queued and later calls with `BeadsUnavailableError`, and waits for the queue. The child never runs through a shell: titles travel as `--title=<text>` arguments, so a title beginning with `-` cannot become a flag. Arguments are sanitized (control characters removed, length clamped) and ids are validated against the Beads shape. A call retries up to three times when stderr reports the Dolt `exclusive lock`. Before the first operation `bd version --json` must report a supported 1.x release at or above 1.2.2, and `bd init --prefix <prefix> --quiet --skip-hooks --skip-agents --non-interactive --init-if-missing` creates the database without touching any git repository. Only exit code 0 with a `schema_version: 1` envelope parses; everything else becomes `BeadsUnavailableError`, `BeadsCommandError` (with the stderr tail), or `BeadsProtocolError`.

### The snapshot and its flags

The element's data is exactly `{ epicId, title, items, syncedAt, missing?, pendingPlacement? }`, validated by `parseTodoData` in `@ketos/board-doc/data`. `missing` marks an epic `bd show` no longer finds while the stored items stay visible, and `pendingPlacement` marks a command-created list a visible tab still has to place. Both flags are cleared with a `null` data key in the snapshot patch, which the board document treats as key removal.

### Placement

`place` runs through its own queue inside the route, so the check of `pendingPlacement` and its removal are one serialized step on the owner's host: two tabs racing to place one list produce one 200 and one 409, and a tab that was hidden while the list appeared simply leaves the list at `(0, 0)` for the first visible tab.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `name`/`inject`/`Config`/`apply`, the wrapper, the route, and the command |
| [`src/beads.ts`](src/beads.ts) | The queued `bd` wrapper, version gate, title sanitizing, envelope parsing, and typed errors |
| [`src/routes.ts`](src/routes.ts) | The `/api/ketos.board.todo` route, its five actions, the ownership rule, and the placement queue |
| [`src/command.ts`](src/command.ts) | The `/todo` command definition and its host texts |
| [`src/wire.ts`](src/wire.ts) | The route helpers: JSON answers, error statuses, and body field readers |
| [`src/types.ts`](src/types.ts) | The request, answer, and error-code vocabulary the browser imports type-only |
| — | No runtime invariant companion is published: the wrapper's queue, version gate, and answer shapes are covered by the package specs, and there is no continuously observable in-process relation to publish. |

</details>

<a id="further-exploration"></a>
## Further Exploration

- [`packages/ketos/README.md`](../README.md) — the Ketos package group.
- [`@ketos/board-doc`](../board-doc/README.md) — the board document that stores the snapshot.
- [Beads](https://github.com/gastownhall/beads) — the issue tracker the `bd` CLI belongs to.

<a id="model-experience"></a>
## Model Experience

None, as `/todo` records only log-only `command/run` and `command/done` events that never enter a model request.

#### KV Cache effect

No effect; creating a list changes board state rather than model context.

## Known Limitations and Deferred Work

- `bd` 1.2.2 or newer on the 1.x line must exist in `PATH`; the stand image pins 1.3.1 by checksum, and a host without `bd` answers `ketos/beads-unavailable` (503) with a localized message.
- Only the owner's host writes a list; the second Ketos reads the snapshot (stage 33). The Beads databases do not synchronize between Ketoses.
- Renaming, deleting, and reordering items, working-folder Beads tasks, priorities, assignees, and dependencies between items are out of scope for this stage.
- `bd` is invoked as a CLI rather than through `bd serve` or a Go binding, so each operation pays one process start (about 0.1–0.7 s on the supported releases).

### Dev Note

Run the package suite with:

```sh
pnpm exec vitest run packages/ketos/board-todo --coverage --coverage.include='packages/ketos/board-todo/src/**/*.ts'
```
