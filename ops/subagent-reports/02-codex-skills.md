# Subagent 02 — Codex skills

Status: DONE

## Scope

Changed only the project-local Codex skill surface, its policy test, and this
report:

- `.agents/skills/start/SKILL.md`
- `.agents/skills/graph/SKILL.md`
- `.agents/skills/ingest/SKILL.md`
- `.agents/skills/query/SKILL.md`
- `.agents/skills/lint/SKILL.md`
- `.agents/skills/save/SKILL.md`
- `.agents/skills/research/SKILL.md`
- `.agents/skills/run-review/SKILL.md`
- `.agents/skills/security-review/SKILL.md`
- `.agents/skills/watch/SKILL.md`
- `scripts/codex-skill-policy.test.mjs`
- `ops/subagent-reports/02-codex-skills.md`

The six existing Ketos skills were preserved unchanged. No `.claude`, root
`skills/`, packs, config, `AGENTS.md`, `CLAUDE.md`, or nested RaytSystem files
were modified.

## Implementation

- Added the ten approved RaytSystem adapters beside the six Ketos skills.
- Linked every adapter to its canonical procedure under
  `raytsystem/skills/`.
- Required the globally installed `raytsystem` executable and the explicit
  root `/Volumes/Projects/ketos_canvas_mod_main` for every adapter CLI command.
- Prohibited invoking RaytSystem through uv.
- Kept Graphify separate from the disposable RaytSystem code graph.
- Extended the policy gate to enforce:
  - the exact 16-skill union;
  - valid frontmatter and unique declared skill names;
  - exact, existing canonical procedure links;
  - at least one direct global RaytSystem command per adapter;
  - the explicit absolute root on every such command;
  - absence of the forbidden uv launcher form.

## TDD evidence

1. Baseline RED before implementation:
   `node --test scripts/codex-skill-policy.test.mjs` failed because the old
   six-skill policy found the new `start` and `graph` directories.
2. Expanded policy RED before adapter implementation:
   the same command reported 4 failing tests for the missing eight adapters,
   missing canonical links, and command policy.
3. GREEN after implementation:
   `node --test scripts/codex-skill-policy.test.mjs` passed 4/4.

## Additional verification

- Skill validation:
  `uv run python /Users/kirillustuzanin/.codex/skills/.system/skill-creator/scripts/quick_validate.py`
  passed for all ten adapters.
- Global CLI discovery:
  `/Users/kirillustuzanin/.local/bin/raytsystem`.
- Read-only CLI help checks passed for the root command, `agent preflight`,
  `tool watch`, `query`, `lint`, `save`, `graph status`, `graph update`,
  `graph rebuild`, and `start`.

No commit was created.

## Wave 1 Important review fixes — 2026-07-17

Status: DONE

Implemented the review corrections without changing root skills, packs, config,
repository instructions, or nested RaytSystem:

- `lint`, `query`, `research`, `run-review`, and `security-review` now use
  explicit `--no-write` agent preflight commands.
- The policy test rejects a read-only preflight containing `--write`.
- `watch` checks all canonical required reference paths first, then runs the
  rootless inventory command `raytsystem tool list --json` and inspects
  `cli_dependencies`.
- Missing references, typed tools, or allowlisted dependency evidence now
  produce `BLOCKED`; the adapter no longer advertises a ready watch execution
  command.
- `raytsystem tool list --json` is the only rootless CLI exception because the
  installed command rejects `--root`.

### TDD RED

```text
node --test scripts/codex-skill-policy.test.mjs scripts/claude-skill-adapters.test.mjs
exit 1
tests 10, pass 5, fail 5
Codex failures:
- lint preflight must explicitly remain no-write
- watch must check canonical reference tool-contracts.md
```

### GREEN

```text
node --test scripts/codex-skill-policy.test.mjs
exit 0
tests 6, pass 6, fail 0
```

```text
set -e
for skill in lint query research run-review security-review; do
  raytsystem agent preflight --skill "raytsystem-$skill" --no-write --root /Volumes/Projects/ketos_canvas_mod_main --json >/dev/null
done
exit 0
```

```text
rg -n -- '--write' .agents/skills/{lint,query,research,run-review,security-review}/SKILL.md
exit 1
no matches
```

### WATCH readiness evidence

```text
raytsystem tool list --json
exit 0
tool_count=8
tool_ids=video.probe,video.download,video.transcript,video.extract_audio,video.extract_frames,video.ocr_frames,video.inspect_frames,video.summarize_timeline
cli_dependencies=ffmpeg,ffprobe,tesseract,yt-dlp
```

Current canonical reference check:

```text
missing raytsystem/skills/raytsystem-watch/references/tool-contracts.md
missing raytsystem/skills/raytsystem-watch/references/compatibility-report.md
```

Therefore the current Codex WATCH readiness result is `BLOCKED` with exact
missing references, while the adapter/policy implementation is complete.

No commit was created.
