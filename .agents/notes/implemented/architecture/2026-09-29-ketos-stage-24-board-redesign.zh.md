# Agent Note: Ketos stage 24: the board's bottom dock, interface modes, and per-window panels

Status: implemented

[English](2026-09-29-ketos-stage-24-board-redesign.md) | 中文

## Problem

空间看板上的外观已不再符合它的角色：每个窗口上有一条垂直导轨，画布上有一个 omni bar，所有窗口共用一个全局聊天面板，还有仅看板可用的全屏模式、嵌在外壳里的全屏看板，以及一个与产品所需界面开关相竞争的侧栏条目。2026-09-29 与用户商定的三项要求是：类似 macOS 的底部 dock、在看板与标准界面之间切换的单一开关，以及每个窗口两个镜像标准界面「工作文件夹」与右面板的面板。标准界面自身的界面无法再挂载一次：`WorkspaceBrowser` 的 owner 份额、全局导航、单一视图 store 与目录流硬编码孔位都阻止第二个实例，而 `ui-sidebar-right` 是单实例列，其页签槽位只声明一次，且其会话作用域始终是应用的当前会话。

## Decision

**А1 —— 左面板在 `ui-board` 内实现为一棵工作文件夹树。** `WindowChatsPanel` 按注册顺序渲染每个已注册工作区外加未分组一档，并带有搜索框、分组与排序菜单、文件夹注册及其浏览器、逐行菜单、拖拽重排，以及「新建会话」，全部复用已绑定到窗口的 bridge 动作。该树在元素、顺序与行为上跟随侧栏，密度低一档。窗口当前会话所在的文件夹会自动展开，展开集合存放在看板 store 中，因此看板重新挂载后树会回到离开时的样子。被否决的第二个 `WorkspaceBrowser` 入口记录在 Alternatives 中。

**А2 —— 右面板在 `ui-board` 内实现为标签式文件界面。** 面板拥有带 `+` 与一个收起控件的标签条；`+` 打开「开始」页签，其「工作区文件」行打开文件页签。文件页签通过 `remote.workspaceFiles.list` 列出会话工作区根目录，并显示绝对路径与「重新加载」；查看页签按 `ctx.documentPreviews.candidates(path)[0]` 声明的模式通过 `remote.workspaceFiles.read`（文本）或 `readAll`（字节）读取文件，并绘制该扩展名对应的渲染器（图片、PDF、Markdown、文本）。页签按会话 id 存放在看板 store 中，因此跟随窗口的会话；同一绝对路径的查看页签会被激活而不会重复。车道中的文件链接——产物芯片、工具卡文件芯片，以及经 `MarkdownText` 文件提及词表解析的形如路径的行内代码——会打开查看页签并展开面板。

**А3 —— 界面模式即当前 main 面板。** `ui-layout` 的 `ILayout.declarePanelSidebar(panelId, false)` 让看板的 main 面板注册声明自身不保留侧边栏；它被选中时侧边栏列宽度为零，其导轨与宽度手柄不再渲染，看板因此填满外框。启动时始终是标准界面，因为 `activePanelId` 不会持久化。开关只有一个控件：侧栏品牌行中的 `sidebar.brand.actions` 与同一屏幕位置的看板标牌，看板在面板列表中的条目已移除。

**А4 —— 窗口草稿存放在看板 store 中。** 未发送的文本、图片与暂存文件（连同其 `File` 源）按窗口 id 存放在 `drafts` 中，因此把主面板从看板切走——这会卸载看板的 React 树——仍会保留它们。展开窗口会把草稿交给会话自己的 composer（`SessionInput.addFiles` 与 `setDraft`）；返回时把标准草稿取回（`SessionInput.takeDraft`）。只有回执的文件留在窗口里，因为它不携带浏览器字节。

**А5 —— 会话 bridge 绝不移动应用的当前会话。** `BoardSessionBridge.attach` 通过 `ISessions.openStream` 打开会话的实时流，而不是选中它，因此恢复布局不会替换标准界面显示的会话。只有显式切换（展开窗口、返回到窗口）才会选中会话，且绑定规则 Т2.13–Т2.16 只对已展开的窗口生效。

**А6 —— dock 顺序是独立的持久化字段。** `dockOrder` 与 `cloneOrder` 是版本 1 的追加字段，默认为空；聚焦窗口只写绘制顺序，拖动 dock 图标写其所在分组的顺序，因此图标不再随每次聚焦移动，而没有这些字段的旧文档会按窗口序号补齐。

**А7 —— 共享面板替换推迟。** 用标准组件替换看板自己的面板，需要在 `ui-renderer` 中提供面向任意会话的会话作用域槽位区，以及多实例右面板。该债务记录为 Beads 任务；本阶段不依赖它。

**布局字段。** 每个窗口持久携带 `leftPanelOpen`/`leftPanelWidth`（默认 260，范围 260–360）与 `rightPanelOpen`/`rightPanelWidth`（默认 360，范围 280–600），都是版本 1 内带默认值的追加字段。已移除的全局面板的 `panelWindowId`、`panelCollapsed` 与 `panelWidth` 仍作为「接受但忽略」的字段保留在版本 1 schema 中：存储文档仍可解析，修复会把它们规范化为 schema 默认值，运行中的看板绝不读取它们。`panelGroupBy` 与 `panelOrderBy` 仍是有效的视图状态。展开的工作文件夹分组（`panelExpandedGroups`）与右面板页签（`rightPanels`）仅存在于内存；布局绝不携带它们。

**上游包。** `ui-layout` 新增 `ILayout.declarePanelSidebar`；`ui-sidebar` 声明 `sidebar.brand.actions` list 槽位；`ui-conversation` 新增 `SessionInput.addFiles` 与 `takeDraft`，以及 `conversation.session.header.blank` list 槽位；`session-controller` 新增 `ISessions.openStream`；`ui-primitives` 承载本阶段依赖的 stage 23 tooltip 与菜单 portal 工作。每项改动连同其验证记录在 [`docs/ketos/upstream-sync.md`](../../../../docs/ketos/upstream-sync.md)。

## Alternatives considered

- **在看板槽位中复用 `WorkspaceBrowser` 实例。** 七个阻塞点（owner 份额、`selectPanel(null)` 上的全局导航、单一共享视图 store、硬编码的目录流孔位，以及槽位类型引用环），外加对 `ui-workspace`、`ui-sidebar` 与两个目录选择器的改动。看板改为自建树，复用已绑定窗口的 bridge 动作。
- **每个窗口一个 `ui-sidebar-right` 实例。** 需要面向任意会话的会话作用域槽位区、解除「每种页签只声明一次」的限制，以及多绑定控制器。推迟为 А7；看板自建标签条读取相同的文件与预览服务。
- **在 `ui-layout` 中另设界面模式标志。** 两个事实来源会与当前面板不一致；当前面板就是模式。
- **随布局持久化窗口草稿。** `File` 无法序列化，而重新加载从空 composer 开始是诚实的行为。
- **在 `attach` 中保留 `sessions.open`。** 恢复布局会替换用户的当前会话，使启动要求与绑定规则无法实现。
- **为新字段提升布局 schema 版本。** 这会重置所有已保存布局；版本 1 内的追加默认值保留了现有看板。
- **在每窗口面板旁把全局面板字段保留为活动状态。** 同一界面出现两个相互矛盾的属主；改为忽略这些字段，并在 README 中说明。

## Consequences

看板拥有完整的浮动外观与两个面板，标准界面只保留开关、返回控件与草稿交接。看板面板重复标准界面的呈现（树行、查看器）而不是共享组件——这是 А7 之前的既定代价。来自更早构建的存储文档保留其窗口、几何与视图；被移除的全局面板状态被规范化为默认值，其余内容不变。dock 图标在聚焦与重新加载之间保持顺序。看板窗口标题栏现在恰好承载关闭、左面板、标题、右面板与展开控件，而右面板唯一的浮动控件是收起。

验证：`packages/client/ui-board/tests`（store 动作与布局往返、面板几何、工作文件夹树、右面板页签与查看器、dock 顺序、会话 bridge、草稿交接），`packages/client/ui-layout/tests` 与 `packages/client/ui-sidebar/tests`（不保留侧边栏的面板与品牌动作），`packages/client/ui-conversation/tests`（输入矩阵与空白标题栏座位），`packages/ketos/client-locale-ru/tests`（字典对齐），以及 `apps/web/tests/board-geometry.e2e.ts`（dock 几何与屏幕尺寸、模式切换、标题栏控件、两面板同时打开、面板层叠、缩放 0.5/1/2 时的面板比例）；完整浏览器套件在 `DSH_SNAPSHOT=replay pnpm run test:web` 下运行。

## Related

- [`docs/ketos/board-redesign-plan.md`](../../../../docs/ketos/board-redesign-plan.md) —— 阶段计划，本记录其 А1–А7、要求 Т1–Т3 与验收门的结果。
- [`docs/ketos/upstream-sync.md`](../../../../docs/ketos/upstream-sync.md) —— 上游包改动及其验证。
- [`packages/client/ui-board/README.zh.md`](../../../../packages/client/ui-board/README.zh.md) —— 看板的用户可见行为、布局字段与限制。
