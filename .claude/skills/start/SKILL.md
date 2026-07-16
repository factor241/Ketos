---
name: start
description: Get raytsystem running here — install it if needed, then open the interface. Use for "start", "старт", "запусти", "install raytsystem", "подключить пространство", "открой интерфейс".
---

Get the existing Ketos RaytSystem workspace running. The project root is
`/Volumes/Projects/ketos_canvas_mod_main`.

Read the canonical procedure in `skills/start/SKILL.md` and follow it exactly.
Use the global `raytsystem` executable directly.

1. Run `raytsystem doctor --root /Volumes/Projects/ketos_canvas_mod_main --json`.
2. Launch with `raytsystem start --root /Volumes/Projects/ketos_canvas_mod_main`.
3. Use the loopback-only UI at `http://127.0.0.1:8765`.

Do not rerun bootstrap. Never push, publish, upload, enable an external runtime,
or promote a real corpus without separate approval.
