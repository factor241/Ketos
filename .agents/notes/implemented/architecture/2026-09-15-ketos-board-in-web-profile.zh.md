# Agent Note: The Ketos board joins the web profile

Status: implemented

[English](2026-09-15-ketos-board-in-web-profile.md) | 中文

## Problem

`packages/client/ui-board` 已经交付了完整的空间画布——平移/缩放 store、窗口卡片、小地图、侧栏轨道与 Omnibox——但没有任何 profile 加载它：客户端 TypeScript 聚合引用了该包，而 `packages/bundle/web-app/cordis.patch.yml` 没有 `ui-board` 行，bundle 清单也没有声明依赖，因此浏览器永远收不到 `lib/client.js`。客户端模块路径是从源码到浏览器的唯一通路：`client/modules` 的 host 半部扫描带 `dsh.client` 的 Loader 行、以 `/plugins/<id>/client.js` 提供文件，shell 执行送达的工厂函数。缺少这两个注册面，看板就是死代码。

首次实机渲染还暴露了第二个独立缺陷：画布根节点为 `position: absolute; inset: 0`，其包含块解析为 shell frame——唯一的定位祖先——而不是 `main` 列，于是看板覆盖整个窗口并吞掉了侧栏的指针事件。

## Decision

看板通过普通客户端插件通路加载，三个注册面齐备：

- `tsconfig.client.json` 引用 `./packages/client/ui-board`（阶段 0 的类型检查聚合已加入）。
- `packages/bundle/web-app/cordis.patch.yml` 的浏览器名册行：`- id: ui-board` / `name: '@deepseek-ai/dsh-client-ui-board'`。
- `packages/bundle/web-app/package.json` 声明 `"@deepseek-ai/dsh-client-ui-board": "workspace:^"`；`verify-cordis-config` 对每个名册行都要求该依赖。

画布根节点按其 `main` 面板定尺：`DashboardCanvas` 根节点使用 `position: relative; width: 100%; height: 100%; overflow: hidden`，使 `inset: 0` 的子元素（变换后的内容层、侧栏轨道、Omnibox、小地图）以看板盒为包含块，并由该列的 `overflow: hidden` 裁切。这遵循 shell 对每个 `main` 占用者既有的约定（`ConversationRoot` 为 `position: relative; height: 100%`），而不是为一个消费者把 `ui-layout` 的中央列改成定位元素。

`tests/apply.client.spec.tsx` 在生产 `SlotTestRuntime` 上钉住注册行为：`main` 得到 `board` 占用者，`sidebar.panellist` 得到 `id: 'board'`，面板渲染画布，图标按 owner 给定尺寸渲染，行标签通过包字典解析出 `Board`/`看板`，销毁插件 fiber 后两条注册都被移除。

该包保留 MVP 覆盖豁免（`vitest.config.ts` 中的 `packages/client/ui-board/src/**`）：阶段 3–4 会重写这些组件，豁免在 MVP 验收时复核。

## Alternatives considered

- **保持画布以 shell frame 为定位基准。** 未采用：frame 跨越侧栏，画布会拦截所有侧栏指针事件——实机检查发现会话树上的 `document.elementFromPoint` 返回画布表面。看板是 `main` 面板，而不是无边框的全窗口表面。
- **在 `ui-layout` 中把中央列改成定位上下文。** 未采用：为一个消费者的假设去改动共享的 upstream 包；而 shell 约定已经让每个占用者拥有自己的定位、满高根节点。
- **现在就给看板一个 host 包（`@ketos/board`、`board.db`）。** 未采用：MVP 通过 settings 命名空间 `ui-board` 持久化布局（阶段 8）；第二个存储会在布局文档存在之前复制 settings 的 revision-CAS 方案。
- **既然有了注册测试，现在就取消整个 `ui-board` 覆盖豁免。** 未采用：该测试覆盖注册，而非阶段 3–4 会替换的画布与窗口组件；现在取消会把一次性 GUI 纳入闸门，而政策 note 已把复核点定在 MVP 验收。

## Consequences

看板走上与每个 upstream UI 插件相同的通路：`window.__DSH_BOOT__` 增加一行（含看板共 55 行），没有新机制，也没有 `dsh.client.external` 请求。面板经 `@ketos/client-locale-ru` 语料在 ru 界面显示为 `Доска`。画布填满 `main` 列（280–1200 px）且侧栏仍可点击，已通过 `pnpm ketos web` 实机验证。

该可见变化由 replay golden 钉住：`snapshots/web/lifecycle-chrome/{hero,plan-active}.expected.md` 增加 `Global panels / Board` 行，通过该场景的 `DSH_SNAPSHOT=refresh` 刷新，并在 `DSH_SNAPSHOT=replay` 下复验。

继续保留、本阶段不修复的已知限制：窗口卡片仍是静态占位，布局不持久化，滚轮缩放会打印 `Unable to preventDefault inside passive event listener invocation`，因为 `onWheel` 是 React 的 passive 监听器——手势层归阶段 5。`board.*` 槽位在阶段 3 注册进去之前仍是仅声明。

## Related

- [`docs/ketos/dev-loop.md`](../../../../docs/ketos/dev-loop.md) — 本阶段实践过的三个注册面与插件加载诊断。
- [`packages/client/AGENTS.md`](../../../../packages/client/AGENTS.md) — 这些注册面来源的新插件清单。
- [Ketos MVP engineering policy](../process/2026-09-15-ketos-mvp-engineering-policy.zh.md) — 看板的覆盖豁免与 MVP 测试清单。
