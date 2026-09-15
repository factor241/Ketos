# Agent Note: 看板使用共享的 Harness 主题与控件绘制

Status: implemented

[English](2026-09-15-ketos-board-harness-theme.md) | 中文

## Problem

看板曾自带一套视觉语言。阶段 4 把调色板移入 `ui-theme` 的品牌层（`ketos-brand.css`），在 `.board-canvas` 内重绑语义别名到 Ketos 的奶油／石墨／陶土取值，组件则以这些被重绑的别名重建为 CSS Modules。这在形式上满足了样式规则——没有字面值、只有一处声明——却使看板成为唯一无视应用调色板的面板：在浅色外壳下画布仍是奶油色、卡片仍是深色，而标题栏的状态胶囊、dock 字形与小地图图例都是看板自造的（交通灯圆点、emoji 字形、双色窗口图例）。

产品决定改变了：每个面向用户的表面——包括设置与窗口外框——都必须读起来像 DeepSeek Harness：共享调色板、共享控件，以及主题的明暗行为。因此阶段计划 §4.8 的要求（«палитра Кетос … только на селекторе `.board-canvas`»）由用户决定废止，本记录记下替代方案。

## Decision

品牌层被删除。`ui-theme` 恢复为六张基础样式表，看板根节点不再携带 `board-canvas` 钩子，工具窗口也不再把自己标记为浅色子表面。看板的每一条规则现在只引用主题自身的别名，并跟随外壳方案：

- 窗口与 dock 外框使用外壳其余部分同样使用的浮层面板配方：`--dsw-alias-bg-layer-2`、`border: 0`、`box-shadow: var(--dsw-elevation-prominent)`、`--dsw-elevation-stroke-color: var(--dsw-alias-border-l2)`；聚焦窗口只把该描边重绑到 `--dsw-alias-state-business-primary`。
- 表面与文字使用基础色阶：画布 `bg-base`，内嵌卡片与胶囊 `bg-layer-1`/`bg-layer-3`，composer 与 Omnibox `--dsw-specific-input-major`，composer 动作 `--dsw-specific-selector`，墨色 `--dsw-alias-label-primary`/`-secondary`/`-tertiary`，`0.5px` 的 `--dsw-alias-border-l1/l2` 发丝线，以及两个滚动 body 上的 l2 滚动条对。
- 画布点阵跟随 `--dsw-alias-border-l3`，不再使用看板本地字面值：网格在两种调色板下都可见，包内也再没有任何字面颜色。
- 小地图图例由主题拥有：agent 窗口取 `--dsw-alias-state-business-primary`，其他窗口取 `--dsw-alias-label-caption`，视锥取业务强调色的淡着色。

外框控件来自共享目录（`ui-primitives`，baseline 模块），而非看板自造：窗口关闭用 `IconCloseOutline16`，dock 动作用 `IconPlusOutline16`/`IconFullscreenOutline16`，窗口行用 `IconAgentPresetOutline16`/`IconBrowseOutline16`，Omnibox 用 `IconPaperclipOutline16`/`IconGlobeOutline14`/`IconInspectOutline12`/`IconSparkle16`/`IconSendOutline16`，每个纯图标控件与 dock 行都包在 `Tooltip` 中，Omnibox 操作菜单用 `Menu`，窗口状态胶囊用 `Tag`。交通灯圆点消失；带关闭／复制的 `•••` 窗口菜单属于阶段 6，因此当前每个外框只有一个关闭按钮。

模拟内容被删除而不是重新着色：连接器面板的三个假开关、设置面板的假模型列表与 system prompt 文本域、它们的标签栏、dock 的连接器按钮、Omnibox 的连接器条目，以及承载这些文案的每一个词典键。`board.window.body` 现在只提供 `conversation`；各窗口类型仍保持注册，拥有其内容的阶段无需改动外框即可注册 body。

## Alternatives considered

- **保留品牌层，只把它换成 Harness 取值。** 否决：范围化覆盖层的存在意义就是安装主题没有的取值；保留它等于保留本次改动要消除的漂移，而且今后每次主题改动都要在那里镜像一遍。
- **让看板窗口改用 `ui-dockkit` 的 `FloatLayer`。** 否决：dock kit 的浮层位于视口坐标且只有单角缩放，而看板窗口是随画布变换缩放的世界坐标对象、带 8 方向手柄。我们复制的是它的*配方*（填充、圆角、elevation 发丝线），而不是组件。
- **现在就为模拟面板接上真实数据。** `ctx.modelDirectories`、`remote.session.modelCatalog/selectModel` 与 `remote.agentPresets.*` 是真实来源，但接线属于阶段 11 与 13，而且 Harness 的设置分区无法挂载到声明它的设置面板之外。提供没有入口的空外框是诚实的中间状态。
- **把 `--dsw-alias-brand-primary` 当作强调色。** 被 `ui-dockkit/README.md` 记录的平台规则否决：本平台把 `brand-primary` 绑定为近黑（浅色）或近白（深色）前景，强调色是 `--dsw-alias-state-business-primary`（对话标签栏已经这么做）。
- **用 `Button` 与 `Switch` 原语承载圆形图标控件。** 否决：目录没有纯图标圆形变体（`Button` 的尺寸都是胶囊），而剩余的布尔控件正是本次删除的模拟内容。当第二个消费方需要圆形图标按钮时，才是把它提升进原语包的时机。
- **把 emoji 字形当作「图标」保留。** 否决：目录提供 78 个跟随 `currentColor` 与主题尺寸的字形，正是它们让外框读起来像 Harness。

## Consequences

看板与其他面板一样跟随应用的明暗偏好；奶油色画布或永久深色卡片不再可能出现，这正是本次反转的目的。窗口／工具／设置外框类型保持注册，但没有任何入口打开它们，`board.window.body` 报告一个被占用的键（`conversation`）。

调色板的唯一来源是 `ui-theme`，因此未来的品牌改动会免费到达看板。看板只保留自己的几何（世界放置、8 方向手柄、随缩放变化的网格度量），两个重复项（两个外框中的缩放算法与手柄 CSS）仍由 `ketos-4k3` 跟踪。

验证：`packages/client/ui-board` 中没有 hex/rgba 字面值与 emoji 字形；`grep` 找不到 `ketos-brand`、`board-canvas` 或 `data-board-surface`；`pnpm run test:gui` 覆盖 ui-theme 样式表契约与看板 spec（按 kind 分发外框、body 切换、经外框关闭、dock/Omnibox 动作）；`DSH_SNAPSHOT=replay pnpm run test:web` 无差异；看板在两种外壳方案下都做过实机检查。

## Related

- [看板调色板曾是限定范围的品牌层](../../archived/architecture/2026-09-15-ketos-board-brand-theme.md) —— 被取代的决定及其被否决的备选方案。
- [看板槽位组合](2026-09-15-ketos-board-slot-composition.zh.md) —— 本样式层所渲染的组合。
- [`packages/client/ui-primitives/README.md`](../../../../packages/client/ui-primitives/README.zh.md) —— 外框现在据以组合的目录。
- [`packages/client/ui-dockkit/README.md`](../../../../packages/client/ui-dockkit/README.zh.md) —— 「`brand-primary` 是墨色而非强调色」的平台规则。
