from collections.abc import Awaitable, Callable
from typing import Annotated, TypeVar
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response, status

from ketos.api.utils import CurrentActiveUser, DbSession
from ketos.api.v1.schemas.board_entities import (
    BoardNoteCreate,
    BoardNoteCreateResponse,
    BoardNotePatch,
    BoardNoteRead,
    PlacementRead,
)
from ketos.services.board.exceptions import (
    BoardResourceNotFoundError,
    PlacementAlreadyExistsError,
    StaleRevisionError,
    TargetKindNotAvailableError,
    TargetProjectMismatchError,
    UnsafeMarkdownError,
)
from ketos.services.board.note_service import (
    create_note_with_placement,
    delete_note_cas,
    list_board_notes,
    require_owned_note,
    update_note_cas,
)

router = APIRouter(tags=["Board notes"])
T = TypeVar("T")


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


@router.get("/projects/{project_id}/board-notes")
async def read_project_board_notes(
    project_id: UUID, session: DbSession, current_user: CurrentActiveUser
) -> list[BoardNoteRead]:
    notes = await _run_service(lambda: list_board_notes(session, project_id=project_id, actor_id=current_user.id))
    return [BoardNoteRead.model_validate(note, from_attributes=True) for note in notes]


@router.post("/boards/{board_id}/board-notes", status_code=status.HTTP_201_CREATED)
async def create_board_note(
    board_id: UUID,
    payload: BoardNoteCreate,
    session: DbSession,
    current_user: CurrentActiveUser,
) -> BoardNoteCreateResponse:
    note, placement = await _run_service(
        lambda: create_note_with_placement(
            session,
            board_id=board_id,
            actor_id=current_user.id,
            note_input=payload,
            placement_input=payload.placement,
        )
    )
    return BoardNoteCreateResponse(
        note=BoardNoteRead.model_validate(note, from_attributes=True),
        placement=PlacementRead.model_validate(placement, from_attributes=True),
    )


@router.get("/board-notes/{note_id}")
async def read_board_note(note_id: UUID, session: DbSession, current_user: CurrentActiveUser) -> BoardNoteRead:
    note = await _run_service(lambda: require_owned_note(session, note_id=note_id, actor_id=current_user.id))
    return BoardNoteRead.model_validate(note, from_attributes=True)


@router.patch("/board-notes/{note_id}")
async def patch_board_note(
    note_id: UUID,
    payload: BoardNotePatch,
    session: DbSession,
    current_user: CurrentActiveUser,
) -> BoardNoteRead:
    note = await _run_service(
        lambda: update_note_cas(
            session,
            note_id=note_id,
            actor_id=current_user.id,
            expected_revision=payload.expected_revision,
            patch=payload,
        )
    )
    return BoardNoteRead.model_validate(note, from_attributes=True)


@router.delete("/board-notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_board_note(
    note_id: UUID,
    expected_revision: Annotated[int, Query(ge=0)],
    confirm_entity_delete: Annotated[bool, Query()],
    session: DbSession,
    current_user: CurrentActiveUser,
) -> Response:
    if not confirm_entity_delete:
        raise HTTPException(status_code=422, detail={"code": "board_entity_validation_error"})
    await _run_service(
        lambda: delete_note_cas(
            session,
            note_id=note_id,
            actor_id=current_user.id,
            expected_revision=expected_revision,
        )
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
