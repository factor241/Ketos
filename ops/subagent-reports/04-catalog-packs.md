# Subagent 04 — Canonical RaytSystem skills and packs

## Status

DONE

The canonical RaytSystem procedures are installed under the Ketos root catalog. No commit was
created.

## Implemented scope

Added the nine verified core procedures:

- `skills/start/SKILL.md`
- `skills/graph/SKILL.md`
- `skills/raytsystem-ingest/SKILL.md`
- `skills/raytsystem-query/SKILL.md`
- `skills/raytsystem-lint/SKILL.md`
- `skills/raytsystem-save/SKILL.md`
- `skills/raytsystem-research/SKILL.md`
- `skills/raytsystem-run-review/SKILL.md`
- `skills/raytsystem-security-review/SKILL.md`

Added the media procedure and its available upstream references:

- `skills/raytsystem-watch/SKILL.md`
- `skills/raytsystem-watch/references/output-schema.md`
- `skills/raytsystem-watch/references/security-and-retention.md`
- `skills/raytsystem-watch/references/sources-and-modes.md`

Added two user-trusted, skill-only packs:

- `packs/raytsystem-core/pack.yaml`
  - pack ID: `pack_raytsystem_core`
  - nine core skills
  - `agent_ids: []`
  - no `agents/` directory
- `packs/raytsystem-media/pack.yaml`
  - pack ID: `pack_raytsystem_media`
  - only `raytsystem-watch`
  - `agent_ids: []`
  - no `agents/` directory

Added the focused regression test:

- `scripts/raytsystem-canonical-catalog.test.mjs`

Every procedure invokes the globally installed `raytsystem` executable and every documented CLI
command carries the explicit root `/Volumes/Projects/ketos_canvas_mod_main`. No procedure uses
`uv run raytsystem`.

## Ownership and status

The live `CatalogService` snapshot reports:

| Skill | Pack | test_status | enabled |
|---|---|---|---|
| `start` | `pack_raytsystem_core` | `pass` | true |
| `graph` | `pack_raytsystem_core` | `pass` | true |
| `raytsystem-ingest` | `pack_raytsystem_core` | `pass` | true |
| `raytsystem-lint` | `pack_raytsystem_core` | `pass` | true |
| `raytsystem-query` | `pack_raytsystem_core` | `pass` | true |
| `raytsystem-research` | `pack_raytsystem_core` | `pass` | true |
| `raytsystem-run-review` | `pack_raytsystem_core` | `pass` | true |
| `raytsystem-save` | `pack_raytsystem_core` | `pass` | true |
| `raytsystem-security-review` | `pack_raytsystem_core` | `pass` | true |
| `raytsystem-watch` | `pack_raytsystem_media` | `pending` | true |

Each canonical skill has exactly one pack owner. Existing `packs/software/**` agents and skills were
not changed or duplicated.

## TDD evidence

### RED

Command:

```text
node --test scripts/raytsystem-canonical-catalog.test.mjs
```

Initial result: `0 pass / 2 fail`.

Expected failures:

- `pack_raytsystem_core must exist`
- missing `skills/start/SKILL.md`

### GREEN

Command:

```text
node --test scripts/raytsystem-canonical-catalog.test.mjs
```

Result: `2 pass / 0 fail`.

The focused test loads the real catalog through the Python interpreter used by the global
RaytSystem installation. It checks pack trust, no agents, exact skill membership, no duplicate
ownership, frontmatter status/version, explicit root, global CLI use, and reference-path integrity.

## Verification

Combined adapter and catalog gate:

```text
node --test scripts/codex-skill-policy.test.mjs scripts/claude-skill-adapters.test.mjs scripts/raytsystem-canonical-catalog.test.mjs
```

Result: `8 pass / 0 fail`.

`quick_validate.py` from the installed Codex skill creator was run against an authoring-compatible
projection of all ten final skills: `10 valid / 0 invalid`. The projection keeps `name`,
`description`, and the complete body. RaytSystem-specific catalog extensions `version` and
`test_status` are validated by the real `CatalogService`; the generic Codex validator does not
allow those two top-level extension keys.

Read-only RaytSystem checks:

- `raytsystem lint --root /Volumes/Projects/ketos_canvas_mod_main --json`
  - `ok: true`
  - zero findings
- knowledge-scoped QUERY
  - returned the correct explicit evidence gap for the empty `genesis` generation
- catalog load
  - both new packs are `trust_class: user`
  - both have `agent_ids: []`
  - all ten skills are enabled and have the expected owner/status

## Honest limitations

`raytsystem-watch` remains `test_status: pending` for concrete reasons:

- missing executable dependencies: `ffprobe`, `ffmpeg`, `yt-dlp`;
- present dependency: `tesseract`;
- the upstream watch skill references absent `references/tool-contracts.md`;
- the upstream watch skill references absent `references/compatibility-report.md`.

The runtime Tool Hub does expose typed video contract schemas, but the missing reference contracts
and unqualified binaries prevent a truthful full watch PASS. The adapted skill permits only the
supplied-transcript path and otherwise stops with a typed blocker.

`raytsystem agent preflight` currently returns
`Preflight skill is not routed by AGENTS.md`. Updating `AGENTS.md` was explicitly outside this
subagent scope. This does not block the requested catalog implementation; it is an integration
check for the routing owner after the parallel wave is merged.

`raytsystem doctor` reports the disposable code graph as stale because parallel agents changed
three script inputs. The graph was intentionally not refreshed during this catalog-only wave.

The ignored nested `raytsystem/` checkout already had unrelated dirty files before this work and was
not edited. `.agents/`, `.claude/`, `config/`, `AGENTS.md`, `CLAUDE.md`, and existing
`packs/software/**` were not modified by this subagent.
