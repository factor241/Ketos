# Current asset map at the approved baseline

Baseline: `80878261d07c21ad257de017d98069f211ada2c2`.

All 36/36 material paths listed in the architecture inventory resolve at the
approved SHA. The existing Graphify map is from `572fad8…`; it was useful for
navigation, but source citations are authoritative for every statement below.

## Persistence boundaries

- Folder is the current project-like hierarchy and owns Flow/Deployment
  relationships (`services/database/models/folder/model.py:22-41`).
- Flow persists the canonical JSON canvas (`nodes`, `edges`, viewport) and
  ownership/folder/workspace state (`.../flow/model.py:150-219`).
- FlowVersion is a per-Flow numbered JSON snapshot; provider deployment
  attachment remains separate (`.../flow_version/model.py:12-36` and
  `.../flow_version_deployment_attachment/model.py:17-77`).
- Job has a nullable owner and generic asset/dedupe metadata
  (`.../jobs/model.py:17-89`); the exhaustive writer/reader findings are in
  `backend/job-ownership.json`.
- Message, Trace/Span, MemoryBase and KnowledgeBase are distinct persistence
  domains. Trace/Span carries hierarchical execution payloads; MemoryBase
  links Flow, Job and Message ingestion; KnowledgeBase metadata is not vector
  content (`.../message/model.py:22-190`, `.../traces/model.py:134-373`,
  `.../memory_base/model.py:10-203`, `.../knowledge_base/model.py:1-147`).

## API, execution and frontend boundaries

- `/api/v1`, `/api/v2`, health/log and plugin routes are assembled in
  `api/router.py:44-132` and `main.py:827-837`. Runtime recursion found 263
  method registrations; see `security/route-capability-matrix.json`.
- KFX is the active execution/extension boundary (`flow_runner.py:1-19`,
  `inputs/inputs.py:1-40`, `services/manager.py:1-26`). LFX is a frozen alias
  distribution, recorded separately rather than inferred from production imports.
- The React application already uses an XYFlow editor. Flow load/save bridges
  canonical Flow JSON to Zustand/ReactFlow state
  (`hooks/flows/use-apply-flow-to-canvas.ts:9-46`,
  `hooks/flows/use-save-flow.ts:22-85`, `stores/flowStore.ts:115-211`).

## Classified drift and downstream impact

Graphify source drift is accepted only as a navigation limitation; it is not
treated as current topology evidence. Dynamic plugins, profile-dependent
routes, Job ownership, telemetry observation and Desktop packaging require
their dedicated records. No Stage 02 schema or product behavior was changed.
