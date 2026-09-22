# Agent Note: Clone memory is one FTS5 store in clones.db, composed into the clone session scope and edited in the clone window

Status: implemented

[English](2026-09-22-ketos-stage-17-clone-memory.md) | 中文

## 问题

阶段 16 之后，克隆可以被访谈并持有一份档案，但与它的每一场会话都从空白开始：克隆学到或被告知的东西没有任何一样能在会话结束后留存，档案本身也从未到达模型。本阶段必须给克隆长期记忆——保存、搜索并注入——同时不引入第二个需要保持一致性的数据库、不依赖语义搜索、不在记住每一条事实时重写请求前缀，也不让普通聊天看到另一个会话的知识。记忆还必须能够被人查看和编辑，因为一个记错的克隆必须可以在不删除克隆的情况下被纠正。Harness 没有记忆子系统；它的会话搜索是一次性的派生读模型，而不是存储。

## 决策

**记忆存放在同一个 `clones.db` 中，作为同一个只进式运行器的一个步骤，其独立 FTS5 索引由仓库维护。** schema 步骤 `v3` 加入 `memories`（id、clone_id、content、tags、source_session_id、status、created_at、updated_at）、`(clone_id, status)` 上的一个索引，以及 `memories_fts`——一张独立 FTS5 表（`id UNINDEXED, content, tags, clone_id UNINDEXED`、`tokenize='unicode61'`），与 `session-query-sqlite` 已随附的形态相同。第二个文件的替代方案会把克隆删除、备份与文件身份变成两个问题而不是一个；带触发器的外部内容表被否决，因为触发器是本包无法测试的隐藏同步点，而写入自身事务内的仓库侧同步是显式且可测试的。每一次表写入（`remember`、`updateMemory`、`deleteMemory` 与 `deleteClone`）都在同一个立即事务中按 `id` 删除索引行并插入新行，因此只有手工编辑过的数据库才会使两者失步；`deleteClone` 连同绑定一起移除克隆的记忆，因此没有任何记忆活得比它的克隆更久。一条记忆带有一个 `status`——`active`、`candidate`、`archived`——而克隆删除路径是唯一的级联。

**搜索是带引号的词元前缀，且两个表面使用同一条表达式。** 查询按空白切分，每个含有字母或数字的词元都会成为一个带结尾 `*` 的引号 FTS5 短语（`"навык"*`），各词元以 FTS5 的隐式 AND 连接。引号使查询语法保持为惰性数据——查询 `"`、`OR` 或 `"незакрытая` 要么因不含词元被拒绝，要么按字面匹配，绝不会被解析为语法——而前缀标记能在 `unicode61` 不做词干提取的情况下找到俄语的屈折形式，这正是计划的要求，且无需加入词干提取器或嵌入模型。`search` 默认返回非 `archived` 的行，被要求时返回某一种精确状态；`listMemories` 返回所有状态或某一种状态。计划对一万条记录的 20 ms 预算在仓库构建的索引与排序下成立，而该基准测试是记忆测试套件的一部分，不是一次手工测量。

**逐 agent 的访谈 scope 变成克隆会话 scope：每个已绑定 agent 一个 scope，携带档案、记忆与访谈。** `src/interview.ts` 已重命名为 `src/session.ts`，`CloneInterviewCoordinator` 已重命名为 `CloneSessionCoordinator`，因为协调器现在对任何绑定做对账，而不只是访谈。一个 `agent.ctx.inject(['tools', 'systemPrompt'], …)` scope 为每个绑定到已有克隆的会话注册：由存储记录构建的 `clone:profile` 段落（名称、角色、简介、角色设定、方法论、技能——绝不包含人未亲自写下的秘密）、`clone:memory` 提示词上下文，以及 `clone_memory_remember` 与 `clone_memory_search` 两个工具；当绑定角色为 `interview` 且克隆处于 `interviewing` 时，它额外注册阶段 16 的访谈段落、`clone_draft_save` 与恰好一次的开场。阶段 16 的对账机制——生命周期触发、逐 agent 链、批次、开场闩锁、释放复查——未变，因此先创建 agent、后写入绑定的随附顺序仍然成立，而普通会话绝不会看到其中任何一项。当克隆身份或访谈模式变化时，该 scope 会重新安装，否则就地刷新：提示词提供者闭包捕获一个由对账替换的可变文本持有者，因此一次档案编辑或记忆写入会重新发布新文本，而不重新注册工具或段落。

**档案是段落，记忆是上下文，这正是 KV 缓存得以保持的原因。** 档案走 `systemPrompt.section`，因为它是克隆稳定的身份：其文本只在人编辑记录时变化，因此 agent 工作期间请求前缀在各轮次之间逐字节一致。记忆走 `systemPrompt.context`，因为克隆每次学到东西它都会变化：它在下一个轮次以一条持久的运行时上下文 user 消息的形式出现，因此新记忆绝不重写稳定前缀，而一次记忆变更的代价是一条后缀消息，而不是一次缓存未命中。两个表面读取同一批存储行，因此人的窗口与 agent 的下一个轮次不可能不一致；来自任一路径的写入都会通过访谈早已使用的同一条路由变更通知重新派生快照。快照列出最新的 `memoryEntries` 条活跃记忆（默认 10）并渲染进至多 `memoryChars` 个字符（默认 8000，约 2000 token），缩短一条过长的记忆，并把被预算丢弃的那些计数，更深的查找则交给搜索工具；两个数字都是经过校验的 `Config` 字段，因为部署的上下文预算各不相同。

**记忆工具属于克隆，并且会在其执行处重新检查绑定。** `clone_memory_remember`（content 至多 4000 字符，可选的 tags，以及一个把 `status='candidate'` 存储下来的 `methodology_candidate` 标志）与 `clone_memory_search`（limit 至多 20，因只读而 `isConcurrencySafe`）注册进 agent scope，绝不全局注册。两者在执行时都从 `exec.agent.id` 自己的绑定解析克隆——而不是从 scope 的安装状态——因此一次活得比绑定更久的工具调用会以 `ketos/not-a-clone-session` 被拒绝，而不是写进会话已不再拥有的克隆；而仓库会把这些边界拒绝为 `ketos/invalid-memory`，因为工具 schema 既表达不了 `maxLength`，也表达不了 `maxItems`。`remember` 像另一个克隆写入工具一样保持独占；`search` 选择加入并行调度。

**记忆窗口是克隆窗口的第三个页签，人的编辑经由 `/api/ketos.memory` 流动。** 计划在窗口与页签两种形式之间留待选择；页签胜出，因为克隆窗口已经拥有外框、`cloneId`、会话桥与布局条目，因此记忆窗口会多出一个 `WindowKind`、一次外框注册、一次面板注册、一个标题键与一个 dock 字形，却换不来任何新能力。该路由是第二条精确 Fetch 路由：`list`、`search`、`update` 与 `delete`，全部按 `clone_id` 限定范围，带 `ketos/invalid` 与 `ketos/memory-not-found`；它校验与仓库相同的边界，并在每次获准写入后通知协调器，窗口中的一次删除就是这样从 agent 的下一次组装中消失的。窗口主体列出选定的状态、执行搜索、就地编辑内容、标签与状态，并在一次确认之后执行删除；它在每次变更后重新读取列表，而不是保留本地模型，因此各行始终显示存储所持有的内容。路由拒绝的读取会渲染带重试的失败行，而不是空的记忆列表；含有逗号的标签会被存储拒绝，因为编辑器中的逗号是标签分隔符。

## 考虑过的替代方案

- **单独的 `memories.db` 文件。** 否决：克隆领域已经拥有一个文件、一个身份戳记、一个迁移运行器与一个惰性句柄；第二个文件会让这一整套表面加倍，并使删除克隆变成一场没有原子性的跨文件事务。
- **带触发器的 FTS5 外部内容表。** 否决：触发器把同步从仓库移进本包无法做单元测试的 DDL，一次手工编辑会静默地使索引失步；仓库在写入事务内显式的删除并插入，正是 `session-query-sqlite` 已随附、且本包可以断言的那种模式。
- **用隐藏的 `rowid` 连接代替显式的 `UNINDEXED` 列。** 否决：计划钉死规范形态——显式的 id 与 clone 列——因此索引可以按该表所用的同一批列来连接、过滤与清理。
- **带嵌入向量的语义搜索（`sqlite-vec` 或进程内余弦相似度）。** 暂缓：该 spike 在 MVP 中不可用，而词法前缀匹配在无需第二个存储或后台索引器的情况下覆盖了本阶段的验收标准。
- **把记忆作为提示词段落注入。** 否决：一个每当克隆记住什么就会变化的段落会重写请求前缀，并在每一条事实上丢掉 KV 缓存；运行时上下文消息正是为此而存在的机制。
- **把全部记忆注入提示词。** 否决：无界增长且没有排序；带预算的最新 N 条快照加一个搜索工具，让上下文成本保持可预测，并让模型可以索取其余部分。
- **把记忆存成克隆记录字段或会话投影。** 否决：记忆是每个克隆的多行数据且带有自己的搜索，而会话投影是一种随会话一起消亡的派生读模型；存储必须比每一场会话活得都久。
- **带修订号校验的记忆编辑。** 否决：一条记忆同一时间只有一个作者，也没有长时间持有快照的编辑表单；最后写入者胜出加上立即重新读取是诚实的，而窗口绝不会显示存储并不持有的行。
- **专用的记忆窗口种类。** 否决：它会重复克隆窗口的外框、会话与布局表面；页签复用了它们全部，并保持每个克隆记录一个窗口。
- **聊天面板中的记忆摘要。** 否决：计划允许任一种表面，而在项目旁的只读摘要会增加同一批行的第二种渲染且没有编辑路径；页签是唯一的记忆表面。
- **克隆记录中的逐克隆记忆预算。** 否决：预算是部署的上下文决策，而不是克隆的属性；`Config` 字段沿用既有的 `maxResults`/`maxEntries` 模式。

## 后果

克隆现在会记忆：agent 用工具保存事实、用搜索找到它们，并把最新的若干条作为运行时上下文带进每一个请求；而人可以在克隆窗口中列出、搜索、编辑、归档或删除它们，每一次变更都会到达 agent 的下一个轮次。阶段 16 的 scope 从仅访谈模式成长为克隆会话 scope，而生命周期机制未变，因此访谈的行为与之前完全一致。接受的代价：每一次存储的克隆改动或记忆写入都会重新派生每个存活顶层 agent 的 scope（每个事件一次数据库读取，而非缓存）；记忆搜索是词法的，因此查询只匹配字面上共享前缀的词元；`candidate` 是窗口会显示的一种状态，其背后没有隔离区流水线；记忆编辑是最后写入者胜出，而非带修订号校验；`archived` 行留在文件中，只从 agent 的两个表面消失；记忆窗口在每次变更后重新读取完整列表而不是分页，这对本地单人存储而言是诚实的，但一旦克隆持有数千条记忆就需要分页。

验证：`packages/ketos/clone-core/tests/memory.spec.ts` 覆盖记忆存储——默认值、标签与来源、最新优先的列表、内容与标签边界、俄语前缀与大小写不敏感匹配、FTS 语法的惰性、标签匹配、克隆隔离、limit 边界、归档语义、更新时的重新索引、删除、克隆删除级联、持久化解码拒绝，以及一万条记录的搜索预算；`tests/memory-tools.spec.ts` 覆盖快照渲染、单条记忆的缩短（含代理对安全）、省略计数与字符预算；`tests/memory-routes.spec.ts` 覆盖每个操作、每个失败码、克隆范围限定、变更通知与路由释放；`tests/composition.spec.ts` 通过真实 Loader 在 agent 栈旁启动该包行，并驱动整条路径——记忆工具只出现在被绑定 agent 的 scope 中、remember 与 search 通过真实工具执行器工作、档案段落与记忆快照被组装、快照跟随人的编辑与删除、请求前缀在一次记忆写入前后保持逐字节一致、被配置的快照大小得到遵守、当绑定消失后工具会以 `ketos/not-a-clone-session` 拒绝该会话，且克隆被删除时 scope 被撤回。`packages/client/ui-board/tests/clone-memory.client.spec.tsx` 覆盖主体的筛选、搜索、编辑、删除、克隆缺失、读取失败可重试、客户端标签边界与被拒绝取值等状态；`tests/clone-window-bar.client.spec.tsx` 覆盖记忆页签；`tests/clone-flow.client.spec.tsx` 针对打桩的记忆路由驱动装配后的看板——页签切换主体种类、列表读取克隆的记忆、一次编辑保存成功、一次经确认的删除清空列表；`tests/slots.client.spec.tsx`、`tests/apply.client.spec.tsx`、`tests/roster.client.spec.ts` 与 `tests/leaks.client.spec.tsx` 钉住第三个主体注册与新主体的资源纪律。

## 相关

- [克隆访谈是由存储绑定派生的逐 agent scope，并由克隆窗口承载](2026-09-21-ketos-stage-16-clone-interview.zh.md) —— 本阶段泛化的逐 agent scope、绑定表与路由变更通知；其 `src/interview.ts` 与双页签窗口在此即 `src/session.ts` 与三页签条带。
- [克隆领域在一条 Fetch 路由背后拥有自己的 SQLite 文件，而看板在克隆窗口中编辑克隆](2026-09-21-ketos-stage-15-clone-model-editor.zh.md) —— 记忆存储与记忆页签所扩展的数据库、运行器与克隆窗口。
- [Ketos MVP 工程政策（分叉范围、覆盖例外、流程）](../process/2026-09-15-ketos-mvp-engineering-policy.zh.md) —— `@ketos/clone-core` 消费的覆盖例外，以及它为此承担的行为测试套件。
- [`packages/ketos/clone-core/README.md`](../../../../packages/ketos/clone-core/README.zh.md) —— 记忆路由、schema、克隆会话 scope 与包的局限。
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.zh.md) —— 克隆窗口的页签与记忆主体。
