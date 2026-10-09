---
description: "Ketos 看板待办列表宿主包：`$DSH_HOME/beads` 下 Ketos 自有数据库中的每个列表一个 Beads 史诗、排队且无遥测的 bd CLI 包装、`/api/ketos.board.todo` Fetch 路由与 `/todo` 命令。"
kind: "package-reference"
---

# @ketos/board-todo

[English](README.md) | 中文

## 概述

`@ketos/board-todo` 端到端地拥有看板的待办列表。类型为 `todo` 的元素携带一个 Beads 史诗及其子条目的快照，且只有属主的宿主可以写入：`/api/ketos.board.todo` 校验请求体，在未进行任何 `bd` 调用之前就拒绝他人的元素，通过 `bd` CLI 对 `$DSH_HOME/beads/.beads` 下的 Ketos 自有 Beads 数据库执行变更，重新读取史诗的条目，并把快照通过 `ctx.ketosBoardDoc` 写回。`/todo <title>` 命令从聊天创建列表，并把放置交给第一个可见的看板标签页。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

随附的 `web` profile 通过 `dsh-web-app` bundle 补丁挂载该包，这是唯一受支持的组合方式：

```yaml
- id: ketos-board-todo
  name: '@ketos/board-todo'
  config:
    beadsDir: !!js dshHomePath('beads')
    bdCommand: bd
    beadsPrefix: kt
    bdTimeoutMs: 15000
    bdOutputMaxBytes: 1048576
    todoTitleMaxChars: 200
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `beadsDir` | 必填 | 存放 Ketos Beads 数据库的目录；`bd` 在其中 `<beadsDir>/.beads` 工作。首次调用前以仅属主可访问的权限创建。 |
| `bdCommand` | `bd` | Beads CLI 的可执行文件名或绝对路径。 |
| `beadsPrefix` | `kt` | `bd init` 赋予 Ketos 数据库的议题前缀。 |
| `bdTimeoutMs` | `15000` | 单次 `bd` 调用的最长运行时间，毫秒（1000–300000）。 |
| `bdOutputMaxBytes` | `1048576` | 单次 `bd` 调用可产生的 stdout 上限，字节（1 KiB–64 MiB）。 |
| `todoTitleMaxChars` | `200` | 列表或条目标题的最大长度，UTF-16 码元（1–10000）。 |

该路由是浏览器唯一的写入路径：

| 动作 | 请求体 | 效果 |
|---|---|---|
| `create` | `{ action, title, x, y }` | 创建史诗与一个位于该世界坐标的 `todo` 元素，然后写入首个快照。 |
| `addItem` | `{ action, elementId, title }` | 创建一个子议题，然后重写快照。条目数达到 `todoItemsMax` 时以 `ketos/limit` 拒绝。 |
| `setDone` | `{ action, elementId, itemId, done }` | 执行 `bd update --status closed\|open`，然后重写快照；条目必须属于该列表。 |
| `refresh` | `{ action, elementId }` | 调用 `bd show`；史诗缺失时置 `missing: true` 并保留条目，否则重新读取快照。 |
| `place` | `{ action, elementId, x, y }` | 仅适用于仍携带 `pendingPlacement` 的列表；最先发送的标签页胜出，其余得到 `ketos/placement-taken`。 |

应答为 `{ ok: true, elementId, revision }` 或 `{ ok: false, error }`，错误码为 `ketos/invalid`（400）、`ketos/element-not-found`（404）、`ketos/not-owner`、`ketos/placement-taken`、`ketos/limit`（409）、`ketos/beads-failed`（502）、`ketos/beads-unavailable`（503）之一。错误体从不携带 `bd` 输出；stderr 留在宿主日志中。

`/todo <title>` 命令创建的列表，其元素在 `(0, 0)` 处携带 `pendingPlacement: true`；命令以简短的英文宿主文本应答，看板输入框负责本地化标签与描述。

像看板看到的那样检查数据库：

```sh
BEADS_DIR="$DSH_HOME/beads/.beads" BD_DISABLE_METRICS=1 bd list --parent <epic> --all --limit 0 --json
```

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>Implementation internals — click to expand</summary>

### 宿主是唯一写入者

每个操作都先检查元素属主：属于其他参与者的 `todo` 元素（第三阶段同步自另一个 Ketos 的快照）应答 `ketos/not-owner`，且不进行任何 `bd` 调用。随后路由运行 `bd`，通过 `bd list --parent <epic> --all --limit 0 --json` 重新读取子条目，并通过看板文档写回快照。`setDone` 还要求条目 id 属于该列表已存储的条目，因此浏览器无法关闭无关的议题。

### bd 包装

`BeadsCli` 只解析一次可执行文件，以仅属主可访问的权限创建 Beads 目录，并通过队列串行化每次调用，因为内嵌 Dolt 引擎拒绝并发写入者。每个子进程获得固定环境（`BEADS_DIR`、`BD_JSON_ENVELOPE`、`BD_DISABLE_METRICS`、`DO_NOT_TRACK`、`BD_NON_INTERACTIVE`、`NO_COLOR`、`beads.role` git 身份与 `GIT_TERMINAL_PROMPT=0`），宿主进程中所有的 `BEADS_*` 与 `BD_*` 环境变量（例如 `BEADS_DB`、`BEADS_DOLT_SERVER_*`）都会被置空，使包装器无法被重定向到其他数据库。插件卸载时运行 `dispose()`：中止正在运行的调用，以 `BeadsUnavailableError` 拒绝排队中和之后的调用，并等待队列结束。子进程从不经过 shell：标题作为 `--title=<text>` 参数传递，因此以 `-` 开头的标题不会变成标志。参数会被清洗（移除控制字符、截断长度），id 会按 Beads 形状校验。当 stderr 报告 Dolt `exclusive lock` 时，调用最多重试三次。首次操作前 `bd version --json` 必须报告受支持的 1.x 版本且不低于 1.2.2，`bd init --prefix <prefix> --quiet --skip-hooks --skip-agents --non-interactive --init-if-missing` 创建数据库而不触碰任何 git 仓库。只有退出码 0 且 `schema_version: 1` 的封装才会被解析；其余情况变为 `BeadsUnavailableError`、`BeadsCommandError`（携带 stderr 尾部）或 `BeadsProtocolError`。

### 快照及其标志

元素数据恰好为 `{ epicId, title, items, syncedAt, missing?, pendingPlacement? }`，由 `@ketos/board-doc/data` 中的 `parseTodoData` 校验。`missing` 标记 `bd show` 不再找到的史诗，同时保留已显示条目；`pendingPlacement` 标记尚未被可见标签页放置的命令创建列表。两个标志都通过在快照补丁中使用 `null` 数据键清除，看板文档会将其视为删除该键。

### 放置

`place` 在路由内经过自己的队列，因此 `pendingPlacement` 的检查与其移除在属主宿主上是同一个串行步骤：两个标签页竞争放置同一列表时，一个得到 200，另一个得到 409；列表出现时处于隐藏状态的标签页不会放置它，列表留在 `(0, 0)` 等第一个可见标签页处理。

### 源码映射

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`name`/`inject`/`Config`/`apply`、包装、路由与命令 |
| [`src/beads.ts`](src/beads.ts) | 排队 `bd` 包装、版本门、标题清洗、封装解析与类型化错误 |
| [`src/routes.ts`](src/routes.ts) | `/api/ketos.board.todo` 路由、五个动作、属主规则与放置队列 |
| [`src/command.ts`](src/command.ts) | `/todo` 命令定义及其宿主文本 |
| [`src/wire.ts`](src/wire.ts) | 路由辅助：JSON 应答、错误状态与请求体字段读取 |
| [`src/types.ts`](src/types.ts) | 浏览器以 type-only 方式导入的请求、应答与错误码词汇 |
| — | 不发布运行时不变式伴随模块：包装的队列、版本门与应答形状由包内测试覆盖，且不存在可持续观测的进程内关系。 |

</details>

<a id="further-exploration"></a>
## 进一步探索

- [`packages/ketos/README.md`](../README.zh.md) — Ketos 包组。
- [`@ketos/board-doc`](../board-doc/README.zh.md) — 存储快照的看板文档。
- [Beads](https://github.com/gastownhall/beads) — `bd` CLI 所属的议题跟踪器。

<a id="model-experience"></a>
## 模型体验

None, as `/todo` records only log-only `command/run` and `command/done` events that never enter a model request.

#### KV Cache effect

No effect; creating a list changes board state rather than model context.

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- `PATH` 中必须存在 1.x 系列且不低于 1.2.2 的 `bd`；stand 镜像按校验和固定 1.3.1，缺少 `bd` 的宿主会以本地化消息应答 `ketos/beads-unavailable`（503）。
- 只有属主宿主写入列表；第二个 Ketos 读取快照（阶段 33）。Beads 数据库不在两个 Ketos 之间同步。
- 重命名、删除与重排条目、工作目录 Beads 任务、优先级、负责人以及条目间依赖不在本阶段范围内。
- `bd` 以 CLI 方式调用，而非 `bd serve` 或 Go 绑定，因此每个操作都要付出一次进程启动成本（受支持版本上约 0.1–0.7 秒）。

<a id="dev-note"></a>
### 开发备注

运行包内测试：

```sh
pnpm exec vitest run packages/ketos/board-todo --coverage --coverage.include='packages/ketos/board-todo/src/**/*.ts'
```
