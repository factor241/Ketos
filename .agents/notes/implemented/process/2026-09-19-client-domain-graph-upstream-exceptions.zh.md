# Agent Note: Client domain graph: frozen upstream exceptions

Status: implemented

[English](2026-09-19-client-domain-graph-upstream-exceptions.md) | 中文
## 问题

`verify-client-domain-graph` 检查 `packages/client/*/src/client/` 的分层：领域只能导入 `contract/` 与顶层的共享模块，绝不相互导入；只有 `apply.ts`/`index.ts` 才能跨领域组装。上游导入早于该门禁，因此 `ui-sidebar-documentpreview`（21 处违规）与 `ui-conversation`（4 处）让从阶段 3 起的每个 Ketos 基线 `check:all` 持续变红（`ketos-bmz`）；阶段 5–10 还在属 fork 的 `ui-board` 中留下十处兄弟领域导入，且无人复查。

## 决定

每个包都保留严格规则。校验器新增显式的本地例外表 `UPSTREAM_LAYOUT_EXCEPTIONS`：`ui-conversation` 精确为 4，`ui-sidebar-documentpreview` 精确为 21，每个条目都带一行理由与跟踪 issue。条目只在计数精确相等时匹配：新增违规按违规失败，修复或清零的包按漂移失败，直到条目更新，因此例外无法掩盖代码变化。绿色输出会报告被豁免的计数。

`ui-board` 在严格规则下回到零违规：跨领域的共享模块从 `canvas/` 与 `window/` 移到包的顶层共享层——门禁本就允许任何领域导入该层——与 `store.ts`、`pointer-gesture.ts`、`open-window.ts` 并列。移动的文件为 `pan-gesture.ts`、`wheel-zoom.ts`、`culling.ts`、`window-screen.ts`、`HandleRing.tsx`（连同其 CSS Module）、`resize.ts`、`resize-gesture.ts`、`window-title.ts`、`chat-list-model.ts` 与 `dictation.tsx`；每个领域只保留自身特性的模块。

## 备选方案

**在 `contract/` 下重写这两个上游包。** 否决：fork 不维护上游文件，而上游同步会重新导入它们，重写会被回退或永久反复套用；修正应归于上游。

**完全跳过上游包。** 否决：门禁将不再观察 fork 仍在交付的二十五处导入，新的上游违规会无声通过；精确计数条目在同一范围内保留了失败信号。

**把 ui-board 加入例外表。** 否决：fork 拥有该包，这十处违规是回归而非继承的布局；阶段 3 曾清除过同一规则，例外会让新的看板代码无信号地破坏分层。

**把 ui-board 的跨领域模块移入 `contract/`。** 否决：`contract/` 承载槽位契约（类型与声明），而这些文件是运行时助手、hook 与一个组件；顶层共享层才是该包早已存放这类模块的位置。

## 后果

门禁在阶段基线上为绿，并对上游布局保留逐包计数检查：上游同步若改变任一计数，门禁会失败直到条目更新，属 fork 的包继续适用严格规则。`ui-board` 的共享层现在承载画布、窗口、dock 与 omnibox 领域共同导入的助手。该机制只存在于 `scripts/verify-client-domain-graph.ts`；分层规则本身未变。

## 测试

`scripts/verify-client-domain-graph.spec.ts` 覆盖划分逻辑：未豁免的失败、精确计数的豁免，以及新增与清零两种漂移。`pnpm exec vitest run packages/client/ui-board/tests`（26 个文件、298 个测试）在模块移动后通过，`pnpm run verify-client-domain-graph` 为绿，`pnpm run lint` 与 `pnpm run typecheck` 通过。

## 相关

- `docs/ketos/baseline-issues.md` —— 本记录关闭的基线问题记录。
- [Board gestures, culling, and the window-manager budgets](../architecture/2026-09-17-ketos-board-gestures-culling.zh.md) —— 移动的手势、裁剪与手柄环模块。
- [Board window chats panel](../architecture/2026-09-16-ketos-board-window-chats-panel.zh.md) —— 移动的聊天列表模型。
- [Chat window states and titles](../feature/2026-09-18-ketos-chat-window-states-titles.zh.md) —— 移动的标题与手柄环模块。
