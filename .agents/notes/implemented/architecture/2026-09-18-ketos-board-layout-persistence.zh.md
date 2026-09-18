# Agent Note: 通过 ui-board settings 命名空间持久化看板布局

Status: implemented

[English](2026-09-18-ketos-board-layout-persistence.md) | 中文

## Problem

阶段 4–7 交付了看板的窗口模型、会话、聊天面板、全屏模式、手势与裁剪，但每次重启都会丢弃既有安排：`apply` 创建 store 时没有持久化键，`createBoardStore` 的选项存在却无人使用，而 `@deepseek-ai/dsh-client-ui-board` 的 host 半部只是一个空的 `apply()`。本阶段要求刷新或进程重启能恢复窗口与视口。布局是用户设置文档而不是会话数据，而设置领域已经提供 schema 校验、单调的命名空间修订版，以及客户端 Remote 面上的 compare-and-set 写入，因此本阶段不新增 wire 命名空间，也不新增 Typert 代码生成。约束：设置文件是单个带锁与原子替换的 YAML 文档，因此写入必须稀少而离散；浏览器不能把首帧渲染阻塞在设置往返上；被手工编辑或更旧的文档绝不能破坏看板；两个打开的标签页可能竞争。

## Decision

**持久布局就是 `ui-board` settings 命名空间。** `src/board-settings.ts` 拥有命名空间名、`version: 1`、恢复上限与 schemastery schema；host 半部通过 `ctx.inject(['settings'], (settingsCtx) => settingsCtx.settings.register(...))` 注册它，与 `ui-theme` 完全一样。schema 为每个字段提供默认值，因此没有用户分节时命名空间也能解析。文档携带 `panX`、`panY`、`zoom`、`windows[]`（`id`、`kind`、`bodyKind`、`ordinal`、可选的 `customTitle`、`x`、`y`、`width`、`height`、`zIndex`）、`bindings`（会话桥在离散事件——创建、重绑、关闭——上写入的窗口 → 会话映射，供阶段 9 恢复使用）、`windowOrder`、`activeWindowId` 以及聊天面板状态（`panelWindowId`、`panelCollapsed`、`panelWidth`、`panelGroupBy`、`panelOrderBy`）。布局捕获绝不包含 `bindings`：持久化层写入完整分节——捕获的布局加上桥的实时映射——因此映射能在每次布局手势之后保留，而窗口关闭后其配对会离开分节（`update` 会深度合并，无法删除它）。`viewportWidth/Height` 缺省，因为画布自行测量它们；`fullscreenWindowId` 缺省，因为全屏属于会话模态。可空身份以 `''` 传递，因为 schemastery 无法通过对象 schema 物化 `null` 默认值；`''` 表示没有窗口。

**一个 store 实例同时支撑渲染器与持久化层。** `apply` 构建 handle、创建一个实例，并把 `{ ...handle, create: () => instance }` 传给每个 `register` 调用，而持久化层直接作用于该实例。渲染器的 store 席位按 handle 为实例建键，否则会从同一个 handle 自行铸造出另一个实例，因此正是这个包装让组件看得见 `instance.actions.hydrate()`。

**首帧来自 localStorage 副本；服务器文档才是真源。** `client/board-persistence.ts` 在每次被接受的写入后把 `{ revision, layout }` 缓存到 `dsh.board.layout` 下，并在注册前同步采纳它，因此刷新会用上一次的安排作画，不会闪过空白画布。随后看板从共享的 settings describe 镜像（`ctx.settingsScope.describe()`）派生，该镜像是客户端唯一的 `settings.describe` 读取方：镜像订阅及其持有的快照自身不新增 wire 读取，因此启动 RPC 预算仍归 `ui-settings`，而镜像保持 `unavailable` 的非 loopback 页面既不采纳也不写入。一旦镜像持有就绪视图，`ui-board` 命名空间在携带用户分节时即被采纳；没有首帧缓存时，无论修订版如何都采纳该文档（它是该浏览器仅有的布局），有缓存时服务器领先则服务器胜出，而服务器修订版落后于缓存意味着某次写入丢失在防抖期间或拆卸过程中，因此把缓存文档推回。命名空间不存在或清理器拒绝该文档时，本地布局原地保留，且绝不从尚未写入的命名空间的 schema 默认值采纳布局，这正是缓存能跨重启存活的原因。

**写入经过防抖、串行化并检查修订版。** store 订阅在最后一次变更之后 600ms 安排一次写入，且从不早于上一次写入之后一秒。本阶段把频繁的平移/缩放与离散的窗口变更分开；交付的调度器对两者只保留一个防抖，因为对频繁一类而言暂停本身就是最终快照，而下限覆盖离散一类，因此可观察契约——手势暂停后写入一次，每秒绝不超过一次——无需两个定时器即可成立。flush 捕获文档，在它与上一份被接受的文档相等时跳过，并以镜像此刻持有的修订版调用 `ctx.remote.settings.update('ui-board', doc, revision)`。应答经 `acceptView` 折回，后者更新持有的修订版；`settings/conflict` 在冲突报告的 `actual` 修订版上恰好触发一次重试（该数字就是计划要求的重读，无需第二次 wire 往返），最后写入者胜出。被拒或失败的写入把布局留在 store 中，下一次变更会重试；没有任何失败路径会到达组件。

**每次读取都修复，而不是拒绝。** `client/board-layout.ts` 把 store 捕获为文档，`sanitizeBoardLayout()` 宽容地采纳已存值：没有 id、`kind`/`bodyKind` 未知或身份重复的窗口被丢弃，负尺寸先修复为其绝对值再修复为最小窗口，坐标、缩放与面板宽度被夹取，绘制顺序依据 `windowOrder` 重新归一，悬空的 `activeWindowId`/`panelWindowId` 变为无，缺少所属窗口的面板读作已关闭，超量文档保留最顶层的 50 个窗口。`captureBoardLayout` 应用同样的最顶层 50 个切片并丢弃没有窗口的 id，因此超出恢复上限的看板仍会持久化，schema 也绝不会拒绝超量写入。修复后的候选文档仍须满足 settings schema，看板才会采纳它；`version` 不为 1 的文档被忽略并给出警告：MVP 没有迁移，未来的版本从一块新看板开始。

**hydration 只搬运布局字段。** `hydrate` 动作写入已存字段并清除 `fullscreenWindowId`；测量得到的视口与瞬态交互状态（选择模式、排队的 composer 意图）留在运行中的会话里。localStorage 副本存储同一份文档，绝不存储 store 状态，因此没有任何瞬态字段能活过刷新。

接线：客户端 `inject` 列表新增 `settingsScope` 与 `remote.settings`；`@deepseek-ai/schemastery` 移入 `dependencies`（host 半部导入它），而 `@deepseek-ai/dsh-settings`、`@deepseek-ai/dsh-client-ui-settings` 与 `@deepseek-ai/dsh-api-remotes` 是仅开发期的类型来源，这正是 `verify-package-dependencies` 的要求。面板宽度边界与聊天面板的分组和排序枚举移入 `board-settings.ts`，因此 schema 拥有每个被恢复的值，且没有任何顶层客户端模块导入领域目录。

## Alternatives considered

- **把 `defineStore` 的 `persist` 选项当作缓存（先实现，随后移除）。** 它会持久化整个 `BoardState`，包括选择模式、排队的 composer 意图、视口盒与仅限会话的全屏 id——刷新后会复活检查器芯片或全屏帧——而且它不携带可与服务器比较的修订版。显式文档缓存存储的恰好是 wire 文档加上写入它时所依据的修订版。
- **私有的 `ctx.remote.settings.describe()` 读取（先实现，随后移除）。** 它重复了客户端唯一的 describe 读取方，给启动 RPC 预算新增了第三次 `settings.describe`，并绕过了 loopback 持久化政策：远程浏览器会读写操作者的 `ui-board` YAML 分节。从 `ctx.settingsScope.describe()` 派生则复用共享读取、其失效刷新，以及其写入应答折回。
- **使用绑定的 `settingsScope.bind({ namespace: 'ui-board' })` 作用域代替 describe 面。** 该作用域的快照本可以提供解码后的值与修订版，且无需额外读取，但它的写入路径（`set`/`unset`/`mutate`）在冲突时通过重载 Host 状态恢复，而不是重新应用该标签页的文档，而本阶段把「最后写入者胜出加一次重试」定为 MVP 政策。describe 面加上直接的 `remote.settings.update` 让该政策保持显式，同时仍共享读取与折回。
- **一个带 `board.db` 的 `@ketos/board` 包。** 由主计划推迟到 MVP 之后：布局只是一份小型用户设置文档，而设置 seam 已经在没有新包、新 wire 路由或 SQLite 生命周期的情况下提供校验、修订版与 CAS。
- **在每个平移与缩放帧上写入。** 否决：设置文件每次写入都要加锁并原子替换，而预算是每秒至多一次写入；防抖加上最小间隔还让手势在其暂停之后提交，而不是在暂停期间提交。
- **拒绝 schema 不喜欢的已存文档。** 否决：客户端值可能来自手工编辑的文档、更旧的版本或部分写入，而一个损坏的窗口不该让整个布局付出代价。修复加最终 schema 检查在保住不变量的同时保留健康的窗口。
- **使用带路径寻址操作的 `settings.mutate`。** MVP 中否决：文档很小，`update` 会把完整补丁合并到分节之上，而每个窗口一条路径只会增加簿记，却带不来体积上的好处。
- **冲突时合并重读的文档。** 否决：两个标签页对空间布局没有有意义的合并方式，计划把最后写入者胜出定为 MVP 政策，而重读正是让重试落地、而不是永远冲突的原因。
- **把会话存进布局文档。** 否决：会话身份属于桥（阶段 9 恢复绑定），设置文档必须保持 JSON 兼容且小，而每个从未拥有会话的窗口都必须保有相同的窗口状态。

## Consequences

刷新与进程重启现在会恢复窗口、其几何、绘制顺序、当前窗口、平移/缩放与聊天面板状态，而全新部署仍从空白开始。代价是：600ms 防抖窗口内的崩溃会丢失最后一次手势；两个标签页在冲突报告的修订版上归结为最后写入者；当另一个标签页在此期间写入时，localStorage 缓存可能有一帧显示陈旧布局（启动时的采纳会替换它）；恢复把文档限制在 50 个窗口并夹取坐标、缩放与面板宽度，超出限制的窗口被丢弃，而不是整个文档被拒；而且布局版本之间没有迁移，因此在迁移存在之前，未来的 `version: 2` 会从空白看板开始。看板现在还是 host 上的 settings 命名空间所有者：没有 settings 提供方时注册会等待，客户端仍从其缓存 hydrate，但无处写入。看板自身不新增 settings wire 读取，因此继承客户端的启动读取预算与 loopback 持久化政策，而不是复制它们。

验证：`tests/board-settings.client.spec.ts`（schema 接受、默认值、每一类拒绝）、`tests/board-host.client.spec.ts`（host 注册、写入校验、释放，以及没有提供方时的缺席）、`tests/board-layout.client.spec.ts`（20 个窗口的捕获往返、未知版本、缺少 id、重复、负尺寸、夹取范围、z 序重归一、50 窗口上限、面板规则）与 `tests/board-persistence.client.spec.ts`（缓存采纳、损坏缓存、服务器领先时的采纳与修订版复用、无缓存时同修订版的采纳、启动后镜像才应答时的采纳、服务器落后时的推回、清理器拒绝、镜像 `unavailable` 时静默、只读提供方、防抖合并、每秒一次的下限、捕获时的 50 窗口上限、冲突时在报告修订版上的重试、被拒与抛错的传输、释放、经面板 store 的共享实例 hydration，以及 remote 替身没有 describe 方法时的挂载）。

## Related

- [Board windows own Harness sessions and rebuild the chat composer](2026-09-16-ketos-board-window-sessions.zh.md) —— 将在阶段 9 重新绑定已恢复窗口的桥。
- [Board gestures, culling, and the window-manager budgets](2026-09-17-ketos-board-gestures-culling.zh.md) —— 恢复所复用的 store 缩放区间与插入夹取。
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.zh.md) —— 本决策更新的包行为与限制。
- 本阶段关闭的 Beads 记录：`ketos-5v2.9.1`（schema 与 host 注册）、`ketos-5v2.9.2`（启动读取与 hydration）、`ketos-5v2.9.3`（防抖 CAS 写入器）与 `ketos-5v2.9.4`（窗口恢复与版本策略）。
