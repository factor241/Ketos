# Agent Note: 看板笔画——自由绘制与擦除

Status: implemented

[English](2026-10-06-ketos-board-strokes.md) | 中文

## Problem

看板文档（阶段 28）带有 `stroke` 类型，但它没有自己的规则：任何 JSON 对象都会被接受，没有任何东西渲染它，也无法绘制、擦除或选中一条手绘线。阶段 30 必须让绘制精准——线条在任何缩放下都保持在光标正下方，包括在一条笔画中途滚轮缩放——同时存储数据要足够紧凑以符合文档上限，并且足够确定，使两个 Ketos 实例渲染出完全相同的路径（阶段 33）。橡皮擦必须每次经过以一个原子批次移除自己笔画的部分，而 50 条笔画的负载不得把平移与缩放压到该线 55 FPS 的预算以下。

## Decision

**笔画存储相对、取整后的描点。** `StrokeData` 恰好是 `{ points, width, pen }`：2 到 `strokePointsMax` 个相对于元素 `(x, y)` 的 `[x, y, pressure]` 三元组、`s`、`m`、`l` 之一的粗细（4、8 或 16 世界单位），以及是否由触控笔绘制。`strokeBounds` 把绝对描点解析为 `x = min − width/2`、`y = min − width/2`、`w = 跨度 + width`、`h = 跨度 + width`，并把描点改写为相对该框的坐标，坐标取整到 0.1、压力取整到 0.01。因此移动笔画是一次 `patch { x, y }`，绝不重写描点，2000 点的图形也保持在 256 KiB 的元素预算内。

**渲染是数据的纯函数。** `strokeToSvgPath` 调用 `perfect-freehand` 的 `getStroke`，选项只由 `width` 与 `pen` 推导（`size: STROKE_SIZES[width]`、`thinning: 0.5`、`smoothing: 0.5`、`streamline: 0.3`、`simulatePressure: !pen`、`last: true`），并用 README 的二次曲线中点构造把轮廓转成路径。`simulatePressure` 是触控笔标志唯一控制的选项：触控笔报告真实压力，鼠标不报告；其余选择都是常量。路径按 `StrokeData` 引用记忆化，主体也按存储的 `element.data` 引用记忆化其解析结果，因此平移与缩放绝不会重新计算未变化的笔画。

**橡皮擦按线段到线段测量距离。** `eraseStroke` 丢弃距离橡皮擦路径小于半径的描点，并在任一笔画线段与任一路径线段距离小于半径处断开笔画——快速鼠标会在两个采样点之间跨过笔画，只检查描点会留下缺口。剩余片段不足两点即被丢弃。半径是所选粗细的固定屏幕半径（`6/12/24 px`）除以实时缩放，这也正是画布绘制的圆环。

**每个手势一个操作批次。** 画笔在 pointerup 时恰好提交一次 `create`，先经 Ramer–Douglas–Peucker 以递增容差简化；pointercancel 或不足两点则完全不提交。橡皮擦每次经过恰好提交一个批次——对每条被触及的笔画 `remove`，并为每个剩余片段 `create`——通过注入的 `eraseStrokes` 动词完成；本地移除与创建先落地，宿主拒绝时用新快照与看板提示清除乐观切片。他人的笔画在过开始前就被过滤掉，绝不会成为候选。

**擦除的实时预览是瞬时 store 状态。** 一次经过进行期间，`eraserPreview` 持有被触及的元素 id 与剩余片段；元素层跳过被隐藏的 id，画布用与画笔线条相同的 `StrokeDraft` 绘制这些片段。预览绝不进入文档，pointercancel 或卸载会清除它。

**工具是瞬时的视图状态。** `tool`（`select`/`brush`/`eraser`）与 `brushWidth` 存在于看板 store，绝不进入布局文档；切换到画笔或橡皮擦会离开检查器与便签编辑器，进入其中任何一个都会离开工具；Escape 阶梯在元素选择与窗口面板之间新增了工具一级（`菜单 → 编辑器 → 选择 → 工具 → 面板`）。

**`perfect-freehand` 1.2.3 是 `@deepseek-ai/dsh-client-ui-board` 的 `devDependencies` 条目。** 它是仅浏览器端的实现库，按[依赖声明规则](../../../../packages/client/AGENTS.md#dependency-declaration)应放在 `devDependencies`；客户端打包将其内联，`THIRD_PARTY_NOTICES.md` 予以披露，遵循[优先维护依赖而非手写](../process/2026-07-26-dependencies-over-hand-rolling.zh.md)的政策。

## Alternatives considered

- **存储绝对描点并在每次移动时重写。** 否决：移动长图形会重写数千个坐标，而线上 patch 是整值写入。
- **存储未取整的描点。** 否决：全精度浮点几乎使序列化体积增至三倍，且不同引擎会产生不同 JSON。
- **橡皮擦只按描点测距。** 否决：稀疏的指针采样会在快速笔画上留下可见的桥接。
- **把每个擦除片段作为独立操作提交。** 否决：一次经过必须是一个原子批次，拒绝时文档应保持手势之前的样子。
- **手写笔画轮廓。** 否决：轮廓算法很微妙，维护良好的库正是政策的选择。

## Consequences

画布为画笔线条与橡皮擦片段保留同一条代码路径（`StrokeDraft`），它位于 `canvas/` 而不是计划的 `elements/` 路径，因为客户端域图门禁禁止 `canvas/` 模块导入 `elements/`。`parseStrokeData` 需要元素框，因此 `validateElementData` 增加第四个参数框；`BoardLimits` 新增 `strokePointsMax`（默认 2000），快照会发布它。单次橡皮擦经过是一个请求，受 `maxOpsPerRequest`（64）与 `maxRequestBytes` 约束；触及笔画数超过批次上限的经过会被拒绝并给出提示与新快照，而不是拆成多个批次。50 条笔画的基准把预算记录在 [perf-baseline.md](../../../../docs/ketos/perf-baseline.md)：平移 60.2 FPS、缩放 60.7 FPS，0 个长任务。

## Testing

`packages/ketos/board-doc/tests/stroke.spec.ts` 覆盖解析（每种粗细、两种触控笔标志、边界、描点数量与字节上限、经路由的畸形表）、框解析与取整、简化上限，以及全部橡皮擦情形（中段分裂、边缘缩短、稀疏路径断开、丢弃过短片段、退化与平行路径线段）；该包保持每文件 100% 覆盖。`packages/client/ui-board/tests` 覆盖路径确定性与记忆化、笔画主体与回退、工具模式互斥、画布路由、绘制（一次操作、取消、点击、平移/缩放换算、笔画中途缩放、实时草稿）、擦除（一个批次、分裂、缩短、跳过他人、取消、预览）以及选中/移动/删除。`apps/web/tests/board-elements.e2e.ts` 在缩放 0.5 与 2、平移之后以及笔画中途 `Ctrl`+滚轮缩放下用真实鼠标绘制光标正下方的笔画，然后选中、移动并删除其中一条；`apps/web/tests/board-strokes.perf.ts` 测量 50 条笔画的负载。

## Related

- [看板文档及其元素模型](2026-10-06-ketos-board-element-document.zh.md) —— 笔画加入的信封、路由与元素类型。
- [`@ketos/board-doc` README](../../../../packages/ketos/board-doc/README.zh.md) —— `stroke` 数据规则与 `strokePointsMax`。
- [`@deepseek-ai/dsh-client-ui-board` README](../../../../packages/client/ui-board/README.zh.md) —— 产品契约中的工具模式与笔画渲染。
- [Ketos 性能基线](../../../../docs/ketos/perf-baseline.md) —— 阶段 30 的测量。
