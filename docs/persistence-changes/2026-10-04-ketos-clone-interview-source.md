---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-04-ketos-clone-interview-source

English | [中文](2026-10-04-ketos-clone-interview-source.zh.md)

## Summary

Adds the qualified `ketos-clone-interview` message source for the kickoff turn that opens a digital-clone interview.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing logs contain no such source and remain valid. The new source is qualified attribution on an ordinary user message: readers without `@ketos/clone-core` preserve the message and derive history from its content, and only the clone kickoff projection reads the kind to mark the interview as opened. The kickoff producer queues it once per interview session, and no event type or Session header changes.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/ketos/clone-core: 170 tests passed across 12 files. pnpm run verify-persistence-changes records the qualified kind and regenerates the catalog. pnpm run typecheck and pnpm run doc-sync passed with the record present.

<a id="dev-note"></a>
## Dev Note

None.
