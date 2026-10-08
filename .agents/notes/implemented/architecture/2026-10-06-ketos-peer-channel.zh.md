# Agent Note：Ketos 对等通道

Status: implemented

[English](2026-10-06-ketos-peer-channel.md) | 中文

## Problem

10 月 16 日的演示在不同网络的两台计算机上运行两个 Ketos 实例，并把它们呈现为同一个团队：它们必须通过团队自己掌控的基础设施互相发现、可靠地交换消息、把对方显示为真实参与者而不是客户端的演示名册，并在不重新邀请的情况下恢复断开的通道。阶段 33–35 在这条通道之上构建文档同步、他人聊天卡片与共享 Syncthing 文件夹，因此它的服务表面、帧类型码与事件名必须现在一次性设计好。

## Decision

**每个 Ketos 一个 iroh 节点，位于 `ctx.ketosPeer` 之后。** `@ketos/peer` 用存放在 `$DSH_HOME/peer.key` 的 32 字节密钥（仅属主可读，`EndpointId` 跨重启稳定）、对等 ALPN `ketos/peer/1` 以及面向团队私有中继的 `RelayMode.customFromUrls` 绑定 iroh 端点。绝不使用 n0 公共中继与发现；部署在 `docker/relay/` 中运行自己的 `iroh-relay`（通过 `<带连字符的-ip>.sslip.io` 使用 Let's Encrypt，备用 `nip.io` 或 `--dev`）。节点按需启动——首次路由调用时，或插件启动时 `peers.json` 已记有节点——因此从不组装演示环境的开发机永远不会加载原生模块。

**分帧与扩展属于通道，载荷属于消费者。** 一条连接承载一个双向 QUIC 流；每条消息为 `[u32 BE 长度][u8 类型码][JSON 体]`。类型码表保留 `1 hello`、`2 bye`、`3 board.sv`、`4 board.update`、`5 chat.transcript.request`、`6 chat.transcript.response` 与 `7 syncthing.device`；阶段 33–35 通过声明合并把各自的载荷并入 `PeerFrameTypeMap`，并用 `ctx.effect` 注册处理器。超过 `maxFrameBytes` 的帧、非 JSON 帧体、未知类型码或被截断的帧会以 `2n` 关闭连接，且不会让异常越过读取循环。请求与应答共用一个信封（`{ requestId, request }` / `{ requestId, response | error }`），超时由提问方负责。

**邀请码只接纳一个未知节点。** `invite()` 等待中继地址并生成 `ketos1.<endpoint ticket>.<base32 密钥>`；16 字节密钥一次性使用、仅存内存、在 `inviteTtlMs` 内有效。拨号方先写 `hello`（接收方的 `acceptBi` 只在这些字节之后才解决），携带自己的参与者记录，对未知节点还携带密钥。已存入 `peers.json` 的节点无需密钥即可接纳；密钥错误或缺失的未知节点会以 `1n` 关闭，并记录一行 `peer.refused` 日志。拨号方保存对等方的 ticket 并负责重连（暂停从 `reconnectMinMs` 到 `reconnectMaxMs`，按 ±20% 抖动翻倍）；接收方存储不带 ticket 的记录并等待重拨。

**参与者是文档记录，每个写入者只写自己的一条。** `@ketos/board-doc` 新增了以 `OwnerId` 为键的 `participants` `Y.Map`；`putOwnParticipant` 只写以自己 `selfId` 为键的记录，因此阶段 33 的同步不会让两个实例互相覆盖。颜色取文档参与者与已知节点中的第一个空闲调色板编号；发生冲突时，看板 `selfId` 较大（字符串比较）的参与者把自己的记录改写为下一个空闲颜色并宣告新的 `hello`，另一侧保持其记录不变。浏览器名册把文档记录与对等通道状态合并，因此两块看板在文档同步存在之前就显示两名真实参与者。

**profile 行默认关闭；由演示环境启用。** 随附的 `web` profile 让 `ketos-peer` 保持 `disabled: true`，只保留环境变量接缝（`KETOS_PARTICIPANT_NAME`、`KETOS_RELAY_URLS`），因为身份与中继只存在于演示环境；`docker/stand/stand.patch.yml` 用部署的值启用同一行。客户端只在看板表面已渲染且标签页可见时轮询 `/api/ketos.peer.state`，并在得到不可用（404）应答后停止，因此没有该插件的部署不会产生后台 404 流量。

**iroh-js 1.1.0 禁止 `watch*` 与 `stopped()`。** 锁定的版本会在任何 `watch*` 调用时中止 Node 进程，且 `SendStream.stopped()` 永不解决；`tests/native-surface.spec.ts` 扫描源码禁止两者，地址变化改为通过中继 `online()` 等待与连接的 `closed()` 承诺观察。当锁定版本升级到崩溃修复之后，禁令随之解除并同步更新门禁。

**演示环境的 Syncthing 已固定且私有。** Debian 的 1.19.2 早于中继令牌并会加入公共中继；镜像现在安装官方 2.1.5 归档，按架构以 sha256 校验，并由 `syncthing-bootstrap.mjs` 在首次运行前改写生成的 `config.xml`——关闭全局与本地发现、关闭 NAT、关闭崩溃上报、无 STUN、关闭自动升级，`listenAddresses` = 团队的 `strelaysrv` URL 与 `tcp://0.0.0.0:22000`，GUI API key 取自 `STGUIAPIKEY`。模板漂移或缺少中继会明确失败。

## Alternatives considered

- **公共 iroh 中继与发现。** 拒绝：演示不得依赖 n0 基础设施，私有中继还让地址稳定且可审计。
- **手写 TCP/TLS 通道。** 拒绝：NAT 穿透、QUIC 多路复用、连接迁移与端点身份正是 iroh 已经提供的难点；传输接缝让通道其余部分无需它即可测试。
- **按人权限与签名参与者列表。** 演示阶段拒绝：接受任何已知节点的帧，通道防的是外部人而不是已知对等方；权限在演示之后到来。
- **为参与者菜单单独建客户端插件包。** 拒绝：该菜单是看板界面的一部分；它和 dock 一起留在 `packages/client/ui-board`，对等 API 像 `board-doc-api.ts` 一样只是普通路由客户端。
- **插件加载时就开始轮询。** 拒绝：没有对等插件的部署会永远每秒产生一个 404；看板表面上报自己的挂载，不可用应答会停止循环。

## Consequences

通道只能通过团队中继到达：VPS 宕机时不存在对等连接，`invite()` 在中继地址出现之前一直回答 503 `ketos/peer-offline`。`peers.json` 是除密钥之外唯一的持久状态，因此删除该文件会丢失已知节点并需要新的邀请码。接收方无法重拨，因此双方都重启后，由原先拨号的一侧凭 ticket 重连。原生模块不提供 `darwin-x64` 构建，因此 Intel Mac 只能在 Docker 演示环境内运行该通道。帧表在消费者出现之前就保留了类型码；没有处理器的保留帧只记一行日志后被忽略，从而避免混合版本的一对节点崩溃。

## Testing

`packages/ketos/peer/tests` 覆盖内存传输之上的协议（分帧、握手、拒绝、已知节点、参与者与颜色规则、请求超时、带假定时器的重连与取消）以及两个回环 iroh 端点上的传输本身；Loader 组装套件启动真实插件，通过密钥文件证明 `EndpointId` 稳定，并拒绝长度错误的密钥。每个文件的覆盖率均为 100%。`packages/ketos/board-doc/tests/participants.spec.ts` 以 100% 覆盖参与者映射与记录校验。客户端套件覆盖对等 API 解码器、轮询生命周期、名册合并与参与者弹层；live 演示环境检查中两块看板经 VPS 中继在 0.08 秒内连接，重启一个容器后 2.8 秒恢复链路。

## Related

- [`@ketos/peer` README](../../../../packages/ketos/peer/README.zh.md) —— 包契约、配置、服务表面与帧表。
- [看板文档及其元素模型](2026-10-06-ketos-board-element-document.zh.md) —— 本通道写入其 `participants` 映射的文档。
- [`docker/relay/README.md`](../../../../docker/relay/README.zh.md) —— 部署运行的私有中继。
- [`docker/stand/README.md`](../../../../docker/stand/README.zh.md) —— 双计算机演示环境及其固定的 Syncthing。
