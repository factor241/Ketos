---
name: raytsystem-security-review
description: Audit Ketos RaytSystem changes for prompt injection, provenance bypass, path escape, secret leakage, stale fencing, partial promotion, unsafe parsing, and unapproved side effects. Use for SECURITY REVIEW, adversarial testing, recovery review, or approval-boundary validation.
version: "1.0.0-ketos.1"
test_status: pass
---

# RaytSystem Security Review for Ketos

Remain independent and read-only except for isolated synthetic tests inside the approved scope.
Never disclose secret values.

## Preflight

```bash
raytsystem agent preflight --skill raytsystem-security-review --write --root /Volumes/Projects/ketos_canvas_mod_main --json
```

Before hosted delegation, bind the safe excerpt and destination:

```bash
raytsystem agent subagent-check "BOUNDED_EXCERPT" --role security_reviewer --data-class project_docs --capability read --root /Volumes/Projects/ketos_canvas_mod_main --json
```

Snapshot declared canonical and external state and identify every write and egress boundary.

## Workflow

1. Trace untrusted input through fetch, extract, proposal, validation, promotion, query, and save.
2. Test raw/hash/citation closure, generation races, lease fencing, WAL/pointer crash windows, and
   idempotency.
3. Test SQL/FTS injection, limits, parser containment, symlink/hardlink/no-follow paths, and secret
   redaction.
4. Verify zero unapproved process, network, outbox, Git, or external action.

## Validation and recovery

Require a regression test for every confirmed Critical or High issue. Preserve failed staging and
machine-readable reports; retry only classified transient failures. Stop on secret/PII exposure,
unsafe egress, real promotion, destructive action, or missing authority. Do not downgrade a
confirmed issue because exploitation is inconvenient.
