# Board workspace

Boards are project-scoped spatial workspaces for organizing notes, chats,
automations, and workflow results. A Board is the primary spatial interaction
context for arranging notes, chats, Flows, and run results. A Flow remains the
canonical automation graph and execution definition.

## Data model

A Board belongs to a Project and stores:

- its Project identifier, creator, and title;
- viewport position and zoom;
- a revision used for conditional writes;
- creation and update timestamps.

A Placement connects one Board to one target and stores its position, size,
stacking order, display state, and revision. Current target kinds are:

```text
note
chat
automation
job_result
```

Placement display state is `normal`, `collapsed`, or `maximized`. A Flow may be
represented by different placements without changing the Flow itself.
Move, resize, collapse, maximize, and restore update the Placement or its
display state, not the referenced Note, ChatThread, Flow, automation run, or
job-result record. Closing a card removes its Placement from the Board; it does
not delete the referenced target.

## Persistence and authorization

The backend is authoritative for Board data. Project ownership is resolved on
the server, and request payloads cannot select another owner or creator. Board,
Placement, and Board-note mutations use expected revisions. A stale write
returns a conflict response rather than silently replacing a newer server
version.

The frontend uses TanStack Query for server-owned state. Zustand stores only
transient Canvas interaction state and does not replace the backend persistence
model.

The viewport is restored from the Board record and saved after a completed pan
or zoom gesture. Placement position and size are saved after the corresponding
drag or resize interaction.

## Creation paths

The Board creation wizard supports:

- a clean Board;
- the Simple Agent starter;
- the Vector Store RAG starter;
- another starter selected from the gallery.

Starter bootstrap can create the Board, automation, and initial Placement as
one command. Board-scoped chat creation creates the ChatThread and Placement as
one command. Board-scoped automation creation creates the Flow and Placement as
one command. These command routes require an `Idempotency-Key` header so a
client retry can reuse the original result instead of creating a duplicate.

## Board content

### Notes

Note CRUD and preview operate on the note record; move and resize operate on
its Placement. A note update carries its expected revision. When the server
has a newer note, the client preserves the unsaved draft while it reports the
conflict instead of silently overwriting it.

### Chats

Project chats can be created or placed on a Board. A Chat placement keeps the
durable ChatThread identity separate from the visual Placement identity. Chat
cards support normal, collapsed, and maximized views. Archiving a ChatThread
excludes it from active-thread lists. The Board UI's Archive action also
removes the current Placement; archiving the ChatThread through its API does
not itself delete a Placement.

### Automations and results

An Automation placement references a Flow. The Board can open that Flow in the
automation editor with a return context, start a Board-scoped run, list or
inspect its jobs, and place a terminal job result back on the Canvas. Result
placements do not replace the underlying persisted job record.

## Representative API surface

Board lifecycle:

- `POST /api/v1/projects/{project_id}/boards`;
- `POST /api/v1/projects/{project_id}/boards/bootstrap`;
- `GET /api/v1/projects/{project_id}/boards`;
- `GET`, `PATCH`, and `DELETE /api/v1/boards/{board_id}`;
- `PUT /api/v1/boards/{board_id}/viewport`.

Board entities and commands:

- `GET` and `POST /api/v1/boards/{board_id}/placements`;
- `PATCH` and `DELETE /api/v1/placements/{placement_id}`;
- `POST /api/v1/boards/{board_id}/chats`;
- `POST /api/v1/boards/{board_id}/automations`;
- Board-note routes below `/api/v1/board-notes` and
  `/api/v1/boards/{board_id}/board-notes`;
- Board automation-run routes below
  `/api/v1/boards/{board_id}/automations/{flow_id}/runs`.

These routes require the authenticated active user and enforce Board and
Project ownership.

Deleting a Board removes that Board and its Placements. The referenced notes,
chats, Flows, automation runs, and job-result records are separate targets and
are not deleted by the Board deletion.

## Canvas interaction

The current Canvas supports:

- pan, zoom, and viewport reset;
- moving and resizing placements;
- collapse, maximize, restore, and close actions;
- a minimap and explicit Canvas focus entry;
- returning from the automation editor to the originating Board context.

Keyboard behavior includes Canvas focus entry and return, arrow-key panning,
larger Shift-modified panning, bounded zoom controls, and viewport reset.

## Current limitations

The Board workspace is part of an active alpha. The current contract does not
claim production-grade real-time multi-user collaboration or unlimited Canvas
scale. Additional PostgreSQL-backed multi-client hardening, broader browser
validation, and deployment-specific verification remain development work.

## Related references

- [Ketos project overview](https://github.com/factor241/Ketos#readme)
- [Development guide](https://github.com/factor241/Ketos/blob/main/DEVELOPMENT.md)
- [React Flow component API](https://reactflow.dev/api-reference/react-flow)
- [FastAPI bigger applications](https://fastapi.tiangolo.com/tutorial/bigger-applications/)
- [Alembic operations](https://alembic.sqlalchemy.org/en/latest/ops.html)
