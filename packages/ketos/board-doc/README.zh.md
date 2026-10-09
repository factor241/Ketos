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
| `maxWindowRecords` | `100` | 文档持有的窗口记录数量上限（1–10000）。 |
| `maxOpsPerRequest` | `512` | 单个请求可批量提交的操作数量上限（1–1024）。 |
| `maxRequestBytes` | `1048576` | 可接受的操作请求体大小上限（字节，1 KiB–64 MiB）。 |
| `journalCompactRows` | `500` | 日志行数超过该值后压缩为一行更新（1–100000）。 |
| `heartbeatMs` | `15000` | 事件流心跳间隔（毫秒，1000–300000）。 |
| `maxStreamQueueBytes` | `4194304` | 每个事件流中补丁与心跳的缓冲积压上限（字节，16 KiB–256 MiB）；快照不计入。 |
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
| `subscribe(listener): () => void` | 每次已提交变更产生一次 `{ revision, upserts, removes, participants?, windows? }`；调用方通过 `ctx.effect` 持有取消订阅函数 |
| `stateVector(): Promise<Uint8Array>` | 本文档编码后的状态向量，在连接时发送给另一台 Ketos |
| `diffSince(stateVector): Promise<Uint8Array>` | 一条更新，携带对方状态向量未覆盖的全部内容 |
| `applyRemote(update): Promise<BoardRemoteResult>` | 以 `peer` 来源应用来自另一台 Ketos 的更新；不可读字节抛出 `BoardSyncError` 且不改变任何内容；当 Yjs 仍让更新的一部分等待更早的更新时，`{ pending }` 为 true |
| `onLocalUpdate(listener): () => void` | 本 Ketos 产生的每个事务调用一次；远端更新与 `load` 重放永不触达监听器 |

来自 `browser` 的批次只能创建属于 `selfId` 的元素，并且只能修改或删除自己拥有的元素；`host` 批次绕过该检查。`browser` 批次还不能创建主机数据类型（`BOARD_HOST_DATA_KINDS`，目前为 `todo`）的元素，也不能 patch 其 `data`，否则应答 `ketos/element-host-data`（403）；移动、缩放、调整层叠和删除此类元素仍然允许，因为其数据镜像 Beads，只有宿主写入。补丁按键合并 `data`，并移除值为 `null` 的键，因此宿主可以在不重写整个负载的情况下清除可选标志；随后会针对合并后的完整数据检查该类型的规则。

参与者注册表位于第二个顶层 `Y.Map`（名为 `participants`），以 `OwnerId` 为键。每个 Ketos 只写以自己的 `selfId` 为键的记录——`{ name, color, updatedAt }`——这正是阶段 33 同步文档后两个 Ketos 实例不会互相覆盖身份的原因。颜色规则由 `@ketos/peer` 拥有并调用 `putOwnParticipant`；快照在 `participants` 中携带每条可读记录，参与者写入会在（空的）元素列表之外发出带 `participants.upserts`/`removes` 的补丁。与本构建不符的记录会被跳过并记录一行日志，与不可读元素完全一致。

日志追加失败（`BoardJournalError`）会使变更留在内存中而不在 `board.db` 中，并且 Yjs 13.6.33 会在监听器抛出异常的文档上停止派发 `update` 事件。因此 `apply`、`applyRemote` 与 `putOwnParticipant` 会把该文档从缓存中丢弃，并在下一次调用时从 `board.db` 重新加载，失败的变更便从内存中消失，而不是半写入；调用方收到错误，且没有订阅者收到补丁。在另一次调用使日志损坏之前已取得文档的读取（`snapshot`、`participants`、`stateVector`、`diffSince`）同样会先重新加载，因此任何快照或差异都不会携带 `board.db` 中缺失的变更。压缩失败只记录日志：已追加的行已提交，下一次追加会重试。`subscribe` 或 `onLocalUpdate` 监听器抛出的异常会被记录，既不会使已提交的批次失败，也不会饿死其后的监听器。

### 同步

阶段 33 让两台 Ketos 实例上的整个文档保持一致；本包对通道一无所知。`@ketos/peer` 在连接时发送 `stateVector()`，用 `diffSince(vector)` 回答对方的状态向量，并把每个到达的更新交给 `applyRemote(update)`。远端更新就是普通事务：它以 `peer` 来源追加一条日志行，并向事件流订阅者发出同样的 `{ revision, upserts, removes, participants?, windows? }` 补丁，因此浏览器通过现有事件流获知变更。`onLocalUpdate(listener)` 转发本 Ketos 自己产生的更新——浏览器批次或宿主调用提交的事务——并且永不转发 `applyRemote`（来源 `peer`）或日志重放（来源 `load`），这正是交换不会回声的原因。字节在进入文档之前先被校验：不可读的更新抛出 `BoardSyncError`，文档保持不变。`applyRemote` 返回 `{ pending }`：当更新依赖尚未到达的更新（Yjs 保留 `pendingStructs` 或 `pendingDs`）时为 true；只要仍有内容在等待，收到的字节还会作为另一条 `peer` 行完整追加，因为事务自身的行只携带已整合的部分，所以等待部分在重启后仍然保留，并在缺失的更新应用后自行整合。更新中本构建无法解码的条目（其他版本的元素、参与者或窗口记录，或不是映射的值）会在补丁中被跳过并写入日志，与快照中的处理完全一致；本 Ketos 写入的键（自己的参与者记录、自己承载的窗口）会用新记录替换此类值。

窗口记录以幂等方式写入：除 `updatedAt` 外所有字段都与已存记录相同的 `window.put` 不修改任何内容、不追加日志行，也不发出补丁。`./windows` 的 `clampWindowTitle(title)` 把标题截断到记录上限（200 个 UTF-16 代码单元）且不拆开代理对；`./data` 的 `eraserPathReachesBox(path, radius, box)` 让客户端在对每个点运行 `eraseStroke` 之前，判断橡皮路径能否触及笔画的世界矩形（`{ x, y, w, h }`），仅当路径与矩形的距离始终大于 `radius` 时才返回 false。

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

### 窗口记录

第三个顶层 `Y.Map`（名为 `windows`）按客户端铸造的 `WindowId` 保存每个打开窗口的记录。记录为 `{ id, hostId, ownerId, kind, bodyKind, title, ordinal, x, y, w, h, z, access, status, sessionId?, updatedAt }`：`hostId` 命名窗口所在的 Ketos，`ownerId` 是在那里管理它的参与者，`title` 是用户命名或聊天名称（`null` 让接收方按 `kind` 与 `ordinal` 用自己的语言命名窗口），`status` 是窗口的会话状态，`sessionId` 仅随聊天窗口出现，`access` 是布局的 owner/selected/all 词汇。主机盖上 `hostId = selfId` 与 `updatedAt`；记录声明了其他 `hostId`、或目标记录由其他 Ketos 发布的 `window.put` 会以 `ketos/window-foreign`（409）拒绝，因此一个窗口恰好只有一个写入者。对不存在的键执行 `window.remove` 不改变任何内容；`browser` 删除一个保存着本构建无法解码的记录的键时以 `ketos/window-foreign` 拒绝，因为该记录可能属于另一台 Ketos，而 `host` 删除会将其删去。记录预算为 `maxWindowRecords`；快照在 `windows` 中携带每条可读记录，补丁在 `windows.upserts`/`windows.removes` 中携带变更，记录永不进入元素映射。

### 身份标识

首次打开时在 `meta` 表中创建 `selfId`（由 `crypto.getRandomValues` 生成的 UUIDv4）与 `docId`，并在数据库的整个生命周期内保留；之后的打开读取它们，值不是 UUID 即为明确的打开失败。`board.db` 带有自己的 `application_id` 与 `user_version`，因此打开无关的 SQLite 文件会失败而不会写入：`application_id` 为 0 的非空文件仅当已含 `updates` 与 `meta` 表时才会被接纳，全新的空文件在首次打开时盖章。文件以 `0600` 创建于 `0700` 目录中。打开序列先设置 `PRAGMA locking_mode = EXCLUSIVE`，用 `BEGIN EXCLUSIVE; COMMIT` 取得锁，之后才启用 WAL，因此同一 `DSH_HOME` 上的第二个 Ketos 进程会立即（`busy_timeout = 0`，因为持锁者在整个生命周期内保持该锁）以 `board database <path> is open in another Ketos process` 失败，而不会压缩第一个进程仍依赖的行；同理，Ketos 运行期间 `sqlite3` 无法读取该文件。

### 路由与错误码

| 路由 | 方法 | 请求体 | 应答 |
|---|---|---|---|
| `/api/ketos.board` | `GET` | — | `BoardSnapshot` |
| `/api/ketos.board.ops` | `POST` | `{ ops: BoardOp[] }` | `{ ok: true, revision }` |
| `/api/ketos.board.events` | `GET` | — | `text/event-stream`：一个 `snapshot` 事件，随后是 `patch` 事件与 `: ping` 心跳；因溢出而关闭之前先发送最后一个 `overflow` 事件（`{ "reason": "queue" }`） |

被拒绝的批次以 HTTP 状态码加 `{ ok: false, error }` 应答，error 为 `ketos/invalid`（400）、`ketos/element-not-found`（404）、`ketos/element-host-data`（403）、`ketos/element-foreign`、`ketos/element-exists`、`ketos/window-foreign`、`ketos/limit`（409）之一，或空 500 响应体。超过 `maxRequestBytes` 的请求体应答 413。请求中止或消费方取消时事件流关闭；未读的补丁与心跳超过 `maxStreamQueueBytes` 时关闭；超过 `maxStreams` 的流应答 503；快照不计入积压，因此大于上限的快照不会关闭流。溢出的流发送一个 `overflow` 事件、记录一行日志并关闭，使浏览器能把该上限与传输故障区分开，并在暂停后重新读取快照；插件释放时关闭所有打开的流。

### 惰性加载

`node:sqlite` 与 `yjs` 只从 `src/index.ts` 惰性导入的模块触达，因此从不接触看板的进程不会加载这两个库，启动输出不会出现 Node 的 SQLite 实验性警告，也不会出现 yjs 的 `lib0` 存储警告。

### 源码映射

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`name`/`inject`/`Config`/`apply`、服务与路由注册 |
| [`src/types.ts`](src/types.ts) | 品牌化标识、元素信封、快照与补丁、操作联合与错误码；浏览器代码仅按类型导入 |
| [`src/kinds.ts`](src/kinds.ts) | 元素种类列表、主机数据种类、图层排序与坐标边界 |
| [`src/data.ts`](src/data.ts) | UUID 生成、按种类数据校验，以及浏览器共享的笔画几何（`eraseStroke`、`eraserPathReachesBox`） |
| [`src/windows.ts`](src/windows.ts) | 线上与浏览器共享的窗口 id 与记录校验、`clampWindowTitle` 与内容比较 |
| [`src/db.ts`](src/db.ts) | 仅属主可访问的文件创建、打开序列、本地身份与共享惰性句柄 |
| [`src/schema.ts`](src/schema.ts) | 身份与版本戳记及只进式迁移步骤 |
| [`src/journal.ts`](src/journal.ts) | 更新日志的加载、追加、压缩与观察；`BoardJournalError` 与 `broken` 标志 |
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

- `applyRemote` 信任另一台 Ketos：它不检查所收到数据的所有者、`maxElements` 与 `maxWindowRecords` 预算或主机数据类型，这是有意为之，直到演示之后决定按人划分的权限。
- 窗口记录携带的是窗口的已发布视图，而不是其实时会话：接收方在拥有该窗口的 Ketos 回应转录请求（阶段 34）之前渲染占位内容。
- 窗口记录的重写按字段后写者胜，这没有问题，因为只有承载窗口的 Ketos 会写自己的记录；不可见的浏览器标签页从不发布。
- 在 Node ≥ 25 上，首次访问看板会打印一条 `lib0` 警告「localStorage is not available because --localstorage-file was not provided」；由于 `yjs` 是惰性导入的，该警告出现在首次使用时而非启动时，而 Node 24（Docker 环境）不打印任何警告。
- 看板将元素放在所有窗口之下的单一图层中，并且一次只选中一个元素；多选、窗口与元素的交错顺序以及撤销历史不在范围内。
- 事件流是该包的第一条 SSE 路由；它依赖浏览器在隐藏标签页中关闭连接，以保持在 HTTP/1.1 每源连接预算之内。

<a id="dev-note"></a>
### 开发备注

使用 `node --experimental-sqlite -e "..."` 或任意 SQLite shell 检查数据库；日志行是不透明的 Yjs 更新，因此请通过 `doc.snapshot()` 重建状态，而不是读取表。运行包测试套件：

```sh
pnpm exec vitest run packages/ketos/board-doc --coverage --coverage.include='packages/ketos/board-doc/src/**/*.ts'
```
