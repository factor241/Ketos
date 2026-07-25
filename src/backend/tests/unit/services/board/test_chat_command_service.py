import asyncio
from uuid import uuid4

import pytest
from ketos.api.v1.schemas.chat_threads import BoardChatCreate
from ketos.services.board.command_service import (
    BoardCommandInvariantError,
    BoardCommandTransactionError,
    IdempotencyKeyReusedError,
    create_board_chat,
)
from ketos.services.board.exceptions import BoardResourceNotFoundError
from ketos.services.board.service import create_board
from ketos.services.chat_threads import service as chat_service
from ketos.services.database.models.board_command_receipt.model import BoardCommandReceipt
from ketos.services.database.models.chat_thread.model import ChatContextPolicy, ChatThread
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.placement.model import Placement, PlacementTargetKind
from ketos.services.database.models.user.model import User
from ketos.services.deps import session_scope
from sqlmodel import select

pytestmark = pytest.mark.usefixtures("client")


@pytest.fixture(autouse=True)
def _provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        chat_service,
        "get_provider_model_candidates",
        lambda provider, actor_id: ["stage05-model"] if provider == "OpenAI" and actor_id else [],
    )


async def _project(owner_id) -> Folder:
    async with session_scope() as session:
        project = Folder(name=f"Board chat {uuid4()}", user_id=owner_id)
        session.add(project)
        await session.commit()
        await session.refresh(project)
        return project


async def _board(owner_id):
    project = await _project(owner_id)
    async with session_scope() as session:
        board = await create_board(
            session,
            project_id=project.id,
            actor_id=owner_id,
            title="Chat board",
        )
    return project, board


def _payload(
    *,
    title: str = "Board chat",
    provider: str = "OpenAI",
    model_name: str = "stage05-model",
    x: float = 42,
) -> BoardChatCreate:
    return BoardChatCreate.model_validate(
        {
            "title": title,
            "provider": provider,
            "model_name": model_name,
            "placement": {
                "x": x,
                "y": 84,
                "width": 360,
                "height": 240,
                "z_index": 3,
            },
        }
    )


async def _run(*, board_id, actor_id, key, payload, fault=None):
    async with session_scope() as session:
        return await create_board_chat(
            session,
            board_id=board_id,
            actor_id=actor_id,
            idempotency_key=key,
            payload=payload,
            fault=fault,
        )


async def _counts(board_id) -> tuple[int, int, int]:
    async with session_scope() as session:
        chats = (await session.exec(select(ChatThread))).all()
        placements = (await session.exec(select(Placement).where(Placement.board_id == board_id))).all()
        receipts = (
            await session.exec(
                select(BoardCommandReceipt).where(
                    BoardCommandReceipt.board_id == board_id,
                    BoardCommandReceipt.operation == "create_board_chat",
                )
            )
        ).all()
    return len(chats), len(placements), len(receipts)


async def test_board_chat_command_creates_board_scoped_chat_and_geometry(active_user) -> None:
    project, board = await _board(active_user.id)

    result = await _run(
        board_id=board.id,
        actor_id=active_user.id,
        key=uuid4(),
        payload=_payload(),
    )

    assert result.idempotency_replayed is False
    assert result.chat.project_id == project.id
    assert result.chat.created_by_id == active_user.id
    assert result.chat.context_policy is ChatContextPolicy.BOARD
    assert result.placement.target_kind is PlacementTargetKind.CHAT
    assert result.placement.target_id == result.chat.id
    assert (
        result.placement.x,
        result.placement.y,
        result.placement.width,
        result.placement.height,
        result.placement.z_index,
    ) == (42, 84, 360, 240, 3)
    assert await _counts(board.id) == (1, 1, 1)


async def test_board_chat_same_key_replays_and_changed_payload_conflicts(active_user) -> None:
    _, board = await _board(active_user.id)
    key = uuid4()
    payload = _payload()

    first = await _run(
        board_id=board.id,
        actor_id=active_user.id,
        key=key,
        payload=payload,
    )
    replay = await _run(
        board_id=board.id,
        actor_id=active_user.id,
        key=key,
        payload=payload,
    )

    assert replay.idempotency_replayed is True
    assert (replay.chat.id, replay.placement.id) == (
        first.chat.id,
        first.placement.id,
    )
    with pytest.raises(IdempotencyKeyReusedError):
        await _run(
            board_id=board.id,
            actor_id=active_user.id,
            key=key,
            payload=_payload(x=43),
        )
    assert await _counts(board.id) == (1, 1, 1)


async def test_concurrent_same_key_creates_one_chat_and_placement(active_user) -> None:
    _, board = await _board(active_user.id)
    key = uuid4()
    payload = _payload()

    async def submit():
        return await _run(
            board_id=board.id,
            actor_id=active_user.id,
            key=key,
            payload=payload,
        )

    first, second = await asyncio.gather(submit(), submit())

    assert (first.chat.id, first.placement.id) == (
        second.chat.id,
        second.placement.id,
    )
    assert {first.idempotency_replayed, second.idempotency_replayed} == {
        False,
        True,
    }
    assert await _counts(board.id) == (1, 1, 1)


async def test_concurrent_same_key_different_payload_commits_only_winner(active_user) -> None:
    _, board = await _board(active_user.id)
    key = uuid4()

    async def submit(payload: BoardChatCreate):
        return await _run(
            board_id=board.id,
            actor_id=active_user.id,
            key=key,
            payload=payload,
        )

    results = await asyncio.gather(
        submit(_payload(title="First", x=10)),
        submit(_payload(title="Second", x=20)),
        return_exceptions=True,
    )

    successes = [result for result in results if not isinstance(result, Exception)]
    assert len(successes) == 1
    assert sum(isinstance(result, IdempotencyKeyReusedError) for result in results) == 1
    assert successes[0].chat.title in {"First", "Second"}
    assert successes[0].placement.x in {10, 20}
    assert await _counts(board.id) == (1, 1, 1)


async def test_board_chat_denies_foreign_board(active_user) -> None:
    async with session_scope() as session:
        foreign = User(
            username=f"foreign-board-chat-{uuid4()}",
            password="x",  # noqa: S106
            is_active=True,
        )
        session.add(foreign)
        await session.commit()
        await session.refresh(foreign)
    foreign_project = await _project(foreign.id)
    async with session_scope() as session:
        foreign_board = await create_board(
            session,
            project_id=foreign_project.id,
            actor_id=foreign.id,
            title="Foreign",
        )

    with pytest.raises(BoardResourceNotFoundError):
        await _run(
            board_id=foreign_board.id,
            actor_id=active_user.id,
            key=uuid4(),
            payload=_payload(),
        )
    assert await _counts(foreign_board.id) == (0, 0, 0)


async def test_board_chat_replay_revalidates_current_board_owner(active_user) -> None:
    project, board = await _board(active_user.id)
    key = uuid4()
    payload = _payload()
    await _run(
        board_id=board.id,
        actor_id=active_user.id,
        key=key,
        payload=payload,
    )
    async with session_scope() as session:
        foreign = User(
            username=f"revoked-board-chat-{uuid4()}",
            password="x",  # noqa: S106
            is_active=True,
        )
        session.add(foreign)
        await session.flush()
        owned_project = await session.get(Folder, project.id)
        assert owned_project is not None
        owned_project.user_id = foreign.id
        await session.commit()

    with pytest.raises(BoardResourceNotFoundError):
        await _run(
            board_id=board.id,
            actor_id=active_user.id,
            key=key,
            payload=payload,
        )
    assert await _counts(board.id) == (1, 1, 1)


async def test_board_chat_replay_rejects_dangling_committed_result(active_user) -> None:
    _, board = await _board(active_user.id)
    key = uuid4()
    payload = _payload()
    created = await _run(
        board_id=board.id,
        actor_id=active_user.id,
        key=key,
        payload=payload,
    )
    async with session_scope() as session:
        chat = await session.get(ChatThread, created.chat.id)
        assert chat is not None
        await session.delete(chat)
        await session.commit()

    with pytest.raises(BoardCommandInvariantError):
        await _run(
            board_id=board.id,
            actor_id=active_user.id,
            key=key,
            payload=payload,
        )


async def test_invalid_provider_leaves_no_compound_rows(active_user) -> None:
    _, board = await _board(active_user.id)

    with pytest.raises(ValueError, match="provider/model"):
        await _run(
            board_id=board.id,
            actor_id=active_user.id,
            key=uuid4(),
            payload=_payload(provider="Unavailable"),
        )
    assert await _counts(board.id) == (0, 0, 0)


@pytest.mark.parametrize(
    "fault_point",
    [
        "after_receipt_update",
        "after_chat_flush",
        "after_placement_creation",
        "before_commit",
    ],
)
async def test_board_chat_fault_rolls_back_every_row(
    active_user,
    fault_point: str,
) -> None:
    _, board = await _board(active_user.id)

    async def fail_at(point: str) -> None:
        if point == fault_point:
            message = f"injected:{point}"
            raise RuntimeError(message)

    with pytest.raises(RuntimeError, match=fault_point):
        await _run(
            board_id=board.id,
            actor_id=active_user.id,
            key=uuid4(),
            payload=_payload(),
            fault=fail_at,
        )
    assert await _counts(board.id) == (0, 0, 0)


async def test_board_chat_lost_response_replays_committed_ids(active_user) -> None:
    _, board = await _board(active_user.id)
    key = uuid4()
    payload = _payload()

    async def lose_response(point: str) -> None:
        if point == "after_commit_before_response":
            message = "response lost"
            raise RuntimeError(message)

    with pytest.raises(RuntimeError, match="response lost"):
        await _run(
            board_id=board.id,
            actor_id=active_user.id,
            key=key,
            payload=payload,
            fault=lose_response,
        )
    replay = await _run(
        board_id=board.id,
        actor_id=active_user.id,
        key=key,
        payload=payload,
    )
    assert replay.idempotency_replayed is True
    assert await _counts(board.id) == (1, 1, 1)


async def test_board_chat_rejects_ambient_transaction(active_user) -> None:
    _, board = await _board(active_user.id)

    async with session_scope() as session, session.begin():
        with pytest.raises(BoardCommandTransactionError):
            await create_board_chat(
                session,
                board_id=board.id,
                actor_id=active_user.id,
                idempotency_key=uuid4(),
                payload=_payload(),
            )
        await session.rollback()
    assert await _counts(board.id) == (0, 0, 0)
