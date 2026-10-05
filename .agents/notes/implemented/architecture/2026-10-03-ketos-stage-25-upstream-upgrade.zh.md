# Agent Note: Ketos stage 25: the core upgrade to dsh-v0.2.0-rc.2

Status: implemented

[English](2026-10-03-ketos-stage-25-upstream-upgrade.md) | 中文

## Problem

Ketos fork 停留在上游 0.1.5-rc.2 发布线加上阶段 1–24，无法用一次普通 merge 接收更新的发布：`main` 起于一个合成导入根，其树与上游基线提交相同，但与上游历史没有祖先关系，因此 `git merge <tag>` 找不到 merge base。上游在此期间切出了 0.2.0 的多个候选版本；看板、clone core 与俄语本地化从 66 个上游包导入，而另一端几乎每个文件都已改变。该发布还带有本 fork 消费的破坏性变更：会话日志格式 v3 → v4、包重命名（`agent-presets` → `agent-preset-registry`、`code-runtime` → `ptc-runtime`、`fs/tool-present` → `deliverables/tool-present`）、看板工具卡所读取的对话记录重做、新的桌面应用，以及默认开启的产品分析。OpenCode Go 订阅依赖一个上游没有的 fork 修改（`llm-pi-ai` 中的 `x-opencode-session` 头），试合并报告了 109 个冲突文件。

## Decision

**Р-1 —— 目标为 `dsh-v0.2.0-rc.2`。** 它是最接近稳定的候选切片；`dsh-v0.2.1-alpha.1`（多三个冲突）留待下一次普通同步。

**Р-2 —— 一次性本地根移植，此后普通 merge。** `git replace --graft` 把合成导入根接到上游基线提交，标签以 `--no-ff` 在 `stage-25-upstream-0.2.0-rc.2` 中合并，替换在合并提交后立即删除。替换从未进入远程；`main` 现在以标签提交为真正的 merge base，此后每次验收都是在 `sync/<tag>` 分支中的 `git merge --no-ff <tag>`。

**Р-3 —— 分析与遥测在 Ketos 配置中保持关闭。** `packages/bundle/web-app/cordis.patch.yml` 禁用 `desktop-product-telemetry` 并把 `product-analytics` 设为 `enabled: false`；重写后的 `packages/bundle/web-app/tests/product-analytics.spec.ts` 为 `desktop` 与 `web` 两个配置固定该策略，并断言两个服务都不激活。

**Р-4 —— 不构建也不改品牌 `apps/desktop`。** Ketos 仍是 web 产品；Electron 应用归上游维护。

**Р-5 —— DeepSeek 账号按上游原样挂载，但在 web 配置中不生效。** 在 `desktop` 配置之外 `deepseek-account-platform` 拿到 `desktopPlatform: null`，客户端一半在没有 `globalThis.dshDesktop` 时退出 `apply`，因此账号页面与 RPC 在 Ketos web 中永不激活；登录通过 provider 完成，包括 OpenCode Go。

**Р-6 —— 所有新 UI 键都已翻译。** `@ketos/client-locale-ru` 从 44 个命名空间、2,472 个键扩展到 58 个命名空间，覆盖新设置页、侧栏页签、插件管理器与快捷键。

**Р-7 —— 该升级是阶段 25。** 它与阶段 1–24 一样被规划、跟踪与验收。

**Fork 修改的归宿。** 在新上游代码上迁移：`llm-pi-ai` 中的 `x-opencode-session`（最先，连同其 `opencode-go` adapter 测试）、`selectModel` 中的 `keepDefault`、经 `PopoverHost` 的提示与菜单 portal、`StateDot` 的 reduced-motion 规则、公开的 `SessionInput.addFiles`/`takeDraft` 与 `conversation.session.header.blank` 槽位、`sidebar.brand.actions`、`ILayout.declarePanelSidebar` 与 `blockPagePinchZoom`。自动合并保留：拒绝 `$DSH_HOME`/`~/.ketos`/`~/.dsh` 的 `workspace/invalid-path`、`@ketos/*` 客户端 bundle 纯净分支，以及无密钥 E2E 警告式 preflight。因上游或 fork 不再需要而退役：`vendor/hmr` 的 `registerConfig` 轮询（该场景由 `boot/hmr` 的 `watch-config` 承担）、`ui-sidebar-right` 的本地全屏图标（上游替换了 artwork）、`prepare-ci-bubblewrap.sh` 中的 Launchpad 地址（上游固定了永久 build URL），以及 `ISessions.openStream`——它被上游的所有权语义取代：看板现在用 `retain(sessionId, { source: 'boardWindow' })` 保留每个窗口会话并在解绑时释放，因此恢复布局绝不改变应用的当前会话。

**会话数据。** v3 → v4 迁移是邻接式：打开已存储的 v3 会话会新增 `session.v4.jsonl.zstd` 后继，而已提交的 v3 世代字节不变；`clones.db` 不受影响。

**首次在真实数据上运行。** `SettingsForms.importLegacyDocument` 在第一次写入前把 `~/.ketos/settings.yaml` 重命名为 `settings.yaml.imported`，并把每个 section 导入活动配置的 `cordis.patch.yml`（web 是 Ketos 唯一构建的配置）；配置补丁成为事实来源，被重命名的文件保留为升级前快照。过渡流程与回滚见 [`docs/ketos/upstream-sync.md`](../../../../docs/ketos/upstream-sync.md)。

**Stand 规则。** 对存储数据运行的所有 stand 与测试都使用临时 `DSH_HOME`，并以 `test -n "$DSH_HOME" && [ "$DSH_HOME" != "$HOME/.ketos" ] || exit 1` 防护。本阶段一次漏掉 `DSH_HOME` 的 stand 运行重写了 `~/.ketos/profiles/web/cordis.yml` 与 `cordis.patch.yml`；两个文件已从阶段归档恢复，没有任何会话、`clones.db` 或 storage 文件受影响。

## Alternatives considered

**把升级作为快照导入。** 将 `git diff <base> <tag>` 作为一个提交应用比解决 109 个冲突简单，但 `main` 不会得到上游历史，之后每个发布都需要再次手工构造基线。失去：来源可溯与一条命令的未来同步。

**以 `dsh-v0.2.1-alpha.1` 为目标。** 新四天、多三个冲突，但那是仍在移动的 alpha 分支；候选版本是贴近稳定的切片。

**从配置中删除分析与遥测行。** 删除包会从树中移除上游拥有的代码并失去一行可逆性；`enabled: false` 与 `disabled: true` 让包保持可加载，由策略测试固定该选择。

**在 web 配置中关闭 DeepSeek 账号行。** 第一次尝试删除这些行，破坏了包自身的基于 Loader 的测试（27 个 host 测试、9 个 web 场景），它们预期这些行存在；上游的桌面门槛已让账号在 `desktop` 之外不生效，这正是 Ketos 需要的隔离。

**现在就为 `apps/desktop` 改品牌并构建。** 桌面应用不是 Ketos 产品；为它改品牌等于承诺维护第二个客户端。

**把新 UI 包排除在俄语本地化之外。** 本地化门禁会按设计失败，用户会看到英文；翻译这些键是要求。

## Consequences

`main` 通过合并提交获得真实的上游历史：上游提交可经祖先遍历到达，之后的发布一条命令即可合并，合成根作为历史残留留在下方。一次性代价是解决 109 个冲突、重新裁决 17 处 fork 修改、重新生成目录与翻译对，以及刷新 web 金样。看板与 clone core 运行在 v4 对话记录与自有窗口会话上；OpenCode Go 通过迁移的头发送（adapter 测试加实机轮次）；分析与遥测在所有 Ketos 配置中关闭；账号界面按上游存在，但在桌面之外无法激活。两个已知非回归：`plugin-install-github`（两个场景）在干净的上游检出上也会因宿主机的 Git/GitHub 访问失败，`readProcessStart` 的 macOS 逐文件覆盖率缺口由 Linux CI 通道补上。验证：`pnpm run typecheck`、`lint`、`test:gui`（644 个文件，10,219 通过，0 失败）、`DSH_SNAPSHOT=replay pnpm run test:web`（635 通过，2 个已知失败）、`board-geometry.e2e.ts` 35/35、`doc-sync` 43/43、`hygiene` 18/18、`build`、`check:ci:coverage`，以及 OpenCode Go 实机轮次；阶段报告与 CI 证据在 [`docs/ketos/reports/stage-25-upstream-upgrade.md`](../../../../docs/ketos/reports/stage-25-upstream-upgrade.md)。

## Related

- [`docs/ketos/upstream-sync.md`](../../../../docs/ketos/upstream-sync.md) —— 基线标签、合并流程，以及带逐条验证的 fork 修改账本。
- [`docs/ketos/reports/stage-25-upstream-upgrade.md`](../../../../docs/ketos/reports/stage-25-upstream-upgrade.md) —— 阶段报告：门禁数字、冲突清单与数据检查。
- [Ketos 仓库主目录与阶段 worktree](../process/2026-09-14-ketos-repository-and-stage-worktrees.zh.md) —— 本次升级所推进的仓库布局与 worktree 政策。
