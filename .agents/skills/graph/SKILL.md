---
name: graph
description: Refresh the raytsystem code graph so it reflects every current file. Use for "graph", "обнови граф", "перестрой граф", "update the graph".
---

Refresh only the narrow disposable RaytSystem graph configured for Ketos.
Graphify remains a separate broad project graph and must not be modified.

Use the [canonical graph procedure](../../../raytsystem/skills/graph/SKILL.md)
as the behavior reference. Invoke the globally installed CLI directly, never
through uv, and keep the absolute Ketos root on every command.

1. Check freshness: `raytsystem graph status --root /Volumes/Projects/ketos_canvas_mod_main --json`.
2. Refresh: `raytsystem graph update --root /Volumes/Projects/ketos_canvas_mod_main --json`.
3. Use `raytsystem graph rebuild --root /Volumes/Projects/ketos_canvas_mod_main --json` only if the graph is missing or corrupt.
4. Confirm `state` is `current` and report the counts.
