---
name: save
description: Stage a cited synthesis as a typed raytsystem DRAFT bundle and escaped preview. Use for SAVE, preserving a verified query answer, preparing a knowledge proposal, or creating a reviewable draft; never treat SAVE as canonical promotion or publication.
---

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
