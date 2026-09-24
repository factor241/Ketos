# Agent Note: Ketos stage 22: a live clone session follows stored edits, and the MVP's closing decisions

Status: implemented

English | [中文](2026-09-24-ketos-stage-22-mvp-integration.zh.md)

## Problem

The end-to-end audit of stages 0–20 (2026-09-24) closed its code points in stage 21; stage 22 closes the remaining documentation, decision, repository, and integration points (П5, П6, П20–П25). Two of them need a decision on the record rather than a text edit.

The plan's stage 18.4 recorded that a running clone session continues with the old profile section, while the shipped clone session scope refreshes the profile text and the memory snapshot in place; the audit could not tell intended behavior from drift, and the KV-cache cost of a live profile edit was recorded nowhere. The memory route `/api/ketos.memory` has no create operation and the clone window's Memory tab has no create control, while the acceptance scenario's memory step implied a record added in the window; the audit could not execute the step as written.

## Decision

**A live clone session follows profile and memory edits on its next assembly, and keeps its registered skills.** The clone session scope's prompt providers close over mutable text holders, and the coordinator's reconciliation after every lifecycle event, route mutation, or tool write replaces that text in place, so a person's profile or methodology edit reaches a running session on its next assembly with no restart and no scope reinstallation. The memory snapshot rides `systemPrompt.context`, so a memory write arrives as a durable runtime-context user message. The profile text is part of the request prefix, so a profile edit rewrites the prefix from the first changed token and drops the reusable KV-cache prefix there — the accepted cost of keeping a running session's identity truthful. A skills edit does not re-register: a bound agent's skill scope installs once and its registered set is fixed for that agent's lifetime, so a stored skill change waits for the scope to be reinstalled (a different clone, interview mode, or task) or the agent to be recreated. [Clone memory](2026-09-22-ketos-stage-17-clone-memory.md) owns the section/context split, and [clone methodology and skills](2026-09-22-ketos-stage-18-clone-methodology-skills.md) owns the fixed registered set.

**The memory window verifies, edits, and deletes; the agent writes new records.** `/api/ketos.memory` exposes `list`, `search`, `update`, and `delete`, and a new memory is written by the clone's own `clone_memory_remember` tool call. The MVP acceptance scenario names the agent as the writer and the window as the reviewing surface, and the package READMEs state the missing create path as a boundary.

## Alternatives considered

- **Pinning a session to the clone revision it started under.** Rejected for the MVP: it would freeze a running session's identity until a reinstall gesture, while the in-place refresh already keeps the session truthful at the accepted cost of the KV prefix drop. Pinning remains post-MVP, and the READMEs state that nothing replays the record a session started from.
- **Reinstalling the scope on every stored change.** Rejected: it would re-register the tools and sections on every memory write, while the section/context split makes the in-place refresh do less work for the same visible result; reinstall stays reserved for a different clone, a different interview mode, or a different task.
- **Re-registering skills on every clone data change.** Rejected at stage 18: the registered set is fixed for the agent's lifetime, and the profile section deliberately names no skills because a live scope cannot change them; the editor states the wait.
- **Adding a create operation to `/api/ketos.memory`, or a create control to the memory window.** Rejected for the MVP: the plan records the absence as a boundary, and the agent's tool is the authored path for what a clone remembers; the window's four operations keep the person's control without a second writing surface.

## Consequences

A person's edit lands on the running session's next turn, and a memory write stays prefix-neutral while a profile edit pays the KV prefix drop from the first changed token; a skills edit still awaits reinstall or recreation. The acceptance scenario is executable as written: the interview's `clone_memory_remember` call supplies the record the memory window verifies, edits, and deletes. [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.md), [`packages/ketos/clone-core/README.md`](../../../../packages/ketos/clone-core/README.md), and `docs/ketos/mvp-known-limitations.md` carry the same facts, and the stage-18.4 wording is superseded.

Verification: `packages/ketos/clone-core/tests/composition.spec.ts` (a profile edit reaches the next assembly, a memory write leaves the rendered prompt prefix byte-identical, a person's edit and deletion follow, and the skill set refreshes on recreation), `packages/client/ui-board/tests/clone-flow.client.spec.tsx` and `tests/clone-memory.client.spec.tsx` (the memory tab lists, edits, and deletes through the route and offers no create), and `docs/ketos/mvp-e2e.md` step B9.

## Related

- [Clone memory is one FTS5 store in clones.db, composed into the clone session scope and edited in the clone window](2026-09-22-ketos-stage-17-clone-memory.md) — the section/context split and the in-place refresh this decision records the cost of.
- [Clone methodology is four canonical sections, and clone skills are record objects registered into the agent's own skill-registry layer](2026-09-22-ketos-stage-18-clone-methodology-skills.md) — the fixed registered set for an agent's lifetime.
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.md) — the board's clone window, memory tab, and Known Limitations.
- [`packages/ketos/clone-core/README.md`](../../../../packages/ketos/clone-core/README.md) — the route, the clone session scope, and the Model Experience KV-cache statement.
- [`docs/ketos/mvp-e2e.md`](../../../../docs/ketos/mvp-e2e.md) — the acceptance scenario whose memory step names the agent as the writer.
