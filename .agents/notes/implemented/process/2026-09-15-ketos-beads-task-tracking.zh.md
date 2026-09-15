# Agent Note: Beads (bd) as the Ketos development task tracker

Status: implemented

[English](2026-09-15-ketos-beads-task-tracking.md) | 中文
## Problem

Ketos 的开发缺少机器可读的工作追踪器：阶段计划存放在仓库之外的 markdown 文件中，状态靠手工记录，智能体无法看到工作队列，也无法原子地认领任务。产品自带的 Beads 子系统（`@ketos/beads`，总计划的 Ф2）属于 MVP 之后的内容，而开发现在就需要追踪器。

## Decision

外部工具 `bd`（gastownhall/beads，Dolt 后端）已在仓库中初始化为开发追踪器，阶段计划被导入为依赖图：一个伞形 epic、21 个阶段 epic，以及承载阶段文件中清单任务与验收标准的子阶段任务；依赖关系把阶段与子阶段串成链条，阶段 0 以已关闭状态导入。

追踪器有意保持本地化：`.beads/` 位于主工作树，并通过 `.git/info/exclude` 排除在 git 之外（对 fork 安全——不影响上游同步，`git status` 保持干净）。仓库角色为 `maintainer`（`git config beads.role`）：缺少该配置时，bd 会把 HTTPS fork 视为 contributor，将写入导向 `~/.beads-planning`，并使本地数据库变为只读。不安装 git 钩子，因为仓库使用 `core.hooksPath = .git/dsh-hooks`（lefthook），`.git/hooks` 下的钩子本就会被忽略。所有阶段 worktree 共享主仓库中的同一个数据库，这是 bd 的标准 worktree 行为。

智能体集成：`AGENTS.md` 中的 beads 小节（压缩为指向 `bd prime` 的指针；AGENTS.md 的词数预算从 1950 提高到 2100）、`.agents/skills/beads/` 中的 `beads` 技能、`.codex/` 中的 Codex 原生钩子、运行 `bd prime --hook-json` 的全局 Claude Code SessionStart 钩子（`~/.claude/settings.json`；在 beads 工作区之外返回空上下文），以及描述模型、工作循环、阶段过渡流程与维护的 `docs/ketos/beads.md`。

## Alternatives considered

**现在就交付产品级 Beads 子系统。** 未采用：Ф2 属于 MVP 之后，需要独立的 SQLite 子系统；开发追踪器必须更早存在，且不能与产品记忆混在一起。

**把 `.beads/` 纳入 git 跟踪。** 未采用：数据库文件会进入 fork 历史并引发上游合并冲突；对单人开发者而言，本地模式加上 Dolt remote/backup 已经足够。

**使用 bd 生成的 AGENTS.md 完整配置块。** 未采用：在每个智能体会话中多出 736 个词（预算为 1950），并与 `bd prime` 重复；改为保留最小指针。

**安装 bd git 钩子。** 未采用：与 `core.hooksPath`/lefthook 冲突，并在提交时形成双重控制；bd 钩子（身份尾注）并非关键。

**使用项目级 Claude 钩子。** 未采用：`.claude/settings.json` 被 gitignore，永远不会出现在 worktree 中；全局钩子覆盖主仓库与 worktree。

## Consequences

工作通过 `bd ready` 选择、原子认领并按任务关闭；阶段过渡明确包含 `bd backup sync`、滞留认领检查、合并以及关闭阶段 epic，之后下一个 epic 会自动解除阻塞。本地数据库不受 git 覆盖——异机备份通过显式命令执行 `bd dolt push` 推送到 `refs/dolt/data`，而 bd 的自动备份写入内部 `.beads/backup`，外部目录仅在 `bd backup sync` 时刷新。`auto-commit=on` 下的 Dolt 历史增长通过周期性 `bd compact` 加以约束。`AGENTS.md` 小节与技能只有在提交到 `main` 之后才会进入阶段 worktree；在提交之前，bd 可从 worktree 使用，但智能体只能通过全局 Claude 钩子和 `bd prime` 了解到它。

## Related

- [Ketos repository home and stage worktrees](2026-09-14-ketos-repository-and-stage-worktrees.zh.md) — 追踪器所遵循的 worktree 政策。
- `docs/ketos/beads.md` — 模型、循环、过渡流程与维护。
