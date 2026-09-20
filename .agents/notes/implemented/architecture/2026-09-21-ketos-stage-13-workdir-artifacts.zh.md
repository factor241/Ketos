# Agent Note: 看板窗口从工具结果派生会话产物，并将运行时状态与工作区路径隔离

Status: implemented

[English](2026-09-21-ketos-stage-13-workdir-artifacts.md) | 中文

## 问题

Ketos 会话运行在创建时固定的专属工作目录中，但用户在看板上既无法查看聊天的当前工作目录，也无法查看会话期间创建或修改的文件。早期的 composer 控件包含了文件夹芯片，这不仅挤占了提示词起草空间，还造成了可在会话中途更改工作目录的错误暗示。此外，看板缺乏呈现工具操作所产生文件的机制，而原始文件系统浏览又仅限于侧边栏。

另外还存在关键的隔离风险：用户或自动化工具可能无意中将 Ketos 运行时主目录（`~/.ketos` 或 `$DSH_HOME`）选择或注册为活动工作区目录，从而使提示词操作或命令执行破坏运行时数据库（`board.db`、`settings.yaml`、会话日志）。同时，选择危险路径（如文件系统根目录 `/`、`C:\` 或整个用户主目录 `~`）缺乏客户端警告或确认守卫。

## 决策

**工作目录展示与项目快捷动作全部收拢至聊天面板。** 面板的聊天层现在显示活动项目的路径，并提供专用动作：复制路径（`panel-copy-path`）以及通过现有的 `session.openWorkspacePath` 路由在系统文件管理器中打开或定位文件夹（`panel-open-folder`）。composer 不变性得到永久执行：`ComposerBar` 中绝不渲染任何工作区或文件夹芯片。

**会话产物动态派生自已落定的工具结果，无需扫描文件系统。** `window/artifacts-model.ts` 检查会话聊天快照中已落定的工具结果，识别来自 `write`、`edit`、`str_replace_editor` 和 `read` 操作（包括子调用）的文件交互，同时忽略失败的调用（`isError`）。产物按规范化路径去重并遵循修改优先规则：写入/编辑操作（`created`、`modified`）优先于被动读取操作（`read`），保留修改标签并将时间戳更新为最新交互时间。

**产物呈现在专用的面板选项卡与对话摘要条中。** 聊天面板现在提供了分段选项卡控件（`[Chats]` 和 `[Artifacts]`）、第 5 个导轨操作按钮（`panel-rail-artifacts`）以及包含空状态提示、标签（带有 `data-board-artifact-kind` 的 `Tag`）和复制路径或在文件管理器中定位的快捷动作的完整产物列表。`ConversationBody` 中位于 composer 上方设有非侵入式的产物摘要条，显示产物数量并可直接切换进入产物面板选项卡。

**宿主与客户端严格隔离 `~/.ketos` 并对根路径发出警告。** 在宿主侧，`workspace-controller` 使用 `fs.realpath` 规范化候选路径，并使用 `RemoteError('workspace/invalid-path', ...)` 拒绝等于或位于 `$DSH_HOME`、`~/.ketos` 或 `~/.dsh` 之内的任何路径。在客户端侧，`validateWorkspacePath` 针对已知主目录和 DSH 根目录执行同步路径检查，对违规路径抛出本地化词典错误（`panel.error.ketosHome`），并在接受文件系统根目录或用户主目录之前提示确认（`panel.warn.dangerousPath`）。

## 考虑过的替代方案

- **在宿主侧扫描文件系统以列生产物。** 拒绝：文件系统扫描开销大、与后台工具竞争、捕获无关的未跟踪文件，并且在客户端看板查看远程会话的远程或沙箱部署中失效。纯粹从会话日志中已落定的工具调用派生保证了对模型实际工作的 100% 真实反映。
- **将文件夹芯片恢复到 composer 栏。** 拒绝：会话工作目录创建后不可变；在 composer 中放置文件夹选择器或芯片会产生错误的交互暗示并浪费有限的输入空间。
- **在看板窗口中提供完整的交互式文件管理器。** 拒绝：超出 MVP 范围；完整的文件浏览、文件查看和目录树探索已存在于 `ui-sidebar-files` 中。看板窗口专注于带有路径复制和系统定位功能的已触碰产物整洁列表。
- **仅在客户端硬编码路径检查。** 拒绝：恶意或直接的 RPC 调用可能会绕过客户端 UI；安全隔离需要宿主侧结合 realpath 规范化的强制执行，并由客户端友好的预校验作为补充。

## 后果

用户可以立即看到 agent 正在哪个项目文件夹中工作，复制其路径，或在操作系统文件管理器中将其打开。生成的产物在生成时即被跟踪并呈现在产物选项卡和对话条中，无需翻阅长篇聊天记录即可快速访问。尝试将 `~/.ketos` 或 `$DSH_HOME` 作为目标会在宿主和客户端两端被清晰拦截，防止意外损坏运行时状态。

验证：`tests/artifacts-model.client.spec.ts` 验证工具节点提取、修改优先、去重和子调用处理；`tests/path-validation.client.spec.ts` 验证客户端校验和警告触发；`tests/window-chats-panel.client.spec.tsx` 验证项目路径展示、快捷动作、选项卡切换、导轨与摘要条触发以及文件夹拦截；`packages/api/workspace-controller/tests/workspace-controller.host.spec.ts` 证明宿主对 `$DSH_HOME` 和 `~/.ketos` 的拒绝；`tests/composer.client.spec.tsx` 验证 composer 不变性。

## 相关

- [看板窗口在可缩放侧面板中管理工作区与聊天](2026-09-16-ketos-board-window-chats-panel.zh.md) —— 聊天面板布局与文件夹浏览器基础。
- [看板窗口把工具调用渲染为卡片，并把待处理的审批导航到主面板](2026-09-20-ketos-board-tool-cards-approvals.zh.md) —— 派生产物所依据的已落定工具节点。
- [`packages/client/ui-board/README.zh.md`](../../../../packages/client/ui-board/README.zh.md) —— 涵盖工作区文件夹与产物限制的包文档。
- [`packages/api/workspace-controller/README.zh.md`](../../../../packages/api/workspace-controller/README.zh.md) —— 工作区控制器命令与路径校验契约。
