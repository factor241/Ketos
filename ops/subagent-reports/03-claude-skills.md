# Subagent 03 — Claude Code RaytSystem adapters

Status: **DONE**

## Scope

Implemented only the project Claude Code adapter layer under `.claude/skills`
plus its local structural test and this report. Existing `start` and `graph`
adapters were preserved unchanged.

Added adapters:

- `.claude/skills/ingest/SKILL.md`
- `.claude/skills/query/SKILL.md`
- `.claude/skills/lint/SKILL.md`
- `.claude/skills/save/SKILL.md`
- `.claude/skills/research/SKILL.md`
- `.claude/skills/run-review/SKILL.md`
- `.claude/skills/security-review/SKILL.md`
- `.claude/skills/watch/SKILL.md`

Each adapter:

- delegates to the future canonical root skill at
  `skills/raytsystem-<adapter>/SKILL.md`;
- treats imported, queried, reviewed, researched, or media content as untrusted
  data;
- requires the global `raytsystem` executable;
- requires explicit `--root /Volumes/Projects/ketos_canvas_mod_main`;
- does not contain or prescribe a project-Python-runner invocation.

## TDD evidence

Structural test:

- `scripts/claude-skill-adapters.test.mjs`

RED:

```text
node --test scripts/claude-skill-adapters.test.mjs
exit 1
2 tests failed because .claude/skills/ingest/SKILL.md did not exist
```

GREEN:

```text
node --test scripts/claude-skill-adapters.test.mjs
exit 0
tests 2, pass 2, fail 0
```

The test verifies all ten adapters, YAML frontmatter names/descriptions,
canonical root-skill delegation for the eight new adapters, the explicit Ketos
root, global CLI wording, and absence of the forbidden runner form.

## Additional verification

```text
raytsystem lint --root /Volumes/Projects/ketos_canvas_mod_main --json
exit 0
ok=true, findings=[]
```

`git diff -- .claude/skills/start/SKILL.md .claude/skills/graph/SKILL.md`
returned no diff.

The scoped forbidden-command search returned no matches in `.claude/skills`.

## Integration note

The current `.gitignore` ignores the entire `.claude` directory at line 284, so
the new adapter files do not appear in ordinary `git status`. This subtask did
not modify `.gitignore` because that path is outside its ownership. The parent
integration must either adjust the ignore policy in its own scope or add the
intended Claude adapter files explicitly.

## Wave 1 Important review fixes — 2026-07-17

Status: **DONE**

Implemented the review corrections inside the owned Claude adapter surface:

- The structural test now checks canonical targets for all ten adapters,
  including `skills/start/SKILL.md` and `skills/graph/SKILL.md`.
- `lint`, `query`, `research`, `run-review`, and `security-review` explicitly
  override their canonical preflight examples with `--no-write`; the test
  rejects `--write`.
- `watch` checks the five canonical reference paths and the allowlisted tool
  inventory from `raytsystem tool list --json` before treating execution as
  available.
- Any missing reference, typed tool, or `cli_dependencies` evidence returns
  `BLOCKED`; no ready watch execution command is advertised.

### TDD RED

```text
node --test scripts/codex-skill-policy.test.mjs scripts/claude-skill-adapters.test.mjs
exit 1
tests 10, pass 5, fail 5
Claude failures:
- start must delegate to skills/start/SKILL.md
- lint must include an agent preflight command
- watch must check canonical reference tool-contracts.md
```

### GREEN

```text
node --test scripts/claude-skill-adapters.test.mjs
exit 0
tests 4, pass 4, fail 0
```

```text
set -e
validator=/Users/kirillustuzanin/.codex/skills/.system/skill-creator/scripts/quick_validate.py
for skill in graph ingest lint query research run-review save security-review start watch; do
  uv run python "$validator" ".agents/skills/$skill" >/dev/null
  uv run python "$validator" ".claude/skills/$skill" >/dev/null
done
exit 0
20 adapter directories validated
```

```text
rg -n -- '--write' .claude/skills/{lint,query,research,run-review,security-review}/SKILL.md
exit 1
no matches
```

### WATCH readiness evidence

```text
raytsystem tool list --json
exit 0
tool_count=8
cli_dependencies=ffmpeg,ffprobe,tesseract,yt-dlp
```

Current canonical reference check:

```text
missing skills/raytsystem-watch/references/tool-contracts.md
missing skills/raytsystem-watch/references/compatibility-report.md
```

Therefore the current Claude WATCH readiness result is `BLOCKED` with exact
missing references, while the adapter/test implementation is complete.

No commit was created.
