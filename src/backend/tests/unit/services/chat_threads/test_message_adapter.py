from __future__ import annotations

import asyncio
from uuid import UUID, uuid4

import pytest
from ketos.services.chat_threads.message_adapter import (
    _append_committed_message,
    append_user_message,
    commit_assistant_message,
    load_committed_messages,
    messages_snapshot,
)
from ketos.services.database.models.chat_thread.model import ChatRun, ChatThread
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.message.model import MessageTable
from ketos.services.deps import session_scope
from sqlmodel import select

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("client")]


async def _chat_run(*, owner_id: UUID, folder_user_id: UUID | None = None) -> tuple[UUID, UUID]:
    async with session_scope() as session:
        folder = Folder(
            name=f"message-adapter-{uuid4()}",
            user_id=owner_id if folder_user_id is None else folder_user_id,
        )
        session.add(folder)
        await session.flush()
        chat = ChatThread(
            project_id=folder.id,
            created_by_id=owner_id,
            title="Adapter chat",
            provider="OpenAI",
            model_name="stage05-model",
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


async def _rows(chat_id: UUID) -> list[MessageTable]:
    async with session_scope() as session:
        return list(
            (
                await session.exec(
                    select(MessageTable).where(MessageTable.chat_id == chat_id).order_by(MessageTable.chat_sequence)
                )
            ).all()
        )


async def test_committed_transcript_is_exact_ordered_snapshot(active_user) -> None:
    chat_id, run_id = await _chat_run(owner_id=active_user.id)
    async with session_scope() as session:
        user_message = await append_user_message(
            session,
            chat_id=chat_id,
            chat_run_id=run_id,
            actor_id=active_user.id,
            text="Plan the board",
        )
    async with session_scope() as session:
        assistant_message = await commit_assistant_message(
            session,
            chat_id=chat_id,
            chat_run_id=run_id,
            actor_id=active_user.id,
            text="I prepared a proposal.",
        )
    async with session_scope() as session:
        transcript = await load_committed_messages(session, chat_id=chat_id, actor_id=active_user.id)
    assert [message.chat_sequence for message in transcript] == [1, 2]
    assert all(message.chat_id == chat_id and message.chat_run_id == run_id for message in transcript)
    assert [message.session_id for message in transcript] == [str(chat_id), str(chat_id)]
    assert messages_snapshot(transcript) == {
        "type": "MESSAGES_SNAPSHOT",
        "messages": [
            {"id": str(user_message.id), "role": "user", "content": "Plan the board"},
            {
                "id": str(assistant_message.id),
                "role": "assistant",
                "content": "I prepared a proposal.",
            },
        ],
    }


async def test_owner_join_ignores_forged_session_metadata(active_user) -> None:
    foreign_id = uuid4()
    chat_id, run_id = await _chat_run(owner_id=active_user.id, folder_user_id=foreign_id)
    async with session_scope() as session:
        row = MessageTable(
            sender="user",
            sender_name="User",
            session_id=str(chat_id),
            text="Foreign secret",
            files=[],
            properties={},
            content_blocks=[],
            session_metadata={"user_id": str(active_user.id)},
            chat_id=chat_id,
            chat_run_id=run_id,
            chat_sequence=1,
        )
        session.add(row)
        await session.commit()
    async with session_scope() as session:
        visible = await load_committed_messages(session, chat_id=chat_id, actor_id=active_user.id)
    assert visible == []


async def test_partial_delta_is_not_durable_and_failure_does_not_publish_sequence(active_user) -> None:
    chat_id, run_id = await _chat_run(owner_id=active_user.id)
    partial_delta = {"message_id": "streaming-1", "delta": "partial", "committed": False}
    assert not partial_delta["committed"]

    failure = "injected message failure"

    async def fail_before_flush(_message: MessageTable) -> None:
        raise RuntimeError(failure)

    async with session_scope() as session:
        with pytest.raises(RuntimeError, match=failure):
            await _append_committed_message(
                session,
                chat_id=chat_id,
                chat_run_id=run_id,
                actor_id=active_user.id,
                text="complete only",
                sender="assistant",
                sender_name="Assistant",
                is_output=True,
                before_flush=fail_before_flush,
            )
    assert await _rows(chat_id) == []
    async with session_scope() as session:
        committed = await commit_assistant_message(
            session,
            chat_id=chat_id,
            chat_run_id=run_id,
            actor_id=active_user.id,
            text="complete terminal message",
        )
    assert committed.chat_sequence == 1


async def test_two_message_writers_allocate_distinct_sequences(active_user) -> None:
    chat_id, run_id = await _chat_run(owner_id=active_user.id)
    ready = asyncio.Event()
    arrived = 0

    async def writer(text: str) -> MessageTable:
        nonlocal arrived
        async with session_scope() as session:
            arrived += 1
            if arrived == 2:
                ready.set()
            await ready.wait()
            return await append_user_message(
                session,
                chat_id=chat_id,
                chat_run_id=run_id,
                actor_id=active_user.id,
                text=text,
            )

    messages = await asyncio.gather(writer("first"), writer("second"))
    assert {message.chat_sequence for message in messages} == {1, 2}
    assert len(await _rows(chat_id)) == 2
