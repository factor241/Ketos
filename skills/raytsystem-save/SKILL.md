---
name: raytsystem-save
description: Stage a cited synthesis as a typed RaytSystem DRAFT bundle and escaped preview for Ketos. Use for SAVE, preserving a verified query answer, preparing a knowledge proposal, or creating a reviewable draft.
version: "1.0.0-ketos.1"
test_status: pass
---

# RaytSystem SAVE for Ketos

Accept bounded synthesis text, a safe title, and one or more verified active evidence segment IDs.
SAVE is draft-only and cannot promote or publish.

## Preflight

```bash
raytsystem agent preflight --skill raytsystem-save --write --root /Volumes/Projects/ketos_canvas_mod_main --json
```

Obtain evidence IDs from a verified generation-bound QUERY result. Reject secret text, unsafe
titles or paths, stale generations, linked control/output paths, and uncited synthesis.

## Workflow

```bash
raytsystem save "SYNTHESIS" --title "TITLE" --evidence SEGMENT_ID --root /Volumes/Projects/ketos_canvas_mod_main --json
```

Inspect the typed staging bundle and escaped preview hashes. Leave the result in
DRAFT/awaiting-review state.

## Validation and recovery

- Bind the operation key to generation, text/title hashes, evidence, schemas, component, and config.
- Verify identical or concurrent SAVE calls return the same artifact without canonical mutation.
- Re-run the exact SAVE to join an incomplete operation and verify its hash-closed bundle.
- Preserve incomplete staging and fail closed on generation change.
- Stop before promotion, send, publish, upload, outbox dispatch, push, PR, or release.
