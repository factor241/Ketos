---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-04-ketos-clone-interview-source

[English](2026-10-04-ketos-clone-interview-source.md) | 中文

## 概述

新增限定的 `ketos-clone-interview` 消息来源，用于开启数字克隆访谈的首个回合。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-04-ketos-clone-interview-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-21-user-question-reply"
    after: "c9cb306b55c5767f1d668b7dde60ffa2ec230abc25ba1190c3cbb80bf1906467"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-21-user-question-reply"
    after: "2d8dbd1c85921fdba7c7c8f6a1cc4ee90f57b5a72a0c9e5d44959cbe94432b20"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-21-user-question-reply"
    after: "57c5bcb94676e3034b5f1e97e311f5062c095b95ead95d470fc7183433dd4bda"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-21-user-question-reply"
    after: "1b845eed3d71c66a8ff589760f98e37b7bfe0756b8d18da62371d8fc697caa9a"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

既有日志不含该来源，保持有效。新来源是普通用户消息上的限定归属：没有 `@ketos/clone-core` 的读取方保留该消息并从其内容推导历史，只有克隆启动投影读取该种类以标记访谈已开启。启动生产者每个访谈会话仅入队一次，事件类型与会话头均不变化。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/ketos/clone-core：12 个文件共 170 个测试通过。pnpm run verify-persistence-changes 记录该限定种类并重新生成目录。记录存在时 pnpm run typecheck 与 pnpm run doc-sync 通过。

<a id="dev-note"></a>
## 开发备注

无。
