# Agent Note: Board window preset and model selection — defaults, catalog, and refusals

Status: implemented

[English](2026-09-19-ketos-board-presets-models.md) | 中文

## Problem

阶段 4 把 agent 预设芯片与模型芯片放进了窗口 composer，但选择面仍停留在早期原型。阶段 10 的实机审计发现：主面板能列出模型，而窗口的模型芯片却显示「未选择模型」且菜单为空——看板从未声明 `remote.session`，而 `ui-model-selection` 通过调用方上下文解析宿主目录，于是 `ModelDirectoryResolver` 抛出 `cannot get property "remote.session" without inject`，该会话的目录什么也不发布；这个失败不可见，因为看板从不渲染 `BoardModelState.error`。窗口的预设名册每个 bridge 只取一次并进程级缓存，会提供宿主标记为 `broken` 的行，也忽略部署的 `modeSelectionEnabled` 策略。没有任何窗口记住预设：每个新窗口都由部署默认组合，用户在一个窗口上的选择永远不会传到下一个，看板也没有存储任何相关内容。被拒绝的切换（`agent-preset/locked` 等）以宿主原始的 `code: message` 追加到通用提示失败行上；而模型芯片的真实副作用——`remote.session.selectModel` 会把选择保存为 `agent-default-model` 系统默认——任何地方都没有说明。

## Decision

**看板声明 `remote.session`，因为模型目录通过调用方上下文读取宿主目录。** `ModelDirectoryResolver.directoryFor(sessionId)` 在调用方上下文追踪器之后运行，因此每会话的 `ModelDirectory` 只有在调用插件的 inject 声明了该命名空间时才能解析 `remote.session.modelCatalog()`。把 `remote.session` 加入看板的 inject 列表后，窗口目录会发布目录分组、当前选择与推理等级表，芯片显示实际生效的模型。这也解释了失败为何不可见：bridge 把异常收进 `model.error`，而没有任何地方渲染它。模型菜单现在把该错误作为独立一行显示，窗口保持可用——目录故障是菜单级状态，不是 composer 阻塞。

**看板记住自己的预设默认值。** `defaultPreset` 是 `ui-board` settings 段的一个字段（schema、store、capture、repair），bridge 在创建窗口或聊天的新会话时应用它：一个 `create → select` 对，受会话仍为空白、选择已匹配、以及部署的选择策略三个条件保护——settings 文档变化时会刷新应用侧策略，因此用户一旦关闭可见预设选择，记住的选择会在文档生效的那一刻停止组合。每一次成功的选择——composer 芯片或 Omnibox 的创建子菜单——都通过同一字段被记住，因此最后一次选择成为下一个窗口的默认值，并随布局在重载后保留。宿主拒绝的默认值会像显式选择一样被报告，而不是静默忽略：部署可能已经移除了用户记得选择的预设。

**名册每次 attach 重新读取，并携带其策略。** bridge 不再进程级缓存名册：部署随时可以改变其根，过期名册会提供无法再组合的行，因此每次 attach 都重新读取，而看板 chrome 在创建菜单打开时也会重新读取自己的副本。行在窗口通道中保留宿主的 `broken` 原因与 `isDefault` 标记——当前预设仍能解析其标签——而 composer 菜单与 Omnibox 创建子菜单绝不提供 broken 行。名册的 `modeSelectionEnabled` 策略门控可见选择：为 false 时窗口隐藏预设芯片，Omnibox 去掉其「预设」条目，因为无法行动的控件比没有更糟。

**预设拒绝按错误码本地化，模型芯片说明其副作用。** `agent-preset/locked` 渲染为「新建会话以切换预设」的原因，`agent-preset/not-found` 渲染为预设不存在，`agent-preset/invalid` 与 `agent-preset/read-only` 携带宿主自身的原因，未知码保持原文；该行显示在 composer 下方、紧邻引发它的芯片，并在下次选择时清除。模型芯片的提示说明当前生效的模型与推理等级，并指出切换会保存为新会话的系统默认值，使芯片的作用范围诚实；选择模型只调用 `selectModel`，因此生效的预设绝不会在用户不知情时改变。

## Alternatives considered

- **让窗口没有预设默认值。** 拒绝：计划要求新窗口以所选预设启动，而没有存储的默认值时每个窗口都静默组合部署默认，用户必须在每个窗口重复芯片上的选择。
- **把默认值应用到 bridge 绑定的每个会话，包括恢复与重新绑定的聊天。** 拒绝：已开始会话的组合按设计固定（宿主会锁定），而对重新绑定的聊天再次选择要么失败，要么更糟——改变用户恢复的对话的组合。
- **在 bridge 上缓存名册。** 拒绝：它很小、在 attach 时读取即可，而进程级缓存会持续提供部署已经移除的预设——本阶段的实机名册已经与出厂默认集不同。
- **从通道中隐藏 broken 行。** 拒绝：当前预设的标签通过名册解析，由现已 broken 的预设组合出的会话仍必须能命名它。
- **把模型目录错误渲染为常驻 composer 行。** 拒绝：错误应出现在用户可以处理它的地方（模型菜单），目录中断是暂时的，而窗口保持可用。
- **预设拒绝保留宿主原始失败文本。** 拒绝：计划要求区分并本地化各种原因，而 `agent-preset/locked` 是最常见的一种——它需要补救办法，而不是错误码。

## Consequences

新窗口现在以用户最后一次选择的预设启动，窗口的模型芯片显示真实模型并诚实提示系统默认，无法组合会话的预设绝不会被提供，被拒绝的切换用用户的语言解释自己。接受的代价：记住的默认值是看板级而非按项目或按窗口类型；创建时的快速选择位于 Omnibox，而不是聊天面板中的一步；当 `modeSelectionEnabled` 为 false 时看板完全失去芯片而不是显示禁用状态；模型芯片的菜单错误是目录故障唯一的具名位置，因此从不打开菜单的用户只会看到先前的选择而没有解释。

验证：`tests/composer.client.spec.tsx`（策略隐藏芯片、绝不提供 broken 行、本地化拒绝行、已开始会话原因、模型提示中的模型/等级/系统默认文案、模型菜单内的目录错误、选择模型不触碰预设），`tests/session-bridge.client.spec.ts`（默认值应用到新建空白会话、无默认值时不选择、记住选择、locked 拒绝映射为本地化原因并由下次选择清除、名册的 broken/isDefault/picker 策略映射、已开始会话不应用默认值），`tests/omnibox.client.spec.tsx`（「预设」子菜单记住选择并以它打开窗口、策略禁用时不出现条目），`tests/board-layout.client.spec.ts`（默认预设的 capture、repair 与 hydrate），以及实机审计 `.playwright-mcp/stage-11-gif/audit/audit.json`（7 项检查，`ok: true`：窗口内的模型目录、提示、名册、创建时选择、重载后保留的默认值、以及最小与宽窗口尺寸下的菜单）。

## Related

- [Board window dialog parity](2026-09-19-ketos-board-dialog-streaming.zh.md) — 本笔记芯片所在的 composer、队列与错误表面。
- [Board windows restore their Harness sessions](../architecture/2026-09-19-ketos-board-session-restore.zh.md) — 本笔记的默认预设加入的会话绑定与 settings 段。
