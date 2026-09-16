# Agent Note: 看板窗口拥有 Harness 会话并重建聊天 composer

Status: implemented

[English](2026-09-16-ketos-board-window-sessions.md) | 中文

## Problem

阶段 4 交付的看板中，agent 窗口只是聊天的图画：静态问候 body、没有提交路径的文本框，以及命名了无人产生的「已学习」计数的标签。用户要求窗口承载真正的聊天——先是发送按钮，然后是主对话 composer 暴露的完整能力（工作目录、agent 预设、权限预设、模型与推理等级、`/` 命令、`@` 提及、附件、排队与引导、停止）。

主 composer 无法复用。`conversation.composer.bar` 是 `main.conversation` 声明的单占用单元；渲染器把每个 session 作用域槽位绑定到 `adapter.current`（= `sessions.list.current`）；不存在渲染期的绑定覆盖（`RenderOpts` 没有 session 参数）；feature 插件也不得运行时引入另一个 feature 插件的值。主计划对自家阶段 9 得出了同样结论（«Полный `ChatView` переиспользовать нельзя … схемы подмены scope у слотов нет»）。因此看板必须在同一批服务之上重建 composer——而它拥有的 root 作用域槽位并不会自动获得每窗口的响应式能力。

## Decision

**一个 apply 侧的桥拥有会话。** `packages/client/ui-board/src/client/session-bridge.ts` 保存 `windowId → sessionId` 映射，在窗口首次使用时执行 `sessions.create()` → `sessions.open(id)` → `binding(id)`，并订阅会话面（`running`）与对话目标（`uiConversation.binding(id).target('chat')`）。窗口渲染的一切都重新发布到每窗口一个身份稳定的 channel（`{ status, running, error, chat }`），因此组件各自只订阅一个 observable，store 不承载任何会话数据。

**一个 keyed hook 服务所有窗口。** `board.window.body` 获得带 `keyedHooks: { windowSession }`（键到 observable 的解析器）的注入面，以及普通回调（`ensureWindowSession`、`sendPrompt`、`cancelPrompt`、`loadOlderTurns`、`openInMainPanel`）。body 注册保留其按 `bodyKind` 的键与 owner props；窗口 id 是 `useWindowSession(windowId)` 的键参数，因此注册数量不随窗口数量增长。这是被认可的 observable 路径：插件绝不把源交给组件，组件也绝不调用 `useSyncExternalStore`。

**Composer 由看板拥有且完整。** `ComposerBar` 在窗口内重建了参考聊天栏：工作目录与 agent 预设芯片（两者仅在会话为空时可切换）、基于宿主命令目录的 `+` 操作菜单加上看板自有的图片附件条目、带参数提示与描述的 `/` 命令弹层、来自 `remote.fileReferences.list` 与 `remote.sessionReferenceResolver.candidates` 的 `@` 提及行、权限芯片（完全访问走 `RiskConfirmation`）、基于 `ctx.modelDirectories` 且带推理等级子菜单的模型芯片、计划芯片、来自 `contextPressure` 投影的上下文圆环、目标/待办/队列条，以及带排队或引导的发送/停止。Markdown 通过共享的 `MarkdownText` 渲染；车道把 `legacy.nodes` 折叠为用户／assistant 正文与单行工具行，`Open in the main panel`（`sessions.open` + `layout.selectPanel(null)`）仍是逃生口。模拟文案及其栖身字段（`BoardWindowState` 上的 `status`、`statusText`、`contextUsed`、`sessionId`）被删除，而不是留着不用。

**桥同时承载控制面。** 会话列表行（cwd、blank、agent 预设）、permissions/plan/todos/goal/contextPressure 投影、模型目录、命令目录、预设名册（经共享的 `@deepseek-ai/dsh-agent-presets/display` 折叠本地化）以及对话阻塞原因，都按窗口订阅一次并重新发布到同一 channel，因此栏只渲染普通数据，每次变更都经注入回调返回（`selectPermission` → `/permission`、`exitPlanMode` → `/plan off`、`runCommand`、`updateQueueItem`、`goalAction`、`pickWorkspace` → `uiWorkspace.pickDirectory()` + 重新创建会话、`selectModel`）。

**聚焦会改变当前会话。** 打开或聚焦窗口会调用 `sessions.open(id)`，因为实时事件流只存在于被选为当前的会话；这一全局副作用是有意接受的（计划记录了同样的取舍）。关闭窗口不会删除其会话。

## Alternatives considered

- **为每个窗口实例注册一个 body。** 否决：这会把 keyed 的 `WindowBodyKind` 域变成窗口 id，使注册数量随窗口数增长，并把实例数据搬进 owner props 已经覆盖的槽位键域。
- **在窗口内渲染真正的 `InputBar`/`ChatView`。** 被上述框架规则否决；到达它们的唯一受认可方式是导航，而窗口现在把导航作为显式动作提供。
- **把聊天快照放进看板 store。** 否决：业务数据属于对象层；store 还会在每个 chunk 上复制大快照。
- **让组件直接订阅 `binding(id).target('chat')`。** 否决：业务组件不持有订阅机制，而桥的每窗口一个订阅比每次渲染的观察者更便宜。
- **在 composer 完成前保留旧的模拟车道。** 否决：用户要求先要发送路径，而真实（即使精简）的车道正是让 composer 各状态有意义的前提。
- **复用真正的提交管线（`beginSubmission` 回显、提交偏好设置）。** 暂缓：看板用普通 `session.prompt` 发送，也不读取 `ui-conversation` 的偏好，因此 Enter 排队、Cmd/Ctrl+Enter 引导；待回显 UI 随附件／队列工作一起到来。
- **复用 `ui-attachment` 的组件或对话附件面。** 否决：`ComposerAttachments` 与草稿注册表是包内部实现（公开的 `IConversation` 面不含草稿动词），因此看板在组件状态中保存图片附件并以行内提示片段发送；非图片文件需要上传能力，暂不在范围内。
- **复用 `ui-commands` 的菜单或其客户端贡献。** 否决：第二个注册者无法在共享触发源上占用 `/`，也无法重复注册宿主命令，因此看板读取 `remote.commands.list()` 并自持菜单文案，执行仍走 `SessionFace.command`。
- **引入 `displayPermissionPreset`/`presetDisplayText`。** 按政策区分：`presetDisplayText` 是可内联的共享折叠，直接引入；权限标签助手属于 feature 插件的值，因此看板在自己的词典中拥有三个预设标签。

## Consequences

agent 窗口成为真正的聊天：它拥有会话，能流式接收回答、发送、引导、停止，并可移交给主面板。车道刻意比主转录更薄——没有确认或提问 UI（按计划改为导航）、没有附件、模型、权限或预设控件，工具结果折叠为名称加失败标记。测试中的会话替身必须预先添加，因为 `TestSessions.add()` 通过 `act` 稳定状态，而从窗口的挂载 effect 调用会嵌套 act 作用域；生产环境中的 `create()` 是一次远程往返。

验证：`packages/client/ui-board/tests/conversation-body.client.spec.tsx` 覆盖创建状态、失败状态、车道行、流式文本、发送、引导、停止、Shift+Enter 与三个入口；`tests/slots.client.spec.tsx` 用会话 bench 覆盖 body 切换与外框分发；`tests/fixtures.client.ts` 提供 bench（locale、sessions 替身、对话目标、layout），`apply.client.spec.tsx` 用它覆盖注册路径。`pnpm run test:gui` 为绿。

## Related

- [看板槽位组合](2026-09-15-ketos-board-slot-composition.zh.md) —— 本桥所依附的级联。
- [看板使用共享的 Harness 主题与控件](2026-09-15-ketos-board-harness-theme.zh.md) —— 本聊天所渲染的调色板与外框。
- [`docs/subsystems/conversation.md`](../../../../docs/subsystems/conversation.zh.md) —— `target('chat')` 快照来源的对话装配。
- [`packages/client/AGENTS.md`](../../../../packages/client/AGENTS.md) —— 本实现遵循的 inject-hooks 与订阅规则。
