# Agent Note: 阶段 21 MVP 稳定化：审计的主机与看板修复

Status: implemented

[English](2026-09-24-ketos-stage-21-mvp-stabilization.md) | 中文

## Problem

阶段 0–20 的端到端审计（2026-09-24）发现 25 处偏差；阶段 21 关闭其中的代码点（П1–П4、П7–П19），而阶段 22 负责文档、决策、仓库顺序与最终集成。

在主机侧，第二个进程打开全新的 `clones.db` 时可能在迁移上以 `SQLITE_BUSY` 失败，因为打开序列没有设置锁等待；克隆插件的根 `inject` 要求 `tools` 与 `systemPrompt` 注册表，尽管只有逐 agent scope 使用它们，因此没有这两个注册表的主机永远不会激活路由或惰性数据库；1000 字符的记忆查询上限只存在于路由中，而注释声称由仓库强制它，面向模型的 `clone_memory_search` 工具绕过了它；克隆路由对空档案接受 `status: 'ready'`，尽管阶段 16.4 把完成定义为 `ready` 且经撰写的字段非空；启动克隆访谈或自主任务会调用 `remote.session.selectModel`，它无条件地把该选择保存为 `agent-default-model` 系统默认值，因此每次克隆启动都静默移动新普通聊天所用的模型。

在看板侧，手势可能丢失已输入的文本（Omnibox 在得到应答之前就清空了自己的字段，被拒绝的 composer 命令清空了草稿），`busy` 标志可能在 promise 被拒后卡住，被拒绝的 `writeClipboard`/`pickDirectory` 无人处理，克隆表单把下一个修订号算成 `revision + 1` 而不是路由铸造的修订号，且原始的 `${code}: ${message}` 或英文开发者字符串到达了车道与 composer；客户端路径校验接受了没有调用方能提供的 `dshHome`，原生选择器回退传入了一个始终为 undefined 的 home，空路径渲染出 `~/.ketos` 消息；只要任一克隆有 `pending` 或 `running` 任务——即使不可见——任务窗口就轮询主机；`connectors`、`settings` 与 `dashboard` 窗口以空主体打开；`BoardGoalState.activation` 是死代码；克隆编辑器在 zh/en 界面中渲染规范的俄语方法论标题。

## Decision

**克隆模型选择携带显式的 `keepDefault` 标志。** `SessionSelectModelRequest` 新增 `readonly keepDefault?: boolean`；`SessionCommandController.selectModel` 仅在标志缺失或为 false 时调用 `agentDefaultModel.saveSelection`；`ModelDirectory.select(selection, options?)` 只转发 `keepDefault: true`，绝不转发 false；看板的访谈启动与自主任务启动传入 `{ keepDefault: true }`，而 composer 模型芯片保留其双参数调用并仍然保存系统默认值。宿主路径胜过新增的 clone-core 路由：唯一既有路径已经解析并校验路由，而该标志是一个条件分支，复用了它的全部错误处理。看板 README、`docs/ketos/mvp-known-limitations.md` 与 `docs/ketos/upstream-sync.md` 记录这些 fork 修改（`packages/api/session-controller/src/types.ts`、`src/commands.ts`，以及 `packages/client/ui-model-selection/src/client/directory.ts`）。

**`ready` 意味着填好的档案，由路由强制。** `packages/ketos/clone-core/src/routes.ts` 中的 `requireReadyProfile` 拒绝有效 `role`、`persona` 或 `methodology` 为空的 `create` 与 `update` 请求——对 `update`，取存在时的补丁值，否则取存储记录——以 400 `ketos/invalid` 拒绝；克隆编辑器在调用宿主之前以字典文本 `clone.ready.incomplete` 拒绝同一转换，但路由始终是权威：跳过该守卫的客户端会被 wire 拒绝。

**记忆查询上限属于仓库。** `MEMORY_LIMITS.query`（1000）是唯一常量；`MemoryRepository.search` 把超长查询以 `MemoryInvalidError` 拒绝，按去除首尾空白后的查询度量——与路由度量的是同一个值——因此面向模型的 `clone_memory_search` 工具与路由一致，而不必重复这个数字。

**MVP 之外的窗口主体说明其边界，方法论标签跟随界面语言。** 一个 `MvpUnavailableBody` 组件占据 `connectors`、`settings` 与 `dashboard` 的 `board.window.body` 并渲染 `window.unavailable`；dashboard 没有创建路径，其 Omnibox 条目以自己的提示作答。`METHODOLOGY_SECTION_IDS` 把每个规范标题（`Принципы`、`Порядок работы`、`Критерии качества`、`Чего не делать`）映射到稳定 id（`principles`、`workflow`、`quality`、`avoid`）；编辑器的芯片、缺口提示与 `data-board-clone-methodology-section` 属性使用该 id 与 zh/en/ru 字典标签，而存储文本、模板、解析器与模型可见的访谈指令保留规范标题。

**数据库打开序列等待另一个进程的锁。** `openDatabase` 在 `new DatabaseSync` 之后、`migrate` 之前立即设置 `PRAGMA busy_timeout = 5000`（`LOCK_WAIT_MS`），因此迁移与之后的每一条语句都等待另一个进程的锁，而不是以 `SQLITE_BUSY` 失败。

**克隆插件的根 scope 只注入它使用的东西。** `@ketos/clone-core` 的根 `inject` 是 `['connection', 'agents', 'sessionProjections']`，`tools` 与 `systemPrompt` 只由逐 agent scope 注入，因此不注册二者的主机仍会激活路由与惰性数据库。

## Alternatives considered

- **为选择克隆模型新增 clone-core 宿主路由**（П4 的另一选项）。拒绝：它会重复路由解析与校验，而该标志只是既有路径上的一个条件分支。
- **只在看板中强制 `ready`。** 拒绝：直接与替代的 wire 调用方都能绕过它；强制它的正是做出该决定的操作。
- **把查询上限留在路由中。** 拒绝：工具路径绕过了它，审计把它记录为缺陷。
- **为三个工具窗口构建真实内容。** 拒绝：那些表面属于后续阶段；诚实的本地化提示就是 MVP 的答案。
- **重命名规范方法论标题。** 拒绝：存储文本、解析器契约与模型指令都以规范俄语标记为键；只有界面标签本地化。

## Consequences

克隆启动把系统默认值留在用户离开的位置，`ready` 在 wire 上意味着填好的档案，记忆上限活在一个常量中、由工具与路由共享，第二个进程在锁等待之后打开数据库，克隆插件无需工具与提示词注册表即可激活，三个 MVP 之外的窗口说明自己的边界，克隆编辑器的方法论芯片说界面语言而存储文本保留其规范标记。接受的代价：用户在 composer 芯片中选择模型时系统默认值仍然移动，这是设计使然，并由其提示说明；非看板客户端仍能绕过克隆编辑器，但会被路由拒绝；方法论芯片与存储标记语言不同，而规范标记在所有语言环境中都保持俄语；三个工具窗口显示提示而不是内容；测试读取 id 而不是俄语标题。

验证：`packages/api/session-controller/tests/session-models.host.spec.ts`（`keepDefault` 分支与 `commands.ts` 的逐文件 100% 覆盖率）、`packages/client/ui-model-selection/tests/browser-plugin.client.spec.ts`、`packages/client/ui-board/tests/clone-flow.client.spec.tsx` 与 `tests/composer.client.spec.tsx`（克隆流程带该标志、芯片不带）、`packages/ketos/clone-core/tests/{routes,database,memory,memory-tools,composition,methodology}.spec.ts`、`packages/client/ui-board/tests/{clone-body,path-validation,window-chats-panel,tasks-body,slots,omnibox,composer}.client.spec.*`、ru 语言包 spec，以及实机脚本化审计 `.playwright-mcp/stage-21-mvp-stabilization/audit/audit-verdict.json`（16/16，`ok: true`，提交 `258fb5c`）与其 GIF `.playwright-mcp/stage-21-mvp-stabilization/qa/stage21-stabilization.gif`。

## Related

- [Ketos MVP 验收](../architecture/2026-09-23-ketos-mvp-acceptance.zh.md) — 阶段 19/20 的验收记录，本阶段的修复在其之上构建。
- [Ketos MVP 工程政策](../process/2026-09-15-ketos-mvp-engineering-policy.zh.md) — 这些修复所遵守的 fork 范围、覆盖率例外与流程。
- [`packages/ketos/clone-core/README.md`](../../../../packages/ketos/clone-core/README.zh.md) — 本阶段修复其路由、数据库与记忆存储的克隆主机包。
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.zh.md) — 本阶段修复其手势、窗口与克隆编辑器的看板包。
