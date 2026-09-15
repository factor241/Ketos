# Agent Note: Ketos 看板经由槽位级联组合

Status: implemented

[English](2026-09-15-ketos-board-slot-composition.md) | 中文

## Problem

`packages/client/ui-board` 在 contract 中声明了六个 `board.*` 槽位键，却没有任何 owner 或渲染点：`DashboardCanvas` 直接在 JSX 中构造 `AgentCard` 与 `ToolWindow`，因此这些声明是死声明，canvas 域 import 了 window、dock、omnibox、inspector 域，而后续每个需要新窗口类型或新窗口内容的阶段都必须改 canvas。

框架规则是：槽位只在某个条目声明它时存在，而在声明条目的 `children` 表之外渲染某个键会以 `SlotOwnershipError` 失败（`packages/client/ui-slots/src/index.ts`、`packages/client/ui-renderer/src/client/scoped-slots.tsx`）。因此看板同时存在三个缺陷：声明没有 owner、单体组件绕过声明、以及仓库门禁拒绝的包内域图（`verify-client-domain-graph`）。

## Decision

一个 `apply` 通过槽位注册组合整个看板，`SlotMap` 中的每个键都恰好有一个声明者和至少一个渲染点：

- `main`/`board` 条目（BoardRoot）声明 `board.canvas`、`board.dock`、`board.omnibar`、`board.minimap`，并通过 `renderSlot` 渲染全部四个。
- `board.canvas` 的 occupant（`DashboardCanvas`）保留平移、滚轮缩放、点阵网格、变换面与视口测量，并声明 `board.windows`，在变换层内渲染它。
- `board.windows` 的 occupant（`BoardWindowLayer`）遍历 `windowOrder`，为每个窗口以 `entryKey: window.kind` 渲染 keyed 的 `board.window`。
- 窗口外框按 `WindowKind` 各注册一次（`agent` 与 `clone` → `AgentCard`，`connectors`/`settings`/`dashboard`/`tasks` → `ToolWindow`）；实例经由 owner share 传入，因此同一类型的多个窗口由一个注册渲染。
- `board.window.body` 以 `WindowBodyKind` 为键，提供 `conversation`（对话通道的席位）、`connectors`、`settings`（工具窗口的各窗格）。切换窗口的 `bodyKind`——工具窗口的标签栏调用 `setWindowBodyKind`——即切换所渲染的 occupant。
- keyed 的键域是通过映射 `keyProps` 表导出的 `WindowKind`/`WindowBodyKind` 联合类型，因此注册或分发未知键是编译错误，而不是空白单元格。窗口实例与 body 分发器对每个键都相同，走 owner share；keyed 表的作用是封闭分发域并标明已被占用的键。
- `apply` 中创建一个 `dsh-client-store` handle，并由每个层与外框注册声明，使所有组件通过框架 `useStore`/`actions` 席位读写同一个实例。`setViewport`、`openWindow`、`centerOnWindow`、`setWindowBodyKind` 加入 draft action 表。
- 组件保持无 ctx：dock、omnibar、minimap、外框与 body 都通过 `useStore` 读状态、通过 `actions` 变更；共享的窗口打开策略（模板、id 生成、摆放）位于 `open-window.ts` 与 `store.ts`，dock 与 omnibar 都从这里引入。

一个约束迫使实现偏离阶段计划字面上的级联。`SlotCore.register` 对每个子键只允许一个声明者，因此六个 `board.window` 注册无法各自声明 `board.window.body`（«occupant `board.window` … объявляет keyed `board.window.body`»）。窗口层是唯一的声明者，其 `children` 携带 body 席位；每个外框在 owner share 中收到 `renderBody(window)` 分发器，并在内容区域位置调用它。这与 ui-chat 的 `ChatNodeOwnerProps['renderMessageImages']` 是同一种「槽位支撑的渲染器」形态；内容仍经由槽位机制渲染，而外框因为没有声明 children 也就没有 `renderSlot` 席位。

选择遮罩从 `src/client/inspector/ElementSelectionContext.tsx` 移到顶层的 `src/client/ElementSelectionOverlay.tsx`：board root 在浮动层之上渲染它，且不再有顶层文件 import 任何域。这两项改动之后，`verify-client-domain-graph` 不再报告 `ui-board`（在该基线中该门禁仍因无关的上游包而红）。

## Alternatives considered

- **让每个外框各自声明 `board.window.body`（计划字面的级联）。** 被槽位核心否决：一个键的第二次声明会抛出 `slot "board.window.body" is already declared`。可行的变体更差——每种 body kind 只在一个外框注册，会让六种窗口类型中的五种没有 body；而给每个外框各自的 body 槽位键，则放弃了计划与阶段 6 所依赖的单一 body 席位。
- **以窗口 id 作为 `board.window` 的键。** 否决：动态 UUID 没有匹配的静态注册，每个窗口都会渲染空白单元格；计划记录了同样的理由，而按类型注册一次正是「一个 occupant 以不同 owner props 服务多窗口」的前提。
- **保留 canvas 直接构造外框、槽位稍后再注册。** 否决：已声明的键仍是死的，canvas 会为每种新窗口类型继续被修改，而这一改动会在阶段 6–19 反复出现。
- **在窗口层中把 body 渲染在框架旁边。** 否决：body 属于外框的框体内部（背景、内边距、滚动容器），只有外框拥有它。
- **通过 owner props 传入渲染好的 `ReactNode` body，而不是分发器。** 否决：owner props 不得携带 ReactNode 内容；分发器让 body 槽位保持为唯一分发点，且声明只有一个 owner。
- **在本阶段就把真实对话通道交给 conversation body。** 否决：对话通道是阶段 6 的解剖工作；本阶段只固定它将挂载的接缝。
- **把 `addWindow` 保留为唯一的窗口 action。** 保留，并在其旁新增 `openWindow`：摆放与 id 生成属于 store（依赖视口与平移），而 `addWindow` 仍是 store 测试驱动的显式状态路径。

## Consequences

后续阶段无需触碰 canvas 即可新增窗口类型与窗口内容：新的 `WindowKind` 外框是一次 `ctx.slots.inject('board.window', …)` 注册，新的 body 是 `apply` body 表中的一行，而客户端槽位目录会报告已被占用的键（`agent, clone, connectors, dashboard, settings, tasks` / `connectors, conversation, settings`）。

各层拥有自己所绘制的内容：canvas 自行测量并发布 `setViewport`，dock 与 omnibar 经由同一个 helper 打开窗口，minimap 用 `centerOnWindow` 居中视图——摆放与居中的数学在 store 中，而不在组件里。

接受的取舍：尚无 body occupant 的类型（`clone`、`dashboard`、`tasks`）的外框会渲染空的 body 区域，因为在它们各自的阶段之前没有 UI 创建这些窗口；每个 keyed 席位把同一份 share 声明两次——一次作为公共 `owner`，一次在映射的 `keyProps` 表中——因为目录的词法扫描从 `owner` 读取 owner props，而封闭的键域需要 keyed 表。

移动手势代码时发现的两个缺陷仍在范围之外并被登记：注册在 `globalThis` 上的看板手势监听器在拖拽中途卸载后仍然存活（`ketos-0s0`），以及两个外框重复了八方向缩放算法，其最小尺寸守卫只由 store 兜底（`ketos-4k3`）。

验证：`tests/slots.client.spec.tsx` 固定级联（每个层一个 occupant、六个外框注册、三个 body 注册）、实例路由（两个 agent 窗口经由一个注册）、按 `bodyKind` 切换 body、无 occupant 的 body 情形、重新 apply 不产生重复、以及 `board.dispose()` 的完全收回；`tests/apply.client.spec.tsx` 保留延迟声明路径，并新增级联注册与看板声明随条目收拢的断言。手动删除一个 `children` 键（先是 `board.omnibar`，后是 `board.window`）会以 `SlotOwnershipError` 使这些 spec 失败——这正是阶段清单要求的人工破坏验证。

## Related

- [`packages/client/AGENTS.md`](../../../../packages/client/AGENTS.md) —— 本组合遵循的 children 即授权规则与四类 props share。
- [`docs/subsystems/slots.md`](../../../../docs/subsystems/slots.zh.md) —— 槽位协议（`register`、`inject`、`renderSlot`、keyed 分发）。
- [`packages/client/ui-chat/src/client/contract/slots.ts`](../../../../packages/client/ui-chat/src/client/contract/slots.ts) —— 外框 body 分发器所参照的 `renderMessageImages` 槽位支撑渲染器先例。
- [看板接入 web profile](2026-09-15-ketos-board-in-web-profile.zh.md) —— 本组合延续的阶段 2 接线记录。
