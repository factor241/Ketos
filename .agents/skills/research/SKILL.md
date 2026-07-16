---
name: research
description: Perform bounded source research for raytsystem and return provenance-rich evidence proposals without canonical writes. Use for RESEARCH, public fact gathering, source comparison, primary-source verification, or preparing evidence for a later INGEST; keep private corpus local unless scoped egress is approved.
---

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
