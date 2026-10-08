---
description: "Ketos 看板文档主机包：基于 Yjs 文档的 board.db node:sqlite 日志、本地 selfId 与 docId、元素信封及其原子操作批次、ctx.ketosBoardDoc 服务，以及 /api/ketos.board、/api/ketos.board.ops 和 /api/ketos.board.events Fetch 路由。"
kind: "package-reference"
---

# @ketos/board-doc

[English](README.md) | 中文

## 概述

`@ketos/board-doc` 拥有看板元素的通用模型：便签、笔迹、待办清单、参与者注册表，以及（自阶段 33 起）共享的窗口记录。`$DSH_HOME/board.db` 中的一个 `node:sqlite` 数据库以只追加更新日志的形式存储 Yjs 文档；本地参与者身份 `selfId` 与文档身份 `docId` 存放在同一数据库中、位于同步文档之外。该包提供 `/api/ketos.board`、`/api/ketos.board.ops` 和 `/api/ketos.board.events` Fetch 路由，其他 Ketos 插件通过 `ctx.ketosBoardDoc` 服务访问同一文档。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

随附的 `web` 配置通过 `dsh-web-app` 捆绑补丁挂载该包，这是唯一受支持的组合方式：

```yaml
- id: ketos-board-doc
  name: '@ketos/board-doc'
  config:
    path: !!js dshHomePath('board.db')
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `path` | 必填 | SQLite 数据库文件路径，或 `:memory:`。Web 配置传入 `$DSH_HOME/board.db`（Ketos CLI 为 `~/.ketos/board.db`）。 |
| `maxElementBytes` | `262144` | 单个已存元素的序列化大小上限（字节，1 KiB–16 MiB）。 |
| `noteTextMax` | `20000` | 单条便签文本长度上限（UTF-16 代码单元，1–1000000）。 |
| `strokePointsMax` | `2000` | 单个笔画可携带的描点数量上限（2–100000）。 |
| `todoItemsMax` | `200` | 单个待办列表可携带的条目数量上限（1–10000）。 |
| `maxElements` | `2000` | 文档可容纳的元素数量上限（1–100000）。 |
| `maxOpsPerRequest` | `64` | 单个请求可批量提交的操作数量上限（1–1024）。 |
| `maxRequestBytes` | `1048576` | 可接受的操作请求体大小上限（字节，1 KiB–64 MiB）。 |
| `journalCompactRows` | `500` | 日志行数超过该值后压缩为一行更新（1–100000）。 |
| `heartbeatMs` | `15000` | 事件流心跳间隔（毫秒，1000–300000）。 |
| `maxStreamQueueBytes` | `4194304` | 事件流缓冲积压上限（字节，16 KiB–256 MiB）。 |
| `maxStreams` | `16` | 并发事件流数量上限（1–1024）。 |

该包没有浏览器捆绑产物：`packages/client/ui-board` 使用普通 `fetch` 访问路由，并导入浏览器安全的 `./types`（自阶段 28.3 起还有 `./kinds` 与 `./data`）模块，因此看板在现有注册结构内持有元素，而不新增客户端插件行。

该服务是其他 Ketos 包的主机端接缝：

| 成员 | 返回 |
|---|---|
| `selfId(): Promise<OwnerId>` | 本 Ketos 的身份，存放在同步文档之外 |
| `docId(): Promise<BoardDocId>` | 文档身份 |
| `snapshot(): Promise<BoardSnapshot>` | 当前修订号下的全部元素与参与者记录 |
| `apply(ops, origin): Promise<BoardOpsResponse>` | 原子应用一个批次，并返回新修订号 |
| `participants(): Promise<BoardParticipantRecord[]>` | 本构建能解码的全部已存储参与者记录 |
| `putOwnParticipant({ name, color }): Promise<void>` | 写入以本 Ketos 的 `selfId` 为键的记录，并以参与者补丁宣告 |
| `subscribe(listener): () => void` | 每条已提交日志行产生一次 `{ revision, upserts, removes, participants? }`；调用方通过 `ctx.effect` 持有取消订阅函数 |

来自 `browser` 的批次只能创建属于 `selfId` 的元素，并且只能修改或删除自己拥有的元素；`host` 批次绕过该检查。补丁按键合并 `data`，并移除值为 `null` 的键，因此宿主可以在不重写整个负载的情况下清除可选标志；随后会针对合并后的完整数据检查该类型的规则。

参与者注册表位于第二个顶层 `Y.Map`（名为 `participants`），以 `OwnerId` 为键。每个 Ketos 只写以自己的 `selfId` 为键的记录——`{ name, color, updatedAt }`——这正是阶段 33 同步文档后两个 Ketos 实例不会互相覆盖身份的原因。颜色规则由 `@ketos/peer` 拥有并调用 `putOwnParticipant`；快照在 `participants` 中携带每条可读记录，参与者写入会在（空的）元素列表之外发出带 `participants.upserts`/`removes` 的补丁。与本构建不符的记录会被跳过并记录一行日志，与不可读元素完全一致。

`note` 类型的数据恰好是 `{ text, font, size, scale }`：`text` 最长为 `noteTextMax` 个 UTF-16 代码单元（与 `maxLength` 语义一致），`font` 为 `sans`、`serif`、`mono` 之一，`size` 为 `s`、`m`、`l` 之一，`scale` 为 `0.5`、`0.75`、`1`、`1.5`、`2`、`3` 之一；任何多余字段、缺失字段或列表之外的值都会以 `ketos/invalid` 拒绝该批次。元素的 `w`/`h` 是便签的世界矩形，内容以 `w/scale × h/scale` 在 `transform: scale(scale)` 下绘制，因此改变缩放会同时 patch `w`、`h` 与 `data.scale`。

`stroke` 类型的数据恰好是 `{ points, width, pen }`：`points` 包含 2 到 `strokePointsMax` 个 `[x, y, pressure]` 三元组，坐标相对于元素的 `(x, y)` 且不超出 `w`/`h`，`pressure` 在 `[0, 1]` 内，`width` 为 `s`、`m`、`l` 之一（4、8 或 16 世界单位），`pen` 记录是否由触控笔绘制；任何多余字段、缺失字段或超界值都会拒绝该批次。`pen` 与 `width` 构成绘制选项的完整输入，因此每个 Ketos 都会把同一组描点渲染为同一条路径。

`todo` 类型的数据恰好是 `{ epicId, title, items, syncedAt, missing?, pendingPlacement? }`：`epicId` 与每个条目的 `id` 都是 Beads 议题 id（`<prefix>-<serial>[.<child>...]`），`title` 与 `syncedAt` 为非空字符串，`items` 最多包含 `todoItemsMax` 个 `{ id, title, status }` 条目，其 `status` 为 `open`、`in_progress`、`blocked`、`deferred`、`closed` 之一，`missing`/`pendingPlacement` 是可选的 `true` 标志；任何多余字段、缺失字段或不符合这些规则的值都会拒绝该批次。快照由宿主拥有：`@ketos/board-todo` 在每次变更后从 `bd` 重新读取并写回。

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部细节——点击展开</summary>

### 文档结构

Yjs 文档持有一个名为 `elements` 的 `Y.Map`，以 `ElementId` 为键；每个元素本身是一个 `Y.Map`，包含信封键（`kind, ownerId, x, y, w, h, z, createdAt, updatedAt`）以及一个嵌套的 `data` `Y.Map`，其值为普通 JSON。按键嵌套的映射使两名参与者可以并发编辑同一元素的不同字段而互不丢失；元素绝不会以单个 JSON 值存储。本地 `selfId` 有意不作为文档键：阶段 33 会在两个 Ketos 实例之间同步整个文档，因此文档内的身份会变成共享身份。

### 日志与修订号

每次已提交的 `doc.transact` 产生一个 Yjs 更新，存储将其作为 `updates(seq INTEGER PRIMARY KEY AUTOINCREMENT, update BLOB, origin TEXT, at TEXT)` 的一行追加。浏览器读取的 `revision` 就是该行的 `seq`：它在重启和压缩后保持单调，一个批次是一个事务、一个更新、一行。加载时通过 `Y.mergeUpdates` 合并已存更新，并以 `load` 来源应用；更新监听器忽略 `load`，追加其他所有来源。日志超过 `journalCompactRows` 行时，一个 SQL 事务写入 `Y.encodeStateAsUpdate(doc)` 作为 `compact` 行并删除更早的所有行，因此修订号绝不会减小。

### 身份标识

首次打开时在 `meta` 表中创建 `selfId`（由 `crypto.getRandomValues` 生成的 UUIDv4）与 `docId`，并在数据库的整个生命周期内保留；之后的打开读取它们，值不是 UUID 即为明确的打开失败。`board.db` 带有自己的 `application_id` 与 `user_version`，因此打开无关的 SQLite 文件会失败而不会写入；文件以 `0600` 创建于 `0700` 目录中，启用 WAL 与忙等待，与克隆数据库一致。

### 路由与错误码

| 路由 | 方法 | 请求体 | 应答 |
|---|---|---|---|
| `/api/ketos.board` | `GET` | — | `BoardSnapshot` |
| `/api/ketos.board.ops` | `POST` | `{ ops: BoardOp[] }` | `{ ok: true, revision }` |
| `/api/ketos.board.events` | `GET` | — | `text/event-stream`：一个 `snapshot` 事件，随后是 `patch` 事件与 `: ping` 心跳 |

被拒绝的批次以 HTTP 状态码加 `{ ok: false, error }` 应答，error 为 `ketos/invalid`（400）、`ketos/element-not-found`（404）、`ketos/element-foreign`、`ketos/element-exists`、`ketos/limit`（409）之一，或空 500 响应体。超过 `maxRequestBytes` 的请求体应答 413。请求中止或消费方取消时事件流关闭；缓冲积压超过 `maxStreamQueueBytes` 时关闭（浏览器重连并重新读取快照）；超过 `maxStreams` 的流应答 503；插件释放时关闭所有打开的流。

### 惰性加载

`node:sqlite` 与 `yjs` 只从 `src/index.ts` 惰性导入的模块触达，因此从不接触看板的进程不会加载这两个库，启动输出不会出现 Node 的 SQLite 实验性警告，也不会出现 yjs 的 `lib0` 存储警告。

### 源码映射

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`name`/`inject`/`Config`/`apply`、服务与路由注册 |
| [`src/types.ts`](src/types.ts) | 品牌化标识、元素信封、快照与补丁、操作联合与错误码；浏览器代码仅按类型导入 |
| [`src/kinds.ts`](src/kinds.ts) | 元素种类列表、图层排序与坐标边界 |
| [`src/data.ts`](src/data.ts) | UUID 生成与浏览器共享的按种类数据校验 |
| [`src/db.ts`](src/db.ts) | 仅属主可访问的文件创建、打开序列、本地身份与共享惰性句柄 |
| [`src/schema.ts`](src/schema.ts) | 身份与版本戳记及只进式迁移步骤 |
| [`src/journal.ts`](src/journal.ts) | 更新日志的加载、追加、压缩与观察 |
| [`src/doc.ts`](src/doc.ts) | Yjs 文档包装：元素读取、写入与变更解码 |
| [`src/ops.ts`](src/ops.ts) | 操作体解析、默认值、属主规则与原子事务 |
| [`src/service.ts`](src/service.ts) | `ctx.ketosBoardDoc` 服务定义 |
| [`src/routes.ts`](src/routes.ts) | 快照与操作 Fetch 路由及其错误码 |
| [`src/events.ts`](src/events.ts) | `text/event-stream` 路由：快照、补丁、心跳与限制 |
| [`src/wire.ts`](src/wire.ts) | 共享路由助手：JSON 应答、`no-store` 与请求体校验 |
| — | 不发布运行时不变式伴随模块：文档的身份检查、日志单调性与路由行为由包测试覆盖，不存在可持续观察的进程内关系可发布。 |

</details>

<a id="further-exploration"></a>
## 进一步探索

- [`packages/ketos/README.md`](../README.zh.md) — Ketos 包组。
- [`packages/client/ui-board/README.md`](../../client/ui-board/README.zh.md) — 看板消费方：元素层、其插槽与 `board-coordinates.ts`。
- [`@ketos/clone-core`](../clone-core/README.zh.md) — 本包遵循其数据库、wire 与路由布局的姊妹主机包。

<a id="model-experience"></a>
## 模型体验

None, as the board document is user interface state: the snapshot, operations, and stream reach only the browser and the board plugin, never a model request, prompt section, tool schema, or session event.

#### KV Cache effect

无影响；文档变更的是视图状态而非模型上下文。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 参与者注册表只在本地读写；在两个 Ketos 实例之间携带记录的文档同步在阶段 33 到来，在此之前浏览器名册把本地记录与对等通道的状态合并展示。
- 窗口记录将在阶段 33 作为同一文档中的一个独立 `windows` 映射出现，而不是 `elements` 映射中的元素。
- 在 Node ≥ 25 上，首次访问看板会打印一条 `lib0` 警告「localStorage is not available because --localstorage-file was not provided」；由于 `yjs` 是惰性导入的，该警告出现在首次使用时而非启动时，而 Node 24（Docker 环境）不打印任何警告。
- 看板将元素放在所有窗口之下的单一图层中，并且一次只选中一个元素；多选、窗口与元素的交错顺序以及撤销历史不在范围内。
- 事件流是该包的第一条 SSE 路由；它依赖浏览器在隐藏标签页中关闭连接，以保持在 HTTP/1.1 每源连接预算之内。

<a id="dev-note"></a>
### 开发备注

使用 `node --experimental-sqlite -e "..."` 或任意 SQLite shell 检查数据库；日志行是不透明的 Yjs 更新，因此请通过 `doc.snapshot()` 重建状态，而不是读取表。运行包测试套件：

```sh
pnpm exec vitest run packages/ketos/board-doc --coverage --coverage.include='packages/ketos/board-doc/src/**/*.ts'
```
