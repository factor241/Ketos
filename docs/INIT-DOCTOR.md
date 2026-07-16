# RaytSystem initialization doctor

Run:

```bash
raytsystem doctor --root /Volumes/Projects/ketos_canvas_mod_main --json
raytsystem graph status --root /Volumes/Projects/ketos_canvas_mod_main --json
raytsystem lint --root /Volumes/Projects/ketos_canvas_mod_main --json
```

The project-facing CLI is installed as an editable uv tool from the local
`raytsystem/` checkout. Do not run RaytSystem through the Ketos uv workspace.
