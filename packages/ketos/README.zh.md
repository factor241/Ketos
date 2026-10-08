---
description: "Ketos 软分叉的包组：分叉在 upstream harness 之上新增的包，保存在本地且从不发布到 npm。"
kind: "package-group"
---

# ketos/ — Ketos 软分叉包组

[English](README.md) | 中文

## Summary

`ketos` 包组拥有 Ketos 软分叉在 upstream DeepSeek Harness 之上新增的包。这些包把 Ketos 特有行为——品牌、默认值、俄语 locale——接入 harness 启动时加载的同一批 capability seam。禁止发布：每个包声明 `private: true`，发布闸门将该组视为 upstream 包的本地消费者。

## Table of Contents

- [Packages](#packages)
- [Conventions](#conventions)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | 角色 |
|---|---|
| [`@ketos/client-locale-ru`](client-locale-ru/README.zh.md) | Web GUI 的俄语语言包：注册 `ru`，翻译共享、settings 与 board 词典，并在用户未保存 locale 偏好时应用 `ru` 默认值 |
| [`@ketos/clone-core`](clone-core/README.zh.md) | 克隆领域：`clones.db`（仅属主可访问的 SQLite）、只进式 schema、以修订号做 CAS 的克隆仓库、FTS5 记忆存储、带目标驱动运行器的克隆任务表、看板克隆窗口与任务窗口调用的 `/api/ketos.clones`、`/api/ketos.memory`、`/api/ketos.tasks` Fetch 路由，以及把档案、记忆工具、访谈模式与任务报告工具组合进绑定到克隆的会话的会话作用域 |
| [`@ketos/board-doc`](board-doc/README.zh.md) | 看板文档：`board.db`（仅属主可访问的 SQLite）与只追加的 Yjs 更新日志、位于文档之外的本地 `selfId` 与 `docId`、元素信封及其原子操作批次、其他 Ketos 插件读写的 `ctx.ketosBoardDoc` 服务，以及看板元素使用的 `/api/ketos.board`、`/api/ketos.board.ops`、`/api/ketos.board.events` Fetch 路由 |
| [`@ketos/board-todo`](board-todo/README.zh.md) | 待办列表：`$DSH_HOME/beads` 下 Ketos 自有数据库中每个列表一个 Beads 史诗、排队且无遥测的 `bd` 包装、`/api/ketos.board.todo` Fetch 路由与 `/todo` 命令 |
| [`@ketos/peer`](peer/README.zh.md) | 对等通道：带存储密钥的 iroh 节点、`ctx.ketosPeer` 背后的分帧消息通道、一次性邀请码、已知节点文件、参与者记录，以及 `/api/ketos.peer.*` Fetch 路由 |

-----

<a id="conventions"></a>
## Conventions

- 包名：`@ketos/<name>`，每个 `packages/ketos/<name>/` 目录一个包。
- 每个清单声明 `private: true`；禁止发布到 npm，workspace 约束闸门拒绝任何准备发布的内容。
- 测试位于包自身的 `tests/` 目录。
- 包 README 遵循仓库规则：`Summary`，以及当包改变模型可见行为或遗留缺口时的 `Model Experience` 与 `Known Limitations`。

-----

<a id="related-documentation"></a>
## Related documentation

- 分阶段的品牌重塑计划（仓库外的规划目录）负责该包组及其约束。

<a id="dev-note"></a>
## Dev Note

无。
