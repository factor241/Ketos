---
name: security-review
description: Audit raytsystem changes for prompt injection, provenance bypass, path/symlink/hardlink escape, secret leakage, stale fencing, partial promotion, unsafe parsing, and unapproved side effects. Use for SECURITY REVIEW, adversarial testing, recovery review, or approval-boundary validation; remain independent and read-only.
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

Run the RaytSystem security review workflow for the Ketos workspace. Read the
[canonical security-review procedure](../../../raytsystem/skills/raytsystem-security-review/SKILL.md)
and follow its threat model, fail-closed, evidence, and regression-test rules
exactly.

Apply these mandatory project overrides to every CLI step:

- Invoke the globally installed CLI directly, never through uv.
- Use the absolute root `/Volumes/Projects/ketos_canvas_mod_main`.
- Keep review read-only except for isolated synthetic tests within the approved
  scope; never disclose secret values.
- Stop on missing authority, unsafe egress, real promotion, or destructive action.

Start with
`raytsystem agent preflight --skill raytsystem-security-review --no-write --root /Volumes/Projects/ketos_canvas_mod_main --json`.
