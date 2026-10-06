# Agent Note: 看板文档及其元素模型

Status: implemented

[English](2026-10-06-ketos-board-element-document.md) | 中文

## Problem

看板元素——便签、笔迹、待办清单，以及之后的共享窗口记录——此前没有归属。窗口布局是按每个 Ketos 保存的设置文档，整体写入，因此无法承载两个 Ketos 实例必须收敛的数据；每个浏览器标签页也只持有自己的视图：元素的变化不会到达另一个标签页，除布局之外没有任何东西能在重新加载后存活，也没有存放参与者身份或变更历史的地方。10 月 16 日的演示需要阶段 29–31（便签、画笔、待办）与 32–33（参与者与同步）的共享基础，而不必之后返工它们的存储、传输或合并行为。

## Decision

**元素存放在宿主文档中，而不是布局中。** 新的宿主包 `@ketos/board-doc` 在 `$DSH_HOME/board.db` 中拥有一个 Yjs 文档。窗口布局保持原样：一份按每个 Ketos 保存、整体写入且从不同步的设置文档，因为窗口几何是本机视图状态，而元素是共享数据。`@ketos/board-doc` 不依赖任何其他 `@ketos/*` 包；待办清单（31）、对等通道（32）与同步（33）依赖它。

**数据库是 Yjs 更新的只追加日志。** `updates(seq INTEGER PRIMARY KEY AUTOINCREMENT, update BLOB, origin TEXT, at TEXT)` 为每个已提交事务保存一行；加载时通过 `Y.mergeUpdates` 合并所有行，并以 `load` 来源应用结果，追加监听器忽略该来源。`revision` 就是该行的 `seq`，因此在重启与压缩后保持单调。日志超过 `journalCompactRows` 行时，一个 SQL 事务把 `Y.encodeStateAsUpdate(doc)` 写为 `compact` 行并删除更早的所有行，修订号绝不减小。`meta` 保存本地 `selfId` 与 `docId`；两者在首次打开时生成、之后读取，值损坏会让打开失败而不是被替换。

**文档结构是以元素 id 为键的嵌套映射。** `elements` 是以 `ElementId` 为键的 `Y.Map`；每个元素是一个 `Y.Map`，包含信封键（`kind, ownerId, x, y, w, h, z, createdAt, updatedAt`）以及嵌套的 `data` `Y.Map`（按种类拥有的 JSON 值）。把元素存为单个 JSON 值会丢失对不同字段的并发编辑；嵌套映射按键合并，这正是阶段 33 所需。宿主校验每次读取，并用一行宿主日志跳过无法解码的元素，因为同步文档可能携带另一个 Ketos 版本写入的数据。

**浏览器读取快照并跟随 server-sent events。** `GET /api/ketos.board` 返回快照；`POST /api/ketos.board.ops` 应用一个原子批次；`GET /api/ketos.board.events` 先流出一个 `snapshot` 事件，随后每个已提交行一个 `patch` 事件与 `: ping` 心跳。浏览器从不加载 `yjs`：它只看到普通 JSON，store 按修订号应用补丁。Gateway WebSocket 流被否决，因为它需要为只有看板读取的载荷做描述符代码生成与 `ctx.remote` 接线；轮询（如任务窗口）在合理频率下无法守住一秒预算。经由精确 Fetch 路由的 SSE 在一条连接上承载快照与补丁；客户端在标签页隐藏超过 `elementStreamHiddenCloseMs` 时关闭它，以保持在 HTTP/1.1 每源连接预算之内，并在返回时以新快照重开。

**操作是原子的、按所有者限定的，并在变更前解析完成。** 一个批次在线上边界解析（`rejectUnknownFields`、有限且有界的数值、`maxOpsPerRequest`），对照模拟状态解析——宿主拥有 `ownerId = selfId`、`z = max + 1` 与两个时间戳——并在任何变更发生前按完整合并后的元素校验；只有此后才由一个 `doc.transact` 应用记录好的变更。浏览器批次只能创建属于 `selfId` 的元素，并且只能修改或删除自己拥有的元素（否则 409 `ketos/element-foreign`）；宿主批次绕过该检查。失败以 `ketos/invalid`（400）、`ketos/element-not-found`（404）、`ketos/element-foreign`/`ketos/element-exists`/`ketos/limit`（409）作答，超过 `maxRequestBytes` 的请求体作答 413。

**`selfId` 存放在 SQLite 中，绝不在文档里。** 阶段 33 会在两个 Ketos 实例之间同步整个文档；文档内的身份会变成两者共享。宿主从 `meta` 读取 `selfId`，把它盖在每个浏览器创建的元素上，快照携带它，客户端在首个快照时采纳它（`adoptSelfId` 重写已存的演示自身所有者，使恢复的布局归当前参与者所有）。

**`ctx.ketosBoardDoc` 是宿主端接缝。** `selfId()`、`docId()`、`snapshot()`、`apply(ops, origin)` 与 `subscribe(listener)` 是路由以及阶段 31–34 的唯一读写点；服务在首次使用时惰性打开数据库、文档与日志，并随插件 fiber 一起关闭。

## Alternatives considered

- **把元素留在布局文档中。** 否决：布局整体写入、按每个 Ketos 保存且从不同步；两个标签页与两个 Ketos 实例永远无法收敛，而且每次布局捕获都会毁掉元素数据。
- **把元素存为 `Y.Map` 中的单个 JSON 值。** 否决：对同一元素不同字段的并发编辑会互相覆盖；嵌套 `Y.Map` 按键合并。
- **把 `selfId` 放进文档。** 否决：同步会复制整个文档，两个 Ketos 实例将共享同一身份，所有者检查也会比较共享值。
- **使用 Typert Gateway 流或轮询。** 否决：Gateway 需要为私有载荷做描述符代码生成与 `ctx.remote` 接线，而轮询无法在不浪费请求的情况下守住一秒可见性预算。
- **在事务内应用操作、出错时回滚。** 否决：Yjs 在事务回调抛出时不会回滚事务，部分批次会留在文档中；批次先对照模拟状态解析并校验，然后在一个事务中应用。

## Consequences

阶段 29–31 无需触碰存储或传输即可加入元素种类：每种注册一个 `board.element.body` occupant 与一个 `board.element.toolbar` occupant，在 `validateElementData` 中扩展自己的分支，并把描述符加入 `board-element-kinds.ts`。阶段 32 在 `owners.ts` 之后加入参与者注册表，阶段 33 同步文档并在同一信封上注册共享窗口记录。日志让文档在崩溃时安全且可压缩，代价是每个已提交批次一行更新以及一次重写日志的压缩；修订号始终是单调的 `seq`，因此客户端补丁总是有序的。事件流是该包的第一条 SSE 路由：它在中止、消费方取消、积压溢出与释放时关闭，客户端以递增暂停重试，因此宿主不可用时元素切片过期但看板仍可用。浏览器捆绑会内联浏览器安全的 `./kinds` 与 `./data` 模块（记录在客户端捆绑纯净性允许清单中），因此客户端共享校验而不引入任何宿主模块。

## Testing

`packages/ketos/board-doc/tests` 覆盖存储（仅属主文件、身份、日志加载/追加/压缩、拒绝外来文件）、文档与操作（原子性、每个错误码、完整结果边界、属主规则、尺寸边界）、服务（惰性打开、每条已提交行一次变更、释放）、路由与事件流（每个状态、先快照后补丁、中止、取消、积压、503、释放），以及经由真实 Loader 的组合；该包保持每文件 100% 覆盖。`packages/client/ui-board/tests` 覆盖坐标、API 解码器与流行为、store 切片与 selfId 采纳、元素层、外框手势、Delete 守卫、选择条与小地图；`apps/web/tests/board-elements.e2e.ts` 驱动同一 Ketos 的两个标签页经过真实宿主。

## Related

- [`@ketos/board-doc` README](../../../../packages/ketos/board-doc/README.zh.md) —— 包契约、配置、路由与源码映射。
- [Board window ownership and access](2026-10-06-ketos-board-window-ownership.zh.md) —— 阶段 27 的笔记，其 `owners.ts` 在本阶段成为文档的本地身份。
- [Board layout persistence](2026-09-18-ketos-board-layout-persistence.zh.md) —— 元素有意不使用的按每个 Ketos 保存的设置文档。
- [Board slot composition](2026-09-15-ketos-board-slot-composition.zh.md) —— 元素层加入的槽位级联。
