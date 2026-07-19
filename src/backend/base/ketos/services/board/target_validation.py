from uuid import UUID

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ketos.services.board.exceptions import (
    BoardResourceNotFoundError,
    TargetKindNotAvailableError,
    TargetProjectMismatchError,
)
from ketos.services.database.models.board.model import Board
from ketos.services.database.models.board_note.model import BoardNote
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.placement.model import PlacementTargetKind


async def validate_placement_target(
    session: AsyncSession,
    *,
    board: Board,
    target_kind: PlacementTargetKind,
    target_id: UUID,
    actor_id: UUID,
) -> BoardNote:
    try:
        normalized_kind = PlacementTargetKind(target_kind)
    except (TypeError, ValueError) as exc:
        raise TargetKindNotAvailableError(target_kind) from exc
    if normalized_kind is not PlacementTargetKind.NOTE:
        raise TargetKindNotAvailableError(normalized_kind)

    result = await session.exec(
        select(BoardNote)
        .join(Folder, BoardNote.project_id == Folder.id)
        .where(BoardNote.id == target_id, Folder.user_id == actor_id)
    )
    note = result.first()
    if note is None:
        raise BoardResourceNotFoundError(target_id)
    if note.project_id != board.project_id:
        raise TargetProjectMismatchError(target_id)
    return note
