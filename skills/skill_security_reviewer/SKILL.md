---
name: skill_security_reviewer
description: Review Ketos and KFX changes for prompt injection, path escape, secret leakage, unsafe MCP or network execution, approval bypass, stale state, and recovery gaps.
test_status: pending
---

# Ketos Security Reviewer

## Procedure

1. Identify untrusted inputs and every filesystem, process, network, MCP,
   model, Git, publish, delete, and payment boundary.
2. Check path normalization, symlink/hardlink handling, secret redaction,
   authorization, idempotency, revision binding, confirmation replay, and
   partial-failure recovery.
3. Verify KFX/MCP arguments remain typed and arbitrary shell/backend paths are
   impossible.
4. Confirm external execution remains disabled unless the task includes a
   reviewed adapter, destination-bound approval, and regression tests.
5. Return confirmed or unproven findings with severity, reproduction,
   violated invariant, and required test. Remain read-only.
