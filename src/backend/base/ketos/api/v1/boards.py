from collections.abc import Awaitable, Callable
from typing import Annotated, TypeVar
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response, status

from ketos.api.utils import CurrentActiveUser, DbSession
from ketos.api.v1.schemas.board import BoardCreate, BoardPatch, BoardRead, BoardViewportUpdate
from ketos.services.board.service import (
    BoardNotFoundError,
    BoardRevisionConflictError,
    create_board,
    delete_board,
    get_owned_board,
    list_boards,
    rename_board,
    update_board_viewport,
)

router = APIRouter(tags=["Boards"])
T = TypeVar("T")


async def _run_service(call: Callable[[], Awaitable[T]]) -> T:
    try:
        return await call()
    except BoardNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "board_not_found"}) from exc
    except BoardRevisionConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": exc.code}) from exc
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail={"code": "board_validation_error"}) from exc


@router.post(
    "/projects/{project_id}/boards",
    status_code=status.HTTP_201_CREATED,
)
async def create_project_board(
    project_id: UUID, payload: BoardCreate, session: DbSession, current_user: CurrentActiveUser
) -> BoardRead:
    board = await _run_service(
        lambda: create_board(session, project_id=project_id, actor_id=current_user.id, title=payload.title)
    )
    return BoardRead.model_validate(board, from_attributes=True)


@router.get("/projects/{project_id}/boards")
async def read_project_boards(project_id: UUID, session: DbSession, current_user: CurrentActiveUser) -> list[BoardRead]:
    boards = await _run_service(lambda: list_boards(session, project_id=project_id, actor_id=current_user.id))
    return [BoardRead.model_validate(board, from_attributes=True) for board in boards]


@router.get("/boards/{board_id}")
async def read_board(board_id: UUID, session: DbSession, current_user: CurrentActiveUser) -> BoardRead:
    board = await _run_service(lambda: get_owned_board(session, board_id=board_id, actor_id=current_user.id))
    return BoardRead.model_validate(board, from_attributes=True)


@router.patch("/boards/{board_id}")
async def patch_board(
    board_id: UUID, payload: BoardPatch, session: DbSession, current_user: CurrentActiveUser
) -> BoardRead:
    board = await _run_service(
        lambda: rename_board(
            session,
            board_id=board_id,
            actor_id=current_user.id,
            title=payload.title,
            expected_revision=payload.expected_revision,
        )
    )
    return BoardRead.model_validate(board, from_attributes=True)


@router.put("/boards/{board_id}/viewport")
async def put_board_viewport(
    board_id: UUID, payload: BoardViewportUpdate, session: DbSession, current_user: CurrentActiveUser
) -> BoardRead:
    board = await _run_service(
        lambda: update_board_viewport(session, board_id=board_id, actor_id=current_user.id, viewport=payload)
    )
    return BoardRead.model_validate(board, from_attributes=True)


@router.delete("/boards/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_board(
    board_id: UUID,
    expected_revision: Annotated[int, Query(ge=0)],
    session: DbSession,
    current_user: CurrentActiveUser,
) -> Response:
    await _run_service(
        lambda: delete_board(
            session,
            board_id=board_id,
            actor_id=current_user.id,
            expected_revision=expected_revision,
        )
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
