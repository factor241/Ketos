# Agent Note: 看板手势、裁剪与窗口管理器预算

Status: implemented

[English](2026-09-17-ketos-board-gestures-culling.md) | 中文

## Problem

阶段 4 交付了看板的窗口模型，却留下了引擎的薄弱点：在 `pointerdown` 内注册的拖动与缩放手柄监听器会在手势中途卸载后继续存活；wheel 处理走的是 React 的被动 `onWheel`，因此每次缩放都会记录 `preventDefault` 错误，而落在窗口车道上的滚轮会缩放而不是滚动车道；视口只在挂载与 `window.resize` 时测量，折叠侧栏会让小地图视锥与 `centerOnWindow` 失真；画布重复携带两处 `data-surface="canvas"`；屏幕外的窗口没有任何裁剪；每个外框在每次缩放时都重渲染，因为它自行读取 `zoom`；而滑到浮动浮层下方的窗口边缘会让缩放手柄无法用指针触达。本阶段的预算是在打开聊天面板的情况下平移与缩放 20 个窗口时保持 ≥ 55 FPS（目标 60）。

## Decision

**每个指针手势只有一个归属。** `client/pointer-gesture.ts` 暴露 `startBoardPointerGesture(element, pointerId, handlers)`——它注册全局 `pointermove`/`pointerup`/`pointercancel` 监听器、释放指针捕获，且可重复调用——以及 `useBoardPointerGesture()` 钩子：组件卸载或开启新手势时结束当前手势。画布平移、标题栏拖动、窗口缩放（外框手柄与手柄环共用）、面板缩放与面板行重排都经过它，因此没有路径会留下监听器或捕获。

**wheel 归属跟随表面。** 看板根节点注册唯一的非被动 `wheel` 监听器（由 `canvas/wheel-zoom.ts` 判定它拥有哪些目标）：窗口或其聊天面板内部的滚轮保留自身滚动，落在画布或浮动浮层——浮层位于画布旁边而非内部——上的滚轮则通过 `zoomTowardPointer` 以指针为中心缩放。全屏把整个事件留给车道。

**键盘导航属于看板自身，并让位于编辑器。** 看板根节点在指针位于看板上时武装 Space，并持有捕获阶段的平移，因此按住 Space 拖动或用中键拖动可在看板内任意位置平移——浮动浮层同样有效；中键拖动缩放手柄时执行平移而非缩放，因为根节点先于外框或手柄环取得指针。`Ctrl/Cmd+0` 重置平移与缩放，而不是浏览器的页面缩放。两者都让位于聚焦的 input、textarea 或 contenteditable（`editing-target.ts`），且 Space 只在指针位于看板上时才武装，因此其他面板保留该键。全屏窗口保持恒等变换：没有任何平移路径会写入被隐藏的偏移，退出该模式即恢复用户安排的视图。

**每次按 Escape 只执行一个动作。** 顺序为：菜单 → 聚焦的编辑器 → 元素选择 → 聊天面板 → 全屏。选择覆盖层（`ElementSelectionOverlay`）让位于打开的菜单或聚焦的编辑器，外框的 Escape 处理在元素选择激活期间让位。折叠后的聊天面板只是一条导轨：不占宽度，看板在浮层与 Escape 上视其为关闭，dock 与小地图在面板折叠的那一刻返回。

**画布自行测量。** 画布容器上的 `ResizeObserver` 取代了挂载／`window.resize` 组合，成为 `viewportWidth/Height` 的唯一归属；`jsdom` 不实现它，因此单元测试通道保留挂载时的读取。

**窗口隐藏，而非卸载。** `canvas/culling.ts` 依据平移、缩放、视口与 480 世界单位的边距判定可见性，`isWindowHidden` 还会隐藏全屏窗口的邻居。外框与聊天面板通过各自的类与 `data-board-culled` 采用 `content-visibility: hidden`，从而保留车道、草稿、附件与面板状态——阶段 4 关于「全屏只渲染自身窗口」的规则被同一「隐藏而不卸载」规则取代。`BoardWindowLayer` 不再跳过外框，其 `renderBody` 分发器是单一稳定回调，因此被记忆化的外框与面板只会因自身窗口而重渲染。

**缩放读取位于手势开始之处。** `WindowFrame` 与 `WindowChatsPanel` 被记忆化，且不订阅任何平移或缩放：标题栏拖动与每个缩放手柄都是自行读取 `zoom` 的叶子组件，聊天面板在折叠时关闭几何订阅（导轨不跟随视图变换）。提起窗口只写入该窗口的 `zIndex`；store 的 z 区间上限为 `WINDOW_Z_MAX`（99，低于浮层的 100 与覆盖层的 500），并在区间耗尽时按绘制顺序重新归一，因此快照中其他窗口对象保持身份，其外框也跳过重渲染。

**浮层保留自己的指针；当前窗口的手柄升到其上。** 第一次尝试是让每个浮动层在当前窗口的缩放环与其测量盒相遇时淡出并交出指针事件（`chromeYields`）。实机审计否决了它：停在左缘的窗口会让 dock 完全失效，从而无法切换窗口或新增窗口。改为由 `window/HandleRing.tsx` 在看板根节点、浮层之上（z-index 150，低于 500 的元素选择覆盖层）绘制当前窗口的八个手柄，使用与画布相同的 `translate(pan) scale(zoom)` 投影，每个手柄都启动共享的缩放手势。非当前窗口保留既有外框手柄；全屏与被裁剪的窗口让手柄环一同让位。

**store 在每次插入时同时拥有区间与下限。** `insertWindow` 把调用方传入的任何 `zIndex` 夹进 `[WINDOW_Z_BASE, WINDOW_Z_MAX]`，因此恢复或播种的布局无法画到浮层之上；`openWindow` 把请求的尺寸夹到 `MIN_WINDOW_SIZE`，因此每种窗口（包括工具窗口）都以 composer 的下限打开。

**被取消的手势绝不提交。** 共享手势像其他结束一样转发 `pointercancel`，各站点自行决定其含义：面板行重排只在真正的 `pointerup` 上写入新顺序，因为取消意味着浏览器收回了手势，其下的放置目标没有意义。

**关闭的窗口释放其桥记录。** `BoardSessionBridge.release(windowId)` 丢弃该窗口的 channel 与会话订阅，`BoardWindowLayer` 会为每个离开打开集合的 id 调用它。会话本身保持存活并仍在列表中；重新出现的窗口 id 从全新的记录开始。该层还让窗口堆超出面板时的 dock 保持可用：导轨改为滚动（`max-height: calc(100% - 48px)`），而不是把行与控件裁到视口之外。

**看板根节点包含自身的层叠上下文。** 根节点上的 `isolation: isolate` 把窗口区间、浮层（100）、选择覆盖层（500）与全屏层（1000）都留在看板盒内，因此盒子之上的外壳级浮层会绘制并命中测试于所有看板层之上（`ketos-jdb`）。

## Alternatives considered

- **浮层向窗口边缘交出指针（已实现，随后移除）。** 当当前窗口的边缘带与其测量盒相遇时，让 dock、Omnibox 与小地图淡出并解除武装，确实解决了手柄可达性，却破坏了浮层自身的目的：窗口吸附到左缘时 dock 完全无法点击，审计把它抓成了无法点击的窗口行。手柄环让两者都可触达，且无需测量。
- **卸载被裁剪的窗口。** 否决：这会丢弃 composer 草稿、附件与面板层级，而本阶段的风险清单正把这列为要避免的失败。
- **把窗口夹在浮层条带之外。** 否决：条带固定在面板坐标系，而窗口位于世界坐标，平移或缩放仍会把窗口推入浮层之下；能存活下来的夹取将不得不对抗每一帧平移。
- **把整个当前窗口升到浮层之上。** 否决：那会让外框 body 盖住 dock 与小地图，为用户正在操作的那一个窗口推翻既有的层叠阶梯。
- **按帧批量合并 store 通知。** 暂缓，且并不需要：指针事件本就以帧为节奏到达，React 18 也会在一个手势处理函数内合并 move/resize 这对更新；`dsh-client-store` 的 `raf` 刷写仍是引擎选项，而非看板的必需品。
- **保留 `visibility: hidden` 而非 `content-visibility: hidden`。** 选择更重的变体：两者都保留状态，而 `content-visibility` 还会跳过子树的布局与绘制，这正是裁剪的意义。
- **让整个窗口区间使用无上限的 `10 + index`，并在超过上限后依赖 DOM 顺序。** 否决：该区间绝不能到达浮层或覆盖层，因此 store 选择设上限并按绘制顺序重新归一，而不是把取值夹成顶部的并列。

## Consequences

每个手势现在都有唯一的生命周期归属，wheel 不再记录错误或吞掉车道滚动，小地图与放置计算跟随真实面板盒，20 个窗口在平移与缩放期间保持 60 FPS。无头 Chromium，1440×900，改动前后使用同一 rAF 计数器：平移 59.9 FPS / 最差帧 26.8 ms，缩放 60.1 / 20.5，缩小后的整体布局 59.9 / 28.1，打开面板 60.2 / 24.3；stage-4 树以同一方法测得 60.1 / 28.3、60.0 / 34.7、60.1 / 27.5、60.1 / 31.4（产物 `.playwright-mcp/stage-05-gif/baseline-stage04.json`，该树为打开 20 个窗口补上了 dock 导轨的滚动规则）。rAF 上限为 60 Hz，因此可区分的信号是最差帧尾部，仅平移一项的差值落在运行间波动之内；方法与限制见 `docs/ketos/perf-baseline.md`。代价：位于浮层下方的非当前窗口手柄仍需先点击该窗口（手柄环跟随当前窗口）；窗口堆超过面板高度后 dock 改为滚动，而不是一次显示所有行；裁剪边距是固定的世界常量，而非窗口尺寸的函数。

验证：`tests/pointer-gesture.client.spec.tsx`（取消、销毁、卸载、手势替换）、`tests/wheel-zoom.client.spec.ts` 与组合规格中的 wheel 用例（车道／画布／浮层）、`tests/canvas.client.spec.tsx`（从裸画布平移、Space+拖动、`Ctrl/Cmd+0`、不同的表面标记、裁剪辅助函数）、`tests/culling.client.spec.ts`、`tests/store.client.spec.ts`（超过 90 个窗口的区间）、`tests/session-bridge.client.spec.ts`（释放后会话仍在），以及 `tests/slots.client.spec.tsx`（被裁剪窗口的草稿存活、dock 之上的手柄环、手柄环缩放、点击空画布保持当前窗口、每次按 Escape 只执行一个动作）。

## Related

- [Board windows own Harness sessions and rebuild the chat composer](2026-09-16-ketos-board-window-sessions.zh.md) —— 其记录现在跟随打开集合的桥。
- [Board windows fill the panel in fullscreen instead of handing off to the main panel](2026-09-16-ketos-board-window-fullscreen.zh.md) —— 已更新：全屏改为隐藏邻居，而不是卸载它们。
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.zh.md) —— 本阶段更新的交互与限制。
- 本阶段关闭的 Beads 记录：`ketos-0s0`（手势中途卸载后存活的监听器）、`ketos-3kf`（被动 wheel 监听器错误）、`ketos-zz0`（滚轮吞掉车道滚动）、`ketos-e9s`（浮层上的滚轮不再缩放）、`ketos-tmd`（陈旧的视口盒）、`ketos-0da`（重复的 `data-surface` 标记）、`ketos-d3a`（浮层下方的缩放手柄）与 `ketos-jdb`（看板浮层高于外框覆盖层）。
