# Agent Note: 克隆的自主任务是在存活会话上的一个目标，存于 `clone_tasks`，并通过一个逐 agent 工具提交报告

Status: implemented

[English](2026-09-23-ketos-stage-19-clone-autonomous-tasks.md) | 中文

## Problem

在第 18 阶段之后，克隆有了档案、记忆、方法论与技能，但只有人在它的窗口中输入时它才能工作。第 19 阶段必须让人陈述一个目标，并让克隆在无人继续提示的情况下跨轮次追求它，为每条任务保持真实的状态，让人读到结果，并允许取消——同时不编写自主运行器、不引入第二个数据库、不引入调度或跨进程队列，也不让浏览器维持工作存活：计划上下文指出 harness 已经提供 `ctx.goals.create(agent, { objective, maxGoalRounds })` 以及已挂载的 `goal-round-driver`，后者会在 agent 回到空闲时加入下一轮。剩下的问题是：任务的持久状态放在哪里、任务如何结束、重启如何对账，以及浏览器如何得知。

## Decision

**任务就是同一 `clones.db` 中 `clone_tasks` 表的一行，由只进式 schema 步骤 v5 加入。** 列为 `id`、`clone_id`、`session_id`（启动前为 null）、`objective`、`status`、`result_summary`、`max_rounds`、`created_at`、`updated_at`，并在 `clone_id` 与 `session_id` 上各有索引；`CLONE_CORE_SCHEMA_VERSION` 变为 5。第二个数据库会重复 `CloneDatabase` 已经拥有的打开序列、身份戳与生命周期所有权，而任务正如记忆一样属于克隆数据。状态机是 `pending → running → done | failed | cancelled`，每次转换都由写事务内读到的状态守卫，终态绝不会被改写；重复取消是空操作，而重复启动会被拒绝。任务与记忆一样属于克隆：删除克隆会在与删除绑定和记忆相同的写事务中删除其任务，因此不会有孤儿行在其克隆消失后仍留在任务窗口中。

**轮次预算是唯一一个经校验的配置字段，既不是常量，也不是 wire 字段。** `defaultMaxRounds` 默认为 10，并在 schemastery schema 中限定为 50；该上限是本包的校验不变量，而不是部署设置，因为失控的任务绝不能无限占用会话的轮次。`create` 把配置的预算存到任务上，`start` 把该值原样交给目标；路由刻意不接受逐请求的预算，因为当前没有任何界面提供它。生成的 `docs/config-catalog.md` 包含该字段。

**自主性使用随附的 goal 栈；clone-core 只拥有接缝。** `POST /api/ketos.tasks { op: 'start' }` 在主机上运行：客户端通过普通的 remote `session.create` 创建会话并传入其 id，因此任务的工作绝不依赖某个窗口保持打开。运行器随后把会话绑定到克隆（角色 `main`），等待克隆会话协调器完成对账，使 `clone_task_report` 与 `clone:task` 上下文在首轮进入收件箱之前就位，并调用 `ctx.goals.create(agent, { objective, maxGoalRounds })`。客户端会像访谈流程一样在新建会话上选中克隆的首选模型路由；已绑定到另一克隆的会话会被拒绝而不是被重新绑定；绑定写入之后失败的启动会解绑它刚写入的会话并释放任务。随附的 `goal-round-driver` 在空闲时加入之后的每一轮。任务不是 `pending`、克隆不是 `ready`、会话没有存活 agent（`ketos/agent-not-live`）、或会话已带未完成目标时，启动在任何写入之前就被拒绝；状态写入之后的失败会把任务释放回 `pending` 并清空 `session_id`。

**`clone_task_report` 是一个逐 agent 工具，提交报告并完成目标。** 它只注册到当前运行任务的会话 scope 中，其缺席即普通克隆会话：任务启动时协调器安装该 scope，任务到达终态时将其撤回。若终态事件落在轮次进行中，运行器会把自身的对账推迟到轮次结束，使模型仍在使用中的工具不会在其脚下消失；而由路由变更触发的 scope 变更会立即生效——访谈工具具有同样的性质，此时重复调用会得到 `unknown tool`。该工具在任务仍运行时存储摘要，并调用 `ctx.goals.complete(agent, ref)`；没有这次完成，驱动器会一直加轮次直到 `round-limit`。终态来自持久的 goal 与会话事件，而不是第二个定时器：`goal/changed` 的 `complete` 阶段以存储的报告或会话事件流上最新的 assistant 文本落定为 `done`；`blocked` 阶段以驱动器给出的消息落定为 `failed`，除非阻塞代码是 `cancelled`；`session/disposed` 把运行中的任务落定为 `failed`。每次终态写入都容忍已经移动的状态，因此重复事件无害。

**取消会持久地阻塞目标并中止正在进行的轮次。** `cancel` 调用 `ctx.goals.block(agent, ref, { code: 'cancelled', message: 'Cancelled by user' })`，这会写入一条日志可重放的 `goal/change` 记录，然后取消进行中的轮次；存储状态变为 `cancelled`。本阶段刻意避免 `disarm`（进程本地、没有持久记录、在投影中留下 `phase: 'active'`，使数据库失步）与 `clear`（在日志中留下墓碑）；计划明确排除了这两者。

**重启会把被打断的任务落定，而不是假装恢复。** 目标驱动器在重启后不会重新激活任何目标，被打断的那一轮也已不复存在，因此克隆数据库属主首次打开任务表时，每条 `running` 任务都会以 `the process restarted before the task finished` 落定为 `failed`。该对账位于 `CloneDatabase.openTaskRepository`，因此惰性打开得以保留——从不触碰任务的进程绝不会导入 `node:sqlite`——而任何经任务仓库的读写都已经看到对账后的状态。自动继续属于后 MVP。

**goal 服务通过 `ctx.get('goals')` 读取，而不加入插件的根 `inject`。** 克隆、记忆与访谈功能都不需要 goals；让整个包等待该服务会使没有 goals 的部署连任何克隆功能都无法提供。服务缺席时任务操作会以具名错误大声失败，而随附的 web 配置始终挂载它。这遵循了「可选服务通过 `ctx.get` 读取」的成文规则，也避免让根注入面的既有待审项（`ketos-aqp`）继续扩大。

**任务窗口是既有看板窗口种类的一个 body。** `'tasks'` 的 `WindowKind`/`bodyKind`、其模板、框架注册、标题键与布局允许列表在第 5/7.2 阶段就已作为占位存在，因此 19.4 只注册缺失的 `board.window.body` 占用者，而不新增窗口或面板。窗口列出任务（全部，或该窗口的克隆），在全新会话上启动待处理任务、取消、通过既有 `openChat` 打开任务会话，并把一行展开为 Markdown 报告，加上从客户端已持有的 chat 快照折叠出的文件产物。列表是一份共享的全局读取，各窗口在客户端侧过滤，因此限定到不同克隆的两个窗口不会互相覆盖对方的列表。只要有任务处于 `pending` 或 `running`，窗口就每 750 ms 重读列表——这是具名客户端常量，因为轮询间隔不是部署变量——间隔随最后一条活动任务停止，并在卸载时清除；浏览器仍然不持有任何订阅，把 `goal/changed` 转发给它属于后 MVP。克隆卡片上的「自动驾驶」控件创建任务并启动它，然后把限定到该克隆的任务窗口带到前面（或打开它）。

**轮次进度是读来的，不是存下来的。** 窗口为每条运行中任务向 `ctx.remote.goals.get(sessionId)` 询问，并显示 `roundsStarted / maxGoalRounds`；goal 投影是权威，任务表不存储任何重启后可能失真的计数器。

## Alternatives considered

- **在 clone-core 里自建轮次循环（`agent/status` → `agent.followup`）。** 拒绝：它会重新实现随附驱动器，包括其预留围栏、检查点刷新与取消围栏，而计划禁止在已有扩展点存在时改动循环。
- **单独的 `tasks.db`。** 拒绝：为属于克隆的数据重复打开序列、身份戳与生命周期所有权。
- **把 `goals` 加入根 `inject`。** 拒绝：它把每个克隆功能耦合到只有自主任务需要的服务，并扩大第 18 阶段审计已经标记的注入面。
- **进程启动时重新激活目标（重启即恢复）。** MVP 拒绝：计划把自动继续放在后 MVP，且恢复的轮次会在被打断轮次进行到一半的工作区上运行；被接受的行为是真实的 `failed` 加一条新任务。
- **把 `goal/changed` 转发到浏览器而不是轮询。** 暂缓：它需要改 remote-events 允许列表并新增浏览器侧订阅路径；计划固定了轮询与 ≤ 1 s 的状态 SLA。
- **在任务行上存储轮次计数器。** 拒绝：goal 投影已经携带 `roundsStarted`，第二个计数器会在重启后漂移。
- **用 `disarm` 或 `clear` 实现取消。** 拒绝：`disarm` 不留持久记录且投影保持 `active`，`clear` 留下墓碑；计划明确排除了这两者。
- **把 `clone_task_report` 做成全局工具。** 拒绝：克隆 scope 纪律要求每个克隆工具都注册进 agent 自身 scope；全局工具会出现在普通聊天中。
- **为任务新增 `WindowKind`、任务面板或克隆窗口标签页。** 拒绝：`'tasks'` 窗口种类正是为本阶段预留的，而克隆窗口已有三个以克隆记录（而非其工作）为范围的标签页（档案、访谈、记忆）。
- **逐请求的 `maxRounds` wire 字段。** 拒绝：当前没有界面提供预算，且计划把该值定为带固定校验上限的配置字段。

## Consequences

人现在可以在克隆卡片或任务窗口陈述一个目标，让克隆去工作：主机创建目标，随附驱动器加入轮次，克隆用一个工具提交报告，窗口显示状态、报告与产物，而无需人提示会话。被接受的代价：运行中的任务不能跨越重启，继续意味着新任务；取消是终态，因此重跑意味着新任务；窗口使用轮询而非接收推送事件，轮次进度是尽力而为的；报告正是克隆提交的文本，产物列表只覆盖该客户端已持有的会话。数据库升到 `user_version = 5`；该步骤是只进的，版本 4 的文件只需运行 v5 即被采用。MVP 覆盖策略不变：`packages/ketos/clone-*/src/**` 与 `packages/client/ui-board/src/**` 继续以行为套件替代逐文件百分比门禁。
