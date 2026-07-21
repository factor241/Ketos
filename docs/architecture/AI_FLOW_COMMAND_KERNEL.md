# AI Flow Command Kernel

## Purpose and trust boundary

Stage 08 turns an AI intent into a durable, reviewable command. The model may propose a change and the browser may render its preview, but only the backend command service may write a `Flow`. The browser resolves an interrupt with one boolean; it never sends or applies a Flow patch.

This path supports creating a DB-backed Flow, editing an owned DB-backed Flow, rejecting or abandoning a proposal, detecting stale state, and restoring the latest applicable pre-AI snapshot. It does not add another agent runtime, generic event bus, filesystem transaction, or KFX mutation API.

## Authoritative chain

Every proposal is anchored to the server-owned chain:

`CommandProposal -> ChatRun -> ChatThread -> Folder -> owner`

The denormalized actor, Project, Flow, thread, interrupt, source, and sequence fields are audit and CAS inputs, not authorization substitutes. Recovery and restore repeat the join-chain check. A nullable/foreign owner, forged correlation, orphan source, cross-Project Flow, or `Flow.fs_path != NULL` fails closed before a Flow write.

## Typed change set

`FlowChangeSetV1` accepts exactly seven operations:

1. `create_flow`
2. `add_node`
3. `remove_node`
4. `set_parameter`
5. `connect_nodes`
6. `disconnect_nodes`
7. `replace_flow`

The executor is pure: it applies operations to a copy, validates every registered component, parameter, port, edge and nested key, and returns a bounded redacted preview plus a target hash. `replace_flow` passes the same checks and is not a JSON escape hatch. Secrets, provider/model configuration, MCP/filesystem authority, executable code, unknown fields, invalid graphs, and no-op proposals are rejected before confirmation.

## Canonicalization and identity

Canonical JSON is UTF-8, sorted, compact JSON with a single exact normalization contract. SHA-256 is lower-case hexadecimal. `flow_content_hash` covers exactly `{name, description, data}`. The proposal hash binds semantic payload and server provenance, including source kind, ChatRun, canonical thread, interrupt/bound phase, sequence, actor, Project, Flow, command type, base revision/hash, result hash, and the redacted preview summary.

For create commands the backend reserves a deterministic UUID derived from the durable ChatRun and idempotency key. Concurrent or replayed copies of the same request therefore bind the same proposed Flow ID; no Flow row exists until approve.

## Durable proposal lifecycle

AI proposals move through:

`proposed -> awaiting_confirmation -> applied | rejected | stale | failed`

Pre-interrupt failures keep both `interrupt_id` and `interrupt_bound_at` null. Binding the actual LangGraph interrupt stores the pair atomically and includes the bound phase in the frozen proposal hash. Post-bind terminal rows retain the pair; dialect-specific DB triggers reject clearing or replacement.

The unique `(chat_run_id, idempotency_key)` and `(chat_run_id, sequence)` constraints provide durable replay identity. Same key and fingerprint returns the existing proposal; a changed fingerprint is a conflict.

## Standard interrupt and browser contract

The proposal tool calls standard LangGraph `interrupt(...)`. AG-UI emits its ordinary interrupt outcome. Metadata uses `ketos.flow-command-confirmation.v1` and contains proposal identity, hash, and the server-produced preview. The response schema is an object with the single required boolean `approved` and no extra properties.

CopilotKit `useInterrupt` renders every open confirmation in stock Chat. Approve calls `resolve({approved:true})`; reject calls `resolve({approved:false})`. Close, Escape, collapse, and unmount are local abandonment, not business rejection. Controls stay busy until the server reports an authoritative outcome. The browser does not import legacy AssistantPanel mutation helpers, Flow stores, save hooks, or patch APIs.

## One-use apply transaction

Resolution first correlates the persisted proposal to the original ChatRun, thread, and interrupt and reauthorizes the chain. A conditional update claims only an `awaiting_confirmation` row with `resolved_at IS NULL`; `rowcount=0` is a consumed replay and has zero effect.

Reject records a terminal zero-effect outcome. Approve recomputes the proposal hash and simulation. For edit, the backend verifies current owner, Project, revision and exact content hash, then uses a nested savepoint to create a pinned pre-AI `FlowVersion` and performs:

```sql
UPDATE flow
SET name = :name,
    description = :description,
    data = :data,
    revision = revision + 1
WHERE id = :flow_id
  AND user_id = :actor_id
  AND folder_id = :project_id
  AND revision = :base_revision
```

Exactly one row must change. A losing CAS rolls back its snapshot and records `stale` in the outer transaction. Create inserts the reserved ID once; a conflict becomes stale with no Flow. Snapshot, Flow mutation, pin, and terminal outcome commit together.

## Restore and retention

Restore is an owner-only server operation sourced from an applied AI edit with an intact pin. The source must be the latest applicable lineage item and current Flow revision/hash must match its recorded after-state. The snapshot hash is verified before use.

Restore creates a `server_restore` proposal inheriting the source ChatRun/thread and source proposal ID; it does not impersonate an AG-UI interrupt. A restore snapshot, Flow CAS, and terminal outcome are atomic and idempotent. Automatic pruning excludes any `FlowVersion` referenced by a proposal, and explicit deletion of a pinned version is rejected.

## Concurrency invariants

- concurrent approve of one proposal creates at most one effect;
- proposals sharing one base produce one `applied` and one `stale`;
- a CAS loser leaves no dangling snapshot;
- concurrent reject/replay changes no Flow or FlowVersion;
- same-key/same-fingerprint races produce one durable proposal;
- pre- and post-interrupt failures preserve their exact phase contract.

SQLite covers deterministic service semantics. The acceptance gate additionally uses two independent PostgreSQL sessions/connections, distinct backend PIDs, and an explicit barrier.

## Compatibility and observability

Stage 08 does not change KFX persisted component class names, public Flow Builder exports/defaults, LFX aliases/module map, bundles, or extension manifests. Evidence may record redacted IDs, revisions, hashes, timing and outcomes; it must never record database credentials, cookies, tokens, secret-bearing payloads, or full sensitive prompts.

## Dependency references

The implementation contract was checked against the installed dependency versions and primary documentation:

- [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)
- [AG-UI interrupts](https://docs.ag-ui.com/concepts/interrupts)
- [CopilotKit `useInterrupt`](https://docs.copilotkit.ai/reference/hooks/useInterrupt)
- [SQLAlchemy SAVEPOINT transactions](https://docs.sqlalchemy.org/en/20/orm/session_transaction.html#using-savepoint)
- [Alembic operation reference](https://alembic.sqlalchemy.org/en/latest/ops.html)
