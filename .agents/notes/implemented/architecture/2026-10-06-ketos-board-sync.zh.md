# Agent Note：Ketos 看板同步

Status: implemented

[English](2026-10-06-ketos-board-sync.md) | 中文

## Problem

阶段 33 把两台 Ketos 的看板变成一块共享看板：元素、参与者与窗口记录必须在一秒内以所有者的颜色出现在另一台实例上，并发编辑必须收敛，断线期间的编辑必须在恢复后补齐，他人的内容必须只读，而所有者已断开的数据必须被标记。通道（`@ketos/peer`）与文档（`@ketos/board-doc`）都已存在；同步必须拆分到两者之间，使任何一方都不了解对方的机制，而阶段 34–35 会在同样的接缝上构建转录卡片与共享文件夹。

## Decision

**文档就是共享状态；通道只承载 Yjs 更新。** `@ketos/board-doc` 暴露 `stateVector()`、`diffSince(vector)`、`applyRemote(update)` 与 `onLocalUpdate(listener)`，对通道一无所知；`@ketos/peer` 在 `src/board-sync.ts` 中拥有调度。每次 `ketos-peer/connected`——首次连接与每次重连——双方都发送自己的状态向量（`board.sv`），并以 `diffSince` 回答对方的向量（`board.update`）；文档产生的每个事务都会转发给每个已连接的对端。远端更新以 `peer` 事务来源应用，而中继拒绝该来源，因此一次变更恰好一帧，且没有回声。

**二进制帧体、每条记录一个写入者、发送方一侧的上限。** 类型码 `3 board.sv` 与 `4 board.update` 携带原始的、非空的 `Uint8Array` 帧体：`JSON.stringify(Uint8Array)` 会生成大五六倍的对象且永远无法还原，因此帧词表把这两个类型码视为二进制，而 JSON 与请求/响应信封留给其余类型码。`decodeUpdate` 在字节进入文档之前先校验，因此不可读的更新以 `BoardSyncError` 拒绝且不改变任何内容；处理器异常只记日志且通道继续存活，因为一次应用失败不应把对端送入重连循环。`send` 在入队前先编码并测量帧，超过 `maxSyncUpdateBytes`（15 MiB）的更新永不发送：主机日志写入 `board.sync.too-large`，通道以关闭码 `4n` 关闭。每条记录只有一个写入者——元素只有其所有者、参与者只有其 `selfId` 自己、窗口记录只有承载它的 Ketos——这正是按字段后写者胜得以成立的原因。

**补丁只写入自己改动的字段。** `BoardDocument.patch` 跳过文档已持有的每个取值。在此阶段之前它会重写完整信封，因此两台 Ketos 并发修补同一元素的不同字段时会互相覆盖；如今嵌套的按键映射兑现了它们被设计出来的合并能力，计划中的 yjs 实验（A 改 `x`、B 改 `text`，收敛到 `{ x: 100, text: 'changed' }`）在通道上成立。

**窗口记录是 `windows` 映射，而不是元素。** 记录为 `{ id, hostId, ownerId, kind, bodyKind, title, ordinal, x, y, w, h, z, access, status, sessionId?, updatedAt }`；主机盖上 `hostId = selfId` 与 `updatedAt`，浏览器写入声明其他 `hostId`、或目标记录由其他 Ketos 发布时，以 `ketos/window-foreign`（409）拒绝，记录预算为 `maxWindowRecords`（100）。快照与补丁在元素、参与者之外携带 `windows` 切片，因此浏览器通过已在跟随的流获知记录；记录永不进入元素映射、布局、dock 或总览。

**可见标签页发布本浏览器的窗口；接收方渲染只读卡片。** `window-publish.ts` 对每个发生变化的窗口在尾部防抖后提交一次 `window.put`（位置、尺寸、标题、所有者、访问或会话状态——不含 `z`，因此聚焦窗口不会发布；标题依次取窗口自己的名称、克隆的名称、聊天标题，并截断到记录的标题上限）。删除只有一个来源：核对并删除已存储布局不再持有的自有记录，仅由可见标签页执行，put 仍在进行中的窗口不参与，并且只在布局来源已知（`layoutSource`）之后执行：从设置服务器采纳的布局允许删除每条没有窗口的自有记录，因此新配置文件不会删除其空布局尚未加载的记录，已关闭浏览器留下的记录也会被清理；保存在内存中的布局（非环回页面）只删除本发布器自己 put 过的记录。布局不一致的两个可见标签页仍可能删除彼此的记录；在删除时重新发布会让它们互相争夺，因此这仍是已记录的限制。被拒绝的操作在其记录变化前不会再次提交（`ketos/limit` 例外：文档中的记录变少后会重试），主机不可达时在 `windowPublishRetryMs` 之后重试，一条坏记录不会阻塞其他记录。隐藏标签页保留待发改动直到返回。`ForeignWindowLayer` 把其他 Ketos 的记录渲染在元素与本地窗口之间，按可见矩形裁剪并按记录的 `z` 绘制，经由带所有者填充且没有菜单、拖动或手柄的 `WindowBezel`，外面包着由 keyed `board.foreign.window.body` 槽位按窗口类型替换的主体：`agent` 窗口用聊天卡片，其他类型用共享的窗口卡片。`canManageWindow` 要求窗口位于本 Ketos 的布局中，因此另一台 Ketos 发布的记录在这里永不可管理，即使其 `ownerId` 是当前参与者。已知所有者的对等条目没有一个是 `online`（包括 `connecting`）时，其元素与窗口上出现 `peer.stale` 标记，并给出可聚焦的提示，说明数据可能已过期；没有对等网络的部署、或名册不认识的所有者，永不标记。

## Alternatives considered

- **JSON 或 base64 帧体。** 否决：JSON 把 yjs 更新放大约五倍且无法还原 `Uint8Array`；base64 仍会膨胀三分之一，并在每次变更的两端增加转换。
- **重连时传完整快照，而不是交换状态向量。** 否决：交换是增量的，大小受对方缺失内容限制（状态向量 8 字节，300 元素文档中一个变更元素几十字节），且已由连接路径覆盖。
- **任何处理器异常都关闭通道。** 这是阶段 32 的行为；否决，因为本构建读不懂的远端更新会以连接为代价并产生重连循环——失败应写进日志。
- **把窗口记录存为元素。** 否决：记录有不同的生命周期（发布、核对、每主机一个写入者），不属于元素预算或元素绘制顺序，也不得被接收方移动。
- **每次 `z` 变化都发布窗口。** 否决：提起与聚焦窗口会不断发布，而接收方只需要一个绘制占位顺序；记录保留上次真正发布时的 `z`。
- **每次补丁都写入完整信封。** 这是阶段 28 的行为；在并发编辑测试显示 A 的移动与 B 的文本编辑以最后落定的完整信封为准后否决。只写变更字段恢复了嵌套映射为之而建的按键合并。
- **只把 `lost` 视为过期。** 否决：拨号一方在两次尝试之间处于 `connecting`，标记会在数据仍然过旧时消失；`online` 以外的任何状态都表示没有通道传递改动。
- **把过大的更新拆成片段。** 否决：Yjs 13.6 对部分更新支持不佳，而演示看板约 3.5 MB，远低于 15 MiB 上限；过大的看板改为记录日志后关闭通道并退避重连。

## Consequences

两块看板成为一块：在一侧写入的元素、参与者或窗口记录会以所有者的颜色出现在另一侧（演示环境实测中位数 16 ms），不同字段的同时编辑会合并，断线期间的编辑由下次连接的状态向量交换补齐（双方报告 online 后实测 0.04 s）。大于 `maxSyncUpdateBytes` 的看板会以一条日志关闭通道而不是发送——由于笔迹已取整，该上限远高于正常看板。foreign 窗口是带所有者 bezel 填充的占位；从接收方管理已移交窗口、网络实时聊天与按人授权不在本阶段范围内。

## Testing

`packages/ketos/board-doc/tests/sync.spec.ts` 以 100% 覆盖验证状态向量交换、本地更新转发（远端与 `load` 重放永不触达）、远端更新的日志持久化、重复应用与畸形字节；`tests/windows.spec.ts` 覆盖记录校验、发布/变更/删除、外来主机拒绝、预算、不可读记录与远端交换。`packages/ketos/peer/tests` 覆盖双向二进制帧、发送方大小检查、处理器失败隔离、带参与者的连接交换、无回声转发、同时编辑、超限关闭、重连补齐与 100% 覆盖。客户端套件覆盖发布器（一次突发一个 put、状态来自通道、删除、可见性门控、核对、重试）、foreign 层（所有者颜色、无控件与手柄、裁剪、记录不进入布局/dock/总览、本地性判定）、过期标记与迷你地图矩形。实况演示验证窗口打开 26.7 ms、移动 43 ms，`sync-latency.mjs` 测得 20 条便签中位数 16 ms / 最大 31 ms，停止一个容器后另一侧显示「Нет связи」标记，断线编辑随后收敛。

## Related

- [`@ketos/board-doc` README](../../../../packages/ketos/board-doc/README.zh.md) — 记录格式、同步章节与窗口操作。
- [`@ketos/peer` README](../../../../packages/ketos/peer/README.zh.md) — 帧表、二进制类型码与同步调度。
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.zh.md) — 发布器、foreign 层与过期标记。
- [The Ketos peer channel](2026-10-06-ketos-peer-channel.zh.md) — 本同步所依托的通道。
- [`docker/stand/tools/sync-latency.mjs`](../../../../docker/stand/tools/sync-latency.mjs) — 两台电脑的延迟探针。
