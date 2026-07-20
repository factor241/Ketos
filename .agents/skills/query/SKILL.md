---
name: query
description: Answer questions from the active raytsystem generation using local FTS5 retrieval, canonical record rehydration, verified source spans, and explicit gaps. Use for QUERY, knowledge lookup, comparison, relationship, temporal, or corpus questions; never answer factual gaps from model memory.
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

Run the RaytSystem query workflow for the Ketos workspace. Read the
[canonical query procedure](../../../raytsystem/skills/raytsystem-query/SKILL.md)
and follow its evidence, generation-binding, recovery, and gap rules exactly.

Apply these mandatory project overrides to every CLI step:

- Invoke the globally installed CLI directly, never through uv.
- Use the absolute root `/Volumes/Projects/ketos_canvas_mod_main`.
- Keep QUERY canonical-read-only and do not infer missing facts from memory.

Start with:

1. `raytsystem agent preflight --skill raytsystem-query --no-write --root /Volumes/Projects/ketos_canvas_mod_main --json`
2. `raytsystem status --root /Volumes/Projects/ketos_canvas_mod_main --json`
3. `raytsystem query "QUESTION" --limit 10 --root /Volumes/Projects/ketos_canvas_mod_main --json`
