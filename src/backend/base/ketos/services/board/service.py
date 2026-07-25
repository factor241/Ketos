import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol
from uuid import UUID

from sqlalchemy import delete, update
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ketos.services.board.exceptions import BoardResourceNotFoundError
from ketos.services.database.models.board.model import Board
from ketos.services.database.models.flow.model import Flow
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.placement.model import Placement, PlacementTargetKind

TITLE_MAX_LENGTH = 255
MIN_ZOOM = 0.5
MAX_ZOOM = 2.0
_TITLE_TYPE_ERROR = "title must be a string"
_TITLE_LENGTH_ERROR = "title must contain between 1 and 255 characters"
_REVISION_ERROR = "expected_revision must be a non-negative integer"
_ZOOM_RANGE_ERROR = "zoom must be between 0.5 and 2"


class _BoardViewportInput(Protocol):
    x: float
    y: float
    zoom: float
    expected_revision: int


class BoardNotFoundError(Exception):
    """Raised when a board or its owning project is not visible to the actor."""


class BoardRevisionConflictError(Exception):
    """Raised when a conditional board mutation loses a revision race."""

    code = "board_revision_conflict"

    def __init__(self, board_id: UUID):
        super().__init__(f"Board {board_id} revision conflict")
        self.board_id = board_id


@dataclass(frozen=True, slots=True)
class AutomationReturnContext:
    project_id: UUID
    board_id: UUID
    placement_id: UUID
    flow_id: UUID


async def validate_automation_target(
    session: AsyncSession,
    *,
    board: Board,
    flow_id: UUID,
    actor_id: UUID,
) -> Flow:
    flow = (
        await session.exec(
            select(Flow).where(
                Flow.id == flow_id,
                Flow.user_id == actor_id,
                Flow.folder_id == board.project_id,
                Flow.is_component == False,  # noqa: E712
            )
        )
    ).first()
    if flow is None:
        raise BoardResourceNotFoundError(flow_id)
    return flow


async def resolve_automation_return_context(
    session: AsyncSession,
    *,
    board_id: UUID,
    placement_id: UUID,
    flow_id: UUID,
    actor_id: UUID,
) -> AutomationReturnContext:
    board = (
        await session.exec(
            select(Board)
            .join(Folder, Board.project_id == Folder.id)
            .where(Board.id == board_id, Folder.user_id == actor_id)
        )
    ).first()
    if board is None:
        raise BoardResourceNotFoundError(board_id)

    placement = (
        await session.exec(
            select(Placement).where(
                Placement.id == placement_id,
                Placement.board_id == board_id,
                Placement.target_kind == PlacementTargetKind.AUTOMATION,
                Placement.target_id == flow_id,
            )
        )
    ).first()
    if placement is None:
        raise BoardResourceNotFoundError(placement_id)

    flow = await validate_automation_target(
        session,
        board=board,
        flow_id=flow_id,
        actor_id=actor_id,
    )
    return AutomationReturnContext(
        project_id=board.project_id,
        board_id=board.id,
        placement_id=placement.id,
        flow_id=flow.id,
    )


def _validate_title(title: str) -> str:
    if not isinstance(title, str):
        raise TypeError(_TITLE_TYPE_ERROR)
    clean_title = title.strip()
    if not 1 <= len(clean_title) <= TITLE_MAX_LENGTH:
        raise ValueError(_TITLE_LENGTH_ERROR)
    return clean_title


def _validate_expected_revision(expected_revision: int) -> int:
    if isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 0:
        raise ValueError(_REVISION_ERROR)
    return expected_revision


def _validate_finite_number(value: float, field_name: str) -> float:
    error_message = f"{field_name} must be a finite number"
    if isinstance(value, bool):
        raise TypeError(error_message)
    try:
        validated = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(error_message) from exc
    if not math.isfinite(validated):
        raise ValueError(error_message)
    return validated


async def require_owned_project(session: AsyncSession, project_id: UUID, actor_id: UUID) -> Folder:
    project = (await session.exec(select(Folder).where(Folder.id == project_id, Folder.user_id == actor_id))).first()
    if project is None:
        raise BoardNotFoundError
    return project


async def list_boards(session: AsyncSession, project_id: UUID, actor_id: UUID) -> list[Board]:
    await require_owned_project(session, project_id=project_id, actor_id=actor_id)
    result = await session.exec(
        select(Board).where(Board.project_id == project_id).order_by(Board.created_at, Board.id)
    )
    return list(result.all())


async def create_board_uncommitted(
    session: AsyncSession,
    project_id: UUID,
    actor_id: UUID,
    title: str,
    *,
    board_id: UUID | None = None,
    project_validated: bool = False,
) -> Board:
    clean_title = _validate_title(title)
    if not project_validated:
        await require_owned_project(session, project_id=project_id, actor_id=actor_id)
    board = Board(project_id=project_id, created_by_id=actor_id, title=clean_title)
    if board_id is not None:
        board.id = board_id
    session.add(board)
    await session.flush()
    await session.refresh(board)
    return board


async def create_board(session: AsyncSession, project_id: UUID, actor_id: UUID, title: str) -> Board:
    board = await create_board_uncommitted(
        session,
        project_id=project_id,
        actor_id=actor_id,
        title=title,
    )
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
        raise BoardNotFoundError
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
    session: AsyncSession, board_id: UUID, actor_id: UUID, viewport: _BoardViewportInput
) -> Board:
    x = _validate_finite_number(viewport.x, "x")
    y = _validate_finite_number(viewport.y, "y")
    zoom = _validate_finite_number(viewport.zoom, "zoom")
    revision = _validate_expected_revision(viewport.expected_revision)
    if not MIN_ZOOM <= zoom <= MAX_ZOOM:
        raise ValueError(_ZOOM_RANGE_ERROR)
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


async def delete_board(session: AsyncSession, board_id: UUID, actor_id: UUID, expected_revision: int) -> None:
    revision = _validate_expected_revision(expected_revision)
    await get_owned_board(session, board_id=board_id, actor_id=actor_id)
    result = await session.exec(delete(Board).where(Board.id == board_id, Board.revision == revision))
    if result.rowcount != 1:
        await session.rollback()
        raise BoardRevisionConflictError(board_id)
    await session.commit()
