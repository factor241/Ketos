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

**Runtime invariant:** 无已发布的 companion。面板条目把 `main` 槽位连同唯一的 engine store 一起注册，并声明它渲染的各个层；条目的销毁证明移除，同时可通过 `board.*` 槽位声明独立观察。

<details>
<summary>实现细节 — 点击展开</summary>

唯一的注册面：`apply` 以槽位方式组合看板。`main` 面板条目声明 `board.canvas`、`board.dock`、`board.omnibar`、`board.minimap` 并通过 `renderSlot` 渲染它们；canvas occupant 声明 `board.windows`；窗口层声明 keyed 的 `board.window`（每个窗口类型一份注册——实例经由 owner props 传入，因此一个 occupant 服务该类型的全部窗口）与 keyed 的 `board.window.body`（每种 body kind 一份注册），并把 body 分发器交给每个窗口外框；同一个 `apply` 还注册 `sidebar.panellist` 图标。keyed 的键就是 `WindowKind` 与 `WindowBodyKind` 联合类型，因此为未知键注册是编译错误。board 状态是一个在面板条目上声明的 `dsh-client-store` engine store——平移、缩放、视口盒、窗口映射、z 序与元素选择标志——配合纯 draft action（`setPan`、`setZoom`、`zoomTowardPointer`、`setViewport`、`addWindow`、`openWindow`、`moveWindow`、`resizeWindow`、`setWindowBodyKind`、`focusWindow`、`centerOnWindow`、`closeWindow`、`setSelectingElement`）。每个层与外框都通过框架 `useStore` 席位读取同一个 handle；组件自身不持有任何订阅。可见文案由 locale 接管：`apply` 通过 `ctx.locale` 注册 `board` 命名空间词典，每个承载文案的条目声明该命名空间，从而在其组件上放置类型化的 `t` 席位。样式模块化并基于 token：每个组件在自身旁边拥有一个 CSS Module，内联样式只承载放置与随平移/缩放计算的度量，组件规则只引用 `--dsw-*` 语义别名。看板根节点带有字面类 `board-canvas`，它是 `ui-theme` 的 `ketos-brand.css` 据以把 Ketos 调色板限定在看板子树的钩子（石墨色浮层、奶油色画布，以及以 `data-board-surface="light"` 标记的浅色工具窗口子表面）；画布点阵是唯一的看板本地取值，位于画布模块内。调色板是有意且限定于看板的，因此 `body` 与 `body[data-ds-dark-theme]` 都不变，周围面板在两种偏好下都保持 Harness 主题。

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

- **对话 body 是静态占位** —— `conversation` body 渲染窗口的状态行与固定开场消息；contract 中的 `sessionId`、`status` 与 `contextUsed` 字段尚未从真实 Session 填充，agent 窗口尚未绑定到运行中的 agent。
- **每窗口预设选择待实现** —— agent 窗口没有选择其 agent 预设或模型的 UI；在该选择模型落地前，每个窗口只显示同一份固定卡片内容。
- **没有 body occupant 的窗口类型渲染空 body** —— `apply` 注册全部六种 `WindowKind` 外框，而 `board.window.body` 只提供 `conversation`、`connectors`、`settings`；当前没有 UI 创建 clone、dashboard 或 task 窗口，创建它们的阶段会注册各自的 body。
- **外框的 body 分发器是 owner prop** —— 窗口层是 `board.window.body` 的唯一声明者（槽位核心允许每个键只有一个声明者），因此它向每个外框传入 `renderBody` 回调，而不是外框自己的 `renderSlot` 席位。
- **布局仅限会话** —— `apply` 创建 board store 时不带 persist key，因此平移、缩放与窗口排列在页面刷新后重置。
- **看板外框动作尚未接线** —— omnibox 的发送与操作菜单中的附件、听写、网页搜索条目只会关闭菜单；它们尚未接入 Session、文件或 Web 能力。
- **看板配色不随 Harness 明暗偏好变化** —— `ketos-brand.css` 在两种方案下都把 Ketos 调色板限定在 `.board-canvas` 子树内，因此看板始终渲染自己的石墨/奶油配色；随方案变化的看板配色属于另一次品牌层改动。
- **连接器面板是静态名册** —— 它的三行与开关渲染能力名称和固定的开/关状态，切换不会有任何效果；在拥有这些能力的阶段落地后，该面板才会绑定到真实工具。

<a id="dev-note"></a>
### 开发备注

无。
