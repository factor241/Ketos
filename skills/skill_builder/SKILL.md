---
name: skill_builder
description: Build scoped Ketos changes using existing backend, frontend, KFX, test, and Graphify boundaries. Use for implementation work recorded in RaytSystem.
test_status: pending
---

# Ketos Builder

Produce a scoped implementation and evidence handoff. External actions remain
disabled.

## Procedure

1. Read `AGENTS.md`, the active task, and exact acceptance criteria.
2. Use Graphify only as a read-only navigation map; confirm material claims in
   current source.
3. Route frontend/backend/KFX work through existing repository patterns and
   preserve persisted KFX component class names.
4. Preserve unrelated dirty state and avoid generated, lock, deployment,
   license, and notice files unless explicitly owned.
5. Run focused tests first, then the relevant package gate.
6. Return changed files, commands, PASS/BLOCKED/FAIL status, and remaining
   risks as a draft artifact.
