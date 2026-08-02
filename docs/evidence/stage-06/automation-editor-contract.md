# Stage 06 Automation Editor Contract

## Identity and bounded projection

Automation is the existing `Flow` domain object. Stage 06 introduces no Automation table, migration, editor, runtime, job, result, store, or save path.

The frozen Board projection is exactly:

```ts
type AutomationSummary = Readonly<{
  id: string;
  name: string;
  description: string | null;
}>;
```

It is served by the existing `GET /api/v1/flows/` route with `automation_summaries=true&folder_id={projectId}`. The server filters by authenticated owner, exact Project folder, and `is_component=false`. The frontend mapper returns only `id`, `name`, and `description`; it never receives or caches `Flow.data`, components, status, node count, or secrets.

## URLs

Canonical editor URL:

```text
/flow/{flowId}?returnBoardId={boardId}&returnPlacementId={placementId}
```

Canonical validated return URL:

```text
/project/{projectId}/board/{boardId}?focusPlacementId={placementId}
```

Both return identifiers must appear exactly once and must be UUIDs. A `returnTo` parameter, a partial pair, duplicate parameters, malformed UUIDs, route state, and local storage are not accepted as return authority.

## Authoritative return validation

The existing authenticated API validates the URL pair:

```text
GET /api/v1/boards/{boardId}/placements/{placementId}/automation-editor-context?flow_id={flowId}
```

Successful response is a frozen, extra-forbidden four-ID DTO:

```json
{
  "project_id": "UUID",
  "board_id": "UUID",
  "placement_id": "UUID",
  "flow_id": "UUID"
}
```

| Case | Result |
| --- | --- |
| Board owned by actor, Placement is Automation on Board, Flow is the target, ordinary Flow belongs to the same Project | exact four-ID response |
| Missing or foreign Board | uniform not-found denial |
| Missing, foreign, wrong-Board, wrong-kind, NULL-target, or mismatched Placement | uniform not-found denial |
| Missing, foreign, component, NULL-folder, or wrong-Project Flow | uniform not-found denial |
| Forged actor/user value in client input | ignored; authenticated current user is authoritative |

Closing a Placement removes only the Placement. It does not delete the Flow.

## Creation and re-placement

- Existing selection places the selected Flow once.
- Create receives an explicit `targetProjectId`; it creates the Flow with `folder_id=targetProjectId`, then creates one Automation Placement.
- `myCollectionId` is not a fallback when the Board Project is supplied.
- Re-place uses the same `Flow.id`; it does not duplicate or delete the Flow.
- Failed placement remains visible as an explicit error and is never repaired by a hidden destructive action.

## Editor, dirty state, save, return, and focus

- Edit opens the existing fullscreen `FlowPage` at `/flow/{id}` in the same tab.
- `FlowPage`, its existing Flow store, `useSaveFlow`, save API, keyboard shortcut, and navigation blocker remain the only editor/save path.
- The Return control is rendered only after the server-authoritative four-ID response exactly matches the route Flow and URL pair.
- A dirty or building Flow blocks Return through the existing `useBlocker` path.
- Save success calls `blocker.proceed()`; save rejection preserves the pending Board location and does not navigate.
- Cancel calls `blocker.reset()` and restores focus to the Return control.
- Metadata-only, empty-Flow, and last-node edits use the shared `useUnsavedChanges` predicate.
- On Board return, `focusPlacementId` restores keyboard focus to the same Placement without changing its geometry.

## Actual source paths

Backend:

- `src/backend/base/ketos/api/v1/flows.py`
- `src/backend/base/ketos/api/v1/placements.py`
- `src/backend/base/ketos/services/board/service.py`
- `src/backend/base/ketos/services/board/target_validation.py`
- `src/backend/base/ketos/services/database/models/flow/model.py`

Frontend:

- `src/frontend/src/types/flow/automation.ts`
- `src/frontend/src/controllers/API/queries/flows/use-get-automation-summaries.ts`
- `src/frontend/src/components/core/automations/AutomationSelector.tsx`
- `src/frontend/src/components/core/board/placements/AutomationPlacement.tsx`
- `src/frontend/src/components/core/board/placements/AutomationPreview.tsx`
- `src/frontend/src/pages/BoardPage/index.tsx`
- `src/frontend/src/pages/BoardPage/hooks/use-automation-placement-actions.ts`
- `src/frontend/src/pages/BoardPage/hooks/use-open-automation-editor.ts`
- `src/frontend/src/pages/BoardPage/hooks/use-board-return-focus.ts`
- `src/frontend/src/utils/automation-editor-route.ts`
- `src/frontend/src/pages/FlowPage/hooks/use-board-return-context.ts`
- `src/frontend/src/components/core/appHeaderComponent/components/FlowMenu/index.tsx`
- `src/frontend/src/pages/FlowPage/index.tsx`

Acceptance:

- `src/frontend/tests/core/features/board-automation-editor.spec.ts`

## Explicit non-goals and Stage 07 handoff

Stage 06 does not implement Run, Job, Result, execution status, embedded editor, raw graph preview, new Automation persistence, or cross-origin/arbitrary return navigation. Run remains disabled with an adjacent localized explanation. Stage 07 may begin only after Stage 06 has a complete internal `PASS`; the Stage 06 report currently controls that decision.
