# Agent Note: Beads (bd) as the Ketos development task tracker

Status: implemented

English | [中文](2026-09-15-ketos-beads-task-tracking.zh.md)
## Problem

Ketos development had no machine-readable work tracker: the stage plan lives in markdown files outside the repository, statuses were recorded by hand, and agents could not see the work queue or claim tasks atomically. The product's own Beads subsystem (`@ketos/beads`, Ф2 of the master plan) is post-MVP, while development needs a tracker now.

## Decision

The external `bd` tool (gastownhall/beads, Dolt backend) is initialized in the repository as the development tracker, and the stage plan is imported into it as a dependency graph: one umbrella epic, 21 stage epics, and substage tasks carrying the checklist tasks and acceptance criteria from the stage files; dependencies chain stages and substages, and stage 0 is imported closed.

The tracker is deliberately local: `.beads/` lives in the main working tree and is excluded from git via `.git/info/exclude` (fork-safe — upstream synchronization is unaffected and `git status` stays clean). The repository role is `maintainer` (`git config beads.role`): without it, bd treats the HTTPS fork as a contributor, routes writes to `~/.beads-planning`, and makes the local database read-only. Git hooks are not installed because the repository runs `core.hooksPath = .git/dsh-hooks` (lefthook) and hooks under `.git/hooks` would be ignored anyway. All stage worktrees share the single database from the main repository, which is bd's standard worktree behavior.

Agent integrations: a beads section in `AGENTS.md` (condensed to a pointer at `bd prime`; the AGENTS.md word budget is raised from 1950 to 2100), the `beads` skill in `.agents/skills/beads/`, Codex native hooks in `.codex/`, a global Claude Code SessionStart hook running `bd prime --hook-json` (`~/.claude/settings.json`; outside a beads workspace it returns an empty context), and `docs/ketos/beads.md` describing the model, the working cycle, the stage-transition procedure, and maintenance.

## Alternatives considered

**Ship the product Beads subsystem now.** Lost: Ф2 is post-MVP and needs its own SQLite subsystem; the development tracker must exist earlier and must not mix with product memory.

**Tracked `.beads/` in git.** Lost: database files in fork history and upstream-merge conflicts; a local mode with Dolt remote/backup is enough for a single developer.

**The full bd-managed AGENTS.md profile.** Lost: +736 words in every agent session against a 1950-word budget and duplication of `bd prime`; a minimal pointer is kept instead.

**bd git hooks.** Lost: conflict with `core.hooksPath`/lefthook and double commit-time control; bd hooks (identity trailers) are not critical.

**A project-scoped Claude hook.** Lost: `.claude/settings.json` is gitignored and never appears in worktrees; the global hook covers main and worktrees.

## Consequences

Work is selected through `bd ready`, claimed atomically, and closed per task; the stage transition explicitly includes `bd backup sync`, a stale-claim check, the merge, and closing the stage epic, after which the next epic unblocks automatically. The local database is not covered by git — off-machine backup uses `bd dolt push` to `refs/dolt/data` on explicit command, while bd's automatic backup writes to the internal `.beads/backup` and the external directory is refreshed only by `bd backup sync`. Dolt history growth under `auto-commit=on` is bounded by periodic `bd compact`. The `AGENTS.md` section and the skill only reach stage worktrees after being committed on `main`; before that commit bd works from worktrees but agents learn about it only through the global Claude hook and `bd prime`.

## Related

- [Ketos repository home and stage worktrees](2026-09-14-ketos-repository-and-stage-worktrees.md) — the worktree policy the tracker follows.
- `docs/ketos/beads.md` — model, cycle, transition procedure, and maintenance.
