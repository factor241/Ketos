---
name: lint
description: Run deterministic integrity, provenance, projection, link, alias, operation, and secret checks over raytsystem. Use for LINT, health checks, pre-commit verification, stale projection diagnosis, broken evidence, or semantic review; never auto-fix canonical knowledge.
---

Run the RaytSystem lint workflow for the Ketos workspace. Read the
[canonical lint procedure](../../../raytsystem/skills/raytsystem-lint/SKILL.md)
and follow its read-only, validation, recovery, and escalation rules exactly.

Apply these mandatory project overrides to every CLI step:

- Invoke the globally installed CLI directly, never through uv.
- Use the absolute root `/Volumes/Projects/ketos_canvas_mod_main`.
- Never auto-fix or directly edit canonical knowledge.

Run:

1. `raytsystem agent preflight --skill raytsystem-lint --no-write --root /Volumes/Projects/ketos_canvas_mod_main --json`
2. `raytsystem lint --root /Volumes/Projects/ketos_canvas_mod_main --json`
3. Use `raytsystem lint --semantic --root /Volumes/Projects/ketos_canvas_mod_main --json` only to create review findings.
