---
description: "Ketos 对等通道宿主包：带存储密钥的 iroh 节点、ctx.ketosPeer 背后的分帧消息通道、一次性邀请码与已知节点文件、每个 Ketos 发布的参与者记录、外来聊天窗口的只读记录、把两个 Ketos 的 Syncthing 设备链接到同一共享文件夹的可选功能，以及 /api/ketos.peer.* Fetch 路由。"
kind: "package-reference"
---

# @ketos/peer

[English](README.md) | 中文

## 概述

`@ketos/peer` 拥有让不同计算机上的两个 Ketos 作为一个团队协同工作的通道。它绑定一个 iroh 节点，密钥存储在 `$DSH_HOME/peer.key`；在每条连接的一个双向流上承载分帧消息通道（`[u32 BE 长度][u8 类型码][数据]`）；通过一次性的 `ketos1.…` 邀请码接纳第二个 Ketos；把已接纳的节点记入 `$DSH_HOME/peers.json`，此后连接不再需要邀请码；把每一侧的参与者记录发布到看板文档；并提供对方 Ketos 聊天窗口的只读记录，并可选地经通道链接一个共享 Syncthing 文件夹。其他 Ketos 包通过 `ctx.ketosPeer` 服务访问它；浏览器通过 `/api/ketos.peer.*` 访问它。

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
| `heartbeatIntervalMs` | `3000` | 每条通道上两次 `peer.ping` 帧之间的间隔（500–30000）。 |
| `heartbeatTimeoutMs` | `9000` | 通道在未完成任何读取（帧头或 16 KiB 帧体分片）的情况下最长可持续的时间，超过后以原因 `heartbeat-timeout` 关闭，对端显示为 `lost`，并开始重拨（1000–60000）；至少为 `heartbeatIntervalMs` 的两倍，插件在加载时检查。 |
| `bindAddr` | 无 | 本地绑定地址；缺省时在所有接口上绑定临时端口。 |
| `transcriptMaxMessages` | `20` | 本 Ketos 为其托管的聊天窗口返回的最多消息数；保留最新的（1–200）。 |
| `transcriptMaxMessageChars` | `4000` | 单条返回消息文本的最多 UTF-16 码元数（1–100000）。`transcriptMaxBytes` 必须至少为该值 × 6 + 256。 |
| `transcriptMaxBytes` | `65536` | 一次记录应答的最大字节数；最旧的消息先被丢弃（1024–1048576）。它必须至少为 `transcriptMaxMessageChars` × 6 + 256，连同为请求信封预留的 1024 字节，还必须容纳于 `maxFrameBytes`；插件在加载时检查这两点。 |
| `transcriptTimeoutMs` | `5000` | 本 Ketos 等待另一个 Ketos 应答记录请求的时长（500–60000）。 |
| `syncthing` | 无 | 共享 Syncthing 文件夹，见下文；缺省时该功能关闭。 |

演示环境的配置行加入类似下面的 `syncthing` 段；其 `relayAddress` 是去掉 `token` 参数后的 `KETOS_SYNCTHING_RELAY`：

```yaml
    syncthing:
      url: http://127.0.0.1:8384
      apiKeyEnv: STGUIAPIKEY
      relayAddress: relay://203.0.113.7:22067/?id=<relay device id>
      folderId: ketos-shared
      folderPath: /workspace/shared
      fsWatcherDelayS: 1
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `syncthing.url` | 必填 | 本地 Syncthing REST API 的基础 URL；由于 API 密钥在请求头中传输，`http://` 只允许用于回环主机，且不得带用户名、密码、查询或片段。 |
| `syncthing.apiKeyEnv` | 必填 | 保存 Syncthing API 密钥的环境变量，即一个凭据引用：组装中有凭据服务时经由它读取，没有该服务或它没有值时从启动环境读取；每个 Syncthing 请求之前都重新读取密钥。启动时未设置则只有 Syncthing 功能关闭，并记录一行 `syncthing.disabled` 日志；通道与看板同步继续工作。 |
| `syncthing.relayAddress` | 必填 | 私有 Syncthing 中继，形如 `relay://host:port/?id=<relay device id>`，不带 `token` 参数；每个对端设备只经由它拨号。 |
| `syncthing.folderId` | 必填 | 共享文件夹的 id：1–64 个字母、数字、`.`、`_` 或 `-`，以字母或数字开头。 |
| `syncthing.folderPath` | 必填 | 共享文件夹在 Syncthing 主机上的绝对目录。 |
| `syncthing.fsWatcherDelayS` | `10` | Syncthing 文件监视器在扫描前收集变更的秒数（1–3600）。 |
| `syncthing.statusRefreshMs` | `2000` | 共享文件夹状态的轮询间隔（250–60000）。 |
| `syncthing.requestTimeoutMs` | `5000` | 单个 Syncthing 请求的时限，包括读取应答（100–60000）。 |
| `syncthing.retryMs` | `2000` | Syncthing 没有应答、超时或以服务器错误应答后，链接步骤重试前的暂停（100–600000）。 |
| `syncthing.kickAfterLostMs` | `90000` | 通道丢失至少这么久之后，下一次连接才重启 Syncthing 到对端设备的连接（10000–600000）。较短的中断不触动 Syncthing 的中继连接：它能经受住这些中断，而每次重启都会用掉 Syncthing 对每个设备仅有的几次立即重拨之一。 |

该段的取值无效时（包括空的 `relayAddress` 或携带 `token` 的 `relayAddress`），插件在加载时被拒绝；错误只指出字段与规则，绝不包含取值，因此中继 token 或 URL 中的密码不会进入日志。

服务是其他 Ketos 包使用的宿主侧接缝：

| 成员 | 结果 |
|---|---|
| `peers(): PeerState[]` | 每个已知节点及其 `peerId`、`selfId`、`name`、`color` 和 `link: 'online' \| 'connecting' \| 'lost'` |
| `send(peerId, type, payload)` | 向已连接节点发送一帧；通道未打开时拒绝 |
| `request(peerId, type, payload, { timeoutMs })` | 发送一个请求信封；应答时兑现，超时（`PeerRequestTimeoutError`）、通道关闭或远端错误时拒绝 |
| `handle(type, handler): () => void` | 注册处理器；同一类型的每个处理器都会运行，第一个的返回值作为请求应答。消费者通过 `ctx.effect` 负责取消订阅 |
| `invite(): Promise<string>` | 中继地址就绪后生成一个 `ketos1.<ticket>.<secret>` 码；此前未使用的密钥会被替换 |
| `connect(code): Promise<{ peerId }>` | 拨打代码中的 ticket，完成握手并记录该节点 |
| `state(): Promise<PeerStateResponse>` | 本地记录、所有节点、`refreshMs`，以及 Syncthing 功能报告状态时的 `sharedFolder` |
| `nodeId(): Promise<KetosPeerId>` | 由存储密钥导出的本地 iroh 身份 |
| `startIfKnownPeers(): Promise<void>` | 仅当 `peers.json` 记有节点时启动节点 |
| `forget(peerId): Promise<void>` | 把没有打开通道的已知节点从 `peers.json` 和节点列表中移除，取消其重拨，然后发出 `ketos-peer/forgotten`；未知节点被拒绝（`ketos/peer-unknown`），通道在线的节点也被拒绝（`ketos/peer-online`） |
| `close(): Promise<void>` | 等待进行中的启动结束，然后关闭节点、其通道及所有重连尝试 |
| `closeSyncTooLarge(peerId)` | 因发出的同步更新超过上限而关闭一条通道；对方仍被记住并可重拨 |

浏览器轮询一个路由，通过三个路由写入，并通过一个路由读取外来记录：

| 路由 | 方法 | 请求体 | 应答 |
|---|---|---|---|
| `/api/ketos.peer.state` | `GET` | — | `{ self, peers, refreshMs, sharedFolder? }`；`sharedFolder` 为 `unavailable`、`waiting`、`syncing`、`synced` 或 `error`，Syncthing 功能关闭时不出现 |
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

首次启动读取 `keyPath`；文件缺失时用 `SecretKey.generate()` 生成一次，并以独占创建标志写入 `0700` 目录中的 `0600` 文件；长度不是 32 字节的文件拒绝加载，而不是悄悄铸造新身份。端点用 `presetMinimal`、对等 ALPN `ketos/peer/3`、`RelayMode.customFromUrls(relayUrls)` 和存储的密钥构建，因此节点的 `EndpointId` 跨重启稳定。团队中继是节点所知的唯一中继：连接先经由它建立，iroh 在建立直连路径后再切换到直连。ALPN 携带 `PEER_PROTOCOL_VERSION`，因此协议版本不同的构建在任何帧出现之前就会在传输握手中失败。

### 帧

一条连接承载一个双向 QUIC 流；每条消息为 `[u32 BE 长度][u8 类型码][帧体]`。类型码表保留 `1 hello`、`2 bye`、`3 board.sv`、`4 board.update`、`5 chat.transcript.request`、`6 chat.transcript.response`、`7 syncthing.device`、`8 peer.ping` 和 `9 peer.pong`；消费者通过声明合并把各自的载荷并入 `PeerFrameTypeMap` 并注册处理器，没有处理器的保留帧只记一行日志后被忽略。链路自身消费 `hello`、`bye`、`peer.ping` 与 `peer.pong`，任何处理器都收不到它们。记录应答以响应信封的形式走类型码 `5`，因此类型码 `6` 不承载任何帧。类型码 `3` 和 `4` 携带原始的、非空的 `Uint8Array` 帧体（Yjs 更新经 JSON 会膨胀且无法还原）；其余帧体为 JSON，请求/响应信封只存在于 JSON 类型码上。`send` 在入队前先编码并测量帧，因此词表拒绝的载荷和超过 `maxFrameBytes` 的帧体在发送方失败，而不会破坏接收方。二进制类型码的帧体若是 JSON 对象或数组也会被拒绝：版本 1 把这些帧编码为 JSON，接收方拒绝它们，而不是交给 Yjs。畸形帧体、未知类型码或被截断的帧会以 `2n` 关闭连接；处理器抛出的异常只记日志且通道继续存活，因为单个消费者的失败不应以连接为代价。

请求与应答共用同一帧类型：请求体为 `{ requestId, request }`，应答为 `{ requestId, response }` 或 `{ requestId, error }`。提问方拥有 `requestId` 及其超时；无人应答的请求在提问方超时。

### 握手与已知节点

拨号方打开流并先写 `hello`——接收方的 `acceptBi` 只在这些首批字节之后才解决。`hello` 为 `{ v: 3, selfId, name, color, invite? }`，在导线边界校验（版本、边界、调色板颜色、无未知字段）。连接的第一帧在两个方向上都受 `PEER_HELLO_MAX_BYTES`（4096 字节）约束，远小于 `maxFrameBytes`，因此陌生节点无法让本节点缓冲大帧体。当节点已在 `peers.json` 中，或 `hello` 携带其待处理邀请的一次性密钥时，接收方接纳该连接；没有有效密钥的未知节点被以 `1n` 关闭，并记录一行不含数据的 `peer.refused` 日志。随后双方互相记录：拨号方存储对等方的 ticket，接收方存储不带 ticket 的记录并等待对等方的重拨。

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

### 共享 Syncthing 文件夹

存在 `syncthing` 段时，`src/syncthing.ts` 启动该功能。它读取 `apiKeyEnv` 指定的 API 密钥；启动时没有密钥则功能保持关闭，只记录一行 `syncthing.disabled`，不发送任何 Syncthing 请求，对等状态中也不出现 `sharedFolder`。否则它创建 `src/syncthing-client.ts` 的客户端：按凭据服务的要求，每个请求都重新读取密钥，因此变更后的密钥在下一个请求生效；请求在 `X-API-Key` 中携带密钥，在 `requestTimeoutMs` 后或插件卸载时结束，并校验本包读取的字段，同时接受 Syncthing 应答中的任何其他字段。失败表现为 `SyncthingError`，它指出方法、路径、HTTP 状态（没有应答或未发送请求时为 `0`）以及失败类别 —— `no-answer`、`refused`、`invalid` 或 `no-key` —— 绝不包含密钥或应答体；只有 `no-answer` 和服务器错误（5xx）的 `refused` 是暂时性的。

`src/syncthing-link.ts` 中的链接使用帧 `7 syncthing.device`，其 JSON 帧体恰为 `{ deviceId }`。id 必须是规范形式（`src/syncthing-device-id.ts`）：八组以短横线分隔、每组七个 `A–Z2–7` 字符，其中第 14、28、42、56 个字符是基于 base32 字母表的 Luhn mod 32 校验字符，最后一个数据字符（第 55 个）为 `A` 或 `Q`，因为它的低四位是填充位。Syncthing 自身接受的小写形式、经修正的数字 `0`、`1`、`8`、52 字符形式以及被置位的填充位都被拒绝；无效的帧或本 Syncthing 自己的 id 被丢弃，并记录一行 `syncthing.device-invalid`。每次 `ketos-peer/connected` 时，双方各自读取自己的 `myID` 并发送出去。收到的 id 在同一队列中应用：先写设备 `ketos:<peer id>`，其 `addresses: [relayAddress]`、`autoAcceptFolders: false`、`paused: false`，并使用完整的 PUT 请求体，因为 Syncthing 会把 PUT 省略的字段重置为默认值；再处理文件夹：缺失时以完整请求体创建（`type: 'sendreceive'`、开启监视器并使用 `fsWatcherDelayS`、包含对端设备），已存在时以合并后的设备列表打补丁。设备按名称、地址与是否接受文件夹比较，文件夹设备列表按不含本机设备的集合比较，因此配置一致时不写入任何内容：每次重连时的交换都是幂等的重新检查，容器重启后 Syncthing 卷上的自身配置保持链接。对端 Syncthing 卷被清空后遗留的、名为 `ketos:<peer id>` 但 id 不同的设备会离开文件夹与配置（`syncthing.device-replaced`），因此设备列表不会增长；第二位参与者加入文件夹时不会挤掉第一位。Syncthing 没有应答、超时或以服务器错误应答期间，以及出现任何不是 `SyncthingError` 的失败（例如通道未能发出的帧）之后，发送与应用每隔 `retryMs` 重试，每个步骤只记录一行 `syncthing.retry`。其他任何 `SyncthingError`，例如被拒绝的密钥（401、403）、畸形应答或不再设置的密钥，都会以一行 `syncthing.link-stopped` 停止该步骤，直到通道再次连接。对端断开或插件卸载会停止两个步骤，同一对端发来的较新 id 会取代尚未应用的旧 id；在队列中等待的应用轮到自己时检查这一点，然后不写入任何内容。写入了内容的链接记录 `syncthing.linked`。通道在再次连接之前已丢失至少 `kickAfterLostMs` 时，该连接的第一次应用若发现对端设备已以同一 id 配置，则随后重启 Syncthing 到该设备的连接：先 `POST /rest/system/pause?device=<id>`，再 `POST /rest/system/resume?device=<id>`（暂停失败时也会恢复），并记录为 `syncthing.reconnected`。这样的中断之后中继会话已不存在，但 Syncthing 可能把已失效的连接在一分钟以上的时间里仍计为已连接；暂停会关闭它，恢复会立即重新拨号该设备。丢失时长按墙上时钟从 `ketos-peer/disconnected` 量到下一次 `ketos-peer/connected`。较短的中断、首次连接以及之前没有丢失的连接都不重启，因为 Syncthing 的连接能经受住短暂中断，而 Syncthing 在 2 分钟内最多强制重拨一个设备三次，之后暂停 5 分钟。首次链接和被替换的设备同样不重启连接，因为 Syncthing 会自行拨号新设备；对端在同一通道上再次发来的帧也不触发重启。Syncthing 把暂停存入其配置，因此暂停或恢复失败会使应用步骤失败，重试时会再次重启。每次应用还会在 Syncthing 报告对端设备已暂停、而其余配置一致时，以一次 `POST /rest/system/resume?device=<id>` 恢复它（`syncthing.device-resumed`），不做重启，因为恢复会立即拨号该设备；因此因恢复失败或因 Ketos 停止而中断的重启所留下的暂停设备，会在下一次连接时被恢复，而未暂停的设备不产生任何请求。对端被遗忘时（`ketos-peer/forgotten`），除本机设备外每个名为 `ketos:<peer id>` 的设备先离开文件夹、再离开配置，使用同一队列和同样的重试，并由 `syncthing.unlinked` 报告数量；被拒绝的移除以一行 `syncthing.link-stopped` 停止并保留该设备的配置，同一对端在新邀请之后再次发来的设备 id 会终止尚未执行的移除。功能关闭时，遗忘对端不发送任何 Syncthing 请求。

`src/syncthing-state.ts` 每隔 `statusRefreshMs` 轮询 Syncthing 并保存结果，因此状态路由从内存读取 `sharedFolder`；第一次轮询完成之前它为 `waiting`。Syncthing 应答后的第一次轮询（功能启动时，以及 Syncthing 停止应答后再次应答时）以只读方式把 `/rest/config/options` 与 `docker/stand/syncthing-bootstrap.mjs` 写入的设置比较：全局与本地广播、NAT 穿透关闭，中继开启，监听地址中包含私有中继（作为去掉 `token` 的 URL 比较，查询参数解码后不计顺序），并且没有会加入公共中继池的 `default` 或 `dynamic+` 监听地址。Syncthing 不应答时状态为 `unavailable`；拒绝请求或应答畸形 JSON、API 密钥不再设置、设置不一致（`syncthing.settings-diverge` 列出设置名，绝不包含地址）或文件夹报告 `error` 时为 `error`；文件夹缺失或未运行、文件夹的设备都未连接、文件夹状态为 `unknown` 或其他既非 `idle`、非 `error`、也非扫描或传输类的状态且无待同步项、文件夹的已连接设备都没有有效的 `ketos:<peer id>` 名称、到任何已连接设备所属对端的 Ketos 通道都不在线（无论文件夹在同步还是空闲），或通道在线的对端中没有一个的 Syncthing 回共享该文件夹时为 `waiting`；文件夹在扫描、等待、准备、传输、清理或启动，或仍有待同步项或待删除项，且到某个已连接设备所属对端的 Ketos 通道在线时为 `syncing`，文件夹空闲但每个通道在线且其 Syncthing 回共享该文件夹的对端仍有待同步项或待删除项时也为 `syncing`；文件夹为 `idle`、无待同步项，且有一个已连接的文件夹设备带有某个对端的名称 `ketos:<peer id>`、到该对端的 Ketos 通道为 `online`、该对端的 Syncthing 回共享该文件夹且没有待同步项时为 `synced`。对每个这样的设备，`/rest/db/completion?folder=<id>&device=<device id>` 给出本 Syncthing 对该对端的视图：对端的集群配置共享并运行该文件夹后 `remoteState` 为 `valid`，`needItems` 加 `needDeletes` 按对端发来的索引统计它仍需要的内容。Syncthing 发现连接丢失远晚于通道心跳，因此每次调用状态路由都从服务的链路状态读取通道条件，通道一旦丢失，`syncing` 和 `synced` 立即变为 `waiting`，无需任何 Syncthing 请求；`unavailable` 与 `error` 不取决于通道。只有报告的状况发生变化时才记录日志；`syncing` 与 `synced` 之间的来回切换不记录。

### 心跳

iroh-js `1.1.0` 不提供空闲超时或保活设置，因此若无其他手段，断开的路径只能在约 30 秒后由 QUIC 的空闲超时发现。为此，每条链路从启动到关闭都运行心跳：无论还发送什么，它每隔 `heartbeatIntervalMs` 发送一次 `peer.ping`，并对收到的每个 `peer.ping` 回复 `peer.pong`；两者的帧体恰为 `{}`，若帧头为这两个类型码声明超过 16 字节的帧体，连接在读取帧体之前就以 `2n` 关闭。每次完成的读取都会重新开始 `heartbeatTimeoutMs` 倒计时：帧头，以及帧体的每个最多 16 KiB 的分片。因此看板流量能保持通道开启，大更新只要每个 16 KiB 分片都在超时之内到达也能保持通道开启，在默认值下这需要约 14.6 kbit/s；未读完的分片中的字节不计入。倒计时到期时，链路在一个事件循环轮次之后再做决定，此时 Node 已交付事件循环阻塞期间到达的字节：该轮次内完成的读取会重新开始倒计时；否则链路记录一行 `peer.heartbeat-timeout <peer>`，并以关闭码 `6n` 和原因 `heartbeat-timeout` 关闭。对端变为 `lost`，`ketos-peer/disconnected` 触发，拨号方像在其他任何断开之后一样重拨。由于每个 ping 都会得到应答，每一方的检测只取决于它自己的两个值：使用默认值时，看板最迟在最后一次完成的读取之后的 `heartbeatTimeoutMs` 加一次 `stateRefreshMs` 轮询内把对端显示为未连接。链路的两个计时器随链路结束；在 `start()` 之前已关闭的链路不会启动任何计时器。

### 重连

重连由拨号方负责：链路关闭后，它以从 `reconnectMinMs` 到 `reconnectMaxMs` 的暂停重试保存的 ticket，暂停按 ±20% 抖动翻倍且绝不超过 `reconnectMaxMs`；对等状态在两次尝试之间显示 `lost`，在一次尝试期间显示 `connecting`。存活时间短于 `reconnectMaxMs` 的通道视为一次失败的尝试：下一次暂停从上一次重拨的暂停翻倍（日志行 `peer.flapping`），成功的握手不会重置它，因此不断关闭通道的交换（例如超过大小上限的更新）会越来越慢，而不是每隔 `reconnectMinMs` 重拨一次。只有存活至少 `reconnectMaxMs` 的通道才会从 `reconnectMinMs` 重新开始。重连成功会再次发出 `ketos-peer/connected`，看板同步用它来追赶；插件卸载会取消所有待处理的尝试。拨号的 `connectTimeoutMs` 上限不会取消传输层的拨号，因此在上限放弃之后才完成的连接会立即以关闭码 `0n` 和原因 `dial timed out` 关闭，而不是等待另一方的握手超时。

`forget(peerId)` 取消该节点的重拨（包括进行中的一次），并重写不含它的 `peers.json`；在调用之前开始的该节点入站握手会被关闭（`forgotten`），而不会让该节点重新出现。文件写入后 `ketos-peer/forgotten` 触发，Syncthing 功能随之移除该节点的设备。文件无法写入时，该节点仍被记住，重拨继续，也不触发事件。被遗忘的节点只有通过新的邀请才会再次被接纳。

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
| [`src/frame.ts`](src/frame.ts) | 帧头、类型码表、按类型码的帧体上限、信封，以及 `hello` 与心跳的校验 |
| [`src/link.ts`](src/link.ts) | 单条连接的写队列、读取循环、请求关联、心跳、关闭处理与关闭码 |
| [`src/color.ts`](src/color.ts) | 调色板规则：首个空闲、下一个空闲、有效性 |
| [`src/service.ts`](src/service.ts) | `ctx.ketosPeer` 服务、事件、已知节点、参与者与重连 |
| [`src/board-sync.ts`](src/board-sync.ts) | 通道上的看板文档调度：状态向量、更新、超限边界与重新同步 |
| [`src/transcript.ts`](src/transcript.ts) | `chat.transcript.*` 帧类型、带访问决定的所有者侧处理器，以及双方共用的导线校验 |
| [`src/transcript-read.ts`](src/transcript-read.ts) | 从已存储会话读取最新消息及其三项限制 |
| [`src/syncthing.ts`](src/syncthing.ts) | Syncthing 功能：API 密钥查找、关闭状态，以及客户端、链接与状态的接线 |
| [`src/syncthing-config.ts`](src/syncthing-config.ts) | `syncthing` 段、其加载检查、中继地址比较与设置检查 |
| [`src/syncthing-client.ts`](src/syncthing-client.ts) | Syncthing REST 客户端与 `SyncthingError` |
| [`src/syncthing-device-id.ts`](src/syncthing-device-id.ts) | 规范设备 id 及其 Luhn mod 32 校验字符 |
| [`src/syncthing-link.ts`](src/syncthing-link.ts) | `syncthing.device` 帧、设备名称以及设备与文件夹的链接 |
| [`src/syncthing-state.ts`](src/syncthing-state.ts) | 共享文件夹状态轮询及其 Ketos 通道条件 |
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
- `@number0/iroh` 不提供 `darwin-x64` 构建，因此 Intel Mac 上的 Ketos 只能借助 Docker 演示环境使用对等通道。
- `watch*` 禁令是 iroh-js `1.1.0` 的权宜之计；当锁定版本升级到崩溃修复之后，禁令随之解除并同步更新门禁。
- 超过 `maxSyncUpdateBytes` 的同步更新不会发送：通道关闭、对端以越来越长的暂停重拨并重复交换。该上限远高于正常看板（阶段 30 已对笔迹取整），只有病态文档才会触及。
- 同步接受已连接的已知对端发来的一切更新；按人授权在演示之后，因此未断开的通道即被信任。
- 演示之前 Syncthing GUI 没有密码；演示环境只在 `127.0.0.1` 上发布它（[演示环境 README](../../../docker/stand/README.zh.md)）。
- 只有一个共享文件夹：该段只指定一个 `folderId`，每个已链接的对端设备都加入它。
- 已知对端的设备 id 按原样应用，因此已配对的 Ketos 可以把任意 Syncthing 设备加入共享文件夹；演示之前，这同样属于通道对其对端的信任。
- Syncthing 设置不一致会使状态变为 `error`，但不会停止链接：对端设备只经由私有中继拨号，而 Syncthing 自身的发现设置保持原样，直到运维人员修正。
- 对端的旧设备按名称 `ketos:<peer id>` 查找；在 Syncthing GUI 中改名的设备在对端 id 变化时不再被替换，在对端被遗忘时也不会被移除，共享文件夹状态也不再达到 `synced`。
- 所有卷都被清空后以新身份回来的 Ketos 是一个新的对端：其旧身份的设备留在共享文件夹中，直到遗忘那个旧对端。
- 丢失至少 `kickAfterLostMs` 的中断，由 Ketos 通道再次连接时重启 Syncthing 到对端设备的连接来处理。通道保持在线期间失效的 Syncthing 中继连接，或在更短的中断中失效的中继连接，在 Syncthing 自己发现丢失之前一直被计为已连接：Syncthing 最多每 90 秒发送一次协议 ping，并关闭 300 秒内什么也没收到的连接（该检查每 150 秒运行一次），除非中继或 TCP 连接更早失败。只有在关闭之后，Syncthing 才经中继重新拨号该设备，在演示环境中最多每分钟一次（`relayReconnectIntervalM=1`）；在此之前文件夹按 Syncthing 的视图显示 `syncing` 或 `synced`。
- 在 Syncthing GUI 中暂停的 `ketos:<peer id>` 设备会在该对端的下一次通道连接时被恢复，因此 GUI 无法让已链接的对端保持暂停；要停止同步，应遗忘该对端，这会移除其设备。
- `synced` 反映的是本 Syncthing 已收到的索引：连接刚建立、对端索引到达之前，没有内容要发送的一方可能会短暂显示 `synced`，尽管对端持有尚未通告的文件。
- 被 Syncthing 拒绝的链接步骤（例如 API 密钥错误）不会重试：密钥修正后，共享文件夹状态在下一次轮询时恢复，但设备要到通道下一次连接时才会链接。
- 阶段 32 的构建使用协议版本 1，阶段 33 与 34 的构建使用版本 2（二进制看板帧），阶段 35 的构建使用版本 3（心跳帧）；每个版本都有自己的 ALPN，不同版本的构建无法互相连接，也没有回退，因此一对 Ketos 要一起更新。
- 大帧只有在其帧体的每个 16 KiB 分片都于 `heartbeatTimeoutMs` 内到达时才能保持通道开启：在默认值下，若路径慢于约 14.6 kbit/s，通道会在传输过程中以 `heartbeat-timeout` 关闭，重拨后会重复这次交换。
- 心跳限定的是发现时间，而不是恢复时间：网络恢复后，拨号方的下一次拨号要等当前暂停结束（最长 `reconnectMaxMs`），进行中的拨号还可能先耗尽 `connectTimeoutMs`，因此使用默认值时，双方重新显示 `online` 最长可能需要约 10 + 20 秒再加上拨号本身的时间。

<a id="dev-note"></a>
### 开发备注

运行包套件：

```sh
pnpm exec vitest run packages/ketos/peer --coverage --coverage.include='packages/ketos/peer/src/**/*.ts'
```

协议规范在内存传输上运行；只有传输套件与 Loader 组装套件加载原生模块。用 `cat $DSH_HOME/peers.json` 与 `stat -f '%Sp' $DSH_HOME/peer.key` 查看节点的持久状态。
