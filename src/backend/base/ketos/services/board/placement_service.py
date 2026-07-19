import math
from datetime import datetime, timezone
from typing import Protocol
from uuid import UUID

from sqlalchemy import delete, update
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ketos.services.board.exceptions import (
    BoardResourceNotFoundError,
    PlacementAlreadyExistsError,
    StaleRevisionError,
    TargetKindNotAvailableError,
)
from ketos.services.board.target_validation import validate_placement_target
from ketos.services.database.models.board.model import Board
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.placement.model import (
    Placement,
    PlacementDisplayState,
    PlacementTargetKind,
)

MIN_COORDINATE = -1_000_000
MAX_COORDINATE = 1_000_000
MIN_WIDTH = 240
MAX_WIDTH = 1600
MIN_HEIGHT = 160
MAX_HEIGHT = 1200
MAX_Z_INDEX = 1_000_000
_REVISION_ERROR = "expected_revision must be a non-negative integer"
_EMPTY_PATCH_ERROR = "placement patch must change at least one field"
_PLACEMENT_UNIQUE_CONSTRAINT = "uq_placement_board_target"


class PlacementGeometryInput(Protocol):
    x: float
    y: float
    width: float
    height: float
    z_index: int


class PlacementPatchInput(Protocol):
    x: float | None
    y: float | None
    width: float | None
    height: float | None
    z_index: int | None
    display_state: PlacementDisplayState | None


def _validate_finite_range(value: object, *, field: str, minimum: float, maximum: float) -> float:
    message = f"{field} must be a finite number between {minimum:g} and {maximum:g}"
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(message)
    number = float(value)
    if not math.isfinite(number) or not minimum <= number <= maximum:
        raise ValueError(message)
    return number


def _validate_z_index(value: object) -> int:
    message = "z_index must be an integer between 0 and 1000000"
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(message)
    if not 0 <= value <= MAX_Z_INDEX:
        raise ValueError(message)
    return value


def _validate_revision(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(_REVISION_ERROR)
    return value


def _is_duplicate_placement_error(error: IntegrityError) -> bool:
    constraint_name = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
    if constraint_name == _PLACEMENT_UNIQUE_CONSTRAINT:
        return True
    message = str(error.orig).lower()
    return "unique constraint failed" in message and all(
        column in message for column in ("placement.board_id", "placement.target_kind", "placement.target_id")
    )


def _geometry_values(geometry: PlacementGeometryInput) -> dict[str, object]:
    return {
        "x": _validate_finite_range(geometry.x, field="x", minimum=MIN_COORDINATE, maximum=MAX_COORDINATE),
        "y": _validate_finite_range(geometry.y, field="y", minimum=MIN_COORDINATE, maximum=MAX_COORDINATE),
        "width": _validate_finite_range(geometry.width, field="width", minimum=MIN_WIDTH, maximum=MAX_WIDTH),
        "height": _validate_finite_range(geometry.height, field="height", minimum=MIN_HEIGHT, maximum=MAX_HEIGHT),
        "z_index": _validate_z_index(geometry.z_index),
    }


def _patch_values(patch: PlacementPatchInput) -> dict[str, object]:
    values: dict[str, object] = {}
    ranges = {
        "x": (MIN_COORDINATE, MAX_COORDINATE),
        "y": (MIN_COORDINATE, MAX_COORDINATE),
        "width": (MIN_WIDTH, MAX_WIDTH),
        "height": (MIN_HEIGHT, MAX_HEIGHT),
    }
    for field, (minimum, maximum) in ranges.items():
        value = getattr(patch, field)
        if value is not None:
            values[field] = _validate_finite_range(value, field=field, minimum=minimum, maximum=maximum)
    if patch.z_index is not None:
        values["z_index"] = _validate_z_index(patch.z_index)
    if patch.display_state is not None:
        try:
            values["display_state"] = PlacementDisplayState(patch.display_state)
        except ValueError as exc:
            message = "display_state is not supported"
            raise ValueError(message) from exc
    if not values:
        raise ValueError(_EMPTY_PATCH_ERROR)
    return values


async def require_owned_board(session: AsyncSession, *, board_id: UUID, actor_id: UUID) -> Board:
    result = await session.exec(
        select(Board)
        .join(Folder, Board.project_id == Folder.id)
        .where(Board.id == board_id, Folder.user_id == actor_id)
    )
    board = result.first()
    if board is None:
        raise BoardResourceNotFoundError(board_id)
    return board


async def get_owned_placement(session: AsyncSession, *, placement_id: UUID, actor_id: UUID) -> Placement:
    result = await session.exec(
        select(Placement)
        .join(Board, Placement.board_id == Board.id)
        .join(Folder, Board.project_id == Folder.id)
        .where(Placement.id == placement_id, Folder.user_id == actor_id)
        .execution_options(populate_existing=True)
    )
    placement = result.first()
    if placement is None:
        raise BoardResourceNotFoundError(placement_id)
    return placement


async def list_placements(session: AsyncSession, *, board_id: UUID, actor_id: UUID) -> list[Placement]:
    await require_owned_board(session, board_id=board_id, actor_id=actor_id)
    result = await session.exec(
        select(Placement).where(Placement.board_id == board_id).order_by(Placement.z_index, Placement.id)
    )
    return list(result.all())


async def create_placement(
    session: AsyncSession,
    *,
    board_id: UUID,
    actor_id: UUID,
    target_kind: PlacementTargetKind,
    target_id: UUID,
    geometry: PlacementGeometryInput,
) -> Placement:
    board = await require_owned_board(session, board_id=board_id, actor_id=actor_id)
    try:
        normalized_kind = PlacementTargetKind(target_kind)
    except (TypeError, ValueError) as exc:
        raise TargetKindNotAvailableError(target_kind) from exc
    await validate_placement_target(
        session,
        board=board,
        target_kind=normalized_kind,
        target_id=target_id,
        actor_id=actor_id,
    )
    placement = Placement.model_validate(
        {
            "board_id": board_id,
            "target_kind": normalized_kind,
            "target_id": target_id,
            **_geometry_values(geometry),
        }
    )
    session.add(placement)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        if _is_duplicate_placement_error(exc):
            raise PlacementAlreadyExistsError(target_id) from exc
        raise
    await session.refresh(placement)
    return placement


async def update_placement_cas(
    session: AsyncSession,
    *,
    placement_id: UUID,
    actor_id: UUID,
    expected_revision: int,
    patch: PlacementPatchInput,
) -> Placement:
    revision = _validate_revision(expected_revision)
    values = _patch_values(patch)
    await get_owned_placement(session, placement_id=placement_id, actor_id=actor_id)
    result = await session.exec(
        update(Placement)
        .where(Placement.id == placement_id, Placement.revision == revision)
        .values(**values, revision=Placement.revision + 1, updated_at=datetime.now(timezone.utc))
    )
    if result.rowcount != 1:
        await session.rollback()
        await get_owned_placement(session, placement_id=placement_id, actor_id=actor_id)
        raise StaleRevisionError(placement_id)
    await session.commit()
    return await get_owned_placement(session, placement_id=placement_id, actor_id=actor_id)


async def delete_placement_cas(
    session: AsyncSession,
    *,
    placement_id: UUID,
    actor_id: UUID,
    expected_revision: int,
) -> None:
    revision = _validate_revision(expected_revision)
    await get_owned_placement(session, placement_id=placement_id, actor_id=actor_id)
    result = await session.exec(delete(Placement).where(Placement.id == placement_id, Placement.revision == revision))
    if result.rowcount != 1:
        await session.rollback()
        await get_owned_placement(session, placement_id=placement_id, actor_id=actor_id)
        raise StaleRevisionError(placement_id)
    await session.commit()
