# Agent Note: Ketos MVP 验收——分叉发布什么、偏离哪些 upstream 闸门，以及什么被推迟

Status: implemented

[English](2026-09-23-ketos-mvp-acceptance.md) | 中文

## 问题

分叉需要一份持久记录，说明 MVP 接受了什么：偏离哪些 upstream 工程闸门、为什么偏离、验收证明了什么、哪些子系统保持推迟，使后 MVP 阶段（Temporal worker、Beads 与知识、周边容器、组织库）从已记录的边界出发，而不是重新推导它。[MVP 工程政策](../process/2026-09-15-ketos-mvp-engineering-policy.zh.md)把自己的复核推迟到这次验收——「在 MVP 验收（阶段 20）时复核」——而没有任何包 README 整体承载这份偏离集。

压力是具体的。`@ketos/*` 包以自己的作用域与私有规则与 upstream 包并存；原始看板 GUI 与克隆包以行为测试套件取代逐文件覆盖百分比；模型可见的品牌字符串在推迟的选项 0.7 下保持 upstream 字面量；而看板的聊天面板需要一项产品修正，让刚注册的文件夹能创建它的第一个聊天。

阶段报告以阶段为范围，包 README 以包为范围。被接受的边界——分叉有意与 upstream 不同之处，以及有意尚不发布之处——比两者都活得更久，每个后续阶段在重新打开其中一个决策之前都先读它。

## 决策

**验收证据：MVP 场景以三阶段机器审计运行。** [docs/ketos/mvp-e2e.md](../../../../docs/ketos/mvp-e2e.md) 中的场景在存活的 `ketos web` 主机上覆盖看板步骤 A1–A6（面板、窗口外框、聊天面板、缩放、全屏、重载）与克隆步骤 B7–B13（克隆卡片、访谈、记忆、自动驾驶任务、报告、追问、重启），项目示例位于 `docs/ketos/examples/ketos-mvp/`。

**验收跑在存活的环境上，而不是 mock。** `stand.sh` 以干净的 `DSH_HOME`（`/tmp/ketos-stage20/home`）启动 `ketos web`，`DEEPSEEK_BASE_URL` 指向本地 SSE 桩，因此场景不消耗外部 API；`SSH_CONNECTION` 被刻意设置，使自适应选择器解析为 `browse`、文件夹迷你浏览器可供场景使用，而 `native` 阶段覆盖没有该标记的主机。

**审计依次驱动全新主目录、重启后的进程与选择器回退。** `.playwright-mcp/stage-20-mvp-acceptance/audit.mjs` 在干净的 `DSH_HOME` 上运行阶段 `one`（以本地 SSE 桩为模型），在 `stand.sh restart` 之后运行阶段 `two` 复查恢复后的看板、克隆、记忆与终态任务，阶段 `native` 驱动没有 SSH 标记的主机以覆盖原生文件夹选择器回退。三个阶段的判定均为 `ok: true`（53、9 与 2 项检查），产物为 `audit/audit-verdict-<phase>.json`、`audit/shots/` 下的画面，以及桩保留下来的 `audit/requests-summary.jsonl`。

**到达模型的内容按请求记录。** 每行 `requests-summary.jsonl` 携带角色、工具目录，以及克隆档案、方法论与记忆段落是否存在，因此验收可以展示——而非假定——已完成任务的追问回合不携带 `clone_task_report` 工具，同时档案、方法论与记忆段落仍在。

**阶段报告承载判定，预算表位于性能基线。** [docs/ketos/reports/stage-20-mvp-acceptance.md](../../../../docs/ketos/reports/stage-20-mvp-acceptance.md) 记录验收结果并把检查映射到步骤，[docs/ketos/perf-baseline.md](../../../../docs/ketos/perf-baseline.md) 保存由 `.playwright-mcp/stage-20-mvp-acceptance/perf.mjs` 测得的 §II.4 预算：20 窗口下 60 FPS 级画布平移与缩放、窗口打开在 100 ms 内、一次手势后布局写入每秒至多一次、本地桩上首 token 在 400 ms 内、10 000 条记忆搜索在 20 ms 内、从报告工具的卡片出现在打开的任务会话到任务行读到 `done` 的 1 s 内任务状态（roster 轮询为 750 ms）、控制台与主机错误为零，以及干净的 WAL 关闭。

**分叉范围与命名：新包是 `packages/ketos/` 下的 `@ketos/<name>`，内部标识符保持 upstream。** 分叉包为私有、带 `@ketos/` 作用域并位于 `packages/ketos/` 分组；该分组被排除在发布成员之外，因此适用强制的 `private: true` 分支；当前成员是 `@ketos/client-locale-ru` 与 `@ketos/clone-core`。

**只有面向用户的界面带品牌。** 内部 `@deepseek-ai/*` 标识符、`DSH_*` 变量、profile 名、`dsh.*` 配置字段与会话格式保持 upstream（[改名边界](2026-09-13-ketos-rebranding-boundaries.zh.md)）；`ketos` 启动器、`ketos web:` 就绪行、`~/.ketos` 主目录与 web 品牌承载 Ketos。

**覆盖例外：四个具名的 `vitest.config.ts` 条目保留，验收复核确认而非移除它们。** 其中两个条目带 `MVP-fork coverage policy` 原因——`packages/client/ui-board/src/**`（看板 GUI）与 `packages/ketos/clone-*/src/**`（克隆领域）——另外两个是主机条件性排除，覆盖仅 Linux 的源文件 `packages/subprocess/subprocess-local/src/linux-execve.ts` 与 `packages/experimental/code-runtime-python/src/index.ts`：它们在非 Linux 主机上被排除，而 Linux 通道对两者继续设门禁。

**其他所有路径保持逐文件 100%，包括 `@ketos/client-locale-ru` 以及导入被排除树的宿主侧包。** ru 语言包是分叉已经为其正确性付出代价的唯一 Ketos 包，而分叉范围的笼统豁免会悄悄漏掉它。

**被豁免的树以具名行为测试套件取代百分比。** MVP 测试清单为它们命名：纯数学（`zoomTowardPointer`、snap、小地图投影）、持久化（CAS 设置、`user_version`、`clones.db` CRUD）、槽位与工具注册及释放、Fetch 路由边界（错误码、校验），以及记忆行为（remember → search → injection），并由访谈流程与自主任务的阶段套件扩展。例外覆盖已发布、已测试的行为：看板与克隆领域带有行为测试套件，而不是抛弃型代码，因此后 MVP 的改动会扩展行为测试，而不是悄悄删除例外。

**MVP 测试清单刻意排除每个 CSS 类的测试、每个状态的截图与缩放压力测试。** 验收场景会执行缩放与全屏状态，因此该排除去掉的是逐类覆盖，而不是那些状态。

**验收复核没有发现任何已发布状态不再支持的例外。** 新包默认进入逐文件门禁，离开它需要具名配置项与自己的 Agent Note；两个仅 Linux 条目是主机条件性的，而不是政策豁免。

**模型可见品牌：upstream 身份字符串保留（选项 0.7）。** harness 身份行与 web-surface 提示词保持 upstream 字面量，因此 `test:snapshot` 快照、会话格式与 upstream 兼容的提示词界面保持逐字节稳定。

**现成的 patch 层存在，但不在随附组合中应用。** [docs/ketos/model-identity.md](../../../../docs/ketos/model-identity.md) 命名 `docs/ketos/model-identity.patch.yml`，它设置 `includeHarnessIdentity: false` 与 Ketos `personaPrefix`；`pnpm dsh --profile web --patch docs/ketos/model-identity.patch.yml --dump-config` 证明该 overlay 可以组装，system-prompt 测试覆盖关闭身份路径。需要 Ketos persona 的部署自行应用该层；随附组合不应用。

**一项被接受的产品修正：看板的聊天面板列出每个已注册工区，包括空的。** 面板把会话归入工区列表的每个条目，因此通过选择器注册的文件夹立即获得自己的行，它的第一个聊天也从该行创建；隐藏没有可见聊天的工区不属于面板的行为。

**该修正使场景的「注册一个文件夹，然后创建它的第一个聊天」步骤成为可能。** 它是分叉在上游包中携带的少数行为变更之一，记录在此是为了让触及该列表的上游 merge 遇到分叉的期望，而不是悄悄把它回退。

**被推迟的工作留在 MVP 边界之外。** 周边容器与 Supervisor、组织库与知识隔离、Temporal 进程、PostgreSQL 库与集中审计、SSO/OIDC 与 MCP 网关，以及语义记忆搜索都被推迟，MVP 仍然是 `~/.ketos` 卷上的本地单用户 `web` profile。

**限制汇总文档是推迟清单的权威。** [docs/ketos/mvp-known-limitations.md](../../../../docs/ketos/mvp-known-limitations.md) 拥有完整清单，每个包的 Known Limitations 节拥有其领域的细节；本 note 记录边界，而不是清单。

## MVP 时接受的限制

以下每行是阶段清单记录的一项被接受的限制；MVP 有意发布这些边界。

- **阶段 0——模型可见品牌保持 upstream。** 在选项 0.7 下，harness 身份字符串仍是 upstream 字面量。
- **阶段 12——审批只在主面板回答。** 窗口会横幅提示待处理请求，但不渲染自己的回答界面。
- **阶段 13——cwd 保护仅告警。** 绕过标准注册路径创建的会话不经过该保护。
- **阶段 14——MVP 建议最多 20 个存活会话。** 实测十个同时流式窗口；超过 20 后共享传输与逐窗口订阅成为成本中心。
- **阶段 15——克隆 Fetch API 无代码生成、手工校验。** 克隆领域没有 Typert 代码生成，路由自行校验每个字段。
- **阶段 17——记忆搜索是词法的、记忆没有修订检查、`candidate` 不是隔离。** FTS5 无嵌入或语义搜索；编辑为最后写入者胜；候选标志是状态，不是隔离队列。
- **阶段 18——技能编辑只有重建 scope 才能到达存活 agent。** 已注册集合在 agent 生命周期内固定。
- **阶段 19——任务活在主机进程中、没有自动恢复，词汇是 `clone_tasks`。** 中断的任务对账为 `failed`；计划的 `tasks`/`task_*` 领域在 MVP 中不存在。

[docs/ketos/mvp-known-limitations.md](../../../../docs/ketos/mvp-known-limitations.md) 是这些限制的完整权威，并把每项事实链接到其所属包 README 或阶段报告。

## 考虑过的替代方案

- **为看板与克隆包保留逐文件 100%。** 否决：它会钉死分叉要重写的组件与持续增长的克隆文件，而 MVP 测试清单是行为性的——纯数学、持久化、路由边界、记忆——因此百分比会在每个阶段被重写，而不是描述行为。
- **为品牌一致性重命名内部 `@deepseek-ai/*` 标识符。** 否决：它与 upstream-sync 政策及[改名边界](2026-09-13-ketos-rebranding-boundaries.zh.md)中的禁止清单冲突；来自 upstream 的每次 merge 都会落进重命名 diff，而 SDK、Python runtime 与发布工具都解析 upstream 名称。
- **发布带品牌的模型可见身份。** 否决：它会破坏 `test:snapshot` 快照并把会话与提示词界面移离 upstream，而现成的 patch 层已经让部署获得 Ketos persona 且不触碰随附组合。
- **让聊天面板继续隐藏空工区。** 否决：没有可见聊天的已注册文件夹就不会有行，面板也就无法创建该文件夹的第一个聊天，而计划要求完整的工区列表。
- **只在阶段报告中记录 MVP 边界。** 否决：报告以阶段为范围，而边界比阶段周期活得更久——后 MVP 阶段读 Agent Note，而不是阶段 20 报告，来了解被接受了什么。

## 后果

分叉发布一个用户可见的 MVP，并带有已记录的狭窄偏离集：四个覆盖条目、一个被推迟的模型可见品牌决策、一项上游包行为修正，以及分叉命名范围。

被豁免的树依赖行为测试套件而不是百分比，因此套件之外的回归只能由验收运行捕获——三个审计阶段与性能测量是补偿信号，而不是单元套件。

upstream-sync 面保持很小：聊天面板列表是少数上游包行为变更之一，代价是一份需要持续保持 merge 的永久 diff。边界现在记录在一处，因此改变被豁免树、内部标识符或模型可见身份的后 MVP 阶段会同时更新本 note 与政策，而不是重新决定偏离。

这份记录为后 MVP 阶段提供起点：对克隆领域、看板或命名范围的改动，读一份 note 就能知道已被接受的偏离，而不必从阶段报告与包 README 重建它们。

## 相关

- [docs/ketos/mvp-e2e.md](../../../../docs/ketos/mvp-e2e.md) —— 验收场景与其机器检查。
- [docs/ketos/mvp-known-limitations.md](../../../../docs/ketos/mvp-known-limitations.md) —— MVP 限制汇总与推迟的子系统。
- [docs/ketos/perf-baseline.md](../../../../docs/ketos/perf-baseline.md) —— §II.4 预算表与阶段 20 的测量。
- [Ketos MVP 工程政策](../process/2026-09-15-ketos-mvp-engineering-policy.zh.md) —— 本 note 收束的覆盖例外与分叉范围。
- [Ketos 改名边界](2026-09-13-ketos-rebranding-boundaries.zh.md) —— 品牌切分与内部标识符政策。
- [docs/ketos/reports/stage-20-mvp-acceptance.md](../../../../docs/ketos/reports/stage-20-mvp-acceptance.md) —— 阶段 20 的判定与证据。
