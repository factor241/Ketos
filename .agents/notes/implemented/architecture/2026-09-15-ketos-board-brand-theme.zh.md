# Agent Note: Ketos 看板调色板是一个限定范围的品牌层

Status: implemented

[English](2026-09-15-ketos-board-brand-theme.md) | 中文

## Problem

`packages/client/ui-board` 把整套视觉语言画成了字面值：每个组件（画布、两种窗口外框、dock、omnibox、小地图、选择遮罩）的内联 React 样式里都是 hex 颜色，中性 1px 边框旁边配着自制的 `rgba()` 阴影，小地图图例只有两种硬编码颜色。阶段 4 计划还提到全局 `src/client/tokens.css`；阶段 2 已经删除了该文件，因此剩下的是内联声明以及那些不可达的连接器条目。仓库规则（[`docs/web-styling.md`](../../../../docs/web-styling.zh.md)）规定：全局样式表与 `--dsw-*` token 位于 `ui-theme/src/styles/`，功能组件通过 CSS Modules 与 `clsx` 消费语义别名，字面颜色被禁止。

看板的组合方式使直接替换 token 并不充分。同一棵子树里混合了奶油色画布、石墨色浮动浮层与白色工具窗口，而语义别名在每个元素上只解析为一个值：`--dsw-alias-label-primary` 不可能既作为卡片上的近白色文本，又作为两层之下窗口里的近黑色文本。重绘 `body`（或全局覆盖应用调色板）会连带重绘其他所有面板与两套基础方案。

## Decision

`ui-theme` 新增品牌层 `src/styles/ketos-brand.css`，与其他全局样式表一同注册；它只声明一次 Ketos 映射，且只作用于 `.board-canvas`——看板根节点在自身 CSS Module 类之外携带的字面类。`body` 与 `body[data-ds-dark-theme]` 保持不变，因此周围面板与基础调色板在任一偏好下都不受影响。

- 表面：画布 `--dsw-alias-bg-base`；石墨卡片 `--dsw-alias-bg-layer-1`；dock `--dsw-alias-bg-layer-2`；抬升的内层卡片与菜单 `--dsw-alias-bg-layer-3`；胶囊与提示 `--dsw-alias-bg-overlay`；composer `--dsw-specific-input-major`；浮动圆形控件 `--dsw-alias-button-floating-fill`。
- 文本：`--dsw-alias-label-primary`/`-secondary`/`-tertiary`，以及在品牌填充上的 `--dsw-alias-label-primary-inverted`。
- 强调与状态：`--dsw-alias-brand-primary`（陶土色）、完成徽章的 `--dsw-alias-state-success-primary`/`-secondary`、窗口缩放圆点的 `--dsw-alias-state-success-tertiary`（唯一需要饱和绿色的位置）、关闭/最小化圆点的 `--dsw-alias-state-error-primary`/`-warn-primary`、非 agent 小地图矩形的 `--dsw-alias-state-business-primary`。
- 边框与投影：`--dsw-alias-border-l1` 分隔浮层区域，`--dsw-alias-border-l2` 描边外框，品牌层把 `--dsw-elevation-stroke-color` 重绑到该外框色，让投影发丝线承载描边。每个高层级表面设 `border: 0` 并取 `--dsw-elevation-panel`/`-prominent`/`-soft`；内部分隔线是 0.5px 发丝线。聚焦窗口在自身模块中把描边色重绑到品牌强调色，而不是换成字面边框。

白色工具窗口是同一调色板的重绑，而非第二套调色板：外框携带 `data-board-surface="light"`，品牌层为那棵子树重绑同一组别名（白色填充、暖色标题栏、浅色发丝线、深色墨色、开关轨道、输入框填充）。

每个组件在自身旁边拥有一个 CSS Module（画布、两种外框、两种窗口 body、dock、omnibox、小地图、选择遮罩、看板根节点）。内联样式仅保留来自 store 的放置（窗口 `left/top/width/height/z-index`）与作为组件本地自定义属性传入的计算度量（`--board-zoom`、`--board-pan-x/y`、`--board-canvas-grid*`），随缩放变化的点阵网格正因此保持为看板状态的纯函数。画布点色是唯一没有别名的看板本地取值，作为画布模块的自定义属性保留；它是品牌层之外唯一的字面颜色。

本地化沿用阶段 0 的机制：`src/client/locale.ts` 的 `board` 命名空间词典（`zh` 与 `en`）仍是唯一的文案所有者，ru 由 `packages/ketos/client-locale-ru` 提供，`tests/fixtures/ru-keys.json` 清单已重新同步。两条命名了产品并不具备的能力的连接器条目（`temporal`、`mcp`）已从两种语言与名册中删除，且没有留下替代占位。

`inject` 保持 `['slots', 'locale']`。看板不读取任何 layout 服务：`ctx.slots.inject('main', …)` 等待的是 ui-layout 做出的槽位*声明*，这也是类型-only 引入 `@deepseek-ai/dsh-client-ui-layout/client` 的原因；另一个 `main` occupant ui-conversation 同样没有注入 `layout`。

## Alternatives considered

- **按计划字面把 `layout` 加入 `inject`。** 否决：看板不使用任何 layout 服务，未被读取的服务边会让 fiber 等待一个无关的 provider；向槽位注册等待的是声明，而不是声明方插件的服务。
- **现在就创建 `@ketos/brand`。** 计划允许在 MVP 之后做；为一个 ui-theme 已经拥有并按顺序注入的样式表新建包，需要三处注册面与一个客户端 bundle peer。
- **全局覆盖应用调色板。** 否决：看板只是众多面板之一，`body[data-ds-dark-theme]` 必须继续驱动外壳其余部分。
- **为交通灯圆点、小地图蓝色与开关轨道新增看板专属 `--dsw-specific-board-*` token。** 否决，改用既有的状态/业务/别名 token；只有画布点阵需要一个看板本地取值，它位于画布模块内。
- **保留外框的 1px 中性边框与自制阴影。** 被仓库 spec 否决：宽于 0.5px 的中性边框，或与中性边框配对出现的 elevation 阴影，都会让 ui-theme 的 `pnpm run test:gui` 变红。
- **把侧栏面板图标重绘为陶土色。** 该图标位于 `.board-canvas` 之外；现在它跟随 `currentColor`（激活时加 `--dsw-alias-brand-primary`），因此外壳层面的品牌改动仍由外壳决定。
- **连接器开关改用 ui-primitives 的 `Switch`。** 暂缓：该面板是没有切换行为的静态名册，替换控件只会增加依赖并改变标记，而不带来行为。

## Consequences

看板保持一套不随 Harness 明暗偏好变化的调色板，这是品牌要求，现已写入包 README 的限制条目。调色板的唯一来源是品牌层；看板组件只能引用别名，因此对 `packages/client/ui-board/src` 执行 `grep` 找不到 hex 颜色，只有一处 `rgba()`（点阵）。浅色表面标记使用 data 属性而非类，因为该重绑必须能从 ui-theme 样式表触达，而不依赖哈希后的类名。

验证：`pnpm run test:gui`（385 个文件）覆盖 ui-theme 的样式表契约（elevation 发丝线与中性边框配对、整圆 `corner-shape` 配对、高层级表面上的滚动条重绑——两个滚动的看板 body 都重绑 l2 thumb 对）与看板 spec，后者现在断言模块类与自定义属性度量，而不是内联颜色。`pnpm run verify-client-ui-i18n` 与 `pnpm run verify-translation-pairing` 为绿，`DSH_SNAPSHOT=replay pnpm run test:web` 无差异。

## Related

- [`docs/web-styling.md`](../../../../docs/web-styling.zh.md) —— 本决定遵循的 token 所有权与组件规则。
- [`packages/client/ui-theme/README.md`](../../../../packages/client/ui-theme/README.zh.md) —— 品牌层加入的样式表顺序。
- [看板槽位组合](2026-09-15-ketos-board-slot-composition.zh.md) —— 本样式层所渲染的组合。
