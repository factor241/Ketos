# Agent Note: Unified stage cycle (worktree → acceptance → next worktree → main)

Status: implemented

[English](2026-09-15-ketos-stage-cycle.md) | 中文
## Problem

此前的 worktree 政策规定：阶段一旦通过验收，其分支就立即并入 `main`——`main` 每阶段前进一次，每次过渡都要重复合并与移除的流程，而且缺少一个由产品负责人对整个阶段进行验收的单一关口。负责人还希望有一个自主、统一、任何智能体都能对全部 21 个阶段一致执行的流程。

## Decision

阶段工作遵循一个统一循环，定义在计划 §II.4（«Процесс этапа»）中，并镜像到每个阶段文件：

- 每个阶段在自己的具名 worktree（`stage-NN-<slug>`）中执行，该 worktree 从上一阶段的已验收状态创建（阶段 1 从 `main` 创建），并在开工前完成准备（`pnpm install`、构建、基础门禁）。
- 阶段按标准提示词（«Исполни данный прикрепленный план с помощью субагентов и всех доступных инструментов»）自主执行：智能体研究计划、分解子任务、尽可能并行地使用子智能体、执行检查、测试与审计、修复发现的问题，并把阶段推进到完成状态，除需要用户决策外不中途停顿。
- 完成阶段：核对最终状态与验收标准、运行测试、把全部更改提交到阶段分支（worktree 保存阶段的最终状态），然后停下来向负责人提出唯一的问题：«Принимаете ли вы этап?»。在得到答复之前不开始下一阶段。
- 验收后，下一阶段的 worktree 会自动从已验收分支创建并准备（拉取当前状态；确认上一阶段已被计入——其 Beads epic 已关闭），负责人打开它并启动其计划。循环重复。
- 只有在所有阶段完成并通过验收后，结果才进入 `main`：各阶段分支构成一条链条，合并进 `main`，解决冲突，确认 `main` 包含所有阶段的结果，并直接在 `main` 中运行最终集成检查（测试与门禁）。
- worktree 保留至最终集成。

## Alternatives considered

**验收后逐阶段并入 `main`（此前政策）。** 未采用：`main` 在链条中途不断前进，每次过渡都要重复合并与移除，验收关口失去单一的产品级含义，最终集成的叙述也变得含糊。

**每个阶段都从 `main` 独立开分支。** 未采用：阶段之间存在依赖，独立分支会持续冲突；计划本身是严格串行的。

**所有阶段共用一个 worktree。** 未采用：会在同一个工作树中混合多个阶段，为仓库政策所禁止。

## Consequences

在最终集成之前，`main` 保持在阶段 0 的基础上；累积结果位于阶段分支链条上。过渡流程（关闭 Beads epic、准备下一阶段的 worktree）与验收问题的作用在所有阶段计划、`docs/ketos/beads.md` 和 `docs/ketos/upstream-sync.md` 中保持一致。本记录修订了 2026-09-14 仓库/worktree 记录的合并政策；worktree 隔离规则本身不变。

## Related

- [Ketos repository home and stage worktrees](2026-09-14-ketos-repository-and-stage-worktrees.zh.md) — 本记录保留的仓库布局与 worktree 隔离。
- `docs/ketos/beads.md` — 追踪器工作流与过渡流程。
- `docs/ketos/upstream-sync.md` — worktree 命令与上游节奏。
