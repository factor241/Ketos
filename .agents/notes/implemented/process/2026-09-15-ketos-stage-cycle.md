# Agent Note: Unified stage cycle (worktree → acceptance → next worktree → main)

Status: implemented

English | [中文](2026-09-15-ketos-stage-cycle.zh.md)
## Problem

The earlier worktree policy merged every stage branch into `main` as soon as the stage passed acceptance: `main` advanced once per stage, each transition repeated the merge/removal dance, and there was no single gate where the product owner accepted a stage as a whole. The owner also wants one autonomous, uniform execution flow that any agent follows identically for all 21 stages.

## Decision

Stage work follows one cycle, defined in plan §II.4 («Процесс этапа») and mirrored in every stage file:

- Each stage runs in its own named worktree (`stage-NN-<slug>`), created from the accepted state of the previous stage (stage 1 from `main`) and prepared before work starts (`pnpm install`, build, base gates).
- The stage is executed autonomously from the standard prompt («Исполни данный прикрепленный план с помощью субагентов и всех доступных инструментов»): the agent studies the plan, decomposes subtasks, uses subagents (in parallel where possible), runs checks, testing, and audit, fixes findings, and drives the stage to completion without pausing for manual intervention unless a user decision is required.
- Completion: verify the final state and acceptance criteria, run tests, commit all changes on the stage branch (the worktree holds the stage's final state), then stop and ask the owner exactly one question: «Принимаете ли вы этап?». The next stage does not start before the answer.
- On acceptance the next stage's worktree is created and prepared automatically from the accepted branch (pull the current state; confirm the previous stage is accounted for — its Beads epic is closed), and the owner opens it and launches its plan. The cycle repeats.
- Results reach `main` only after all stages are finished and accepted: the stage branches form a chain, are merged into `main`, conflicts are resolved, `main` is verified to contain every stage's results, and the final integration checks (tests and gates) run directly in `main`.
- Worktrees are preserved until the final integration.

## Alternatives considered

**Merge each stage into `main` on acceptance (previous policy).** Lost: `main` advances mid-chain, every transition repeats merges and removals, the acceptance gate loses its single product-level meaning, and the final integration story stays implicit.

**Branch every stage independently from `main`.** Lost: stages build on each other, so parallel branches would conflict constantly; the plan is explicitly sequential.

**Run all stages in one worktree.** Lost: mixing stages in one working tree, which the repository policy forbids.

## Consequences

`main` stays at the stage-0 base until the final integration; accumulated results live on the stage-branch chain. The transition procedure (Beads epic close, next worktree preparation) and the role of the acceptance question are consistent across all stage plans, `docs/ketos/beads.md`, and `docs/ketos/upstream-sync.md`. This note revises the merge policy of the 2026-09-14 repository/worktree note; the worktree isolation rule itself is unchanged.

## Related

- [Ketos repository home and stage worktrees](2026-09-14-ketos-repository-and-stage-worktrees.md) — repository layout and worktree isolation this note keeps.
- `docs/ketos/beads.md` — tracker workflow and the transition procedure.
- `docs/ketos/upstream-sync.md` — worktree commands and upstream rhythm.
