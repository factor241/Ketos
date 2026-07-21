from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlmodel import func, select

from ketos.services.chat_threads.message_adapter import append_user_message, commit_assistant_message
from ketos.services.chat_threads.messages import build_messages_snapshot
from ketos.services.database.models.chat_thread.model import ChatRun, ChatThread
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.message.model import MessageTable
from ketos.services.deps import session_scope

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("client")]


async def _chat_run(*, owner_id: UUID) -> tuple[UUID, UUID]:
    async with session_scope() as session:
        folder = Folder(name=f"snapshot-{uuid4()}", user_id=owner_id)
        session.add(folder)
        await session.flush()
        chat = ChatThread(
            project_id=folder.id,
            created_by_id=owner_id,
            title="Snapshot chat",
            provider="test",
            model_name="test",
            context_policy="chat_only",
        )
        session.add(chat)
        await session.flush()
        run = ChatRun(
            chat_id=chat.id,
            ag_ui_run_id=f"ag-{uuid4()}",
            langgraph_thread_id=str(chat.id),
            idempotency_key=f"key-{uuid4()}",
            request_fingerprint="a" * 64,
            run_sequence=1,
        )
        session.add(run)
        await session.commit()
        return chat.id, run.id


async def test_snapshot_is_exact_ordered_and_cursor_is_server_sequence(active_user) -> None:
    chat_id, run_id = await _chat_run(owner_id=active_user.id)
    async with session_scope() as session:
        first = await append_user_message(
            session, chat_id=chat_id, chat_run_id=run_id, actor_id=active_user.id, text="first"
        )
    async with session_scope() as session:
        second = await commit_assistant_message(
            session, chat_id=chat_id, chat_run_id=run_id, actor_id=active_user.id, text="second"
        )
    async with session_scope() as session:
        snapshot = await build_messages_snapshot(session=session, owner_id=active_user.id, chat_id=chat_id)

    assert snapshot.model_dump() == {
        "type": "MESSAGES_SNAPSHOT",
        "messages": [
            {"id": str(first.id), "role": "user", "content": "first"},
            {"id": str(second.id), "role": "assistant", "content": "second"},
        ],
        "cursor": 2,
    }


async def test_after_cursor_returns_delta_but_keeps_authoritative_cursor(active_user) -> None:
    chat_id, run_id = await _chat_run(owner_id=active_user.id)
    async with session_scope() as session:
        await append_user_message(
            session, chat_id=chat_id, chat_run_id=run_id, actor_id=active_user.id, text="first"
        )
    async with session_scope() as session:
        second = await commit_assistant_message(
            session, chat_id=chat_id, chat_run_id=run_id, actor_id=active_user.id, text="second"
        )
    async with session_scope() as session:
        delta = await build_messages_snapshot(
            session=session, owner_id=active_user.id, chat_id=chat_id, after_sequence=1
        )
        ahead = await build_messages_snapshot(
            session=session, owner_id=active_user.id, chat_id=chat_id, after_sequence=999
        )

    assert delta.cursor == 2
    assert delta.messages == ({"id": str(second.id), "role": "assistant", "content": "second"},)
    assert ahead.cursor == 2
    assert ahead.messages == ()


async def test_foreign_owner_gets_empty_snapshot_and_no_cursor(active_user) -> None:
    chat_id, run_id = await _chat_run(owner_id=active_user.id)
    async with session_scope() as session:
        await append_user_message(
            session, chat_id=chat_id, chat_run_id=run_id, actor_id=active_user.id, text="private"
        )
    async with session_scope() as session:
        denied = await build_messages_snapshot(session=session, owner_id=uuid4(), chat_id=chat_id)

    assert denied.model_dump() == {"type": "MESSAGES_SNAPSHOT", "messages": [], "cursor": 0}


async def test_snapshot_is_read_only_and_stable_across_service_objects(active_user) -> None:
    chat_id, run_id = await _chat_run(owner_id=active_user.id)
    async with session_scope() as session:
        await append_user_message(
            session, chat_id=chat_id, chat_run_id=run_id, actor_id=active_user.id, text="stable"
        )
    async with session_scope() as session:
        before_count = (await session.exec(select(func.count(MessageTable.id)))).one()
        before = await build_messages_snapshot(session=session, owner_id=active_user.id, chat_id=chat_id)
    async with session_scope() as session:
        after = await build_messages_snapshot(session=session, owner_id=active_user.id, chat_id=chat_id)
        after_count = (await session.exec(select(func.count(MessageTable.id)))).one()

    assert before.model_dump() == after.model_dump()
    assert before_count == after_count == 1


async def test_bounded_page_cursor_never_skips_unreturned_messages(active_user) -> None:
    chat_id, run_id = await _chat_run(owner_id=active_user.id)
    async with session_scope() as session:
        for sequence in range(1, 202):
            session.add(
                MessageTable(
                    sender="user",
                    sender_name="User",
                    session_id=str(chat_id),
                    text=f"message-{sequence}",
                    files=[],
                    properties={},
                    content_blocks=[],
                    chat_id=chat_id,
                    chat_run_id=run_id,
                    chat_sequence=sequence,
                    is_output=False,
                )
            )
        await session.commit()
    async with session_scope() as session:
        first_page = await build_messages_snapshot(session=session, owner_id=active_user.id, chat_id=chat_id)
        second_page = await build_messages_snapshot(
            session=session, owner_id=active_user.id, chat_id=chat_id, after_sequence=first_page.cursor
        )

    assert len(first_page.messages) == 200
    assert first_page.cursor == 200
    assert [message["content"] for message in second_page.messages] == ["message-201"]
    assert second_page.cursor == 201


@pytest.mark.parametrize("after_sequence", [-1, True, 1.5])
async def test_snapshot_rejects_invalid_cursor(active_user, after_sequence) -> None:
    chat_id, _run_id = await _chat_run(owner_id=active_user.id)
    async with session_scope() as session:
        with pytest.raises(ValueError, match="after_sequence"):
            await build_messages_snapshot(
                session=session,
                owner_id=active_user.id,
                chat_id=chat_id,
                after_sequence=after_sequence,
            )
