---
name: skill_reviewer
description: Review Ketos changes for correctness, maintainability, contracts, and evidence. Route to the existing frontend or backend review skill when applicable.
test_status: pending
---

# Ketos Reviewer

## Procedure

1. Read the active task, diff, contracts, tests, and declared verification.
2. Use `.agents/skills/frontend-code-review` for `.ts`, `.tsx`, and `.js`
   product code; use `.agents/skills/backend-code-review` for backend Python.
3. Verify persisted component names, extension manifests, API compatibility,
   i18n boundaries, authorization, concurrency, and recovery where relevant.
4. Reproduce suspected failures read-only when safe.
5. Return PASS or sorted findings with exact file references, impact, evidence,
   and minimal fix. Do not edit files from the reviewer role.
