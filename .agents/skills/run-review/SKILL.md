---
name: run-review
description: Independently review a raytsystem run, diff, contract, test result, or milestone checkpoint and return structured findings. Use for REVIEW, architecture/contracts/data-integrity/test critique, gate verification, or pre-promotion review; remain read-only and separate from the writer context.
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

Run the RaytSystem review workflow for the Ketos workspace. Read the
[canonical run-review procedure](../../../raytsystem/skills/raytsystem-run-review/SKILL.md)
and follow its independent, evidence-backed, read-only contract exactly.

Apply these mandatory project overrides to every CLI step:

- Invoke the globally installed CLI directly, never through uv.
- Use the absolute root `/Volumes/Projects/ketos_canvas_mod_main`.
- Return PASS only when the declared evidence proves it; otherwise return
  ranked findings with exact references.
- Do not edit files, acquire writer leases, promote, or perform external actions.

Start with
`raytsystem agent preflight --skill raytsystem-run-review --no-write --root /Volumes/Projects/ketos_canvas_mod_main --json`.
