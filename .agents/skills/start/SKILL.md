---
name: start
description: Get raytsystem running here — install it if needed, then open the interface. Use for "start", "старт", "запусти", "install raytsystem", "подключить пространство", "открой интерфейс".
---

Get the existing Ketos RaytSystem workspace running. Talk to the user in their
language. The project root is
`/Volumes/Projects/ketos_canvas_mod_main`.

Use the [canonical start procedure](../../../raytsystem/skills/start/SKILL.md)
as the behavior reference. This repository is already bootstrapped, so do not
run bootstrap again. Invoke the globally installed CLI directly, never through
uv, and keep the absolute Ketos root on every command.

1. Run `raytsystem doctor --root /Volumes/Projects/ketos_canvas_mod_main --json`.
2. If the workspace is healthy, run `raytsystem start --root /Volumes/Projects/ketos_canvas_mod_main`.
3. The UI is loopback-only at `http://127.0.0.1:8765`.

Do not rerun bootstrap when config already exists. Never push, publish, upload,
enable an external runtime, or promote a real corpus without a separate
hash-bound approval.
