# Agent Note: Ketos MVP engineering policy (fork scope, coverage exceptions, process)

Status: implemented

[English](2026-09-15-ketos-mvp-engineering-policy.md) | 中文
## Problem

上游工程闸门——`packages/*/*/src` 的逐文件 100% 覆盖，以及每个非平凡变更都要有 Agent Note——在 Ketos 改名后继续有效，而 MVP 又引入了 fork 本地包（`@ketos/*`）、尚不存在的 clone 包，以及阶段 2–4 会重写的原始看板 GUI。若没有书面例外政策，每个阶段都要重新决定：是否为一次性 GUI 或尚未编写的包补逐文件测试。阶段 1 的基线把代价具体化了：`packages/client/ui-board/src` 的组件逐文件覆盖不达标（窗口、工具栏、指针清理为 0–50%），而 fork 范围的笼统豁免会悄悄漏掉已保持逐文件 100% 的 `@ketos/client-locale-ru`。

## Decision

Fork 本地代码保持上游的命名与打包纪律：新的 Ketos 包位于 `packages/ketos/`，命名为 `@ketos/<name>`，保持 `private: true`，内部 `@deepseek-ai/*` 标识不改动（[改名边界](../architecture/2026-09-13-ketos-rebranding-boundaries.zh.md)）。

覆盖例外是 `vitest.config.ts` 中狭窄、具名的配置项，每项都带 `MVP-fork coverage policy` 原因：

- `packages/client/ui-board/src/**` —— 原始看板 GUI 会在阶段 2–4 中被重写；逐文件覆盖会钉死一次性组件。
- `packages/ketos/clone-*/src/**` —— clone 包在阶段 15–19 才出现；在此之前该 glob 为空操作。

其他所有路径保持逐文件 100%，包括 `@ketos/client-locale-ru` 以及所有导入被排除包的那些包；ui-board 的 glob 覆盖该包的整个 `src` 树。当所属阶段落地其行为测试后移除例外，并在 MVP 验收（阶段 20）时复核。

强制测试集合为 §II.4 的 MVP 清单：纯数学（`zoomTowardPointer`、snap、小地图投影）、持久化（CAS 设置、`user_version`、`clones.db` CRUD）、槽与工具的注册/释放、Fetch 路由边界（错误码、校验），以及记忆行为（remember → search → 注入）。每个 CSS 类的测试、所有状态的截图、resize 压力测试不在范围内。

非平凡变更仍然必须有 Agent Note：它是项目跨阶段 worktree 的廉价记忆，也是阶段循环所依赖的证据（[阶段循环](2026-09-15-ketos-stage-cycle.zh.md)）。每个阶段的 Definition of Done 遵循 §II.4，阶段状态通过 `docs/ketos/` 中的阶段报告模板汇报。

## Alternatives considered

- **保留完整闸门并为看板编写逐文件测试**：否决——阶段 2–4 会替换这些组件，测试要写两遍，且 MVP 清单明确排除逐类 GUI 覆盖。
- **豁免整个 `packages/ketos/*`**：否决——ru 包已被完整测试并保持受闸；笼统规则会掩盖 fork 已经为其正确性付费的那个 Ketos 包的回归。
- **用逐分支 `/* v8 ignore */` 标记代替配置项**：否决——未覆盖的是整个组件与未来包，而不是不可达分支；ignore 标记会谎报原因。
- **为 MVP 速度放弃 Agent Note**：否决——阶段 worktree 循环依赖笔记在阶段间传递决策，而其成本是每个非平凡变更一个文件。

## Consequences

- 当看板 GUI 与尚未编写的 clone 包没有逐文件信号时，覆盖闸门仍可为绿；具名行为测试是补偿证据，而两个配置 glob 就是闸门跳过内容的完整可见清单。
- 在看板重写落地前，`pnpm run lint` 会因 `packages/client/ui-board` 中 17 个既有错误保持红色；它们记录在[基线问题](../../../../docs/ketos/baseline-issues.md)中，而不是在此修复。
- 未来的 Ketos 包默认受闸；若要移出，必须在其 Agent Note 中说明理由并添加具名配置项。

## Related

- [Ketos 改名边界](../architecture/2026-09-13-ketos-rebranding-boundaries.zh.md)
- [Ketos 阶段循环](2026-09-15-ketos-stage-cycle.zh.md)
- [Ketos 仓库与阶段 worktree](2026-09-14-ketos-repository-and-stage-worktrees.zh.md)
- [Ketos 用 Beads 跟踪任务](2026-09-15-ketos-beads-task-tracking.zh.md)
