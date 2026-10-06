# Agent Note: 看板窗口的归属与访问

Status: implemented

[English](2026-10-06-ketos-board-window-ownership.md) | 中文

## Problem

看板窗口此前既没有所有者也没有访问设置：存储的窗口只携带几何、面板与克隆标识，看板把每个窗口都显示为匿名的，布局中也没有记录窗口属于谁、还有谁可以使用它的位置。10 月 16 日的演示需要可见的归属——每个窗口上的颜色与名字，以及把窗口移交给另一位参与者的方式——但不能引入多人逻辑：目前没有账号、没有并发编辑者，也没有名册服务。真实参与者名册随阶段 32 到来，共享看板随阶段 33 到来，因此归属的表示与解析必须能在它们到来时不作改动。

## Decision

**所有者与访问是持久化布局字段。** `board-settings.ts` 为每个存储的窗口新增 `ownerId`——`z.string().default('')`，空字符串表示当前参与者，修复会在布局进入 store 之前解析它——以及一条 `access` 记录 `{ mode: 'owner' | 'selected' | 'all', people: string[] }`，默认仅所有者、列表为空（`BOARD_ACCESS_MODES` 与 `BOARD_ACCESS_MAX_PEOPLE` 界定模式联合与列表上限）。`BOARD_SETTINGS_VERSION` 保持 1：这些默认值是追加式的，因此在归属出现之前保存的 version-1 文档仍可解析，读回时为当前参与者所有、仅自己可见；提升版本会丢弃每一份已存布局。

**修复只校验格式，绝不校验成员资格。** `sanitizeWindowAccess(raw, ownerId)` 保留格式良好的所有者 id（`isOwnerIdFormat`：非空、至多 `OWNER_ID_MAX_LENGTH` 个字符、不含控制字符），丢弃重复项与所有者本人，并在 `BOARD_ACCESS_MAX_PEOPLE` 处停止；未知模式回退为 `'owner'`。它刻意不检查 `boardParticipants`，因为真实名册在阶段 32 才异步到达，成员资格检查会在名册缺席期间抹掉已存的人员；名册不认识的 id 保持中性色板与「未知参与者」标签。

**`owners.ts` 是唯一的参与者来源。** 该模块持有 `OwnerId`、演示团队（`DEMO_TEAM` 与 `DEMO_SELF_ID`，颜色 1–4）、`currentOwnerId(state)`、`boardParticipants(state)`、`participantOf`、`ownerColorAttr`、`participantLabel`、`participantInitial`、`isOwnerIdFormat` 与 `sanitizeWindowAccess`。消费者只读取这些选择器，绝不读取演示常量，因此阶段 28 与 32 可以在不触碰任何组件的情况下替换其来源；`canManageWindow(state, window)` 是管理谓词（所有者等于当前参与者；阶段 33 追加「窗口位于本机」），store 中的移交与访问动作只在它成立时执行。

**颜色是由一个根属性选中的令牌。** `BoardViews.module.css` 在看板 `.root` 上声明 22 个自定义属性——`--board-owner-{1..10,unknown}-{edge,fill}`——并由暗色规则重新绑定同名变量，`.root [data-board-owner-color='N']` 把窗口根节点的属性映射到 `--board-owner-edge`/`--board-owner-fill`。组件只用这两个别名着色，不写任何字面颜色；未解析的 id 携带 `"unknown"`。

**bezel 是 `WindowFrame` 的子层。** `WindowBezel.tsx` 渲染在窗口表面之下（z-index -2，位于外框主题填充之后），承载 `OwnerBadge` 与 `AccessIndicator`；管理者在同一位置得到 `OwnerTransferMenu` 与 `AccessMenu`，其他人看到普通说明文字。因为它是外框的子节点，所以随窗口移动、调整大小并缩放，无需看板侧的同步。外框 `::before` 上的 2px 所有者边缘始终可见；bezel 在悬停、焦点进入或选中时以 `var(--ds-transition-duration)` 滑出，减少动态效果时取消过渡，打开的面板会让条带在其所在的一侧让位，低于 `detailZoomThreshold` 的 `simplified` 模式只渲染边缘。

**移交与访问仅限所有者、原地写入。** `transferWindow(id, ownerId)` 设置窗口的所有者，保持窗口的位置与 agent 不变，并把新所有者从 `people` 中移除；前所有者的 `canManageWindow` 随之返回 false，因此被移交的窗口对他们只显示普通说明文字，也没有回退途径。`setWindowAccess(id, access)` 在 `owner`/`selected`/`all` 模式切换之间保留 `people` 列表（菜单在切换模式时传入已存列表，并一次切换一个人），因此回到 `selected` 时仍是同一批人。

## Alternatives considered

- **在画布之上的独立看板层渲染 bezel。** 否决：该层必须在每次看板与窗口变化时重新同步窗口的平移/缩放几何，而外框的子节点天然获得放置、缩放与裁剪。
- **在修复期间校验名册成员资格。** 否决：名册在阶段 32 才异步到达，因此在它落地之前读取的文档会把真实人员从每个窗口中抹掉；未知 id 降级为中性色与「未知参与者」。
- **为新字段提升 `BOARD_SETTINGS_VERSION`。** 否决：版本提升会丢弃每一份已存布局，而追加式 schema 默认值无需迁移路径即可隐式迁移旧文档。
- **在组件中直接写所有者字面颜色。** 否决：色板属于主题表面；`.root` 中的 22 个令牌加 `data-board-owner-color` 属性让组件不含字面颜色，并让一条规则同时服务两种明暗方案。

## Consequences

旧布局读回时为当前参与者所有、仅自己可见，因此升级后的首次打开会把所有既有窗口显示在当前参与者名下，无需迁移。被移交的窗口确实离开前参与者：在后续阶段把窗口交回或按克隆移交 agent 之前，他们既不能把它移回、更改其访问，也不能再次移交。演示团队是临时数据——名字与颜色来自 `DEMO_TEAM`，也不存在修改所有者颜色的界面——而接入真实参与者的唯一替换点是 `owners.ts`，阶段 28/32 在其选择器背后替换来源。未知 id 路径是刻意的降级而非修复：窗口仍可用可见，但其所有者会一直显示中性色板，直到名册认识该 id。

## Testing

`packages/client/ui-board/tests/owners.client.spec.ts` 覆盖名册、所有者解析、标签回退、id 格式与访问修复（重复、所有者本人、上限、未知模式）；`board-settings.client.spec.ts` 覆盖 schema 默认值与边界；`board-layout.client.spec.ts` 覆盖把旧文档完整修复为当前参与者所有、仅自己可见。`window-bezel.client.spec.tsx` 覆盖外框的所有者颜色与管理属性、简化模式只留边缘的切换、面板侧属性、徽章与访问说明文字、三种访问模式及保留的 people 列表、原地移交，以及当前参与者无法管理的窗口上无菜单的说明文字。`apps/web/tests/board-bezel.e2e.ts` 驱动组装后的看板。

## Related

- [看板布局的持久化](2026-09-18-ketos-board-layout-persistence.zh.md) —— 本记录扩展其窗口条目的 `ui-board` settings 文档与版本。
- [看板输入与浮层](2026-09-25-ketos-board-input-and-popover-layer.zh.md) —— 同一阶段的姊妹记录，bezel 的菜单经由它的看板浮层 portal。
- [看板手势、裁剪与窗口管理器预算](2026-09-17-ketos-board-gestures-culling.zh.md) —— bezel 只渲染边缘的规则所遵循的 `detailZoomThreshold` 简化模式。
