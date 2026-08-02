# Agent 7/12 — Graphify map refresh for Ketos

Date: 2026-07-17  
Scope: `/Volumes/Projects/ketos_canvas_mod_main`  
Graphify: `0.9.16`  
Overall result: **BLOCKED**

The code/AST layer is current and usable. The overall result is `BLOCKED`
because 69 changed documents were deliberately not sent to an LLM/API, so their
semantic layer is not current. No `--force`, API key, hook, source-code edit, or
configuration edit was used.

## Result matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| Existing graph root | PASS | `.graphify_root` is `/Volumes/Projects/ketos_canvas_mod_main` |
| Existing graph commit | PASS | `built_at_commit` and `git rev-parse HEAD` are both `572fad8ea2223e342508ecf095133091c7714e1b` |
| Code/AST freshness | PASS | Supported `graphify update .` completed; independent `extract --code-only` contained 60,333 normalized node signatures from 5,258 source files and every signature/source was present in the production graph |
| Semantic document freshness | BLOCKED | Incremental scan reports 69 changed documents; Graphify CLI `update` is AST-only and the task prohibited LLM/API extraction |
| Self-indexing | PASS | `graphify-out` source hits: 0 |
| Reference-clone isolation | PASS | `references/langflow-upstream` source hits: 0 |
| Portable source paths | PASS | absolute source paths: 0; parent-escape paths: 0; manifest absolute keys: 0 |
| Missing/dangling endpoints | PASS | 0 missing and 0 dangling endpoint edges |
| Multigraph collapse | PASS | 0 exact duplicates and 0 directed/undirected same-endpoint collapses in the built graph |
| Self-loops | WARN | 17 extracted self-loops, mostly same-name import nodes and TypeScript JSX declarations |
| Query/path/explain smoke | PASS | 4 BFS queries, 2 paths, and 2 explanations returned graph nodes and source locations |
| Interactive HTML | BLOCKED | 65,615 nodes exceed Graphify's 5,000-node HTML safety limit; stale HTML was removed by Graphify |
| JSON/report outputs | PASS | `graphify-out/graph.json` and `graphify-out/GRAPH_REPORT.md` regenerated |

## Baseline

Before update:

- graph: 63,467 nodes, 128,069 edges;
- `graph.json`: 75,258,530 bytes;
- commit: current HEAD;
- manifest: 5,928 entries;
- self-index hits: 0;
- graph root and interpreter guards were present;
- incremental scan:
  - 81 new/changed files;
  - 12 classified as code;
  - 69 classified as documents;
  - 3 deleted files;
  - 5 sensitive files skipped;
  - full detected corpus: 6,004 files;
  - approximately 5,559,468 words.

The repository is above Graphify's large-corpus warning threshold. Full scope
was nevertheless used because it was explicitly approved by the user.

## Update

Command:

```bash
/usr/bin/time -l graphify update .
```

Result:

```text
[graphify watch] Rebuilt: 65615 nodes, 131056 edges, 2867 communities
[graphify watch] graph.json and GRAPH_REPORT.md updated in graphify-out
```

Performance:

- wall time: 91.47 seconds;
- user time: 102.33 seconds;
- system time: 7.84 seconds;
- maximum resident set size: 1,505,968,128 bytes;
- swaps: 0.

Graphify created its own protected-output backup at
`graphify-out/2026-07-17/`. The shrink guard did not fire, and `--force` was not
used.

Current graph:

- 65,615 nodes;
- 131,056 edges;
- 2,867 communities;
- 11 hyperedges;
- 62,206 nodes with a source file;
- 5,518 unique source files;
- 105,606 `EXTRACTED` edges;
- 25,440 `INFERRED` edges;
- 10 `AMBIGUOUS` edges;
- `graph.json`: 91,287,778 bytes;
- token cost: 0 input / 0 output.

Delta from baseline:

- +2,148 nodes;
- +2,987 edges;
- -403 communities after reclustering.

Graphify reported 118 supported source files that produced zero AST nodes.
These are primarily configuration/data files such as `settings.json`,
`devcontainer.json`, `ruff.json`, `launch.json`, and `tasks.json`. They are
retried by Graphify rather than cached as successful empty extractions.

## Independent current-code comparison

The current checkout was independently extracted into a disposable directory:

```bash
graphify extract . --code-only --no-cluster \
  --out /tmp/ketos-graphify-code-compare.GalJF0
```

Result:

- 5,379 code files scanned;
- 625 non-code files intentionally skipped;
- 63,463 raw nodes;
- 147,243 raw edges;
- wall time: 65.06 seconds;
- maximum resident set size: 1,505,460,224 bytes.

Raw node IDs and paths differ because the disposable output root is `/tmp`.
After normalizing paths back to the Ketos root and comparing
`(label, source_file, source_location)`:

- independent unique code signatures: 60,333;
- signatures absent from production graph: 0;
- independent code source files: 5,258;
- source files absent from production graph: 0;
- normalized code signature coverage: 100%.

The raw `--no-cluster` artifact is not suitable as the production graph: its
diagnostic found 17,193 dangling endpoint edges and 2,363 directed
same-endpoint collapses. It was used only as a coverage oracle and did not
replace `graphify-out/graph.json`.

## Integrity diagnostic

Command:

```bash
graphify diagnose multigraph --graph graphify-out/graph.json --json
```

Result:

- 65,615 nodes;
- 131,056 raw edges;
- 0 non-object edges;
- 0 missing-endpoint edges;
- 0 dangling-endpoint edges;
- 0 exact duplicate edges;
- 0 directed same-endpoint collapsed edges;
- 0 undirected same-endpoint collapsed edges;
- 17 self-loop edges.

Diagnostic performance:

- wall time: 4.30 seconds;
- maximum resident set size: 616,218,624 bytes.

The 17 self-loops are visible, not suppressed. They are extracted from
same-name imports (`__init__.py`, `anyio.py`, `opentelemetry.py`,
`elasticsearch.py`) and TypeScript JSX declaration inheritance in
`src/frontend/src/vite-env.d.ts`. They should be treated as a Graphify producer
quality warning, not silently described as a clean zero-warning graph.

## Architecture smoke tests

Every BFS query was expanded only with tokens present in the graph vocabulary
(7,869 tokens):

```bash
graphify query "backend api router service" --budget 450
graphify query "frontend canvas flow component" --budget 450
graphify query "kfx extension bundle component" --budget 450
graphify query "mcp agent service" --budget 450
```

All four returned populated traversals with source locations. Examples include:

- `useFlowStore` — `src/frontend/src/stores/flowStore.ts:L116`;
- `Flow` — `src/backend/base/ketos/services/database/models/flow/model.py:L191`;
- `Component` — `src/kfx/src/kfx/custom/custom_component/component.py:L150`;
- `MCPToolsComponent` and its KFX MCP client/service neighbors.

Path smokes:

```bash
graphify path "FastAPI" "CanvasControls"
graphify path "BundleRegistry" "Component"
```

Both found paths. Graphify warned that one endpoint match in each path was
ambiguous, so the path results are usable navigation hints rather than unique
proof of architecture.

Explain smokes:

```bash
graphify explain "FlowStore"
graphify explain "MCPToolsComponent"
```

Both returned exact source locations and populated neighborhoods:

- `FlowStore`: `src/kfx/src/kfx/cli/flow_store.py:L22`, degree 22;
- `MCPToolsComponent`:
  `src/kfx/src/kfx/components/models_and_agents/mcp_component.py:L59`,
  degree 82.

## Remaining blocker and safe next step

The post-update incremental detector still reports the 12 changed
configuration/test/ledger JSON or MJS files and the 69 documents. The
production code graph nevertheless has 100% normalized coverage against the
independent current-code extraction. The remaining real freshness gap is the
semantic document layer.

Closing that gap requires a separate semantic extraction run using either the
host agent extraction workflow or an explicitly configured supported LLM
backend. It was not performed because this task explicitly required no
LLM/API. Do not mark document-semantic freshness `PASS` until those 69 documents
are actually re-extracted and the graph is revalidated.

The graph is too large for Graphify's default interactive HTML limit. The safe
current navigation surfaces are `graph.json`, `GRAPH_REPORT.md`, and the
`query`, `path`, and `explain` commands. Raising the visualization cap would
require a separate performance decision; it was not bypassed here.

## Host semantic completion addendum

The host-agent semantic workflow subsequently closed the document freshness
gap with three independent extraction chunks. The merged result covered all
69 changed documents and produced 203 unique semantic nodes, 260 edges, and
9 hyperedges. Validation found no duplicate node IDs, invalid source paths,
missing endpoints, or dangling endpoints.

The semantic fragments were merged with `dedup=False` so the incremental update
would replace only the changed documents instead of globally fuzzy-deduplicating
the existing production graph. The resulting graph contains 65,535 nodes,
131,073 edges, and 2,794 communities. Its post-merge health gate reports:

- 0 missing-endpoint edges;
- 0 dangling-endpoint edges;
- 0 exact duplicate edges;
- 0 directed or undirected same-endpoint collapses;
- 17 visible self-loop warnings.

Every one of the 69 changed document paths is represented in the final
`graph.json`. `graphify query` and `graphify explain` both returned the new
RaytSystem/Codex/Claude semantic nodes. The document-semantic freshness blocker
recorded above is therefore resolved; the 17 producer self-loop warnings and
the HTML size limit remain explicit non-blocking limitations.
