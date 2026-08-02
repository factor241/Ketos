from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID, uuid4

import pytest
from ketos.services.database.models.chat_thread.model import ChatRun, ChatThread
from ketos.services.database.models.folder.model import Folder
from ketos.services.database.models.user.model import User
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

_TEST_PASSWORD = "stage08-hash"  # noqa: S105  # pragma: allowlist secret


@dataclass(frozen=True)
class CommandContext:
    actor_id: UUID
    project_id: UUID
    chat_id: UUID
    chat_run_id: UUID
    thread_id: str


@pytest.fixture(name="command_session")
async def command_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(SQLModel.metadata.create_all)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        yield session
    await engine.dispose()


@pytest.fixture(name="command_context")
async def command_context(command_session: AsyncSession) -> CommandContext:
    actor_id = uuid4()
    project_id = uuid4()
    chat_id = uuid4()
    chat_run_id = uuid4()
    thread_id = str(chat_id)
    command_session.add(User(id=actor_id, username=f"stage08-{actor_id}", password=_TEST_PASSWORD))
    command_session.add(Folder(id=project_id, name="Stage 08", user_id=actor_id))
    command_session.add(
        ChatThread(
            id=chat_id,
            project_id=project_id,
            created_by_id=actor_id,
            title="Stage 08",
            provider="test",
            model_name="test",
            context_policy="chat_only",
        )
    )
    command_session.add(
        ChatRun(
            id=chat_run_id,
            chat_id=chat_id,
            ag_ui_run_id="run-1",
            langgraph_thread_id=thread_id,
            idempotency_key="chat-run-key",
            request_fingerprint="d" * 64,
            run_sequence=1,
        )
    )
    await command_session.commit()
    return CommandContext(
        actor_id=actor_id,
        project_id=project_id,
        chat_id=chat_id,
        chat_run_id=chat_run_id,
        thread_id=thread_id,
    )
