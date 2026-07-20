from collections.abc import Awaitable, Callable
from typing import Annotated, TypeVar
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict

from ketos.api.utils import CurrentActiveUser, DbSession
from ketos.api.v1.schemas.board_entities import PlacementCreate, PlacementPatch, PlacementRead
from ketos.services.board.exceptions import (
    BoardResourceNotFoundError,
    PlacementAlreadyExistsError,
    StaleRevisionError,
    TargetKindNotAvailableError,
    TargetProjectMismatchError,
    UnsafeMarkdownError,
)
from ketos.services.board.placement_service import (
    create_placement,
    delete_placement_cas,
    list_placements,
    update_placement_cas,
)
from ketos.services.board.service import resolve_automation_return_context

router = APIRouter(tags=["Board placements"])
T = TypeVar("T")


class AutomationEditorContextRead(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    project_id: UUID
    board_id: UUID
    placement_id: UUID
    flow_id: UUID


async def _run_service(call: Callable[[], Awaitable[T]]) -> T:
    try:
        return await call()
    except BoardResourceNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"code": exc.code}) from exc
    except (StaleRevisionError, PlacementAlreadyExistsError) as exc:
        raise HTTPException(status_code=409, detail={"code": exc.code}) from exc
    except (TargetKindNotAvailableError, TargetProjectMismatchError, UnsafeMarkdownError) as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code}) from exc
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail={"code": "board_entity_validation_error"}) from exc


@router.get("/boards/{board_id}/placements")
async def read_board_placements(
    board_id: UUID, session: DbSession, current_user: CurrentActiveUser
) -> list[PlacementRead]:
    placements = await _run_service(lambda: list_placements(session, board_id=board_id, actor_id=current_user.id))
    return [PlacementRead.model_validate(placement, from_attributes=True) for placement in placements]


@router.get("/boards/{board_id}/placements/{placement_id}/automation-editor-context")
async def read_automation_editor_context(
    board_id: UUID,
    placement_id: UUID,
    flow_id: Annotated[UUID, Query()],
    session: DbSession,
    current_user: CurrentActiveUser,
) -> AutomationEditorContextRead:
    context = await _run_service(
        lambda: resolve_automation_return_context(
            session,
            board_id=board_id,
            placement_id=placement_id,
            flow_id=flow_id,
            actor_id=current_user.id,
        )
    )
    return AutomationEditorContextRead(
        project_id=context.project_id,
        board_id=context.board_id,
        placement_id=context.placement_id,
        flow_id=context.flow_id,
    )


@router.post("/boards/{board_id}/placements", status_code=status.HTTP_201_CREATED)
async def create_board_placement(
    board_id: UUID,
    payload: PlacementCreate,
    session: DbSession,
    current_user: CurrentActiveUser,
) -> PlacementRead:
    placement = await _run_service(
        lambda: create_placement(
            session,
            board_id=board_id,
            actor_id=current_user.id,
            target_kind=payload.target_kind,
            target_id=payload.target_id,
            geometry=payload,
        )
    )
    return PlacementRead.model_validate(placement, from_attributes=True)


@router.patch("/placements/{placement_id}")
async def patch_placement(
    placement_id: UUID,
    payload: PlacementPatch,
    session: DbSession,
    current_user: CurrentActiveUser,
) -> PlacementRead:
    placement = await _run_service(
        lambda: update_placement_cas(
            session,
            placement_id=placement_id,
            actor_id=current_user.id,
            expected_revision=payload.expected_revision,
            patch=payload,
        )
    )
    return PlacementRead.model_validate(placement, from_attributes=True)


@router.delete("/placements/{placement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_placement(
    placement_id: UUID,
    expected_revision: Annotated[int, Query(ge=0)],
    session: DbSession,
    current_user: CurrentActiveUser,
) -> Response:
    await _run_service(
        lambda: delete_placement_cas(
            session,
            placement_id=placement_id,
            actor_id=current_user.id,
            expected_revision=expected_revision,
        )
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
