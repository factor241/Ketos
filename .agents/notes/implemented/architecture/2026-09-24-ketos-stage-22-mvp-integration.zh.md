# Agent Note: Ketos stage 22: a live clone session follows stored edits, and the MVP's closing decisions

Status: implemented

[English](2026-09-24-ketos-stage-22-mvp-integration.md) | 中文

## 问题

阶段 0–20 的端到端审计（2026-09-24）已在阶段 21 关闭其代码点；阶段 22 关闭剩余的文档、决策、仓库与集成点（П5、П6、П20–П25）。其中两点需要记录在案的决策，而不是一次文本编辑。

计划的阶段 18.4 记录说运行中的克隆会话继续使用旧的档案段落，而实际随附的克隆会话 scope 会就地刷新档案文本与记忆快照；审计无法分辨这是有意行为还是偏差，而存活档案编辑的 KV 缓存代价也没有任何地方记录。记忆路由 `/api/ketos.memory` 没有创建操作，克隆窗口的「记忆」页签也没有创建控件，而验收场景的记忆步骤暗示记录是在窗口中添加的；审计无法按原文执行该步骤。

## 决策

**存活的克隆会话在下一次组装时跟随档案与记忆编辑，并保留其已注册的技能。** 克隆会话 scope 的提示词提供者闭包捕获可变文本持有者，而协调器在每次生命周期事件、路由变更或工具写入之后的对账会就地替换该文本，因此人的档案或方法论编辑无需重启、也无需重新安装 scope，就会在下一次组装时到达运行中的会话。记忆快照走 `systemPrompt.context`，因此记忆写入以一条持久的运行时上下文 user 消息到达。档案文本是请求前缀的一部分，因此一次档案编辑会从第一个变化的词元起重写前缀，并就此丢掉可复用的 KV 缓存前缀——这是保持运行中会话身份真实所接受的代价。技能编辑不会重新注册：已绑定 agent 的技能 scope 只安装一次，其注册集合在该 agent 的生命周期内固定不变，因此存储的技能变更要等 scope 被重新安装（换一个克隆、访谈模式或任务）或 agent 被重建。[克隆记忆](2026-09-22-ketos-stage-17-clone-memory.zh.md) 拥有段落/上下文的划分，[克隆方法论与技能](2026-09-22-ketos-stage-18-clone-methodology-skills.zh.md) 拥有固定注册集合。

**记忆窗口校验、编辑与删除，agent 写入新记录。** `/api/ketos.memory` 只暴露 `list`、`search`、`update` 与 `delete`，新记忆由克隆自己的 `clone_memory_remember` 工具调用写入。MVP 验收场景把 agent 命名为写入者、把窗口命名为审阅面，而各包 README 把缺失的创建路径作为边界写明。

## 考虑的替代方案

- **把会话钉到它启动时所用的克隆修订号。** 在 MVP 中否决：它会把运行中会话的身份冻结到某次重新安装手势为止，而就地刷新已经在接受 KV 前缀丢失的代价下让会话保持真实。钉住属于后 MVP，README 也说明没有任何机制重放会话启动时的记录。
- **在每次存储变更时重新安装 scope。** 否决：它会在每次记忆写入时重新注册工具与段落，而段落/上下文的划分让就地刷新以更少的工作取得同样的可见结果；重新安装仍保留给不同的克隆、不同的访谈模式或不同的任务。
- **在每次克隆数据变更时重新注册技能。** 在阶段 18 否决：注册集合在该 agent 的生命周期内固定不变，而档案段落刻意不列出任何技能，因为存活 scope 无法改变它们；编辑器说明了这一等待。
- **为 `/api/ketos.memory` 添加创建操作，或为记忆窗口添加创建控件。** 在 MVP 中否决：计划把这一缺失记录为边界，而 agent 的工具是克隆记住什么的既定路径；窗口的四个操作在不需要第二个写入面的前提下保留了人的控制。

## 后果

人的编辑会在运行中会话的下一个回合落地，记忆写入保持前缀不变，而档案编辑则要支付从第一个变化的词元起的 KV 前缀丢失；技能编辑仍然要等重新安装或重建。验收场景可以按原文执行：访谈的 `clone_memory_remember` 调用提供的记录，正是记忆窗口校验、编辑与删除的那条。[`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.zh.md)、[`packages/ketos/clone-core/README.md`](../../../../packages/ketos/clone-core/README.zh.md) 与 `docs/ketos/mvp-known-limitations.md` 承载同样的事实，阶段 18.4 的措辞已被取代。

验证：`packages/ketos/clone-core/tests/composition.spec.ts`（档案编辑到达下一次组装、记忆写入使渲染出的提示词前缀保持逐字节一致、人的编辑与删除被跟随、技能集合在重建时刷新）、`packages/client/ui-board/tests/clone-flow.client.spec.tsx` 与 `tests/clone-memory.client.spec.tsx`（记忆页签通过该路由列出、编辑与删除，且不提供创建），以及 `docs/ketos/mvp-e2e.md` 步骤 B9。

## 相关

- [克隆记忆是 clones.db 中的一个 FTS5 存储，组合进克隆会话 scope 并在克隆窗口中编辑](2026-09-22-ketos-stage-17-clone-memory.zh.md) —— 本决策记录其代价的段落/上下文划分与就地刷新。
- [克隆方法论是四个规范章节，克隆技能是注册进 agent 自身 skill 注册表层的记录对象](2026-09-22-ketos-stage-18-clone-methodology-skills.zh.md) —— agent 生命周期内固定不变的注册集合。
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.zh.md) —— 看板的克隆窗口、记忆页签与已知限制。
- [`packages/ketos/clone-core/README.md`](../../../../packages/ketos/clone-core/README.zh.md) —— 该路由、克隆会话 scope 与模型体验的 KV 缓存陈述。
- [`docs/ketos/mvp-e2e.md`](../../../../docs/ketos/mvp-e2e.md) —— 其记忆步骤把 agent 命名为写入者的验收场景。
