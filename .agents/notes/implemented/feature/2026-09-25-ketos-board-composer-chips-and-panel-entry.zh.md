# Agent Note: 看板合成器芯片保持单行，聊天面板只有一个入口

Status: implemented

[English](2026-09-25-ketos-board-composer-chips-and-panel-entry.md) | 中文

## 问题

看板窗口合成器的工具行在卡片宽度 545px 处换行，而浮动窗口在最小窗口尺寸下的卡片宽度最多约 488px——因此接近默认与最小宽度时该行总会分裂，权限与模型芯片离开发送控件所在的行，卡片为一行本可容纳的控件付出两行。下一个阈值处的响应式规则又直接移除权限与模型标签：不存在保留一个词的状态，模型芯片也没有可退化的字形，图标态会让它失去名称。

另外，窗口外框标题栏带有一个面板左栏按钮，与聊天面板导轨自身的展开控件重复：面板折叠时两者同时可见、都调用 `openWindowPanel`，而全屏下导轨被隐藏，使外框按钮成为返回已折叠面板的唯一途径。

## 决策

**工具行永不换行。** `.toolRow` 使用 `flex-wrap: nowrap`；前导组（操作与模式芯片）通过 `min-width: 0` 与 `overflow: hidden` 吸收挤压，尾随组（上下文圆环、模型芯片、发送）固定在右侧，由上限为 `min(360px, 45cqw)` 的模型芯片及其收缩优先级承担其余挤压。圆环与发送按钮保持 `flex: none`，因此两个设置芯片在任何宽度下都与发送控件同行，发送控件也永不移动。

**芯片标签由首词与可省略的剩余部分组成。** `splitChipLabel(text)` 按第一个空格切分；权限与模型芯片渲染 `.chipLead`（永不收缩，`flex: none`）与 `.chipRest`（可收缩，`text-overflow: ellipsis`）。没有空格的标签——所有中文标签——整段作为首词，这正是它正确的「一个词」单位。

**收缩顺序为：推理等级、模型剩余部分、权限剩余部分。** 推理等级标签 `flex-shrink: 1000`，模型名标签 `2`，权限标签 `1`，因此两个芯片都会先保住首词，再失去它。

**阈值先保一个词的底线，再退化为图标。** `≤455px` 时推理等级标签与两处剩余部分消失，每个芯片保留一个词（预设与计划芯片沿用既有的图标化切点）。`≤405px` 时权限与模型标签整体消失：权限芯片保留盾牌，模型芯片显示自己的 `IconDataOutline16`——它在常规宽度下默认隐藏。

**一个表面一个入口。** 外框标题栏的聊天按钮连同 `window.chats` 字典键一并移除；面板未打开时始终渲染的导轨与面板自身的标题栏承载开合控件。导轨现在在全屏下也渲染，贴在看板面板左侧的停靠面板边缘，因此折叠的面板在任何呈现下都可回到。

## 考虑的替代方案

- **用 JavaScript 测量该行**（`ResizeObserver` 加状态）。拒绝：卡片已声明 `container-type: inline-size`，该合成器的响应式规则全在 CSS；测量布局会在每次缩放时重渲染合成器，并在 TypeScript 中重复阈值。
- **单一阈值隐藏标签**（此前的行为）。拒绝：需求要求先有「一个词」的底线再进入图标态，而单一切点会删掉用户要求保留的那个词。
- **按语言分词。** 拒绝：按第一个空格切分已服务英文与俄文标签；中文标签没有空格，本身就是它自己的「一个词」单位。
- **仅在完整屏幕保留外框按钮。** 拒绝：一个表面应只有一个入口，而导轨可以通过贴着停靠边缘来服务全屏；为单一模式保留按钮会留下两个需要测试与记录的控件。
- **移除导轨、保留外框按钮。** 拒绝：导轨位于面板自身边缘，且已承载新建聊天、文件夹、产物与搜索入口；外框按钮才是重复的那个。

## 后果

权限与模型芯片在任何可达的浮动宽度下都与发送控件同行；两个阈值之间显示首词加省略的剩余部分，最窄阈值以下只有图标。模型芯片获得一个仅在图标态出现的字形，常规宽度保持原样。外框标题栏失去聊天按钮；面板在两种呈现下都从导轨打开、从自身标题栏收起，`window.chats` 从 en、zh、ru 词典中移除。

验证：`tests/composer.client.spec.tsx`（两个芯片的首词/剩余切分、推理等级分段与隐藏的模型字形）、`tests/conversation-body.client.spec.tsx`（权限芯片的切分标签）、`tests/slots.client.spec.tsx`（外框没有 Chats 按钮、导轨展开、全屏下位于看板面板左缘且收起后 inset 归零的导轨、Escape 阶梯）、`tests/window-chats-panel.client.spec.tsx`、`tests/window-title.client.spec.tsx`、`tests/clone-flow.client.spec.tsx`、`tests/minimap-layers.client.spec.tsx` 与 `tests/dock.client.spec.tsx`（所有面板入口改走导轨）、`tests/element-capture.client.spec.ts`（描述夹具）、ru 语料包规范及其键语料，以及 `pnpm run test:gui`。

## 相关

- [聊天面板是窗口自身的主体，从外框旁滑出并在全屏下停靠](../architecture/2026-09-16-ketos-board-window-chats-panel.zh.md) —— 本决策调整的面板、其导轨与几何。
- [命令标识与合成器文件动作](../architecture/2026-09-10-command-identities-and-composer-file-action.zh.md) —— 本变更未触及的合成器命令面。
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.zh.md) —— 合成器与面板契约中更新后的响应式与入口表述。
