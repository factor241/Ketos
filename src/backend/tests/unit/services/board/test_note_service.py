from types import SimpleNamespace
from uuid import uuid4

import pytest
from ketos.services.board.exceptions import (
    BoardResourceNotFoundError,
    PlacementAlreadyExistsError,
    StaleRevisionError,
    UnsafeMarkdownError,
)
from ketos.services.board.note_service import (
    create_note_with_placement,
    delete_note_cas,
    list_board_notes,
    require_owned_note,
    update_note_cas,
    validate_board_note_color,
    validate_board_note_content,
)
from ketos.services.board.placement_service import create_placement, delete_placement_cas
from ketos.services.board.service import create_board
from ketos.services.database.models.board.model import Board
from ketos.services.database.models.board_note.model import BoardNote
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.placement.model import Placement, PlacementTargetKind
from ketos.services.database.models.user.model import User
from ketos.services.deps import session_scope
from sqlalchemy.exc import IntegrityError
from sqlmodel import select


def _note_input(*, content: str = "Stage 04 **note**", color: str = "yellow") -> SimpleNamespace:
    return SimpleNamespace(content=content, color=color)


def _geometry(**changes: object) -> SimpleNamespace:
    values = {"x": 10.0, "y": 20.0, "width": 320.0, "height": 240.0, "z_index": 0}
    values.update(changes)
    return SimpleNamespace(**values)


def _note_patch(*, content: str | None = None, color: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(content=content, color=color)


async def _create_user() -> User:
    async with session_scope() as session:
        user = User(username=f"note-{uuid4()}", password="x", is_active=True)  # noqa: S106
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


async def _create_board(*, project_id, actor_id, title: str = "Note board") -> Board:
    async with session_scope() as session:
        return await create_board(session, project_id=project_id, actor_id=actor_id, title=title)


async def _atomic_create(*, board_id, actor_id, content: str = "Note", color: str = "neutral"):
    async with session_scope() as session:
        return await create_note_with_placement(
            session,
            board_id=board_id,
            actor_id=actor_id,
            note_input=_note_input(content=content, color=color),
            placement_input=_geometry(),
        )


@pytest.mark.parametrize(
    "content",
    [
        "x" * 10_001,
        "<script>alert(1)</script>",
        '<a href="https://safe.test" onclick="alert(1)">x</a>',
        '<iframe/src="https://evil.example">',
        '<iframe/src="https://evil.example"></iframe>',
        "<!-- hidden HTML -->",
        "<!-- unclosed HTML comment",
        "[x](javascript:alert(1))",
        "[x](JaVaScRiPt:alert(1))",
        "[x](data:text/html;base64,PHNjcmlwdD4=)",
        "[x](vbscript:msgbox(1))",
        "[x](//evil.example/path)",
        "[x](java%73cript:alert(1))",
        "[x](javascript%3Aalert(1))",
        "[x](java\u0000script:alert(1))",
        "[relative](docs/readme)",
        "[ref][unsafe]\n\n[unsafe]: data:text/html,boom",
        "![remote](https://evil.example/tracker.png)",
    ],
)
def test_content_validator_rejects_unsafe_markdown(content: str) -> None:
    with pytest.raises((UnsafeMarkdownError, ValueError)):
        validate_board_note_content(content)


@pytest.mark.parametrize(
    "content",
    [
        "Plain **bold**",
        "[HTTP](https://example.test/path?q=1)",
        "[mail](mailto:user@example.test)",
        "[section](#details)",
        "<https://example.test/autolink>",
        "A list\n\n- one\n- two",
    ],
)
def test_content_validator_accepts_restricted_markdown(content: str) -> None:
    assert validate_board_note_content(content) == content


@pytest.mark.parametrize("color", ["neutral", "yellow", "green", "blue", "violet", "pink", "#00AaFf"])
def test_color_validator_accepts_tokens_and_anchored_hex(color: str) -> None:
    assert validate_board_note_color(color) == color


@pytest.mark.parametrize("color", ["red", "purple", "#12345", "#1234567", "#12zz99", "blue;position:fixed"])
def test_color_validator_rejects_arbitrary_css(color: str) -> None:
    with pytest.raises(ValueError, match="supported token"):
        validate_board_note_color(color)


@pytest.mark.usefixtures("client")
async def test_atomic_create_derives_identity_and_commits_note_with_placement(active_user) -> None:
    project = await _create_project(user_id=active_user.id, name="Atomic note")
    board = await _create_board(project_id=project.id, actor_id=active_user.id)
    note, placement = await _atomic_create(
        board_id=board.id,
        actor_id=active_user.id,
        content="[safe](https://example.test)",
        color="#112233",
    )
    assert note.project_id == project.id
    assert note.created_by_id == active_user.id
    assert placement.target_id == note.id
    assert placement.board_id == board.id
    assert placement.target_kind is PlacementTargetKind.NOTE
    assert note.revision == placement.revision == 0


@pytest.mark.usefixtures("client")
async def test_artificial_duplicate_placement_failure_rolls_back_note(active_user, monkeypatch) -> None:
    project = await _create_project(user_id=active_user.id, name="Atomic rollback")
    board = await _create_board(project_id=project.id, actor_id=active_user.id)
    async with session_scope() as session:
        real_commit = session.commit

        async def duplicate_commit() -> None:
            statement = "INSERT placement"
            constraint_message = (
                "UNIQUE constraint failed: placement.board_id, placement.target_kind, placement.target_id"
            )
            raise IntegrityError(
                statement,
                {},
                Exception(constraint_message),
            )

        monkeypatch.setattr(session, "commit", duplicate_commit)
        with pytest.raises(PlacementAlreadyExistsError):
            await create_note_with_placement(
                session,
                board_id=board.id,
                actor_id=active_user.id,
                note_input=_note_input(content="Must roll back"),
                placement_input=_geometry(),
            )
        monkeypatch.setattr(session, "commit", real_commit)
    async with session_scope() as session:
        assert (await session.exec(select(BoardNote).where(BoardNote.project_id == project.id))).all() == []
        assert (await session.exec(select(Placement).where(Placement.board_id == board.id))).all() == []


@pytest.mark.usefixtures("client")
async def test_note_owner_policy_uses_project_not_provenance(active_user) -> None:
    foreign = await _create_user()
    owned_project = await _create_project(user_id=active_user.id, name="Note owned")
    foreign_project = await _create_project(user_id=foreign.id, name="Note foreign")
    null_project = await _create_project(user_id=None, name="Note null")
    owned_board = await _create_board(project_id=owned_project.id, actor_id=active_user.id)
    foreign_board = await _create_board(project_id=foreign_project.id, actor_id=foreign.id)
    owned_note, _ = await _atomic_create(board_id=owned_board.id, actor_id=active_user.id)
    foreign_note, _ = await _atomic_create(board_id=foreign_board.id, actor_id=foreign.id)
    async with session_scope() as session:
        persisted = await session.get(BoardNote, owned_note.id)
        assert persisted is not None
        persisted.created_by_id = foreign.id
        null_note = BoardNote(project_id=null_project.id, created_by_id=active_user.id, content="Hidden")
        session.add(null_note)
        await session.commit()
        await session.refresh(null_note)
    async with session_scope() as session:
        assert (await require_owned_note(session, note_id=owned_note.id, actor_id=active_user.id)).id == owned_note.id
        for note_id in (foreign_note.id, null_note.id, uuid4()):
            with pytest.raises(BoardResourceNotFoundError):
                await require_owned_note(session, note_id=note_id, actor_id=active_user.id)
        listed = await list_board_notes(session, project_id=owned_project.id, actor_id=active_user.id)
    assert [note.id for note in listed] == [owned_note.id]


@pytest.mark.usefixtures("client")
async def test_note_two_sessions_same_revision_have_one_winner(active_user) -> None:
    project = await _create_project(user_id=active_user.id, name="Note CAS")
    board = await _create_board(project_id=project.id, actor_id=active_user.id)
    note, _ = await _atomic_create(board_id=board.id, actor_id=active_user.id, content="Original")
    async with session_scope() as winner_session:
        winner = await update_note_cas(
            winner_session,
            note_id=note.id,
            actor_id=active_user.id,
            expected_revision=note.revision,
            patch=_note_patch(content="Winner", color="violet"),
        )
    async with session_scope() as loser_session:
        with pytest.raises(StaleRevisionError) as conflict:
            await update_note_cas(
                loser_session,
                note_id=note.id,
                actor_id=active_user.id,
                expected_revision=note.revision,
                patch=_note_patch(content="Loser"),
            )
    assert conflict.value.code == "stale_revision"
    assert winner.revision == note.revision + 1
    async with session_scope() as session:
        persisted = await require_owned_note(session, note_id=note.id, actor_id=active_user.id)
    assert (persisted.content, persisted.color, persisted.revision) == ("Winner", "violet", 1)


@pytest.mark.usefixtures("client")
async def test_close_preserves_note_content_and_revision(active_user) -> None:
    project = await _create_project(user_id=active_user.id, name="Close note")
    board = await _create_board(project_id=project.id, actor_id=active_user.id)
    note, placement = await _atomic_create(board_id=board.id, actor_id=active_user.id, content="Persist me")
    async with session_scope() as session:
        await delete_placement_cas(
            session,
            placement_id=placement.id,
            actor_id=active_user.id,
            expected_revision=placement.revision,
        )
    async with session_scope() as session:
        persisted = await require_owned_note(session, note_id=note.id, actor_id=active_user.id)
    assert (persisted.content, persisted.revision) == ("Persist me", 0)


@pytest.mark.usefixtures("client")
async def test_stale_delete_preserves_note_and_all_placements(active_user) -> None:
    project = await _create_project(user_id=active_user.id, name="Delete stale")
    board = await _create_board(project_id=project.id, actor_id=active_user.id)
    note, first = await _atomic_create(board_id=board.id, actor_id=active_user.id)
    async with session_scope() as session:
        winner = await update_note_cas(
            session,
            note_id=note.id,
            actor_id=active_user.id,
            expected_revision=note.revision,
            patch=_note_patch(content="Still here"),
        )
    async with session_scope() as session:
        with pytest.raises(StaleRevisionError):
            await delete_note_cas(
                session,
                note_id=note.id,
                actor_id=active_user.id,
                expected_revision=note.revision,
            )
    async with session_scope() as session:
        assert (await require_owned_note(session, note_id=note.id, actor_id=active_user.id)).revision == winner.revision
        assert await session.get(Placement, first.id) is not None


@pytest.mark.usefixtures("client")
async def test_explicit_delete_removes_note_and_placements_from_multiple_boards(active_user) -> None:
    project = await _create_project(user_id=active_user.id, name="Delete note")
    first_board = await _create_board(project_id=project.id, actor_id=active_user.id, title="First")
    second_board = await _create_board(project_id=project.id, actor_id=active_user.id, title="Second")
    note, first = await _atomic_create(board_id=first_board.id, actor_id=active_user.id, content="Delete me")
    async with session_scope() as session:
        second = await create_placement(
            session,
            board_id=second_board.id,
            actor_id=active_user.id,
            target_kind=PlacementTargetKind.NOTE,
            target_id=note.id,
            geometry=_geometry(x=300),
        )
    async with session_scope() as session:
        await delete_note_cas(
            session,
            note_id=note.id,
            actor_id=active_user.id,
            expected_revision=note.revision,
        )
    async with session_scope() as session:
        assert await session.get(BoardNote, note.id) is None
        assert await session.get(Placement, first.id) is None
        assert await session.get(Placement, second.id) is None
