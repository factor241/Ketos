---
description: "Ketos 克隆领域的主机包：clones.db、其只进式 schema、以修订号做 CAS 的仓库与 FTS5 记忆存储、/api/ketos.clones 与 /api/ketos.memory Fetch 路由，以及克隆会话 scope：档案、记忆与草拟档案的访谈。"
kind: "package-reference"
---

# @ketos/clone-core

[English](README.md) | 中文

## 概述

`@ketos/clone-core` 拥有 Ketos 克隆领域。克隆是一条存储记录——名称、角色、简介、角色设定、方法论、首选模型路由、技能、状态——以及绑定的会话与记忆；本包是它的唯一写入方：位于 `$DSH_HOME/clones.db` 的一个 `node:sqlite` 数据库、只进式 schema 运行器、以修订号做 CAS 的仓库、带 FTS5 索引的记忆存储，以及 `/api/ketos.clones` 与 `/api/ketos.memory` Fetch 路由。它还拥有已绑定 agent 所携带的克隆会话 scope：稳定的 `clone:profile` 段落、带两个记忆工具的动态 `clone:memory` 快照，以及——当克隆处于 `interviewing` 时——草拟档案的访谈者指令。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

随附的 `web` 配置通过 `dsh-web-app` bundle 补丁挂载本包，这是唯一受支持的组合：

```yaml
- id: ketos-clone-core
  name: '@ketos/clone-core'
  config:
    path: !!js dshHomePath('clones.db')
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `path` | 必填 | SQLite 数据库文件路径，或 `:memory:`。web 配置传入 `$DSH_HOME/clones.db`（Ketos CLI 下即 `~/.ketos/clones.db`）。 |
| `memoryEntries` | `10` | 提示词快照最多列出的活跃记忆条数（1–50）。 |
| `memoryChars` | `8000` | 提示词记忆快照的最大总长度，以字符计（1–32000）。 |

本包没有浏览器 bundle：`packages/client/ui-board` 用普通 `fetch` 访问该路由，并以 type-only 方式导入 `./types` 模块，因此克隆窗口留在既有的看板注册之内，而不新增客户端插件行。

### 路由

`/api/ketos.clones` 是 `/api` 之下的一条需认证的精确 Fetch 路由，通过 `ctx.connection.fetch` 注册，并随插件 fiber 一并撤销。

| 方法 | 请求 | 应答 |
|---|---|---|
| `GET` | — | `{ ok: true, clones }` |
| `POST` | `{ op: 'list' }` | `{ ok: true, clones }` |
| `POST` | `{ op: 'get', id }` | `{ ok: true, clone }` |
| `POST` | `{ op: 'create', name, role, … }` | `{ ok: true, clone }` |
| `POST` | `{ op: 'update', id, revision, patch }` | `{ ok: true, clone }` |
| `POST` | `{ op: 'delete', id, revision }` | `{ ok: true, id }` |
| `POST` | `{ op: 'bindSession', cloneId, sessionId, role? }` | `{ ok: true, binding }` |
| `POST` | `{ op: 'listSessions', cloneId }` | `{ ok: true, sessions }` |

失败应答为 HTTP 状态码加 `{ ok: false, error }`：`400` `ketos/invalid`、`404` `ketos/clone-not-found`、`409` `ketos/clone-conflict`。请求体在路由处逐字段校验，且校验先于数据库打开，因此畸形请求不会创建文件。意外的内部故障（例如数据库无法打开）以 `500` 加纯文本正文应答、不带错误码，客户端不会把它当作领域错误码。

`patch` 接受 `name`、`role`、`description`、`persona`、`methodology`、`preferredModel`、`skills` 与 `status`；`status` 是 `draft`、`interviewing`、`ready` 之一，绑定中的 `role` 是 `main`、`interview` 之一。每次获准的写入都会通知克隆会话协调器，后者重新派生每个存活顶层 agent 的 scope，并刷新其档案文本与记忆快照。

### 记忆路由

`/api/ketos.memory` 是第二条精确 Fetch 路由，通过同一服务注册，并随插件 fiber 一并撤销。

| 方法 | 请求 | 应答 |
|---|---|---|
| `POST` | `{ op: 'list', cloneId, status? }` | `{ ok: true, memories }` |
| `POST` | `{ op: 'search', cloneId, query, limit?, status? }` | `{ ok: true, memories }` |
| `POST` | `{ op: 'update', id, patch }` | `{ ok: true, memory }` |
| `POST` | `{ op: 'delete', id }` | `{ ok: true, id }` |

失败应答为 `400` `ketos/invalid` 与 `404` `ketos/memory-not-found`。`patch` 接受 `content`（至多 4000 字符）、`tags`（至多 50 个单行标签、每个 100 字符，且不得含逗号——逗号是记忆窗口的分隔符）与 `status`（`active`、`candidate`、`archived`）；仓库拒绝同样的边界，因此绕过路由的工具会以完全相同的方式被拒绝为 `ketos/invalid-memory`。搜索查询必须至少含一个字母或数字，且不得含控制字符；路由在打开数据库之前构建 MATCH 表达式，因此被拒绝的查询绝不会创建文件。不带 `status` 的 `list` 返回所有状态；不带 `status` 的 `search` 返回除 `archived` 外的所有状态，显式指定 `status` 则限定结果。每次获准的写入都会通知克隆会话协调器，因此受影响 agent 的下一个轮次会带上该变更。

### 可观察行为

- **打开是惰性的。** 配置会挂载插件并注册路由，但 `node:sqlite` 的导入与文件打开发生在首次克隆请求或首个恢复的会话时——从磁盘恢复的会话可能是一场访谈，因此必须查询它。所有聊天都是新的、且从不触碰克隆的进程绝不会打开该文件。
- **文件仅属主可访问。** 父目录以 `0700` 创建，缺失的数据库文件以 `0600` 创建；已存在的文件保留其权限。数据库以 WAL 模式运行，`application_id` 为 `KTCL`，`user_version` 为 `3`。
- **克隆有三种生命周期状态。** `draft` 是手工创建的记录，`interviewing` 是访谈会话正在草拟其档案的克隆，`ready` 是已保存、等待人检查的档案。只有 `interviewing` 会组合访谈模式。
- **外来数据库被拒绝。** 由其他应用写入的 `application_id`、比本构建更新的 `user_version`，或不是 SQLite 数据库的文件，都会在打开时被拒绝而不是被改写。没有戳记的空 SQLite 文件会被采用。
- **写入按修订号校验。** 仅当存储的 `revision` 仍等于调用方读到的值时，`update` 与 `delete` 才会生效；否则应答 `ketos/clone-conflict`，存储记录保持不变。一个会话最多绑定一个克隆，且同一会话的最新绑定生效。
- **访谈只自行开启一次。** 会话进入该模式时，包通过 `agent.followup` 排入一条开场消息，并带来源种类 `ketos-clone-interview`。待处理收件箱、排队闩锁与持久会话日志共同回答开场是否存在：仍在等待轮次的开场，或已经记录过的那一条，都会抑制第二次——包括在驱动器认领该消息与把它追加到日志之间的那段窗口——而被取消的轮次丢弃的开场会被再次排队。重启后仍处于待处理的那条消息会在恢复时被认领，且同一条消息会被复用，因此恢复的会话绝不会被访谈两次。
- **保存档案会结束该模式。** `clone_draft_save` 把它收到的档案写入被绑定的克隆、把克隆标记为 `ready`，协调器随即撤回段落与工具。写入本身强制执行该模式：没有 `interview` 绑定的会话以 `ketos/not-a-clone-session` 被拒绝，已经离开 `interviewing` 的克隆（例如人先确认过的档案）以 `ketos/clone-not-interviewing` 被拒绝，必填行留空或超出文档所述边界的档案以 `ketos/invalid-draft` 被拒绝；它们中没有哪一个会写入任何内容。
- **记忆只属于一个克隆。** 每次读取都按 `clone_id` 限定范围，因此一个克隆绝不会看到另一个克隆的记忆。`archived` 记忆既不出现在搜索中，也不出现在提示词快照中，直到人恢复它们为止。
- **FTS 索引由仓库维护。** `memories_fts` 是一张没有触发器、没有外部内容的独立 FTS5 表；每次写入都在同一事务内更新该表与索引，因此只有手工编辑的数据库才会使两者失步，而本包的读取会把索引联回该表。
- **搜索匹配带引号的前缀。** 每个查询词都会成为一个带结尾 `*` 的引号 FTS5 短语（`"навык"*`），这使 FTS5 语法保持为惰性数据，并且在 `unicode61` 不做词干提取的情况下也能找到俄语的屈折形式。本包的基准测试在一万条存储记忆中搜索，用时远低于 20 ms。
- **工具属于克隆会话。** `clone_memory_remember` 与 `clone_memory_search` 注册到绑定克隆的会话的 agent scope 中，绝不全局注册；两者在执行时都会重新检查绑定，一旦绑定消失就以 `ketos/not-a-clone-session` 拒绝。
- **档案是稳定的，记忆是动态的。** 档案走 `systemPrompt.section`，记忆快照走 `systemPrompt.context`，因此新记忆会在下一个轮次作为一条持久运行时上下文消息到达，绝不重写请求前缀；`memoryEntries` 与 `memoryChars` 限定该快照，更深的查找则交给搜索工具。
- **人的编辑会到达 agent。** 通过 `/api/ketos.memory` 进行的编辑或删除会重新派生 agent 的快照，因此它的下一个轮次看到的正是人留在记忆窗口中的内容。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>Implementation internals — click to expand</summary>

### Schema

`clones` 每个克隆一行；`clone_sessions` 每个绑定会话一行，并在 `clone_id` 上有索引；`memories` 每条被记住的事实一行，并在 `(clone_id, status)` 上有索引，另有一张覆盖内容与标签的独立 `memories_fts` FTS5 表。三张表都是 STRICT 表，时间戳为 ISO-8601 UTC 字符串，且每次读取都会解码它找到的持久化值——未知 `status`、绑定角色或记忆状态，或不是字符串数组的 `skills_json`/`tags` 会直接报错，而不会把损坏的克隆带到 UI。版本 `2` 步骤把被取代的推测性状态对（`active` 归一为 `ready`、`archived` 归一为 `draft`）归一，不触碰任何其他字段；版本 `3` 步骤加入记忆表、其索引与其 FTS5 表。

### 克隆会话 scope

`src/session.ts` 拥有该 scope。它的协调器监听 `agent/created`、`agent/session-start`、`agent/disposed`，以及两条路由的变更通知，然后读取存储的绑定与克隆，并对账一个逐 agent scope：`agent.ctx.inject(['tools', 'systemPrompt'], …)` 注册 `clone:profile` 段落、`clone:memory` 上下文与两个记忆工具，并且——当绑定角色为 `interview` 且克隆处于 `interviewing` 时——注册 `clone:interview` 段落、`clone_draft_save`，以及恰好开启一次访谈的开场。档案编辑或记忆写入会刷新提示词提供者读取的可变文本；重新绑定或访谈模式变化会释放该 scope 并安装正确的那个。没有任何内容进入全局注册表，且对账按 agent 串接，因此重叠的触发无法把该 scope 安装两次。

### 只进式运行器

`src/schema.ts` 拥有有序的步骤列表：第 `n - 1` 项产出 `user_version` `n`，`migrate` 在一趟中补齐所有缺失步骤，再写入当前版本戳。没有回滚，也不会丢失数据；更新的存储版本会被拒绝，绝不降级。`clone_tasks` 会在其自身阶段作为第 4 步加入列表。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`name`/`inject`/`Config`/`apply`、惰性打开的数据库及其释放 |
| [`src/db.ts`](src/db.ts) | 仅属主可访问的文件创建、打开序列，以及两个仓库共同在其上打开的共享惰性句柄 |
| [`src/schema.ts`](src/schema.ts) | 身份与版本戳、有序迁移步骤，以及运行器 |
| [`src/repository.ts`](src/repository.ts) | 带修订号 CAS 的预处理语句克隆 CRUD、会话绑定，以及访谈档案保存 |
| [`src/memory.ts`](src/memory.ts) | 记忆仓库、其 FTS5 同步、带引号前缀的 MATCH 表达式，以及记忆边界 |
| [`src/memory-tools.ts`](src/memory-tools.ts) | 两个记忆工具，以及提示词上下文渲染的快照文本 |
| [`src/memory-routes.ts`](src/memory-routes.ts) | `/api/ketos.memory` 路由、其校验与错误码 |
| [`src/routes.ts`](src/routes.ts) | `/api/ketos.clones` 路由、其手工请求体校验与错误码 |
| [`src/session.ts`](src/session.ts) | 克隆会话 scope：协调器、档案与访谈段落文本、记忆接线、开场消息来源与开场投影 |
| [`src/transaction.ts`](src/transaction.ts) | 多条语句写入共享的立即事务包装 |
| [`src/wire.ts`](src/wire.ts) | 共享路由辅助：JSON 应答、`no-store` 头与请求体校验原语 |
| [`src/types.ts`](src/types.ts) | 存储记录、wire DTO、请求输入与错误码；浏览器代码以 type-only 方式导入该模块 |
| — | 不发布运行时 invariant 伴随模块：本包的关系是打开时的身份校验与逐请求的路由行为，二者均由包内测试覆盖，不存在可持续观察的进程内关系可供发布。 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Ketos 包组](../README.zh.md) —— 本 fork 的包约定与名册。
- 看板克隆窗口——读写该路由的编辑器：[`packages/client/ui-board/src/client/window/CloneBody.tsx`](../../client/ui-board/src/client/window/CloneBody.tsx)。
- 同类 SQLite 布局：[`@deepseek-ai/dsh-storage-sqlite`](../../storage/storage-sqlite/README.zh.md) 与 [`@deepseek-ai/dsh-session-query-sqlite`](../../session-query/session-query-sqlite/README.zh.md)——各自拥有独立的文件身份与 schema，而不共享介质辅助模块。

-----

<a id="model-experience"></a>
## 模型体验

### A session that is not bound to a clone

#### What the model sees

没有。克隆的记录与其记忆只通过下面的克隆会话 scope 才到达模型。

#### Token effect

每个普通请求均为零 token。

#### KV Cache effect

无；本包从不触碰普通会话的请求前缀。

### The clone session

#### What the model sees

绑定到克隆的会话携带 `clone:profile` 段落——存储的名称、角色、简介、角色设定、工作方法与技能名称，并带有在每次回复中保持它们的指令——列出最新活跃记忆及其 id 与标签的 `clone:memory` 运行时上下文快照，以及 `clone_memory_remember` 与 `clone_memory_search` 工具。访谈中的会话额外携带访谈指令与 `clone_draft_save`。

#### Token effect

档案段落对克隆的记录而言是固定的；记忆快照至多增加 `memoryChars` 个字符（默认 8000，约 2000 token），且克隆什么都还没记住时不渲染任何内容；两个工具 schema 把其参数加入该会话的工具目录。其他任何会话都不携带其中任何一项。

#### KV Cache effect

档案段落文本只在人编辑记录时变化，因此在 agent 记忆期间请求前缀在各轮次之间保持逐字节一致；记忆写入只改变运行时上下文消息，因此缓存前缀得以保持。

### The interview session

#### What the model sees

访谈中 agent 的系统提示词携带 `clone:interview` 段落：逐条访谈人的指令、主题清单（职责、规程、数据来源、沟通风格、质量标准、参考案例、禁止事项），以及最后用完整档案调用一次 `clone_draft_save` 的指令。该工具只注册在那个 agent 的 scope 中，其结果给出所保存的克隆与修订号；开场刺激以一条 user 角色消息到达，其来源种类为 `ketos-clone-interview`，其 transcript 行是折叠提示 "Clone interview started"。

#### Token effect

该段落约 320 token，随访谈会话的每个请求同行；工具 schema 把其参数加入该会话的工具目录。其他任何会话、其他任何请求都不携带这两者。

#### KV Cache effect

段落文本是静态的，因此请求前缀在各轮次之间保持逐字节一致，缓存得以保持；只有工具结果与普通消息增长后缀。在 `ready` 时撤回该模式会把该段落从下一次组装中移除，按设计这是一次新的前缀。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **`clone_tasks` 尚未加入** —— 自主任务阶段会把它作为同一运行器的第 4 步加入；在此之前数据库保存克隆记录、会话绑定与记忆。
- **路由为手工校验而非生成** —— 克隆领域没有 Typert 代码生成（API 仍在变化），因此浏览器与主机手工共享 `src/types.ts`，并由路由自行校验每个字段。
- **`skills` 已存储但尚未使用** —— 访谈工具会写入人列出的那些名字，它们在记录与 wire 之间往返，但在方法论/技能阶段之前，没有编辑控件或提示词消费它们。
- **访谈进度是状态，不是清单** —— 本包报告 `interviewing` 与 transcript；它不跟踪覆盖了哪些主题，拥有进度的阶段可以在不改变该模式的前提下加入清单。
- **开场每个会话只排队一次** —— 待处理收件箱与会话日志是权威；一次硬杀留在待处理状态的开场会在恢复时被认领，而不是被排入两次；从未到达这两者中任何一者的开场会被再次排队，而不是让会话静默等待。
- **首选模型通过浏览器的模型选择应用** —— 创建克隆会话会通过 `remote.session.selectModel` 选中存储的路由，该操作同时把选择保存为 `agent-default-model` 系统默认值；面向产品的该副作用说明由 `packages/client/ui-board/README.md` 拥有。
- **删除克隆会移除其会话绑定** —— 会话本身仍作为普通会话留在会话存储中；没有其他方式解除绑定。
- **没有回滚，也不能降级** —— 由更新构建写入的数据库会在打开时被拒绝；恢复方式是使用更新的构建或删除该文件。
- **记忆搜索是词法的，而非语义的** —— 基于 `unicode61` 词元的 FTS5 前缀匹配；在后 MVP 阶段之前没有嵌入向量，也没有跨克隆知识库。
- **`candidate` 是状态，不是隔离区** —— `methodology_candidate: true` 存储 `status = 'candidate'`，窗口会显示该行；PII 掩蔽与审查队列属于后 MVP。
- **记忆没有修订号校验** —— 与克隆记录不同，记忆编辑是最后写入者获胜；窗口在每次变更后重新读取列表，且 agent 与人写的是同一批行。
- **已归档的记忆仍然存在** —— 人的窗口可以恢复它们；agent 的搜索与提示词快照会跳过它们。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

用 `sqlite3 "$DSH_HOME/clones.db" '.schema'` 查看实时数据库；Ketos CLI 的默认 home 是 `~/.ketos`。运行包测试：`pnpm exec vitest run packages/ketos/clone-core/tests`；`tests/composition.spec.ts` 通过真实 Loader 在 agent 栈旁挂载该行，并驱动整条路径——访谈的安装、开场、保存与撤回，记忆工具保存并找到一条事实，档案与记忆的注入，人在编辑后与删除后快照的刷新，以及克隆被删除时 scope 的撤回；`tests/memory.spec.ts` 覆盖记忆存储、其 FTS 同步、克隆隔离，以及一万条记录的搜索预算。

</details>
