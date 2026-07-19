---
name: start
description: Get raytsystem running here — install it if needed, then open the interface. Use for "start", "старт", "запусти", "install raytsystem", "подключить пространство", "открой интерфейс".
---

## Mandatory execution boundary

**REQUIRED PRE-SKILL:** Read and follow `main-agent-tool-orchestration` before using this skill.

Only the main agent may use tools or execute this skill. Subagents must not call
any tool, invoke another skill, inspect or edit files, run commands or tests, or
perform review, research, or planning. A subagent receives a self-contained
implementation packet and may return only requested code or unified diff text.
If context is insufficient, it returns `BLOCKED: missing context`; the main agent
supplies context, applies changes, and verifies them.

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
