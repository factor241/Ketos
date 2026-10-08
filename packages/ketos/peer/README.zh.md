---
description: "Ketos 对等通道宿主包：带存储密钥的 iroh 节点、ctx.ketosPeer 背后的分帧消息通道、一次性邀请码与已知节点文件、每个 Ketos 发布的参与者记录，以及 /api/ketos.peer.* Fetch 路由。"
kind: "package-reference"
---

# @ketos/peer

[English](README.md) | 中文

## 概述

`@ketos/peer` 拥有让不同计算机上的两个 Ketos 作为一个团队协同工作的通道。它绑定一个 iroh 节点，密钥存储在 `$DSH_HOME/peer.key`；在每条连接的一个双向流上承载分帧消息通道（`[u32 BE 长度][u8 类型码][数据]`）；通过一次性的 `ketos1.…` 邀请码接纳第二个 Ketos；把已接纳的节点记入 `$DSH_HOME/peers.json`，此后连接不再需要邀请码；并把每一侧的参与者记录发布到看板文档。其他 Ketos 包通过 `ctx.ketosPeer` 服务访问它；浏览器通过 `/api/ketos.peer.state`、`/api/ketos.peer.invite` 和 `/api/ketos.peer.connect` 访问它。

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
| `relayUrls` | 必填 | 团队私有 iroh 中继的 URL 列表；至少一个。绝不使用 n0 公共中继。 |
| `keyPath` | 必填 | 存储的 32 字节节点密钥；父目录以仅属主权限创建，文件为 `0600`。 |
| `peersPath` | 必填 | 已知节点文件；以原子方式写入，权限 `0600`。 |
| `maxFrameBytes` | `16777216` | 接受的最大帧体（1 KiB–64 MiB）。 |
| `onlineTimeoutMs` | `15000` | `invite()` 等待中继地址的时长（1000–120000）。 |
| `connectTimeoutMs` | `10000` | 拨号、流与握手的单步上限；也是请求的默认超时（1000–120000）。 |
| `reconnectMinMs` | `1000` | 首次重连暂停（100–60000）。 |
| `reconnectMaxMs` | `30000` | 重连暂停上限（100–600000）。 |
| `inviteTtlMs` | `3600000` | 一次性邀请密钥的有效期（60000–86400000）。 |
| `stateRefreshMs` | `1000` | 状态路由发布的轮询间隔（250–60000）。 |
| `bindAddr` | 无 | 本地绑定地址；缺省时在所有接口上绑定临时端口。 |

服务是其他 Ketos 包使用的宿主侧接缝：

| 成员 | 结果 |
|---|---|
| `peers(): PeerState[]` | 每个已知节点及其 `peerId`、`selfId`、`name`、`color` 和 `link: 'online' \| 'connecting' \| 'lost'` |
| `send(peerId, type, payload)` | 向已连接节点发送一帧；通道未打开时拒绝 |
| `request(peerId, type, payload, { timeoutMs })` | 发送一个请求信封；应答时兑现，超时或远端错误时拒绝 |
| `handle(type, handler): () => void` | 注册处理器；同一类型的每个处理器都会运行，第一个的返回值作为请求应答。消费者通过 `ctx.effect` 负责取消订阅 |
| `invite(): Promise<string>` | 中继地址就绪后生成一个 `ketos1.<ticket>.<secret>` 码；此前未使用的密钥会被替换 |
| `connect(code): Promise<{ peerId }>` | 拨打代码中的 ticket，完成握手并记录该节点 |
| `state(): Promise<PeerStateResponse>` | 本地记录、所有节点及 `refreshMs` |
| `nodeId(): Promise<KetosPeerId>` | 由存储密钥导出的本地 iroh 身份 |
| `startIfKnownPeers(): Promise<void>` | 仅当 `peers.json` 记有节点时启动节点 |
| `close(): Promise<void>` | 关闭节点、其通道及所有重连尝试 |

浏览器轮询一个路由，并通过两个路由写入：

| 路由 | 方法 | 请求体 | 应答 |
|---|---|---|---|
| `/api/ketos.peer.state` | `GET` | — | `{ self, peers, refreshMs }` |
| `/api/ketos.peer.invite` | `GET` | — | `{ invite }` |
| `/api/ketos.peer.connect` | `POST` | `{ invite }` | `{ peerId }` |

拒绝时返回 `{ ok: false, error }`，其值为 `ketos/invalid`（400）、`ketos/peer-self`（409）、`ketos/invite-used`（409）、`ketos/peer-unreachable`（504）或 `ketos/peer-offline`（503）；其他情况为空的 500。路由调用会启动节点，因此从不轮询它的进程永远不会绑定。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 节点与密钥

首次启动读取 `keyPath`；文件缺失时用 `SecretKey.generate()` 生成一次，并以独占创建标志写入 `0700` 目录中的 `0600` 文件；长度不是 32 字节的文件拒绝加载，而不是悄悄铸造新身份。端点用 `presetMinimal`、对等 ALPN `ketos/peer/1`、`RelayMode.customFromUrls(relayUrls)` 和存储的密钥构建，因此节点的 `EndpointId` 跨重启稳定，并且只能通过团队中继到达。

### 帧

一条连接承载一个双向 QUIC 流；每条消息为 `[u32 BE 长度][u8 类型码][JSON 体]`。类型码表保留 `1 hello`、`2 bye`、`3 board.sv`、`4 board.update`、`5 chat.transcript.request`、`6 chat.transcript.response` 和 `7 syncthing.device`；阶段 33–35 通过声明合并把各自的载荷并入 `PeerFrameTypeMap` 并注册处理器，没有处理器的保留帧只记一行日志后被忽略。超过 `maxFrameBytes` 的帧体、非 JSON 的帧体、未知类型码或被截断的帧会以 `2n` 关闭连接，且绝不会让异常越过读取循环。

请求与应答共用同一帧类型：请求体为 `{ requestId, request }`，应答为 `{ requestId, response }` 或 `{ requestId, error }`。提问方拥有 `requestId` 及其超时；无人应答的请求在提问方超时。

### 握手与已知节点

拨号方打开流并先写 `hello`——接收方的 `acceptBi` 只在这些首批字节之后才解决。`hello` 为 `{ v: 1, selfId, name, color, invite? }`，在导线边界校验（版本、边界、调色板颜色、无未知字段）。当节点已在 `peers.json` 中，或 `hello` 携带其待处理邀请的一次性密钥时，接收方接纳该连接；没有有效密钥的未知节点被以 `1n` 关闭，并记录一行不含数据的 `peer.refused` 日志。随后双方互相记录：拨号方存储对等方的 ticket，接收方存储不带 ticket 的记录并等待对等方的重拨。

### 邀请码

`invite()` 等待中继地址（`online()` 受 `onlineTimeoutMs` 约束），没有地址时拒绝生成 ticket，因此邀请码总是指向经中继可达的节点。邀请码为 `ketos1.<endpoint ticket>.<base32 密钥>`；密钥是 16 个随机字节，一次性使用，仅存内存，在 `inviteTtlMs` 内有效。因此仅有泄露的 ticket 无法让任何人加入。

### 参与者与颜色

启动时节点把自己的记录发布到看板文档（`putOwnParticipant`），颜色取文档参与者与已知节点颜色中的第一个空闲调色板编号，并在 `hello` 中发送该记录。当对等方报告相同颜色时，规则是确定性的：看板 `selfId` 较大（字符串比较）的参与者把自己的记录改写为下一个空闲颜色并宣告新的 `hello`；另一侧保持其记录不变。每个参与者只写以自己 `selfId` 为键的记录，因此两个 Ketos 实例绝不会互相覆盖名称或颜色。

### 重连

重连由拨号方负责：链路关闭后，它以从 `reconnectMinMs` 到 `reconnectMaxMs` 的暂停重试保存的 ticket，暂停按 ±20% 抖动翻倍；对等状态在两次尝试之间显示 `lost`，在一次尝试期间显示 `connecting`。重连成功会再次发出 `ketos-peer/connected`，阶段 33 用它来追赶；插件卸载会取消所有待处理的尝试。

### 按需加载与原生禁令

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
| [`src/link.ts`](src/link.ts) | 单条连接的写队列、读取循环、请求关联与关闭处理 |
| [`src/color.ts`](src/color.ts) | 调色板规则：首个空闲、下一个空闲、有效性 |
| [`src/service.ts`](src/service.ts) | `ctx.ketosPeer` 服务、事件、已知节点、参与者与重连 |
| [`src/routes.ts`](src/routes.ts) | 三个 Fetch 路由及其错误码 |
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

无：对等通道是传输状态——对等身份、邀请码、帧体与参与者颜色只到达浏览器和其他宿主包，绝不进入模型请求、提示词段落、工具 schema 或会话事件。阶段 33–35 拥有在其之上变为模型可见的一切。

#### KV Cache effect

无影响；本包改变的是视图与传输状态，而非模型上下文。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 随附的 web 配置关闭该行：没有 `KETOS_PARTICIPANT_NAME` 与 `KETOS_RELAY_URLS`，节点便没有身份或传输，看板的参与者菜单显示“未配置”提示。
- 范围只覆盖两个 Ketos 实例；调色板规则与已知节点列表可以容纳更多，但没有阶段演练第三个节点。
- 同一时间只挂起一个邀请密钥，且仅存内存：邀请方 Ketos 重启会使未使用的邀请码失效。
- 接收方不存储 ticket，因此非对称重连依赖拨号方的重试；双方都重启后，原先拨号的一侧凭保存的 ticket 重连。
- 没有按人权限：已知对等方的任何帧都被接受，这是在演示之前的有意选择。
- `@number0/iroh` 不提供 `darwin-x64` 构建，因此 Intel Mac 上的 Ketos 只能借助 Docker 演示环境使用对等通道。
- `watch*` 禁令是 iroh-js `1.1.0` 的权宜之计；当锁定版本升级到崩溃修复之后，禁令随之解除并同步更新门禁。

<a id="dev-note"></a>
### 开发备注

运行包套件：

```sh
pnpm exec vitest run packages/ketos/peer --coverage --coverage.include='packages/ketos/peer/src/**/*.ts'
```

协议规范在内存传输上运行；只有传输套件与 Loader 组装套件加载原生模块。用 `cat $DSH_HOME/peers.json` 与 `stat -f '%Sp' $DSH_HOME/peer.key` 查看节点的持久状态。
