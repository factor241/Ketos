---
name: research
description: Perform bounded source research for raytsystem and return provenance-rich evidence proposals without canonical writes. Use for RESEARCH, public fact gathering, source comparison, primary-source verification, or preparing evidence for a later INGEST; keep private corpus local unless scoped egress is approved.
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

Run the RaytSystem research workflow for the Ketos workspace. Read the
[canonical research procedure](../../../raytsystem/skills/raytsystem-research/SKILL.md)
and follow its provenance, egress, checkpoint, and stop conditions exactly.

Apply these mandatory project overrides to every CLI step:

- Invoke the globally installed CLI directly, never through uv.
- Use the absolute root `/Volumes/Projects/ketos_canvas_mod_main`.
- Keep canonical knowledge read-only and prefer primary or official sources.
- Do not send private corpus, PII, secrets, or local evidence externally
  without separately approved destination-bound egress.

Start with
`raytsystem agent preflight --skill raytsystem-research --no-write --root /Volumes/Projects/ketos_canvas_mod_main --json`.
