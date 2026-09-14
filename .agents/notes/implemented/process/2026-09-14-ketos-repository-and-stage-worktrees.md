# Agent Note: Ketos repository home and stage worktrees

Status: implemented

English | [中文](2026-09-14-ketos-repository-and-stage-worktrees.zh.md)
## Problem

Stage 0 shipped from a checkout inside the upstream base (`/Volumes/Projects/deepseek-harness/forks/ketos`) on a feature-named branch inherited from the base repository. That placement kept the product's identity hidden inside its own base, and the branch name described the board spike rather than the deliverable. Nothing recorded how the remaining stages should isolate their work either: drafting several stages on one branch would mix unrelated changes in every review and make stage rollback impractical.

## Decision

The Ketos repository is a standalone checkout at `/Volumes/Projects/Ketos bot` with GitHub `factor241/Ketos` as `origin`, `deepseek-harness` as `upstream`, and the parent checkout as the `base` remote. Its single trunk is `main`; the inherited `feat/ketos-spatial-board` branch is retired (its content, the upstream base `d5675c2`, is fixed by the `ketos-base-d5675c2` tag and is an ancestor of `main`'s content).

Every stage from stage 1 onward runs in its own git worktree created from `main`:

```sh
cd "/Volumes/Projects/Ketos bot"
git worktree add "/Volumes/Projects/Ketos bot.worktrees/stage-02" -b stage-02-board-wiring main
```

The worktree directory and branch both carry the stage number and slug; the worktree is removed after the stage branch merges into `main`. A stage merges only after its acceptance criteria are green, so `main` advances at accepted stage boundaries and never carries two stages' unfinished work. Worktrees share the object store, so `pnpm` installs and client builds happen once per worktree without duplicating the repository.

## Alternatives considered

**Keep the checkout under the upstream base's `forks/` directory on the feature branch.** Lost: the product profile stayed hidden inside another repository's tree, and the branch name kept describing the board spike instead of the delivered stage.

**One long-lived branch per stage merged forward.** Lost: every later stage inherits earlier stages' in-flight changes, reviews mix stages, and a stage that fails acceptance cannot be dropped cleanly.

**A separate clone per stage.** Lost: duplicated installs, build artifacts, and snapshot harnesses for no isolation benefit — worktrees already isolate working trees while sharing one object store.

## Consequences

Stage work starts from a clean `main` in a dedicated directory; stage rollback is deleting a branch, not chasing shared history. Absolute paths in docs, scripts, and notes move from `/Volumes/Projects/deepseek-harness/forks/ketos` to `/Volumes/Projects/Ketos bot`. The repository move changes no git data (same volume rename), so remotes, tags, and the pnpm store keep working; only processes whose working directory pointed at the old path (dev servers, watchers) must restart. Worktree directories live beside the repository (`/Volumes/Projects/Ketos bot.worktrees/`) and are never committed.

## Related

- `docs/ketos/upstream-sync.md` — remotes, base tag, and the stage-worktree commands.
- [Ketos rebranding boundaries](../architecture/2026-09-13-ketos-rebranding-boundaries.md) — the product/internal naming boundary this repository layout serves.
