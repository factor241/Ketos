# Agent Note: 克隆访谈是由存储绑定派生的逐 agent scope，并由克隆窗口承载

Status: implemented

[English](2026-09-21-ketos-stage-16-clone-interview.md) | 中文

## Problem

阶段 15 给了克隆一条存储记录和一个编辑器，但每个需要撰写的字段都得手工敲入：没有任何东西能把与人的一次对话变成后续阶段组合进 agent 提示词的那条记录。本阶段必须新增一场引导式访谈——一个逐条提出清单问题、最后写下档案的 agent——同时不让普通聊天获得访谈者提示词、不在看板中增加第二个聊天表面，也不从模型的行文中解析档案。访谈还必须跨重启存活、不得在恢复时自行重新打开、在档案保存的那一刻就不再是访谈，并且让人能够检查并修正 agent 写下的内容。

## Decision

**访谈模式派生自两项存储事实，而非某个预设。** 当 `clone_sessions` 把会话绑定到一个角色为 `interview` 的克隆、且该克隆的状态为 `interviewing` 时，该会话正在访谈；`draft` 是手工创建的记录，`ready` 是已保存、等待检查的档案。生命周期从阶段 15 的推测性 `draft | active | archived` 收窄为 `draft | interviewing | ready`，因为 `active` 与 `archived` 没有读取方，且访谈阶段拥有这些转换；schema 步骤 `v2` 把既有文件中的 `active` 归一为 `ready`、`archived` 归一为 `draft`，不触碰任何其他列，因此没有记录被丢弃，运行器保持只进。模式派生自绑定与状态、而非专用的 agent 预设，使克隆的普通工作会话仍是普通聊天：只有看板明确为访谈绑定的会话才会获得访谈者指令与草稿工具。

**一个协调器把该模式组合进 `agent.ctx`，随附路由在存储数据变动时通知它。** `src/interview.ts` 在 `agent/created`、`agent/session-start`、`agent/disposed`，以及路由在一次获准写入后新发出的变更通知上做对账。正是这条通知让随附的顺序成立：`sessions.create()` 在宿主上创建 agent，因此绑定写在 agent 存在之后，没有任何生命周期事件能观察到它。每次对账都读取那两项存储事实，并驱动一个 `agent.ctx.inject(['tools', 'systemPrompt'], …)` scope——注册 `clone_draft_save`，注册 `clone:interview` 段落——因此这两项贡献与那个 agent 同生共死，绝不进入全局注册表：对普通会话而言 `ctx.tools.get('clone_draft_save')` 是 undefined，未绑定 agent 组装出的提示词中不含任何访谈文本。对账按 agent 串接，因此两个重叠的触发无法把该 scope 安装两次；在途的安装会在其 await 之后重新检查释放，因此没有 scope 会活得比插件 fiber 更久。

**档案以经过校验的工具参数送达，保存即结束该模式。** `clone_draft_save` 接收角色、单行简介、角色设定、方法论与技能名；它从发起调用的 agent 自己的会话（`exec.agent`）解析出被绑定的克隆，在一次带修订号校验的更新中写入档案并把克隆标记为 `ready`，工具结果会给出所保存的修订号。存储在写入发生处强制执行该模式，而不是信任 scope 的生命周期：没有 `interview` 绑定的会话以 `ketos/not-a-clone-session` 被拒绝，已经离开 `interviewing` 的克隆——例如人先从表单确认过的档案——以 `ketos/clone-not-interviewing` 被拒绝，必填行留空或超出文档所述边界的档案以 `ketos/invalid-draft` 被拒绝，因为工具 schema 既表达不了 `minLength`、`maxLength`，也表达不了 `maxItems`。它们全都是 `HarnessError`，因此模型读到失败文本，持久的 `tool/result` 携带 `error.info.code`。保存在同一次调用中读取当前修订号，因此存储记录总会吸收此前落地的用户编辑；agent 的写入按设计是最后写入者胜出，因为它*就是*草稿，而对用户自己文本的保护位于表单中。`skills` 加入了更新补丁（存为既有的 `skills_json` 列），因为档案承载着人列出的那些名字。

**访谈以恰好一个持久的开场轮次开启。** 进入该模式时，协调器以包声明的来源种类 `ketos-clone-interview` 和 `form: 'notice'` 排入 `agent.followup(createUserMessage(…))`，因此 transcript 把开场渲染为一条折叠说明，而不是一条用户输入的消息，同时该刺激仍是普通的持久输入。让它保持唯一的是承载它的那份输入：先询问 agent 自己的待处理收件箱，因此仍在等待轮次的开场——包括重启后从日志恢复的那一个——会抑制第二次；而一个仅主机侧的会话投影把「本会话是否记录过开场来源」折叠为持久答案。在驱动器认领该消息与把它追加到日志之间，两条记录都不承载它，因此协调器还会锁存它排入过消息的那些会话，并在日志确认或轮次已消失时释放该闩锁：落在该窗口内的存储变动无法排入第二个开场轮次，被取消的轮次丢弃的开场会被再次排队，而不是让会话静默等待；而一次让该消息停留在待处理状态的重启，会在恢复时认领同一条消息。触发按微任务收集，且每个 agent 经由自己的对账链对账，因此一次发布同时发出的 `agent/created` 与 `agent/session-start` 这一对只派生一次模式。

**克隆窗口把访谈承载为自己的第二个主体，且段落文本为缓存保持静态。** 克隆窗口保留 `cloneId`，并为访谈获得 `conversation` 主体种类：标题栏与主体之间的一条双页签条带（`CloneWindowBar`）在卡片表单与窗口自己的 Harness 会话之间切换，后者就是普通的对话主体与 composer——没有第二个聊天表面。`resolveChatWindow` 与 `conversationWindow` 把 conversation 主体的克隆窗口当作聊天目标，这取代了阶段 15 的排除：那次排除针对的是主体永远无法显示会话的窗口。启动访谈是一次 apply 侧操作，顺序既定——在名册修订号下把克隆标记为 `interviewing`、创建会话、以角色 `interview` 绑定它、用 `bridge.adopt` 把它纳入这个窗口、应用克隆的首选模型路由、把主体切换为对话——因此宿主在组合 agent 时同时看到状态与绑定。提示词段落是一段静态清单文本，带包内局部顺序（`700`；`getSectionOrder` 拥有仓库范围的槽位），因此访谈中的会话组装出的请求前缀在各轮次之间保持逐字节一致，而在 `ready` 时撤回该模式是唯一有意的前缀变化。条带从名册派生克隆的状态，并在每个轮次落定时重新读取该名册，agent 保存的档案就是这样到达表单的；表单标出被移动的存储字段、保留脏草稿的文本，并把存储的修订号作为一行待处理项暴露出来，用户一键即可应用，因此 agent 绝不可能静默覆盖人输入的内容。那份草稿与那些标记以克隆为键存放在看板 store 中，而不是在主体组件里：用户到访谈主体中作答时窗口会卸载编辑器，而重新挂载绝不能丢弃二者。窗口也是由它所编辑的记录而非其中的聊天命名的——标题阶梯把克隆排在会话生成的标题之上——因此访谈无法重命名该记录自己的窗口。

## Alternatives considered

- **专用的访谈 agent 预设。** 否决：该模式是会话生命期内开开关关的逐会话状态（哪个克隆、什么状态），而预设是在创建时组合会话的整套设置；本阶段也让预设选择保持为用户可见的选择。
- **一个全局提示词段落，其 `text()` 提供方在模式之外返回 `''`。** 否决：该贡献会存在于每个 agent 的组装中，模式的所有权会落在一个字符串函数里而不是一个 scope 中，而计划中「在 `ready` 时移除」的要求恰恰就是 scope 释放。
- **只在 `apply` 中遍历 `ctx.agents.roots()` 安装该模式。** 否决：随附的浏览器顺序先创建会话再绑定它，因此没有生命周期事件能观察到该绑定；没有路由的变更通知，全新的访谈永远不会打开该模式。
- **从 agent 的最终消息中读取档案。** 否决：本仓库不为结构化结果解析模型行文，而工具 schema 会在任何内容到达存储之前校验各字段。
- **把开场标志存入 `clone_sessions`。** 否决：会话日志是「本会话是否被打开过」的持久权威；一列会让排队与领取之间的崩溃要么重复打开会话，要么让它静默地从未打开。
- **在生命周期中保留 `active` 与 `archived`。** 否决：从来没有消费方读取它们，而一个两个额外状态毫无含义的四态生命周期会诱使 UI 提供产品并不具备的转换。
- **单独的克隆访谈窗口，或克隆窗口内的面板。** 否决：计划把访谈钉在克隆窗口上，而该窗口已经拥有外框、聊天面板、布局条目与全屏行为；第二个窗口还会与「一个会话一个窗口」规则冲突。
- **跟踪主题级的访谈进度。** 暂缓：诚实的 MVP 报告就是 `interviewing` 状态加上 transcript 已经提供的交换条数；清单计数器需要 agent 可靠地报告主题，在那之前它没有意义。

## Consequences

本 fork 的第一个产品场景现在端到端跑通：人从克隆窗口发起访谈，在同一个窗口里回答 agent 的问题，并检查 agent 保存的档案，克隆状态随之走 `draft` → `interviewing` → `ready`。后续阶段会把 `ready` 档案组合进工作会话，记忆阶段则同时继承绑定表与逐 agent scope 模式。接受的代价：该模式是重新派生的（每个生命周期事件与每次变更都读一次数据库）而非缓存，因此进入或离开它需要一轮事件循环而不是同步完成；agent 的保存相对存储是最后写入者胜出，保护用户未发布文本的是表单而非工具；用户在访谈中途已保存的卡片编辑会被吸收进 agent 写出的草稿；访谈没有主题级进度；且 `skills` 仍然在没有消费方的情况下往返，直到方法论阶段。

Verification: `packages/ketos/clone-core/tests/interview-tool.spec.ts` 覆盖该工具的成功结果与两处带记录错误码的领域拒绝；`tests/composition.spec.ts` 通过真实 Loader 在 agent 栈旁启动该包行，并驱动整条路径——段落与工具只出现在被绑定 agent 的 scope 中、开场恰好记录一次且存储变动不会重新打开它、`clone_draft_save` 用草拟的字段把克隆标记为 `ready`、随后段落与工具被撤回，而绑定消失的会话会以 `ketos/not-a-clone-session` 被拒绝；`tests/repository.spec.ts` 覆盖绑定查找、档案保存、未绑定拒绝、离开访谈的克隆、为空与超长的档案行、克隆消失、技能替换与手工改角色的拒绝；`tests/database.spec.ts` 覆盖被取代的状态对的 `v2` 归一，以及对版本 1 文件的采用；`tests/routes.spec.ts` 覆盖被接受的角色与状态、被拒绝的角色与状态、变更通知，以及抛错的观察者无法改变已提交的应答。`packages/client/ui-board/tests/clone-window-bar.client.spec.tsx` 覆盖页签、没有会话时被禁用的访谈页签、指令与交换条数、`ready` 时的检查提示，以及轮次落定后重新读取名册；`tests/clone-body.client.spec.tsx` 覆盖访谈动作、agent 变更标记、被保留为待处理并需显式应用的脏草稿，以及用户自己的保存不被标记；`tests/clone-flow.client.spec.tsx` 驱动装配后的看板——开始访谈会标记并绑定克隆、会话在克隆窗口内打开、来自访谈中克隆窗口的提示词落在该窗口中，且窗口在其会话携带生成标题时仍保留克隆的名字；`tests/clone-body.client.spec.tsx` 额外覆盖草稿与标记在主体切换后仍然存活；`tests/open-window.client.spec.ts` 覆盖 conversation 主体的克隆窗口作为聊天目标。`pnpm run test:gui`、`DSH_SNAPSHOT=replay pnpm run test:web`、`pnpm run typecheck`、`pnpm run lint`、`pnpm run build`、`pnpm run hygiene` 与 `pnpm run doc-sync` 均为绿色。

## Related

- [The clone domain owns its own SQLite file behind one Fetch route, and the board edits clones in clone windows](2026-09-21-ketos-stage-15-clone-model-editor.zh.md) —— 本阶段扩展的存储、路由与克隆窗口；其「克隆窗口绝不是聊天」的决策在此被取代。
- [Board windows restore their Harness sessions and reconcile them against the session list](2026-09-19-ketos-board-session-restore.zh.md) —— 其 `adopt` 把创建出的访谈会话交给克隆窗口的桥。
- [Board windows render tool cards and route pending confirmations to the main panel](2026-09-20-ketos-board-tool-cards-approvals.zh.md) —— 渲染档案保存卡片的车道。
- [Ketos MVP engineering policy (fork scope, coverage exceptions, process)](../process/2026-09-15-ketos-mvp-engineering-policy.zh.md) —— `@ketos/clone-core` 消费的覆盖例外，以及它为此承担的行为测试套件。
- [`packages/ketos/clone-core/README.md`](../../../../packages/ketos/clone-core/README.zh.md) —— 路由表、生命周期、访谈模式与包的局限。
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.zh.md) —— 克隆窗口的页签、访谈条带与 agent 变更标记。
