---
description: "dsh 网页客户端的空间看板：带拖拽、缩放窗口的空间画布主面板、小地图与工具条。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-board

[English](README.md) | 中文

## 概述

board 是 dsh 网页客户端的一个空间化主面板：一块无限画布，agent 窗口在其上放置、移动、缩放、叠放与关闭。每个窗口拥有一个 Harness 会话，并携带完整的聊天 composer——工作目录与 agent 预设芯片、操作菜单与斜杠命令、`@` 提及、权限与模型芯片、上下文圆环、图片附件，以及目标、待办与队列条。dock 与 Omnibox 在当前视图中心添加窗口；角落的小地图镜像窗口布局。插件把看板注册为 `board` 主面板并在侧栏注册其图标，且使用共享的 Harness 主题与控件绘制。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

通过侧栏面板列表中的 board 图标打开该面板；画布填满主面板并从空开始。拖动背景平移，滚轮缩放（0.2–2.0，以指针为中心），用 dock 的加号按钮在当前视图中心添加 agent 卡片。窗口交互遵循同一约定：拖动标题栏移动，拖动边缘手柄缩放单轴，拖动角手柄按比例缩放窗口（两轴同一系数，对角固定），按住 Shift 拖动可关闭 24 px 网格吸附；点击窗口将其提到 z 序最前，关闭按钮移除窗口。窗口绝不会小于创建时的尺寸（agent 窗口的默认聊天尺寸 480×560）——composer 的各行无法在更小的空间内排布——而宽度、高度或对角方向的放大不受限制。在 dock 或小地图中选择窗口会聚焦它并把视图居中到其上。窗口首次渲染时会创建自己的会话（该会话出现在侧栏列表中，聚焦窗口会使其成为当前会话）。composer 与主聊天一致：`+` 打开操作菜单（图片附件、目标、计划、反馈、压缩、权限、模型、导出），`/` 按输入过滤斜杠命令并显示参数提示与描述，`@` 提示文件、目录与会话，芯片行可切换权限预设（完全访问走风险确认）以及模型与其推理等级，圆环显示上下文占用，麦克风按钮在引擎提供语音识别时把语音转写写入草稿。Enter 发送，Cmd/Ctrl+Enter 引导正在执行的回合，Shift+Enter 换行，圆形按钮停止；卡片会自行测量宽度，在窗口变窄时隐藏芯片文字或换行工具栏，因此发送控件在任何尺寸下都可达；`Load earlier turns` 会把更早的回合拉入车道，展开按钮会在主对话面板中打开同一会话。

-----

<a id="understand-the-implementation"></a>
## 理解实现

**Runtime invariant:** 无已发布的 companion。面板条目把 `main` 槽位连同唯一的 engine store 一起注册，并声明它渲染的各个层；条目的销毁证明移除，同时可通过 `board.*` 槽位声明独立观察。

<details>
<summary>实现细节 — 点击展开</summary>

唯一的注册面：`apply` 以槽位方式组合看板。`main` 面板条目声明 `board.canvas`、`board.dock`、`board.omnibar`、`board.minimap` 并通过 `renderSlot` 渲染它们；canvas occupant 声明 `board.windows`；窗口层声明 keyed 的 `board.window`（每个窗口类型一份注册——实例经由 owner props 传入，因此一个 occupant 服务该类型的全部窗口）与 keyed 的 `board.window.body`（每种 body kind 一份注册），并把 body 分发器交给每个窗口外框；同一个 `apply` 还注册 `sidebar.panellist` 图标。keyed 的键就是 `WindowKind` 与 `WindowBodyKind` 联合类型，因此为未知键注册是编译错误。board 状态是一个在面板条目上声明的 `dsh-client-store` engine store——平移、缩放、视口盒、窗口映射、z 序与元素选择标志——配合纯 draft action（`setPan`、`setZoom`、`zoomTowardPointer`、`setViewport`、`addWindow`、`openWindow`、`moveWindow`、`resizeWindow`、`setWindowBodyKind`、`focusWindow`、`centerOnWindow`、`closeWindow`、`setSelectingElement`）。每个层与外框都通过框架 `useStore` 席位读取同一个 handle；组件自身不持有任何订阅。可见文案由 locale 接管：`apply` 通过 `ctx.locale` 注册 `board` 命名空间词典，每个承载文案的条目声明该命名空间，从而在其组件上放置类型化的 `t` 席位。样式直接读取共享主题：每个组件在自身旁边拥有一个 CSS Module，内联样式只承载放置与随平移/缩放计算的度量，规则只引用 `--dsw-*` 语义别名——浮层面板使用主题的 layer-2 填充与 elevation 发丝描边（聚焦窗口重绑到业务强调色），内部分隔线为 0.5 px 发丝线，画布点阵跟随边框色阶。交互外框来自 `ui-primitives`：标题栏关闭按钮与 composer 动作使用 Harness 图标，dock 行与 composer 动作包在 `Tooltip` 中，Omnibox 的操作菜单是共享的 `Menu`，dock 控件位于 floating-fill token 上。因此看板与其他面板一样跟随外壳的明暗偏好。窗口会话位于 apply 侧的桥（`session-bridge.ts`）：窗口 id → 会话的映射、`sessions.create()`/`open()`/`binding()` 序列，以及 chat/会话订阅全部留在插件闭包中，绝不进入 store；每个窗口的车道状态通过每窗口一个身份稳定的 channel 重新发布。body 注册把该 channel 暴露为 keyed hook `useWindowSession(windowId)` 以及 composer 回调（`ensureWindowSession`、`sendPrompt`、`cancelPrompt`、`loadOlderTurns`、`openInMainPanel`），因此一个注册即可服务所有窗口，组件只接收普通数据。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [Slots 参考](../../../docs/subsystems/slots.zh.md) —— `apply` 与 `board.*` contract 依赖的槽位协议。
- [client store](../store/README.zh.md) —— 承载 board 状态的 `defineStore` 引擎。
- [ui-sidebar](../ui-sidebar/README.zh.md) —— board 图标所在的面板列表。
- [ui-primitives](../ui-primitives/README.zh.md) —— 看板外框组合的图标、`Tooltip`、`Menu` 与 `Tag`。

-----

<a id="model-experience"></a>
## 模型体验

无模型体验：board 是纯浏览器画布，不注册任何工具、提示词段落或会话事件，渲染的一切都是 board 本地视图状态。

#### KV Cache 效果

无效果；board 不向任何模型请求添加内容，也不消费会话日志。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

这些限制属于当前包的约束。

- **窗口车道只渲染正文与工具名** —— assistant 文本以 Markdown 呈现且流式文本可见，工具结果折叠为一行；完整的工具卡片（终端、diff、读取、搜索、网页）以及确认与提问表面随拥有它们的阶段到来，确认目前会导航到主面板而不是在窗口内渲染。
- **窗口附件仅限图片** —— 操作菜单的文件条目选择图片并以行内方式随提示发送；其他文件类型需要对话包拥有的上传缝，`@` 提及插入纯文本而非编辑器芯片。
- **窗口 composer 保有自身的提交策略** —— Enter 排队，Cmd/Ctrl+Enter 引导，且不读取提交偏好设置。
- **浮动浮层可能盖住窗口的缩放手柄** —— dock、Omnibox 与小地图位于画布之上，因此当窗口边缘落在它们下方时，该手柄无法用指针抓取；平移画布或把窗口居中即可触达（`ketos-d3a`）。
- **每窗口预设选择待实现** —— agent 窗口没有选择其 agent 预设或模型的 UI，会话的工作目录在创建时固定。
- **外框的 body 分发器是 owner prop** —— 窗口层是 `board.window.body` 的唯一声明者（槽位核心允许每个键只有一个声明者），因此它向每个外框传入 `renderBody` 回调，而不是外框自己的 `renderSlot` 席位。
- **布局仅限会话** —— `apply` 创建 board store 时不带 persist key，因此平移、缩放与窗口排列在页面刷新后重置。
- **Omnibox 尚未接线到会话** —— 它的发送与操作菜单中的附件、听写、网页搜索条目只会关闭菜单；它们尚未接入 Session、文件或 Web 能力。窗口 composer 与「选择元素」条目已可用。
- **工具与设置窗口只有外框没有内容** —— 看板不再展示任何模拟的工具、连接器或设置内容，且目前没有任何入口打开这些窗口；真实的每窗口字段随拥有它们的阶段到来，而 Harness 本身并没有客户端 system prompt 编辑器。

<a id="dev-note"></a>
### 开发备注

无。
