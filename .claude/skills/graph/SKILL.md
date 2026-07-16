---
name: graph
description: Refresh the raytsystem code graph so it reflects every current file. Use for "graph", "обнови граф", "перестрой граф", "update the graph".
---

Refresh only the narrow disposable RaytSystem graph configured for Ketos.
Graphify remains separate and unchanged.

Read the canonical procedure in `skills/graph/SKILL.md` and follow it exactly.
Use the global `raytsystem` executable directly.

1. Check freshness: `raytsystem graph status --root /Volumes/Projects/ketos_canvas_mod_main --json`.
2. Refresh: `raytsystem graph update --root /Volumes/Projects/ketos_canvas_mod_main --json`, or rebuild only if missing/corrupt.
3. Confirm `state` is `current` and report the counts.
