import html
import math
import re
from datetime import datetime, timezone
from typing import Protocol
from urllib.parse import unquote, urlsplit
from uuid import UUID

from sqlalchemy import delete, update
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ketos.services.board.exceptions import (
    BoardResourceNotFoundError,
    PlacementAlreadyExistsError,
    StaleRevisionError,
    UnsafeMarkdownError,
)
from ketos.services.board.placement_service import require_owned_board
from ketos.services.database.models.board_note.model import BOARD_NOTE_COLORS, CONTENT_MAX_LENGTH, BoardNote
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.placement.model import Placement, PlacementTargetKind

_HEX_COLOR = re.compile(r"#[0-9A-Fa-f]{6}\Z")
_HTML_COMMENT = re.compile(r"<!--[\s\S]*?-->")
_HTML_TAG = re.compile(r"<\s*/?\s*(?![A-Za-z][A-Za-z0-9+.-]*:)[A-Za-z][^<>]*>")
_MARKDOWN_IMAGE = re.compile(r"!\s*\[")
_INLINE_LINK = re.compile(r"(?<!!)\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))")
_REFERENCE_LINK = re.compile(r"^\s*\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|([^\s\n]+))", re.MULTILINE)
_AUTOLINK = re.compile(r"<([^<>\s]+:[^<>\s]*)>")
_ALLOWED_LINK_SCHEMES = frozenset({"http", "https", "mailto"})
_PLACEMENT_UNIQUE_CONSTRAINT = "uq_placement_board_target"
_ASCII_CONTROL_BOUNDARY = 32
_ASCII_DELETE = 127
_MAX_Z_INDEX = 1_000_000
_REVISION_ERROR = "expected_revision must be a non-negative integer"
_EMPTY_PATCH_ERROR = "note patch must change at least one field"
_CONTENT_TYPE_ERROR = "content must be a string"
_CONTENT_LENGTH_ERROR = "content must contain at most 10000 Unicode code points"
_HTML_COMMENT_ERROR = "HTML comments are not allowed"
_RAW_HTML_ERROR = "raw HTML is not allowed"
_IMAGE_ERROR = "images are not allowed"
_CONTROL_LINK_ERROR = "link destinations cannot contain control characters"
_SCHEME_RELATIVE_ERROR = "scheme-relative links are not allowed"
_LINK_SCHEME_ERROR = "link scheme is not allowed"
_COLOR_TYPE_ERROR = "color must be a string"
_COLOR_VALUE_ERROR = "color must be a supported token or six-digit hex color"
_Z_INDEX_ERROR = "z_index must be an integer between 0 and 1000000"


class BoardNoteCreateInput(Protocol):
    content: str
    color: str


class PlacementGeometryInput(Protocol):
    x: float
    y: float
    width: float
    height: float
    z_index: int


class BoardNotePatchInput(Protocol):
    content: str | None
    color: str | None


def validate_board_note_content(content: str) -> str:
    if not isinstance(content, str):
        raise TypeError(_CONTENT_TYPE_ERROR)
    if len(content) > CONTENT_MAX_LENGTH:
        raise ValueError(_CONTENT_LENGTH_ERROR)
    if "<!--" in content or _HTML_COMMENT.search(content) is not None:
        raise UnsafeMarkdownError(_HTML_COMMENT_ERROR)
    if _HTML_TAG.search(content) is not None:
        raise UnsafeMarkdownError(_RAW_HTML_ERROR)
    if _MARKDOWN_IMAGE.search(content) is not None:
        raise UnsafeMarkdownError(_IMAGE_ERROR)

    destinations: list[str] = []
    for pattern in (_INLINE_LINK, _REFERENCE_LINK):
        destinations.extend(match.group(1) or match.group(2) for match in pattern.finditer(content))
    destinations.extend(match.group(1) for match in _AUTOLINK.finditer(content))
    for destination in destinations:
        _validate_link_destination(destination)
    return content


def _validate_link_destination(destination: str) -> None:
    normalized = html.unescape(destination.strip())
    for _ in range(3):
        decoded = unquote(normalized)
        if decoded == normalized:
            break
        normalized = decoded
    if any(ord(character) < _ASCII_CONTROL_BOUNDARY or ord(character) == _ASCII_DELETE for character in normalized):
        raise UnsafeMarkdownError(_CONTROL_LINK_ERROR)
    if normalized.startswith("#"):
        return
    if normalized.startswith("//"):
        raise UnsafeMarkdownError(_SCHEME_RELATIVE_ERROR)
    try:
        scheme = urlsplit(normalized).scheme.lower()
    except ValueError as exc:
        raise UnsafeMarkdownError(_LINK_SCHEME_ERROR) from exc
    if scheme not in _ALLOWED_LINK_SCHEMES:
        raise UnsafeMarkdownError(_LINK_SCHEME_ERROR)


def validate_board_note_color(color: str) -> str:
    if not isinstance(color, str):
        raise TypeError(_COLOR_TYPE_ERROR)
    if color not in BOARD_NOTE_COLORS and _HEX_COLOR.fullmatch(color) is None:
        raise ValueError(_COLOR_VALUE_ERROR)
    return color


def _validate_revision(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(_REVISION_ERROR)
    return value


def _finite_range(value: object, *, field: str, minimum: float, maximum: float) -> float:
    message = f"{field} must be a finite number between {minimum:g} and {maximum:g}"
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(message)
    number = float(value)
    if not math.isfinite(number) or not minimum <= number <= maximum:
        raise ValueError(message)
    return number


def _geometry_values(geometry: PlacementGeometryInput) -> dict[str, object]:
    z_index = geometry.z_index
    if isinstance(z_index, bool) or not isinstance(z_index, int) or not 0 <= z_index <= _MAX_Z_INDEX:
        raise ValueError(_Z_INDEX_ERROR)
    return {
        "x": _finite_range(geometry.x, field="x", minimum=-1_000_000, maximum=1_000_000),
        "y": _finite_range(geometry.y, field="y", minimum=-1_000_000, maximum=1_000_000),
        "width": _finite_range(geometry.width, field="width", minimum=240, maximum=1600),
        "height": _finite_range(geometry.height, field="height", minimum=160, maximum=1200),
        "z_index": z_index,
    }


def _is_duplicate_placement_error(error: IntegrityError) -> bool:
    constraint_name = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
    if constraint_name == _PLACEMENT_UNIQUE_CONSTRAINT:
        return True
    message = str(error.orig).lower()
    return "unique constraint failed" in message and all(
        column in message for column in ("placement.board_id", "placement.target_kind", "placement.target_id")
    )


async def require_owned_note(session: AsyncSession, *, note_id: UUID, actor_id: UUID) -> BoardNote:
    result = await session.exec(
        select(BoardNote)
        .join(Folder, BoardNote.project_id == Folder.id)
        .where(BoardNote.id == note_id, Folder.user_id == actor_id)
        .execution_options(populate_existing=True)
    )
    note = result.first()
    if note is None:
        raise BoardResourceNotFoundError(note_id)
    return note


async def list_board_notes(session: AsyncSession, *, project_id: UUID, actor_id: UUID) -> list[BoardNote]:
    project = (await session.exec(select(Folder).where(Folder.id == project_id, Folder.user_id == actor_id))).first()
    if project is None:
        raise BoardResourceNotFoundError(project_id)
    result = await session.exec(
        select(BoardNote)
        .where(BoardNote.project_id == project_id)
        .order_by(BoardNote.created_at, BoardNote.id)
        .execution_options(populate_existing=True)
    )
    return list(result.all())


async def create_note_with_placement(
    session: AsyncSession,
    *,
    board_id: UUID,
    actor_id: UUID,
    note_input: BoardNoteCreateInput,
    placement_input: PlacementGeometryInput,
) -> tuple[BoardNote, Placement]:
    board = await require_owned_board(session, board_id=board_id, actor_id=actor_id)
    note = BoardNote.model_validate(
        {
            "project_id": board.project_id,
            "created_by_id": actor_id,
            "content": validate_board_note_content(note_input.content),
            "color": validate_board_note_color(note_input.color),
        }
    )
    placement_values = _geometry_values(placement_input)
    session.add(note)
    await session.flush()
    placement = Placement.model_validate(
        {
            "board_id": board.id,
            "target_kind": PlacementTargetKind.NOTE,
            "target_id": note.id,
            **placement_values,
        }
    )
    session.add(placement)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        if _is_duplicate_placement_error(exc):
            raise PlacementAlreadyExistsError(note.id) from exc
        raise
    await session.refresh(note)
    await session.refresh(placement)
    return note, placement


async def update_note_cas(
    session: AsyncSession,
    *,
    note_id: UUID,
    actor_id: UUID,
    expected_revision: int,
    patch: BoardNotePatchInput,
) -> BoardNote:
    revision = _validate_revision(expected_revision)
    values: dict[str, object] = {}
    if patch.content is not None:
        values["content"] = validate_board_note_content(patch.content)
    if patch.color is not None:
        values["color"] = validate_board_note_color(patch.color)
    if not values:
        raise ValueError(_EMPTY_PATCH_ERROR)
    await require_owned_note(session, note_id=note_id, actor_id=actor_id)
    result = await session.exec(
        update(BoardNote)
        .where(BoardNote.id == note_id, BoardNote.revision == revision)
        .values(**values, revision=BoardNote.revision + 1, updated_at=datetime.now(timezone.utc))
    )
    if result.rowcount != 1:
        await session.rollback()
        await require_owned_note(session, note_id=note_id, actor_id=actor_id)
        raise StaleRevisionError(note_id)
    await session.commit()
    return await require_owned_note(session, note_id=note_id, actor_id=actor_id)


async def delete_note_cas(
    session: AsyncSession,
    *,
    note_id: UUID,
    actor_id: UUID,
    expected_revision: int,
) -> None:
    revision = _validate_revision(expected_revision)
    await require_owned_note(session, note_id=note_id, actor_id=actor_id)
    result = await session.exec(delete(BoardNote).where(BoardNote.id == note_id, BoardNote.revision == revision))
    if result.rowcount != 1:
        await session.rollback()
        await require_owned_note(session, note_id=note_id, actor_id=actor_id)
        raise StaleRevisionError(note_id)
    await session.exec(
        delete(Placement).where(
            Placement.target_kind == PlacementTargetKind.NOTE,
            Placement.target_id == note_id,
        )
    )
    await session.commit()
