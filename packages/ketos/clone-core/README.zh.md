---
description: "Ketos 克隆领域的主机包：clones.db、其只进式 schema、以修订号做 CAS 的仓库，以及看板克隆窗口调用的 /api/ketos.clones Fetch 路由。"
kind: "package-reference"
---

# @ketos/clone-core

[English](README.md) | 中文

## 概述

`@ketos/clone-core` 拥有 Ketos 克隆领域。克隆是一条存储记录——名称、角色、简介、角色设定、方法论、首选模型路由、技能、状态——以及绑定到它的会话；本包是这些数据的唯一写入方：位于 `$DSH_HOME/clones.db` 的一个 `node:sqlite` 数据库、只进式 schema 运行器、仅在调用方读到的修订号下才应用更新与删除的仓库，以及看板克隆窗口读写所用的精确 `/api/ketos.clones` Fetch 路由。本包仅存在于主机侧，目前不贡献提示词段落、工具或会话事件。

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

失败应答为 HTTP 状态码加 `{ ok: false, error }`：`400` `ketos/invalid`、`404` `ketos/clone-not-found`、`409` `ketos/clone-conflict`。请求体在路由处逐字段校验，因为这里是 wire 边界：未知字段、超长文本、空名称或空角色、非整数修订号以及未知 `op` 一律拒绝，而不是被静默丢弃。

### 可观察行为

- **打开是惰性的。** 配置会挂载插件并注册路由，但 `node:sqlite` 的导入与文件打开发生在首次路由调用时，因此从不触碰克隆的进程在启动时不会打印 Node 的 SQLite 实验性警告。
- **文件仅属主可访问。** 父目录以 `0700` 创建，缺失的数据库文件以 `0600` 创建；已存在的文件保留其权限。数据库以 WAL 模式运行，`application_id` 为 `KTCL`，`user_version` 为 `1`。
- **外来数据库被拒绝。** 由其他应用写入的 `application_id`、比本构建更新的 `user_version`，或不是 SQLite 数据库的文件，都会在打开时被拒绝而不是被改写。没有戳记的空 SQLite 文件会被采用。
- **写入按修订号校验。** 仅当存储的 `revision` 仍等于调用方读到的值时，`update` 与 `delete` 才会生效；否则应答 `ketos/clone-conflict`，存储记录保持不变。一个会话最多绑定一个克隆，且同一会话的最新绑定生效。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>Implementation internals — click to expand</summary>

### Schema

`clones` 每个克隆一行；`clone_sessions` 每个绑定会话一行，并在 `clone_id` 上有索引。两张表都是 STRICT 表，时间戳为 ISO-8601 UTC 字符串，且每次读取都会解码它找到的持久化值——未知 `status` 或不是字符串数组的 `skills_json` 会直接报错，而不会把损坏的克隆带到 UI。

### 只进式运行器

`src/schema.ts` 拥有有序的步骤列表：第 `n - 1` 项产出 `user_version` `n`，`migrate` 在一趟中补齐所有缺失步骤，再写入当前版本戳。没有回滚，也不会丢失数据；更新的存储版本会被拒绝，绝不降级。`clone_tasks` 与记忆表会在各自阶段作为第 2、3 步加入列表。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`name`/`inject`/`Config`/`apply`、惰性打开的数据库及其释放 |
| [`src/db.ts`](src/db.ts) | 仅属主可访问的文件创建、打开序列，以及插件共享的惰性句柄 |
| [`src/schema.ts`](src/schema.ts) | 身份与版本戳、有序迁移步骤，以及运行器 |
| [`src/repository.ts`](src/repository.ts) | 带修订号 CAS 的预处理语句 CRUD 与会话绑定 |
| [`src/routes.ts`](src/routes.ts) | 精确 Fetch 路由、其手工请求体校验与错误码 |
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

### Clone records

#### What the model sees

目前没有。本包不注册提示词段落、工具、schema 或会话事件，克隆的角色设定、方法论与技能在这些字段被组合进 agent 系统提示词的阶段之前，始终只是 `clones.db` 中的主机侧数据。

#### Token effect

每个实时请求零 token。

#### KV Cache effect

无；本包从不触碰实时请求前缀。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **任务表与记忆表尚未加入** —— `clone_tasks` 与 `memories` 是同一运行器的第 2、3 步，由自主任务与记忆阶段添加；在此之前数据库只保存克隆记录与会话绑定。
- **路由为手工校验而非生成** —— 克隆领域没有 Typert 代码生成（API 仍在变化），因此浏览器与主机手工共享 `src/types.ts`，并由路由自行校验每个字段。
- **`skills` 已存储但尚未使用** —— 该字段在记录与 wire 之间往返；在方法论/技能阶段之前，没有编辑控件、工具或提示词消费它。
- **首选模型通过浏览器的模型选择应用** —— 创建克隆会话会通过 `remote.session.selectModel` 选中存储的路由，该操作同时把选择保存为 `agent-default-model` 系统默认值；面向产品的该副作用说明由 `packages/client/ui-board/README.md` 拥有。
- **删除克隆会移除其会话绑定** —— 会话本身仍作为普通会话留在会话存储中；没有其他方式解除绑定。
- **没有回滚，也不能降级** —— 由更新构建写入的数据库会在打开时被拒绝；恢复方式是使用更新的构建或删除该文件。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

用 `sqlite3 "$DSH_HOME/clones.db" '.schema'` 查看实时数据库；Ketos CLI 的默认 home 是 `~/.ketos`。运行包测试：`pnpm exec vitest run packages/ketos/clone-core/tests`；真实组合启动测试也在同一命令中（`tests/composition.spec.ts` 通过 Loader 与记录型 connection 服务挂载该行）。

</details>
