---
name: raytsystem-lint
description: Run deterministic RaytSystem integrity, provenance, projection, link, alias, operation, and secret checks for Ketos. Use for LINT, health checks, checkpoint verification, stale projection diagnosis, broken evidence, or semantic review.
version: "1.0.0-ketos.1"
test_status: pass
---

# RaytSystem LINT for Ketos

Keep LINT read-only. Never auto-fix canonical knowledge or hide findings by deletion.

## Preflight

```bash
raytsystem agent preflight --skill raytsystem-lint --write --root /Volumes/Projects/ketos_canvas_mod_main --json
```

Record the active generation and Git dirty state. Inspect files through no-follow, hardlink-safe
paths.

## Workflow

1. Run deterministic checks:

```bash
raytsystem lint --root /Volumes/Projects/ketos_canvas_mod_main --json
```

2. Use semantic mode only to create review findings:

```bash
raytsystem lint --semantic --root /Volumes/Projects/ketos_canvas_mod_main --json
```

3. If a derived projection is stale or corrupt, rebuild it with its owner command and rerun LINT:

```bash
raytsystem rebuild-index --root /Volumes/Projects/ketos_canvas_mod_main --json
```

## Validation and recovery

Check raw hashes, citation closure, canonical bytes, projection markers and indexes, local links,
IDs, aliases, slugs, secrets, and operation uniqueness. Preserve corrupted inputs and failed
staging for diagnosis. Escalate semantic conflicts as proposals or human review; stop before
canonical repair, destructive migration, secret disclosure, or external action.
