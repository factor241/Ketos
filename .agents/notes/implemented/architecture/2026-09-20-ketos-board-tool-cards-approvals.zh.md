# Agent Note: 看板窗口把工具调用渲染为卡片，并把待处理的审批导航到主面板

Status: implemented

[English](2026-09-20-ketos-board-tool-cards-approvals.md) | 中文

## 问题

阶段 4 与阶段 6 让看板车道为每次工具调用只给出一行——线上名称加上已完成、失败或运行中标记——因为窗口无法复用应用的工具体现方式：`ui-tool` 的 keyed `tool.call.toolview` 槽位是 `scope: 'session'`，而看板从根作用域渲染，在根作用域中组件对任意窗口没有会话绑定（渲染器只通过 `SessionProvider` 把会话作用域槽位绑定到*当前*会话）。feature-plugin 导出规则也禁止看板运行时导入 `ui-tool` 的卡片模型。`ui-primitives` 的完整块（`TerminalBlock`、`ReadBlock`、`DiffBlock`、`SearchBlock`、`WebBlock`、`JsonBlock`）是规则认可的共享表面，因此车道必须自行派生它们的 payload。

窗口还缺少另外两个事实。等待审批或提问的会话只在主面板渲染其应答 composer（`ui-approval` 与 `ui-user-questions` 注册进 `conversation.composer`），因此会话受阻的窗口什么都不显示，用户也无从得知有请求正在等待。窗口通道上的运行中调用投影只携带 `{ id, name }`，因此车道无法显示运行中调用的参数、开始时间或已用秒数。

## 决策

**看板在本地、按一张刻意收窄的表派生每张卡片。** `window/tool-card-model.ts` 把一个 `ToolCallBlock`——运行中的 `RunningToolCall` 或已落定的 `ToolResultNode`——折叠为恰好一个 `ui-primitives` 块所渲染的 payload，`window/ToolCard.tsx` 绘制该块以及卡片的状态行，`window/tool-card-labels.ts` 把看板词典绑定到各块的 label props。该表把 `bash`/`pwsh`/`terminal_send` 映射到 `TerminalBlock`，`read` 映射到 `ReadBlock`，`write`/`edit`/`str_replace_editor` 映射到 `DiffBlock`，`grep`/`glob` 映射到 `SearchBlock`，`web_search`/`web_fetch` 映射到 `WebBlock`，`read_image` 映射到经会话授权的图片预览，`todo_write` 映射到待办清单，`ask_user_question` 映射到已作答的提问转录，其余一切映射到折叠的 `JsonBlock`。这覆盖了 `ui-tool` 已发布的 keyed 视图（`bash`、`read`、`read_image`、`edit`、`write`、`grep`、`glob`、`web_search`、`web_fetch`、`todo_write`、`ask_user_question`），外加 `pwsh`/`terminal_send`——`ui-tool` 通过其通用卡片覆盖它们——再加 `str_replace_editor`，后者完全没有 keyed 视图：看板从调用自己的参数绘制它意图中的 hunk。每个读取器都校验自己的输入并返回 `null` 而不是抛错，因此半流式的 `argsRaw`、畸形的 `meta`，或落在已加载窗口之外的调用头，都会落到 JSON 块上，而不会让车道倒下。

**运行中的调用来自聊天快照，通道投影已删除。** 车道现在读取 `chat.legacy.runningCalls`——完整的 `RunningToolCall`，带有 `argsRaw`、`time` 及其子调用——因此运行中的卡片显示命令或意图中的差异以及它的已用秒数。`BoardRunningCall` 与 `BoardWindowSessionState.runningCalls` 已移除：车道是它们唯一的消费者，而第二份投影只会与派生它的聊天发生漂移。

**被取消的调用读作已停止，而不是失败。** 宿主为用户取消记录 `error: { name: 'AbortError', code: 'ABORTED' }`（在现场审计中观察到），聊天装配器为在回合边界仍未关闭的调用合成 `error: { name: 'Interrupted', code: 'interrupted' }`；卡片把这两个码都当作自己本地化的 `stopped` 状态，只有其他错误才是失败。

**待处理的交互通过根 hook 到达窗口，其动作是导航。** 窗口正文调用 `useSessionPendingInteraction`（由根 source `ui-session` 提供；它对每个作用域都经由 `PropsRuntime` 传递，正如 `ui-workspace` 消费它的方式，因此看板不注入任何 `uiSession` 服务），并在自己的会话持有值时为窗口显示横幅。横幅的按钮调用新注入的 `openInMainPanel(windowId)`，apply 将它实现为 `bridge.sessionFor(windowId)` → `ctx.uiWorkspace.openSession(sessionId)` → `store.expectReturnWindow(windowId)`。值待处理期间，窗口的 composer 保持惰性，并以横幅的标题作为其原因：同一状态既渲染横幅又阻止发送，因此二者不可能不一致。

**回到看板会把窗口带回来。** `BoardRoot` 读取 `usePanelInfo`，当看板面板（`BOARD_PANEL_ID`）处于活动状态且 `returnWindowId` 已设置时，居中该窗口、清除该标记，并设置 `highlightWindowId`；`WindowFrame` 为它绘制短暂的轮廓闪烁。MCP 面板 id 就是看板的 `main` 注册键，因此该检查只是一次身份比较，而不是字符串约定。

**审批只保留一个表面。** MVP 中窗口没有内联的审批或提问 UI：决定本身在主面板中作答，待处理的值在那里已经拥有一个 composer 条目，看板只指向那里并标记要返回的窗口。该选择记录在包 README 的「已知限制」中。

## 考虑过的替代方案

- **由车道渲染 `ui-tool` 的 keyed 视图。** 按设计不可能：该槽位需要会话作用域，而看板对任意窗口没有该作用域，且禁止运行时导入另一个 feature plugin 的值；在共享 primitives 上做看板本地派生是唯一能保持分层规则的路径。
- **把卡片模型抽取到共享包，让 `ui-tool` 与看板共同消费它。** 为 MVP 拒绝：看板的表有意比 `ui-tool` 的完整卡片表面更窄、更宽容（不处理持久 shell 的 spill、没有 `run_code` 正文、没有附件画廊），抽取会把那个表面拖进新包，并为一个消费者改变 `ui-tool` 的所有权归属，而阶段计划明确把看板表定位为它自己的映射。出现第二个真实消费者才会让抽取变得合理。
- **保留 `BoardRunningCall` 并用 `argsRaw`/`time` 扩展它。** 拒绝：该通道会镜像一个它并不拥有的聊天子结构；直接读快照保持单一来源并删掉一份投影。
- **通过 `ctx.conversation.blocks` 阻塞窗口 composer。** 拒绝：该注册表是插件侧让会话 composer 变惰性的方式，而待处理事实已经有一个根 source；从同一事实再升起第二个 block 会给该 block 一个窗口无法观察的所有者，而横幅的原因字符串才是诚实的占位。
- **在窗口内绘制内联审批面板。** 超出本阶段范围，且与主面板的应答 UI 重复；计划选择了导航路径，返回高亮让这段绕行代价很低。
- **立即自动聚焦发起窗口，而不是在返回时。** 拒绝：用户作答时正看着主面板，因此居中与闪烁只有看板回来时才有用；该 effect 以面板变为活动状态为键。

## 后果

车道现在显示调用做了什么，而不只是它发生过：内容、差异、搜索分组、引用与图片都用主对话所用的同一批块渲染，由看板词典本地化，且每个读不出的节点都有一个可预测的回退。工具窗口与恢复的布局继续工作——卡片是节点的纯函数，恢复的会话会重新派生每张卡片。看板的「已知限制」已重写：单行与「无指示」限制不复存在，取而代之的是已停止/失败/JSON 语义，以及已决定不存在内联审批表面。因为看板仍在逐文件覆盖率门槛之外（MVP fork 政策），卡片表由行为规格覆盖——每种块一个节点，以及运行中、不可用、失败、已停止、图片加载与被拒，还有 JSON 回退——整条路径已针对真实宿主工具现场验证。

验证：`tests/tool-card.client.spec.tsx` 覆盖映射表、每个读取器的拒绝路径与每张渲染出的卡片；`tests/conversation-body.client.spec.tsx` 覆盖运行中的卡片、向已停止的转换、待处理横幅及其受阻 composer 与导航，以及按类型的标题；`tests/store.client.spec.ts` 覆盖返回/高亮动作及其窗口存在性守卫；`tests/slots.client.spec.tsx` 在组合测试台中端到端证明升级路径（横幅 → `uiWorkspace.openSession` → 返回居中与高亮）。现场审计（`.playwright-mcp/stage-12-tools/audit/audit.json`，`ok: true`）用脚本化 SSE 模型驱动了真实的 `pnpm ketos web` 服务器：bash、read、grep、write、`todo_write`、一次失败的读取、一次被取消的调用，以及一次沙箱升级审批，全部从看板窗口执行，同一会话开在主面板中并显示相同的调用。

## 相关

- [看板窗口拥有 Harness 会话并重建聊天 composer](2026-09-16-ketos-board-window-sessions.zh.md) —— 卡片读取其节点所依据的通道与 bridge。
- [看板窗口恢复其 Harness 会话并与会话列表对账](2026-09-19-ketos-board-session-restore.zh.md) —— 为重新加载的窗口重新派生卡片的恢复路径。
- [`packages/client/AGENTS.md`](../../../../packages/client/AGENTS.md) —— 组件遵循的 feature plugin 取值规则与响应式读取阶梯。
- [`docs/ketos/reports/stage-12-tools-approvals.md`](../../../../docs/ketos/reports/stage-12-tools-approvals.md) —— 带现场运行证据的阶段报告。
