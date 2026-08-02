---
name: save
description: Stage a cited synthesis as a typed raytsystem DRAFT bundle and escaped preview. Use for SAVE, preserving a verified query answer, preparing a knowledge proposal, or creating a reviewable draft; never treat SAVE as canonical promotion or publication.
---

## Mandatory execution boundary

**REQUIRED PRE-SKILL:** Read and follow `main-agent-tool-orchestration` before using this skill.

Only the main agent may use tools or execute this skill. Subagents must not call
any tool or invoke another skill. Subagents may independently analyze supplied
code and context, review it, plan changes, and write code or unified diff text.
They must not inspect or edit the workspace directly, run commands or tests,
browse, or apply changes. If context is insufficient, they return
`BLOCKED: missing context`; the main agent supplies context, applies changes,
and verifies them.

Run the RaytSystem save workflow for the Ketos workspace. Read the
[canonical save procedure](../../../raytsystem/skills/raytsystem-save/SKILL.md)
and follow its evidence, idempotency, recovery, and draft-only rules exactly.

Apply these mandatory project overrides to every CLI step:

- Invoke the globally installed CLI directly, never through uv.
- Use the absolute root `/Volumes/Projects/ketos_canvas_mod_main`.
- Keep every result in DRAFT state; never promote, publish, push, or send it.

Run:

1. `raytsystem agent preflight --skill raytsystem-save --write --root /Volumes/Projects/ketos_canvas_mod_main --json`
2. `raytsystem save "SYNTHESIS" --title "TITLE" --evidence SEGMENT_ID --root /Volumes/Projects/ketos_canvas_mod_main --json`
