---
description: "The Ketos clone domain host package: clones.db, its forward-only schema, the revision-CAS repository and the FTS5 memory store, the /api/ketos.clones, /api/ketos.memory, and /api/ketos.tasks Fetch routes, the clone session scope: profile, skills, memory, the interview that drafts a profile, and the report tool of a running task, and the task runner that drives a clone's autonomous task as a goal."
kind: "package-reference"
---

# @ketos/clone-core

English | [中文](README.zh.md)

## Summary

`@ketos/clone-core` owns the Ketos clone domain. A clone is a record — name, role, persona, methodology, preferred model route, skills, status — plus bound sessions, memories, and autonomous tasks; the package is the only writer: one `node:sqlite` database at `$DSH_HOME/clones.db`, a forward-only schema runner, a revision-CAS repository, an FTS5 memory store, and the `/api/ketos.clones`, `/api/ketos.memory`, and `/api/ketos.tasks` Fetch routes. It owns the methodology sections, the clone session scope — profile, registered skills, memory tools, the interview, and the report tool of a running task — and the runner that drives a task as a goal.

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
| `defaultMaxRounds` | `10` | Round budget a new autonomous task hands to its goal, from 1 to 50. The upper bound is a validation invariant, not a setting. |

The package has no browser bundle: `packages/client/ui-board` talks to the route with plain `fetch`, imports the `./types` module type-only, and inlines the browser-safe `./methodology` module into its own bundle, which keeps the clone window inside the existing board registrations instead of adding a client plugin row.

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

`patch` accepts `name`, `role`, `description`, `persona`, `methodology`, `preferredModel`, `skills`, and `status`; `status` is one of `draft`, `interviewing`, `ready`, and `role` in a binding is one of `main`, `interview`. A request that stores `ready` is accepted only while the effective `role`, `persona`, and `methodology` are all non-empty (`update` takes each field from the patch when present, else from the stored record). Each skill is a `{ name, description, instructions }` object: the name is unique within the list and matches the skill registry's kebab-case grammar (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 64 characters), the description holds at most 500 characters, the instructions at most 20000, and the list at most 100 skills — the route validates all of it with the rest of the body, before the database opens. Every accepted write notifies the clone session coordinator, which re-derives the scope of every live top-level agent and refreshes its profile text and memory snapshot.

### The memory route

`/api/ketos.memory` is the second exact Fetch route, registered through the same service and withdrawn with the plugin fiber.

| Method | Request | Answer |
|---|---|---|
| `POST` | `{ op: 'list', cloneId, status? }` | `{ ok: true, memories }` |
| `POST` | `{ op: 'search', cloneId, query, limit?, status? }` | `{ ok: true, memories }` |
| `POST` | `{ op: 'update', id, patch }` | `{ ok: true, memory }` |
| `POST` | `{ op: 'delete', id }` | `{ ok: true, id }` |

Failures answer `400` `ketos/invalid` and `404` `ketos/memory-not-found`. `patch` accepts `content` (at most 4000 characters), `tags` (at most 50 single-line tags of 100 characters, none carrying a comma — that is the memory window's separator), and `status` (`active`, `candidate`, `archived`); the repository refuses the same bounds, so the tools that bypass the route are refused identically as `ketos/invalid-memory`. A search query holds at most 1000 characters, must hold at least one letter or digit, and must carry no control character; the repository refuses the same bounds, so `clone_memory_search` is refused identically as `ketos/invalid-memory`. The route builds the MATCH expression before the database opens, so a refused query never creates the file. A `list` without a status returns every status; a `search` without one returns every status but `archived`, and an explicit status restricts it. Every accepted write notifies the clone session coordinator, so the affected agent's next turn carries the change.

### The tasks route

`/api/ketos.tasks` is the third exact Fetch route, registered through the same service and withdrawn with the plugin fiber. A task names the clone it works for, the objective the clone's goal pursues, the round budget that goal may use, and the session that runs it once started.

| Method | Request | Answer |
|---|---|---|
| `POST` | `{ op: 'list', cloneId? }` | `{ ok: true, tasks }` |
| `POST` | `{ op: 'get', id }` | `{ ok: true, task }` |
| `POST` | `{ op: 'create', cloneId, objective }` | `{ ok: true, task }` |
| `POST` | `{ op: 'start', id, sessionId }` | `{ ok: true, task }` |
| `POST` | `{ op: 'cancel', id }` | `{ ok: true, task }` |

Failures answer `400` `ketos/invalid`, `404` `ketos/task-not-found` or `ketos/clone-not-found`, `409` `ketos/invalid-state`, and `409` `ketos/agent-not-live`. `objective` is required, trimmed, and at most 2000 characters; `create` stores a `pending` task with the configured `defaultMaxRounds` budget; `start` moves it to `running` only while it is `pending`, its clone exists and is `ready`, and the named session has a live agent; `cancel` moves a `pending` or `running` task to `cancelled` and is a no-op when the task is already cancelled. Every accepted write notifies the clone session coordinator, so the report tool appears with a start and is withdrawn when the task reaches a terminal status; the runner defers its own withdrawal to the end of the turn when the terminal event lands mid-turn, while a scope change caused by a route mutation applies immediately. Deleting a clone deletes its tasks with its bindings and memory.

### Observable behavior

- **Opening is lazy.** The profile mounts the plugin and registers the route, but `node:sqlite` is imported and the file is opened on the first clone request or the first restored session — a session restored from disk may be an interview, so it has to be looked up. A process whose chats are all fresh and never touch a clone never opens the file.
- **The file is owner-only.** The parent directory is created `0700` and a missing database file `0600`; an existing file keeps its modes. The database runs in WAL mode with `application_id` `KTCL` and `user_version` `5`; every connection waits up to 5000 ms for another process's lock before failing.
- **A clone has three lifecycle statuses.** `draft` is a record created by hand, `interviewing` is a clone whose profile an interview session is drafting, and `ready` is a complete profile — non-empty role, persona, and methodology — saved and awaiting the person's review. Only `interviewing` composes the interview mode.
- **Foreign databases are refused.** An `application_id` stamped by another application, a `user_version` newer than this build, or a file that is not a SQLite database all reject at open instead of being rewritten. An empty SQLite file with no stamps is adopted.
- **Writes are revision-checked.** `update` and `delete` apply only while the stored `revision` still equals the one the caller read; otherwise the answer is `ketos/clone-conflict` and the stored record is untouched. A session binds to at most one clone, and the newest binding of a session wins.
- **The interview opens itself once.** When a session enters the mode, the package queues one kickoff message through `agent.followup` with the source kind `ketos-clone-interview`. The pending inbox, the queued latch, and the durable session log together answer whether a kickoff exists: one waiting for its turn or already logged suppresses a second — including in the window between the driver claiming the message and appending it to the log — while a kickoff a cancelled turn dropped is queued again. A restart that left the message pending has it claimed on resume, and the same message is reused, so a restored session cannot be interviewed twice.
- **The profile save ends the mode.** `clone_draft_save` writes the profile it was given over the bound clone: role, description, persona, and methodology replace the stored values, while the draft's skills merge into the stored list by name — a stored skill the draft does not name keeps its place, a same-name draft skill replaces it there, and a new name appends in draft order — and the clone turns `ready`; the coordinator withdraws the section and the tool. The write enforces the mode itself: a session without an `interview` binding is refused with `ketos/not-a-clone-session`, a clone that already left `interviewing` (for example a profile the person confirmed first) with `ketos/clone-not-interviewing`, and a profile that leaves a required line empty, repeats a skill name, breaks its grammar, or exceeds the documented bounds or the merged list cap with `ketos/invalid-draft`; none of them writes anything.
- **Memory is one clone's own.** Every read is scoped by `clone_id`, so a clone never sees another clone's memory. `archived` memories stay out of search and out of the prompt snapshot until the person restores them.
- **The FTS index is kept by the repository.** `memories_fts` is a standalone FTS5 table with no triggers and no external content; every write updates the table and the index inside one transaction, so only a hand-edited database can desynchronize them, and the package's reads join the index back to the table.
- **Search matches quoted prefixes.** Every query token becomes one quoted FTS5 phrase with a trailing `*` (`"навык"*`), which keeps FTS5 syntax inert data and finds inflected Russian forms even though `unicode61` does no stemming. The package's benchmark searches ten thousand stored memories in well under 20 ms.
- **The tools belong to the clone session.** `clone_memory_remember` and `clone_memory_search` are registered into the agent scope of a session bound to a clone, never globally; both re-check the binding at execution time and refuse with `ketos/not-a-clone-session` once it is gone.
- **Personal skills register into the agent's own layer.** A bound agent's clone skills are registered as runtime skills in that agent's own skill-registry scope, each carrying its stored instructions and the name and description its catalog entry shows. A skill stays out of the registry while its name fails the registry grammar, exceeds the 64-character bound, or its description is empty, and a deployment that composes no skill registry leaves that scope pending without withholding the profile, the memory tools, or the interview mode.
- **The profile is stable, the memory is dynamic.** The profile rides `systemPrompt.section` and the memory snapshot rides `systemPrompt.context`, so a new memory arrives as a durable runtime-context message on the next turn and never rewrites the request prefix; `memoryEntries` and `memoryChars` bound that snapshot, and deeper lookup is the search tool.
- **The person's edits reach the agent.** An edit or deletion through `/api/ketos.memory` re-derives the agent's snapshot, so its next turn sees exactly what the person left in the memory window.
- **An autonomous task is a goal over a live session.** `start` binds the session to the clone, selects the clone's preferred model route on it exactly as the interview flow does, re-derives its scope, and creates the goal with the task's objective and budget; the shipped `goal-round-driver` then adds the next round whenever the agent is idle, so the clone works without a person prompting it. `clone_task_report` stores the report and completes the goal; a goal that reaches `complete` settles the task as `done` with that report — or with the newest assistant text when no report was filed — a `blocked` goal settles it as `failed` with the driver's message, except a goal blocked with the code `cancelled`, which settles it as `cancelled`, and closing the session settles a running task as `failed`. A terminal status is never rewritten, and a repeated cancel is a no-op.
- **A task never resumes by itself.** The first open of the task table by the clone database settles every `running` task as `failed` with `the process restarted before the task finished`: the goal driver re-arms nothing after a restart and the interrupted round is gone, so the status must stop claiming the work is alive. Continuing the work means starting a new task.
- **Cancelling blocks the goal durably.** `cancel` calls `ctx.goals.block` with the code `cancelled` — a durable `goal/change` record, not the process-local disarm — and aborts the live turn, so no further round starts and the log says why.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Schema

`clones` stores one row per clone; `clone_sessions` stores one row per bound session with an index on `clone_id`; `memories` stores one row per remembered fact with an index on `(clone_id, status)` and a standalone `memories_fts` FTS5 table over the content and tags; `clone_tasks` stores one row per autonomous task with an index on `clone_id` and one on `session_id`. All of them are STRICT tables, timestamps are ISO-8601 UTC strings, and every read decodes the durable value it finds — an unknown `status`, binding role, or memory status, a `skills_json` that is not an array of skill objects, or a `tags` that is not an array of strings fails loud instead of surfacing a broken clone in the UI. The skill decode deliberately checks only the object fields, not the name grammar or uniqueness, so a database written before those rules stays readable. The version `2` step normalizes the superseded speculative status pair (`active` to `ready`, `archived` to `draft`) without touching any other field; the version `3` step adds the memory table, its index, and its FTS5 table; the version `4` step rewrites a legacy array of skill names into skill objects with an empty description and instructions, in the stored order; the version `5` step adds the task table and its two indexes.

### Clone session scope

`src/session.ts` owns the scope. Its coordinator listens to `agent/created`, `agent/session-start`, `agent/disposed`, and both routes' mutation notification, then reads the stored binding and clone and reconciles one per-agent scope: `agent.ctx.inject(['tools', 'systemPrompt'], …)` registers the `clone:profile` section, the `clone:memory` context, and the two memory tools, and — while the binding role is `interview` and the clone is `interviewing` — the `clone:interview` section, `clone_draft_save`, and the kickoff that opens the interview exactly once; a session running a task additionally carries the `clone:task` context and `clone_task_report`. A second scope on `agent.ctx.inject(['skills'], …)` registers every registerable stored skill as a runtime skill in that agent's own layer and disposes with the agent; it activates on its own, so a deployment without a skill registry leaves it pending without withholding any other clone contribution. A profile edit or a memory write refreshes the mutable text the prompt providers read; a rebind or an interview-mode change disposes both scopes and installs the correct one. Nothing enters the global registries, and reconciliations are chained per agent, so overlapping triggers cannot install the scope twice. The `clone:profile` section deliberately carries no skill names: the catalog the `skill` tool publishes is the one model-facing list of what the agent may load.

### Methodology vocabulary

`src/methodology.ts` is browser-safe by construction — no imports, no state — and owns the four canonical section headings (`Принципы`, `Порядок работы`, `Критерии качества`, `Чего не делать`), the template of those headings with empty bodies, and the pure parser over level-two headings. The interview instruction tells the interviewer to write exactly those four sections; the editor imports the module through the `./methodology` export to mark a section missing or empty, and a gap is a hint that never refuses a save. The profile injects the stored methodology markdown as it is.

### Forward-only runner

`src/schema.ts` owns the ordered step list: entry `n - 1` produces `user_version` `n`, and `migrate` applies every missing step in one pass before stamping the current version. A step adds what its version needs or rewrites one column's stored value into that version's shape; there are no rollbacks and no stored value is dropped, and a newer stored version is refused, never downgraded.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `name`/`inject`/`Config`/`apply`, the lazily opened database, and its disposal |
| [`src/db.ts`](src/db.ts) | Owner-only file creation, the open sequence, and the shared lazy handle every repository opens over |
| [`src/schema.ts`](src/schema.ts) | Identity and version stamps, the ordered migration steps, and the runner |
| [`src/repository.ts`](src/repository.ts) | Prepared-statement clone CRUD with revision CAS, the session bindings, and the interview profile save |
| [`src/memory.ts`](src/memory.ts) | The memory repository, its FTS5 synchronization, the quoted-prefix MATCH expression, and the memory bounds |
| [`src/memory-tools.ts`](src/memory-tools.ts) | The two memory tools and the snapshot text the prompt context renders |
| [`src/memory-routes.ts`](src/memory-routes.ts) | The `/api/ketos.memory` route, its validation, and its error codes |
| [`src/methodology.ts`](src/methodology.ts) | The canonical methodology headings, the template, and the gap parser the interview instruction and the editor share |
| [`src/routes.ts`](src/routes.ts) | The `/api/ketos.clones` route, its manual body validation, and its error codes |
| [`src/task-repository.ts`](src/task-repository.ts) | The task repository: creation, guarded status transitions, and the open-time reconciliation of interrupted tasks |
| [`src/task-routes.ts`](src/task-routes.ts) | The `/api/ketos.tasks` route, its validation, and its error codes |
| [`src/task-runner.ts`](src/task-runner.ts) | The runner that starts a task as a goal, follows the goal and session events to a terminal status, and cancels one |
| [`src/task-tools.ts`](src/task-tools.ts) | The `clone_task_report` tool |
| [`src/session.ts`](src/session.ts) | The clone session scope: the coordinator, the profile, interview, and task texts, the memory wiring, the runtime skill registration, the kickoff message source, and the kickoff projection |
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
- Skill registry and catalog: [`@deepseek-ai/dsh-skill`](../../skill/skill/README.md) owns the registry a clone's skills register into, and [`@deepseek-ai/dsh-tool-skill`](../../skill/tool-skill/README.md) owns the catalog that lists them to the model.
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

A session bound to a clone carries the `clone:profile` section — the stored name, role, summary, persona, and working method, with the instruction to keep them in every reply — the `clone:memory` runtime-context snapshot listing the newest active memories with their ids and tags, and the `clone_memory_remember` and `clone_memory_search` tools. The clone's registerable skills reach the model through the session catalog the `skill` tool publishes, one entry per skill carrying its name and description, and a `skill` call returns the stored instructions. An interviewing session additionally carries the interview instruction and `clone_draft_save`.

#### Token effect

The profile section is fixed for the clone's record; the memory snapshot adds at most `memoryChars` characters (default 8000, about 2000 tokens) and renders nothing while the clone remembers nothing; each registerable skill adds one catalog entry with its name and description (at most 100 skills); the two tool schemas add their arguments to that session's catalog. No other session carries any of them.

#### KV Cache effect

The profile section text is fixed for the stored record, so the request prefix stays byte-identical between turns while the agent works; a person's profile or methodology edit republishes the section in place and reaches the running session on its next assembly, which rewrites the prefix from the first changed token and drops the reusable cache there; a memory write changes only the runtime-context message, so the cached prefix holds; the skill catalog is published once and stays byte-identical while the agent lives, because its registered set is fixed for that agent's lifetime.

### The interview session

#### What the model sees

The interviewing agent's system prompt carries the `clone:interview` section: the instruction to interview the person one question at a time, the checklist of topics (responsibilities, regulations, data sources, communication style, quality criteria, reference cases, prohibitions), the instruction to write the methodology as exactly the four canonical sections (`## Принципы`, `## Порядок работы`, `## Критерии качества`, `## Чего не делать`), the instruction to give every skill a kebab-case name, a description, and instructions, and the instruction to finish by calling `clone_draft_save` once with the complete profile. The tool is registered only in that agent's scope, its result names the saved clone and revision, and the opening stimulus arrives as a user-role message whose source kind is `ketos-clone-interview` and whose transcript row is the collapsed notice "Clone interview started".

#### Token effect

The section is about 360 tokens and rides every request of an interview session; the tool schema adds its arguments to that session's tool catalog. No other session and no other request carries either.

#### KV Cache effect

The section text is static, so the request prefix stays byte-identical between turns and the cache holds; only tool results and ordinary messages grow the suffix. Withdrawing the mode at `ready` removes the section from the next assembly, which is a new prefix by design.

### The task session

#### What the model sees

A session running a task carries everything the clone session carries, plus the `clone:task` runtime-context instruction: no person is watching, so it must not ask questions or wait for approval, each round must make concrete progress and verify it, and the objective is achieved by calling `clone_task_report` once with the final result. The objective and the round number reach the model in the driver's `<goal_round>` user message, and the report tool's schema carries its summary argument.

#### Token effect

The autonomy instruction is about 60 tokens on every request of a running task's session; the round prompt adds the objective and the round counter per round; the tool schema adds its argument to that session's catalog. No other session carries any of them.

#### KV Cache effect

The instruction is static, so the request prefix stays byte-identical between rounds; each round appends a user message, and completing the goal withdraws the tool and the context on the next scope reconciliation, which is a new prefix by design.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A running task does not survive a restart** — the first open of the task table settles interrupted tasks as `failed`; automatic continuation is post-MVP, so continuing the work means starting a new task.
- **The tasks window polls** — status reaches the browser through the window's 750 ms poll while a task is active; `goal/changed` stays host-side and forwarding it to the browser is post-MVP.
- **Round progress is best-effort** — the window reads the goal of each running task through `ctx.remote.goals.get`, and a session whose goal is gone simply shows no progress line.
- **A terminal task cannot be restarted or resumed** — `done`, `failed`, and `cancelled` are final; a new task is the only way to run the work again.
- **The report is the text the clone filed** — the package stores the tool's summary as-is; the artifacts the window lists are folded from the session transcript the browser already holds, so a session this client never opened shows none.
- **A tool withdrawn while its turn is still running can answer `unknown tool`** — a route mutation reconciles the scopes immediately, so a model that calls the report tool again in the same turn after another gesture removed it sees an unknown-tool failure; the interview tool has the same property, and the runner's own terminal path waits for the turn to end.
- **The work continues by hand after a restart** — the goal a restart disarmed can still be resumed from the goal surface while the task row stays `failed`; automatic continuation from the task record is post-MVP.
- **A session created for a refused start stays as an ordinary session** — the client checks the clone and task state before creating it, but a host refusal after creation (for example a session whose agent never came up) leaves the empty session in the session list, because the product has no session delete.
- **The route is hand-validated, not generated** — there is no Typert codegen for the clone domain (the API is still moving), so the browser and the host share `src/types.ts` by hand and the route validates every field itself.
- **A stored skill edit reaches a live agent only on reinstallation or recreation** — a bound agent registers its skill scope once, so a stored change refreshes the profile and memory text alone and the new set appears after the scope is reinstalled or the agent is recreated.
- **A session is not pinned to a clone revision** — a live session sees profile and methodology edits on its next turn, which rewrites the request prefix from the first changed token and drops the reusable KV-cache prefix there, and a session recreated later reads the stored record as it stands then; nothing replays the record a session started from.
- **A clone-bound session comes from the interview or from a task** — no gesture binds a new or existing session to a clone by hand: `Start interview` and a task's `Start` are the only writers of a binding, so a follow-up conversation continues in a session one of them created (the former becomes an ordinary clone session once the profile is `ready`).
- **An unregisterable skill stays out of the model catalog** — a skill whose stored name fails the registry grammar, exceeds the 64-character bound, or whose description is empty stays in the record and out of the registry until the editor fixes it.
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

Inspect a live database with `sqlite3 "$DSH_HOME/clones.db" '.schema'`; the default home of the Ketos CLI is `~/.ketos`. Run the package specs with `pnpm exec vitest run packages/ketos/clone-core/tests`: `tests/composition.spec.ts` mounts the row through a real Loader beside the agent stack and drives the whole path — interview install, kickoff, save, and withdrawal, the memory tools saving and finding a fact, the profile and memory injection, the skill registration and its catalog with the skip of an unregisterable skill and the recreation that refreshes a registered set, the snapshot refresh after a person's edit and after a deletion, and the scope withdrawal when the clone is deleted, and the task path: a start creates the goal and the first round reaches `clone_task_report` without a person prompting it; `tests/memory.spec.ts` covers the memory store, its FTS synchronization, the clone isolation, and the ten-thousand-record search budget; `tests/task-repository.spec.ts` covers creation, the guarded transitions, and the restart reconciliation; `tests/task-routes.spec.ts` covers every operation, every failure code, and the laziness of the file open; `tests/task-runner.spec.ts` covers the goal start, the terminal statuses with their idempotence, and cancellation; `tests/methodology.spec.ts` covers the template, the section parser, and the gap list.

</details>
