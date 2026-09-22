---
description: "The Ketos clone domain host package: clones.db, its forward-only schema, the revision-CAS repository and the FTS5 memory store, the /api/ketos.clones and /api/ketos.memory Fetch routes, and the clone session scope: profile, memory, and the interview that drafts a profile."
kind: "package-reference"
---

# @ketos/clone-core

English | [中文](README.zh.md)

## Summary

`@ketos/clone-core` owns the Ketos clone domain. A clone is a stored record — name, role, summary, persona, methodology, preferred model route, skills, status — plus bound sessions and memories; this package is its only writer: one `node:sqlite` database at `$DSH_HOME/clones.db`, a forward-only schema runner, a revision-CAS repository, a memory store with an FTS5 index, and the `/api/ketos.clones` and `/api/ketos.memory` Fetch routes. It also owns the clone session scope a bound agent carries: the stable `clone:profile` section, the dynamic `clone:memory` snapshot with both memory tools, and — while the clone is `interviewing` — the interviewer instruction that drafts a profile.

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
| `memoryEntries` | `10` | Largest number of active memories the prompt snapshot lists (1–50). |
| `memoryChars` | `8000` | Largest total length, in characters, of the prompt memory snapshot (1–32000). |

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

`patch` accepts `name`, `role`, `description`, `persona`, `methodology`, `preferredModel`, `skills`, and `status`; `status` is one of `draft`, `interviewing`, `ready`, and `role` in a binding is one of `main`, `interview`. Every accepted write notifies the clone session coordinator, which re-derives the scope of every live top-level agent and refreshes its profile text and memory snapshot.

### The memory route

`/api/ketos.memory` is the second exact Fetch route, registered through the same service and withdrawn with the plugin fiber.

| Method | Request | Answer |
|---|---|---|
| `POST` | `{ op: 'list', cloneId, status? }` | `{ ok: true, memories }` |
| `POST` | `{ op: 'search', cloneId, query, limit?, status? }` | `{ ok: true, memories }` |
| `POST` | `{ op: 'update', id, patch }` | `{ ok: true, memory }` |
| `POST` | `{ op: 'delete', id }` | `{ ok: true, id }` |

Failures answer `400` `ketos/invalid` and `404` `ketos/memory-not-found`. `patch` accepts `content` (at most 4000 characters), `tags` (at most 50 single-line tags of 100 characters, none carrying a comma — that is the memory window's separator), and `status` (`active`, `candidate`, `archived`); the repository refuses the same bounds, so the tools that bypass the route are refused identically as `ketos/invalid-memory`. A search query must hold at least one letter or digit and no control character; the route builds the MATCH expression before the database opens, so a refused query never creates the file. A `list` without a status returns every status; a `search` without one returns every status but `archived`, and an explicit status restricts it. Every accepted write notifies the clone session coordinator, so the affected agent's next turn carries the change.

### Observable behavior

- **Opening is lazy.** The profile mounts the plugin and registers the route, but `node:sqlite` is imported and the file is opened on the first clone request or the first restored session — a session restored from disk may be an interview, so it has to be looked up. A process whose chats are all fresh and never touch a clone never opens the file.
- **The file is owner-only.** The parent directory is created `0700` and a missing database file `0600`; an existing file keeps its modes. The database runs in WAL mode with `application_id` `KTCL` and `user_version` `3`.
- **A clone has three lifecycle statuses.** `draft` is a record created by hand, `interviewing` is a clone whose profile an interview session is drafting, and `ready` is a profile saved and awaiting the person's review. Only `interviewing` composes the interview mode.
- **Foreign databases are refused.** An `application_id` stamped by another application, a `user_version` newer than this build, or a file that is not a SQLite database all reject at open instead of being rewritten. An empty SQLite file with no stamps is adopted.
- **Writes are revision-checked.** `update` and `delete` apply only while the stored `revision` still equals the one the caller read; otherwise the answer is `ketos/clone-conflict` and the stored record is untouched. A session binds to at most one clone, and the newest binding of a session wins.
- **The interview opens itself once.** When a session enters the mode, the package queues one kickoff message through `agent.followup` with the source kind `ketos-clone-interview`. The pending inbox, the queued latch, and the durable session log together answer whether a kickoff exists: one waiting for its turn or already logged suppresses a second — including in the window between the driver claiming the message and appending it to the log — while a kickoff a cancelled turn dropped is queued again. A restart that left the message pending has it claimed on resume, and the same message is reused, so a restored session cannot be interviewed twice.
- **The profile save ends the mode.** `clone_draft_save` writes the profile it was given over the bound clone, marks the clone `ready`, and the coordinator withdraws the section and the tool. The write enforces the mode itself: a session without an `interview` binding is refused with `ketos/not-a-clone-session`, a clone that already left `interviewing` (for example a profile the person confirmed first) with `ketos/clone-not-interviewing`, and a profile that leaves a required line empty or exceeds the documented bounds with `ketos/invalid-draft`; none of them writes anything.
- **Memory is one clone's own.** Every read is scoped by `clone_id`, so a clone never sees another clone's memory. `archived` memories stay out of search and out of the prompt snapshot until the person restores them.
- **The FTS index is kept by the repository.** `memories_fts` is a standalone FTS5 table with no triggers and no external content; every write updates the table and the index inside one transaction, so only a hand-edited database can desynchronize them, and the package's reads join the index back to the table.
- **Search matches quoted prefixes.** Every query token becomes one quoted FTS5 phrase with a trailing `*` (`"навык"*`), which keeps FTS5 syntax inert data and finds inflected Russian forms even though `unicode61` does no stemming. The package's benchmark searches ten thousand stored memories in well under 20 ms.
- **The tools belong to the clone session.** `clone_memory_remember` and `clone_memory_search` are registered into the agent scope of a session bound to a clone, never globally; both re-check the binding at execution time and refuse with `ketos/not-a-clone-session` once it is gone.
- **The profile is stable, the memory is dynamic.** The profile rides `systemPrompt.section` and the memory snapshot rides `systemPrompt.context`, so a new memory arrives as a durable runtime-context message on the next turn and never rewrites the request prefix; `memoryEntries` and `memoryChars` bound that snapshot, and deeper lookup is the search tool.
- **The person's edits reach the agent.** An edit or deletion through `/api/ketos.memory` re-derives the agent's snapshot, so its next turn sees exactly what the person left in the memory window.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Schema

`clones` stores one row per clone; `clone_sessions` stores one row per bound session with an index on `clone_id`; `memories` stores one row per remembered fact with an index on `(clone_id, status)` and a standalone `memories_fts` FTS5 table over the content and tags. All three are STRICT tables, timestamps are ISO-8601 UTC strings, and every read decodes the durable value it finds — an unknown `status`, binding role, or memory status, or a `skills_json`/`tags` that is not an array of strings fails loud instead of surfacing a broken clone in the UI. The version `2` step normalizes the superseded speculative status pair (`active` to `ready`, `archived` to `draft`) without touching any other field; the version `3` step adds the memory table, its index, and its FTS5 table.

### Clone session scope

`src/session.ts` owns the scope. Its coordinator listens to `agent/created`, `agent/session-start`, `agent/disposed`, and both routes' mutation notification, then reads the stored binding and clone and reconciles one per-agent scope: `agent.ctx.inject(['tools', 'systemPrompt'], …)` registers the `clone:profile` section, the `clone:memory` context, and the two memory tools, and — while the binding role is `interview` and the clone is `interviewing` — the `clone:interview` section, `clone_draft_save`, and the kickoff that opens the interview exactly once. A profile edit or a memory write refreshes the mutable text the prompt providers read; a rebind or an interview-mode change disposes the scope and installs the correct one. Nothing enters the global registries, and reconciliations are chained per agent, so overlapping triggers cannot install the scope twice.

### Forward-only runner

`src/schema.ts` owns the ordered step list: entry `n - 1` produces `user_version` `n`, and `migrate` applies every missing step in one pass before stamping the current version. There are no rollbacks and no data loss; a newer stored version is refused, never downgraded. `clone_tasks` joins the list as step 4 in its own stage.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `name`/`inject`/`Config`/`apply`, the lazily opened database, and its disposal |
| [`src/db.ts`](src/db.ts) | Owner-only file creation, the open sequence, and the shared lazy handle both repositories open over |
| [`src/schema.ts`](src/schema.ts) | Identity and version stamps, the ordered migration steps, and the runner |
| [`src/repository.ts`](src/repository.ts) | Prepared-statement clone CRUD with revision CAS, the session bindings, and the interview profile save |
| [`src/memory.ts`](src/memory.ts) | The memory repository, its FTS5 synchronization, the quoted-prefix MATCH expression, and the memory bounds |
| [`src/memory-tools.ts`](src/memory-tools.ts) | The two memory tools and the snapshot text the prompt context renders |
| [`src/memory-routes.ts`](src/memory-routes.ts) | The `/api/ketos.memory` route, its validation, and its error codes |
| [`src/routes.ts`](src/routes.ts) | The `/api/ketos.clones` route, its manual body validation, and its error codes |
| [`src/session.ts`](src/session.ts) | The clone session scope: the coordinator, the profile and interview section texts, the memory wiring, the kickoff message source, and the kickoff projection |
| [`src/transaction.ts`](src/transaction.ts) | The immediate-transaction wrapper the multi-statement writes share |
| [`src/wire.ts`](src/wire.ts) | The shared route helpers: JSON answers, the `no-store` header, and the body-validation primitives |
| [`src/types.ts`](src/types.ts) | The stored records, the wire DTOs, the request inputs, and the error codes; the module browser code imports type-only |
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

### A session that is not bound to a clone

#### What the model sees

Nothing. The clone's record and its memory reach a model only through the clone session scope below.

#### Token effect

Zero tokens in every ordinary request.

#### KV Cache effect

None; the package never touches an ordinary session's request prefix.

### The clone session

#### What the model sees

A session bound to a clone carries the `clone:profile` section — the stored name, role, summary, persona, working method, and skill names, with the instruction to keep them in every reply — the `clone:memory` runtime-context snapshot listing the newest active memories with their ids and tags, and the `clone_memory_remember` and `clone_memory_search` tools. An interviewing session additionally carries the interview instruction and `clone_draft_save`.

#### Token effect

The profile section is fixed for the clone's record; the memory snapshot adds at most `memoryChars` characters (default 8000, about 2000 tokens) and renders nothing while the clone remembers nothing; the two tool schemas add their arguments to that session's catalog. No other session carries any of them.

#### KV Cache effect

The profile section text changes only when the person edits the record, so the request prefix stays byte-identical between turns while the agent remembers; a memory write changes only the runtime-context message, so the cached prefix holds.

### The interview session

#### What the model sees

The interviewing agent's system prompt carries the `clone:interview` section: the instruction to interview the person one question at a time, the checklist of topics (responsibilities, regulations, data sources, communication style, quality criteria, reference cases, prohibitions), and the instruction to finish by calling `clone_draft_save` once with the complete profile. The tool is registered only in that agent's scope, its result names the saved clone and revision, and the opening stimulus arrives as a user-role message whose source kind is `ketos-clone-interview` and whose transcript row is the collapsed notice "Clone interview started".

#### Token effect

The section is about 320 tokens and rides every request of an interview session; the tool schema adds its arguments to that session's tool catalog. No other session and no other request carries either.

#### KV Cache effect

The section text is static, so the request prefix stays byte-identical between turns and the cache holds; only tool results and ordinary messages grow the suffix. Withdrawing the mode at `ready` removes the section from the next assembly, which is a new prefix by design.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **`clone_tasks` is absent** — the autonomous-task stage adds it as step 4 of the same runner; until then the database holds clone records, session bindings, and memories.
- **The route is hand-validated, not generated** — there is no Typert codegen for the clone domain (the API is still moving), so the browser and the host share `src/types.ts` by hand and the route validates every field itself.
- **`skills` is stored but unused** — the interview tool writes the names the person listed and they round-trip through the record and the wire, but no editor control or prompt consumes them before the methodology/skills stage.
- **Interview progress is the status, not a checklist** — the package reports `interviewing` and the transcript; it does not track which topics were covered, and the stage that owns progress can add a checklist without changing the mode.
- **The kickoff is queued once per session** — the pending inbox and the session log are the authority; a kickoff that a hard kill left pending is claimed on resume instead of being queued twice, and one that never reached either is queued again rather than leaving the session waiting silently.
- **The preferred model is applied through the browser's model selection** — creating a clone session selects the stored route through `remote.session.selectModel`, which also saves the choice as the `agent-default-model` system default; `packages/client/ui-board/README.md` owns the product-facing statement of that side effect.
- **Deleting a clone removes its session bindings** — the sessions themselves stay in the session store as ordinary sessions; nothing unbinds a session any other way.
- **No rollbacks and no downgrade** — a database written by a newer build rejects at open; recovering means using the newer build or deleting the file.
- **Memory search is lexical, not semantic** — FTS5 prefix matching over `unicode61` tokens; there are no embeddings and no cross-clone knowledge base before the post-MVP stage.
- **`candidate` is a status, not a quarantine** — `methodology_candidate: true` stores `status = 'candidate'` and the window shows the row; PII masking and the review queue are post-MVP.
- **A memory has no revision check** — unlike a clone record, a memory edit is last-writer-wins; the window re-reads the list after every mutation, and the agent and the person write the same rows.
- **Archived memories still exist** — the person's window restores them; the agent's search and prompt snapshot skip them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Inspect a live database with `sqlite3 "$DSH_HOME/clones.db" '.schema'`; the default home of the Ketos CLI is `~/.ketos`. Run the package specs with `pnpm exec vitest run packages/ketos/clone-core/tests`: `tests/composition.spec.ts` mounts the row through a real Loader beside the agent stack and drives the whole path — interview install, kickoff, save, and withdrawal, the memory tools saving and finding a fact, the profile and memory injection, the snapshot refresh after a person's edit and after a deletion, and the scope withdrawal when the clone is deleted; `tests/memory.spec.ts` covers the memory store, its FTS synchronization, the clone isolation, and the ten-thousand-record search budget.

</details>
