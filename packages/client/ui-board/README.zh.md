---
description: "dsh 网页客户端的空间看板：带拖拽、缩放窗口的空间画布主面板、小地图与工具条。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-board

[English](README.md) | 中文

## 概述

board 是 dsh 网页客户端的一个空间化主面板：一块 `OpenSwarm` 风格的无限画布，窗口（agent 卡片、工具与连接器窗口）在其上放置、移动、缩放、叠放与关闭。用户拖动画布背景即可平移，滚轮以指针为中心缩放；工具条在当前视图中心添加 agent 与工具窗口并可重置视图；角落的小地图镜像窗口布局。插件把看板注册为 `board` 主面板，并在侧栏面板列表中注册其图标。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

通过侧栏面板列表中的 board 图标打开该面板；画布填满主面板并从空开始。拖动背景平移，滚轮缩放（0.2–2.0，以指针为中心），用工具条按钮在当前视图中心添加 agent 卡片或工具窗口。窗口交互遵循同一约定：拖动标题栏移动，拖动边缘手柄缩放，按住 Shift 拖动可关闭 24 px 网格吸附；点击窗口将其提到 z 序最前，关闭按钮移除窗口。在 rail 或小地图中选择窗口会聚焦它并把视图居中到其上。

-----

<a id="understand-the-implementation"></a>
## 理解实现

**Runtime invariant:** 无已发布的 companion。面板条目把 `main` 槽位连同唯一的 engine store 一起注册；store 的 disposer 证明移除，同时可通过 `board.*` 槽位声明独立观察。

<details>
<summary>实现细节 — 点击展开</summary>

唯一的注册面：`apply` 注册 `main` 面板条目（携带共享 board store）与 `sidebar.panellist` 图标；contract 模块另声明 `board.*` 槽位集（`board.canvas`、`board.dock`、`board.windows`、`board.window`、`board.minimap`、`board.omnibar`），供后续组合把这些区域改为槽位而不是内置装配。board 状态是一个在面板条目上声明的 `dsh-client-store` engine store——平移、缩放、窗口映射、z 序与元素选择标志——配合纯 draft action（`setPan`、`setZoom`、`zoomTowardPointer`、`addWindow`、`moveWindow`、`resizeWindow`、`focusWindow`、`closeWindow`、`setSelectingElement`）。画布读取的所有内容都来自 store 的框架 `useStore` 席位；组件自身不持有任何订阅。可见文案由 locale 接管：`apply` 通过 `ctx.locale` 注册 `board` 命名空间词典，面板条目声明该命名空间，从而在 `BoardRoot` 上放置类型化的 `t` 席位并把本地化字符串以 props 逐层下传。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [Slots 参考](../../../docs/subsystems/slots.zh.md) —— `apply` 与 `board.*` contract 依赖的槽位协议。
- [client store](../store/README.zh.md) —— 承载 board 状态的 `defineStore` 引擎。
- [ui-sidebar](../ui-sidebar/README.zh.md) —— board 图标所在的面板列表。

-----

<a id="model-experience"></a>
## 模型体验

无模型体验：board 是纯浏览器画布，不注册任何工具、提示词段落或会话事件，渲染的一切都是 board 本地视图状态。

#### KV Cache 效果

无效果；board 不向任何模型请求添加内容，也不消费会话日志。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

这些限制属于当前包的约束。

- **窗口卡片是静态占位** —— `AgentCard` 与 `ToolWindow` 渲染各自固定的本地内容；contract 中的 `sessionId`、`status` 与 `contextUsed` 字段尚未从真实 Session 填充，agent 窗口尚未绑定到运行中的 agent。
- **每窗口预设选择待实现** —— agent 窗口没有选择其 agent 预设或模型的 UI；在该选择模型落地前，每个窗口只显示同一份固定卡片内容。
- **内置装配绕过已声明的槽位集** —— 当前装配直接在 `main` 面板中渲染 `DashboardCanvas`；`board.*` 槽位仅作为后续组合的 contract，尚未使用。
- **布局仅限会话** —— `apply` 创建 board store 时不带 persist key，因此平移、缩放与窗口排列在页面刷新后重置。

<a id="dev-note"></a>
### 开发备注

无。
