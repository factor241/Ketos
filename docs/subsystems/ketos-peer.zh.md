# Ketos 对等通道

[English](ketos-peer.md) | 中文

Ketos 软分叉的传输子系统：不同计算机上的两个 Ketos 实例通过团队的私有 iroh 中继互相发现，并以分帧消息作为同一个团队协作。它不属于上游 Cordis 目录的子系统所有权范围；各包的契约位于下方链接的包 README 中，本页承载事件参考。

## 所有权

| 所有者 | 职责 |
|---|---|
| [@ketos/peer](../../packages/ketos/peer/README.zh.md) | `ctx.ketosPeer`：带存储密钥的 iroh 节点、分帧通道及其心跳、邀请码、已知节点文件、参与者记录与重连 |
| [@ketos/board-doc](../../packages/ketos/board-doc/README.zh.md) | 看板文档；每个 Ketos 把自己的记录写入其中的 `participants` 映射 |
| [docker/relay](../../docker/relay/README.zh.md) | 部署在 VPS 上运行的私有 iroh 中继与 Syncthing 中继 |

## 通道

节点用存储在 `$DSH_HOME/peer.key` 的密钥和团队中继 URL 绑定，因此其 `EndpointId` 稳定，且只能通过该中继到达。一条连接承载一个双向流；消息为 `[u32 BE 长度][u8 类型码][帧体]`，类型码用于看板文档同步、聊天记录、把两个 Ketos 链接到同一共享文件夹的 Syncthing 设备 id 交换，以及心跳。看板同步的帧体是原始字节，其余帧体为 JSON。超过大小上限的帧、畸形帧体、未知类型码或被截断的帧会关闭连接，且不会让异常越过读取循环。通道使用协议版本 3，由传输协议名 `ketos/peer/3` 携带，因此其他版本的构建无法连接。

每一方每隔 `heartbeatIntervalMs` 发送 `peer.ping`，并对每个 ping 回复 `peer.pong`。在 `heartbeatTimeoutMs` 内未完成任何读取（帧头或最多 16 KiB 的帧体分片）的链路以原因 `heartbeat-timeout` 关闭，对端变为 `lost`，由拨号方重拨。

拨号方先写 `hello`；接收方接纳已知节点，或 `hello` 携带其待处理 `ketos1.…` 邀请码一次性密钥的未知节点。已接纳的节点存入 `$DSH_HOME/peers.json`；只有拨号方保存对等方的 ticket，因此由它负责带边界与抖动的重连。

## 事件

`ketos-peer/connected` 在握手建立可用通道后触发，携带对等身份及其参与者记录；阶段 33 用它追赶同步文档。`ketos-peer/disconnected` 在该通道结束时、任何重连尝试之前触发。`ketos-peer/forgotten` 在 `forget` 把对等方从已知节点文件中移除之后触发；Syncthing 功能用它把该对等方的设备从共享文件夹中移除。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ketos-peer-events"></a>

### `ketos-peer/*` events

<a id="ketos-peerconnected--emit"></a>

#### `ketos-peer/connected` — emit

A channel to a known peer became usable; late listeners read the state and catch up.

```ts cordis-catalog
/** A channel to a known peer became usable; late listeners read the state and catch up.
 * @param peer - the peer that just connected.
 * @mode emit
 */
'ketos-peer/connected'(peer: PeerConnectedEvent): void
```

Source: [`packages/ketos/peer/src/service.ts`](../../packages/ketos/peer/src/service.ts)

<a id="ketos-peerdisconnected--emit"></a>

#### `ketos-peer/disconnected` — emit

A channel to a known peer ended; reconnection may follow.

```ts cordis-catalog
/** A channel to a known peer ended; reconnection may follow.
 * @param peer - the peer whose channel ended.
 * @mode emit
 */
'ketos-peer/disconnected'(peer: PeerDisconnectedEvent): void
```

Source: [`packages/ketos/peer/src/service.ts`](../../packages/ketos/peer/src/service.ts)

<a id="ketos-peerforgotten--emit"></a>

#### `ketos-peer/forgotten` — emit

A peer was forgotten: the known-peer file no longer lists it, and only a new invitation admits it again.

```ts cordis-catalog
/** A peer was forgotten: the known-peer file no longer lists it, and only a new invitation admits it again.
 * @param peer - the peer that was forgotten.
 * @mode emit
 */
'ketos-peer/forgotten'(peer: PeerForgottenEvent): void
```

Source: [`packages/ketos/peer/src/service.ts`](../../packages/ketos/peer/src/service.ts)
<!-- END GENERATED cordis-surface -->
