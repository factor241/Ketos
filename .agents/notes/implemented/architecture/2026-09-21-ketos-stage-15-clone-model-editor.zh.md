# Agent Note: The clone domain owns its own SQLite file behind one Fetch route, and the board edits clones in clone windows

Status: implemented

[English](2026-09-21-ketos-stage-15-clone-model-editor.md) | 中文

## Problem

在本阶段之前，看板只承载会话：产品中没有任何由用户创建、命名并编辑的记录，也没有任何 Ketos 包拥有自己的持久化数据。本阶段引入克隆——员工的数字分身，带有角色、角色设定、方法论、首选模型路由，以及绑定到它的会话——因此需要一个具备既定 schema 与生命周期的宿主存储、一条浏览器无需新增代码生成的 remote 域即可使用的传输通道，以及一个用于创建、编辑克隆并把它变成会话的看板表面。存储写入的一切都必须跨重启存活、不得与其他包的数据库冲突，也不得让 `ketos web` 在启动时打印 Node 的 SQLite 实验性警告。

## Decision

**`@ketos/clone-core` 拥有 `$DSH_HOME/clones.db` 及其只进式 schema 运行器。** 领域 KV 栈被否决：`storage-domain`/`storage-sqlite` 存储经过校验的文档，并拒绝任何不是由它们写入的 `user_version`，因此一个在第 17、19 阶段按步骤增长的 schema 无法安放其中。`src/schema.ts` 持有有序的步骤列表——第 `n - 1` 项产出 `user_version` `n`——`migrate` 在一趟中补齐所有缺失步骤，并给新文件打上 `application_id` `KTCL`。只有外来的 `application_id`、更新的 `user_version`，或不是 SQLite 的文件会被拒绝；没有回滚，也不能降级。父目录以 `0700` 创建，缺失文件以 `0600` 创建，且每次读取都会解码它找到的持久化值，因此手工改过的 `status` 或 `skills_json` 会直接报错，而不会进入 UI。

**数据库惰性打开。** `apply` 注册路由并持有一个惰性句柄；`node:sqlite` 的导入与文件打开发生在首次请求时。构建后的 CLI 冒烟测试断言随附组合启动时没有 `ExperimentalWarning: SQLite`，因此在挂载时急切打开会让每个从不触碰克隆的部署都挂在该闸门上。

**域由一条精确 Fetch 路由承载，JSON 手工校验。** `/api/ketos.clones` 通过 `ctx.connection.fetch` 注册（`GET` 列出，`POST` 携带 `op`），因为精确路由先于 Typert 网关匹配，而克隆 API 仍在演进——代码生成的 remote 域会把逐字段的 wire 契约冻结。路由在打开数据库之前自行校验每个字段（未知字段、超长文本、空名称或空角色、非整数修订号、未知 `op`），并应答 `400 ketos/invalid`、`404 ketos/clone-not-found` 或 `409 ketos/clone-conflict`；意外的内部故障以 `500` 加纯文本正文应答，客户端不会把它读作领域错误码。浏览器与宿主通过包的 `./types` 子路径共享 `src/types.ts`，浏览器代码以 type-only 方式导入它。

**写入按修订号校验，删除克隆会一并移除其绑定。** 仅当存储的 `revision` 仍等于调用方读到的值时，`update` 与 `delete` 才会生效——该守卫是各写入语句的一部分，因此没有写入方能插入检查与写入之间——不匹配时应答 `ketos/clone-conflict` 并保持记录不变。迁移步骤与其版本戳在同一事务中提交，因此崩溃或步骤失败只会让文件停留在先前版本，不留下需要重放的半成品 DDL；打开失败也不会被缓存，下一次请求会重试。`deleteClone` 在一个事务中删除克隆及其 `clone_sessions` 行，因为克隆已不在的绑定永远无法解析；会话本身作为普通会话留在会话存储中。

**克隆 UI 留在 `ui-board` 之内。** 窗口状态新增可选的 branded `cloneId`，由布局文档持久化，因此恢复的克隆窗口会重新打开对应的克隆；`BOARD_WINDOW_TEMPLATES.clone` 与 `board.window.body` 的 `clone` 键注册编辑器主体，外框与 dock 行在用户重命名之前以克隆的名字命名窗口。克隆窗口编辑的是卡片而非聊天：`resolveChatWindow` 不再把它当作聊天目标，面板中会创建会话的动作改为打开聊天窗口，因此没有任何手势会把克隆窗口永远无法显示的会话绑定到它。修订号在存在未保存草稿时移动，只会重定基准修订号——用户的文本得以保留，下次保存会把它应用到更新的记录之上——而没有未保存修改的表单则跟随存储记录。名册通过 inject 的 `hooks` 隔间（`cloneList`）发布，这是注册方自有响应式事实的既定通道，所有变更都经由新的 inject face 回调；dock 的克隆迷你面板、Omnibox 的「新建克隆」条目与「克隆」一节，以及编辑器读取同一个来源。创建克隆会话是一次 apply 侧操作：`sessions.create()`、`bridge.adopt(windowId, sessionId)`（绑定并应用记住的默认预设）、通过 `bridge.selectModel` 应用存储的模型路由，以及在路由上 `bindSession`；会话在自己的聊天窗口中打开。模型选择同时保存为 `agent-default-model` 系统默认值——即 `packages/client/ui-board/README.md` 已记录的既有副作用；本阶段按计划接受它。

**首选模型以 `provider/model` 路由存储。** 编辑器的选择器提供部署的模型目录与「部署默认」，把选择存入记录的 `preferred_model` 列，`parseModelRoute` 在第一个分隔符处拆分——提供方 id 不含斜杠，因此包含斜杠的模型 id 保持完整。

## Alternatives considered

- **通过 `storage-domain` 配 SQLite 后端存储克隆。** 否决：该栈拥有自己的 `user_version` 并拒绝其他值，因此分阶段增长的 schema 只能作为单个文档塞进去；克隆需要自己的步骤、索引与身份戳。
- **使用带生成类型的 Typert remote 域。** 本阶段否决：克隆 API 尚不稳定，而生成的表面（协议 schema、网关声明、客户端装配条目）的成本远超这一条路由，且精确路由先于网关匹配，`ui-deliverables` 已在生产中验证了这一点。
- **新增 `@ketos/clone-ui` 客户端包。** 否决：计划把克隆窗口留在 `ui-board`，使浏览器侧不新增注册表面；克隆主体只是既有 `board.window.body` 注册中多一个 `yield`。
- **在插件挂载时打开数据库。** 否决：惰性打开正是 CLI 启动冒烟不出现 SQLite 实验性警告的原因；对于从不列出或编辑克隆的进程，挂载时打开没有任何收益。
- **在主面板而非看板窗口中编辑克隆。** 否决：看板是 Ketos 的产品表面，克隆窗口无需新增外壳即可参与既有的布局、dock 与全屏行为。
- **首选模型使用自由文本字段。** 否决：模型目录已经投影到浏览器，类型化的路由让存储值在创建会话时可由 `remote.session.selectModel` 解析。

## Consequences

产品现在拥有一等记录：克隆在看板中创建、带修订指示与冲突横幅地编辑、在 `~/.ketos/clones.db` 中跨重启存活，并可变成绑定到它的会话。后续阶段会在同一个数据库上以同一运行器的第 2、3 步扩展 `clone_tasks` 与记忆表，访谈阶段则继承 `clone_sessions` 绑定，而不必另造一套。接受的代价：路由为手工校验而非生成，浏览器与宿主手工共享类型，首选模型的变更同时写入系统默认值，且克隆的 `skills` 字段尚无消费方。

Verification: `packages/ketos/clone-core/tests/database.spec.ts` 覆盖仅属主可访问的创建、身份与版本戳、拒绝路径、运行器有序且不丢数据的应用、失败步骤的回滚、打开失败后的重试，以及拒绝一个打开过程被并发关闭接管的仓库；`tests/repository.spec.ts` 覆盖 CRUD、修订 CAS、绑定替换与持久化解码；`tests/routes.spec.ts` 覆盖每个操作、每个错误码、路由随其 fiber 的撤销，以及畸形请求绝不打开文件；`tests/composition.spec.ts` 通过真实 Loader 对记录型 connection 服务启动该行，并证明首次请求之前文件始终未被触碰。`packages/client/ui-board/tests/clone-body.client.spec.tsx` 覆盖表单的初值、保存补丁与修订号、保留草稿并重定基准修订号的冲突、删除冲突、可重试的加载状态、字段上限、模型选择器与会话操作；`tests/clone-flow.client.spec.tsx` 驱动装配后的看板——dock 中的名册、操作菜单的「新建克隆」、从路由重新读取的已保存编辑、在克隆窗口中发送提示词会打开聊天窗口，以及通过 `/api/ketos.clones` 绑定的新建会话（应用克隆的首选模型）；`tests/board-layout.client.spec.ts` 与 `tests/open-window.client.spec.ts` 覆盖持久化的 `cloneId`、该模板与聊天窗口规则。`pnpm run test:gui`、`DSH_SNAPSHOT=replay pnpm run test:web`、`pnpm run typecheck`、`pnpm run lint`、`pnpm run build`、`pnpm run hygiene` 与 `pnpm run doc-sync` 均为绿色。

## Related

- [The board composes as slots with one registration per window and body kind](2026-09-15-ketos-board-slot-composition.zh.md) —— 本阶段为其新增一个 `clone` 主体的键控席位。
- [Board windows restore their Harness sessions and reconcile them against the session list](2026-09-19-ketos-board-session-restore.zh.md) —— 本阶段新增 `adopt` 入口的会话桥及其绑定表。
- [Board layout persistence through the `ui-board` settings namespace](2026-09-18-ketos-board-layout-persistence.zh.md) —— 现在承载克隆窗口 `cloneId` 的文档。
- [Ketos MVP engineering policy (fork scope, coverage exceptions, process)](../process/2026-09-15-ketos-mvp-engineering-policy.zh.md) —— 本包消费的 `packages/ketos/clone-*/src/**` 覆盖例外。
- [`packages/ketos/clone-core/README.md`](../../../../packages/ketos/clone-core/README.zh.md) —— 路由表、schema 与包的局限。
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.zh.md) —— 克隆窗口、dock 迷你面板与模型默认值副作用。
