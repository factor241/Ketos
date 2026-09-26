# Agent Note: 看板输入与浮层

Status: implemented

[English](2026-09-25-ketos-board-input-and-popover-layer.md) | 中文

## Problem

看板审计发现，输入与浮层在看板与外壳相接的两条接缝上失效。输入没有单一决策点：落在窗口车道、聊天面板、其导轨或浮动浮层上的触控板捏合（Chromium 中为 ctrl+wheel）会到达浏览器并缩放整个应用；双指滑动只改变缩放，因为处理器只读取 `deltaY` 的符号；每个事件都套用固定的 ±10%，惯性尾部一次滑动即可冲到极限；`Cmd/Ctrl+0` 在应用任何位置都会重置看板视图，而 `Cmd/Ctrl+=`/`−` 从来不是看板命令；Safari 的 `gesture*` 事件没有任何监听器，因此其捏合即便落在画布上也会缩放页面。浮层没有宿主：`Tooltip` 在被变换的画布内渲染 `position: fixed`，视口坐标被按画布空间解释，气泡落在按钮之外或看板之外；`Menu` 以缩放 1 挂到 `document.body`，以浏览器窗口而非看板为界，只在 `scroll`/`resize` 时重新定位；带子菜单的菜单既无高度上限也无子菜单翻转，长模型列表与嵌套卡片会离开屏幕。在看板之外，一次误触的捏合会缩放外壳的任何位置。

## Decision

**一个 wheel 分类器负责目标判定。** `wheel-zoom.ts` 暴露 `classifyBoardWheel(event, target, mode)`，返回 `'zoom' | 'pan' | 'native'`：`[data-surface="board"]` 内任意位置的 ctrl/meta 缩放；落在窗口车道/自带滚动表面（`[data-board-window]`、`[data-board-panel]`、`[role="menu"]`）上的无修饰 wheel 保持原生；落在画布或浮动浮层上的无修饰 wheel 遵循 `wheelMode` 字段。`resolveBoardWheel` 追加 `preventDefault` 与全屏规则——全屏外框填满面板、不属于画布，因此阻止其捏合但不应用看板缩放。`wheelPanDelta` 把一个 wheel 事件转换为看板平移（Shift 交换两轴），`wheelZoomFactor` 为 `exp(−Δ·k)`，增量按 `deltaMode` 归一到 CSS 像素，并按每个事件 ±50px 截断。

**看板的 wheel 行为由 `Config` 决定。** `ui-board` 客户端插件新增经校验的 `Config`：`wheelMode: 'pan' | 'zoom'`（默认 `'pan'`，决策 R-4）与 `zoomSensitivity`（默认 `0.0023 ≈ ln 2 / 300`，使一次“指尖到掌心”的捏合约改变两倍缩放），注入看板根节点。

**一个缩放动作为 wheel、手势与按键共用。** 存储动作 `zoomTowardPointer(delta, x, y)` 变为 `zoomBy(factor, x, y)`：因子由调用方持有，动作保持指针下的世界点不动，并在缩放被上限截断时保持平移不变。`panBy(deltaX, deltaY)` 应用一次屏幕像素平移，`resetView()` 把视图复位为平移 (0, 0)、缩放 1。`keyboard-zoom.ts` 只在指针或键盘焦点位于看板根节点内时把 `Cmd/Ctrl+0`、`+=`、`−` 解析为看板视图命令；`+=`/`−` 绕看板中心按 ×1.25 步进；在看板之外这些组合都留给浏览器页面缩放。

**Safari 捏合与 wheel 共用同一条路径。** `pinch.ts` 是覆盖 `gesturestart`/`gesturechange`/`gestureend` 的小状态机，在每次 change 时应用 `event.scale / previousScale`。看板根节点在 wheel 监听器旁注册非被动 gesture 监听器并始终调用 `preventDefault`，页面永远看不到该手势。手势点通过与 wheel 分支相同的 `boardPoint(box, event)` 映射从屏幕像素转换为看板根像素，因此展开的应用侧栏不再偏移缩放锚点。全屏下 gesture 处理器只阻止页面捏合：不调用 `zoomBy`，也不改变 pinch 状态，与 wheel 规则一致。

**`ui-primitives` 新增浮层宿主。** `PopoverHost.tsx` 定义上下文值（`container`、`scale`、`boundary()`、`subscribe(listener)`）与 `PopoverHostProvider`：后者只覆盖自己设置的字段，其余继承最近的宿主。没有提供者时钩子返回浏览器默认值（`document.body`、缩放 1、浏览器窗口、`scroll`/`resize`），因此不挂载宿主的消费者行为不变。`Tooltip` 始终通过 `createPortal` 渲染气泡，并在每个宿主信号上重读锚点；`Menu` 在 portal 模式下渲染进宿主容器并应用 `scale`，把缩放后的尺寸限制在 `boundary()` 内，对每个列表——包括带子菜单的菜单——都加上高度上限与滚动，并把每个子菜单渲染为独立 portal 节点，经测量后在左右与上下之间择有空间的一侧打开；锚点完全位于边界之外时关闭列表。`PopoverHostProvider`、`usePopoverHost` 与两个公开类型从包入口导出。

**看板拥有唯一的屏幕空间浮层。** 看板根节点发布 `BoardPopoverSurface`（`{ layer, root }`），并在画布变换之外渲染该层，`BOARD_POPOVER_Z = 300`——高于浮层（100）与手柄环（150），低于元素选择覆盖层（500）。`BoardPopoverProvider` 把窗口宿主映射为 `scale = zoom`（全屏为 1）、`boundary` = 看板盒减去 12px 内边距、`subscribe` = 看板平移、缩放与窗口矩形变化；dock 与 omnibar 宿主使用缩放 1。`windowMenuDismissToken` 与 `useBoardMenuDismiss` 在窗口移动、缩放、进入全屏、被裁剪或关闭时关闭打开的菜单，而平移与缩放只让菜单跟随触发按钮。窗口外框、聊天面板、dock 与 omnibar 都挂载该提供者，`menu-placement.ts` 按看板边界而非浏览器视口选择边与对齐。

**外壳阻止看板之外的页面捏合。** `ui-layout` 新增 `pinch-guard.ts`（`installPagePinchGuard(root, block)`）与经校验的 `Config` 字段 `blockPagePinchZoom`（默认 `true`）。`AppFrame` 根节点注册非被动 `wheel`（仅 ctrl）与 `gesture*` 监听器，在 `[data-surface="board"]` 之外的一切位置调用 `preventDefault`；看板自行处理其捏合。看板之外的 `Cmd/Ctrl +/−/0` 保留浏览器页面缩放（决策 R-2）。

## Alternatives considered

- **补偿固定定位气泡的坐标而不做 portal。** 否决：每个被变换的祖先都是 `fixed` 的包含块，修正必须重新推导整条祖先链；portal 是唯一稳定的坐标空间。
- **把看板浮层放进画布变换内。** 否决：它会继承平移与缩放、把文本二次缩放，并在画布盒处裁剪卡片。
- **保留 `Menu` 到 `document.body` 的 portal，改为传入看板矩形。** 否决：一个宿主上下文同时服务浏览器默认与看板；把几何量穿给每个菜单消费者等于重复这份契约。
- **把外壳捏合防线挂在 `document` 上而不是外框根节点。** 推迟：外框根节点覆盖外壳，且看板例外保持局部；渲染在 `document.body` 的 portal（菜单、模态框）仍未覆盖，记为 П-37，留待 Д6.4。
- **用启发式区分鼠标与触控板。** 否决（R-4）：设备信号不可靠，`Config.wheelMode` 明确声明行为。
- **保留固定 ±10% 步长，只改符号处理。** 否决：惯性尾部一次滑动即可跨越整个缩放范围；带单事件截断的 `exp(−Δ·k)` 与手势成比例。
- **在全屏中应用捏合。** 否决：全屏外框不属于画布，且其 wheel 已阻止看板缩放并同时阻止页面捏合，gesture 事件遵循同一规则。
- **沿用 `zoomTowardPointer` 名称。** 否决：调用方现在计算因子与比例，动作接收因子；旧名称会错误描述契约。

## Consequences

在看板的每个位置——画布、窗口、聊天面板与导轨、浮动浮层——捏合现在只围绕手势缩放看板，滑动平移看板，缩放跟随手势幅度；键盘视图命令只在看板上方生效；看板之外的误触捏合不再缩放外壳。窗口的提示与菜单以窗口缩放渲染在看板的屏幕空间，被限制在看板盒内，跟随平移与缩放，并在窗口生命周期变化时关闭；dock 与 omnibar 的浮层以缩放 1 挂到同一层。代价：`ui-primitives` 的行为在整个应用范围改变——`Tooltip` 始终 portal、`Menu` 始终限高并 portal——这些上游包改动作为 fork 分歧记录在 `docs/ketos/upstream-sync.md`，`ui-trajectory` 测试改为在 `document` 中查询气泡；旧的 `zoomTowardPointer`/`setPan`+`setZoom` 复位 API 已移除；外壳防线不覆盖挂到 `document.body` 的浮层（П-37，推迟到 Д6.4）。本记录是阶段的首篇 Agent Note；Д7.2 将以安全区域、窗口聊天面板与 `WorkspaceBrowser` 接缝扩展它。

## Testing

`packages/client/ui-board/tests/wheel-zoom.client.spec.ts`（目标 × 修饰键 × 模式 × 全屏表格、平移增量、因子归一与截断）、`keyboard-zoom.client.spec.ts`（看板内条件的两侧）、`pinch.client.spec.ts`、`store.client.spec.ts`（`zoomBy` 锚点、对称、上下限；`panBy`；`resetView`）、`slots.client.spec.tsx`（wheel、Safari 手势、带偏移根节点的看板锚点、全屏阻止、按键作用域）与 `board-popover.client.spec.tsx`（菜单跟随平移与缩放，在窗口生命周期变化时关闭）。`packages/client/ui-primitives/tests/popover-host.client.spec.tsx` 与 `menu-host.client.spec.tsx` 覆盖宿主契约、子菜单翻转与高度上限；`tooltip.client.spec.tsx` 覆盖 portal 定位与边界钳制。`packages/client/ui-layout/tests/pinch-guard.client.spec.ts` 与 `app-frame.client.spec.tsx` 覆盖外壳防线。`apps/web/tests/board-geometry.e2e.ts`（Д0.2）测量组装后的行为：窗口、面板、导轨、dock 与侧栏上的捏合；滑动；成比例缩放；缩放 0.5/1/2 下的提示与菜单；子菜单翻转与高度上限。

## Related

- [Board gestures, culling, and the window-manager budgets](2026-09-17-ketos-board-gestures-culling.zh.md) — 部分取代：其 wheel 段落（`zoomTowardPointer`、全屏把整个事件留给车道）与 `Ctrl/Cmd+0` 一句描述的是本记录所替换的行为；指针手势归属、裁剪与 z 带决策仍然有效。
- [Shared client control primitives](2026-09-05-shared-client-control-primitives.zh.md) — 承载 `PopoverHost`、`Tooltip` 与 `Menu` 的包。
- [`docs/ketos/board-audit-plan.md`](../../../../docs/ketos/board-audit-plan.md) — 审计与 Д1/Д2 子阶段（П-01 … П-15）。
- [`docs/ketos/upstream-sync.md`](../../../../docs/ketos/upstream-sync.md) — `ui-primitives` 与 `ui-layout` 的 fork 分歧记录。
