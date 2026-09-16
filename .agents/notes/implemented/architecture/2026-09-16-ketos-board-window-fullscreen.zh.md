# Agent Note: Board windows fill the panel in fullscreen instead of handing off to the main panel

Status: implemented

[English](2026-09-16-ketos-board-window-fullscreen.md) | 中文

## Problem

看板窗口按设计只有 552×648，而想看到更多聊天内容的唯一办法是离开看板：车道里的展开徽章执行 `sessions.open(id)` 加 `layout.selectPanel(null)`，于是看板面板被隐藏、窗口自己的 composer 消失，并且该会话成为整个应用的当前会话。用户要求窗口自身具备全屏模式——外框右上角的按钮，不做导航——并要求 dock、Omnibox 与小地图为它让位。

## Decision

**模式由看板 store 拥有。** `BoardState.fullscreenWindowId` 保存铺满面板的窗口或 null；`setWindowFullscreen(id)` 记录它并提升该窗口，`exitFullscreen()` 清除它，`closeWindow` 在关闭的正是该全屏窗口时清除它。模式开启期间窗口存储的 `x/y/width/height` 仍是权威值，因此退出时会恢复用户排布的那一矩形。

**画布在全屏窗口之下撤掉自身的变换。** 放在画布表面内部的 `inset: 0` 外框否则会随 `--board-zoom` 缩放并处于世界坐标中。模式开启时 `DashboardCanvas` 发布恒等的平移与缩放，外框以顶层 `zIndex` 渲染 `inset: 0`；窗口层只渲染该外框，`BoardRoot` 不再渲染 `board.dock`、`board.omnibar` 与 `board.minimap`，外框的 `.fullscreen` 类把圆角改为直角并去掉浮层投影，缩放手柄消失，标题栏拖动不再生效。滚轮缩放让位，使车道与其弹层能正常滚动。Escape 与标题栏按钮都能退出该模式。

**该模式是一次 store 状态转换，而非注入回调。** `openInMainPanel` 成员已从 `BoardWindowInjected`、桥与插件的 `inject` 列表中移除，`layout` 服务一并移除；标题栏承载该开关，标签为 `window.fullscreen` 与 `window.exitFullscreen`。共享图标集只有外扩描边字形，因此恢复字形由看板自绘（`window/fullscreen-glyph.tsx`）；工具窗口只保留关闭控件，因为它们的正文随各自负责的阶段交付。

## Alternatives considered

- **在全屏之外保留主面板交接。** 否决：用户只要求一个动作，而且会话本来就能通过侧栏列表触达。
- **铺满整个浏览器视口而不是看板面板。** 否决：看板是应用框架内的主面板，铺满它能让外壳的侧栏与会话列表继续可用；而处在被变换表面内部的 `position: fixed` 需要 portal 或逃出包含块的机制，槽位组合并不提供。
- **把外框 portal 到 `document.body`。** 否决：同样有包含块问题，而且外框 DOM 会离开画布——它自己的测试与元素选择浮层都指向画布。
- **全屏期间扩大存储矩形，退出时恢复。** 否决：几何是用户的排布，改写它的模式在任何中断下都会丢失原值，并让小地图投影与 `centerOnWindow` 说谎。
- **在 Escape 之外再加键盘快捷键。** 推迟：`Escape` 关闭活动窗口归阶段 5.3 所有，快捷键集合也应随之确定。

## Consequences

窗口拥有可就地进入、精确恢复的全屏模式，而且此前“浮层可能盖住手柄”的缺口（`ketos-d3a`）在该模式内不存在，因为浮层已经让位。代价：工具窗口无法进入全屏；该模式是看板局部的（主面板继续显示它原本的会话）；离开看板现在只能通过侧栏的会话列表。

验证：`tests/store.client.spec.ts` 固定进入、退出、关闭即清除、未知 id，以及矩形不被改写；`tests/slots.client.spec.tsx` 固定外框的 `inset: 0`、被隐去的邻居与浮层、画布上的恒等平移/缩放、Escape 恢复存储几何，以及标题栏开关关闭该模式。

## Related

- [Board windows own Harness sessions and rebuild the chat composer](2026-09-16-ketos-board-window-sessions.zh.md) —— 该动作过去借以离开的 composer 与桥。
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.zh.md) —— 该模式扩展的窗口交互。
- [`ketos-d3a`](../../../../docs/ketos/reports/stage-04-theme-i18n.md) —— 该模式绕开而非修复的浮层盖手柄限制。
