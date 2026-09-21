# Agent Note: The clone domain owns its own SQLite file behind one Fetch route, and the board edits clones in clone windows

Status: implemented

English | [中文](2026-09-21-ketos-stage-15-clone-model-editor.zh.md)

## Problem

Until this stage the board held only sessions: nothing in the product was a record a user creates, names, and edits, and no Ketos package owned durable data of its own. The stage introduces the clone — a digital double of an employee with a role, a persona, a method, a preferred model route, and the sessions bound to it — so it needed a host store with a defined schema and lifetime, a transport the browser could use without a new code-generated remote domain, and a board surface where a clone is created, edited, and turned into a session. Everything the store writes must survive a restart, must not collide with another package's database, and must not make `ketos web` print Node's SQLite experimental warning at startup.

## Decision

**`@ketos/clone-core` owns `$DSH_HOME/clones.db` and its own forward-only schema runner.** The domain KV stack was rejected: `storage-domain`/`storage-sqlite` store validated documents and refuse any `user_version` they did not stamp, so a schema that grows by steps in stages 17 and 19 cannot live there. `src/schema.ts` holds the ordered step list — entry `n - 1` produces `user_version` `n` — and `migrate` applies every missing step in one pass, stamping `application_id` `KTCL` on a fresh file. Only a foreign `application_id`, a newer `user_version`, or a non-SQLite file is refused; there are no rollbacks and no downgrade. The parent directory is created `0700`, a missing file `0600`, and every read decodes the durable value it finds, so a hand-edited `status` or `skills_json` fails loud rather than reaching the UI.

**The database opens lazily.** `apply` registers the route and owns a lazy handle; `node:sqlite` is imported and the file opened on the first request. The built-CLI smoke asserts that the shipped composition starts without `ExperimentalWarning: SQLite`, so an eager open at mount would fail that gate for every deployment that never touches clones.

**One exact Fetch route carries the domain, with hand-validated JSON.** `/api/ketos.clones` registers through `ctx.connection.fetch` (`GET` lists, `POST` carries an `op`), because exact routes match before the Typert gateway and the clone API is still moving — a code-generated remote domain would freeze a wire contract per field. The route validates every field itself (unknown fields, over-long text, empty name or role, non-integer revision, unknown `op`), and answers `400 ketos/invalid`, `404 ketos/clone-not-found`, or `409 ketos/clone-conflict`; the browser and the host share `src/types.ts` through the package's `./types` subpath, which browser code imports type-only.

**Writes are revision-checked, and deleting a clone takes its bindings with it.** `update` and `delete` apply only while the stored `revision` still equals the value the caller read; a mismatch answers `ketos/clone-conflict` and leaves the record untouched. `deleteClone` removes the clone and its `clone_sessions` rows in one transaction, because a binding whose clone is gone can never be resolved; the sessions themselves stay in the session store as ordinary sessions.

**The clone UI stays inside `ui-board`.** The window state gains an optional branded `cloneId` that the layout document persists, so a restored clone window reopens on its clone; `BOARD_WINDOW_TEMPLATES.clone` and the `board.window.body` key `clone` register the editor body, and the frame names the window after the clone until the user renames it. The roster is published through the inject `hooks` compartment (`cloneList`), which is the declared channel for a registrant-owned reactive fact, and every mutation goes through new inject-face callbacks; the dock's clone mini-panel, the Omnibox's New clone entry and Clones section, and the editor all read the same source. Creating a clone session is one apply-side operation: `sessions.create()`, `bridge.adopt(windowId, sessionId)` (bind plus the remembered default preset), the stored model route through `bridge.selectModel`, and `bindSession` on the route; the session opens in a chat window of its own. The model choice is also saved as the `agent-default-model` system default — the existing side effect `packages/client/ui-board/README.md` documents; the plan accepts it for this stage.

**The preferred model is stored as a `provider/model` route.** The editor's picker offers the deployment's model catalog plus `Deployment default`, stores the pick in the record's `preferred_model` column, and `parseModelRoute` splits it at the first separator — the provider ids carry no slash, so a model id that contains one stays intact.

## Alternatives considered

- **Store clones through `storage-domain` over the SQLite backend.** Rejected: that stack owns its own `user_version` and refuses anything else, so a schema with staged additions would have to be smuggled in as one document; clones need their own steps, indexes, and identity stamps.
- **A Typert remote domain with generated types.** Rejected for this stage: the clone API is pre-stable, and the generated surface (protocol schemas, gateway claims, client assembly entries) costs far more than the one route, while an exact route matches before the gateway and is what `ui-deliverables` already proves in production.
- **A new `@ketos/clone-ui` client package.** Rejected: the plan keeps clone windows in `ui-board` so the browser side adds no registration surface; the clone body is one more `yield` in the existing `board.window.body` registration.
- **Open the database when the plugin mounts.** Rejected: the lazy open is what keeps the CLI startup smoke free of the SQLite experimental warning; a mount-time open has no benefit for a process that never lists or edits a clone.
- **Edit clones in the main panel instead of a board window.** Rejected: the board is the product surface for Ketos, and a clone window participates in the existing layout, dock, and fullscreen behavior without new chrome.
- **A free-text preferred-model field.** Rejected: the model catalog is already projected to the browser, and a typed route keeps the stored value resolvable by `remote.session.selectModel` at session creation.

## Consequences

The product now has a first-class record: a clone is created in the board, edited with a revision indicator and a conflict banner, survives a restart in `~/.ketos/clones.db`, and can be turned into a session that is bound to it. Later stages extend the same database with `clone_tasks` and memory tables as steps 2 and 3 of the same runner, and the interview stage inherits the `clone_sessions` binding instead of inventing a new one. The costs accepted: the route is hand-validated rather than generated, the browser and host share types by hand, a preferred-model change also writes the system default, and a clone's `skills` field round-trips with no consumer yet.

Verification: `packages/ketos/clone-core/tests/database.spec.ts` covers the owner-only creation, the identity and version stamps, the refusal paths, and the runner's ordered, data-preserving application; `tests/repository.spec.ts` covers CRUD, revision CAS, binding replacement, and durable decoding; `tests/routes.spec.ts` covers every operation, every error code, and the route's withdrawal with its fiber; `tests/composition.spec.ts` boots the row through a real Loader against a recording connection service and proves the file stays untouched until the first request. `packages/client/ui-board/tests/clone-body.client.spec.tsx` covers the form's seeding, save patch and revision, conflict and missing outcomes, the two-step delete, the model picker, and the session actions; `tests/clone-flow.client.spec.tsx` drives the assembled board — roster in the dock, New clone from the Action Menu, and a created session bound through `/api/ketos.clones`; `tests/board-layout.client.spec.ts` and `tests/open-window.client.spec.ts` cover the persisted `cloneId` and the template. `pnpm run test:gui`, `DSH_SNAPSHOT=replay pnpm run test:web`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, `pnpm run hygiene`, and `pnpm run doc-sync` are green.

## Related

- [The board composes as slots with one registration per window and body kind](2026-09-15-ketos-board-slot-composition.md) — the keyed seats this stage adds one `clone` body to.
- [Board windows restore their Harness sessions and reconcile them against the session list](2026-09-19-ketos-board-session-restore.md) — the session bridge, its binding map, and the `adopt` entry point this stage adds.
- [Board layout persistence through the `ui-board` settings namespace](2026-09-18-ketos-board-layout-persistence.md) — the document that now carries the clone window's `cloneId`.
- [Ketos MVP engineering policy (fork scope, coverage exceptions, process)](../process/2026-09-15-ketos-mvp-engineering-policy.md) — the `packages/ketos/clone-*/src/**` coverage exception this package consumes.
- [`packages/ketos/clone-core/README.md`](../../../../packages/ketos/clone-core/README.md) — the route table, the schema, and the package's limits.
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.md) — the clone window, the dock mini-panel, and the model-default side effect.
