from uuid import uuid4

import pytest
from ketos.api.v1.schemas.board import BoardViewportUpdate
from ketos.services.board.service import (
    BoardNotFoundError,
    BoardRevisionConflictError,
    create_board,
    delete_board,
    get_owned_board,
    list_boards,
    rename_board,
    require_owned_project,
    update_board_viewport,
)
from ketos.services.database.models.board.model import Board
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.user.model import User
from ketos.services.deps import session_scope

pytestmark = pytest.mark.usefixtures("client")


async def _create_folder(*, user_id, name: str = "Owned"):
    async with session_scope() as session:
        folder = Folder(name=name, user_id=user_id)
        session.add(folder)
        await session.flush()
        await session.refresh(folder)
        folder_id = folder.id
        await session.commit()
    return folder_id


async def _create_foreign_user():
    async with session_scope() as session:
        user = User(username=f"foreign-{uuid4()}", password="x", is_active=True)  # noqa: S106
        session.add(user)
        await session.flush()
        await session.refresh(user)
        user_id = user.id
        await session.commit()
    return user_id


async def _create_board(*, project_id, actor_id, title: str = "Board"):
    async with session_scope() as session:
        return await create_board(session, project_id=project_id, actor_id=actor_id, title=title)


async def test_require_owned_project_treats_foreign_null_and_missing_as_not_found(active_user):
    foreign_id = await _create_foreign_user()
    owned_id = await _create_folder(user_id=active_user.id)
    foreign_project_id = await _create_folder(user_id=foreign_id, name="Foreign")
    null_project_id = await _create_folder(user_id=None, name="Null owner")
    async with session_scope() as session:
        owned = await require_owned_project(session, project_id=owned_id, actor_id=active_user.id)
        assert owned.id == owned_id
        for project_id in (foreign_project_id, null_project_id, uuid4()):
            with pytest.raises(BoardNotFoundError):
                await require_owned_project(session, project_id=project_id, actor_id=active_user.id)


async def test_create_and_list_require_an_owned_project_and_list_stably(active_user):
    foreign_id = await _create_foreign_user()
    owned_id = await _create_folder(user_id=active_user.id)
    foreign_project_id = await _create_folder(user_id=foreign_id, name="Foreign")
    null_project_id = await _create_folder(user_id=None, name="Null owner")
    first = await _create_board(project_id=owned_id, actor_id=active_user.id, title="  First  ")
    second = await _create_board(project_id=owned_id, actor_id=active_user.id, title="Second")
    assert first.title == "First"
    assert first.created_by_id == active_user.id
    assert first.revision == 0
    async with session_scope() as session:
        boards = await list_boards(session, project_id=owned_id, actor_id=active_user.id)
    assert {board.id for board in boards} == {first.id, second.id}
    assert [(board.created_at, str(board.id)) for board in boards] == sorted(
        (board.created_at, str(board.id)) for board in boards
    )
    for project_id in (foreign_project_id, null_project_id, uuid4()):
        async with session_scope() as session:
            with pytest.raises(BoardNotFoundError):
                await list_boards(session, project_id=project_id, actor_id=active_user.id)
        async with session_scope() as session:
            with pytest.raises(BoardNotFoundError):
                await create_board(session, project_id=project_id, actor_id=active_user.id, title="Forbidden")


async def test_get_is_scoped_by_folder_owner_not_board_provenance(active_user):
    foreign_id = await _create_foreign_user()
    owned_id = await _create_folder(user_id=active_user.id)
    foreign_project_id = await _create_folder(user_id=foreign_id, name="Foreign")
    null_project_id = await _create_folder(user_id=active_user.id, name="Becomes null")
    owned_board = await _create_board(project_id=owned_id, actor_id=active_user.id, title="Owned")
    foreign_board = await _create_board(project_id=foreign_project_id, actor_id=foreign_id, title="Foreign")
    null_board = await _create_board(project_id=null_project_id, actor_id=active_user.id, title="Null")
    async with session_scope() as session:
        persisted_owned = await session.get(Board, owned_board.id)
        assert persisted_owned is not None
        persisted_owned.created_by_id = foreign_id
        null_project = await session.get(Folder, null_project_id)
        assert null_project is not None
        null_project.user_id = None
        await session.commit()
    async with session_scope() as session:
        visible = await get_owned_board(session, board_id=owned_board.id, actor_id=active_user.id)
        assert visible.created_by_id == foreign_id
        for board_id in (foreign_board.id, null_board.id, uuid4()):
            with pytest.raises(BoardNotFoundError):
                await get_owned_board(session, board_id=board_id, actor_id=active_user.id)


async def test_viewport_two_writers_one_winner_one_409(active_user):
    project_id = await _create_folder(user_id=active_user.id)
    board = await _create_board(project_id=project_id, actor_id=active_user.id)
    stale_revision = board.revision
    async with session_scope() as first_session:
        winner = await update_board_viewport(
            first_session,
            board_id=board.id,
            actor_id=active_user.id,
            viewport=BoardViewportUpdate(x=101.25, y=-44.5, zoom=1.5, expected_revision=stale_revision),
        )
    async with session_scope() as second_session:
        with pytest.raises(BoardRevisionConflictError) as conflict:
            await update_board_viewport(
                second_session,
                board_id=board.id,
                actor_id=active_user.id,
                viewport=BoardViewportUpdate(x=-900, y=700, zoom=0.75, expected_revision=stale_revision),
            )
    assert conflict.value.code == "board_revision_conflict"
    assert winner.revision == stale_revision + 1
    async with session_scope() as session:
        persisted = await get_owned_board(session, board_id=board.id, actor_id=active_user.id)
    assert (persisted.viewport_x, persisted.viewport_y, persisted.viewport_zoom) == (101.25, -44.5, 1.5)


async def test_stale_rename_and_viewport_write_zero_columns(active_user):
    project_id = await _create_folder(user_id=active_user.id)
    board = await _create_board(project_id=project_id, actor_id=active_user.id, title="Original")
    stale_revision = board.revision
    async with session_scope() as winner_session:
        winner = await rename_board(
            winner_session,
            board_id=board.id,
            actor_id=active_user.id,
            title="  Winner  ",
            expected_revision=stale_revision,
        )
    async with session_scope() as stale_session:
        with pytest.raises(BoardRevisionConflictError):
            await rename_board(
                stale_session,
                board_id=board.id,
                actor_id=active_user.id,
                title="Stale",
                expected_revision=stale_revision,
            )
        with pytest.raises(BoardRevisionConflictError):
            await update_board_viewport(
                stale_session,
                board_id=board.id,
                actor_id=active_user.id,
                viewport=BoardViewportUpdate(x=999, y=888, zoom=2, expected_revision=stale_revision),
            )
    async with session_scope() as session:
        persisted = await get_owned_board(session, board_id=board.id, actor_id=active_user.id)
    assert persisted.title == "Winner"
    assert (persisted.viewport_x, persisted.viewport_y, persisted.viewport_zoom) == (0, 0, 1)
    assert persisted.revision == winner.revision == stale_revision + 1


async def test_stale_delete_preserves_board(active_user):
    project_id = await _create_folder(user_id=active_user.id)
    board = await _create_board(project_id=project_id, actor_id=active_user.id, title="Keep me")
    stale_revision = board.revision
    async with session_scope() as winner_session:
        winner = await rename_board(
            winner_session,
            board_id=board.id,
            actor_id=active_user.id,
            title="Still here",
            expected_revision=stale_revision,
        )
    async with session_scope() as stale_session:
        with pytest.raises(BoardRevisionConflictError) as conflict:
            await delete_board(
                stale_session, board_id=board.id, actor_id=active_user.id, expected_revision=stale_revision
            )
    assert conflict.value.code == "board_revision_conflict"
    async with session_scope() as session:
        persisted = await get_owned_board(session, board_id=board.id, actor_id=active_user.id)
    assert persisted.id == board.id
    assert persisted.title == "Still here"
    assert persisted.revision == winner.revision == stale_revision + 1
