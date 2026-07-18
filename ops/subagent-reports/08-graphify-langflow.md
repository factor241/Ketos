# Subagent 08 — Graphify map of Langflow upstream

Overall status: **BLOCKED**

The standalone upstream graph was built and is usable for source-backed
navigation, but the strict integrity gate is blocked by dangling endpoints,
self-loops, same-endpoint edge collapse, and 262 code-classified JSON files
that have no represented source node. These conditions are recorded rather
than promoted to a false PASS.

## Scope and reference identity

Only the following locations were changed:

- ignored `references/langflow-upstream/graphify-out/**`;
- local clone metadata `.git/info/exclude`, with `graphify-out/`;
- this report.

No tracked file in the upstream clone and no Ketos source/configuration file
was modified. No commit was created.

| Field | Value |
|---|---|
| Repository | `https://github.com/langflow-ai/langflow.git` |
| Tag | `v1.10.2` |
| Commit | `a69a47ff1b5c99ce9c50edc4df45de4397151f17` |
| Checkout | detached exact tag |
| Graphify | `0.9.16` |
| Extraction mode | code-only AST, no semantic extraction, no API key |
| Graph mode | undirected simple `Graph`, no HTML (`--no-viz` policy) |

The final `graph.json` also records
`built_at_commit=a69a47ff1b5c99ce9c50edc4df45de4397151f17`.

## Commands and execution notes

The workflow followed the Graphify skill pipeline:

```text
graphify detect(Path("/Volumes/Projects/ketos_canvas_mod_main/references/langflow-upstream"))
graphify.extract.extract(code_files, cache_root=reference_root, parallel=False)
graphify.build.build_from_json(..., directed=False)
graphify.cluster.cluster(...)
graphify.diagnostics.diagnose_extraction(...)
graphify query "<architecture query>" --budget 1200
graphify path "FlowPage()" "FastAPI"
graphify explain "LangflowClient"
graphify.detect.save_manifest(..., root=reference_root)
```

The first parallel AST attempt was explicitly rejected: Python was invoked
through `<stdin>`, and macOS `multiprocessing.spawn` could not re-import that
entry point. It produced repeated `FileNotFoundError: .../<stdin>` worker
failures and an incomplete 1,165-node result. Root-cause reproduction showed
that sequential extraction did not cross the process boundary; the final
accepted extraction was rerun with `parallel=False` and processed all 6,038
code-classified files.

## Corpus and graph metrics

Full detection, before the deliberate code-only filter:

| Category | Files |
|---|---:|
| Code | 6,038 |
| Documents | 1,058 |
| Images | 398 |
| Video/audio | 1 |
| Papers | 0 |
| Total | 7,495 |

The full detected corpus is approximately 10,309,636 words. The code-only AST
scope is approximately 4,702,755 words. Eight sensitive candidates were
skipped by Graphify detection.

| Metric | Value |
|---|---:|
| AST nodes | 62,535 |
| Raw extracted edges | 146,124 |
| Post-build graph edges | 123,071 |
| Communities | 3,296 |
| Connected components | 1,394 |
| Largest connected component | 58,021 nodes |
| Isolates | 529 |
| Represented source files | 5,776 / 6,038 (95.66%) |
| Manifest entries | 6,038 |
| Token cost | 0 input / 0 output |

All 6,038 manifest keys are relative and hash-bound. The manifest contains
zero `.git` entries and zero `graphify-out/` entries, so the graph did not
self-index. Common generated directories (`node_modules`, `.venv`,
`__pycache__`, `dist`, `build`, `coverage`, `.next`, `target`) contributed
zero detected code paths.

## Integrity diagnosis

`diagnose_extraction` reported:

| Diagnostic | Count |
|---|---:|
| Missing-endpoint edges | 0 |
| Dangling-endpoint edges | 16,986 |
| Self-loop edges | 15 |
| Exact duplicate edges | 1,013 |
| Directed same-endpoint collapsed edges | 6,211 |
| Undirected same-endpoint collapsed edges | 6,319 |
| Relation-variant endpoint groups | 2,265 |
| Source-location variant groups | 668 |

Graphify also warned that 261 extractor-accepted files produced zero nodes.
An independent source-file comparison found 262 unrepresented inputs; all are
`.json`, including settings, API result fixtures, starter-flow fixtures, and
`test-results/.last-run.json`. The graph therefore covers executable Python,
TypeScript/TSX, JavaScript/JSX, shell and manifest structure well, but it is
not a complete semantic representation of every JSON artifact.

The post-build graph is still useful, but a simple `Graph` necessarily
collapses relation/location variants sharing the same endpoints. Cross-system
conclusions must be checked against current source, especially when they rely
on inferred `uses` edges or generic hub nodes such as `JSON`, `react`, and
`Message`.

## Architecture smoke tests

All four query families returned traversals with concrete `source_file` and
`source_location` values:

| Area | Result |
|---|---|
| Backend / API | PASS — 1,058 nodes found in BFS smoke |
| Frontend / canvas | PASS — 391 nodes found |
| Components / flow execution | PASS — 2,211 nodes found |
| SDK / MCP | PASS — 600 nodes found |
| Cross-subsystem path | PASS with ambiguity warning — `FlowPage()` to `FastAPI`, 9 hops |
| Explain | PASS — `LangflowClient`, 15 connections |

The path smoke is evidence of traversability, not proof that every hop is a
meaningful architectural dependency. Graphify warned that the `FastAPI` target
match was ambiguous.

Direct source evidence for the later Ketos/Langflow crosswalk:

| Area | Upstream source anchors |
|---|---|
| FastAPI application | `src/backend/base/langflow/main.py:642`, `:808-812`, `:950` |
| API v1/v2 composition | `src/backend/base/langflow/api/router.py:61-132` |
| Flow page shell | `src/frontend/src/pages/FlowPage/index.tsx:39`, `:72` |
| ReactFlow canvas | `src/frontend/src/pages/FlowPage/components/PageComponent/index.tsx:909-972` |
| Canvas state | `src/frontend/src/stores/flowStore.ts:115`, `:398` |
| Flow graph/executor | `src/lfx/src/lfx/graph/graph/base.py:65`, `:1679`, `:2224` |
| Spec-to-flow builder | `src/lfx/src/lfx/graph/flow_builder/builder.py:64` |
| Python SDK | `src/sdk/src/langflow_sdk/client.py:58`, `:188`, `:200` |
| Agentic MCP server | `src/backend/base/langflow/agentic/mcp/server.py:1`, `:69`, `:75-630` |
| MCP component | `src/lfx/src/lfx/components/models_and_agents/mcp_component.py:59`, `:967` |

The graph's highest-degree nodes are `react` (739), `Message` (461), `cn()`
(440), `JSON` (376), `session_scope()` (294), `getURL()` (275), and `Graph`
(268). Useful source-backed bridges include OpenAPI generation to
`create_app()`, component-index generation to `import_langflow_components()`,
and starter-project maintenance to `get_and_cache_all_types_dict()`.

## Performance

| Stage | Wall time | Maximum resident memory |
|---|---:|---:|
| Full detect | 39.24 s | 362,168,320 bytes |
| Final sequential AST | 47.65 s | 1,243,234,304 bytes |
| Build, cluster, report | 20.22 s | 587,644,928 bytes |
| Community labeling/report refresh | 16.19 s | 604,897,280 bytes |

HTML was intentionally not generated because the graph has more than 5,000
nodes. The raw `graph.json` is approximately 80 MiB.

## Outputs

Primary artifacts:

- `references/langflow-upstream/graphify-out/graph.json`
- `references/langflow-upstream/graphify-out/GRAPH_REPORT.md`
- `references/langflow-upstream/graphify-out/manifest.json`
- `references/langflow-upstream/graphify-out/METRICS.json`
- `references/langflow-upstream/graphify-out/.health.json`
- `references/langflow-upstream/graphify-out/.health.txt`
- `references/langflow-upstream/graphify-out/query-backend-api.txt`
- `references/langflow-upstream/graphify-out/query-frontend-canvas.txt`
- `references/langflow-upstream/graphify-out/query-components-flows.txt`
- `references/langflow-upstream/graphify-out/query-sdk-mcp.txt`
- `references/langflow-upstream/graphify-out/path-flowpage-fastapi.txt`
- `references/langflow-upstream/graphify-out/explain-langflowclient.txt`

## Acceptance result

| Gate | Status |
|---|---|
| Exact official tag/SHA | PASS |
| Code-only no-key extraction | PASS |
| Graph/report/manifest produced | PASS |
| No `.git` or output self-indexing | PASS |
| Architecture query/path/explain smoke | PASS |
| Clone cleanliness after local exclude | PASS |
| Every code-classified file represented | BLOCKED |
| Graph health with zero dangling/collapsed/self-loop edges | BLOCKED |

Overall: **BLOCKED**, with a usable source-linked reference graph and explicit
evidence for the semantic crosswalk. A future Graphify release or upstream
extractor correction is needed before the strict integrity gate can become
PASS.
