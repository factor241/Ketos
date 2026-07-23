from __future__ import annotations

import json
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlmodel import Session, SQLModel, create_engine, select
from sqlmodel.ext.asyncio.session import AsyncSession

import ketos.services.database.models  # noqa: F401
from ketos.services.board.exceptions import UnsafeMarkdownError
from ketos.services.board.note_service import create_note_with_placement, update_note_cas
from ketos.services.board.placement_service import create_placement, delete_placement_cas
from ketos.services.board.service import (
    BoardNotFoundError,
    BoardRevisionConflictError,
    create_board,
    get_owned_board,
    require_owned_project,
    update_board_viewport,
)
from ketos.services.chat_threads.message_adapter import append_user_message, commit_assistant_message
from ketos.services.chat_threads.messages import build_messages_snapshot
from ketos.services.chat_threads.repository import claim_chat_run
from ketos.services.database.models.board.model import Board
from ketos.services.database.models.board_note.model import BoardNote
from ketos.services.database.models.chat_thread.model import ChatContextPolicy, ChatRun, ChatThread
from ketos.services.database.models.flow.model import Flow
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.placement.model import Placement, PlacementTargetKind
from ketos.services.database.models.user.model import User

_SEED_SCRIPT = Path(__file__).resolve().parents[4] / "scripts" / "mvp" / "seed_vertical_slice.py"
_SEED_SPEC = spec_from_file_location("ketos_stage10_seed_vertical_slice", _SEED_SCRIPT)
assert _SEED_SPEC is not None and _SEED_SPEC.loader is not None
_SEED_MODULE = module_from_spec(_SEED_SPEC)
_SEED_SPEC.loader.exec_module(_SEED_MODULE)
seed_main = _SEED_MODULE.main


SECRET_KEY_FRAGMENTS = {
    "api_key",
    "credential",
    "database_url",
    "password",
    "path",
    "secret",
}


def _assert_manifest_has_no_secret_bearing_keys(value: Any) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).casefold()
            assert not any(
                fragment in normalized for fragment in SECRET_KEY_FRAGMENTS
            ), f"secret-bearing manifest key: {key}"
            _assert_manifest_has_no_secret_bearing_keys(child)
    elif isinstance(value, list):
        for child in value:
            _assert_manifest_has_no_secret_bearing_keys(child)


def test_seed_idempotency_and_canonical_saver_path(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_path = (tmp_path / "acceptance.sqlite3").resolve()
    database_url = f"sqlite:///{database_path}"
    engine = create_engine(database_url)
    SQLModel.metadata.create_all(engine)

    data_dir = tmp_path / "ketos-data"
    monkeypatch.setenv("KETOS_DATA_DIR", str(data_dir))
    manifest_path = tmp_path / "seed-manifest.json"
    argv = [
        "--database-url",
        database_url,
        "--seed-key",
        "stage10-acceptance",
        "--output-seed-manifest",
        str(manifest_path),
        "--assert-canonical-saver-path",
    ]

    try:
        assert seed_main(argv) == 0
        first_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        assert seed_main(argv) == 0
        second_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        assert first_manifest["ids"] == second_manifest["ids"]
        assert first_manifest["row_counts"] == second_manifest["row_counts"]
        assert first_manifest["seed_key_sha256"] == second_manifest[
            "seed_key_sha256"
        ]
        assert first_manifest["operation"] == {"created": 4, "reused": 0}
        assert second_manifest["operation"] == {"created": 0, "reused": 4}
        assert second_manifest["row_counts"]["total"] == 4
        _assert_manifest_has_no_secret_bearing_keys(first_manifest)
        _assert_manifest_has_no_secret_bearing_keys(second_manifest)

        ids = second_manifest["ids"]
        with Session(engine) as session:
            users = session.exec(
                select(User).where(User.id == UUID(ids["user"])),
            ).all()
            projects = session.exec(
                select(Folder).where(Folder.id == UUID(ids["project"])),
            ).all()
            boards = session.exec(
                select(Board).where(Board.id == UUID(ids["board"])),
            ).all()
            flows = session.exec(
                select(Flow).where(Flow.id == UUID(ids["flow"])),
            ).all()

        assert len(users) == 1
        assert len(projects) == 1
        assert len(boards) == 1
        assert len(flows) == 1
        assert users[0].is_active is False
        assert users[0].is_superuser is False
        assert flows[0].data == {"nodes": [], "edges": []}
    finally:
        engine.dispose()


def test_seed_idempotency_rejects_relative_sqlite_url(tmp_path: Path) -> None:
    with pytest.raises(SystemExit, match="2"):
        seed_main(
            [
                "--database-url",
                "sqlite:///relative.sqlite3",
                "--seed-key",
                "stage10-invalid",
                "--output-seed-manifest",
                str(tmp_path / "must-not-exist.json"),
            ],
        )

    assert not (tmp_path / "must-not-exist.json").exists()


@pytest.mark.asyncio
async def test_project_board_ownership_revision_cas_and_persistence(
    async_session: AsyncSession,
) -> None:
    owner_uuid = uuid4()
    foreign_uuid = uuid4()
    project_uuid = uuid4()
    null_project_uuid = uuid4()
    null_board_uuid = uuid4()

    owner = User(
        id=owner_uuid,
        username=f"s10-owner-{owner_uuid}",
        password="!disabled-stage10!",
        is_active=True,
    )
    foreign = User(
        id=foreign_uuid,
        username=f"s10-foreign-{foreign_uuid}",
        password="!disabled-stage10!",
        is_active=True,
    )
    async_session.add_all([owner, foreign])
    await async_session.flush()

    project = Folder(
        id=project_uuid,
        name="Stage 10 Project",
        user_id=owner.id,
    )
    null_project = Folder(
        id=null_project_uuid,
        name="Stage 10 Null Owner Project",
        user_id=None,
    )
    async_session.add_all([project, null_project])
    await async_session.flush()

    null_board = Board(
        id=null_board_uuid,
        project_id=null_project.id,
        created_by_id=owner.id,
        title="Null owner",
    )
    async_session.add(null_board)
    await async_session.commit()

    owned_project = await require_owned_project(
        async_session,
        project_id=project_uuid,
        actor_id=owner_uuid,
    )
    assert owned_project.id == project_uuid
    assert owned_project.user_id == owner_uuid

    created = await create_board(
        async_session,
        project_id=project_uuid,
        actor_id=owner_uuid,
        title="Stage 10 Project Board",
    )
    board_uuid = created.id

    assert created.project_id == project_uuid
    assert created.created_by_id == owner_uuid
    assert created.revision == 0

    updated = await update_board_viewport(
        async_session,
        board_id=board_uuid,
        actor_id=owner_uuid,
        viewport=SimpleNamespace(
            x=125.5,
            y=-42.0,
            zoom=1.25,
            expected_revision=0,
        ),
    )

    assert updated.id == board_uuid
    assert updated.project_id == project_uuid
    assert updated.viewport_x == 125.5
    assert updated.viewport_y == -42.0
    assert updated.viewport_zoom == 1.25
    assert updated.revision == 1

    with pytest.raises(BoardRevisionConflictError):
        await update_board_viewport(
            async_session,
            board_id=board_uuid,
            actor_id=owner_uuid,
            viewport=SimpleNamespace(
                x=999.0,
                y=888.0,
                zoom=0.5,
                expected_revision=0,
            ),
        )

    with pytest.raises(BoardNotFoundError):
        await get_owned_board(
            async_session,
            board_id=board_uuid,
            actor_id=foreign_uuid,
        )

    with pytest.raises(BoardNotFoundError):
        await get_owned_board(
            async_session,
            board_id=null_board_uuid,
            actor_id=owner_uuid,
        )

    async with AsyncSession(
        async_session.bind,
        expire_on_commit=False,
    ) as reopened:
        persisted = await get_owned_board(
            reopened,
            board_id=board_uuid,
            actor_id=owner_uuid,
        )

        assert persisted.id == board_uuid
        assert persisted.project_id == project_uuid
        assert persisted.created_by_id == owner_uuid
        assert persisted.viewport_x == 125.5
        assert persisted.viewport_y == -42.0
        assert persisted.viewport_zoom == 1.25
        assert persisted.revision == 1


@pytest.mark.asyncio
async def test_note_chat_vertical_slice_persists_entities_and_isolates_threads(
    async_session: AsyncSession,
) -> None:
    owner_id = uuid4()
    project_id = uuid4()
    board_id = uuid4()

    owner = User(
        id=owner_id,
        username=f"s10-owner-{owner_id}",
        password="!disabled-stage10!",
        is_active=True,
    )
    async_session.add(owner)
    await async_session.flush()

    project = Folder(
        id=project_id,
        name="Stage 10 Project",
        user_id=owner.id,
    )
    async_session.add(project)
    await async_session.flush()

    board = Board(
        id=board_id,
        project_id=project.id,
        created_by_id=owner.id,
        title="Stage 10 Board",
    )
    async_session.add(board)
    await async_session.commit()

    original_content = (
        "**Stage 10 note**\n\n"
        "- first item\n"
        "- second item\n\n"
        "[Ketos documentation](https://ketos.test/docs)"
    )
    note, note_placement = await create_note_with_placement(
        async_session,
        board_id=board_id,
        actor_id=owner_id,
        note_input=SimpleNamespace(
            content=original_content,
            color="yellow",
        ),
        placement_input=SimpleNamespace(
            x=96.0,
            y=112.0,
            width=320.0,
            height=220.0,
            z_index=2,
        ),
    )

    assert isinstance(note, BoardNote)
    assert isinstance(note_placement, Placement)
    original_note_id = note.id
    original_placement_id = note_placement.id
    original_placement_revision = note_placement.revision

    updated_content = (
        "**Updated Stage 10 note**\n\n"
        "- persisted item\n\n"
        "[Safe link](https://example.com/stage-10)"
    )
    updated_note = await update_note_cas(
        async_session,
        note_id=note.id,
        actor_id=owner_id,
        expected_revision=note.revision,
        patch=SimpleNamespace(
            content=updated_content,
            color="blue",
        ),
    )
    assert updated_note.id == original_note_id
    assert updated_note.content == updated_content
    assert updated_note.color == "blue"

    async_session.expire_all()
    reloaded_note = await async_session.get(BoardNote, original_note_id)
    assert reloaded_note is not None
    assert reloaded_note.content == updated_content
    assert reloaded_note.color == "blue"

    with pytest.raises(UnsafeMarkdownError):
        await update_note_cas(
            async_session,
            note_id=reloaded_note.id,
            actor_id=owner_id,
            expected_revision=reloaded_note.revision,
            patch=SimpleNamespace(
                content="<script>alert('stage-10')</script>",
                color=None,
            ),
        )

    with pytest.raises(UnsafeMarkdownError):
        await update_note_cas(
            async_session,
            note_id=reloaded_note.id,
            actor_id=owner_id,
            expected_revision=reloaded_note.revision,
            patch=SimpleNamespace(
                content="[unsafe](javascript:alert('stage-10'))",
                color=None,
            ),
        )

    await delete_placement_cas(
        async_session,
        placement_id=original_placement_id,
        actor_id=owner_id,
        expected_revision=original_placement_revision,
    )
    preserved_note = await async_session.get(BoardNote, original_note_id)
    assert preserved_note is not None

    replacement_note_placement = await create_placement(
        async_session,
        board_id=board_id,
        actor_id=owner_id,
        target_kind=PlacementTargetKind.NOTE,
        target_id=preserved_note.id,
        geometry=SimpleNamespace(
            x=420.0,
            y=180.0,
            width=300.0,
            height=200.0,
            z_index=3,
        ),
    )
    assert replacement_note_placement.target_id == original_note_id
    assert replacement_note_placement.id != original_placement_id

    chat_a = ChatThread(
        id=uuid4(),
        project_id=project_id,
        created_by_id=owner_id,
        title="Stage 10 Chat A",
        provider="OpenAI",
        model_name="deepseek-v4-flash",
        context_policy=ChatContextPolicy.BOARD,
    )
    chat_b = ChatThread(
        id=uuid4(),
        project_id=project_id,
        created_by_id=owner_id,
        title="Stage 10 Chat B",
        provider="OpenAI",
        model_name="deepseek-v4-flash",
        context_policy=ChatContextPolicy.BOARD,
    )
    async_session.add_all([chat_a, chat_b])
    await async_session.commit()

    claim_a = await claim_chat_run(
        async_session,
        chat_id=chat_a.id,
        actor_id=owner_id,
        ag_ui_run_id=f"s10-run-{uuid4()}",
        idempotency_key=f"s10-idempotency-{uuid4()}",
        request_fingerprint="a" * 64,
    )
    claim_b = await claim_chat_run(
        async_session,
        chat_id=chat_b.id,
        actor_id=owner_id,
        ag_ui_run_id=f"s10-run-{uuid4()}",
        idempotency_key=f"s10-idempotency-{uuid4()}",
        request_fingerprint="b" * 64,
    )

    assert isinstance(claim_a.run, ChatRun)
    assert isinstance(claim_b.run, ChatRun)
    assert claim_a.replayed is False
    assert claim_b.replayed is False
    assert claim_a.run.id != claim_b.run.id
    assert claim_a.run.langgraph_thread_id == str(chat_a.id)
    assert claim_b.run.langgraph_thread_id == str(chat_b.id)
    assert claim_a.run.langgraph_thread_id != claim_b.run.langgraph_thread_id

    await append_user_message(
        async_session,
        chat_id=chat_a.id,
        chat_run_id=claim_a.run.id,
        actor_id=owner_id,
        text="user-message-chat-a",
    )
    await commit_assistant_message(
        async_session,
        chat_id=chat_a.id,
        chat_run_id=claim_a.run.id,
        actor_id=owner_id,
        text="assistant-message-chat-a",
    )
    await append_user_message(
        async_session,
        chat_id=chat_b.id,
        chat_run_id=claim_b.run.id,
        actor_id=owner_id,
        text="user-message-chat-b",
    )
    await commit_assistant_message(
        async_session,
        chat_id=chat_b.id,
        chat_run_id=claim_b.run.id,
        actor_id=owner_id,
        text="assistant-message-chat-b",
    )

    snapshot_a = await build_messages_snapshot(
        session=async_session,
        owner_id=owner_id,
        chat_id=chat_a.id,
        after_sequence=0,
    )
    snapshot_b = await build_messages_snapshot(
        session=async_session,
        owner_id=owner_id,
        chat_id=chat_b.id,
        after_sequence=0,
    )

    messages_a = list(snapshot_a.messages)
    messages_b = list(snapshot_b.messages)
    assert [message["role"] for message in messages_a] == ["user", "assistant"]
    assert [message["role"] for message in messages_b] == ["user", "assistant"]
    assert [message["content"] for message in messages_a] == [
        "user-message-chat-a",
        "assistant-message-chat-a",
    ]
    assert [message["content"] for message in messages_b] == [
        "user-message-chat-b",
        "assistant-message-chat-b",
    ]
    assert all("chat-b" not in message["content"] for message in messages_a)
    assert all("chat-a" not in message["content"] for message in messages_b)
    assert snapshot_a.cursor == 2
    assert snapshot_b.cursor == 2

    chat_placement = await create_placement(
        async_session,
        board_id=board_id,
        actor_id=owner_id,
        target_kind=PlacementTargetKind.CHAT,
        target_id=chat_a.id,
        geometry=SimpleNamespace(
            x=720.0,
            y=120.0,
            width=360.0,
            height=480.0,
            z_index=4,
        ),
    )
    await delete_placement_cas(
        async_session,
        placement_id=chat_placement.id,
        actor_id=owner_id,
        expected_revision=chat_placement.revision,
    )

    preserved_chat = await async_session.get(ChatThread, chat_a.id)
    assert preserved_chat is not None
    assert preserved_chat.id == chat_a.id

    replacement_chat_placement = await create_placement(
        async_session,
        board_id=board_id,
        actor_id=owner_id,
        target_kind=PlacementTargetKind.CHAT,
        target_id=preserved_chat.id,
        geometry=SimpleNamespace(
            x=760.0,
            y=160.0,
            width=360.0,
            height=480.0,
            z_index=5,
        ),
    )
    assert replacement_chat_placement.target_id == chat_a.id
    assert replacement_chat_placement.id != chat_placement.id
