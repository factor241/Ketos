# Agent Note: Ketos repository home and stage worktrees

Status: implemented

[English](2026-09-14-ketos-repository-and-stage-worktrees.md) | 中文
## Problem

阶段 0 的交付发生在上游基线内部的检出目录（`/Volumes/Projects/deepseek-harness/forks/ketos`），分支名继承自基线仓库的功能分支。该位置把产品身份藏在自身基线之内，分支名描述的是看板原型而非交付物；也没有任何记录说明后续阶段应如何隔离各自的工作——在同一分支上并行起草多个阶段会让每次评审混入不相关的改动，并使阶段回滚变得不现实。

## Decision

Ketos 仓库是位于 `/Volumes/Projects/Ketos bot` 的独立检出，GitHub `factor241/Ketos` 为 `origin`，`deepseek-harness` 为 `upstream`，父检出作为 `base` remote。其唯一主干是 `main`；继承来的 `feat/ketos-spatial-board` 分支已退役（其内容即上游基线 `d5675c2`，由 `ketos-base-d5675c2` 标签固定；浅克隆经过重新导入，因此基线的树包含在 `main` 的历史中，而不是通过祖先遍历可达）。

从阶段 1 起，每个阶段都在从 `main` 创建的独立 git worktree 中进行：

```sh
cd "/Volumes/Projects/Ketos bot"
git worktree add "/Volumes/Projects/Ketos bot.worktrees/stage-02" -b stage-02-board-wiring main
```

worktree 目录与分支都带阶段编号和 slug；阶段分支合入 `main` 后删除该 worktree。阶段只有在其验收标准全部通过后才合入，因此 `main` 只在已验收的阶段边界前进，绝不同时携带两个阶段未完成的工作。worktree 共享对象库，因此每个 worktree 的 `pnpm` 安装与客户端构建只需一次，不重复复制仓库。

## Alternatives considered

**把检出保留在上游基线的 `forks/` 目录与功能分支上。** 未采用：产品档案藏在另一个仓库的树里，分支名继续描述看板原型而非交付的阶段。

**每个阶段一条长期分支并向前合并。** 未采用：后续阶段会继承前面阶段仍在飞行中的改动，评审混杂多个阶段，且某个阶段验收失败时无法干净地丢弃。

**每个阶段一个独立克隆。** 未采用：重复的安装、构建产物与快照测试框架换不来任何隔离收益——worktree 已经隔离工作树并共享同一对象库。

## Consequences

阶段工作从干净的 `main` 与专属目录开始；阶段回滚是删分支，而不是在共享历史里追改。文档、脚本与笔记中的绝对路径从 `/Volumes/Projects/deepseek-harness/forks/ketos` 迁移到 `/Volumes/Projects/Ketos bot`。仓库移动不改变任何 git 数据（同卷重命名），remote、标签与 pnpm store 继续可用；只有工作目录指向旧路径的进程（dev server、watcher）需要重启。worktree 目录位于仓库旁（`/Volumes/Projects/Ketos bot.worktrees/`），永不提交。

## Related

- `docs/ketos/upstream-sync.md` — remote、基线标签与阶段 worktree 命令。
- [Ketos rebranding boundaries](../architecture/2026-09-13-ketos-rebranding-boundaries.zh.md) — 本仓库布局所服务的产品/内部命名边界。
