# Agent Note: Board windows navigate projects and chats from a chats panel

Status: implemented

[English](2026-09-16-ketos-board-window-chats-panel.md) | 中文

## Problem

看板窗口过去只能显示它自己创建的聊天：窗口的工作目录在创建时固定，没有任何界面列出其他会话，唯一能到达它们的途径是应用自己的侧栏——而那意味着离开看板。用户要求把应用侧栏上的那颗按钮（面板左栏字形）放到窗口标题栏里，从窗口下方滑出一份紧凑列表：先列项目（工作区），再列所选项目里的聊天，选中某个聊天即让窗口指向它。面板必须保持小巧（约为窗口面积的正分之一）、在窗口被拖动或缩放时跟随、读起来像外框之下的一层而不是第二个窗口，并在全屏时变成普通聊天布局里的常规侧栏，聊天在它旁边居中。

## Decision

**面板是外框的伴随层，而不是第二个窗口。** `board.window.panel` 是与 `board.window` 并列的 keyed 槽位，用同一个 `WindowKind` 作键；窗口层在同一个 fragment 内、外框之前渲染它，因此同层级叠加加 DOM 顺序保证每个外框都在自己的面板之上、面板又在画布之上。面板自身不带 `z-index`，有自己的 `data-board-panel` 属性，并在关闭状态下保持挂载，使打开与关闭共用一次 transform 过渡（`--ds-transition-duration-slow`、`--ds-ease-in-out`，在 `prefers-reduced-motion` 下禁用）。

**几何是窗口矩形的函数。** `window/panel-geometry.ts` 用世界单位从 `BoardWindowState` 推导矩形：打开的面板取存储宽度（默认 300px，钳制在 260–420px 之间，且不超过外框留出的空间），以外框自身的高度立在它左缘之旁——左缘无空间时改用右缘，两侧都没有时置于窗口内左缘、外框之上——折叠导轨则是同一边缘居中的 44×170px 条带。全屏态把面板停靠在看板面板左缘并占满高度。由于面板位于被变换的画布表面内部，拖动、缩放、平移与缩放画布都无需面板写任何代码，外缘的宽度拖拽也像其他外框手势一样按世界单位读取。

**面板可调宽度且始终一键可开。** 宽度存放在看板 store（`panelWidth`，由 `setPanelWidth` 钳制），外缘带 8px 的拖拽条；`panelCollapsed` 把它折回导轨，导轨上的按钮再次展开面板，而面板的标题栏承载收起它的按钮。这些都不影响外框标题栏里的聊天按钮——它仍是第二种入口。

**全屏让它变成普通聊天布局。** 面板打开时，全屏外框的 inset 变为 `0 0 0 <面板宽度>`，聊天正好让出面板的宽度，`ConversationBody` 把车道与 composer 放在剩余空间中居中的 768px 列上。两种形态都只是同一个 store 字段（`panelWindowId`），因此 Escape 由外框里的同一个处理器先关面板、再退出全屏，关闭窗口时也会清除它。

**选择聊天会让窗口重新绑定。** `BoardSessionBridge` 把创建路径拆成 `create`（创建后切换）与共用的 `switchTo`/`attach`，并暴露 `bind(windowId, sessionId)`——先对照会话列表校验，再像全新挂载一样释放并重新订阅——以及针对 `sessions.create({ workspaceId })` 或某个目录的 `createChat(windowId, target)`。窗口的 `useWindowSession` 通道现在携带 `sessionId`，因此面板能标出窗口正在显示的聊天。面板通过注入面的 `hooks` 隔间（`useSessionList`、`useWorkspaceList`）读取会话与工作区列表，而不是依赖全局标准 prop，从而把看板对 `ctx.workspaces` 的依赖显式写进它的 inject 列表。

**面板是窗口的管理界面。** 项目可重命名、重排（拖动行或使用行菜单的移动命令）与删除，经由 `ctx.workspaces.rename/insertBefore/delete`；标题栏的文件夹浏览器通过 `uiWorkspace.listDirectory` 每次列出一层、通过 `createDirectory` 创建嵌套文件夹，并通过 `workspaces.create` 注册选中的目录。聊天可复用或新建（`startChat`）、重命名（`session.rename`）、分支（`sessions.fork` 并带 `increaseTitle`，子会话绑定到窗口）、归档（`workspaces.archiveSession`）、重排（`workspaces.insertSessionBefore`），并可按标题或目录搜索；分组（按项目或单一列表）与排序（手动或按更新时间）与面板宽度一同存放在看板 store。面板打开时 dock 与小地图让位：它们属于看板 chrome，否则它们的条带会压住面板外缘与缩放手柄。文件夹层只读取 browse 选择器的动词，因此启动时挂载原生选择器的宿主（`dsh-host-directory-picker-auto` 在本地 macOS/Windows 回环绑定下解析为 `native`）没有目录列表：该层会说明这一点，并把选择交给 `uiWorkspace.pickDirectory()`——两种选择器共同提供的唯一动词——并注册它返回的目录。

**列表模型归看板所有。** `chat-list-model.ts` 推导面板需要的分组：成员关系取自工作区自身的 `sessionIds`，排除子代理与已归档行，空白会话只对正在显示它的窗口可见，按更新时间倒序，未分组一档放在最后。侧栏自己的树推导留在原地——特性插件不能导入另一个插件的值，而看板需要的规则只有十几行。

## Alternatives considered

- **复用 `ui-workspace` 的树、行与菜单。** 否决：`tree.ts` 与行组件是包内实现，分组与排序菜单假定全宽侧栏，紧凑条带装不下它们（见 README 的限制）。
- **在画布旁的独立看板层里渲染面板。** 否决：那样面板会离开画布变换，每个矩形都要做 pan/zoom 运算，而且关闭时外框无法盖住它。
- **每个窗口各开一个面板，而不是同时只开一个。** 否决：store 字段让该模式保持独占，与旁边的全屏字段一致，而面板是用户主动打开的类浮层表面。
- **给面板一个低于外框的 z-index。** 否决：固定值会把它压到画布浮层（dock、Omnibox、小地图，z-index 100）之下，并与更低窗口的关系不一致；窗口 fragment 内的 DOM 顺序是精确的，不需要数字。
- **让全屏外框保持 `inset: 0`，把面板叠在上面。** 按用户给的参照否决：全屏应当读作普通聊天布局——侧栏加居中的聊天列——因此外框让出面板宽度。
- **把应用侧栏的会话操作（重命名、归档、分叉）搬进面板。** 推迟：用户先要导航，条带只放得下行，而且客户端根本没有删除会话的能力。

## Consequences

窗口无需离开看板即可到达每个项目的每个聊天，被重新绑定的窗口保留自己的矩形、标题与面板状态。代价：重新绑定后窗口标题仍显示打开时的名字；选择聊天会让该会话成为整个客户端的当前会话（会话控制器只提供这一条选择轴）；每个聊天窗口持有两个共享快照订阅；管理操作仍留在应用侧栏。

验证：`tests/panel-geometry.client.spec.ts` 固定钳制、掖入矩形与停靠矩形；`tests/chat-list.client.spec.ts` 固定分组、子代理/归档/空白过滤、排序与未分组一档；`tests/store.client.spec.ts` 固定同时只开一个面板以及关闭窗口时的重置；`tests/slots.client.spec.tsx` 固定关闭时仍挂载的面板、标题栏开关、它写入的几何、面板先于外框的顺序、没有 z-index、Escape 先关面板再退全屏、面板打开时的停靠 inset，以及在面板里选中聊天后该聊天成为窗口的会话。

## Related

- [Board windows own Harness sessions and rebuild the chat composer](2026-09-16-ketos-board-window-sessions.zh.md) —— 该面板重新绑定的桥，以及以 agent 预设为唯一设置芯片的 composer；窗口的工作目录在该面板中选择与管理。
- [Board windows fill the panel in fullscreen instead of handing off to the main panel](2026-09-16-ketos-board-window-fullscreen.zh.md) —— 面板停靠进入的模式。
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.zh.md) —— 该面板新增的交互与限制。
