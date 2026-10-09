---
description: "Ketos 对等通道宿主包：带存储密钥的 iroh 节点、ctx.ketosPeer 背后的分帧消息通道、一次性邀请码与已知节点文件、每个 Ketos 发布的参与者记录、外来聊天窗口的只读记录，以及 /api/ketos.peer.* Fetch 路由。"
kind: "package-reference"
---

# @ketos/peer

[English](README.md) | 中文

## 概述

`@ketos/peer` 拥有让不同计算机上的两个 Ketos 作为一个团队协同工作的通道。它绑定一个 iroh 节点，密钥存储在 `$DSH_HOME/peer.key`；在每条连接的一个双向流上承载分帧消息通道（`[u32 BE 长度][u8 类型码][数据]`）；通过一次性的 `ketos1.…` 邀请码接纳第二个 Ketos；把已接纳的节点记入 `$DSH_HOME/peers.json`，此后连接不再需要邀请码；把每一侧的参与者记录发布到看板文档；并提供对方 Ketos 聊天窗口的只读记录。其他 Ketos 包通过 `ctx.ketosPeer` 服务访问它；浏览器通过 `/api/ketos.peer.*` 访问它。

节点按需启动——首次路由调用时启动，或插件启动时 `peers.json` 已记有节点则立即启动；随附的 web 配置默认关闭该行，因此从不组装演示环境的开发机永远不会加载原生 `@number0/iroh` 模块。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

演示环境通过自己的覆盖层（`docker/stand/stand.patch.yml`）挂载本包；随附的 `web` 配置保持该行关闭，只提供环境变量接缝：

```yaml
- id: ketos-peer
  name: '@ketos/peer'
  disabled: true
  config:
    name: !!js process.env.KETOS_PARTICIPANT_NAME ?? ''
    relayUrls: !!js (process.env.KETOS_RELAY_URLS ?? '').split(',').filter(Boolean)
    keyPath: !!js dshHomePath('peer.key')
    peersPath: !!js dshHomePath('peers.json')
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `name` | 必填 | 本 Ketos 发布的参与者名称（1–64 个字符）。 |
| `relayUrls` | 必填 | 团队私有 iroh 中继的 URL 列表；至少一个。它是节点唯一的中继表：绝不使用 n0 公共中继。 |
| `keyPath` | 必填 | 存储的 32 字节节点密钥；父目录以仅属主权限创建，文件为 `0600`。 |
| `peersPath` | 必填 | 已知节点文件；以原子方式写入，权限 `0600`。 |
| `maxFrameBytes` | `16777216` | 接受的最大帧体（1 KiB–64 MiB）。它必须至少为 `transcriptMaxBytes` 加 1024，因此在 `transcriptMaxBytes` 保持默认值时不能低于 66560。 |
| `maxSyncUpdateBytes` | `15728640` | 本 Ketos 发送的最大看板同步更新（1 KiB–64 MiB；必须小于 `maxFrameBytes`）。 |
| `onlineTimeoutMs` | `15000` | `invite()` 等待中继地址的时长（1000–120000）。 |
| `connectTimeoutMs` | `10000` | 拨号、流与握手的单步上限；也是请求的默认超时（1000–120000）。 |
| `reconnectMinMs` | `1000` | 首次重连暂停与首次看板重新同步暂停（100–60000）；不得超过 `reconnectMaxMs`，插件在加载时检查。 |
| `reconnectMaxMs` | `20000` | 暂停上限（100–600000）：带抖动的暂停绝不超过它，存活时间短于它的通道视为一次失败的尝试。 |
| `inviteTtlMs` | `3600000` | 一次性邀请密钥的有效期（60000–86400000）。 |
| `stateRefreshMs` | `1000` | 状态路由发布的轮询间隔（250–60000）。 |
| `bindAddr` | 无 | 本地绑定地址；缺省时在所有接口上绑定临时端口。 |
| `transcriptMaxMessages` | `20` | 本 Ketos 为其托管的聊天窗口返回的最多消息数；保留最新的（1–200）。 |
| `transcriptMaxMessageChars` | `4000` | 单条返回消息文本的最多 UTF-16 码元数（1–100000）。`transcriptMaxBytes` 必须至少为该值 × 6 + 256。 |
| `transcriptMaxBytes` | `65536` | 一次记录应答的最大字节数；最旧的消息先被丢弃（1024–1048576）。它必须至少为 `transcriptMaxMessageChars` × 6 + 256，连同为请求信封预留的 1024 字节，还必须容纳于 `maxFrameBytes`；插件在加载时检查这两点。 |
| `transcriptTimeoutMs` | `5000` | 本 Ketos 等待另一个 Ketos 应答记录请求的时长（500–60000）。 |

服务是其他 Ketos 包使用的宿主侧接缝：

| 成员 | 结果 |
|---|---|
| `peers(): PeerState[]` | 每个已知节点及其 `peerId`、`selfId`、`name`、`color` 和 `link: 'online' \| 'connecting' \| 'lost'` |
| `send(peerId, type, payload)` | 向已连接节点发送一帧；通道未打开时拒绝 |
| `request(peerId, type, payload, { timeoutMs })` | 发送一个请求信封；应答时兑现，超时（`PeerRequestTimeoutError`）、通道关闭或远端错误时拒绝 |
| `handle(type, handler): () => void` | 注册处理器；同一类型的每个处理器都会运行，第一个的返回值作为请求应答。消费者通过 `ctx.effect` 负责取消订阅 |
| `invite(): Promise<string>` | 中继地址就绪后生成一个 `ketos1.<ticket>.<secret>` 码；此前未使用的密钥会被替换 |
| `connect(code): Promise<{ peerId }>` | 拨打代码中的 ticket，完成握手并记录该节点 |
| `state(): Promise<PeerStateResponse>` | 本地记录、所有节点及 `refreshMs` |
| `nodeId(): Promise<KetosPeerId>` | 由存储密钥导出的本地 iroh 身份 |
| `startIfKnownPeers(): Promise<void>` | 仅当 `peers.json` 记有节点时启动节点 |
| `forget(peerId): Promise<void>` | 把没有打开通道的已知节点从 `peers.json` 和节点列表中移除，并取消其重拨；未知节点被拒绝（`ketos/peer-unknown`），通道在线的节点也被拒绝（`ketos/peer-online`） |
| `close(): Promise<void>` | 等待进行中的启动结束，然后关闭节点、其通道及所有重连尝试 |
| `closeSyncTooLarge(peerId)` | 因发出的同步更新超过上限而关闭一条通道；对方仍被记住并可重拨 |

浏览器轮询一个路由，通过三个路由写入，并通过一个路由读取外来记录：

| 路由 | 方法 | 请求体 | 应答 |
|---|---|---|---|
| `/api/ketos.peer.state` | `GET` | — | `{ self, peers, refreshMs }` |
| `/api/ketos.peer.invite` | `GET` | — | `{ invite }` |
| `/api/ketos.peer.connect` | `POST` | `{ invite }` | `{ peerId }` |
| `/api/ketos.peer.forget` | `POST` | `{ peerId }` | `{ ok: true }` |
| `/api/ketos.peer.transcript` | `POST` | `{ windowId }` | `{ messages: { role: 'user' \| 'agent', text, at }[] }`，最旧的在前 |

拒绝时返回 `{ ok: false, error }`，其值为 `ketos/invalid`（400）、`ketos/peer-self`（409）、`ketos/invite-used`（409）、`ketos/peer-unreachable`（504）、`ketos/peer-offline`（503）、`ketos/peer-online`（409，遗忘通道在线的节点）、`ketos/peer-unknown`（404，遗忘不在列表中的节点）、`ketos/transcript-closed`（403，所有者的访问设置不接纳本 Ketos）、`ketos/window-not-found`（404，没有这个外来聊天窗口，或所有者已不再托管它）或 `ketos/peer-timeout`（504，所有者未在 `transcriptTimeoutMs` 内应答）；其他情况为空的 500。当所有者没有在线通道、无法读取其会话日志，或发来的应答不属于任何导线形式时，记录路由还会返回 `ketos/peer-offline`。路由调用会启动节点，因此从不轮询它的进程永远不会绑定。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 节点与密钥

首次启动读取 `keyPath`；文件缺失时用 `SecretKey.generate()` 生成一次，并以独占创建标志写入 `0700` 目录中的 `0600` 文件；长度不是 32 字节的文件拒绝加载，而不是悄悄铸造新身份。端点用 `presetMinimal`、对等 ALPN `ketos/peer/2`、`RelayMode.customFromUrls(relayUrls)` 和存储的密钥构建，因此节点的 `EndpointId` 跨重启稳定。团队中继是节点所知的唯一中继：连接先经由它建立，iroh 在建立直连路径后再切换到直连。ALPN 携带 `PEER_PROTOCOL_VERSION`，因此协议版本不同的构建在任何帧出现之前就会在传输握手中失败。

### 帧

一条连接承载一个双向 QUIC 流；每条消息为 `[u32 BE 长度][u8 类型码][帧体]`。类型码表保留 `1 hello`、`2 bye`、`3 board.sv`、`4 board.update`、`5 chat.transcript.request`、`6 chat.transcript.response` 和 `7 syncthing.device`；消费者通过声明合并把各自的载荷并入 `PeerFrameTypeMap` 并注册处理器，没有处理器的保留帧只记一行日志后被忽略。记录应答以响应信封的形式走类型码 `5`，因此类型码 `6` 不承载任何帧。类型码 `3` 和 `4` 携带原始的、非空的 `Uint8Array` 帧体（Yjs 更新经 JSON 会膨胀且无法还原）；其余帧体为 JSON，请求/响应信封只存在于 JSON 类型码上。`send` 在入队前先编码并测量帧，因此词表拒绝的载荷和超过 `maxFrameBytes` 的帧体在发送方失败，而不会破坏接收方。二进制类型码的帧体若是 JSON 对象或数组也会被拒绝：版本 1 把这些帧编码为 JSON，接收方拒绝它们，而不是交给 Yjs。畸形帧体、未知类型码或被截断的帧会以 `2n` 关闭连接；处理器抛出的异常只记日志且通道继续存活，因为单个消费者的失败不应以连接为代价。

请求与应答共用同一帧类型：请求体为 `{ requestId, request }`，应答为 `{ requestId, response }` 或 `{ requestId, error }`。提问方拥有 `requestId` 及其超时；无人应答的请求在提问方超时。

### 握手与已知节点

拨号方打开流并先写 `hello`——接收方的 `acceptBi` 只在这些首批字节之后才解决。`hello` 为 `{ v: 2, selfId, name, color, invite? }`，在导线边界校验（版本、边界、调色板颜色、无未知字段）。连接的第一帧在两个方向上都受 `PEER_HELLO_MAX_BYTES`（4096 字节）约束，远小于 `maxFrameBytes`，因此陌生节点无法让本节点缓冲大帧体。当节点已在 `peers.json` 中，或 `hello` 携带其待处理邀请的一次性密钥时，接收方接纳该连接；没有有效密钥的未知节点被以 `1n` 关闭，并记录一行不含数据的 `peer.refused` 日志。随后双方互相记录：拨号方存储对等方的 ticket，接收方存储不带 ticket 的记录并等待对等方的重拨。

密钥先检查长度是否等于密钥固定的 26 个字符，再以恒定时间比较；长度不同的密钥算作错误。五次错误密钥会使待处理邀请作废（日志行 `peer.invite-burned`），下一次 `invite()` 重新开始计数。

`transport.accept()` 在传输握手之前就交出传入连接。每条传入连接在各自的任务中完成传输握手和 `hello` 交换，因此那里的失败只记日志（`incoming connection failed`、`handshake from … failed`）并只关闭该连接；接受循环只在传输关闭时结束。

已知节点已有活动链路时，双方按同一条规则保留同一条连接。两条连接的拨号方不同时（双方同时拨号，在双方都持有 ticket 时会发生），保留端点 id 较小的节点拨出的那条。两条连接的拨号方相同时，保留较新的那条：接收方只有在拨号方自己的链路失效时才会看到重拨，而同一节点的两次竞争拨号（粘贴的邀请码与重连循环）在两端以相同顺序完成。在成为链路之前落败的连接以 `3n`（`duplicate`）关闭；落败的活动链路以 `5n` 和原因 `replaced` 关闭（日志行 `peer.replaced`），消费者先看到 `ketos-peer/disconnected`，再看到新的 `ketos-peer/connected`。因链路已建立而停止的重连循环会让已在进行中的拨号完成，因此由规则而不是时序决定保留哪条连接；重拨暂停在 ±20% 范围内分散，到达上限时分散在上限以下的 20% 内，因此两个同时重拨的一方很少同时开始。

### 邀请码

`invite()` 等待中继地址（`online()` 受 `onlineTimeoutMs` 约束），没有地址时拒绝生成 ticket，因此邀请码总是指向经中继可达的节点。邀请码为 `ketos1.<endpoint ticket>.<base32 密钥>`；密钥是 16 个随机字节，一次性使用，仅存内存，在 `inviteTtlMs` 内有效。因此仅有泄露的 ticket 无法让任何人加入。

### 参与者与颜色

启动时节点把自己的记录发布到看板文档（`putOwnParticipant`），颜色取文档参与者与已知节点颜色中的第一个空闲调色板编号，并在 `hello` 中发送该记录。当对等方报告相同颜色时，规则是确定性的：看板 `selfId` 较大（字符串比较）的参与者把自己的记录改写为下一个空闲颜色并宣告新的 `hello`；另一侧保持其记录不变。每个参与者只写以自己 `selfId` 为键的记录，因此两个 Ketos 实例绝不会互相覆盖名称或颜色。

### 看板同步

`src/board-sync.ts` 把看板文档接入通道：每次 `ketos-peer/connected`——首次连接和每次重连——本 Ketos 都发送自己的状态向量（`board.sv`）；收到向量后以 `diffSince(vector)` 回答（`board.update`）；收到的更新经 `applyRemote` 应用，本 Ketos 产生的每个事务都会转发给每个已连接的对端。文档的 `peer` 来源保证已应用的更新不会回声，因此一次变更就是一帧。超过 `maxSyncUpdateBytes` 的更新永不发送：主机日志写入 `board.sync.too-large`，并以关闭码 `4n` 关闭通道；对端仍被记住并可重拨。当 `applyRemote` 抛出异常，或因 Yjs 把结构保留以等待更早的更新而返回 `{ pending: true }` 时，本 Ketos 会在一段暂停后再次发送状态向量，暂停从 `reconnectMinMs` 开始翻倍直至 `reconnectMaxMs`（日志行 `board.sync.resync`），由发送方补齐文档缺少的部分，而不是让缺口持续到下一次重连。干净的应用会结束仅为这类缺口安排的重新同步，失败的应用保留其重新同步，新通道则以完整的向量交换取代任何重新同步。

### 外来聊天记录

一个 Ketos 把另一个 Ketos 的聊天窗口显示为卡片，其用户可以请求该窗口的最新消息。提问的 Ketos 在自己的看板文档中找到窗口记录，把 `chat.transcript.request` 连同 `{ windowId }` 发给 `selfId` 等于记录 `hostId` 的在线对端（`POST /api/ketos.peer.transcript`）。它只接受由另一个 Ketos 托管、`kind: 'agent'` 的窗口。除超时之外的任何请求失败（例如通道已关闭或所有者抛出错误）都返回 `ketos/peer-offline`；所有者在 `transcriptTimeoutMs` 内未应答的请求返回 `ketos/peer-timeout`。应答按下述导线形式检查；畸形的应答视为所有者不可用，其中任何一条消息畸形都会使整个应答被拒绝。

只有所属 Ketos 在 `src/transcript.ts` 中做决定。它从看板文档读取自己的窗口记录，除非记录的 `hostId` 等于本地 `selfId`、`kind` 为 `agent` 且带有 `sessionId`，否则应答 `{ ok: false, reason: 'not-found' }`。请求方是帧到达的那条通道背后的已知对端，其身份是该对端在 `hello` 中声明的 `selfId`；请求体只指明窗口，别无其他，出现任何其他字段即为畸形，应答 `not-found`。访问遵循记录：`all` 接纳每个已知对端，`owner` 接纳 `selfId` 等于记录 `ownerId` 的对端，`selected` 接纳记录的 `ownerId` 以及 `selfId` 出现在 `access.people` 中的对端（客户端不会把所有者写入该列表）；其余情况应答 `{ ok: false, reason: 'closed' }`。每次请求都会重新读取记录，因此关闭窗口会立即停止应答。

`src/transcript-read.ts` 通过 `ctx.sessionPersistence` 以读取句柄读取会话，先刷新处于活动状态的会话，并以每 500 个事件为一片。分片只限制本包保留的记录文本，不限制后端内存：JSONL 后端每次读取都会解码整个日志，仅在文件修订号不变时才复用结果，每次请求都会刷新活动会话，并且不对已配对对端的并发请求限流。尚无已存储日志的会话（例如新窗口）应答 `{ ok: true, messages: [] }`。只有 `source.kind` 为 `user` 的 `user/message` 事件和 `assistant/message` 事件有贡献，且仅限追加到会话表面的事件（压缩写入的替换副本被跳过），只取其 `text` 块并以空行连接；推理、工具调用与结果、图片、文件、其他生产者注入的上下文，以及系统或开发者消息都不会离开所属 Ketos。应答最多包含 `transcriptMaxMessages` 条最新消息，每条文本按 `transcriptMaxMessageChars` 个码元截断且不拆分代理对，并且丢弃最旧的消息，直到 `{ ok: true, messages }` 的 JSON 不超过 `transcriptMaxBytes`；截断后文本为空的消息被跳过。加载时对 `transcriptMaxBytes` 的检查（6 字节是单个 UTF-16 码元最宽的 JSON 转义，256 字节涵盖包装、角色与时间）保证最长的消息放得下，因此过大的最新消息不会清空记录。在查找与刷新之间离开活动存储的会话按冷会话读取。会话服务未挂载、已有日志读取失败或看板读取失败时，应答 `{ ok: false, reason: 'unavailable' }`，不含错误中的任何文字；主机日志保留一行，记录窗口 id 与错误。可选的会话服务在每次请求时用 `ctx.get` 解析，因此随附的 web 配置在没有它们时也能加载该行。

### 重连

重连由拨号方负责：链路关闭后，它以从 `reconnectMinMs` 到 `reconnectMaxMs` 的暂停重试保存的 ticket，暂停按 ±20% 抖动翻倍且绝不超过 `reconnectMaxMs`；对等状态在两次尝试之间显示 `lost`，在一次尝试期间显示 `connecting`。存活时间短于 `reconnectMaxMs` 的通道视为一次失败的尝试：下一次暂停从上一次重拨的暂停翻倍（日志行 `peer.flapping`），成功的握手不会重置它，因此不断关闭通道的交换（例如超过大小上限的更新）会越来越慢，而不是每隔 `reconnectMinMs` 重拨一次。只有存活至少 `reconnectMaxMs` 的通道才会从 `reconnectMinMs` 重新开始。重连成功会再次发出 `ketos-peer/connected`，看板同步用它来追赶；插件卸载会取消所有待处理的尝试。

`forget(peerId)` 取消该节点的重拨（包括进行中的一次），并重写不含它的 `peers.json`；在调用之前开始的该节点入站握手会被关闭（`forgotten`），而不会让该节点重新出现。文件无法写入时，该节点仍被记住，重拨继续。被遗忘的节点只有通过新的邀请才会再次被接纳。

### 按需加载与原生禁令

失败的启动会保留它已创建的传输，因此下一次路由调用触发的重试绑定的是同一个节点，而不是每次尝试都留下一个已绑定的 iroh 节点。启动的每个 `await` 之后都有关闭检查，`close()` 会等待进行中的启动结束后再关闭传输；`close()` 之后的链路接入被拒绝。iroh 传输的 `bind()` 会关闭在 `close()` 之后才完成绑定的端点。

`src/iroh-transport.ts` 是唯一动态导入 `@number0/iroh` 的模块；其上的一切——分帧、握手、邀请、参与者、重连——都通过内存传输测试。锁定的 iroh-js `1.1.0` 会在任何 `watch*` 调用时中止 Node 进程，且原生 `stopped` 读取永不解决，因此 `tests/native-surface.spec.ts` 扫描源码禁止两者；地址变化改为通过中继 `online()` 等待和连接的 `closed()` 承诺来观察。

### 源文件地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`name`/`inject`/`Config`/`apply`，以及已知节点存在时的立即启动 |
| [`src/types.ts`](src/types.ts) | 品牌化的 `KetosPeerId`、对等状态与错误码；浏览器代码仅以类型方式导入 |
| [`src/transport.ts`](src/transport.ts) | 传输接缝：流、连接、绑定/拨号/接受 |
| [`src/iroh-transport.ts`](src/iroh-transport.ts) | 唯一的 `@number0/iroh` 消费者：构建器、端点、流、关闭码 |
| [`src/memory-transport.ts`](src/memory-transport.ts) | 测试与协议规范驱动的进程内传输对 |
| [`src/key-file.ts`](src/key-file.ts) | 仅属主密钥的加载或生成，以及 32 字节规则 |
| [`src/peers-file.ts`](src/peers-file.ts) | 已知节点文件：原子写入与边界校验 |
| [`src/invite.ts`](src/invite.ts) | 邀请码的格式化、解析与 base32 密钥 |
| [`src/frame.ts`](src/frame.ts) | 帧头、类型码表、信封与 `hello` 校验 |
| [`src/link.ts`](src/link.ts) | 单条连接的写队列、读取循环、请求关联、关闭处理与关闭码 |
| [`src/color.ts`](src/color.ts) | 调色板规则：首个空闲、下一个空闲、有效性 |
| [`src/service.ts`](src/service.ts) | `ctx.ketosPeer` 服务、事件、已知节点、参与者与重连 |
| [`src/board-sync.ts`](src/board-sync.ts) | 通道上的看板文档调度：状态向量、更新、超限边界与重新同步 |
| [`src/transcript.ts`](src/transcript.ts) | `chat.transcript.*` 帧类型、带访问决定的所有者侧处理器，以及双方共用的导线校验 |
| [`src/transcript-read.ts`](src/transcript-read.ts) | 从已存储会话读取最新消息及其三项限制 |
| [`src/routes.ts`](src/routes.ts) | 五个 Fetch 路由及其错误码 |
| — | 不发布运行时不变量伴随包：状态、已知节点与分帧关系由使用内存传输的包规范覆盖，没有独立可观察的进程内关系可供发布。 |

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [`packages/ketos/README.md`](../README.zh.md) —— Ketos 包组。
- [`@ketos/board-doc`](../board-doc/README.zh.md) —— 本包写入的参与者映射，以及阶段 33 通过通道同步的文档。
- [`docker/relay/README.md`](../../../docker/relay/README.zh.md) —— 部署运行的私有 iroh 中继与 Syncthing 中继。
- [`docker/stand/README.md`](../../../docker/stand/README.zh.md) —— 启用本行的双计算机演示环境。

<a id="model-experience"></a>
## 模型体验

无：对等通道是传输状态——对等身份、邀请码、帧体、参与者颜色与外来聊天窗口的记录文本只到达浏览器和其他宿主包，绝不进入模型请求、提示词段落、工具 schema 或会话事件。建立在通道之上的包拥有变为模型可见的一切。

#### KV Cache effect

无影响；本包改变的是视图与传输状态，而非模型上下文。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 随附的 web 配置关闭该行：没有 `KETOS_PARTICIPANT_NAME` 与 `KETOS_RELAY_URLS`，节点便没有身份或传输，看板的参与者菜单显示“未配置”提示。
- 范围只覆盖两个 Ketos 实例；调色板规则与已知节点列表可以容纳更多，但没有阶段演练第三个节点。
- 同一时间只挂起一个邀请密钥，且仅存内存：邀请方 Ketos 重启会使未使用的邀请码失效。
- 接收方不存储 ticket，因此非对称重连依赖拨号方的重试；双方都重启后，原先拨号的一侧凭保存的 ticket 重连。
- 已知对端的任何帧都被接受；唯一按人的规则是聊天记录的访问，它依据对端在 `hello` 中声明的 `selfId` 决定。通道不认证这一声明，已配对节点也可以更改它，因此已知对端可以冒称另一位参与者的 id，记录路由也会接受任何声称拥有所有者 `selfId` 的在线对端的应答；演示之前，该通道信任其对端。
- 记录决定所读取的窗口记录属于同步的看板文档，而该文档信任另一个 Ketos 的写入（`applyRemote` 不强制单一写入者），因此恶意的已配对 Ketos 可以改写另一个 Ketos 的窗口访问设置或 `sessionId` 并读取其记录。身份与记录归属的加固推迟到演示之后。
- 记录只包含聊天最新的 `transcriptMaxMessages` 条文本消息。工具调用与结果、附件和推理一律不包含，超过 `transcriptMaxMessageChars` 的消息被截断且没有标记。
- 所有者每次记录请求都从第一个事件起读取会话日志、不做缓存、每次刷新活动会话且不限流，因此对很长会话的请求每次都要付出遍历日志的代价；JSONL 后端自身的复用仅在文件修订号不变时有效。
- `transcriptMaxBytes` 大于接收方 Ketos 的 `maxFrameBytes` 时，应答到达时接收方拒绝该帧并关闭链路；加载时只检查所有者自己的 `maxFrameBytes`。
- 没有记录处理器的对端构建会让请求保持无应答直到 `transcriptTimeoutMs`，提问方将其报告为 `ketos/peer-timeout`；协议版本没有变化。
- `@number0/iroh` 不提供 `darwin-x64` 构建，因此 Intel Mac 上的 Ketos 只能借助 Docker 演示环境使用对等通道。
- `watch*` 禁令是 iroh-js `1.1.0` 的权宜之计；当锁定版本升级到崩溃修复之后，禁令随之解除并同步更新门禁。
- 超过 `maxSyncUpdateBytes` 的同步更新不会发送：通道关闭、对端以越来越长的暂停重拨并重复交换。该上限远高于正常看板（阶段 30 已对笔迹取整），只有病态文档才会触及。
- 同步接受已连接的已知对端发来的一切更新；按人授权在演示之后，因此未断开的通道即被信任。
- 阶段 32 的构建使用协议版本 1，阶段 33 的构建使用版本 2（二进制看板帧、新的 ALPN）；二者无法互相连接，也没有回退，因此一对 Ketos 必须运行同一构建。

<a id="dev-note"></a>
### 开发备注

运行包套件：

```sh
pnpm exec vitest run packages/ketos/peer --coverage --coverage.include='packages/ketos/peer/src/**/*.ts'
```

协议规范在内存传输上运行；只有传输套件与 Loader 组装套件加载原生模块。用 `cat $DSH_HOME/peers.json` 与 `stat -f '%Sp' $DSH_HOME/peer.key` 查看节点的持久状态。
