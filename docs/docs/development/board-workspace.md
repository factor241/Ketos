# Board workspace contract

Stage 03 adds project-scoped Boards and a persisted canvas viewport. It does
not add Stage 04 placements, workflow execution, component editing, or changes
to the legacy Flow data model.

## Persistence and API

The additive `board` table belongs to a Project (`folder.id`) and records its
creator, title, viewport `(x, y, zoom)`, revision, and timestamps. Project
ownership is checked through `folder.user_id`; request payloads cannot choose an
owner or creator. All writes use a database conditional update/delete on the
cached revision. A stale mutation returns `409 board_revision_conflict` and
does not change a row.

The v1 API exposes:

- `POST` and `GET /api/v1/projects/{project_id}/boards`;
- `GET`, `PATCH`, and `DELETE /api/v1/boards/{board_id}`;
- `PUT /api/v1/boards/{board_id}/viewport`.

Registration is unconditional: `mvp_workspace` hides frontend routes but does
not weaken or remove the authenticated owner-only API.

## Frontend lifecycle

TanStack Query keys include both Project and Board identity. Zustand stores
only transient mount, hydration, gesture, and pending-viewport state; it uses no
persist middleware or browser storage. The server Board remains authoritative.

The canvas waits for Board data, restores the exact server viewport, and saves
only `onMoveEnd` using a trailing 300 ms debounce. Cleanup dispatches the last
pending mutation through the authenticated API seam. On `409`, pending local
state is discarded, the Board is refetched, and React Flow receives the server
viewport with zero animation.

Keyboard access includes an explicit canvas entry/return point, arrow pan (40
px, or 160 px with Shift), bounded `+`/`-` zoom, and `0` reset. The default
fit-view control is hidden because Stage 03 intentionally has no nodes.

Routes are `/project/:projectId/boards` and
`/project/:projectId/board/:boardId`. Existing `/flow/:id` variants are kept.

## Official dependency references

- [React Flow component API](https://reactflow.dev/api-reference/react-flow)
- [React Flow instance API](https://reactflow.dev/api-reference/react-flow-instance)
- [FastAPI bigger applications](https://fastapi.tiangolo.com/tutorial/bigger-applications/)
- [Alembic operations](https://alembic.sqlalchemy.org/en/latest/ops.html)

## Stage boundary

Stage 04 has not started. Boards contain no placements, scene graph, executor,
or Flow compatibility adapter in this stage.
