# Wave 2 knowledge corpus inventory

**Status:** PASS  
**Workspace:** `/Volumes/Projects/ketos_canvas_mod_main`  
**Generated:** `2026-07-16T17:58:13.721Z`

## Outcome

A complete source-authored inventory was produced without running INGEST, prepare, validate, promote, or changing RaytSystem config, knowledge, or ledger state. The machine-readable manifest stores `path`, `size`, `sha256`, `provenance`, and `type` for every included file, plus a reason for every individually excluded Git-visible candidate.

Generated dependency/build/runtime trees are outside the included corpus: `.git`, `node_modules`, `build`, `dist`, `.docusaurus`, caches, `graphify-out`, `.raytsystem`, virtual environments, coverage/test reports, explicit `test-results`, and root `ops/`. The Git-visible root marker `test-results/.last-run.json` is retained only as an excluded `runtime-test-report` audit record; it has no manifest hash and no runtime/test-report path is included.

## Provenance

| Provenance | State | Revision | Dirty |
|---|---|---|---:|
| `ketos` | present | `572fad8ea2223e342508ecf095133091c7714e1b` | `true` |
| `raytsystem@b5ac705` | present | `b5ac70560112758f78dd15852422ee697ac336f4` | `true` |
| `langflow-upstream` | **missing** | — | — |

`src/compat/langflow*` remains Ketos provenance; it is not treated as the absent future `langflow-upstream` corpus. RaytSystem hashes describe current working-tree bytes at the pinned `b5ac705` baseline, so the nested checkout's dirty state is explicit.

## Counts and bytes

| Measure | Files | Bytes |
|---|---:|---:|
| Git-visible candidates after root pruning | 836 | 24819295 (23.67 MiB) |
| Included source-authored files | 801 | 12469407 (11.89 MiB) |
| Individually excluded candidates | 35 | 12349888 (11.78 MiB) |

### Included by provenance

| Provenance | Files | Bytes |
|---|---:|---:|
| `ketos` | 267 | 10176878 (9.71 MiB) |
| `raytsystem@b5ac705` | 534 | 2292529 (2.19 MiB) |

### Included by type

| Type | Files | Bytes |
|---|---:|---:|
| `csv` | 3 | 37969 (0.04 MiB) |
| `json` | 446 | 10382185 (9.90 MiB) |
| `jsonl` | 3 | 4287 (0.00 MiB) |
| `markdown` | 326 | 1967400 (1.88 MiB) |
| `mdx` | 15 | 66388 (0.06 MiB) |
| `text` | 8 | 11178 (0.01 MiB) |

## Eligibility

- Documents-eligible Markdown/MDX (`<= 5 MiB`): **341 files / 2033788 bytes (1.94 MiB)**. By provenance: `ketos` 140 / 944207 B, `raytsystem@b5ac705` 201 / 1089581 B.
- Ingestion-eligible offline types (`.md/.txt/.json/.jsonl/.csv/.tsv/.pdf`, `<= 25 MiB`): **786 files / 12403019 bytes (11.83 MiB)**. By provenance: `ketos` 258 / 10167987 B, `raytsystem@b5ac705` 528 / 2235032 B.
- `.mdx` is Documents-eligible but not supported by the current offline ingestion extractor. `.rst` is inventoried but is not eligible for either path. Eligibility here is extension/size/safety based; no parser or PDF text-extractability validation was run.

## Exclusions

| Reason | Files |
|---|---:|
| `canonical-ledger` | 2 |
| `generated-evaluation-result` | 1 |
| `generated-kfx-asset` | 2 |
| `generated-knowledge-projection` | 8 |
| `generated-openapi` | 1 |
| `generated-third-party-license-bundle` | 2 |
| `lockfile` | 5 |
| `runtime-test-report` | 1 |
| `sensitive-content` | 13 |

Sensitivity exclusions use RaytSystem `raytsystem_secret_patterns` v`1.2.0`. The manifest records only file metadata and the generic reason `sensitive-content` or `protected-name`; it does not store matched values, excerpts, or secret material.

## Safety and state

- No file was ingested or promoted.
- No canonical knowledge or ledger path was modified.
- No config, Graphify artifact, Git ref, commit, push, or external action was created.
- Existing dirty state in both checkouts was preserved.
- Only `ops/knowledge-corpus-manifest.json`, `ops/subagent-reports/05-knowledge-inventory.md`, and `scripts/knowledge-corpus-manifest.test.mjs` were written by this subagent.

## Regression evidence

- **RED:** `node --test scripts/knowledge-corpus-manifest.test.mjs` exited `1` against the prior manifest with `2 passed / 2 failed`. The failures proved that `scope.root_prunes` did not explicitly contain `test-results` and that included totals still contained the 45-byte `test-results/.last-run.json`.
- **Transformation:** the existing manifest was updated in place without rescanning the workspace. The single entry was removed from `included`, preserved in `excluded` as metadata-only reason `runtime-test-report`, and every summary/eligibility aggregate was recomputed from the emitted arrays.
- **GREEN:** `node --test scripts/knowledge-corpus-manifest.test.mjs` exited `0` with `4 passed / 0 failed`. The executable regression covers explicit root-prune policy, absence of runtime/generated paths from `included`, current file sizes and SHA-256 hashes, sensitivity-policy metadata shape, summary totals, Documents eligibility, and ingestion eligibility.

## Artifacts

- `ops/knowledge-corpus-manifest.json`
- `ops/subagent-reports/05-knowledge-inventory.md`
- `scripts/knowledge-corpus-manifest.test.mjs`
