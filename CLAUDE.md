# CLAUDE.md

@AGENTS.md
@.claude/CLAUDE.md

This project uses [AGENTS.md](https://agents.md/) as the standard for providing context to AI coding agents. The `@AGENTS.md` import above tells Claude Code to load `AGENTS.md` automatically; other tools that natively support `AGENTS.md` will pick it up directly. The `@.claude/CLAUDE.md` import loads the local hard-rules file (gitignored) that mirrors the PostToolUse hook policy.

<!-- RAYTSYSTEM:BEGIN -->
# raytsystem - Claude Code entry point

Read `AGENTS.md` and `WORK.md`. Use the global `raytsystem` command with
`--root /Volumes/Projects/ketos_canvas_mod_main`; do not run it through the
Ketos uv workspace. Graphify remains separate and unchanged. Never edit
`_raw/`, ledger generations, generated knowledge, or `.raytsystem/` directly;
external actions stay draft-only until separately approved.
<!-- RAYTSYSTEM:END -->
