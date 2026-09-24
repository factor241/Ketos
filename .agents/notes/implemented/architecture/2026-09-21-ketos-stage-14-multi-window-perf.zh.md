# Agent Note: 看板窗口如实报告上下文占用，在十个活动会话下保持状态，并释放每个窗口的资源

Status: implemented

[English](2026-09-21-ketos-stage-14-multi-window-perf.md) | 中文

## Problem

看板已能同时打开许多窗口，但没有任何证据证明它能承载十个活动会话而互不干扰；同时，窗口 composer 的上下文圆环只显示一个孤立的百分比，既没有状态也没有数值：窗口在提供方首次报告之前什么都不渲染，也没有任何东西区分一个宽裕的会话与一个即将溢出模型窗口的会话。本阶段还必须确认长期使用看板不会累积订阅、桥记录或定时器，并如实写明 MVP 对同时打开聊天数的限制。

## Decision

**圆环的占用换算收敛为一个由桥与 composer 共用的纯模块。** `client/context-ring.ts` 拥有 `contextFigures(pressure)`——`min(100, round(used / window * 100))`，其中 `used = projectedTokens ?? pressureTokens`，与 ui-conversation 的 `contextOccupancy` 完全一致——会话桥改为发布它的结果，而不再内联计算。圆环的状态阶梯为 `empty`（提供方尚未给出数字）、`normal`、超过 80% 的 `warning` 与超过 95% 的 `critical`；`contextRingState` 与 `contextReading` 都是纯函数，测试在十种压力组合上把 `contextFigures` 与对话包的参考函数逐一比对，因此两个表面的口径不会漂移。

**圆环在任何状态下都保留自己的位置。** 会话已存在但尚无首次报告的窗口同样渲染圆环：圆弧为空、文本为本地化的 `—`、提示为空态文案。有读数时按本地化模板渲染 `% · used / window`，单位取看板字典里的紧凑 K/M；警告与严重状态同时给圆弧和百分比上色。空态、警告与严重三态已在真实浏览器中沿真实投影路径验证，令牌数由桩提供方报告（0% → `normal`，85% → `warning`，96% → `critical`，未提问的窗口 → `empty`）。

**十个活动会话是实测而非假定。** Playwright 审计（`.playwright-mcp/stage-14-multi-window-perf/audit.mjs`）驱动真实 Web 服务，模型侧指向本地 OpenAI 兼容的桩提供方（`stub-model-server.mjs`，经 `DEEPSEEK_BASE_URL` 接入）：十个 agent 窗口、五路带各自标记的并发流，画布平移与缩放用 `requestAnimationFrame` 计数器、`worstFrameMs` 与 `longtask` 观察者测量。记录结果为：平移与缩放 59.8–60.1 FPS，最差帧 30.8–33.7 毫秒，新窗口 DOM 节点插入 30.6–49.0 毫秒，长任务 0，控制台与宿主日志错误 0，五路请求全部得到回答且无串扰。数字记录在 `docs/ketos/perf-baseline.md`；jsdom 压力测试只断言行为，因为 jsdom 没有合成器。

**每个异步落定点都会重新核对窗口记录的归属。** 共享的 `owns(record, windowId, sessionId)` 守卫覆盖创建、新建聊天、分支与模型目录加载：窗口在调用途中被关闭或重绑时，既不会发布结果，也不会重建自己留下的记录。模型目录这条路径过去会在窗口关闭后目录加载失败时重建已释放的记录；现在有测试打开窗口、释放它、再让加载失败，并断言桥不持有任何记录、死通道保持冻结。

**窗口资源被证明会释放，而会话继续存活。** 一个 30 轮循环的测试打开并关闭全部窗口类型——在承载会话的类型上还进出全屏并开合聊天面板——并断言 store、DOM 节点数与槽位台账都回到基线；每个已释放桥记录的通道在会话变化下不再发布，而会话与列表行继续存活；释放后会话与其投影的监听者计数回到零；列表订阅数不增长；没有任何看板定时器活过本轮。关闭窗口只删除其记录与持久化绑定，绝不删除会话。

**圆环在窄列上让位，并已在真实浏览器中验证。** 专用探针（`.playwright-mcp/stage-14-multi-window-perf/probe-ring-narrow.mjs`）在展开停靠聊天面板时扫过多个视口宽度，并测量卡片的 content box——也就是 container query 读取的盒子：416px 时圆环可见，396px 时隐藏，九处采样全部与 405px 规则一致；改变渲染尺寸的画布缩放不改变 layout 宽度与判定。探针必须针对全新的 home 运行，因为恢复的布局或缩放会改变起始几何。

**MVP 的活动会话上限写在用户会遇到它的地方。** 两个包 README 都写明：看板以十个同时流式输出的窗口为验证范围，建议最多保持 20 个活动聊天，并以实测基线作为依据。

## Alternatives considered

- **把圆环的算术继续内联在会话桥里。** 否决：同一公式已存在于 ui-conversation，实时值、提示与状态阶梯需要一个归属；纯模块可测，且一致性测试把它钉住。
- **在提供方首次报告前完全隐藏圆环。** 否决：计划要求明确的空态，而且一个随首次用量上报而出现／消失的控件会让 composer 的尾部行抖动。
- **只在 jsdom 中测量压力场景。** 否决：jsdom 没有合成器，在那里测 FPS 与帧预算只会得到编造的数字；行为留在单元测试通道，性能留在真实浏览器审计里。
- **像主 composer 的仪表那样给窗口圆环加一个组成面板。** 推迟：本 MVP 的窗口 composer 放不下组成面板；提示承载读数，组成分解留在主面板。

## Consequences

每个窗口的圆环现在都能在四种状态下如实说明所选模型的窗口占用，数值与主面板一致，且提示不只给百分比还给数值。压力场景下的看板性能按早期基线确立的方法记录，资源纪律有了能捕获泄漏订阅、泄漏记录或泄漏定时器的测试。用户与后续阶段知道了支持规模：实测十个流式窗口，建议二十个活动聊天。

Verification: `tests/context-ring.client.spec.ts` 覆盖与 `contextOccupancy` 的公式一致性、80/95 阶梯、紧凑单位（含 `999 999` 显示为 `1M`）与读数；`tests/conversation-body.client.spec.tsx` 覆盖四种渲染状态以及读数更新不会移动转录车道；`tests/leaks.client.spec.tsx` 覆盖 30 轮混合循环、每个 per-window 订阅的释放（`chat`、`session`、六个投影、模型目录）、迟到加载的归属守卫与残留定时器；`tests/stress-sessions.client.spec.tsx` 覆盖十窗口五并发流、故障隔离与无串扰；`tests/window-title.client.spec.tsx` 覆盖聊天面板重命名路径、被拒重命名、空标题回退，以及十个各不相同且状态各异的 dock 与标题栏标题。`pnpm run test:gui`、`DSH_SNAPSHOT=replay pnpm run test:web`、`pnpm run typecheck`、`pnpm run lint`、`pnpm run duplication`、`pnpm run hygiene` 与 `pnpm run doc-sync` 均为绿色；真实浏览器审计的三个 verdict 均为 `ok: true`。

## Related

- [看板窗口恢复其 Harness 会话并与会话列表对账](2026-09-19-ketos-board-session-restore.zh.md) —— 资源审计所依托的绑定表与缺失／恢复状态。
- [看板手势、裁剪与窗口管理器预算](2026-09-17-ketos-board-gestures-culling.zh.md) —— 十会话运行沿用的测量方法与二十窗口基线。
- [Ketos MVP 工程政策（分叉范围、覆盖例外、流程）](../process/2026-09-15-ketos-mvp-engineering-policy.zh.md) —— 看板测试计划所用的覆盖例外。
- [`docs/ketos/perf-baseline.md`](../../../../docs/ketos/perf-baseline.md) —— 记录的方法与实测数字。
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.zh.md) —— 圆环状态、资源保证与活动会话上限。
