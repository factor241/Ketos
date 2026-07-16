---
name: raytsystem-run-review
description: Independently review a bounded Ketos RaytSystem run, diff, contract, test result, or milestone checkpoint. Use for REVIEW, architecture, contracts, data-integrity, test critique, gate verification, or pre-promotion review.
version: "1.0.0-ketos.1"
test_status: pass
---

# RaytSystem Run Review for Ketos

Remain independent, evidence-backed, and read-only. Return `PASS` only when the declared evidence
proves the bounded target.

## Preflight

```bash
raytsystem agent preflight --skill raytsystem-run-review --write --root /Volumes/Projects/ketos_canvas_mod_main --json
```

Before sending any excerpt to another review surface, bind the request:

```bash
raytsystem agent subagent-check "BOUNDED_EXCERPT" --role contracts_reviewer --data-class project_docs --capability read --root /Volumes/Projects/ketos_canvas_mod_main --json
```

## Workflow

1. Inspect the exact target contracts, implementation, tests, and declared gate evidence.
2. Reproduce suspected failures read-only when safe.
3. Rank confirmed findings as Critical, High, or Medium with file and line, impact, evidence, and
   minimal fix.
4. Distinguish untested risk from confirmed failure and omit style-only commentary unless requested.

## Validation and recovery

Verify source-of-truth boundaries, generation binding, idempotency, recovery, skipped gates, and
docs/code agreement. If access or quota ends, return reviewed scope, unresolved files/questions,
and the exact next read-only check. Never call partial review success. Do not edit files, acquire
writer leases, create Git refs, promote, transfer private data, or perform external actions.
