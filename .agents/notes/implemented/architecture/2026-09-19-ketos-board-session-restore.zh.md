# Agent Note: Board windows restore their Harness sessions and reconcile them against the session list

Status: implemented

[English](2026-09-19-ketos-board-session-restore.md) | 中文

## Problem

阶段 4 让每个看板窗口拥有了真实会话，但窗口 id → 会话 id 映射只存在于 bridge 的 apply 闭包中：页面重载会经由 `ui-board` settings 命名空间恢复窗口矩形，却让每个窗口都没有会话，于是窗口正文为每个窗口新建了一个聊天。关闭窗口会释放它的 bridge 记录，已存布局也没有记录窗口显示的是哪个会话。窗口与会话列表之间同样没有任何对账：窗口打开期间（或进程关闭期间）被删除的聊天会让窗口继续附着在已死的会话上，而重新出现的聊天永远无法回来。重复规则也悬而未决：两个窗口可以附着同一个会话，项目可复用的空会话是最容易的一条路径。

## Decision

**bindings 映射是已存 `ui-board` 分节的另一半。** `BoardSettings`（schema 版本 1）在布局文档旁携带 `bindings: Record<windowId, sessionId>`。布局捕获仍不包含该映射——`captureBoardLayout` 只捕获 store，不懂会话——而 `BoardLayoutPersistence` 是唯一写入者，会发送完整分节（捕获的布局加上 bridge 的实时映射），因此布局手势与会话变更不可能通过两个 revision-CAS 写入者相互竞争。这次写入使用 `remote.settings.replace` 而非 `update`：settings 服务会深度合并 update 补丁，只有整节写入才能删除窗口关闭后的配对。`writeBindings` 替换映射并调度与布局相同的防抖、最小间隔、冲突重试写入，首帧缓存也往返携带两半。

**bridge 拥有实时映射，且只在离散事件上持久化。** `BoardSessionBridge.bindings()` 从记录派生映射；`switchTo`（创建、重绑、分支）与 `release`（窗口关闭）把它交给持久化钩子。帧从不写入。dispose 不写任何东西：卸载插件不是关闭。

**恢复是 adoption 监听，而不是挂载副作用。** `persistence.onAdopt` 在首帧缓存（首次渲染之前）与服务器分节（describe 镜像给出答案时）上触发；apply 注册 `bridge.restore(settings.bindings, layoutWindowIds)`，因此在任何窗口组件挂载之前窗口就已被指向自己的会话，`ensureWindowSession` 找到的是已绑定记录而不是再建一个聊天。`restore` 先把已存映射与布局对账——窗口已不存在的配对、以及映射中重复命名的会话，都会从已存映射里剔除（一个会话一个窗口；第一个窗口保留它）——然后把每个已绑定窗口与会话列表对账。

**`sessions.list` 是已绑定会话生命的权威。** 会话在列表中时窗口立即附着；主机尚未报告（列表仍为 `pending`）时窗口进入新的 `restoring` 状态；就绪列表不再持有的会话把窗口移入新的 `missing` 状态，但不删除窗口，同时清空派生的泳道状态（chat、queue、goal、context），保留最后的标题与目录供框架和「新建」操作使用。之后的列表快照若重新包含该会话，就再次附着；任何东西都不会自动创建替代会话：窗口提供「新建会话」（在最后已知目录中开聊天）与「选择聊天」（窗口的聊天面板）。dock 把 `restoring` 映射为 idle，把 `missing` 映射为 error。

**一个会话，一个窗口。** `bind` 返回可辨识的 `BoardBindOutcome`（`bound` | `same` | `duplicate` | `unknown`），不再静默忽略。另一个窗口已显示的聊天返回 `duplicate` 及其持有窗口 id，apply——唯一持有 store 动作的层——改为居中那个窗口而不是重绑；列表不认识的 id 返回 `unknown`，聊天面板与 OmniBox 把它报告为本地化的「聊天已不存在」提示。`startChat` 只在没有其他窗口显示时复用项目的空会话。OmniBox 菜单列出最近更新的六个聊天及其目录，并以同一规则重新打开：居中已显示它的窗口。

**落定的请求永远不会覆盖更新的手势。** `create`、`createChat`、`createChatTarget` 与 `forkChat` 在 await 之前捕获自己的窗口记录，并在记录已离开 bridge（窗口关闭）或记录的会话已改变（用户在此期间选了聊天）时丢弃结果。`whenReady` 只在自己仍占据槽位时清除 pending 条目，因此释放后又重开的窗口无法抹掉更新的创建。

## Alternatives considered

- **把映射存进布局文档并随每次捕获写入。** 拒绝：捕获是看板 store 的纯函数，而会话属于对象层数据；bridge 将不得不通过 store 写入它的映射，或者持久化层需要第二个捕获输入——阶段 8 的 schema 早已有意把两半分开。
- **为 bindings 增加第二个 settings 写入者。** 拒绝：两个写入者共用一个 revision-CAS 命名空间只会带来冲突抖动而毫无收益；分节只有一个所有者是布局工作确立的不变式。
- **为 missing 自动创建替代会话。** 拒绝：这会把被删除的聊天悄悄变成新的空聊天并掩盖丢失；正文的显式操作才是诚实的结果，计划也正是这样要求的。
- **允许重复并加标记。** 作为 MVP 规则拒绝：在一个会话上比较两个窗口不属于阶段 9 场景，聚焦持有者是可预测的；该决定已记录并由测试覆盖。
- **为对账按已绑定记录订阅 `sessions.list`。** 拒绝：bridge 范围的一次订阅就够了，列表是单一快照，按记录订阅会随窗口数增长却只提供同样的信息。
- **监听会话 face 的移除而不是列表。** 拒绝：列表是主机的持久真相并已在驱动附着记录；已移除的会话在本地仍可寻址一段时间，face 会报告过期的存活状态。
- **每次 publish 都写 bindings。** 拒绝：publish 随每个流分块发生；分节写入预算（至多每秒一次，且只在离散事件之后）的存在正是为了让 settings 文件保持安静。

## Consequences

重载会画出已保存的窗口及其聊天，bridge 重新打开每个会话（最后一次附着使其会话成为当前——阶段 4 的取舍不变）。已不存在的聊天留下一个诚实的窗口和两条回去的路；回来的聊天会自行重新附着。一个聊天不再能出现在两个窗口里，而能触达已被列表丢弃的聊天的界面会说明情况，而不是什么都不做。已存映射可能比会话文件活得更久（会话缺失期间配对保留），并在每次 adoption 时随布局自我修剪。

验证：`tests/session-bridge.client.spec.ts` 覆盖两对恢复（每对一个 `open`）、restoring→ready 交接、missing 与回归转换、附着期间被移除、duplicate/unknown/same 结果、空会话规则、创建/重绑/关闭/dispose 的映射持久化、创建期间关闭与创建期间绑定的竞态，以及开闭与重绑的泄漏检查；`tests/board-persistence.client.spec.ts` 覆盖缓存往返、对账后的缓存、adoption 监听与单补丁写入；`tests/apply.client.spec.tsx` 证明被 adoption 的 settings 分节在任何窗口挂载之前打开了两个已存会话；`tests/conversation-body.client.spec.tsx` 与 `tests/omnibox.client.spec.tsx` 覆盖 missing 状态的操作与最近聊天的重新打开。`pnpm exec vitest run packages/client/ui-board/tests`、`pnpm run test:gui` 与 `DSH_SNAPSHOT=replay pnpm run test:web` 均为绿色。

## Related

- [看板窗口拥有 Harness 会话并重建聊天输入区](2026-09-16-ketos-board-window-sessions.zh.md) —— 本笔记扩展的 bridge；它的每窗口通道、订阅与聚焦副作用仍然成立。
- [看板布局经由 `ui-board` settings 命名空间持久化](2026-09-18-ketos-board-layout-persistence.zh.md) —— bindings 所搭载的分节、schema、缓存与写入路径。
- [The window's chats panel](../../../../packages/client/ui-board/src/client/window/WindowChatsPanel.tsx) — 聊天选择遵循重复规则的界面。
- [`packages/client/AGENTS.md`](../../../../packages/client/AGENTS.md) — bridge 遵循的 inject-hooks 与订阅规则。
