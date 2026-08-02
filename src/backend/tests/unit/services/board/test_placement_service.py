from types import SimpleNamespace
from uuid import uuid4

import pytest
from ketos.services.board.exceptions import (
    BoardResourceNotFoundError,
    PlacementAlreadyExistsError,
    StaleRevisionError,
    TargetKindNotAvailableError,
    TargetProjectMismatchError,
)
from ketos.services.board.placement_service import (
    create_placement,
    delete_placement_cas,
    get_owned_placement,
    list_placements,
    require_owned_board,
    update_placement_cas,
)
from ketos.services.board.service import create_board
from ketos.services.board.target_validation import validate_placement_target
from ketos.services.database.models.board.model import Board
from ketos.services.database.models.board_note.model import BoardNote
from ketos.services.database.models.chat_thread.model import ChatContextPolicy, ChatThread
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.placement.model import (
    Placement,
    PlacementDisplayState,
    PlacementTargetKind,
)
from ketos.services.database.models.user.model import User
from ketos.services.deps import session_scope
from sqlalchemy import text
from sqlmodel import select

pytestmark = pytest.mark.usefixtures("client")


def _geometry(**changes: object) -> SimpleNamespace:
    values = {"x": 10.0, "y": 20.0, "width": 320.0, "height": 240.0, "z_index": 0}
    values.update(changes)
    return SimpleNamespace(**values)


def _patch(**changes: object) -> SimpleNamespace:
    values = {
        "x": None,
        "y": None,
        "width": None,
        "height": None,
        "z_index": None,
        "display_state": None,
    }
    values.update(changes)
    return SimpleNamespace(**values)


async def _create_user() -> User:
    async with session_scope() as session:
        user = User(username=f"placement-{uuid4()}", password="x", is_active=True)  # noqa: S106
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


async def _create_project(*, user_id, name: str) -> Folder:
    async with session_scope() as session:
        project = Folder(name=name, user_id=user_id)
        session.add(project)
        await session.commit()
        await session.refresh(project)
        return project


async def _create_board(*, project_id, actor_id) -> Board:
    async with session_scope() as session:
        return await create_board(session, project_id=project_id, actor_id=actor_id, title="Stage 04")


async def _create_note(*, project_id, actor_id, content: str = "Note") -> BoardNote:
    async with session_scope() as session:
        note = BoardNote(project_id=project_id, created_by_id=actor_id, content=content)
        session.add(note)
        await session.commit()
        await session.refresh(note)
        return note


async def _create_chat(*, project_id, actor_id, title: str = "Chat") -> ChatThread:
    async with session_scope() as session:
        chat = ChatThread(
            project_id=project_id,
            created_by_id=actor_id,
            title=title,
            provider="OpenAI",
            model_name="gpt-4o",
            context_policy=ChatContextPolicy.BOARD,
        )
        session.add(chat)
        await session.commit()
        await session.refresh(chat)
        return chat


async def _place(*, board_id, actor_id, note_id, geometry=None) -> Placement:
    async with session_scope() as session:
        return await create_placement(
            session,
            board_id=board_id,
            actor_id=actor_id,
            target_kind=PlacementTargetKind.NOTE,
            target_id=note_id,
            geometry=geometry or _geometry(),
        )


async def test_owner_guards_hide_foreign_null_and_missing_boards(active_user) -> None:
    foreign = await _create_user()
    owned_project = await _create_project(user_id=active_user.id, name="Owned placement")
    foreign_project = await _create_project(user_id=foreign.id, name="Foreign placement")
    null_project = await _create_project(user_id=None, name="Null placement")
    owned_board = await _create_board(project_id=owned_project.id, actor_id=active_user.id)
    foreign_board = await _create_board(project_id=foreign_project.id, actor_id=foreign.id)
    async with session_scope() as session:
        null_board = Board(project_id=null_project.id, created_by_id=active_user.id, title="Hidden")
        session.add(null_board)
        await session.commit()
        await session.refresh(null_board)
    async with session_scope() as session:
        assert (
            await require_owned_board(session, board_id=owned_board.id, actor_id=active_user.id)
        ).id == owned_board.id
        for board_id in (foreign_board.id, null_board.id, uuid4()):
            with pytest.raises(BoardResourceNotFoundError):
                await require_owned_board(session, board_id=board_id, actor_id=active_user.id)


async def test_target_validation_is_explicit_and_project_scoped(active_user) -> None:
    foreign = await _create_user()
    owned_project = await _create_project(user_id=active_user.id, name="Target owned")
    other_owned_project = await _create_project(user_id=active_user.id, name="Target other")
    foreign_project = await _create_project(user_id=foreign.id, name="Target foreign")
    board = await _create_board(project_id=owned_project.id, actor_id=active_user.id)
    note = await _create_note(project_id=owned_project.id, actor_id=foreign.id)
    other_note = await _create_note(project_id=other_owned_project.id, actor_id=active_user.id)
    foreign_note = await _create_note(project_id=foreign_project.id, actor_id=foreign.id)
    chat = await _create_chat(project_id=owned_project.id, actor_id=foreign.id)
    other_chat = await _create_chat(project_id=other_owned_project.id, actor_id=active_user.id)
    foreign_chat = await _create_chat(project_id=foreign_project.id, actor_id=foreign.id)
    async with session_scope() as session:
        persisted_board = await require_owned_board(session, board_id=board.id, actor_id=active_user.id)
        assert (
            await validate_placement_target(
                session,
                board=persisted_board,
                target_kind=PlacementTargetKind.NOTE,
                target_id=note.id,
                actor_id=active_user.id,
            )
        ).id == note.id
        assert (
            await validate_placement_target(
                session,
                board=persisted_board,
                target_kind=PlacementTargetKind.CHAT,
                target_id=chat.id,
                actor_id=active_user.id,
            )
        ).id == chat.id
        with pytest.raises(TargetProjectMismatchError):
            await validate_placement_target(
                session,
                board=persisted_board,
                target_kind=PlacementTargetKind.NOTE,
                target_id=other_note.id,
                actor_id=active_user.id,
            )
        with pytest.raises(TargetProjectMismatchError):
            await validate_placement_target(
                session,
                board=persisted_board,
                target_kind=PlacementTargetKind.CHAT,
                target_id=other_chat.id,
                actor_id=active_user.id,
            )
        for note_id in (foreign_note.id, uuid4()):
            with pytest.raises(BoardResourceNotFoundError):
                await validate_placement_target(
                    session,
                    board=persisted_board,
                    target_kind=PlacementTargetKind.NOTE,
                    target_id=note_id,
                    actor_id=active_user.id,
                )
        for chat_id in (foreign_chat.id, uuid4()):
            with pytest.raises(BoardResourceNotFoundError):
                await validate_placement_target(
                    session,
                    board=persisted_board,
                    target_kind=PlacementTargetKind.CHAT,
                    target_id=chat_id,
                    actor_id=active_user.id,
                )
        with pytest.raises(TargetKindNotAvailableError) as error:
            await validate_placement_target(
                session,
                board=persisted_board,
                target_kind=PlacementTargetKind.JOB_RESULT,
                target_id=note.id,
                actor_id=active_user.id,
            )
        assert error.value.code == "target_kind_not_available"


async def test_create_lists_stably_and_rejects_duplicate(active_user) -> None:
    project = await _create_project(user_id=active_user.id, name="Placement create")
    board = await _create_board(project_id=project.id, actor_id=active_user.id)
    first_note = await _create_note(project_id=project.id, actor_id=active_user.id, content="First")
    second_note = await _create_note(project_id=project.id, actor_id=active_user.id, content="Second")
    first = await _place(
        board_id=board.id, actor_id=active_user.id, note_id=first_note.id, geometry=_geometry(z_index=5)
    )
    second = await _place(
        board_id=board.id, actor_id=active_user.id, note_id=second_note.id, geometry=_geometry(z_index=1)
    )
    async with session_scope() as session:
        placements = await list_placements(session, board_id=board.id, actor_id=active_user.id)
    assert [placement.id for placement in placements] == [second.id, first.id]
    async with session_scope() as session:
        with pytest.raises(PlacementAlreadyExistsError) as error:
            await create_placement(
                session,
                board_id=board.id,
                actor_id=active_user.id,
                target_kind=PlacementTargetKind.NOTE,
                target_id=first_note.id,
                geometry=_geometry(x=100),
            )
    assert error.value.code == "placement_already_exists"


async def test_two_sessions_same_revision_have_one_winner(active_user) -> None:
    project = await _create_project(user_id=active_user.id, name="Placement CAS")
    board = await _create_board(project_id=project.id, actor_id=active_user.id)
    note = await _create_note(project_id=project.id, actor_id=active_user.id)
    placement = await _place(board_id=board.id, actor_id=active_user.id, note_id=note.id)
    async with session_scope() as winner_session:
        winner = await update_placement_cas(
            winner_session,
            placement_id=placement.id,
            actor_id=active_user.id,
            expected_revision=placement.revision,
            patch=_patch(x=500.0, y=-125.0, display_state=PlacementDisplayState.COLLAPSED),
        )
    async with session_scope() as loser_session:
        with pytest.raises(StaleRevisionError) as conflict:
            await update_placement_cas(
                loser_session,
                placement_id=placement.id,
                actor_id=active_user.id,
                expected_revision=placement.revision,
                patch=_patch(x=999.0, width=600.0),
            )
    assert conflict.value.code == "stale_revision"
    assert winner.revision == placement.revision + 1
    async with session_scope() as session:
        persisted = await get_owned_placement(session, placement_id=placement.id, actor_id=active_user.id)
    assert (persisted.x, persisted.y, persisted.width) == (500.0, -125.0, 320.0)
    assert persisted.display_state is PlacementDisplayState.COLLAPSED


@pytest.mark.parametrize(
    ("field", "value"),
    [("x", float("inf")), ("y", float("nan")), ("width", 200), ("height", 1300), ("z_index", -1)],
)
async def test_update_rejects_invalid_geometry_without_writing(active_user, field: str, value: object) -> None:
    project = await _create_project(user_id=active_user.id, name=f"Invalid {field}")
    board = await _create_board(project_id=project.id, actor_id=active_user.id)
    note = await _create_note(project_id=project.id, actor_id=active_user.id)
    placement = await _place(board_id=board.id, actor_id=active_user.id, note_id=note.id)
    async with session_scope() as session:
        with pytest.raises((TypeError, ValueError)):
            await update_placement_cas(
                session,
                placement_id=placement.id,
                actor_id=active_user.id,
                expected_revision=placement.revision,
                patch=_patch(**{field: value}),
            )
    async with session_scope() as session:
        persisted = await get_owned_placement(session, placement_id=placement.id, actor_id=active_user.id)
    assert persisted.revision == placement.revision


async def test_close_deletes_only_placement_and_replacement_gets_new_identity(active_user) -> None:
    project = await _create_project(user_id=active_user.id, name="Placement close")
    board = await _create_board(project_id=project.id, actor_id=active_user.id)
    note = await _create_note(project_id=project.id, actor_id=active_user.id)
    placement = await _place(board_id=board.id, actor_id=active_user.id, note_id=note.id)
    async with session_scope() as session:
        await delete_placement_cas(
            session,
            placement_id=placement.id,
            actor_id=active_user.id,
            expected_revision=placement.revision,
        )
    async with session_scope() as session:
        assert await session.get(BoardNote, note.id) is not None
        assert await session.get(Placement, placement.id) is None
    replacement = await _place(board_id=board.id, actor_id=active_user.id, note_id=note.id)
    assert replacement.id != placement.id
    assert replacement.target_id == note.id


async def test_board_delete_cascades_placements_but_preserves_note(active_user) -> None:
    project = await _create_project(user_id=active_user.id, name="Placement cascade")
    board = await _create_board(project_id=project.id, actor_id=active_user.id)
    note = await _create_note(project_id=project.id, actor_id=active_user.id)
    placement = await _place(board_id=board.id, actor_id=active_user.id, note_id=note.id)
    async with session_scope() as session:
        await session.exec(text("PRAGMA foreign_keys=ON"))
        persisted_board = await session.get(Board, board.id)
        assert persisted_board is not None
        await session.delete(persisted_board)
        await session.commit()
    async with session_scope() as session:
        assert await session.get(Placement, placement.id) is None
        assert await session.get(BoardNote, note.id) is not None
        assert (await session.exec(select(Placement).where(Placement.board_id == board.id))).all() == []
