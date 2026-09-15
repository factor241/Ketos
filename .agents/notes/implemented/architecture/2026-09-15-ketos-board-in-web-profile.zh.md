# Agent Note: The Ketos board joins the web profile

Status: implemented

[English](2026-09-15-ketos-board-in-web-profile.md) | 中文

## Problem

`packages/client/ui-board` 已经交付了完整的空间画布——平移/缩放 store、窗口卡片、小地图、侧栏轨道与 Omnibox——但没有任何 profile 加载它：客户端 TypeScript 聚合引用了该包，而 `packages/bundle/web-app/cordis.patch.yml` 没有 `ui-board` 行，bundle 清单也没有声明依赖，因此浏览器永远收不到 `lib/client.js`。客户端模块路径是从源码到浏览器的唯一通路：`client/modules` 的 host 半部扫描带 `dsh.client` 的 Loader 行、以 `/plugins/<id>/client.js` 提供文件，shell 执行送达的工厂函数。缺少这两个注册面，看板就是死代码。

首次实机渲染还暴露了第二个独立缺陷：画布根节点为 `position: absolute; inset: 0`，其包含块解析为 shell frame——唯一的定位祖先——而不是 `main` 列，于是看板覆盖整个窗口并吞掉了侧栏的指针事件。

## Decision

看板通过普通客户端插件通路加载，三个注册面齐备：

- `tsconfig.client.json` 引用 `./packages/client/ui-board`（第 107 行）。
- `packages/bundle/web-app/cordis.patch.yml` 的浏览器名册行：`- id: ui-board` / `name: '@deepseek-ai/dsh-client-ui-board'`。
- `packages/bundle/web-app/package.json` 声明 `"@deepseek-ai/dsh-client-ui-board": "workspace:^"`；`verify-cordis-config` 对每个名册行都要求该依赖。

画布根节点按其 `main` 面板定尺：`DashboardCanvas` 根节点使用 `position: relative; width: 100%; height: 100%; overflow: hidden`，使绝对定位的子元素（变换后的内容层、侧栏轨道、Omnibox、小地图）以看板盒为包含块，并由该列的 `overflow: hidden` 裁切看板。同一条声明还让看板成为其自身覆盖层的包含块，而这正是它们被约束住的真正原因——当包含块是 frame 时，frame 的裁切并不生效。这遵循唯一既有 `main` 占用者的做法（`ConversationRoot` 为 `position: relative; height: 100%`），而不是为单个消费者把 `ui-layout` 的中央列改成定位元素。

看板只声明它读取的 Cordis 服务——`slots` 与 `locale`——不再等待 `layout`：`ctx.layout.selectPanel(id)` 是侧栏外壳的调用，而不是看板的。`dsh.client.inject` 清单保留信息性的 `ui-layout` 边，因为看板注册进去的 `main` 声明属于该包。

`tests/apply.client.spec.tsx` 在生产 `SlotTestRuntime` 上钉住注册行为：两条占用者及其元数据（`order` 15、声明的 `locale`、store 句柄、无 `children`），面板尺寸的画布盒与按 owner 给定尺寸渲染的图标，行标签通过包字典解析出 `Board`/`看板`，销毁时移除条目及其 DOM 而 frame 持有的声明保留，以及延迟路径——看板先于槽位声明应用，并在声明到达时完成注册。`tests/roster.client.spec.ts` 补上 real-composition 层：web-app bundle 名册必须声明该行（`webApp.closure`），且通过 `createClientTest` 启动该名册必须产生两条占用者——正是会在缺少 `cordis.patch.yml` 行时失败的检查。

接线令两个死面变为在线，因此移除而不是保留：`src/client/tokens.css`——一个全局 `:root` 表，其 33 个 `--board-*` 属性没有任何读取者，且构建工具在启动时把它注入 `document.head`——被删除；omnibox 与操作菜单中的四个 `alert()` 占位成为 no-op，因为一个为并未发生的发送报告 "Message sent" 的阻塞对话框比无响应控件更糟。两条限制都记录在包 README 中。

该包保留 MVP 覆盖豁免（`vitest.config.ts` 中的 `packages/client/ui-board/src/**`，依据 [Ketos MVP 工程政策](../process/2026-09-15-ketos-mvp-engineering-policy.zh.md)）：注册测试不会抬升后续看板阶段要重写的组件的逐文件覆盖。

## Alternatives considered

- **保持画布以 shell frame 为定位基准。** 未采用：frame 跨越侧栏，画布会拦截所有侧栏指针事件——看板打开时会话树无法触达。看板是 `main` 面板，而不是无边框的全窗口表面。
- **在 `ui-layout` 中把中央列改成定位上下文。** 未采用：为一个消费者的假设去改动共享的 upstream 包；而 shell 约定已经让每个占用者拥有自己的定位、满高根节点。
- **因为面板是经 layout 服务选中的，所以保留 `layout` 服务边。** 未采用：选中是侧栏的调用，而非看板的；一条 contribution 从不读取的必需服务边会延迟激活，并绕过 `slots.inject` 本应服务的延迟注册路径。
- **在配色迁移之前保留 `tokens.css`。** 未采用：其属性无人消费，删除不改变行为；而该表的全局 `:root` 写入与构建注入的 `<style>` 都没有生命周期归属。
- **现在就给看板一个 host 包（`@ketos/board`、`board.db`）。** 未采用：MVP 通过 settings 命名空间 `ui-board` 持久化布局；第二个存储会在布局文档存在之前复制 settings 的 revision-CAS 方案。

## Consequences

看板走上与每个 upstream UI 插件相同的通路：`ui-board` 行随 `window.__DSH_BOOT__` 下发，没有新机制，包也不发起 `dsh.client.external` 请求。面板经 `@ketos/client-locale-ru` 语料在 ru 界面显示为 `Доска`，画布填满 `main` 列且侧栏保留其指针事件。

该可见变化由 replay golden 钉住：`snapshots/web/lifecycle-chrome/{hero,plan-active}.expected.md` 携带 `Global panels / Board` 行。

继续保留、本处不修复的已知限制：窗口卡片仍是静态占位，布局不持久化，滚轮缩放会打印 `Unable to preventDefault inside passive event listener invocation`，因为 `onWheel` 是 React 的 passive 监听器（登记为 `ketos-3kf`，归视口手势工作），`board.*` 槽位在组合工作注册进去之前仍是仅声明。

## Related

- [`docs/ketos/dev-loop.md`](../../../../docs/ketos/dev-loop.md) — 本次改动实践过的三个注册面与插件加载诊断。
- [`packages/client/AGENTS.md`](../../../../packages/client/AGENTS.md) — 这些注册面来源的新插件清单。
- [Ketos MVP engineering policy](../process/2026-09-15-ketos-mvp-engineering-policy.zh.md) — 看板的覆盖豁免与 MVP 测试清单。
