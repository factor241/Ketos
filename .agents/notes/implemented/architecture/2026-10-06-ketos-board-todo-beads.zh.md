# Agent Note：基于 Beads 的待办列表

Status: implemented

[English](2026-10-06-ketos-board-todo-beads.md) | 中文

## Problem

10 月 16 日的演示需要把待办列表作为看板元素，其条目真正存放在 Beads 中：从聊天与 `+` 目录创建、在看板上勾选时数据库中的条目状态随之改变，并可通过命令行的 `bd` 读取。看板文档（阶段 28）已经存储元素，阶段 33 会把它复制到第二个 Ketos，因此存储、属主与动画必须围绕宿主拥有的快照来设计，而不让浏览器直接访问数据库或 `bd` 可执行文件。

## Decision

**每个列表是 Ketos 自有数据库中的一个 Beads 史诗。** `@ketos/board-todo` 通过 `BEADS_DIR` 让 `bd` 指向 `$DSH_HOME/beads/.beads`，绝不指向仓库的任务数据库；元素保存史诗 id、标题、重读的条目与同步时间，每个条目的状态即 Beads 状态。

**属主宿主是唯一写入者，且通过 CLI 写入。** 宿主通过 `ctx.subprocess` 只解析一次配置的 `bd` 可执行文件，以仅属主可访问的权限创建目录，通过队列串行化调用（内嵌 Dolt 引擎拒绝并发写入者），对报告 `exclusive lock` 的调用最多重试三次，并且不经 shell 启动，因此标题不会变成标志。首次操作前它要求 `bd version --json` 报告受支持的 1.x 版本且不低于 1.2.2，并运行 `bd init --prefix … --quiet --skip-hooks --skip-agents --non-interactive --init-if-missing`，从而在不触碰任何 git 仓库的情况下创建 Ketos 数据库。

拒绝 `bd serve` 与 Go SDK。对于一个只需要五种操作的产品，`bd serve` 会增加长驻服务器、端口与需要版本协商的线上协议；Go 绑定会为同样的五种操作给 Node 进程加上 cgo 与 SQLite 链接。CLI 是稳定且有文档的边界：包装把它的应答按 `schema_version: 1` 封装校验，并把失败（缺少可执行文件、非零退出、非法 JSON、不受支持的版本）映射为各自类型化的错误。

**每次调用与镜像都关闭遥测。** 每个子进程环境都携带 `BD_DISABLE_METRICS=1`、`DO_NOT_TRACK=1`、`BD_JSON_ENVELOPE=1`、`BD_NON_INTERACTIVE=1`、`NO_COLOR=1`、`GIT_TERMINAL_PROMPT=0` 以及固定的 `beads.role` git 身份；stand 的 Dockerfile 在镜像范围内设置 `BD_DISABLE_METRICS=1` 与 `DO_NOT_TRACK=1`，并按架构以 sha256 固定 `bd` 1.3.1。规则 Р-3 在 Ketos profile 中保持分析与遥测关闭，且有测试断言每次调用的子进程环境。

**元素携带快照，浏览器绝不与 Beads 直接通信。** `/api/ketos.board.todo` 路由先校验请求体，在未进行任何 `bd` 调用之前就拒绝他人的元素，执行操作，通过 `bd list --parent … --all --limit 0 --json` 重新读取条目，并把 `{ epicId, title, items, syncedAt, missing?, pendingPlacement? }` 经 `ctx.ketosBoardDoc.apply(…, 'host')` 写回。浏览器看到的元素流与其他类型完全相同，阶段 33 会把快照复制给第二个 Ketos，由后者只读渲染。`bd show` 不再找到史诗的列表保留其条目并携带 `missing: true`；从聊天创建的列表携带 `pendingPlacement`，直到第一个可见标签页放置它，而按元素串行化的队列使两个标签页只产生一次放置（失败者得到 409）。

**补丁用 `null` 删除数据键。** 没有其他方式能清除 `pendingPlacement` 或 `missing`：文档按键合并数据，因此 board-doc 的补丁现在把 `null` 值视为删除。该规则记录在操作类型上，并由 ops 测试覆盖。

**不录制会话快照。** `/todo` 只记录既有的仅日志事件 `command/run` 与 `command/done`，它们绝不进入模型请求；`SessionEventMap` 与模型请求均未改变，宿主组合测试断言路由与命令的注册，而不是会话重放。

## Alternatives considered

- **把 Beads 数据库放进仓库的 `.beads`。** 拒绝：该目录是各 worktree 共享的开发任务数据库；产品数据位于 `$DSH_HOME` 之下。
- **用 `bd reopen` 重新打开条目。** 拒绝：对已打开的条目执行 `bd reopen` 会以退出码 0 返回空的非 JSON stdout；`bd update --status closed|open` 在两个方向上都是幂等的。
- **让浏览器直接调用 Beads。** 拒绝：属主检查、快照与流已经位于同一条宿主路由；第二条写入路径会重复它们并暴露数据库。
- **把条目存成文档自己的列表。** 拒绝：需求是 `bd` 与看板显示相同条目，只有在 `bd` 重读之后写入的快照才能让这件事可检验。
- **用动画库实现移动动画。** 拒绝：在同一列表容器内使用稳定的 React key、在 layout effect 中应用 FLIP 变换，并用过渡 token 与 `prefers-reduced-motion` 关闭动效，无需依赖即可满足需求。

## Consequences

列表的正确性取决于宿主能否访问 `bd`：缺少或不受支持的可执行文件以本地化消息应答 503，失败的调用应答 502 而 stderr 留在宿主日志中，每次变更都要付出一次或多次进程启动成本（stand 中每次调用约 0.2 秒，开发 Mac 上 `bd` 1.2.2 约 0.7 秒）。快照是文档中的缓存：若标签页在 `bd` 写入与快照写入之间消亡，下一次刷新会重读真相，看板绝不自行编造条目状态。

## Testing

`packages/ketos/board-todo/tests` 覆盖包装（argv、环境、队列、版本门、锁重试、两个录制的版本、类型化错误）与路由（每个动作、属主、条目上限、史诗缺失、放置竞争、错误映射），每个文件 100% 覆盖；可选的 real-`bd` 测试在没有可执行文件时自行跳过。`packages/ketos/board-doc/tests/todo.spec.ts` 覆盖快照格式，`packages/client/ui-board/tests` 覆盖 API 解码器、放置监视器、主体（进度、带回滚的乐观勾选、已完成分区、添加与刷新、他人只读）与 dock 弹出框，组装后的看板由 web e2e 与快照重放通道覆盖。

## Related

- [`@ketos/board-todo` README](../../../../packages/ketos/board-todo/README.zh.md) — 包契约、Config、路由与源码映射。
- [看板文档及其元素模型](2026-10-06-ketos-board-element-document.zh.md) — 快照写入所依赖的存储与属主模型。
- [看板笔迹](2026-10-06-ketos-board-strokes.zh.md) — 上一个元素阶段，本阶段扩展其主体与动画规则。
- [Beads](https://github.com/gastownhall/beads) — `bd` 所属的议题跟踪器。
