---
description: "The Ketos clone domain host package: clones.db, its forward-only schema, the revision-CAS repository, and the /api/ketos.clones Fetch route the board's clone windows call."
kind: "package-reference"
---

# @ketos/clone-core

English | [中文](README.zh.md)

## Summary

`@ketos/clone-core` owns the Ketos clone domain. A clone is a stored record — name, role, summary, persona, methodology, preferred model route, skills, status — plus the sessions bound to it; this package is the only writer of that data: one `node:sqlite` database at `$DSH_HOME/clones.db`, a forward-only schema runner, a repository whose updates and deletes apply only under the revision the caller read, and the exact `/api/ketos.clones` Fetch route the board's clone window reads and writes. It is host-side only and contributes no prompt section, tool, or session event yet.

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
- id: ketos-clone-core
  name: '@ketos/clone-core'
  config:
    path: !!js dshHomePath('clones.db')
```

| Field | Default | Meaning |
|---|---|---|
| `path` | required | SQLite database file path, or `:memory:`. The web profile passes `$DSH_HOME/clones.db` (`~/.ketos/clones.db` for the Ketos CLI). |

The package has no browser bundle: `packages/client/ui-board` talks to the route with plain `fetch` and imports the `./types` module type-only, which keeps the clone window inside the existing board registrations instead of adding a client plugin row.

### The route

`/api/ketos.clones` is one authenticated exact Fetch route below `/api`, registered through `ctx.connection.fetch` and withdrawn with the plugin fiber.

| Method | Request | Answer |
|---|---|---|
| `GET` | — | `{ ok: true, clones }` |
| `POST` | `{ op: 'list' }` | `{ ok: true, clones }` |
| `POST` | `{ op: 'get', id }` | `{ ok: true, clone }` |
| `POST` | `{ op: 'create', name, role, … }` | `{ ok: true, clone }` |
| `POST` | `{ op: 'update', id, revision, patch }` | `{ ok: true, clone }` |
| `POST` | `{ op: 'delete', id, revision }` | `{ ok: true, id }` |
| `POST` | `{ op: 'bindSession', cloneId, sessionId, role? }` | `{ ok: true, binding }` |
| `POST` | `{ op: 'listSessions', cloneId }` | `{ ok: true, sessions }` |

Failures answer HTTP status plus `{ ok: false, error }`: `400` `ketos/invalid`, `404` `ketos/clone-not-found`, `409` `ketos/clone-conflict`. The body is validated field by field at the route, and validation runs before the database is opened, so a malformed request never creates the file. An unexpected internal failure (for example a database that cannot be opened) answers `500` with a plain-text body and no code, so a client never reads it as a domain code.

### Observable behavior

- **Opening is lazy.** The profile mounts the plugin and registers the route, but `node:sqlite` is imported and the file is opened on the first route call, so a process that never touches clones never prints Node's SQLite experimental warning at startup.
- **The file is owner-only.** The parent directory is created `0700` and a missing database file `0600`; an existing file keeps its modes. The database runs in WAL mode with `application_id` `KTCL` and `user_version` `1`.
- **Foreign databases are refused.** An `application_id` stamped by another application, a `user_version` newer than this build, or a file that is not a SQLite database all reject at open instead of being rewritten. An empty SQLite file with no stamps is adopted.
- **Writes are revision-checked.** `update` and `delete` apply only while the stored `revision` still equals the one the caller read; otherwise the answer is `ketos/clone-conflict` and the stored record is untouched. A session binds to at most one clone, and the newest binding of a session wins.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Schema

`clones` stores one row per clone; `clone_sessions` stores one row per bound session with an index on `clone_id`. Both are STRICT tables, timestamps are ISO-8601 UTC strings, and every read decodes the durable value it finds — an unknown `status` or a `skills_json` that is not an array of strings fails loud instead of surfacing a broken clone in the UI.

### Forward-only runner

`src/schema.ts` owns the ordered step list: entry `n - 1` produces `user_version` `n`, and `migrate` applies every missing step in one pass before stamping the current version. There are no rollbacks and no data loss; a newer stored version is refused, never downgraded. `clone_tasks` and the memory tables join the list as steps 2 and 3 in their own stages.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `name`/`inject`/`Config`/`apply`, the lazily opened database, and its disposal |
| [`src/db.ts`](src/db.ts) | Owner-only file creation, the open sequence, and the lazy handle the plugin shares |
| [`src/schema.ts`](src/schema.ts) | Identity and version stamps, the ordered migration steps, and the runner |
| [`src/repository.ts`](src/repository.ts) | Prepared-statement CRUD with revision CAS and the session bindings |
| [`src/routes.ts`](src/routes.ts) | The exact Fetch route, its manual body validation, and its error codes |
| [`src/types.ts`](src/types.ts) | The stored record, the wire DTO, the request inputs, and the error codes; the module browser code imports type-only |
| — | No runtime invariant companion is published: the package's relations are open-time identity checks and per-request route behavior, both covered by package specs, and there is no continuously observable in-process relation to publish. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Ketos package group](../README.md) — the fork's package conventions and roster.
- Board clone window — the editor that reads and writes this route: [`packages/client/ui-board/src/client/window/CloneBody.tsx`](../../client/ui-board/src/client/window/CloneBody.tsx).
- Sibling SQLite layouts: [`@deepseek-ai/dsh-storage-sqlite`](../../storage/storage-sqlite/README.md) and [`@deepseek-ai/dsh-session-query-sqlite`](../../session-query/session-query-sqlite/README.md) — each owns its own file identity and schema instead of sharing a medium helper.

-----

<a id="model-experience"></a>
## Model Experience

### Clone records

#### What the model sees

Nothing yet. The package registers no prompt section, tool, schema, or session event, and a clone's persona, methodology, and skills stay host data in `clones.db` until the stages that compose them into an agent's system prompt.

#### Token effect

Zero tokens in every live request.

#### KV Cache effect

None; the package never touches a live request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Tasks and memory tables are absent** — `clone_tasks` and `memories` are steps 2 and 3 of the same runner, added by the autonomous-task and memory stages; until then the database holds clone records and session bindings only.
- **The route is hand-validated, not generated** — there is no Typert codegen for the clone domain (the API is still moving), so the browser and the host share `src/types.ts` by hand and the route validates every field itself.
- **`skills` is stored but unused** — the field round-trips through the record and the wire; no editor control, tool, or prompt consumes it before the methodology/skills stage.
- **The preferred model is applied through the browser's model selection** — creating a clone session selects the stored route through `remote.session.selectModel`, which also saves the choice as the `agent-default-model` system default; `packages/client/ui-board/README.md` owns the product-facing statement of that side effect.
- **Deleting a clone removes its session bindings** — the sessions themselves stay in the session store as ordinary sessions; nothing unbinds a session any other way.
- **No rollbacks and no downgrade** — a database written by a newer build rejects at open; recovering means using the newer build or deleting the file.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Inspect a live database with `sqlite3 "$DSH_HOME/clones.db" '.schema'`; the default home of the Ketos CLI is `~/.ketos`. Run the package specs with `pnpm exec vitest run packages/ketos/clone-core/tests`, and the real-composition boot with the same command (`tests/composition.spec.ts` mounts the row through a Loader and a recording connection service).

</details>
