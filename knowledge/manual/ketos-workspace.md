# Ketos workspace

[Back to the manual knowledge index](README.md)

This RaytSystem workspace is attached to the Ketos repository at
`/Volumes/Projects/ketos_canvas_mod_main`.

## Boundaries

- Graphify is the existing broad project graph and remains unchanged.
- RaytSystem maintains a separate disposable local graph for bounded query and
  impact analysis.
- Product documentation is indexed read-only.
- This `knowledge/manual` directory is the only writable Documents root.
- Canonical knowledge starts at the empty `genesis` generation. Project files
  are not promoted into canonical knowledge automatically.
- Runtime agents, external MCP execution, model execution, notifications,
  network exposure, publish, push, and external mutations are disabled.

## First commands

```bash
raytsystem doctor --root /Volumes/Projects/ketos_canvas_mod_main --json
raytsystem status --root /Volumes/Projects/ketos_canvas_mod_main --json
raytsystem graph status --root /Volumes/Projects/ketos_canvas_mod_main --json
raytsystem task list --root /Volumes/Projects/ketos_canvas_mod_main --json
raytsystem lint --root /Volumes/Projects/ketos_canvas_mod_main --json
```
