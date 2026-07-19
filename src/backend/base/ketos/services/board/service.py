import math
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import delete, update
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ketos.api.v1.schemas.board import BoardViewportUpdate
from ketos.services.database.models.board.model import Board
from ketos.services.database.models.folder.model import Folder


class BoardNotFoundError(Exception):
    """Raised when a board or its owning project is not visible to the actor."""


class BoardRevisionConflictError(Exception):
    """Raised when a conditional board mutation loses a revision race."""

    code = "board_revision_conflict"

    def __init__(self, board_id: UUID):
        super().__init__(f"Board {board_id} revision conflict")
        self.board_id = board_id


def _validate_title(title: str) -> str:
    if not isinstance(title, str):
        raise ValueError("title must be a string")
    clean_title = title.strip()
    if not 1 <= len(clean_title) <= 255:
        raise ValueError("title must contain between 1 and 255 characters")
    return clean_title


def _validate_expected_revision(expected_revision: int) -> int:
    if isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 0:
        raise ValueError("expected_revision must be a non-negative integer")
    return expected_revision


def _validate_finite_number(value: float, field_name: str) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be a finite number")
    try:
        validated = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be a finite number") from exc
    if not math.isfinite(validated):
        raise ValueError(f"{field_name} must be a finite number")
    return validated


async def require_owned_project(session: AsyncSession, project_id: UUID, actor_id: UUID) -> Folder:
    project = (
        await session.exec(select(Folder).where(Folder.id == project_id, Folder.user_id == actor_id))
    ).first()
    if project is None:
        raise BoardNotFoundError(f"Project {project_id} was not found")
    return project


async def list_boards(session: AsyncSession, project_id: UUID, actor_id: UUID) -> list[Board]:
    await require_owned_project(session, project_id=project_id, actor_id=actor_id)
    result = await session.exec(
        select(Board).where(Board.project_id == project_id).order_by(Board.created_at, Board.id)
    )
    return list(result.all())


async def create_board(session: AsyncSession, project_id: UUID, actor_id: UUID, title: str) -> Board:
    clean_title = _validate_title(title)
    await require_owned_project(session, project_id=project_id, actor_id=actor_id)
    board = Board(project_id=project_id, created_by_id=actor_id, title=clean_title)
    session.add(board)
    await session.commit()
    await session.refresh(board)
    return board


async def get_owned_board(session: AsyncSession, board_id: UUID, actor_id: UUID) -> Board:
    result = await session.exec(
        select(Board)
        .join(Folder, Board.project_id == Folder.id)
        .where(Board.id == board_id, Folder.user_id == actor_id)
    )
    board = result.first()
    if board is None:
        raise BoardNotFoundError(f"Board {board_id} was not found")
    return board


async def rename_board(
    session: AsyncSession, board_id: UUID, actor_id: UUID, title: str, expected_revision: int
) -> Board:
    clean_title = _validate_title(title)
    revision = _validate_expected_revision(expected_revision)
    await get_owned_board(session, board_id=board_id, actor_id=actor_id)
    result = await session.exec(
        update(Board)
        .where(Board.id == board_id, Board.revision == revision)
        .values(title=clean_title, revision=Board.revision + 1, updated_at=datetime.now(timezone.utc))
    )
    if result.rowcount != 1:
        await session.rollback()
        raise BoardRevisionConflictError(board_id)
    await session.commit()
    return await get_owned_board(session, board_id=board_id, actor_id=actor_id)


async def update_board_viewport(
    session: AsyncSession, board_id: UUID, actor_id: UUID, viewport: BoardViewportUpdate
) -> Board:
    x = _validate_finite_number(viewport.x, "x")
    y = _validate_finite_number(viewport.y, "y")
    zoom = _validate_finite_number(viewport.zoom, "zoom")
    revision = _validate_expected_revision(viewport.expected_revision)
    if not 0.5 <= zoom <= 2.0:
        raise ValueError("zoom must be between 0.5 and 2")
    await get_owned_board(session, board_id=board_id, actor_id=actor_id)
    result = await session.exec(
        update(Board)
        .where(Board.id == board_id, Board.revision == revision)
        .values(
            viewport_x=x,
            viewport_y=y,
            viewport_zoom=zoom,
            revision=Board.revision + 1,
            updated_at=datetime.now(timezone.utc),
        )
    )
    if result.rowcount != 1:
        await session.rollback()
        raise BoardRevisionConflictError(board_id)
    await session.commit()
    return await get_owned_board(session, board_id=board_id, actor_id=actor_id)


async def delete_board(
    session: AsyncSession, board_id: UUID, actor_id: UUID, expected_revision: int
) -> None:
    revision = _validate_expected_revision(expected_revision)
    await get_owned_board(session, board_id=board_id, actor_id=actor_id)
    result = await session.exec(delete(Board).where(Board.id == board_id, Board.revision == revision))
    if result.rowcount != 1:
        await session.rollback()
        raise BoardRevisionConflictError(board_id)
    await session.commit()
