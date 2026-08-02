# Stage 01 errata register

Files 01–14 are frozen historical evidence. They are not silently rewritten by
Stage 01. Any correction must be an append-only erratum or decision record in
this evidence bundle, with its source, rationale, owner, and review state.

## Current baseline

- Approved source branch/SHA: `redesign/sidebar-account` at
  `80878261d07c21ad257de017d98069f211ada2c2`.
- Integration branch/SHA: `codex/stage01-baseline-evidence` at the same SHA.
- Approved upstream: `origin/redesign/sidebar-account` (`+0/-0`).
- Root-checkout changes are user-owned and excluded; see
  `records/root-dirty-status.json` and `preflight-manifest.json`.

## Graphify correction

The supplied Graphify snapshot reports
`built_at_commit=572fad8ea2223e342508ecf095133091c7714e1b`, 65,618 nodes, and
0 edges. It is classified **STALE_INCOMPLETE**, not current graph proof. The
fresh approved-checkout observation found no `graphify-out/graph.json`; it was
not rebuilt. See `records/graphify-metadata.json`.

## Register

| ID | Status | Correction | Evidence |
| --- | --- | --- | --- |
| S01-E-001 | active | Graphify snapshot may not be used as current topology evidence. | `preflight-manifest.json` |
