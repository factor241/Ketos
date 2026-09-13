# Agent Note: Ketos rebranding boundaries

Status: implemented

[English](2026-09-13-ketos-rebranding-boundaries.md) | 中文

## Problem

该仓库以 DeepSeek Harness 软分叉的形式启动，并以另一个产品名对外发布：面向用户的界面显示“DeepSeek Harness”，启动器命令只有 `dsh`，数据落在 `~/.dsh`，且分叉自有包没有命名空间。重命名内部标识符（`@deepseek-ai/*`、`DSH_*`、profile 名称、会话格式）会破坏与 upstream 的可合并性；不带品牌发布又会误导用户。分叉需要一份书面边界：哪些面向用户、哪些保持内部，并为两个方向提供执行力机制。

## Decision

产品与界面承担 Ketos 品牌；每个内部标识符保留 upstream 名称。切分同时落地：

- **启动器。** `ketos` 加入 bin 映射（根脚本 `pnpm ketos`、`apps/cli` bin 别名、`verify-application-entrypoints` 白名单）作为与 `dsh` 相同入口 `lib/bin.js` 的别名；`package.json` 同时拥有 `dsh` 与 `ketos` 脚本。面向用户的 CLI 字符串输出 `ketos`（`Usage: ketos …`、`ketos: boot a Ketos profile`、headless/sdk-app/web-app 帮助、`NAME = 'ketos'` 诊断、`app-boot` profile 错误字面量）。`dsh` bin 继续存在，因为 SDK 解析器、`verify-application-entrypoints` 与 Python runtime 都会解析它。
- **就绪协议。** 服务启动行为 `ketos web: <url>`；所有解析型消费者——bundle 测试、CLI e2e 夹具与期望、`publish-npm-baseline`、headless stderr 片段、会话快照——在同一次提交中迁移。`dsh web:` 不再是有效的就绪前缀，而 ACP profile 帮助（`Usage: dsh --profile acp`）保持 `dsh`，因为 ACP 保留 upstream 客户端名称。
- **容器 home。** `apps/cli/src/bin.ts` 在 boot 解析任何路径之前设置 `process.env.DSH_HOME ??= join(homedir(), '.ketos')`；变量名 `DSH_HOME` 与 `resolveDshHome` 的内部默认 `~/.dsh` 永不改变。
- **包面。** `@ketos/<name>` 是 `packages/ketos/` 下分叉专属的 scope：workspace 约束的 release-member 正则在 `experimental/` 旁排除该组，使成员落入强制 `private: true` 分支；该组豁免子系统页面；其 README 仍遵循常规双语对契约。首个成员：`@ketos/client-locale-ru`。
- **Locale。** ru 语言包以回退 `en` 注册 `ru`，翻译完整的 Ketos UI 词典——社区 [`deepseek-harness-locale-ru`](https://github.com/warment/deepseek-harness-locale-ru) 包（MIT，随 `LICENSE-locale-ru` 中的声明一并引入），已改名为 Ketos 并补齐 Ketos 语料新增的键，加上 `common` 与 `board`（44 个命名空间）——并且仅在 durable `locale` 设置快照解析为没有已存 `preference`、且浏览器本身请求带 `ru` 标签的语言时应用 `setLocale('ru')`，因此随附 `zh`/`en` 回退契约与显式 en 在 disposal 与重新应用后依然保持。词典由 `packages/ketos/client-locale-ru/scripts/sync-dictionaries.mjs` 从社区包、fork 语料与改名/补缺覆盖项生成；包测试按生成的 `tests/fixtures/ru-keys.json` 清单校验覆盖率。web bundle 补丁重述权限预设表，因为基座行只带机器 id。
- **Web 品牌。** 官方构建标题 `Ketos`（Vite 本地默认 `Ketos Local Build`）、PWA 清单 `Ketos`/`KETOS`、Ketos favicon 图形、启动页 `KETOS`、Ketos onboarding 文案并提升 notice 版本。所有构建 profile 的侧栏标志都是产品方提供的 512×512 PNG，以 data URI 原样内嵌于 `ui-brand-official`；`KetosWordmark` 字母标志仅在 `official` 构建中替换 `brand.localBuild` 标签，ru 标签为 `Кетос`。会话首屏不显示标志：它用移植的 React Bits `FoldText` 折叠动画展示来自 `hero.headlines` 短语池的轮换短语（每分钟一条、随机挑选），并移除了 upstream 的预览徽章。`ui-primitives` 导出（`FishLogo`、hero 鱼形）保持 upstream，但不再在首屏渲染。
- **模型可见文本（暂缓）。** harness 身份行、web-surface 提示词与 cordis preset persona 保留 upstream 措辞；需要 Ketos persona 的部署使用用户 patch 层（`includeHarnessIdentity: false` + `personaPrefix`，记录于 `docs/ketos/model-identity.md`，并作为 `docs/ketos/model-identity.patch.yml` 随仓库提供）。一个在阶段 0.3 范围内例外落地：401 web-auth 正文命名为 `ketos web`，因为该文本会直接到达浏览器。

`docs/ketos/` 拥有分叉侧的清单与决策：`brand-inventory.md`（分类与可复现 grep）、`upstream-sync.md`（按标签的验收）、`model-identity.md`（暂缓选择与 patch 路线）。语料预设将 `docs/ketos/` 排除在 translation-pairing 范围之外，因为这些文档按构造就是分叉的俄语规划材料。

执行是机械化的：`verify-application-entrypoints` 钉住 bin 映射；约束闸门钉住组隐私；`pwa-manifest.e2e.ts`、`built-boot.expected.e2e.ts`、`boot-page.client.spec.ts`、`client-build-environment.client.spec.ts`、`dev-web.spec.ts`、`release/families.spec.ts` 钉住 web 字面量；CLI e2e 钉住 `ketos web:`；`verify-package-paths` 与 `brand-inventory.md` 中的残留品牌 grep 支撑评审清单。

## Alternatives considered

**把内部标识符重命名为 `ketos` 命名空间。** 未采用：分叉会升级 upstream，重命名会进入每次 merge；SDK、Python runtime 与发布工具都解析 `dsh`，因此破坏半径是整个仓库而用户可见收益为零。

**立即发布模型可见身份改写。** 未采用：31 个 `system-prompt.expected.md` sidecar、39 个提及品牌的快照与 9 个钉住 spec/e2e 文件会一次性改变；安全路径（配置级关闭开关加 persona patch）已在仓库内存在（`sdk-minimal/cordis.patch.yml`），并且无需触碰 shipped 组合即可由用户调整。

**公开发布 `@ketos/*`。** 未采用：分叉继承 upstream 身份约束，而该组是软分叉内部消费者；`private: true` 让发布闸门保持诚实。

**通过重命名 `dsh` bin 来实现品牌。** 未采用：就绪解析、入口点校验与 Python-runtime 安装都钉住 `dsh`；别名方案在增加品牌的同时不破坏解析器。

## Consequences

来自 upstream 的 merge 集中于已知文件集（记录在 `docs/ketos/upstream-sync.md`；品牌字面量与 upstream 编辑相遇处仍会产生冲突）。新的 upstream 界面在分类之前不带品牌——清单与评审清单是扩展纪律，而非自动化。Ketos 网页标题改变了发布校验常量，因此每次标题变动时官方环境检查与 `families.ts` 一起移动。上次语料提取之后由 upstream 新增的客户端键仍会通过已记录的退化链以英文渲染，直到重新同步语言包（语言包的已知限制，连同提取与再生成流程记录在其 README）。Desktop/Electron 用户界面已在 `brand-inventory.md` 中分类，并随 post-MVP 桌面应用一并暂缓；MVP 只发布 web profile。

## Related

- `docs/ketos/brand-inventory.md` — 每次品牌重塑提交都必须保持干净的分类与 grep 清单。
- `docs/ketos/upstream-sync.md` — remotes、标签、merge 流程。
- `docs/ketos/model-identity.md` — 暂缓的模型可见决策与 patch 层路线。
- [single `dsh` application launcher](2026-08-22-single-dsh-application-launcher.zh.md) — 本 note 以 `ketos` bin 别名扩展的启动器决策。
- [mandatory app attribution headers](2026-06-21-mandatory-app-attribution-headers.zh.md) — 在该边界下保持 upstream 的 wire 归因令牌。
